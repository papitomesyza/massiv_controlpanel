// The day timeline: what actually happens, in order, with a clock against it.
//
// A day is a sequence of SCENES with COMPANY MOVES generated between any two
// consecutive scenes at different locations, and BREAKS sitting wherever the
// user placed them. Nothing here is stored: the timeline is rebuilt from the
// scenes, their locations and the breaks every time anything changes, so a
// reorder or a location edit recomputes it immediately.
//
// Constraint priority, highest first:
//   1. locked scene/shot times and fixed-time breaks — immovable
//   2. light windows
//   3. everything else flows from the running order
//
// Crew call is derived, never stored as truth: it is the day's offset (30 min
// by default) before the first shot call.

const { MIN, resolveWindow, localToUtcMs, fmtTime, windowLabel } = require('./sunWindows');

const DEFAULT_SCENE_MINUTES = 30;     // a scene with no shots still needs a slot
const DEFAULT_WRAP_MINUTES = 20;
const DEFAULT_SETUP_MINUTES = 25;
const DEFAULT_CREW_CALL_OFFSET = 30;  // crew call is this long before first shot call
const DAY_END_HOUR = 22;              // a day running past this earns a warning
const MEAL_GAP_HOURS = 6;             // crews start losing goodwill past this

const BREAK_KINDS = ['breakfast', 'lunch', 'dinner', 'break'];
const MEAL_KINDS = ['breakfast', 'lunch', 'dinner'];

// Which side of the company move a break falls on.
const BREAK_PLACEMENTS = ['before_move', 'after_move'];
const DEFAULT_BREAK_PLACEMENT = 'after_move';

// A break at or past the end of the scene list is an end-of-day break. Storing
// a sentinel rather than the current scene count keeps it at the end when a
// scene is added afterwards, instead of silently becoming "before the new last
// scene".
const END_OF_DAY_ORDER = 999;

