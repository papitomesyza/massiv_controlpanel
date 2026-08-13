// "Organize this" — turns one shoot day into a timed plan.
//
// The optimiser runs PER DAY, because a day is the unit that gets scheduled.
// It only ever reorders scenes within their own day: shots never move between
// scenes, and scenes never move between days.
//
// Constraint priority, highest first:
//   1. locked times and fixed-time breaks — immovable
//   2. light windows
//   3. travel minimisation
//   4. grouping, so the day does not bounce between two locations twice
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

const { MIN, resolveWindow, localToUtcMs } = require('./sunWindows');
const {
  buildDayTimeline, sceneDuration, lockFor, moveParts,
} = require('./shotlistSchedule');

const DETOUR_FACTOR = 1.35;       // straight line → road distance, rough
const AVG_SPEED_KMH = 45;         // mixed urban/rural average
const MIN_TRAVEL_MIN = 5;         // any change of location costs at least this
const DEFAULT_DURATION_MIN = 30;  // a scene with no shots still needs a slot
const MATRIX_TIMEOUT_MS = 8000;
const MATRIX_MAX_LOCATIONS = 10;  // 10×10 = 100 elements, one request
// What one company move is "worth" in kilometres when comparing routes, so
// consolidating two visits into one beats a marginally shorter drive.
const MOVE_PENALTY_KM = 25;

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

// Groups let the day stop bouncing: scenes at one location are consolidated
// into a single visit unless a hard light window genuinely forces a split.
function buildGroups(scenes, windowByScene, shotsByScene) {
  const groups = [];
  const byLocation = new Map();

  scenes.forEach(scene => {
    const win = windowByScene.get(scene.id);
    const locked = !!lockFor(scene, shotsByScene.get(scene.id));
    // A locked scene or a hard window is its own visit: it has to land at a
    // specific time, so it cannot be folded into another group.
    if (locked || (win && win.hard)) {
      groups.push({ location_id: scene.location_id, scenes: [scene], anchored: true, win, locked });
      return;
    }
    const key = scene.location_id == null ? `none-${scene.id}` : `loc-${scene.location_id}`;
    if (!byLocation.has(key)) {
      const group = { location_id: scene.location_id, scenes: [], anchored: false, win: null, locked: false };
      byLocation.set(key, group);
      groups.push(group);
    }
    byLocation.get(key).scenes.push(scene);
  });

  return groups;
}

function groupDuration(group, shotsByScene) {
  return group.scenes.reduce((n, s) => n + sceneDuration(shotsByScene.get(s.id)), 0);
}

// Earliest instant a group may start: its lock, else its hard window opening.
function groupAnchorMs(group, windowByScene, shotsByScene, shootDate) {
  const scene = group.scenes[0];
  const lock = lockFor(scene, shotsByScene.get(scene.id));
  if (lock) {
    const ms = localToUtcMs(shootDate, lock.time);
    if (ms != null) return ms;
  }
  const win = windowByScene.get(scene.id);
  if (win && win.hard) return win.from;
  return null;
}

// Nearest neighbour over groups (not single scenes), so consolidation is what
// gets optimised.
function nearestNeighbourGroups(groups, startLocId, leg) {
  const remaining = groups.slice();
  const out = [];
  let current = startLocId;
  while (remaining.length) {
    let bestIdx = 0;
    let bestCost = Infinity;
    remaining.forEach((g, i) => {
      const cost = leg(current, g.location_id).km;
      if (cost < bestCost) { bestCost = cost; bestIdx = i; }
    });
    const [next] = remaining.splice(bestIdx, 1);
    out.push(next);
    if (next.location_id != null) current = next.location_id;
  }
  return out;
}

function groupRouteCost(order, startLocId, leg) {
  // Distance plus a penalty per company move, so two visits to one location
  // lose to one visit even when the driving is short.
  let km = 0;
  let moves = 0;
  let current = startLocId;
  for (const g of order) {
    if (g.location_id != null && current != null && g.location_id !== current) moves++;
    km += leg(current, g.location_id).km;
    if (g.location_id != null) current = g.location_id;
  }
  return km + moves * MOVE_PENALTY_KM;
}

