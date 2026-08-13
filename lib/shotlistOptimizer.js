// "Organize this" — turns a shot list into a timed day plan.
//
// The unit being planned is the SCENE: it owns the location and the light
// window, and it lasts as long as its shots take. Shots never move between
// scenes here; the optimiser only ever reorders scenes.
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
const DEFAULT_DURATION_MIN = 30;  // a scene with no shots still needs a slot
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

// A scene lasts as long as its shots take.
function durationOfScene(scene, shotsByScene) {
  const shots = (shotsByScene && shotsByScene.get(scene.id)) || [];
  const total = shots.reduce((sum, s) => {
    const n = Number(s.duration_minutes);
    return sum + (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  }, 0);
  return total > 0 ? total : DEFAULT_DURATION_MIN;
}

// Nearest-neighbour ordering over the soft scenes, seeded at a start location.
function nearestNeighbour(scenes, startLocId, leg) {
  const remaining = scenes.slice();
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
// list cannot spin — these are tens of scenes, not thousands.
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

// Walks a sequence of scenes from the call time, producing the timed rows.
function timeline(sequence, callMs, leg, windowByScene, shotsByScene) {
  const rows = [];
  let cursor = callMs;
  let currentLoc = null;

  sequence.forEach((scene, idx) => {
    const travel = idx === 0 && currentLoc == null
      ? { km: 0, minutes: 0 }
      : leg(currentLoc, scene.location_id);
    let start = cursor + travel.minutes * MIN;

    const win = windowByScene.get(scene.id);
    // A hard window is the point of the exercise: wait for it rather than
    // shooting outside it. A soft window never delays the day.
    if (win && win.hard && start < win.from) start = win.from;

    const duration = durationOfScene(scene, shotsByScene);
    const end = start + duration * MIN;

    rows.push({
      scene_id: scene.id,
      location_id: scene.location_id == null ? null : scene.location_id,
      start_ms: start,
      end_ms: end,
      duration_minutes: duration,
      shot_count: ((shotsByScene && shotsByScene.get(scene.id)) || []).length,
      travel_in_minutes: travel.minutes,
      travel_in_km: travel.km,
    });

    cursor = end;
    if (scene.location_id != null) currentLoc = scene.location_id;
  });

  // Travel to the NEXT scene is what a crew reads, so mirror each leg forward.
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

function sceneName(scene, idx) {
  if (!scene) return `Scene ${idx + 1}`;
  return scene.title || `Scene ${scene.scene_number || idx + 1}`;
}

function collectWarnings(rows, sceneById, windowByScene, dayEndMs) {
  const warnings = [];
  rows.forEach((row, idx) => {
    const scene = sceneById.get(row.scene_id);
    const win = windowByScene.get(row.scene_id);
    const name = sceneName(scene, idx);

    // "Any time" is exactly that: it can never be missed, so it never warns.
    if (win && win.key !== 'any_time') {
      if (row.start_ms < win.from || row.end_ms > win.to) {
        warnings.push({
          type: win.hard ? 'window_missed' : 'window_soft_miss',
          scene_id: row.scene_id,
          message: `${name} is scheduled ${fmtTime(row.start_ms)}–${fmtTime(row.end_ms)} but its ${windowLabel(win.key)} window is ${win.range_label}.`,
        });
      }
    }

    if (idx > 0) {
      const prev = rows[idx - 1];
      const available = Math.round((row.start_ms - prev.end_ms) / MIN);
      if (available < row.travel_in_minutes) {
        const prevName = sceneName(sceneById.get(prev.scene_id), idx - 1);
        warnings.push({
          type: 'travel_impossible',
          scene_id: row.scene_id,
          message: `Only ${available} min between ${prevName} and ${name}, but the drive takes about ${row.travel_in_minutes} min.`,
        });
      }
    }
  });

  const last = rows[rows.length - 1];
  if (last && dayEndMs && last.end_ms > dayEndMs) {
    warnings.push({
      type: 'long_day',
      scene_id: last.scene_id,
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

// Everything a run needs, derived once: leg costs, per-scene windows resolved
// from each scene's OWN location, and the row decorator shared by the plan, the
// comparison, the public page and both PDFs.
function prepare(shotlist, scenes, shotsByScene, locations, mode, legs) {
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

  const sceneById = new Map();
  const windowByScene = new Map();
  scenes.forEach(s => {
    sceneById.set(s.id, s);
    const loc = locById.get(s.location_id);
    const win = resolveWindow(s.light_window, shoot_date, loc ? loc.lat : null, loc ? loc.lng : null);
    if (win) windowByScene.set(s.id, win);
  });

  const decorate = row => {
    const scene = sceneById.get(row.scene_id);
    const win = windowByScene.get(row.scene_id);
    const loc = locById.get(row.location_id);
    return {
      ...row,
      start_label: fmtTime(row.start_ms),
      end_label: fmtTime(row.end_ms),
      title: scene ? scene.title : '',
      scene_number: scene ? scene.scene_number : null,
      space: scene ? scene.space : null,
      light_window: scene ? scene.light_window : null,
      light_window_label: win ? win.label : '',
      light_window_range: win ? win.range_label : '',
      light_window_hard: win ? win.hard : false,
      location_name: loc ? loc.name : null,
    };
  };

  return { callMs, dayEndMs, locById, leg, sceneById, windowByScene, decorate };
}

// Times one specific ordering with no network call at all — used by the public
// page and both PDFs, which must render instantly and identically offline.
function scheduleSequence(shotlist, orderedScenes, shotsByScene, locations) {
  const ctx = prepare(shotlist, orderedScenes, shotsByScene, locations, 'straight_line', null);
  if (ctx.callMs == null) {
    return { rows: [], warnings: [], totals: totals([]), scheduled: false };
  }
  const rows = timeline(orderedScenes, ctx.callMs, ctx.leg, ctx.windowByScene, shotsByScene);
  return {
    rows: rows.map(ctx.decorate),
    warnings: collectWarnings(rows, ctx.sceneById, ctx.windowByScene, ctx.dayEndMs),
    totals: totals(rows),
    scheduled: true,
  };
}

// The resolved light window of a single scene, for panels showing one row.
function windowForScene(scene, shotlist, locations) {
  const loc = locations.find(l => l.id === scene.location_id);
  return resolveWindow(
    scene.light_window,
    shotlist.shoot_date,
    loc ? loc.lat : null,
    loc ? loc.lng : null
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────

// shotlist: { shoot_date, call_time }
// scenes: user-ordered rows (sort_order ASC) with location_id / space / light_window
// shotsByScene: Map(scene id → its shots), for scene durations
// locations: shotlist_locations rows
// options: { startSceneId, cachedMatrix }
async function organize(shotlist, scenes, shotsByScene, locations, options = {}) {
  const shoot_date = shotlist.shoot_date;
  if (localToUtcMs(shoot_date, shotlist.call_time || '08:00') == null) {
    const err = new Error('A shoot date is required before the day can be organised');
    err.userMessage = true;
    throw err;
  }

  const table = await buildDistanceTable(locations, options.cachedMatrix);
  const ctx = prepare(shotlist, scenes, shotsByScene, locations, table.mode, table.legs);
  const { callMs, dayEndMs, leg, sceneById, windowByScene, decorate } = ctx;

  // ── Anchors first: hard-window scenes, ordered by their real window start ──
  const anchors = scenes.filter(s => isHardWindow(s.light_window))
    .sort((a, b) => {
      const wa = windowByScene.get(a.id);
      const wb = windowByScene.get(b.id);
      return (wa ? wa.from : 0) - (wb ? wb.from : 0);
    });
  const anchorIds = new Set(anchors.map(a => a.id));

  const soft = scenes.filter(s => !anchorIds.has(s.id));

  // The chosen start scene leads the day whatever kind it is.
  const startSceneId = Number(options.startSceneId);
  const startScene = scenes.find(s => s.id === startSceneId) || null;

  let softPool = soft.slice();
  let leadingSoft = [];
  if (startScene && !anchorIds.has(startScene.id)) {
    softPool = softPool.filter(s => s.id !== startScene.id);
    leadingSoft = [startScene];
  }

  const startLocId = startScene ? startScene.location_id : (softPool[0] ? softPool[0].location_id : null);

  // Nearest neighbour, then a two-opt improvement pass, over the soft scenes.
  const nnOrder = nearestNeighbour(softPool, startLocId, leg);
  const softOrder = leadingSoft.concat(twoOpt(nnOrder, startLocId, leg));

  // ── Fill the soft scenes around the anchors without violating a window ──
  const sequence = [];
  const remaining = softOrder.slice();
  let cursor = callMs;
  let currentLoc = null;

  const anchorQueue = anchors.slice();
  if (startScene && anchorIds.has(startScene.id)) {
    const i = anchorQueue.findIndex(a => a.id === startScene.id);
    if (i > 0) anchorQueue.unshift(anchorQueue.splice(i, 1)[0]);
  } else if (startScene) {
    // A soft start scene opens the day: it is the crew's chosen first setup, so
    // it leads even when an anchor's window has already opened.
    const i = remaining.findIndex(s => s.id === startScene.id);
    if (i >= 0) {
      remaining.splice(i, 1);
      sequence.push(startScene);
      cursor = callMs + durationOfScene(startScene, shotsByScene) * MIN;
      if (startScene.location_id != null) currentLoc = startScene.location_id;
    }
  }

  for (const anchor of anchorQueue) {
    const anchorWin = windowByScene.get(anchor.id);
    const anchorStart = anchorWin ? anchorWin.from : cursor;

    // Greedily take soft scenes that still leave time to reach the anchor.
    let progress = true;
    while (progress && remaining.length) {
      progress = false;
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const travelIn = leg(currentLoc, cand.location_id);
        const candStart = cursor + travelIn.minutes * MIN;
        const candEnd = candStart + durationOfScene(cand, shotsByScene) * MIN;
        const travelToAnchor = leg(cand.location_id == null ? currentLoc : cand.location_id, anchor.location_id);
        const candWin = windowByScene.get(cand.id);

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
    cursor = anchorActualStart + durationOfScene(anchor, shotsByScene) * MIN;
    if (anchor.location_id != null) currentLoc = anchor.location_id;
  }

  // Everything the anchors left over runs after them, in optimised order.
  remaining.forEach(s => sequence.push(s));

  const rows = timeline(sequence, callMs, leg, windowByScene, shotsByScene);
  const warnings = collectWarnings(rows, sceneById, windowByScene, dayEndMs);

  // ── The same day, as the user currently has it ordered ──
  const currentRows = timeline(scenes, callMs, leg, windowByScene, shotsByScene);
  const currentWarnings = collectWarnings(currentRows, sceneById, windowByScene, dayEndMs);

  const plan = {
    generated_at: new Date().toISOString(),
    distance_mode: table.mode,
    distance_mode_label: table.mode === 'google' ? 'Google road distances' : 'Straight-line estimate',
    distance_from_cache: !!table.fromCache,
    shoot_date,
    call_time: shotlist.call_time || null,
    start_scene_id: startScene ? startScene.id : null,
    order: rows.map(r => r.scene_id),
    rows: rows.map(decorate),
    warnings,
    totals: totals(rows),
  };

  const current = {
    order: scenes.map(s => s.id),
    rows: currentRows.map(decorate),
    warnings: currentWarnings,
    totals: totals(currentRows),
  };

  // ── Comparison, versus the user's ordering ──
  const currentIndex = new Map(current.order.map((id, i) => [id, i]));
  const moves = plan.order.map((id, i) => {
    const from = currentIndex.has(id) ? currentIndex.get(id) : null;
    const scene = sceneById.get(id);
    return {
      scene_id: id,
      title: sceneName(scene, i),
      from_position: from == null ? null : from + 1,
      to_position: i + 1,
      moved: from !== i,
      start_label: fmtTime(rows[i].start_ms),
    };
  });

  const keyOf = w => `${w.type}:${w.scene_id}`;
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
  windowForScene,
  durationOfScene,
  haversineKm,
  straightLineLeg,
  DEFAULT_DURATION_MIN,
};