function sceneDuration(shots) {
  const total = (shots || []).reduce((sum, s) => {
    const n = Number(s.duration_minutes);
    return sum + (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  }, 0);
  return total > 0 ? total : DEFAULT_SCENE_MINUTES;
}

function clipSeconds(shots) {
  return (shots || []).reduce((sum, s) => {
    const n = Number(s.clip_length_seconds);
    return sum + (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  }, 0);
}

function breakMinutes(row) {
  const n = Number(row && row.duration_minutes);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 30;
}

// The wrap/setup either side of a move: the shot list's defaults unless the
// destination scene carries an override, which sticks until it is cleared.
function moveParts(shotlist, toScene) {
  const listWrap = Number.isFinite(Number(shotlist.move_wrap_minutes))
    ? Number(shotlist.move_wrap_minutes) : DEFAULT_WRAP_MINUTES;
  const listSetup = Number.isFinite(Number(shotlist.move_setup_minutes))
    ? Number(shotlist.move_setup_minutes) : DEFAULT_SETUP_MINUTES;
  const wrapOverride = toScene && toScene.move_wrap_minutes;
  const setupOverride = toScene && toScene.move_setup_minutes;
  const travelOverride = toScene && toScene.move_travel_minutes;
  const set = v => v !== null && v !== undefined && Number.isFinite(Number(v));
  return {
    wrap: set(wrapOverride) ? Number(wrapOverride) : listWrap,
    setup: set(setupOverride) ? Number(setupOverride) : listSetup,
    // null means "use the distance"; a number replaces it outright.
    travel: set(travelOverride) ? Number(travelOverride) : null,
    travelOverridden: set(travelOverride),
    overridden: set(wrapOverride) || set(setupOverride) || set(travelOverride),
  };
}

// A locked time on the scene, or the earliest lock among its shots.
function lockFor(scene, shots) {
  if (scene && scene.locked_start_time) return { time: scene.locked_start_time, source: 'scene' };
  const locked = (shots || []).filter(s => s.locked_start_time).sort(
    (a, b) => String(a.locked_start_time).localeCompare(String(b.locked_start_time))
  );
  return locked.length ? { time: locked[0].locked_start_time, source: 'shot' } : null;
}

// ── Timeline ─────────────────────────────────────────────────────────────────

// day: shotlist_days row; scenes: that day's scenes in the chosen order
// breaks: that day's breaks, in their placed order
// leg(fromLocationId, toLocationId) → { km, minutes }
function buildDayTimeline(shotlist, day, scenes, shotsByScene, breaks, locations, leg, opts = {}) {
  const shootDate = (day && day.shoot_date) || shotlist.shoot_date;
  const items = [];
  const warnings = [];

  const locById = new Map(locations.map(l => [l.id, l]));
  const windowByScene = new Map();
  scenes.forEach(scene => {
    const loc = locById.get(scene.location_id);
    const win = resolveWindow(scene.light_window, shootDate, loc ? loc.lat : null, loc ? loc.lng : null);
    if (win) windowByScene.set(scene.id, win);
  });

  if (!shootDate) {
    // No date yet: the day still lists in order, it just carries no clock.
    scenes.forEach((scene, i) => items.push(decorateScene(scene, i, null, null, 0, 0)));
    return { items, totals: emptyTotals(), warnings, scheduled: false, shoot_date: null, windowByScene };
  }

  const dayStartMs = localToUtcMs(shootDate, '00:00');
  const dayEndMs = localToUtcMs(shootDate, `${String(DAY_END_HOUR).padStart(2, '0')}:00`);
  const lockedMs = timeStr => (timeStr ? localToUtcMs(shootDate, timeStr) : null);

  const storedCall = day && day.crew_call ? lockedMs(day.crew_call) : null;
  const offset = Number.isFinite(Number(day && day.crew_call_offset_minutes))
    ? Number(day.crew_call_offset_minutes) : DEFAULT_CREW_CALL_OFFSET;

  // The day opens at the stored crew call plus its offset (that is the first
  // shot call), or 08:00. A lock anchors ITS OWN scene — it never drags the
  // start of the day — unless it falls even earlier, in which case the day
  // simply has to begin then.
  const earliestLock = scenes
    .map(sc => lockFor(sc, shotsByScene.get(sc.id)))
    .filter(Boolean)
    .map(l => lockedMs(l.time))
    .filter(v => v != null)
    .sort((a, b) => a - b)[0];

  let cursor = storedCall != null ? storedCall + offset * MIN : localToUtcMs(shootDate, '08:00');
  if (earliestLock != null && earliestLock < cursor) cursor = earliestLock;

  // A fixed-time break is immovable: scenes work around it rather than
  // shooting through lunch.
  const fixedBreaks = breaks
    .filter(b => b.start_time && lockedMs(b.start_time) != null)
    .map(b => {
      const start = lockedMs(b.start_time);
      return { start, end: start + breakMinutes(b) * MIN };
    })
    .sort((a, b) => a.start - b.start);

  // Shifts a start time forward until the block no longer runs through a
  // fixed break. Locked scenes skip this: their lock outranks everything.
  function clearOfFixedBreaks(start, durationMs) {
    let s0 = start;
    let moved = true;
    let guard = 0;
    while (moved && guard < 12) {
      moved = false;
      guard++;
      for (const fb of fixedBreaks) {
        if (s0 < fb.end && s0 + durationMs > fb.start) { s0 = fb.end; moved = true; }
      }
    }
    return s0;
  }

  // Breaks are keyed to the scene they sit before, so they travel with the
  // running order. sort_order n means "at the nth scene"; anything at or past
  // the end of the list is an end-of-day break, which is how a wrap meal is
  // expressed — and it stays at the end when scenes are added afterwards.
  const breaksBefore = new Map();
  breaks.forEach(b => {
    const idx = Math.max(0, Math.min(scenes.length, Number(b.sort_order) || 0));
    if (!breaksBefore.has(idx)) breaksBefore.set(idx, []);
    breaksBefore.get(idx).push(b);
  });

  let currentLoc = null;
  let lastSceneEnd = null;

  // Which side of the company move a break falls on. Rows written before sides
  // existed read as after_move, the same as the backfill.
  function placementOf(b) {
    return b && b.placement === 'before_move' ? 'before_move' : 'after_move';
  }

  // Emits one set of breaks and advances the cursor past them. `where` carries
  // the location the crew is at while eating, so the crew page and the PDFs can
  // say where the meal is.
  function emitBreaks(list, where) {
    (list || []).forEach(b => {
      const minutes = breakMinutes(b);
      const fixed = b.start_time ? lockedMs(b.start_time) : null;
      // A fixed break sits at its own time; a floating one takes its place in
      // the running order, wherever the day has got to.
      const start = fixed != null ? fixed : cursor;
      const end = start + minutes * MIN;
      const loc = where && where.location_id != null ? locById.get(where.location_id) : null;
      items.push({
        kind: 'break',
        break_id: b.id,
        break_kind: BREAK_KINDS.includes(b.kind) ? b.kind : 'break',
        label: b.label || defaultBreakLabel(b.kind),
        notes: b.notes || null,
        fixed: fixed != null,
        locked: fixed != null,
        placement: placementOf(b),
        // Only meaningful where a move actually exists; otherwise the break
        // simply sits before its scene and the side means nothing.
        placement_applies: !!(where && where.has_move),
        end_of_day: !!(where && where.end_of_day),
        location_id: loc ? loc.id : null,
        location_name: loc ? loc.name : null,
        start_ms: start,
        end_ms: end,
        start_label: fmtTime(start),
        end_label: fmtTime(end),
        duration_minutes: minutes,
      });
      if (fixed != null && fixed + minutes * MIN < cursor) {
        warnings.push({
          type: 'break_overlap',
          day_id: day ? day.id : null,
          break_id: b.id,
          message: `${b.label || defaultBreakLabel(b.kind)} is fixed at ${fmtTime(fixed)} but the day has already reached ${fmtTime(cursor)}.`,
        });
      }
      cursor = Math.max(end, cursor);
    });
  }

  scenes.forEach((scene, index) => {
    const atThisScene = breaksBefore.get(index) || [];

    const shots = shotsByScene.get(scene.id) || [];
    const lock = lockFor(scene, shots);
    const lockMs = lock ? lockedMs(lock.time) : null;
    const win = windowByScene.get(scene.id);

    // A company move whenever the location actually changes.
    let move = null;
    if (currentLoc != null && scene.location_id != null && scene.location_id !== currentLoc) {
      const parts = moveParts(shotlist, scene);
      const travel = leg(currentLoc, scene.location_id);
      // A typed travel time wins over the distance estimate — the pins do not
      // know about a mountain road or rush hour.
      const travelMinutes = parts.travel != null ? parts.travel : travel.minutes;
      const total = parts.wrap + travelMinutes + parts.setup;
      const from = locById.get(currentLoc);
      const to = locById.get(scene.location_id);
      move = {
        kind: 'move',
        from_location_id: currentLoc,
        to_location_id: scene.location_id,
        from_name: from ? from.name : '',
        to_name: to ? to.name : '',
        to_lat: to ? to.lat : null,
        to_lng: to ? to.lng : null,
        wrap_minutes: parts.wrap,
        travel_minutes: travelMinutes,
        travel_computed_minutes: travel.minutes,
        travel_overridden: parts.travelOverridden,
        travel_km: travel.km,
        setup_minutes: parts.setup,
        duration_minutes: total,
        overridden: parts.overridden,
        scene_id: scene.id,           // the move INTO this scene, for overrides
      };
    }

    // With no move the two sides are the same thing, so everything here simply
    // sits before the scene exactly as it always did.
    const beforeMove = move ? atThisScene.filter(b => placementOf(b) === 'before_move') : atThisScene;
    const afterMove = move ? atThisScene.filter(b => placementOf(b) !== 'before_move') : [];

    // ── 1. Eat at the location the crew is already at, before the wrap ──
    const wrapBeganAt = cursor;
    emitBreaks(beforeMove, { location_id: currentLoc, has_move: !!move });
    if (move) {
      beforeMove.forEach(b => {
        const fixed = b.start_time ? lockedMs(b.start_time) : null;
        if (fixed != null && fixed > wrapBeganAt) {
          warnings.push({
            type: 'break_after_wrap',
            day_id: day ? day.id : null,
            break_id: b.id,
            message: `${b.label || defaultBreakLabel(b.kind)} is set before the move at ${fmtTime(fixed)}, but the crew wraps ${move.from_name || 'the previous location'} at ${fmtTime(wrapBeganAt)} — it would be eaten after the wrap has already begun.`,
          });
        }
      });
    }

    // ── 2. Wrap, travel, set up ──
    // A move leaves as soon as the previous scene ends unless it is pinned to a
    // departure time. Pinning is what a split call needs: a dawn drone shot
    // finishes at 06:00 with two people on it, and the company does not travel
    // until the rest of the unit is called.
    if (move) {
      const moveLockMs = scene.move_locked_start_time ? lockedMs(scene.move_locked_start_time) : null;
      move.locked = moveLockMs != null;
      move.locked_time = moveLockMs != null ? scene.move_locked_start_time : null;

      if (moveLockMs != null && moveLockMs < cursor) {
        warnings.push({
          type: 'move_lock_impossible',
          day_id: day ? day.id : null,
          scene_id: scene.id,
          message: `The company move to ${move.to_name || 'the next location'} is set to leave at ${fmtTime(moveLockMs)}, but the unit is not free until ${fmtTime(cursor)}.`,
        });
      }

      move.start_ms = moveLockMs != null ? Math.max(moveLockMs, cursor) : cursor;
      move.end_ms = move.start_ms + move.duration_minutes * MIN;
      move.start_label = fmtTime(move.start_ms);
      move.end_label = fmtTime(move.end_ms);
      // A pinned departure leaves the unit standing between the two, which is
      // exactly the gap the split call is there to describe.
      move.hold_minutes = Math.round((move.start_ms - cursor) / MIN);
      items.push(move);
      cursor = move.end_ms;
    }

    // ── 3. Eat at the new location, after arriving and before the first shot ──
    const arrival = cursor;
    emitBreaks(afterMove, { location_id: scene.location_id, has_move: !!move });
    afterMove.forEach(b => {
      const fixed = b.start_time ? lockedMs(b.start_time) : null;
      if (fixed != null && fixed < arrival) {
        warnings.push({
          type: 'break_before_arrival',
          day_id: day ? day.id : null,
          break_id: b.id,
          message: `${b.label || defaultBreakLabel(b.kind)} is fixed at ${fmtTime(fixed)} at ${move.to_name || 'the new location'}, but the company move means the crew cannot arrive before ${fmtTime(arrival)}.`,
        });
      }
    });

    // ── 4. The scene, once the move and both sets of breaks have passed ──
    const durationMs = sceneDuration(shots) * MIN;
    let start = cursor;
    if (lockMs == null) start = clearOfFixedBreaks(start, durationMs);

    if (lockMs != null) {
      // A locked time is immovable. If the move cannot fit before it, say so
      // rather than quietly sliding the lock.
      if (move && arrival > lockMs) {
        warnings.push({
          type: 'move_impossible',
          day_id: day ? day.id : null,
          scene_id: scene.id,
          message: `${sceneName(scene, index)} is locked to ${fmtTime(lockMs)} but the company move from ${move.from_name || 'the previous location'} needs ${move.duration_minutes} min and cannot arrive before ${fmtTime(arrival)}.`,
        });
      }
      start = lockMs;
    } else if (win && win.hard && start < win.from) {
      // Wait for a hard light window rather than shooting outside it.
      start = clearOfFixedBreaks(win.from, durationMs);
    }

    const duration = sceneDuration(shots);
    const end = start + duration * MIN;
    items.push(decorateScene(scene, index, start, end, duration, shots.length, {
      lock, win, location: locById.get(scene.location_id), shots,
    }));

    // A lock outranks the light window, so the mismatch is a warning, not a move.
    if (win && win.key !== 'any_time' && (start < win.from || end > win.to)) {
      warnings.push({
        type: lockMs != null ? 'locked_outside_window' : (win.hard ? 'window_missed' : 'window_soft_miss'),
        day_id: day ? day.id : null,
        scene_id: scene.id,
        message: lockMs != null
          ? `${sceneName(scene, index)} is locked to ${fmtTime(start)}, outside its ${windowLabel(win.key)} window (${win.range_label}) — the light will not match.`
          : `${sceneName(scene, index)} is scheduled ${fmtTime(start)}–${fmtTime(end)} but its ${windowLabel(win.key)} window is ${win.range_label}.`,
      });
    }

    cursor = end;
    lastSceneEnd = end;
    if (scene.location_id != null) currentLoc = scene.location_id;
  });

  // A wrap meal or a dinner after the last scene of the day. It is eaten where
  // the day finished, and it counts towards the wrap and the on-set hours like
  // anything else on the clock.
  emitBreaks(breaksBefore.get(scenes.length) || [], {
    location_id: currentLoc, has_move: false, end_of_day: true,
  });

  // A fixed break can be placed out of running order, so the timeline is
  // sorted by the clock — that is the order the day actually happens in.
  items.sort((a, b) => (a.start_ms || 0) - (b.start_ms || 0));

  // ── Derived times ──
  const sceneItems = items.filter(i => i.kind === 'scene');
  const firstShotCall = sceneItems.length ? sceneItems[0].start_ms : null;
  const crewCallMs = firstShotCall != null ? firstShotCall - offset * MIN : null;
  const wrapMs = items.length ? Math.max(...items.map(i => i.end_ms || 0)) : null;

  // A long day with no meal in it.
  if (crewCallMs != null && wrapMs != null) {
    const meals = items.filter(i => i.kind === 'break' && MEAL_KINDS.includes(i.break_kind));
    const dayHours = (wrapMs - crewCallMs) / 3600000;
    if (dayHours > MEAL_GAP_HOURS && meals.length === 0) {
      warnings.push({
        type: 'no_meal',
        day_id: day ? day.id : null,
        message: `This day runs ${dayHours.toFixed(1)} hours from crew call with no meal break scheduled.`,
      });
    } else if (meals.length) {
      const firstMeal = Math.min(...meals.map(m => m.start_ms));
      const gap = (firstMeal - crewCallMs) / 3600000;
      // A meal exists but lands too late — a different problem from having
      // none at all, so it carries its own type rather than being mistaken
      // for an unfed day.
      if (gap > MEAL_GAP_HOURS) {
        warnings.push({
          type: 'late_meal',
          day_id: day ? day.id : null,
          message: `The first meal is ${gap.toFixed(1)} hours after crew call.`,
        });
      }
    }
  }

  if (wrapMs != null && dayEndMs && wrapMs > dayEndMs) {
    warnings.push({
      type: 'long_day',
      day_id: day ? day.id : null,
      message: `The day wraps at ${fmtTime(wrapMs)}, past ${fmtTime(dayEndMs)}.`,
    });
  }

  const totals = {
    crew_call_ms: crewCallMs,
    crew_call: crewCallMs != null ? fmtTime(crewCallMs) : null,
    crew_call_offset_minutes: offset,
    first_shot_call_ms: firstShotCall,
    first_shot_call: firstShotCall != null ? fmtTime(firstShotCall) : null,
    wrap_ms: wrapMs,
    wrap: wrapMs != null ? fmtTime(wrapMs) : null,
    on_set_minutes: crewCallMs != null && wrapMs != null ? Math.round((wrapMs - crewCallMs) / MIN) : 0,
    shooting_minutes: sceneItems.reduce((n, i) => n + (i.duration_minutes || 0), 0),
    travel_minutes: items.filter(i => i.kind === 'move').reduce((n, i) => n + (i.duration_minutes || 0), 0),
    travel_km: Math.round(items.filter(i => i.kind === 'move').reduce((n, i) => n + (i.travel_km || 0), 0) * 10) / 10,
    break_minutes: items.filter(i => i.kind === 'break').reduce((n, i) => n + (i.duration_minutes || 0), 0),
    move_count: items.filter(i => i.kind === 'move').length,
    scene_count: sceneItems.length,
    shot_count: sceneItems.reduce((n, i) => n + (i.shot_count || 0), 0),
    clip_seconds: scenes.reduce((n, s) => n + clipSeconds(shotsByScene.get(s.id)), 0),
    locked_count: items.filter(i => i.locked).length,
  };

  return { items, totals, warnings, scheduled: true, shoot_date: shootDate, windowByScene, day_start_ms: dayStartMs };
}

function decorateScene(scene, index, start, end, duration, shotCount, extra = {}) {
  const win = extra.win;
  const lock = extra.lock;
  const loc = extra.location;
  return {
    kind: 'scene',
    scene_id: scene.id,
    location_id: scene.location_id == null ? null : scene.location_id,
    title: scene.title || '',
    scene_number: scene.scene_number || String(index + 1),
    space: scene.space || 'exterior',
    set_design: scene.set_design || null,
    start_ms: start,
    end_ms: end,
    start_label: start != null ? fmtTime(start) : '',
    end_label: end != null ? fmtTime(end) : '',
    duration_minutes: duration,
    shot_count: shotCount,
    clip_seconds: clipSeconds(extra.shots),
    locked: !!lock,
    locked_source: lock ? lock.source : null,
    locked_time: lock ? lock.time : null,
    light_window: scene.light_window || null,
    light_window_label: win ? win.label : '',
    light_window_range: win ? win.range_label : '',
    light_window_hard: win ? win.hard : false,
    location_name: loc ? loc.name : null,
    location_address: loc ? loc.address : null,
    location_lat: loc ? loc.lat : null,
    location_lng: loc ? loc.lng : null,
  };
}

function sceneName(scene, idx) {
  if (!scene) return `Scene ${idx + 1}`;
  return scene.title || `Scene ${scene.scene_number || idx + 1}`;
}

function defaultBreakLabel(kind) {
  if (kind === 'breakfast') return 'Breakfast';
  if (kind === 'lunch') return 'Lunch';
  if (kind === 'dinner') return 'Dinner';
  return 'Break';
}

function emptyTotals() {
  return {
    crew_call: null, crew_call_ms: null, crew_call_offset_minutes: DEFAULT_CREW_CALL_OFFSET,
    first_shot_call: null, first_shot_call_ms: null, wrap: null, wrap_ms: null,
    on_set_minutes: 0, shooting_minutes: 0, travel_minutes: 0, travel_km: 0,
    break_minutes: 0, move_count: 0, scene_count: 0, shot_count: 0, clip_seconds: 0,
    locked_count: 0,
  };
}

// Every day's totals rolled into one, for the whole shot list.
function sumTotals(dayTotals) {
  const out = emptyTotals();
  dayTotals.forEach(t => {
    ['on_set_minutes', 'shooting_minutes', 'travel_minutes', 'break_minutes',
      'move_count', 'scene_count', 'shot_count', 'clip_seconds', 'locked_count'].forEach(k => {
      out[k] += t[k] || 0;
    });
    out.travel_km = Math.round((out.travel_km + (t.travel_km || 0)) * 10) / 10;
  });
  return out;
}

// "6h 45m" — how a call sheet writes a duration.
function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

// "2:05" — clip seconds as a running time.
function fmtClip(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m ? `${m}:${String(rest).padStart(2, '0')}` : `${rest}s`;
}

// "30–40", "40+", "under 12", "35" — the age a role is cast for, written the
// same way on the panel, the crew page and the PDFs. Either end may be
// missing, and one age on its own is not a range.
function fmtAgeRange(min, max) {
  const lo = min == null || min === '' ? null : Number(min);
  const hi = max == null || max === '' ? null : Number(max);
  if (lo == null && hi == null) return '';
  if (lo != null && hi == null) return `${lo}+`;
  if (lo == null && hi != null) return `under ${hi}`;
  if (lo === hi) return String(lo);
  return `${lo}–${hi}`;
}

module.exports = {
  buildDayTimeline,
  sceneDuration,
  clipSeconds,
  moveParts,
  lockFor,
  sumTotals,
  emptyTotals,
  fmtDuration,
  fmtClip,
  fmtAgeRange,
  defaultBreakLabel,
  BREAK_KINDS,
  MEAL_KINDS,
  BREAK_PLACEMENTS,
  DEFAULT_BREAK_PLACEMENT,
  END_OF_DAY_ORDER,
  DEFAULT_WRAP_MINUTES,
  DEFAULT_SETUP_MINUTES,
  DEFAULT_CREW_CALL_OFFSET,
  DAY_END_HOUR,
  MEAL_GAP_HOURS,
};
