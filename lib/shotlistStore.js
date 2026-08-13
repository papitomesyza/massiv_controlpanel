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
const { buildDayTimeline, sumTotals, clipSeconds } = require('./shotlistSchedule');

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
