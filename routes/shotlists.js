const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { db } = require('../db/database');
const { imageUploadOptions, storeImage } = require('../lib/mediaStore');
const { publicPitchBase } = require('../lib/pitchDomain');
const { organize } = require('../lib/shotlistOptimizer');
const {
  windowsForSpace, solarSummary, resolveWindow, WINDOW_DEFS, parseTimeParts,
} = require('../lib/sunWindows');
const { hashPasscode } = require('../lib/shotlistAuth');
const {
  getShotlistById, getLocations, getScenes, getShotsForScene, getMediaByShot,
  getActivity, logActivity, touch, loadBundle, sceneDuration, orderLabelFor,
} = require('../lib/shotlistStore');
const { callSheetPdf, photoBoardPdf } = require('../lib/shotlistPdf');

// This app has no global error handler: every handler owns its own try/catch.

function getMediaDir() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'shotlist-media');
}

function getAgency() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('agency_name', 'agency_logo')").all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  return { name: map.agency_name || null, logo: map.agency_logo || null };
}

const SPACES = ['interior', 'exterior'];
const STATUSES = ['pending', 'completed'];

function cleanDate(v) {
  if (v === null || v === undefined || v === '') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
}

function cleanTime(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = parseTimeParts(v);
  if (!t) return null;
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

function cleanText(v, max = 4000) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function cleanCoord(v, limit) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return n;
}

// A window must exist and must belong to the space the shot declares.
function cleanWindow(space, key) {
  const allowed = windowsForSpace(space);
  if (key && allowed.includes(key)) return key;
  return space === 'interior' ? 'any_time' : 'daylight';
}

