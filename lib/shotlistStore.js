// Shared reads for shot lists — used by the panel API, the public page route
// and both PDF exports so every surface sees the same rows in the same order.
//
// The unit of the day is the SCENE: it carries the location, the interior or
// exterior call and the light window, and the day is ordered and timed scene by
// scene. Shots are the coverage inside a scene and inherit all three.

const { db } = require('../db/database');
const { scheduleSequence } = require('./shotlistOptimizer');

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

// Every shot on the list, in scene order then shot order — the reading order of
// the whole day.
function getShotsInSceneOrder(scenes) {
  const out = [];
  scenes.forEach(scene => {
    getShotsForScene(scene.id).forEach(shot => out.push(shot));
  });
  return out;
}

function getMediaByShot(shotIds) {
  const map = new Map();
  if (!shotIds.length) return map;
  const stmt = db.prepare('SELECT * FROM shot_media WHERE shot_id = ? ORDER BY sort_order ASC, id ASC');
  shotIds.forEach(id => { map.set(id, stmt.all(id)); });
  return map;
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

// Everything a rendering surface needs: the shot list, its scenes in the
// selected ordering with their shots attached, its locations, its media, and
// the timed schedule computed locally (no network) from each scene's own
// coordinates.
function loadBundle(shotlist) {
  const locations = getLocations(shotlist.id);
  const scenes = getScenes(shotlist.id, shotlist.order_mode);
  const shotsByScene = new Map(scenes.map(s => [s.id, getShotsForScene(s.id)]));
  const shots = scenes.flatMap(s => shotsByScene.get(s.id) || []);
  const media = getMediaByShot(shots.map(s => s.id));
  const schedule = scheduleSequence(shotlist, scenes, shotsByScene, locations);

  const scenesById = new Map(scenes.map(s => [s.id, s]));
  const shotsById = new Map(shots.map(s => [s.id, s]));
  const locationsById = new Map(locations.map(l => [l.id, l]));

  // A shot list with no shoot date still renders — it just carries no clock.
  const rows = schedule.rows.length
    ? schedule.rows
    : scenes.map(s => ({
      scene_id: s.id,
      location_id: s.location_id,
      duration_minutes: sceneDuration(shotsByScene.get(s.id) || []),
      shot_count: (shotsByScene.get(s.id) || []).length,
      start_label: '',
      end_label: '',
      light_window_label: '',
      light_window_range: '',
      light_window_hard: false,
    }));

  return {
    shotlist, scenes, scenesById, shotsByScene, shots, shotsById,
    locations, locationsById, media, rows, schedule,
  };
}

// A scene lasts as long as its shots take. An empty scene still needs a slot.
function sceneDuration(shots) {
  const total = shots.reduce((sum, s) => {
    const n = Number(s.duration_minutes);
    return sum + (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  }, 0);
  return total > 0 ? total : 30;
}

function orderLabelFor(shotlist) {
  return shotlist.order_mode === 'optimized' ? 'Optimised order' : 'My order';
}

module.exports = {
  getShotlistById,
  getPublishedBySlug,
  getLocations,
  getScenes,
  getShotsForScene,
  getShotsInSceneOrder,
  getMediaByShot,
  getActivity,
  logActivity,
  touch,
  loadBundle,
  sceneDuration,
  orderLabelFor,
};
