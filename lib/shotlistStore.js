// Shared reads for shot lists — used by the panel API, the public page route
// and both PDF exports so every surface sees the same rows in the same order.
//
// The hierarchy is DAY → SCENE → SHOT. A day owns its own date and times. A
// scene carries the location, the interior/exterior call and the light window.
// Shots are the coverage inside a scene. Company moves and breaks are placed
// into the day's timeline by lib/shotlistSchedule.js; they are never stored as
// ordering rows of their own.

const { db } = require('../db/database');
const { straightLineLeg, legLookupFor } = require('./shotlistOptimizer');
const {
  buildDayTimeline, sumTotals, clipSeconds, DEFAULT_CREW_CALL_OFFSET,
} = require('./shotlistSchedule');
const { MIN, fmtTime } = require('./sunWindows');

function getShotlistById(id) {
  return db.prepare('SELECT * FROM shotlists WHERE id = ?').get(id);
}

function getPublishedBySlug(slug) {
  return db.prepare("SELECT * FROM shotlists WHERE slug = ? AND status = 'published'").get(slug);
}

function getLocations(shotlistId) {
  return db.prepare(
    'SELECT * FROM shotlist_locations WHERE shotlist_id = ? ORDER BY id ASC'
  ).all(shotlistId);
}

// Every character carries its wardrobe, so nothing downstream has to remember
// to fetch it separately.
function withWardrobe(characters) {
  if (!characters.length) return characters;
  const stmt = db.prepare(
    'SELECT * FROM shotlist_character_media WHERE character_id = ? ORDER BY sort_order ASC, id ASC'
  );
  return characters.map(c => ({ ...c, wardrobe: stmt.all(c.id) }));
}