function generateSlug(title, excludeId) {
  const base = String(title || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'shotlist';
  let slug = base;
  let n = 2;
  const exists = db.prepare('SELECT id FROM shotlists WHERE slug = ? AND id != ?');
  while (exists.get(slug, excludeId)) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

// Never leaks passcode_hash to the client.
function publicShape(row) {
  if (!row) return row;
  const { passcode_hash, ...rest } = row;
  return { ...rest, has_passcode: !!passcode_hash };
}

function readPlan(shotlist) {
  try {
    const parsed = JSON.parse(shotlist.plan_json || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

// ── Static paths first, so they are never read as an :id ─────────────────────

// The client-facing base for public shot list links — same source of truth the
// pitch links use, so a configured public domain is honoured here too.
router.get('/public-base', (req, res) => {
  try {
    res.json(publicPitchBase(req));
  } catch (_) {
    const host = req.get('host') || '';
    res.json({ base: `${req.protocol}://${host}`, host, custom: false });
  }
});

// The light window catalogue, so the panel selectors and the server agree.
router.get('/light-windows', (req, res) => {
  try {
    const shape = key => ({ key, label: WINDOW_DEFS[key].label, hard: WINDOW_DEFS[key].hard });
    res.json({
      interior: windowsForSpace('interior').map(shape),
      exterior: windowsForSpace('exterior').map(shape),
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load light windows' });
  }
});

// Place search for the location picker — OpenStreetMap's Nominatim, proxied
// through the server so the request carries a proper identifying User-Agent
// (a browser cannot set one) and the panel never talks to a third party
// directly. The client debounces; a failure here tells the user to pin
// manually rather than failing silently.
router.get('/geocode', async (req, res) => {
  try {
    const q = String((req.query && req.query.q) || '').trim();
    if (q.length < 3) return res.json([]);

    const url = 'https://nominatim.openstreetmap.org/search'
      + `?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let upstream;
    try {
      upstream = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MASSIV-TV Control Panel (shot list location picker)',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) return res.status(502).json({ error: 'search_unavailable' });
    const data = await upstream.json();
    if (!Array.isArray(data)) return res.status(502).json({ error: 'search_unavailable' });

    res.json(data.map(r => ({
      id: r.place_id,
      name: r.name || String(r.display_name || '').split(',')[0] || '',
      display_name: r.display_name || '',
      lat: Number(r.lat),
      lng: Number(r.lon),
    })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng)));
  } catch (err) {
    res.status(502).json({ error: 'search_unavailable' });
  }
});

// Shot media upload — images only, 25MB, web + thumb generated, original
// discarded. Identical rules to the pitch uploader, shared helper, own folder.
const upload = multer(imageUploadOptions());

router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Image file required (jpeg, png or webp, max 25MB)' });
    const out = await storeImage(req.file.buffer, getMediaDir());
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: `Could not process image: ${err && err.message ? err.message : 'unknown error'}` });
  }
});

// ── Shot lists ────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.*, p.title AS project_title,
             (SELECT COUNT(*) FROM shotlist_scenes sc WHERE sc.shotlist_id = s.id) AS scene_count,
             (SELECT COUNT(*) FROM shots sh WHERE sh.shotlist_id = s.id) AS shot_count,
             (SELECT COUNT(*) FROM shots sh WHERE sh.shotlist_id = s.id AND sh.status = 'completed') AS completed_count
      FROM shotlists s
      LEFT JOIN projects p ON p.id = s.project_id
      ORDER BY (s.shoot_date IS NULL), s.shoot_date DESC, s.updated_at DESC
    `).all();
    res.json(rows.map(publicShape));
  } catch (err) {
    res.status(500).json({ error: 'Could not load shot lists' });
  }
});

router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const title = cleanText(body.title, 200);
    if (!title) return res.status(400).json({ error: 'Title required' });

    let projectId = null;
    if (body.project_id) {
      const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(body.project_id);
      if (!project) return res.status(400).json({ error: 'Unknown project' });
      projectId = project.id;
    }

    const r = db.prepare(`
      INSERT INTO shotlists (project_id, title, shoot_date, call_time, status, order_mode)
      VALUES (?, ?, ?, ?, 'draft', 'user')
    `).run(projectId, title, cleanDate(body.shoot_date), cleanTime(body.call_time));
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not create the shot list' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const locations = getLocations(shotlist.id);
    // The panel always edits the USER ordering; the optimised one is shown
    // separately in the comparison.
    const scenes = getScenes(shotlist.id, 'user');
    const shotsByScene = new Map(scenes.map(s => [s.id, getShotsForScene(s.id)]));
    const allShots = scenes.flatMap(s => shotsByScene.get(s.id) || []);
    const media = getMediaByShot(allShots.map(s => s.id));

    const locById = new Map(locations.map(l => [l.id, l]));
    // The light window belongs to the scene, and it is resolved from that
    // scene's own coordinates.
    const shaped = scenes.map(scene => {
      const loc = scene.location_id != null ? locById.get(scene.location_id) : null;
      const win = resolveWindow(scene.light_window, shotlist.shoot_date, loc ? loc.lat : null, loc ? loc.lng : null);
      const shots = (shotsByScene.get(scene.id) || []).map(s => ({ ...s, media: media.get(s.id) || [] }));
      return {
        ...scene,
        shots,
        duration_minutes: sceneDuration(shots),
        light_window_label: win ? win.label : '',
        light_window_range: win ? win.range_label : '',
        light_window_hard: win ? win.hard : false,
        light_window_approximate: win ? win.approximate : true,
      };
    });

    const project = shotlist.project_id
      ? db.prepare('SELECT id, title, shoot_date FROM projects WHERE id = ?').get(shotlist.project_id)
      : null;

    res.json({
      shotlist: publicShape(shotlist),
      project,
      scenes: shaped,
      shot_count: allShots.length,
      locations,
      plan: readPlan(shotlist),
      activity: getActivity(shotlist.id, 60),
      sun: shotlist.shoot_date && locations.length
        ? locations.map(l => ({ location_id: l.id, name: l.name, ...(solarSummary(shotlist.shoot_date, l.lat, l.lng) || {}) }))
        : [],
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load the shot list' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const body = req.body || {};
    if (body.title !== undefined && !cleanText(body.title, 200)) {
      return res.status(400).json({ error: 'Title cannot be empty' });
    }

    let projectId = shotlist.project_id;
    if (body.project_id !== undefined) {
      if (!body.project_id) projectId = null;
      else {
        const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(body.project_id);
        if (!project) return res.status(400).json({ error: 'Unknown project' });
        projectId = project.id;
      }
    }

    let orderMode = shotlist.order_mode;
    if (body.order_mode !== undefined) {
      orderMode = body.order_mode === 'optimized' ? 'optimized' : 'user';
    }

    db.prepare(`
      UPDATE shotlists
      SET project_id = ?, title = ?, shoot_date = ?, call_time = ?, notes = ?, order_mode = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      projectId,
      body.title !== undefined ? cleanText(body.title, 200) : shotlist.title,
      body.shoot_date !== undefined ? cleanDate(body.shoot_date) : shotlist.shoot_date,
      body.call_time !== undefined ? cleanTime(body.call_time) : shotlist.call_time,
      body.notes !== undefined ? cleanText(body.notes, 8000) : shotlist.notes,
      orderMode,
      shotlist.id
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the shot list' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    // Shots, locations, media rows and activity cascade; media files are left
    // on disk, same as pitch media.
    db.prepare('DELETE FROM shotlists WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete the shot list' });
  }
});

// ── Passcode ──────────────────────────────────────────────────────────────────
// Hashed with bcrypt exactly like the login password. Never logged, never
// returned, never sent to the client.

router.put('/:id/passcode', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const raw = req.body && req.body.passcode;
    if (raw === null || raw === undefined || String(raw) === '') {
      db.prepare("UPDATE shotlists SET passcode_hash = NULL, updated_at = datetime('now') WHERE id = ?")
        .run(shotlist.id);
      return res.json({ ok: true, has_passcode: false });
    }

    const passcode = String(raw);
    if (passcode.length < 4 || passcode.length > 64) {
      return res.status(400).json({ error: 'Passcode must be between 4 and 64 characters' });
    }
    db.prepare("UPDATE shotlists SET passcode_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hashPasscode(passcode), shotlist.id);
    res.json({ ok: true, has_passcode: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the passcode' });
  }
});

// ── Publish ───────────────────────────────────────────────────────────────────

router.post('/:id/publish', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const count = db.prepare('SELECT COUNT(*) AS c FROM shotlist_scenes WHERE shotlist_id = ?').get(shotlist.id).c;
    if (count === 0) return res.status(400).json({ error: 'Add at least one scene before publishing' });

    const slug = shotlist.slug || generateSlug(shotlist.title, shotlist.id);
    db.prepare(`
      UPDATE shotlists SET status = 'published', slug = ?, published_at = datetime('now'),
             updated_at = datetime('now') WHERE id = ?
    `).run(slug, shotlist.id);
    res.json({ ok: true, slug });
  } catch (err) {
    res.status(500).json({ error: 'Could not publish the shot list' });
  }
});

router.post('/:id/unpublish', (req, res) => {
  try {
    const r = db.prepare("UPDATE shotlists SET status = 'draft', updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Shot list not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not unpublish the shot list' });
  }
});

// ── Locations ─────────────────────────────────────────────────────────────────

router.post('/:id/locations', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const body = req.body || {};
    const name = cleanText(body.name, 160);
    if (!name) return res.status(400).json({ error: 'Location name required' });

    const lat = cleanCoord(body.lat, 90);
    const lng = cleanCoord(body.lng, 180);

    const r = db.prepare(`
      INSERT INTO shotlist_locations (shotlist_id, name, address, lat, lng, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(shotlist.id, name, cleanText(body.address, 300), lat, lng, cleanText(body.notes, 1000));
    touch(shotlist.id);
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not add the location' });
  }
});

router.put('/:id/locations/:locationId', (req, res) => {
  try {
    const loc = db.prepare('SELECT * FROM shotlist_locations WHERE id = ? AND shotlist_id = ?')
      .get(req.params.locationId, req.params.id);
    if (!loc) return res.status(404).json({ error: 'Location not found' });

    const body = req.body || {};
    if (body.name !== undefined && !cleanText(body.name, 160)) {
      return res.status(400).json({ error: 'Location name required' });
    }

    db.prepare(`
      UPDATE shotlist_locations SET name = ?, address = ?, lat = ?, lng = ?, notes = ?
      WHERE id = ? AND shotlist_id = ?
    `).run(
      body.name !== undefined ? cleanText(body.name, 160) : loc.name,
      body.address !== undefined ? cleanText(body.address, 300) : loc.address,
      body.lat !== undefined ? cleanCoord(body.lat, 90) : loc.lat,
      body.lng !== undefined ? cleanCoord(body.lng, 180) : loc.lng,
      body.notes !== undefined ? cleanText(body.notes, 1000) : loc.notes,
      loc.id, req.params.id
    );
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the location' });
  }
});

router.delete('/:id/locations/:locationId', (req, res) => {
  try {
    // Shots keep working: their location_id is set to NULL by the schema.
    const r = db.prepare('DELETE FROM shotlist_locations WHERE id = ? AND shotlist_id = ?')
      .run(req.params.locationId, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Location not found' });
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete the location' });
  }
});

// ── Scenes ────────────────────────────────────────────────────────────────────
// A scene owns the location, the interior/exterior call and the light window.
// Its shots are the coverage inside it and inherit all three.

function resolveLocationId(shotlistId, value) {
  if (value === null || value === undefined || value === '') return null;
  const loc = db.prepare('SELECT id FROM shotlist_locations WHERE id = ? AND shotlist_id = ?')
    .get(value, shotlistId);
  return loc ? loc.id : null;
}

function getScene(shotlistId, sceneId) {
  return db.prepare('SELECT * FROM shotlist_scenes WHERE id = ? AND shotlist_id = ?')
    .get(sceneId, shotlistId);
}

router.post('/:id/scenes', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const body = req.body || {};
    const space = SPACES.includes(body.space) ? body.space : 'exterior';
    const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM shotlist_scenes WHERE shotlist_id = ?')
      .get(shotlist.id).m + 1;

    const r = db.prepare(`
      INSERT INTO shotlist_scenes (shotlist_id, sort_order, scene_number, title, description,
                                   location_id, space, light_window, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shotlist.id, nextOrder,
      cleanText(body.scene_number, 12) || String(nextOrder + 1),
      cleanText(body.title, 200) || 'New scene',
      cleanText(body.description, 8000),
      resolveLocationId(shotlist.id, body.location_id),
      space,
      cleanWindow(space, body.light_window),
      cleanText(body.notes, 4000)
    );
    touch(shotlist.id);
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not add the scene' });
  }
});

router.put('/:id/scenes/:sceneId', (req, res) => {
  try {
    const scene = getScene(req.params.id, req.params.sceneId);
    if (!scene) return res.status(404).json({ error: 'Scene not found' });

    const body = req.body || {};
    const space = body.space !== undefined
      ? (SPACES.includes(body.space) ? body.space : scene.space)
      : scene.space;
    // Switching space re-validates the window against that space's catalogue.
    const lightWindow = body.light_window !== undefined || body.space !== undefined
      ? cleanWindow(space, body.light_window !== undefined ? body.light_window : scene.light_window)
      : scene.light_window;

    db.prepare(`
      UPDATE shotlist_scenes SET scene_number = ?, title = ?, description = ?, location_id = ?,
             space = ?, light_window = ?, notes = ?
      WHERE id = ? AND shotlist_id = ?
    `).run(
      body.scene_number !== undefined ? cleanText(body.scene_number, 12) : scene.scene_number,
      body.title !== undefined ? (cleanText(body.title, 200) || 'Untitled scene') : scene.title,
      body.description !== undefined ? cleanText(body.description, 8000) : scene.description,
      body.location_id !== undefined ? resolveLocationId(req.params.id, body.location_id) : scene.location_id,
      space,
      lightWindow,
      body.notes !== undefined ? cleanText(body.notes, 4000) : scene.notes,
      scene.id, req.params.id
    );
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the scene' });
  }
});

// Duplicating a scene copies its shots too — coverage is the point of a scene.
router.post('/:id/scenes/:sceneId/duplicate', (req, res) => {
  try {
    const scene = getScene(req.params.id, req.params.sceneId);
    if (!scene) return res.status(404).json({ error: 'Scene not found' });

    const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM shotlist_scenes WHERE shotlist_id = ?')
      .get(scene.shotlist_id).m + 1;

    const duplicate = db.transaction(() => {
      const newSceneId = db.prepare(`
        INSERT INTO shotlist_scenes (shotlist_id, sort_order, scene_number, title, description,
                                     location_id, space, light_window, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        scene.shotlist_id, nextOrder, String(nextOrder + 1), `${scene.title || 'Scene'} copy`,
        scene.description, scene.location_id, scene.space, scene.light_window, scene.notes
      ).lastInsertRowid;

      const insertShot = db.prepare(`
        INSERT INTO shots (shotlist_id, scene_id, sort_order, shot_number, title, description,
                           shot_type, duration_minutes, talent, costume, props, camera_notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `);
      const insertMedia = db.prepare(
        'INSERT INTO shot_media (shot_id, kind, filename, thumb_filename, sort_order) VALUES (?, ?, ?, ?, ?)'
      );
      const sceneMedia = db.prepare('SELECT * FROM shot_media WHERE shot_id = ? ORDER BY sort_order ASC, id ASC');

      getShotsForScene(scene.id).forEach((shot, i) => {
        const newShotId = insertShot.run(
          scene.shotlist_id, newSceneId, i, shot.shot_number, shot.title, shot.description,
          shot.shot_type, shot.duration_minutes, shot.talent, shot.costume, shot.props, shot.camera_notes
        ).lastInsertRowid;
        // Media rows reference the same files; nothing is re-encoded.
        sceneMedia.all(shot.id).forEach(m =>
          insertMedia.run(newShotId, m.kind, m.filename, m.thumb_filename, m.sort_order));
      });

      return newSceneId;
    });

    const id = duplicate();
    touch(req.params.id);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: 'Could not duplicate the scene' });
  }
});

router.delete('/:id/scenes/:sceneId', (req, res) => {
  try {
    // The scene's shots (and their media rows) cascade with it.
    const r = db.prepare('DELETE FROM shotlist_scenes WHERE id = ? AND shotlist_id = ?')
      .run(req.params.sceneId, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Scene not found' });
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete the scene' });
  }
});

// Reorder the USER ordering of scenes — the optimised ordering is untouched.
router.patch('/:id/scenes/reorder', (req, res) => {
  try {
    const { sceneIds } = req.body || {};
    if (!Array.isArray(sceneIds)) return res.status(400).json({ error: 'sceneIds array required' });
    const update = db.prepare('UPDATE shotlist_scenes SET sort_order = ? WHERE id = ? AND shotlist_id = ?');
    const updateAll = db.transaction(ids => {
      ids.forEach((sid, index) => update.run(index, sid, req.params.id));
    });
    updateAll(sceneIds);
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not reorder the scenes' });
  }
});

// ── Shots (inside a scene) ────────────────────────────────────────────────────

function addShotToScene(shotlistId, scene, body) {
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM shots WHERE scene_id = ?')
    .get(scene.id).m + 1;

  return db.prepare(`
    INSERT INTO shots (shotlist_id, scene_id, sort_order, shot_number, title, description, shot_type,
                       duration_minutes, talent, costume, props, camera_notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    shotlistId, scene.id, nextOrder,
    cleanText(body.shot_number, 12) || String(nextOrder + 1),
    cleanText(body.title, 200) || 'New shot',
    cleanText(body.description, 4000),
    cleanText(body.shot_type, 80),
    Number.isFinite(Number(body.duration_minutes)) && Number(body.duration_minutes) > 0
      ? Math.round(Number(body.duration_minutes)) : 30,
    cleanText(body.talent, 300), cleanText(body.costume, 300), cleanText(body.props, 600),
    cleanText(body.camera_notes, 2000)
  ).lastInsertRowid;
}

router.post('/:id/scenes/:sceneId/shots', (req, res) => {
  try {
    const scene = getScene(req.params.id, req.params.sceneId);
    if (!scene) return res.status(404).json({ error: 'Scene not found' });
    const id = addShotToScene(req.params.id, scene, req.body || {});
    touch(req.params.id);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: 'Could not add the shot' });
  }
});

// Kept for callers that do not name a scene: the shot lands in the last scene,
// and a list with no scenes yet gets one so a shot is never orphaned.
router.post('/:id/shots', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const body = req.body || {};
    let scene = body.scene_id
      ? getScene(shotlist.id, body.scene_id)
      : db.prepare('SELECT * FROM shotlist_scenes WHERE shotlist_id = ? ORDER BY sort_order DESC, id DESC LIMIT 1')
        .get(shotlist.id);

    if (!scene) {
      const space = SPACES.includes(body.space) ? body.space : 'exterior';
      const newId = db.prepare(`
        INSERT INTO shotlist_scenes (shotlist_id, sort_order, scene_number, title, location_id, space, light_window)
        VALUES (?, 0, '1', 'Scene 1', ?, ?, ?)
      `).run(
        shotlist.id,
        resolveLocationId(shotlist.id, body.location_id),
        space,
        cleanWindow(space, body.light_window)
      ).lastInsertRowid;
      scene = getScene(shotlist.id, newId);
    }

    const id = addShotToScene(shotlist.id, scene, body);
    touch(shotlist.id);
    res.json({ id, scene_id: scene.id });
  } catch (err) {
    res.status(500).json({ error: 'Could not add the shot' });
  }
});

router.put('/:id/shots/:shotId', (req, res) => {
  try {
    const shot = db.prepare('SELECT * FROM shots WHERE id = ? AND shotlist_id = ?')
      .get(req.params.shotId, req.params.id);
    if (!shot) return res.status(404).json({ error: 'Shot not found' });

    const body = req.body || {};
    const status = body.status !== undefined && STATUSES.includes(body.status) ? body.status : shot.status;

    // Moving a shot to another scene is how coverage gets regrouped; it lands
    // at the end of the target scene.
    let sceneId = shot.scene_id;
    let sortOrder = shot.sort_order;
    if (body.scene_id !== undefined && Number(body.scene_id) !== Number(shot.scene_id)) {
      const target = getScene(req.params.id, body.scene_id);
      if (!target) return res.status(400).json({ error: 'Unknown scene' });
      sceneId = target.id;
      sortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM shots WHERE scene_id = ?')
        .get(target.id).m + 1;
    }

    db.prepare(`
      UPDATE shots SET scene_id = ?, sort_order = ?, shot_number = ?, title = ?, description = ?,
             shot_type = ?, duration_minutes = ?, talent = ?, costume = ?, props = ?,
             camera_notes = ?, status = ?, completed_by = ?, completed_at = ?
      WHERE id = ? AND shotlist_id = ?
    `).run(
      sceneId,
      sortOrder,
      body.shot_number !== undefined ? cleanText(body.shot_number, 12) : shot.shot_number,
      body.title !== undefined ? (cleanText(body.title, 200) || 'Untitled shot') : shot.title,
      body.description !== undefined ? cleanText(body.description, 4000) : shot.description,
      body.shot_type !== undefined ? cleanText(body.shot_type, 80) : shot.shot_type,
      body.duration_minutes !== undefined
        ? (Number.isFinite(Number(body.duration_minutes)) && Number(body.duration_minutes) > 0
          ? Math.round(Number(body.duration_minutes)) : shot.duration_minutes)
        : shot.duration_minutes,
      body.talent !== undefined ? cleanText(body.talent, 300) : shot.talent,
      body.costume !== undefined ? cleanText(body.costume, 300) : shot.costume,
      body.props !== undefined ? cleanText(body.props, 600) : shot.props,
      body.camera_notes !== undefined ? cleanText(body.camera_notes, 2000) : shot.camera_notes,
      status,
      status === 'completed' ? shot.completed_by : null,
      status === 'completed' ? shot.completed_at : null,
      shot.id, req.params.id
    );
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the shot' });
  }
});

router.post('/:id/shots/:shotId/duplicate', (req, res) => {
  try {
    const shot = db.prepare('SELECT * FROM shots WHERE id = ? AND shotlist_id = ?')
      .get(req.params.shotId, req.params.id);
    if (!shot) return res.status(404).json({ error: 'Shot not found' });

    const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM shots WHERE scene_id = ?')
      .get(shot.scene_id).m + 1;

    const duplicate = db.transaction(() => {
      const newId = db.prepare(`
        INSERT INTO shots (shotlist_id, scene_id, sort_order, shot_number, title, description,
                           shot_type, duration_minutes, talent, costume, props, camera_notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        shot.shotlist_id, shot.scene_id, nextOrder, String(nextOrder + 1),
        `${shot.title || 'Shot'} copy`, shot.description, shot.shot_type, shot.duration_minutes,
        shot.talent, shot.costume, shot.props, shot.camera_notes
      ).lastInsertRowid;
      // Media rows reference the same files; nothing is re-encoded.
      const insertMedia = db.prepare(
        'INSERT INTO shot_media (shot_id, kind, filename, thumb_filename, sort_order) VALUES (?, ?, ?, ?, ?)'
      );
      db.prepare('SELECT * FROM shot_media WHERE shot_id = ? ORDER BY sort_order ASC, id ASC')
        .all(shot.id)
        .forEach(m => insertMedia.run(newId, m.kind, m.filename, m.thumb_filename, m.sort_order));
      return newId;
    });

    const id = duplicate();
    touch(req.params.id);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: 'Could not duplicate the shot' });
  }
});

