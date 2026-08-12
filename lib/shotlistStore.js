// Shared reads for shot lists — used by the panel API, the public page route
// and both PDF exports so every surface sees the same rows in the same order.

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
function getShots(shotlistId, orderMode) {
  const rows = db.prepare(
    'SELECT * FROM shots WHERE shotlist_id = ? ORDER BY sort_order ASC, id ASC'
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

// Everything a rendering surface needs: the shot list, its shots in the
// selected ordering, its locations, its media, and the timed schedule computed
// locally (no network) from each shot's own coordinates.
function loadBundle(shotlist) {
  const locations = getLocations(shotlist.id);
  const shots = getShots(shotlist.id, shotlist.order_mode);
  const media = getMediaByShot(shots.map(s => s.id));
  const schedule = scheduleSequence(shotlist, shots, locations);

  const shotsById = new Map(shots.map(s => [s.id, s]));
  const locationsById = new Map(locations.map(l => [l.id, l]));

  // A shot list with no shoot date still renders — it just carries no clock.
  const rows = schedule.rows.length
    ? schedule.rows
    : shots.map(s => ({
      shot_id: s.id,
      location_id: s.location_id,
      duration_minutes: s.duration_minutes,
      start_label: '',
      end_label: '',
      light_window_label: '',
      light_window_range: '',
      light_window_hard: false,
    }));

  return { shotlist, shots, shotsById, locations, locationsById, media, rows, schedule };
}

function orderLabelFor(shotlist) {
  return shotlist.order_mode === 'optimized' ? 'Optimised order' : 'My order';
}

module.exports = {
  getShotlistById,
  getPublishedBySlug,
  getLocations,
  getShots,
  getMediaByShot,
  getActivity,
  logActivity,
  touch,
  loadBundle,
  orderLabelFor,
};
