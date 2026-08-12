// "Organize this" — turns a shot list into a timed day plan.
//
// Two distance modes:
//   • straight-line (default): haversine between the pinned coordinates, a
//     detour factor for real roads, and a rough travel time. No key, no
//     network, works everywhere.
//   • google: one Distance Matrix call for the whole shot list when
//     GOOGLE_MAPS_API_KEY is set. Any missing key, failed call, timeout or
//     unusable response falls back to straight-line SILENTLY — the plan is
//     always produced, and it always records which mode produced it.
//
// The result NEVER touches the user's ordering. It is written to
// optimized_order / plan_json and only an explicit Apply copies it across.

const {
  MIN, isHardWindow, windowLabel, resolveWindow, localToUtcMs, fmtTime,
} = require('./sunWindows');

const DETOUR_FACTOR = 1.35;       // straight line → road distance, rough
const AVG_SPEED_KMH = 45;         // mixed urban/rural average
const MIN_TRAVEL_MIN = 5;         // any change of location costs at least this
const DEFAULT_DURATION_MIN = 30;
const DAY_END_HOUR = 22;          // a day running past this earns a warning
const MATRIX_TIMEOUT_MS = 8000;
const MATRIX_MAX_LOCATIONS = 10;  // 10×10 = 100 elements, one request

// ── Geometry ──────────────────────────────────────────────────────────────────