router.delete('/:id/shots/:shotId', (req, res) => {
  try {
    const r = db.prepare('DELETE FROM shots WHERE id = ? AND shotlist_id = ?')
      .run(req.params.shotId, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Shot not found' });
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete the shot' });
  }
});

// Reorder the shots INSIDE one scene.
router.patch('/:id/scenes/:sceneId/shots/reorder', (req, res) => {
  try {
    const { shotIds } = req.body || {};
    if (!Array.isArray(shotIds)) return res.status(400).json({ error: 'shotIds array required' });
    const update = db.prepare('UPDATE shots SET sort_order = ? WHERE id = ? AND scene_id = ?');
    const updateAll = db.transaction(ids => {
      ids.forEach((sid, index) => update.run(index, sid, req.params.sceneId));
    });
    updateAll(shotIds);
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not reorder the shots' });
  }
});

// ── Shot media ────────────────────────────────────────────────────────────────

router.post('/:id/shots/:shotId/media', (req, res) => {
  try {
    const shot = db.prepare('SELECT id FROM shots WHERE id = ? AND shotlist_id = ?')
      .get(req.params.shotId, req.params.id);
    if (!shot) return res.status(404).json({ error: 'Shot not found' });

    const body = req.body || {};
    const filename = cleanText(body.filename, 200);
    if (!filename || /[/\\]/.test(filename) || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const thumb = cleanText(body.thumb_filename, 200);
    if (thumb && (/[/\\]/.test(thumb) || thumb.includes('..'))) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const kind = body.kind === 'scout' ? 'scout' : 'reference';
    const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM shot_media WHERE shot_id = ?')
      .get(shot.id).m + 1;

    const r = db.prepare(
      'INSERT INTO shot_media (shot_id, kind, filename, thumb_filename, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(shot.id, kind, filename, thumb, nextOrder);
    touch(req.params.id);
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not attach the image' });
  }
});

router.delete('/:id/media/:mediaId', (req, res) => {
  try {
    const r = db.prepare(`
      DELETE FROM shot_media WHERE id = ? AND shot_id IN (SELECT id FROM shots WHERE shotlist_id = ?)
    `).run(req.params.mediaId, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Image not found' });
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not remove the image' });
  }
});

// ── Organize this ─────────────────────────────────────────────────────────────

router.post('/:id/organize', async (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });
    if (!shotlist.shoot_date) return res.status(400).json({ error: 'Set a shoot date before organising the day' });

    const scenes = getScenes(shotlist.id, 'user');
    if (scenes.length === 0) return res.status(400).json({ error: 'Add some scenes first' });
    const shotsByScene = new Map(scenes.map(s => [s.id, getShotsForScene(s.id)]));
    const locations = getLocations(shotlist.id);

    const previous = readPlan(shotlist);
    const result = await organize(shotlist, scenes, shotsByScene, locations, {
      startSceneId: (req.body && req.body.startSceneId) || scenes[0].id,
      cachedMatrix: previous ? previous.distance_cache : null,
    });

    // The optimiser NEVER touches sort_order. It writes optimized_order on the
    // scenes and plan_json only; Apply is a separate, explicit action.
    const stored = {
      plan: result.plan,
      comparison: result.comparison,
      current: result.current,
      distance_cache: result.matrixCache || null,
    };

    const persist = db.transaction(() => {
      const update = db.prepare('UPDATE shotlist_scenes SET optimized_order = ? WHERE id = ? AND shotlist_id = ?');
      db.prepare('UPDATE shotlist_scenes SET optimized_order = NULL WHERE shotlist_id = ?').run(shotlist.id);
      result.plan.order.forEach((sceneId, i) => update.run(i, sceneId, shotlist.id));
      db.prepare(`
        UPDATE shotlists SET plan_json = ?, optimizer_mode = ?, updated_at = datetime('now') WHERE id = ?
      `).run(JSON.stringify(stored), result.plan.distance_mode, shotlist.id);
    });
    persist();

    res.json({ plan: result.plan, comparison: result.comparison, current: result.current });
  } catch (err) {
    if (err && err.userMessage) return res.status(400).json({ error: err.message });
    console.error('Shot list organise failed:', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Could not organise the day' });
  }
});

// Apply — the ONLY thing that copies the optimiser ordering into the user
// ordering. Both orderings still persist afterwards.
router.post('/:id/apply-plan', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const plan = readPlan(shotlist);
    const order = plan && plan.plan && Array.isArray(plan.plan.order) ? plan.plan.order : null;
    if (!order || order.length === 0) {
      return res.status(400).json({ error: 'Run Organize this before applying a plan' });
    }

    const apply = db.transaction(() => {
      const update = db.prepare('UPDATE shotlist_scenes SET sort_order = ? WHERE id = ? AND shotlist_id = ?');
      order.forEach((sceneId, i) => update.run(i, sceneId, shotlist.id));
      db.prepare("UPDATE shotlists SET order_mode = 'user', updated_at = datetime('now') WHERE id = ?")
        .run(shotlist.id);
    });
    apply();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not apply the plan' });
  }
});