function getCharacters(shotlistId) {
  return withWardrobe(db.prepare(
    'SELECT * FROM shotlist_characters WHERE shotlist_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(shotlistId));
}

// Scout photos for a set of scenes: scene id → its photos, in order.
function getSceneMedia(sceneIds) {
  const map = new Map();
  if (!sceneIds.length) return map;
  const stmt = db.prepare(
    'SELECT * FROM shotlist_scene_media WHERE scene_id = ? ORDER BY sort_order ASC, id ASC'
  );
  sceneIds.forEach(id => { map.set(id, stmt.all(id)); });
  return map;
}

// How many shots each part appears in — what a casting agency quotes against.
function getShotCountsByCharacter(shotlistId) {
  const map = new Map();
  db.prepare(`
    SELECT sc.character_id AS id, COUNT(*) AS c
    FROM shot_characters sc
    JOIN shotlist_characters ch ON ch.id = sc.character_id
    WHERE ch.shotlist_id = ?
    GROUP BY sc.character_id
  `).all(shotlistId).forEach(r => map.set(r.id, r.c));
  return map;
}

function getDays(shotlistId) {
  return db.prepare(
    'SELECT * FROM shotlist_days WHERE shotlist_id = ? ORDER BY sort_order ASC, day_number ASC, id ASC'
  ).all(shotlistId);
}

function getBreaks(shotlistId) {
  return db.prepare(
    'SELECT * FROM shotlist_breaks WHERE shotlist_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(shotlistId);
}

// Both orderings always persist. order_mode only decides which one the public
// page and the PDFs present — it never rewrites the other.
function getScenes(shotlistId, orderMode) {
  const rows = db.prepare(
    'SELECT * FROM shotlist_scenes WHERE shotlist_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(shotlistId);

  if (orderMode !== 'optimized') return rows;

  const hasOptimised = rows.some(r => r.optimized_order != null);
  if (!hasOptimised) return rows;

  return rows.slice().sort((a, b) => {
    const ao = a.optimized_order == null ? Number.MAX_SAFE_INTEGER : a.optimized_order;
    const bo = b.optimized_order == null ? Number.MAX_SAFE_INTEGER : b.optimized_order;
    if (ao !== bo) return ao - bo;
    return a.sort_order - b.sort_order;
  });
}

function getShotsForScene(sceneId) {
  return db.prepare(
    'SELECT * FROM shots WHERE scene_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(sceneId);
}

function getMediaByShot(shotIds) {
  const map = new Map();
  if (!shotIds.length) return map;
  const stmt = db.prepare('SELECT * FROM shot_media WHERE shot_id = ? ORDER BY sort_order ASC, id ASC');
  shotIds.forEach(id => { map.set(id, stmt.all(id)); });
  return map;
}

// shot id → its characters, in the shot list's character order.
function getCharactersByShot(shotIds) {
  const map = new Map();
  if (!shotIds.length) return map;
  const stmt = db.prepare(`
    SELECT c.* FROM shot_characters sc
    JOIN shotlist_characters c ON c.id = sc.character_id
    WHERE sc.shot_id = ?
    ORDER BY c.sort_order ASC, c.id ASC
  `);
  shotIds.forEach(id => { map.set(id, withWardrobe(stmt.all(id))); });
  return map;
}

// A scene needs the union of its shots' characters: that is what tells you who
// is needed when.
function charactersForScene(shots, charactersByShot) {
  const seen = new Map();
  (shots || []).forEach(shot => {
    (charactersByShot.get(shot.id) || []).forEach(c => { if (!seen.has(c.id)) seen.set(c.id, c); });
  });
  return [...seen.values()];
}

function getActivity(shotlistId, limit = 100) {
  return db.prepare(
    'SELECT * FROM shot_activity WHERE shotlist_id = ? ORDER BY id DESC LIMIT ?'
  ).all(shotlistId, limit);
}

function logActivity(shotlistId, shotId, action, actorName) {
  db.prepare(
    'INSERT INTO shot_activity (shotlist_id, shot_id, action, actor_name) VALUES (?, ?, ?, ?)'
  ).run(shotlistId, shotId, action, actorName || null);
}

function touch(shotlistId) {
  db.prepare("UPDATE shotlists SET updated_at = datetime('now') WHERE id = ?").run(shotlistId);
}

// What each part is actually booked for: which days, where, and the personal
// call time. A performer is called ahead of THEIR first shot, not the unit's,
// so this walks the shots inside each scene rather than taking the scene start.
//
// Shots run in order inside a scene, each taking its own capture time, so the
// nth shot starts at the scene start plus the durations of the ones before it —
// the same arithmetic the scene duration is built from.
//
// The offset is the day's own crew_call_offset_minutes (30 by default), so the
// casting page, the crew page and the call sheet can never disagree about what
// "call time" means.
function castSchedule(bundle) {
  const { timelines, shotsByScene, charactersByShot, locationsById } = bundle;
  const byCharacter = new Map();

  timelines.forEach((timeline, dayIndex) => {
    const offset = Number(timeline.day.crew_call_offset_minutes);
    const callOffset = Number.isFinite(offset) ? offset : DEFAULT_CREW_CALL_OFFSET;

    // characterId → what that part does on THIS day
    const onThisDay = new Map();

    timeline.items.filter(i => i.kind === 'scene').forEach(item => {
      const shots = shotsByScene.get(item.scene_id) || [];
      let cursor = item.start_ms;

      shots.forEach(shot => {
        const start = cursor;
        const end = start + (Number(shot.duration_minutes) || 0) * MIN;
        cursor = end;

        (charactersByShot.get(shot.id) || []).forEach(c => {
          if (!onThisDay.has(c.id)) {
            onThisDay.set(c.id, { first_ms: start, last_ms: end, scenes: new Map(), locationIds: new Set() });
          }
          const entry = onThisDay.get(c.id);
          if (start < entry.first_ms) entry.first_ms = start;
          if (end > entry.last_ms) entry.last_ms = end;
          if (item.location_id != null) entry.locationIds.add(item.location_id);

          if (!entry.scenes.has(item.scene_id)) {
            entry.scenes.set(item.scene_id, {
              scene_number: item.scene_number,
              title: item.title,
              location_name: item.location_name || null,
              start_ms: start,
              shots: [],
            });
          }
          const sc = entry.scenes.get(item.scene_id);
          if (start < sc.start_ms) sc.start_ms = start;
          sc.shots.push({
            shot_number: shot.shot_number || String(sc.shots.length + 1),
            title: shot.title || '',
            start_label: fmtTime(start),
          });
        });
      });
    });

    onThisDay.forEach((entry, characterId) => {
      if (!byCharacter.has(characterId)) byCharacter.set(characterId, []);
      const callMs = entry.first_ms - callOffset * MIN;
      byCharacter.get(characterId).push({
        day_number: timeline.day.day_number || dayIndex + 1,
        shoot_date: timeline.day.shoot_date || null,
        call: fmtTime(callMs),
        call_offset_minutes: callOffset,
        first_shot: fmtTime(entry.first_ms),
        finish: fmtTime(entry.last_ms),
        locations: [...entry.locationIds]
          .map(lid => (locationsById.get(lid) || {}))
          .map(l => ({ name: l.name || null, address: l.address || null, lat: l.lat, lng: l.lng }))
          .filter(l => l.name),
        scenes: [...entry.scenes.values()]
          .sort((a, b) => a.start_ms - b.start_ms)
          .map(sc => ({
            scene_number: sc.scene_number,
            title: sc.title,
            location_name: sc.location_name,
            start_label: fmtTime(sc.start_ms),
            shots: sc.shots,
          })),
      });
    });
  });

  return byCharacter;
}

// Every rendering surface builds on this: days in order, each with its scenes,
// their shots, and the timed timeline (scenes + company moves + breaks) for
// that day. The distance mode is the local straight-line one — no surface
// renders on a network call.
function loadBundle(shotlist) {
  const locations = getLocations(shotlist.id);
  const characters = getCharacters(shotlist.id);
  const allScenes = getScenes(shotlist.id, shotlist.order_mode);
  const allBreaks = getBreaks(shotlist.id);
  const days = getDays(shotlist.id);

  const shotsByScene = new Map(allScenes.map(s => [s.id, getShotsForScene(s.id)]));
  const shots = allScenes.flatMap(s => shotsByScene.get(s.id) || []);
  const media = getMediaByShot(shots.map(s => s.id));
  const sceneMedia = getSceneMedia(allScenes.map(s => s.id));
  const charactersByShot = getCharactersByShot(shots.map(s => s.id));

  const scenesById = new Map(allScenes.map(s => [s.id, s]));
  const shotsById = new Map(shots.map(s => [s.id, s]));
  const locationsById = new Map(locations.map(l => [l.id, l]));
  const charactersById = new Map(characters.map(c => [c.id, c]));

  const leg = legLookupFor(locations);

  // Scenes with no day (a list mid-upgrade) hang off the first day so nothing
  // silently disappears from the schedule.
  const dayList = days.length ? days : [{
    id: null, shotlist_id: shotlist.id, day_number: 1,
    shoot_date: shotlist.shoot_date, crew_call: shotlist.call_time,
    crew_call_offset_minutes: 30, sort_order: 0,
  }];

  const timelines = dayList.map((day, i) => {
    const dayScenes = allScenes.filter(s => (
      day.id == null ? true : (s.day_id === day.id || (s.day_id == null && i === 0))
    ));
    const dayBreaks = allBreaks.filter(b => (
      day.id == null ? true : (b.day_id === day.id || (b.day_id == null && i === 0))
    ));
    const timeline = buildDayTimeline(shotlist, day, dayScenes, shotsByScene, dayBreaks, locations, leg);
    return {
      day,
      scenes: dayScenes,
      breaks: dayBreaks,
      items: timeline.items,
      totals: timeline.totals,
      warnings: timeline.warnings,
      scheduled: timeline.scheduled,
      shoot_date: timeline.shoot_date,
    };
  });

  return {
    shotlist,
    days: dayList,
    timelines,
    totals: sumTotals(timelines.map(t => t.totals)),
    scenes: allScenes,
    scenesById,
    shotsByScene,
    shots,
    shotsById,
    sceneMedia,
    locations,
    locationsById,
    characters,
    charactersById,
    charactersByShot,
    breaks: allBreaks,
    media,
  };
}

function orderLabelFor(shotlist) {
  return shotlist.order_mode === 'optimized' ? 'Optimised order' : 'My order';
}

module.exports = {
  getShotlistById,
  getPublishedBySlug,
  getLocations,
  getCharacters,
  getSceneMedia,
  getShotCountsByCharacter,
  castSchedule,
  getDays,
  getBreaks,
  getScenes,
  getShotsForScene,
  getMediaByShot,
  getCharactersByShot,
  charactersForScene,
  getActivity,
  logActivity,
  touch,
  loadBundle,
  clipSeconds,
  orderLabelFor,
};