function haversineKm(a, b) {
  if (!a || !b) return 0;
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function straightLineLeg(from, to) {
  if (!from || !to) return { km: 0, minutes: 0 };
  if (from.id === to.id) return { km: 0, minutes: 0 };
  const km = haversineKm(from, to) * DETOUR_FACTOR;
  const minutes = Math.max(MIN_TRAVEL_MIN, Math.round((km / AVG_SPEED_KMH) * 60));
  return { km: Math.round(km * 10) / 10, minutes };
}

// Cache key: the exact set of coordinates a matrix was built for. Editing or
// adding a location changes the key, so a stale matrix is never reused.
function matrixCacheKey(locations) {
  return locations
    .map(l => `${l.id}:${Number(l.lat).toFixed(5)},${Number(l.lng).toFixed(5)}`)
    .join('|');
}

// ── Google Distance Matrix (optional upgrade) ────────────────────────────────

async function fetchGoogleMatrix(locations) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  if (locations.length < 2 || locations.length > MATRIX_MAX_LOCATIONS) return null;

  const coords = locations.map(l => `${l.lat},${l.lng}`).join('|');
  const url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
    + `?origins=${encodeURIComponent(coords)}`
    + `&destinations=${encodeURIComponent(coords)}`
    + '&mode=driving&units=metric'
    + `&key=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MATRIX_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.status !== 'OK' || !Array.isArray(data.rows)) return null;
    if (data.rows.length !== locations.length) return null;

    const legs = {};
    for (let i = 0; i < locations.length; i++) {
      const row = data.rows[i];
      if (!row || !Array.isArray(row.elements) || row.elements.length !== locations.length) return null;
      for (let j = 0; j < locations.length; j++) {
        const el = row.elements[j];
        if (!el || el.status !== 'OK' || !el.distance || !el.duration) {
          if (i === j) continue;         // self legs are allowed to be missing
          return null;
        }
        legs[`${locations[i].id}>${locations[j].id}`] = {
          km: Math.round((el.distance.value / 1000) * 10) / 10,
          minutes: Math.max(i === j ? 0 : MIN_TRAVEL_MIN, Math.round(el.duration.value / 60)),
        };
      }
    }
    return legs;
  } catch (_) {
    return null;                          // timeout, DNS, JSON, anything
  } finally {
    clearTimeout(timer);
  }
}

// Builds the leg lookup used by the whole run. Returns { mode, legs, cache }.
// cache is what gets persisted so a repeated run does not re-request.
async function buildDistanceTable(locations, cached) {
  const pinned = locations.filter(l => Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)))
    .map(l => ({ id: l.id, lat: Number(l.lat), lng: Number(l.lng) }));
  const key = matrixCacheKey(pinned);

  if (cached && cached.key === key && cached.legs && cached.mode === 'google') {
    return { mode: 'google', legs: cached.legs, cache: cached, fromCache: true };
  }

  if (process.env.GOOGLE_MAPS_API_KEY) {
    const legs = await fetchGoogleMatrix(pinned);
    if (legs) {
      const cache = { key, mode: 'google', legs, fetched_at: new Date().toISOString() };
      return { mode: 'google', legs, cache, fromCache: false };
    }
  }

  return { mode: 'straight_line', legs: null, cache: cached || null, fromCache: false };
}

function legLookup(mode, legs, locById) {
  return function leg(fromId, toId) {
    if (fromId == null || toId == null) return { km: 0, minutes: 0 };
    if (fromId === toId) return { km: 0, minutes: 0 };
    if (mode === 'google' && legs) {
      const hit = legs[`${fromId}>${toId}`];
      if (hit) return hit;
    }
    return straightLineLeg(locById.get(fromId), locById.get(toId));
  };
}

// ── Plan construction ─────────────────────────────────────────────────────────

function durationOf(shot) {
  const n = Number(shot.duration_minutes);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_DURATION_MIN;
}

// Nearest-neighbour ordering over the soft shots, seeded at a start location.
function nearestNeighbour(shots, startLocId, leg) {
  const remaining = shots.slice();
  const out = [];
  let current = startLocId;
  while (remaining.length) {
    let bestIdx = 0;
    let bestCost = Infinity;
    remaining.forEach((s, i) => {
      const cost = leg(current, s.location_id).km;
      if (cost < bestCost) { bestCost = cost; bestIdx = i; }
    });
    const [next] = remaining.splice(bestIdx, 1);
    out.push(next);
    if (next.location_id != null) current = next.location_id;
  }
  return out;
}

function routeDistance(order, startLocId, leg) {
  let total = 0;
  let current = startLocId;
  for (const s of order) {
    total += leg(current, s.location_id).km;
    if (s.location_id != null) current = s.location_id;
  }
  return total;
}

// Classic 2-opt: reverse any segment that shortens the route. Bounded so a big
// list cannot spin — the lists here are tens of shots, not thousands.
function twoOpt(order, startLocId, leg) {
  if (order.length < 4) return order;
  let best = order.slice();
  let bestDist = routeDistance(best, startLocId, leg);
  let improved = true;
  let guard = 0;
  while (improved && guard < 60) {
    improved = false;
    guard++;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = best.slice(0, i)
          .concat(best.slice(i, k + 1).reverse())
          .concat(best.slice(k + 1));
        const d = routeDistance(candidate, startLocId, leg);
        if (d < bestDist - 0.01) {
          best = candidate;
          bestDist = d;
          improved = true;
        }
      }
    }
  }
  return best;
}

// Walks a sequence of shots from the call time, producing the timed rows.
function timeline(sequence, callMs, leg, windowByShot) {
  const rows = [];
  let cursor = callMs;
  let currentLoc = null;

  sequence.forEach((shot, idx) => {
    const travel = idx === 0 && currentLoc == null
      ? { km: 0, minutes: 0 }
      : leg(currentLoc, shot.location_id);
    let start = cursor + travel.minutes * MIN;

    const win = windowByShot.get(shot.id);
    // A hard window is the point of the exercise: wait for it rather than
    // shooting outside it. A soft window never delays the day.
    if (win && win.hard && start < win.from) start = win.from;

    const duration = durationOf(shot);
    const end = start + duration * MIN;

    rows.push({
      shot_id: shot.id,
      location_id: shot.location_id == null ? null : shot.location_id,
      start_ms: start,
      end_ms: end,
      duration_minutes: duration,
      travel_in_minutes: travel.minutes,
      travel_in_km: travel.km,
    });

    cursor = end;
    if (shot.location_id != null) currentLoc = shot.location_id;
  });

  // Travel to the NEXT shot is what a crew reads, so mirror each leg forward.
  for (let i = 0; i < rows.length - 1; i++) {
    rows[i].travel_out_minutes = rows[i + 1].travel_in_minutes;
    rows[i].travel_out_km = rows[i + 1].travel_in_km;
  }
  if (rows.length) {
    const last = rows[rows.length - 1];
    last.travel_out_minutes = 0;
    last.travel_out_km = 0;
  }
  return rows;
}

function collectWarnings(rows, shotById, windowByShot, dayEndMs) {
  const warnings = [];
  rows.forEach((row, idx) => {
    const shot = shotById.get(row.shot_id);
    const win = windowByShot.get(row.shot_id);
    const name = shot ? (shot.title || `Shot ${shot.shot_number || idx + 1}`) : `Shot ${idx + 1}`;

    if (win) {
      if (row.start_ms < win.from || row.end_ms > win.to) {
        warnings.push({
          type: win.hard ? 'window_missed' : 'window_soft_miss',
          shot_id: row.shot_id,
          message: `${name} is scheduled ${fmtTime(row.start_ms)}–${fmtTime(row.end_ms)} but its ${windowLabel(win.key)} window is ${win.range_label}.`,
        });
      }
    }

    if (idx > 0) {
      const prev = rows[idx - 1];
      const available = Math.round((row.start_ms - prev.end_ms) / MIN);
      if (available < row.travel_in_minutes) {
        warnings.push({
          type: 'travel_impossible',
          shot_id: row.shot_id,
          message: `Only ${available} min between ${shotById.get(prev.shot_id) ? (shotById.get(prev.shot_id).title || 'the previous shot') : 'the previous shot'} and ${name}, but the drive takes about ${row.travel_in_minutes} min.`,
        });
      }
    }
  });

  const last = rows[rows.length - 1];
  if (last && dayEndMs && last.end_ms > dayEndMs) {
    warnings.push({
      type: 'long_day',
      shot_id: last.shot_id,
      message: `The day finishes at ${fmtTime(last.end_ms)}, past ${fmtTime(dayEndMs)}.`,
    });
  }
  return warnings;
}

function totals(rows) {
  return {
    travel_minutes: rows.reduce((s, r) => s + (r.travel_in_minutes || 0), 0),
    travel_km: Math.round(rows.reduce((s, r) => s + (r.travel_in_km || 0), 0) * 10) / 10,
    shoot_minutes: rows.reduce((s, r) => s + (r.duration_minutes || 0), 0),
    start_ms: rows.length ? rows[0].start_ms : null,
    end_ms: rows.length ? rows[rows.length - 1].end_ms : null,
  };
}

// Everything a run needs, derived once: leg costs, per-shot windows resolved
// from each shot's OWN location, and the row decorator shared by the plan, the
// comparison, the public page and both PDFs.
function prepare(shotlist, shots, locations, mode, legs) {
  const shoot_date = shotlist.shoot_date;
  const callMs = localToUtcMs(shoot_date, shotlist.call_time || '08:00');
  const dayEndMs = callMs == null
    ? null
    : localToUtcMs(shoot_date, `${String(DAY_END_HOUR).padStart(2, '0')}:00`);

  const locById = new Map();
  locations.forEach(l => {
    if (Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng))) {
      locById.set(l.id, { id: l.id, lat: Number(l.lat), lng: Number(l.lng), name: l.name });
    }
  });

  const leg = legLookup(mode, legs, locById);

  const shotById = new Map();
  const windowByShot = new Map();
  shots.forEach(s => {
    shotById.set(s.id, s);
    const loc = locById.get(s.location_id);
    const win = resolveWindow(s.light_window, shoot_date, loc ? loc.lat : null, loc ? loc.lng : null);
    if (win) windowByShot.set(s.id, win);
  });

  const decorate = row => {
    const shot = shotById.get(row.shot_id);
    const win = windowByShot.get(row.shot_id);
    const loc = locById.get(row.location_id);
    return {
      ...row,
      start_label: fmtTime(row.start_ms),
      end_label: fmtTime(row.end_ms),
      title: shot ? shot.title : '',
      shot_number: shot ? shot.shot_number : null,
      space: shot ? shot.space : null,
      light_window: shot ? shot.light_window : null,
      light_window_label: win ? win.label : '',
      light_window_range: win ? win.range_label : '',
      light_window_hard: win ? win.hard : false,
      location_name: loc ? loc.name : null,
    };
  };

  return { callMs, dayEndMs, locById, leg, shotById, windowByShot, decorate };
}

// Times one specific ordering with no network call at all — used by the public
// page and both PDFs, which must render instantly and identically offline.
function scheduleSequence(shotlist, orderedShots, locations) {
  const ctx = prepare(shotlist, orderedShots, locations, 'straight_line', null);
  if (ctx.callMs == null) {
    return { rows: [], warnings: [], totals: totals([]), scheduled: false };
  }
  const rows = timeline(orderedShots, ctx.callMs, ctx.leg, ctx.windowByShot);
  return {
    rows: rows.map(ctx.decorate),
    warnings: collectWarnings(rows, ctx.shotById, ctx.windowByShot, ctx.dayEndMs),
    totals: totals(rows),
    scheduled: true,
  };
}

// The resolved light window of a single shot, for panels that show one row.
function windowForShot(shot, shotlist, locations) {
  const loc = locations.find(l => l.id === shot.location_id);
  return resolveWindow(
    shot.light_window,
    shotlist.shoot_date,
    loc ? loc.lat : null,
    loc ? loc.lng : null
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────

// shotlist: { shoot_date, call_time }
// shots: user-ordered rows (sort_order ASC) with location_id / space /
//        light_window / duration_minutes
// locations: shotlist_locations rows
// options: { startShotId, cachedMatrix }
async function organize(shotlist, shots, locations, options = {}) {
  const shoot_date = shotlist.shoot_date;
  if (localToUtcMs(shoot_date, shotlist.call_time || '08:00') == null) {
    const err = new Error('A shoot date is required before the day can be organised');
    err.userMessage = true;
    throw err;
  }

  const table = await buildDistanceTable(locations, options.cachedMatrix);
  const ctx = prepare(shotlist, shots, locations, table.mode, table.legs);
  const { callMs, dayEndMs, leg, shotById, windowByShot, decorate } = ctx;

  // ── Anchors first: hard-window shots, ordered by their real window start ──
  const anchors = shots.filter(s => isHardWindow(s.light_window))
    .sort((a, b) => {
      const wa = windowByShot.get(a.id);
      const wb = windowByShot.get(b.id);
      return (wa ? wa.from : 0) - (wb ? wb.from : 0);
    });
  const anchorIds = new Set(anchors.map(a => a.id));

  const soft = shots.filter(s => !anchorIds.has(s.id));

  // The chosen start shot leads the day whatever kind it is.
  const startShotId = Number(options.startShotId);
  const startShot = shots.find(s => s.id === startShotId) || null;

  let softPool = soft.slice();
  let leadingSoft = [];
  if (startShot && !anchorIds.has(startShot.id)) {
    softPool = softPool.filter(s => s.id !== startShot.id);
    leadingSoft = [startShot];
  }

  const startLocId = startShot ? startShot.location_id : (softPool[0] ? softPool[0].location_id : null);

  // Nearest neighbour, then a two-opt improvement pass, over the soft shots.
  const nnOrder = nearestNeighbour(softPool, startLocId, leg);
  const softOrder = leadingSoft.concat(twoOpt(nnOrder, startLocId, leg));

  // ── Fill the soft shots around the anchors without violating a window ──
  const sequence = [];
  const remaining = softOrder.slice();
  let cursor = callMs;
  let currentLoc = null;

  const anchorQueue = anchors.slice();
  if (startShot && anchorIds.has(startShot.id)) {
    const i = anchorQueue.findIndex(a => a.id === startShot.id);
    if (i > 0) anchorQueue.unshift(anchorQueue.splice(i, 1)[0]);
  } else if (startShot) {
    // A soft start shot opens the day: it is the crew's chosen first setup, so
    // it leads even when an anchor's window has already opened.
    const i = remaining.findIndex(s => s.id === startShot.id);
    if (i >= 0) {
      remaining.splice(i, 1);
      sequence.push(startShot);
      cursor = callMs + durationOf(startShot) * MIN;
      if (startShot.location_id != null) currentLoc = startShot.location_id;
    }
  }

  for (const anchor of anchorQueue) {
    const anchorWin = windowByShot.get(anchor.id);
    const anchorStart = anchorWin ? anchorWin.from : cursor;

    // Greedily take soft shots that still leave time to reach the anchor.
    let progress = true;
    while (progress && remaining.length) {
      progress = false;
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const travelIn = leg(currentLoc, cand.location_id);
        const candStart = cursor + travelIn.minutes * MIN;
        const candEnd = candStart + durationOf(cand) * MIN;
        const travelToAnchor = leg(cand.location_id == null ? currentLoc : cand.location_id, anchor.location_id);
        const candWin = windowByShot.get(cand.id);

        const fitsBeforeAnchor = candEnd + travelToAnchor.minutes * MIN <= anchorStart;
        const insideOwnWindow = !candWin || (candStart >= candWin.from && candEnd <= candWin.to);

        if (fitsBeforeAnchor && insideOwnWindow) {
          sequence.push(cand);
          remaining.splice(i, 1);
          cursor = candEnd;
          if (cand.location_id != null) currentLoc = cand.location_id;
          progress = true;
          break;
        }
      }
    }

    sequence.push(anchor);
    const travelToAnchor = leg(currentLoc, anchor.location_id);
    const anchorActualStart = Math.max(cursor + travelToAnchor.minutes * MIN, anchorStart);
    cursor = anchorActualStart + durationOf(anchor) * MIN;
    if (anchor.location_id != null) currentLoc = anchor.location_id;
  }

  // Everything the anchors left over runs after them, in optimised order.
  remaining.forEach(s => sequence.push(s));

  const rows = timeline(sequence, callMs, leg, windowByShot);
  const warnings = collectWarnings(rows, shotById, windowByShot, dayEndMs);

  // ── The same day, as the user currently has it ordered ──
  const currentRows = timeline(shots, callMs, leg, windowByShot);
  const currentWarnings = collectWarnings(currentRows, shotById, windowByShot, dayEndMs);

  const plan = {
    generated_at: new Date().toISOString(),
    distance_mode: table.mode,
    distance_mode_label: table.mode === 'google' ? 'Google road distances' : 'Straight-line estimate',
    distance_from_cache: !!table.fromCache,
    shoot_date,
    call_time: shotlist.call_time || null,
    start_shot_id: startShot ? startShot.id : null,
    order: rows.map(r => r.shot_id),
    rows: rows.map(decorate),
    warnings,
    totals: totals(rows),
  };

  const current = {
    order: shots.map(s => s.id),
    rows: currentRows.map(decorate),
    warnings: currentWarnings,
    totals: totals(currentRows),
  };

  // ── Comparison, versus the user's ordering ──
  const currentIndex = new Map(current.order.map((id, i) => [id, i]));
  const moves = plan.order.map((id, i) => {
    const from = currentIndex.has(id) ? currentIndex.get(id) : null;
    const shot = shotById.get(id);
    return {
      shot_id: id,
      title: shot ? shot.title : '',
      from_position: from == null ? null : from + 1,
      to_position: i + 1,
      moved: from !== i,
      start_label: fmtTime(rows[i].start_ms),
    };
  });

  const keyOf = w => `${w.type}:${w.shot_id}`;
  const currentKeys = new Set(current.warnings.map(keyOf));
  const planKeys = new Set(warnings.map(keyOf));

  const comparison = {
    moved_count: moves.filter(m => m.moved).length,
    moves,
    fixes: current.warnings.filter(w => !planKeys.has(keyOf(w))),
    introduces: warnings.filter(w => !currentKeys.has(keyOf(w))),
    current: {
      travel_km: current.totals.travel_km,
      travel_minutes: current.totals.travel_minutes,
      end_label: current.totals.end_ms ? fmtTime(current.totals.end_ms) : null,
      warning_count: current.warnings.length,
    },
    optimised: {
      travel_km: plan.totals.travel_km,
      travel_minutes: plan.totals.travel_minutes,
      end_label: plan.totals.end_ms ? fmtTime(plan.totals.end_ms) : null,
      warning_count: warnings.length,
    },
  };

  return { plan, current, comparison, matrixCache: table.cache };
}

module.exports = {
  organize,
  scheduleSequence,
  windowForShot,
  haversineKm,
  straightLineLeg,
  DEFAULT_DURATION_MIN,
};