// ── Activity + reset ──────────────────────────────────────────────────────────

router.get('/:id/activity', (req, res) => {
  try {
    res.json(getActivity(req.params.id, 200));
  } catch (err) {
    res.status(500).json({ error: 'Could not load the activity log' });
  }
});

router.post('/:id/reset-status', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const r = db.prepare(`
      UPDATE shots SET status = 'pending', completed_by = NULL, completed_at = NULL WHERE shotlist_id = ?
    `).run(shotlist.id);
    logActivity(shotlist.id, null, 'reset_all', 'Panel');
    touch(shotlist.id);
    res.json({ ok: true, reset: r.changes });
  } catch (err) {
    res.status(500).json({ error: 'Could not reset the shot statuses' });
  }
});

// ── PDF exports ───────────────────────────────────────────────────────────────
// Both follow the ordering currently selected on the shot list.

router.get('/:id/pdf/callsheet', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });
    const bundle = loadBundle(shotlist);
    callSheetPdf(res, {
      shotlist,
      rows: bundle.rows,
      scenesById: bundle.scenesById,
      shotsByScene: bundle.shotsByScene,
      locationsById: bundle.locationsById,
      agency: getAgency(),
      orderLabel: orderLabelFor(shotlist),
    });
  } catch (err) {
    console.error('Call sheet PDF failed:', err && err.message ? err.message : err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not build the call sheet' });
    else res.end();
  }
});

router.get('/:id/pdf/photoboard', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });
    const bundle = loadBundle(shotlist);
    photoBoardPdf(res, {
      shotlist,
      rows: bundle.rows,
      scenesById: bundle.scenesById,
      shotsByScene: bundle.shotsByScene,
      locationsById: bundle.locationsById,
      mediaByShot: bundle.media,
      agency: getAgency(),
      orderLabel: orderLabelFor(shotlist),
    });
  } catch (err) {
    console.error('Photo board PDF failed:', err && err.message ? err.message : err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not build the photo board' });
    else res.end();
  }
});

module.exports = router;