function twoOptGroups(order, startLocId, leg) {
  if (order.length < 4) return order;
  let best = order.slice();
  let bestCost = groupRouteCost(best, startLocId, leg);
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
        const cost = groupRouteCost(candidate, startLocId, leg);
        if (cost < bestCost - 0.01) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

function resolveWindows(scenes, shootDate, locations) {
  const locById = new Map(locations.map(l => [l.id, l]));
  const map = new Map();
  scenes.forEach(scene => {
    const loc = locById.get(scene.location_id);
    const win = resolveWindow(scene.light_window, shootDate, loc ? loc.lat : null, loc ? loc.lng : null);
    if (win) map.set(scene.id, win);
  });
  return map;
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Organises ONE day.
// day: shotlist_days row; scenes: that day's scenes in user order
// options: { startSceneId, cachedMatrix }
async function organizeDay(shotlist, day, scenes, shotsByScene, breaks, locations, options = {}) {
  const shootDate = (day && day.shoot_date) || shotlist.shoot_date;
  if (!shootDate || localToUtcMs(shootDate, '08:00') == null) {
    const err = new Error('This day needs a shoot date before it can be organised');
    err.userMessage = true;
    throw err;
  }
  if (!scenes.length) {
    const err = new Error('This day has no scenes to organise');
    err.userMessage = true;
    throw err;
  }

  const table = await buildDistanceTable(locations, options.cachedMatrix);
  const locById = new Map(locations.map(l => [l.id, l]));
  const leg = legLookup(table.mode, table.legs, locById);
  const windowByScene = resolveWindows(scenes, shootDate, locations);

  // ── 1. Group by location so the day consolidates visits ──
  const groups = buildGroups(scenes, windowByScene, shotsByScene);

  const startSceneId = Number(options.startSceneId);
  const startScene = scenes.find(s => s.id === startSceneId) || null;
  const startGroupIndex = startScene
    ? groups.findIndex(g => g.scenes.some(s => s.id === startScene.id))
    : -1;

  const anchored = [];
  const floating = [];
  groups.forEach((g, i) => {
    const anchorMs = groupAnchorMs(g, windowByScene, shotsByScene, shootDate);
    g.anchor_ms = anchorMs;
    g.is_start = i === startGroupIndex;
    if (anchorMs != null) anchored.push(g);
    else floating.push(g);
  });
  anchored.sort((a, b) => a.anchor_ms - b.anchor_ms);

  // ── 2. Order the floating groups: nearest neighbour, then two-opt ──
  let leading = [];
  let pool = floating.slice();
  const startFloating = floating.find(g => g.is_start);
  if (startFloating) {
    pool = pool.filter(g => g !== startFloating);
    leading = [startFloating];
  }
  const startLocId = startScene ? startScene.location_id : (pool[0] ? pool[0].location_id : null);
  const floatOrder = leading.concat(twoOptGroups(nearestNeighbourGroups(pool, startLocId, leg), startLocId, leg));

  // ── 3. Fill the floating groups around the anchored ones ──
  const sequence = [];
  const remaining = floatOrder.slice();
  let cursor = localToUtcMs(shootDate, (day && day.crew_call) || shotlist.call_time || '08:00');
  const firstAnchor = anchored.length ? anchored[0].anchor_ms : null;
  if (firstAnchor != null && firstAnchor < cursor) cursor = firstAnchor;
  let currentLoc = null;

  const anchorQueue = anchored.slice();
  // A chosen start scene that anchors the day leads its queue.
  if (startScene && anchorQueue.some(g => g.is_start)) {
    const i = anchorQueue.findIndex(g => g.is_start);
    if (i > 0) anchorQueue.unshift(anchorQueue.splice(i, 1)[0]);
  } else if (startFloating) {
    const i = remaining.indexOf(startFloating);
    if (i >= 0) {
      remaining.splice(i, 1);
      sequence.push(startFloating);
      cursor += groupDuration(startFloating, shotsByScene) * MIN;
      if (startFloating.location_id != null) currentLoc = startFloating.location_id;
    }
  }

  const moveCost = (fromLoc, toLoc) => {
    if (fromLoc == null || toLoc == null || fromLoc === toLoc) return 0;
    const parts = moveParts(shotlist, null);
    return parts.wrap + leg(fromLoc, toLoc).minutes + parts.setup;
  };

  for (const anchor of anchorQueue) {
    let progress = true;
    while (progress && remaining.length) {
      progress = false;
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const inbound = moveCost(currentLoc, cand.location_id);
        const candStart = cursor + inbound * MIN;
        const candEnd = candStart + groupDuration(cand, shotsByScene) * MIN;
        const toAnchor = moveCost(cand.location_id == null ? currentLoc : cand.location_id, anchor.location_id);
        if (candEnd + toAnchor * MIN <= anchor.anchor_ms) {
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
    const inbound = moveCost(currentLoc, anchor.location_id);
    cursor = Math.max(cursor + inbound * MIN, anchor.anchor_ms) + groupDuration(anchor, shotsByScene) * MIN;
    if (anchor.location_id != null) currentLoc = anchor.location_id;
  }
  remaining.forEach(g => sequence.push(g));

  const orderedScenes = sequence.flatMap(g => g.scenes);

  // ── 4. Time both orderings with the same builder the rest of the app uses ──
  const planned = buildDayTimeline(shotlist, day, orderedScenes, shotsByScene, breaks, locations, leg);
  const current = buildDayTimeline(shotlist, day, scenes, shotsByScene, breaks, locations, leg);

  const plan = {
    generated_at: new Date().toISOString(),
    day_id: day ? day.id : null,
    distance_mode: table.mode,
    distance_mode_label: table.mode === 'google' ? 'Google road distances' : 'Straight-line estimate',
    distance_from_cache: !!table.fromCache,
    shoot_date: shootDate,
    start_scene_id: startScene ? startScene.id : null,
    order: orderedScenes.map(s => s.id),
    items: planned.items,
    warnings: planned.warnings,
    totals: planned.totals,
  };

  const currentPlan = {
    order: scenes.map(s => s.id),
    items: current.items,
    warnings: current.warnings,
    totals: current.totals,
  };

  // ── 5. What changes, versus the ordering the user has now ──
  const currentIndex = new Map(currentPlan.order.map((id, i) => [id, i]));
  const sceneById = new Map(scenes.map(s => [s.id, s]));
  const plannedRows = planned.items.filter(i => i.kind === 'scene');
  const moves = plan.order.map((id, i) => {
    const from = currentIndex.has(id) ? currentIndex.get(id) : null;
    const scene = sceneById.get(id);
    const row = plannedRows[i];
    return {
      scene_id: id,
      title: (scene && scene.title) || `Scene ${i + 1}`,
      from_position: from == null ? null : from + 1,
      to_position: i + 1,
      moved: from !== i,
      start_label: row ? row.start_label : '',
      locked: row ? !!row.locked : false,
    };
  });

  const keyOf = w => `${w.type}:${w.scene_id || w.break_id || 'day'}`;
  const currentKeys = new Set(currentPlan.warnings.map(keyOf));
  const planKeys = new Set(plan.warnings.map(keyOf));
  // Anything the optimiser could not honour, called out by name.
  const unsatisfied = plan.warnings.filter(w =>
    w.type === 'locked_outside_window' || w.type === 'move_impossible' || w.type === 'break_overlap');

  const comparison = {
    moved_count: moves.filter(m => m.moved).length,
    moves,
    fixes: currentPlan.warnings.filter(w => !planKeys.has(keyOf(w))),
    introduces: plan.warnings.filter(w => !currentKeys.has(keyOf(w))),
    unsatisfied,
    current: {
      travel_km: currentPlan.totals.travel_km,
      travel_minutes: currentPlan.totals.travel_minutes,
      move_count: currentPlan.totals.move_count,
      on_set_minutes: currentPlan.totals.on_set_minutes,
      crew_call: currentPlan.totals.crew_call,
      end_label: currentPlan.totals.wrap,
      warning_count: currentPlan.warnings.length,
    },
    optimised: {
      travel_km: plan.totals.travel_km,
      travel_minutes: plan.totals.travel_minutes,
      move_count: plan.totals.move_count,
      on_set_minutes: plan.totals.on_set_minutes,
      crew_call: plan.totals.crew_call,
      end_label: plan.totals.wrap,
      warning_count: plan.warnings.length,
    },
    moves_saved: currentPlan.totals.move_count - plan.totals.move_count,
    move_minutes_saved: currentPlan.totals.travel_minutes - plan.totals.travel_minutes,
  };

  return { plan, current: currentPlan, comparison, matrixCache: table.cache };
}

// The leg function every non-optimising surface uses: local, synchronous,
// straight-line. Only "Organize this" ever reaches for Google.
function legLookupFor(locations) {
  const locById = new Map(locations.map(l => [l.id, l]));
  return legLookup('straight_line', null, locById);
}

module.exports = {
  organizeDay,
  legLookupFor,
  haversineKm,
  straightLineLeg,
  DEFAULT_DURATION_MIN,
};
