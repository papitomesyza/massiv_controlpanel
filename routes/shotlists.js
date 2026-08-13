const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { db } = require('../db/database');
const { imageUploadOptions, storeImage } = require('../lib/mediaStore');
const { publicPitchBase } = require('../lib/pitchDomain');
const { organizeDay, legLookupFor } = require('../lib/shotlistOptimizer');
const {
  windowsForSpace, solarSummary, resolveWindow, WINDOW_DEFS, parseTimeParts,
} = require('../lib/sunWindows');
const { hashPasscode } = require('../lib/shotlistAuth');
const {
  getShotlistById, getLocations, getCharacters, getDays, getBreaks, getScenes,
  getShotsForScene, getMediaByShot, getCharactersByShot, charactersForScene,
  getActivity, logActivity, touch, loadBundle, orderLabelFor,
} = require('../lib/shotlistStore');
const {
  buildDayTimeline, sceneDuration, clipSeconds, sumTotals,
  BREAK_KINDS, defaultBreakLabel, DEFAULT_CREW_CALL_OFFSET,
} = require('../lib/shotlistSchedule');
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
const CHARACTER_KINDS = ['principal', 'extra'];
const LENSES = [
  'ultra_wide', 'wide', 'standard', 'portrait', 'telephoto', 'macro',
  'probe', 'anamorphic', 'fisheye', 'tilt_shift', 'zoom',
];

function cleanInt(v, { min = 0, max = 100000 } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

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

// The age a role is cast for. Either end may stand alone ("40+", "under 12"),
// so neither is required — but when both are given they are put the right way
// round rather than rejected, because a swapped pair is a typo, not a refusal.
function cleanAgeRange(minValue, maxValue) {
  let min = cleanInt(minValue, { min: 0, max: 120 });
  let max = cleanInt(maxValue, { min: 0, max: 120 });
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return { min, max };
}

// Media filenames are generated server-side; anything with a separator in it
// is a tampering attempt.
function cleanFilename(v) {
  const name = cleanText(v, 200);
  if (!name) return null;
  if (/[/\\]/.test(name) || name.includes('..')) return null;
  return name;
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

// The casting link goes to people outside the production, so its slug is not
// derived from the title alone the way the crew slug is — a random suffix
// means knowing the project name is not enough to find it.
function generateCastingSlug(title) {
  const base = String(title || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'casting';
  const exists = db.prepare('SELECT id FROM shotlists WHERE casting_slug = ?');
  for (let i = 0; i < 10; i++) {
    const slug = `${base}-${crypto.randomBytes(5).toString('hex')}`;
    if (!exists.get(slug)) return slug;
  }
  // Ten collisions on 40 random bits will not happen, but never return a
  // duplicate: fall back to something that cannot collide.
  return `${base}-${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;
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

    // A shot list is never dayless: it is born with Day 1, carrying whatever
    // date and call time was given — the same shape the backfill gives the
    // lists that existed before days did.
    const create = db.transaction(() => {
      const shotlistId = db.prepare(`
        INSERT INTO shotlists (project_id, title, shoot_date, call_time, status, order_mode)
        VALUES (?, ?, ?, ?, 'draft', 'user')
      `).run(projectId, title, cleanDate(body.shoot_date), cleanTime(body.call_time)).lastInsertRowid;

      db.prepare(`
        INSERT INTO shotlist_days (shotlist_id, day_number, shoot_date, crew_call, crew_call_offset_minutes, sort_order)
        VALUES (?, 1, ?, ?, ?, 0)
      `).run(shotlistId, cleanDate(body.shoot_date), cleanTime(body.call_time), DEFAULT_CREW_CALL_OFFSET);

      return shotlistId;
    });
    res.json({ id: create() });
  } catch (err) {
    res.status(500).json({ error: 'Could not create the shot list' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const locations = getLocations(shotlist.id);
    const characters = getCharacters(shotlist.id);
    const days = getDays(shotlist.id);
    const breaks = getBreaks(shotlist.id);
    // The panel always edits the USER ordering; the optimised one is shown
    // separately in the comparison.
    const scenes = getScenes(shotlist.id, 'user');
    const shotsByScene = new Map(scenes.map(s => [s.id, getShotsForScene(s.id)]));
    const allShots = scenes.flatMap(s => shotsByScene.get(s.id) || []);
    const media = getMediaByShot(allShots.map(s => s.id));
    const charactersByShot = getCharactersByShot(allShots.map(s => s.id));

    const locById = new Map(locations.map(l => [l.id, l]));
    const dayById = new Map(days.map(d => [d.id, d]));
    const leg = legLookupFor(locations);

    // The light window belongs to the scene, resolved from that scene's own
    // coordinates on ITS day's date — so a three-day shoot gets three answers.
    const shaped = scenes.map(scene => {
      const loc = scene.location_id != null ? locById.get(scene.location_id) : null;
      const day = scene.day_id != null ? dayById.get(scene.day_id) : days[0];
      const date = (day && day.shoot_date) || shotlist.shoot_date;
      const win = resolveWindow(scene.light_window, date, loc ? loc.lat : null, loc ? loc.lng : null);
      const shots = (shotsByScene.get(scene.id) || []).map(s => ({
        ...s,
        media: media.get(s.id) || [],
        characters: charactersByShot.get(s.id) || [],
      }));
      return {
        ...scene,
        shots,
        duration_minutes: sceneDuration(shots),
        clip_seconds: clipSeconds(shots),
        characters: charactersForScene(shots, charactersByShot),
        light_window_label: win ? win.label : '',
        light_window_range: win ? win.range_label : '',
        light_window_hard: win ? win.hard : false,
        light_window_approximate: win ? win.approximate : true,
      };
    });

    // One timeline per day, rebuilt live — scenes, generated company moves and
    // breaks, with the day's derived crew call and totals.
    const timelines = days.map(day => {
      const dayScenes = scenes.filter(sc => sc.day_id === day.id);
      const dayBreaks = breaks.filter(b => b.day_id === day.id);
      const t = buildDayTimeline(shotlist, day, dayScenes, shotsByScene, dayBreaks, locations, leg);
      return { day_id: day.id, items: t.items, totals: t.totals, warnings: t.warnings, scheduled: t.scheduled };
    });

    const project = shotlist.project_id
      ? db.prepare('SELECT id, title, shoot_date FROM projects WHERE id = ?').get(shotlist.project_id)
      : null;

    res.json({
      shotlist: publicShape(shotlist),
      project,
      days,
      scenes: shaped,
      characters,
      breaks,
      timelines,
      totals: sumTotals(timelines.map(t => t.totals)),
      shot_count: allShots.length,
      locations,
      plan: readPlan(shotlist),   // { days: { [dayId]: { plan, comparison, current } } }
      activity: getActivity(shotlist.id, 60),
      sun: days.length && locations.length
        ? days.flatMap(d => locations.map(l => ({
          day_id: d.id, location_id: l.id, name: l.name,
          ...(solarSummary(d.shoot_date || shotlist.shoot_date, l.lat, l.lng) || {}),
        })))
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
          move_wrap_minutes = ?, move_setup_minutes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      projectId,
      body.title !== undefined ? cleanText(body.title, 200) : shotlist.title,
      body.shoot_date !== undefined ? cleanDate(body.shoot_date) : shotlist.shoot_date,
      body.call_time !== undefined ? cleanTime(body.call_time) : shotlist.call_time,
      body.notes !== undefined ? cleanText(body.notes, 8000) : shotlist.notes,
      orderMode,
      body.move_wrap_minutes !== undefined
        ? (cleanInt(body.move_wrap_minutes, { min: 0, max: 480 }) ?? shotlist.move_wrap_minutes)
        : shotlist.move_wrap_minutes,
      body.move_setup_minutes !== undefined
        ? (cleanInt(body.move_setup_minutes, { min: 0, max: 480 }) ?? shotlist.move_setup_minutes)
        : shotlist.move_setup_minutes,
      shotlist.id
    );

    // Days own the dates now, so the legacy field only reaches through to a
    // single day that has no date of its own — it never overwrites a day
    // somebody has already dated, and never touches a multi-day list.
    if (body.shoot_date !== undefined && cleanDate(body.shoot_date)) {
      const days = getDays(shotlist.id);
      if (days.length === 1 && !days[0].shoot_date) {
        db.prepare('UPDATE shotlist_days SET shoot_date = ? WHERE id = ?')
          .run(cleanDate(body.shoot_date), days[0].id);
      }
    }

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

// ── Casting share link ────────────────────────────────────────────────────────
// A separate publication from the crew link, for a casting agency: the cast
// grid and nothing else, read only. Publishing one never publishes the other.

router.post('/:id/casting/publish', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const count = db.prepare('SELECT COUNT(*) AS c FROM shotlist_characters WHERE shotlist_id = ?')
      .get(shotlist.id).c;
    if (count === 0) return res.status(400).json({ error: 'Add at least one character before sharing the casting' });

    const slug = shotlist.casting_slug || generateCastingSlug(shotlist.title);
    db.prepare(`
      UPDATE shotlists SET casting_status = 'published', casting_slug = ?,
             casting_published_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(slug, shotlist.id);
    res.json({ ok: true, casting_slug: slug });
  } catch (err) {
    res.status(500).json({ error: 'Could not share the casting' });
  }
});

router.post('/:id/casting/unpublish', (req, res) => {
  try {
    const r = db.prepare(
      "UPDATE shotlists SET casting_status = 'draft', updated_at = datetime('now') WHERE id = ?"
    ).run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Shot list not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not stop sharing the casting' });
  }
});

// A new link invalidates the old one — the way to cut off an agency that
// should no longer have access without unsharing from everyone else later.
router.post('/:id/casting/rotate', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const slug = generateCastingSlug(shotlist.title);
    db.prepare("UPDATE shotlists SET casting_slug = ?, updated_at = datetime('now') WHERE id = ?")
      .run(slug, shotlist.id);
    res.json({ ok: true, casting_slug: slug });
  } catch (err) {
    res.status(500).json({ error: 'Could not make a new casting link' });
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

// ── Shoot days ────────────────────────────────────────────────────────────────
// A day owns its own date and times. shotlists.shoot_date / call_time remain
// for compatibility but are no longer the source of truth.

function getDay(shotlistId, dayId) {
  return db.prepare('SELECT * FROM shotlist_days WHERE id = ? AND shotlist_id = ?').get(dayId, shotlistId);
}

router.post('/:id/days', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const body = req.body || {};
    const existing = getDays(shotlist.id);
    const nextNumber = cleanInt(body.day_number, { min: 1, max: 999 })
      || (existing.reduce((n, d) => Math.max(n, Number(d.day_number) || 0), 0) + 1);
    const nextOrder = existing.reduce((n, d) => Math.max(n, Number(d.sort_order) || 0), -1) + 1;

    const r = db.prepare(`
      INSERT INTO shotlist_days (shotlist_id, day_number, shoot_date, crew_call, crew_call_offset_minutes, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      shotlist.id, nextNumber, cleanDate(body.shoot_date), cleanTime(body.crew_call),
      cleanInt(body.crew_call_offset_minutes, { min: 0, max: 600 }) ?? DEFAULT_CREW_CALL_OFFSET,
      cleanText(body.notes, 2000), nextOrder
    );
    touch(shotlist.id);
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not add the day' });
  }
});

router.put('/:id/days/:dayId', (req, res) => {
  try {
    const day = getDay(req.params.id, req.params.dayId);
    if (!day) return res.status(404).json({ error: 'Day not found' });

    const body = req.body || {};
    db.prepare(`
      UPDATE shotlist_days SET day_number = ?, shoot_date = ?, crew_call = ?,
             crew_call_offset_minutes = ?, notes = ?
      WHERE id = ? AND shotlist_id = ?
    `).run(
      body.day_number !== undefined ? (cleanInt(body.day_number, { min: 1, max: 999 }) || day.day_number) : day.day_number,
      body.shoot_date !== undefined ? cleanDate(body.shoot_date) : day.shoot_date,
      body.crew_call !== undefined ? cleanTime(body.crew_call) : day.crew_call,
      body.crew_call_offset_minutes !== undefined
        ? (cleanInt(body.crew_call_offset_minutes, { min: 0, max: 600 }) ?? day.crew_call_offset_minutes)
        : day.crew_call_offset_minutes,
      body.notes !== undefined ? cleanText(body.notes, 2000) : day.notes,
      day.id, req.params.id
    );
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the day' });
  }
});

// A day only goes when nothing is scheduled on it — deleting a day must never
// take scenes down with it.
router.delete('/:id/days/:dayId', (req, res) => {
  try {
    const day = getDay(req.params.id, req.params.dayId);
    if (!day) return res.status(404).json({ error: 'Day not found' });

    const scenes = db.prepare('SELECT COUNT(*) AS c FROM shotlist_scenes WHERE day_id = ?').get(day.id).c;
    if (scenes > 0) {
      return res.status(400).json({ error: `This day still holds ${scenes} scene${scenes === 1 ? '' : 's'}. Move them to another day first.` });
    }
    const remaining = getDays(req.params.id).length;
    if (remaining <= 1) return res.status(400).json({ error: 'A shot list needs at least one day' });

    db.prepare('DELETE FROM shotlist_days WHERE id = ? AND shotlist_id = ?').run(day.id, req.params.id);
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete the day' });
  }
});

router.patch('/:id/days/reorder', (req, res) => {
  try {
    const { dayIds } = req.body || {};
    if (!Array.isArray(dayIds)) return res.status(400).json({ error: 'dayIds array required' });
    const update = db.prepare('UPDATE shotlist_days SET sort_order = ? WHERE id = ? AND shotlist_id = ?');
    const updateAll = db.transaction(ids => {
      ids.forEach((did, index) => update.run(index, did, req.params.id));
    });
    updateAll(dayIds);
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not reorder the days' });
  }
});

// ── Characters ────────────────────────────────────────────────────────────────
// Defined once per shot list and reused across shots, exactly like locations.

router.post('/:id/characters', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const body = req.body || {};
    const name = cleanText(body.name, 120);
    if (!name) return res.status(400).json({ error: 'Character name required' });

    const nextOrder = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM shotlist_characters WHERE shotlist_id = ?'
    ).get(shotlist.id).m + 1;

    const age = cleanAgeRange(body.age_min, body.age_max);

    const r = db.prepare(`
      INSERT INTO shotlist_characters (shotlist_id, name, performer, kind, costume, notes,
                                       photo_filename, photo_thumb_filename, age_min, age_max, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shotlist.id, name, cleanText(body.performer, 120),
      CHARACTER_KINDS.includes(body.kind) ? body.kind : 'principal',
      cleanText(body.costume, 300), cleanText(body.notes, 1000),
      cleanFilename(body.photo_filename), cleanFilename(body.photo_thumb_filename),
      age.min, age.max,
      nextOrder
    );
    touch(shotlist.id);
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not add the character' });
  }
});

// One tap gives the next numbered extra: Extra 1, Extra 2, Extra 3…
router.post('/:id/characters/extra', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const existing = getCharacters(shotlist.id);
    let n = 0;
    existing.forEach(c => {
      const m = /^extra\s+(\d+)$/i.exec(String(c.name || '').trim());
      if (m) n = Math.max(n, Number(m[1]));
    });
    const nextOrder = existing.reduce((m, c) => Math.max(m, Number(c.sort_order) || 0), -1) + 1;

    const r = db.prepare(`
      INSERT INTO shotlist_characters (shotlist_id, name, kind, sort_order)
      VALUES (?, ?, 'extra', ?)
    `).run(shotlist.id, `Extra ${n + 1}`, nextOrder);
    touch(shotlist.id);
    res.json({ id: r.lastInsertRowid, name: `Extra ${n + 1}` });
  } catch (err) {
    res.status(500).json({ error: 'Could not add the extra' });
  }
});

router.put('/:id/characters/:characterId', (req, res) => {
  try {
    const character = db.prepare('SELECT * FROM shotlist_characters WHERE id = ? AND shotlist_id = ?')
      .get(req.params.characterId, req.params.id);
    if (!character) return res.status(404).json({ error: 'Character not found' });

    const body = req.body || {};
    if (body.name !== undefined && !cleanText(body.name, 120)) {
      return res.status(400).json({ error: 'Character name required' });
    }

    // The two ends are validated together — a range is only sane as a pair, so
    // touching either one re-checks both. An explicit null clears that end.
    const age = (body.age_min !== undefined || body.age_max !== undefined)
      ? cleanAgeRange(
        body.age_min !== undefined ? body.age_min : character.age_min,
        body.age_max !== undefined ? body.age_max : character.age_max
      )
      : { min: character.age_min, max: character.age_max };

    db.prepare(`
      UPDATE shotlist_characters SET name = ?, performer = ?, kind = ?, costume = ?, notes = ?,
             photo_filename = ?, photo_thumb_filename = ?, age_min = ?, age_max = ?
      WHERE id = ? AND shotlist_id = ?
    `).run(
      body.name !== undefined ? cleanText(body.name, 120) : character.name,
      body.performer !== undefined ? cleanText(body.performer, 120) : character.performer,
      body.kind !== undefined && CHARACTER_KINDS.includes(body.kind) ? body.kind : character.kind,
      body.costume !== undefined ? cleanText(body.costume, 300) : character.costume,
      body.notes !== undefined ? cleanText(body.notes, 1000) : character.notes,
      body.photo_filename !== undefined ? cleanFilename(body.photo_filename) : character.photo_filename,
      body.photo_thumb_filename !== undefined ? cleanFilename(body.photo_thumb_filename) : character.photo_thumb_filename,
      age.min, age.max,
      character.id, req.params.id
    );
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the character' });
  }
});

// Cast order is the order everywhere — the picker chips, the casting grid and
// the photo board all read sort_order — so dragging a part in the panel moves
// it on every surface. Scoped to this shot list, so an id from another one is
// simply not updated.
router.patch('/:id/characters/reorder', (req, res) => {
  try {
    const { characterIds } = req.body || {};
    if (!Array.isArray(characterIds)) return res.status(400).json({ error: 'characterIds array required' });

    const update = db.prepare('UPDATE shotlist_characters SET sort_order = ? WHERE id = ? AND shotlist_id = ?');
    const updateAll = db.transaction(ids => {
      ids.forEach((cid, index) => update.run(index, cid, req.params.id));
    });
    updateAll(characterIds);
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not reorder the cast' });
  }
});

router.delete('/:id/characters/:characterId', (req, res) => {
  try {
    // The shot links cascade with the character.
    const r = db.prepare('DELETE FROM shotlist_characters WHERE id = ? AND shotlist_id = ?')
      .run(req.params.characterId, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Character not found' });
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete the character' });
  }
});

// Duplicating a part copies the brief — the age range, the costume note, the
// casting photo and every wardrobe look — but NOT the shot links: the copy is
// a new part that is not in any scene yet. A numbered extra continues the
// sequence rather than becoming "Extra 3 copy".
router.post('/:id/characters/:characterId/duplicate', (req, res) => {
  try {
    const character = db.prepare('SELECT * FROM shotlist_characters WHERE id = ? AND shotlist_id = ?')
      .get(req.params.characterId, req.params.id);
    if (!character) return res.status(404).json({ error: 'Character not found' });

    const existing = getCharacters(req.params.id);
    let name = `${character.name} copy`;
    if (/^extra\s+\d+$/i.test(String(character.name || '').trim())) {
      let n = 0;
      existing.forEach(c => {
        const m = /^extra\s+(\d+)$/i.exec(String(c.name || '').trim());
        if (m) n = Math.max(n, Number(m[1]));
      });
      name = `Extra ${n + 1}`;
    }
    const nextOrder = existing.reduce((m, c) => Math.max(m, Number(c.sort_order) || 0), -1) + 1;

    const duplicate = db.transaction(() => {
      const newId = db.prepare(`
        INSERT INTO shotlist_characters (shotlist_id, name, performer, kind, costume, notes,
                                         photo_filename, photo_thumb_filename, age_min, age_max, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        character.shotlist_id, name.slice(0, 120), character.performer, character.kind,
        character.costume, character.notes, character.photo_filename, character.photo_thumb_filename,
        character.age_min, character.age_max, nextOrder
      ).lastInsertRowid;

      // The wardrobe comes along: same files, new rows, so removing a look from
      // one part never touches the other.
      const looks = db.prepare(
        'SELECT * FROM shotlist_character_media WHERE character_id = ? ORDER BY sort_order ASC, id ASC'
      ).all(character.id);
      const insertLook = db.prepare(`
        INSERT INTO shotlist_character_media (character_id, kind, label, filename, thumb_filename, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      looks.forEach((w, i) => insertLook.run(newId, w.kind, w.label, w.filename, w.thumb_filename, i));

      return newId;
    });

    const id = duplicate();
    touch(req.params.id);
    res.json({ id, name });
  } catch (err) {
    res.status(500).json({ error: 'Could not duplicate the character' });
  }
});

// ── Wardrobe ──────────────────────────────────────────────────────────────────
// Costume photos hang off the character, not off a shot: the same look travels
// with the part across every scene it appears in.

router.post('/:id/characters/:characterId/media', (req, res) => {
  try {
    const character = db.prepare('SELECT id FROM shotlist_characters WHERE id = ? AND shotlist_id = ?')
      .get(req.params.characterId, req.params.id);
    if (!character) return res.status(404).json({ error: 'Character not found' });

    const body = req.body || {};
    const filename = cleanFilename(body.filename);
    if (!filename) return res.status(400).json({ error: 'Invalid filename' });
    // A thumb that fails the guard is dropped rather than failing the upload —
    // the full image still shows.
    const thumb = cleanFilename(body.thumb_filename);

    const nextOrder = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM shotlist_character_media WHERE character_id = ?'
    ).get(character.id).m + 1;

    const r = db.prepare(`
      INSERT INTO shotlist_character_media (character_id, kind, label, filename, thumb_filename, sort_order)
      VALUES (?, 'costume', ?, ?, ?, ?)
    `).run(character.id, cleanText(body.label, 120), filename, thumb, nextOrder);
    touch(req.params.id);
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not attach the costume photo' });
  }
});

// Naming a look is the whole point for continuity, so the label is editable
// without re-uploading.
router.put('/:id/character-media/:mediaId', (req, res) => {
  try {
    const row = db.prepare(`
      SELECT m.id FROM shotlist_character_media m
      JOIN shotlist_characters c ON c.id = m.character_id
      WHERE m.id = ? AND c.shotlist_id = ?
    `).get(req.params.mediaId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Costume photo not found' });

    const body = req.body || {};
    if (body.label !== undefined) {
      db.prepare('UPDATE shotlist_character_media SET label = ? WHERE id = ?')
        .run(cleanText(body.label, 120), row.id);
    }
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not rename the costume photo' });
  }
});

router.delete('/:id/character-media/:mediaId', (req, res) => {
  try {
    // Scoped through the character so one shot list can never delete another's.
    const r = db.prepare(`
      DELETE FROM shotlist_character_media WHERE id IN (
        SELECT m.id FROM shotlist_character_media m
        JOIN shotlist_characters c ON c.id = m.character_id
        WHERE m.id = ? AND c.shotlist_id = ?
      )
    `).run(req.params.mediaId, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Costume photo not found' });
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not remove the costume photo' });
  }
});

// The whole cast of one shot, replaced in one call.
router.put('/:id/shots/:shotId/characters', (req, res) => {
  try {
    const shot = db.prepare('SELECT id FROM shots WHERE id = ? AND shotlist_id = ?')
      .get(req.params.shotId, req.params.id);
    if (!shot) return res.status(404).json({ error: 'Shot not found' });

    const ids = Array.isArray(req.body && req.body.characterIds) ? req.body.characterIds : null;
    if (!ids) return res.status(400).json({ error: 'characterIds array required' });

    const valid = new Set(getCharacters(req.params.id).map(c => c.id));
    const link = db.prepare('INSERT OR IGNORE INTO shot_characters (shot_id, character_id) VALUES (?, ?)');
    const replace = db.transaction(() => {
      db.prepare('DELETE FROM shot_characters WHERE shot_id = ?').run(shot.id);
      ids.map(Number).filter(cid => valid.has(cid)).forEach(cid => link.run(shot.id, cid));
    });
    replace();
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the characters on this shot' });
  }
});

// ── Meals and breaks ──────────────────────────────────────────────────────────
// A break sits between two scenes. sort_order n means "before the nth scene"
// of its day. With a start_time it is immovable; without one it floats there.

router.post('/:id/breaks', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const body = req.body || {};
    const day = body.day_id ? getDay(shotlist.id, body.day_id) : getDays(shotlist.id)[0];
    if (!day) return res.status(400).json({ error: 'Add a shoot day first' });

    const kind = BREAK_KINDS.includes(body.kind) ? body.kind : 'break';
    const r = db.prepare(`
      INSERT INTO shotlist_breaks (shotlist_id, day_id, kind, label, start_time, duration_minutes, sort_order, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shotlist.id, day.id, kind,
      cleanText(body.label, 80) || defaultBreakLabel(kind),
      cleanTime(body.start_time),
      cleanInt(body.duration_minutes, { min: 5, max: 480 }) ?? 45,
      cleanInt(body.sort_order, { min: 0, max: 999 }) ?? 0,
      cleanText(body.notes, 1000)
    );
    touch(shotlist.id);
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not add the break' });
  }
});

router.put('/:id/breaks/:breakId', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM shotlist_breaks WHERE id = ? AND shotlist_id = ?')
      .get(req.params.breakId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Break not found' });

    const body = req.body || {};
    let dayId = row.day_id;
    if (body.day_id !== undefined) {
      const day = body.day_id ? getDay(req.params.id, body.day_id) : null;
      if (body.day_id && !day) return res.status(400).json({ error: 'Unknown day' });
      dayId = day ? day.id : null;
    }

    db.prepare(`
      UPDATE shotlist_breaks SET day_id = ?, kind = ?, label = ?, start_time = ?,
             duration_minutes = ?, sort_order = ?, notes = ?
      WHERE id = ? AND shotlist_id = ?
    `).run(
      dayId,
      body.kind !== undefined && BREAK_KINDS.includes(body.kind) ? body.kind : row.kind,
      body.label !== undefined ? (cleanText(body.label, 80) || defaultBreakLabel(row.kind)) : row.label,
      // An explicit null clears the fixed time and lets the break float again.
      body.start_time !== undefined ? cleanTime(body.start_time) : row.start_time,
      body.duration_minutes !== undefined
        ? (cleanInt(body.duration_minutes, { min: 5, max: 480 }) ?? row.duration_minutes)
        : row.duration_minutes,
      body.sort_order !== undefined ? (cleanInt(body.sort_order, { min: 0, max: 999 }) ?? row.sort_order) : row.sort_order,
      body.notes !== undefined ? cleanText(body.notes, 1000) : row.notes,
      row.id, req.params.id
    );
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the break' });
  }
});

router.delete('/:id/breaks/:breakId', (req, res) => {
  try {
    const r = db.prepare('DELETE FROM shotlist_breaks WHERE id = ? AND shotlist_id = ?')
      .run(req.params.breakId, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Break not found' });
    touch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete the break' });
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

    // A scene always belongs to a day: the named one, else the first.
    const day = body.day_id ? getDay(shotlist.id, body.day_id) : getDays(shotlist.id)[0];

    const r = db.prepare(`
      INSERT INTO shotlist_scenes (shotlist_id, day_id, sort_order, scene_number, title, description,
                                   location_id, space, light_window, set_design, locked_start_time, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shotlist.id, day ? day.id : null, nextOrder,
      cleanText(body.scene_number, 12) || String(nextOrder + 1),
      cleanText(body.title, 200) || 'New scene',
      cleanText(body.description, 8000),
      resolveLocationId(shotlist.id, body.location_id),
      space,
      cleanWindow(space, body.light_window),
      cleanText(body.set_design, 4000),
      cleanTime(body.locked_start_time),
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

    let dayId = scene.day_id;
    if (body.day_id !== undefined) {
      const day = body.day_id ? getDay(req.params.id, body.day_id) : null;
      if (body.day_id && !day) return res.status(400).json({ error: 'Unknown day' });
      dayId = day ? day.id : scene.day_id;
    }

    db.prepare(`
      UPDATE shotlist_scenes SET day_id = ?, scene_number = ?, title = ?, description = ?, location_id = ?,
             space = ?, light_window = ?, set_design = ?, locked_start_time = ?,
             move_wrap_minutes = ?, move_setup_minutes = ?, notes = ?
      WHERE id = ? AND shotlist_id = ?
    `).run(
      dayId,
      body.scene_number !== undefined ? cleanText(body.scene_number, 12) : scene.scene_number,
      body.title !== undefined ? (cleanText(body.title, 200) || 'Untitled scene') : scene.title,
      body.description !== undefined ? cleanText(body.description, 8000) : scene.description,
      body.location_id !== undefined ? resolveLocationId(req.params.id, body.location_id) : scene.location_id,
      space,
      lightWindow,
      body.set_design !== undefined ? cleanText(body.set_design, 4000) : scene.set_design,
      // An explicit null unlocks; a time locks. Nothing else touches it.
      body.locked_start_time !== undefined ? cleanTime(body.locked_start_time) : scene.locked_start_time,
      // Per-move overrides for the company move INTO this scene; null restores
      // the shot list defaults.
      body.move_wrap_minutes !== undefined
        ? cleanInt(body.move_wrap_minutes, { min: 0, max: 480 }) : scene.move_wrap_minutes,
      body.move_setup_minutes !== undefined
        ? cleanInt(body.move_setup_minutes, { min: 0, max: 480 }) : scene.move_setup_minutes,
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
      // A copy keeps the set dressing but never the lock: two scenes cannot
      // both be immovable at the same minute.
      const newSceneId = db.prepare(`
        INSERT INTO shotlist_scenes (shotlist_id, day_id, sort_order, scene_number, title, description,
                                     location_id, space, light_window, set_design, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        scene.shotlist_id, scene.day_id, nextOrder, String(nextOrder + 1), `${scene.title || 'Scene'} copy`,
        scene.description, scene.location_id, scene.space, scene.light_window, scene.set_design, scene.notes
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

  // duration_minutes is how long the shot takes to CAPTURE on the day.
  // clip_length_seconds is how long the resulting clip RUNS in the edit.
  return db.prepare(`
    INSERT INTO shots (shotlist_id, scene_id, sort_order, shot_number, title, description, shot_type,
                       duration_minutes, clip_length_seconds, lens, lens_detail, set_design,
                       locked_start_time, costume, props, camera_notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    shotlistId, scene.id, nextOrder,
    cleanText(body.shot_number, 12) || String(nextOrder + 1),
    cleanText(body.title, 200) || 'New shot',
    cleanText(body.description, 4000),
    cleanText(body.shot_type, 80),
    Number.isFinite(Number(body.duration_minutes)) && Number(body.duration_minutes) > 0
      ? Math.round(Number(body.duration_minutes)) : 30,
    cleanInt(body.clip_length_seconds, { min: 0, max: 86400 }),
    LENSES.includes(body.lens) ? body.lens : null,
    cleanText(body.lens_detail, 120),
    cleanText(body.set_design, 2000),
    cleanTime(body.locked_start_time),
    cleanText(body.costume, 300), cleanText(body.props, 600),
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
             shot_type = ?, duration_minutes = ?, clip_length_seconds = ?, lens = ?, lens_detail = ?,
             set_design = ?, locked_start_time = ?, costume = ?, props = ?,
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
      body.clip_length_seconds !== undefined
        ? cleanInt(body.clip_length_seconds, { min: 0, max: 86400 }) : shot.clip_length_seconds,
      body.lens !== undefined ? (LENSES.includes(body.lens) ? body.lens : null) : shot.lens,
      body.lens_detail !== undefined ? cleanText(body.lens_detail, 120) : shot.lens_detail,
      body.set_design !== undefined ? cleanText(body.set_design, 2000) : shot.set_design,
      body.locked_start_time !== undefined ? cleanTime(body.locked_start_time) : shot.locked_start_time,
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
                           shot_type, duration_minutes, clip_length_seconds, lens, lens_detail,
                           set_design, costume, props, camera_notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        shot.shotlist_id, shot.scene_id, nextOrder, String(nextOrder + 1),
        `${shot.title || 'Shot'} copy`, shot.description, shot.shot_type, shot.duration_minutes,
        shot.clip_length_seconds, shot.lens, shot.lens_detail, shot.set_design,
        shot.costume, shot.props, shot.camera_notes
      ).lastInsertRowid;
      // The cast comes with the copy; the lock does not.
      db.prepare('INSERT OR IGNORE INTO shot_characters (shot_id, character_id) SELECT ?, character_id FROM shot_characters WHERE shot_id = ?')
        .run(newId, shot.id);
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
// One day at a time: a day is the unit that gets scheduled. Plans are stored
// per day inside plan_json so organising Tuesday never discards Monday's plan.

router.post('/:id/organize', async (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const days = getDays(shotlist.id);
    if (!days.length) return res.status(400).json({ error: 'Add a shoot day first' });

    const requestedDay = req.body && req.body.dayId
      ? days.find(d => d.id === Number(req.body.dayId))
      : days[0];
    if (!requestedDay) return res.status(400).json({ error: 'Unknown day' });

    const allScenes = getScenes(shotlist.id, 'user');
    const dayScenes = allScenes.filter(sc => sc.day_id === requestedDay.id);
    if (dayScenes.length === 0) return res.status(400).json({ error: 'This day has no scenes to organise' });

    const shotsByScene = new Map(allScenes.map(sc => [sc.id, getShotsForScene(sc.id)]));
    const locations = getLocations(shotlist.id);
    const dayBreaks = getBreaks(shotlist.id).filter(b => b.day_id === requestedDay.id);

    const previous = readPlan(shotlist);
    const result = await organizeDay(shotlist, requestedDay, dayScenes, shotsByScene, dayBreaks, locations, {
      startSceneId: (req.body && req.body.startSceneId) || dayScenes[0].id,
      cachedMatrix: previous ? previous.distance_cache : null,
    });

    // The optimiser NEVER touches sort_order. It writes optimized_order on this
    // day's scenes and plan_json only; Apply is a separate, explicit action.
    const stored = {
      ...(previous || {}),
      distance_cache: result.matrixCache || (previous ? previous.distance_cache : null),
      days: {
        ...((previous && previous.days) || {}),
        [requestedDay.id]: {
          plan: result.plan,
          comparison: result.comparison,
          current: result.current,
        },
      },
    };

    const persist = db.transaction(() => {
      const update = db.prepare('UPDATE shotlist_scenes SET optimized_order = ? WHERE id = ? AND shotlist_id = ?');
      // Only this day's scenes are re-numbered; other days keep their plans.
      const base = allScenes.filter(sc => sc.day_id !== requestedDay.id).length;
      db.prepare('UPDATE shotlist_scenes SET optimized_order = NULL WHERE day_id = ?').run(requestedDay.id);
      result.plan.order.forEach((sceneId, i) => update.run(i, sceneId, shotlist.id));
      // Scenes on other days keep a stable optimised position after this one.
      db.prepare(`
        UPDATE shotlist_scenes SET optimized_order = sort_order + ?
        WHERE shotlist_id = ? AND day_id != ? AND optimized_order IS NULL
      `).run(result.plan.order.length, shotlist.id, requestedDay.id);
      db.prepare(`
        UPDATE shotlists SET plan_json = ?, optimizer_mode = ?, updated_at = datetime('now') WHERE id = ?
      `).run(JSON.stringify(stored), result.plan.distance_mode, shotlist.id);
    });
    persist();

    res.json({
      day_id: requestedDay.id,
      plan: result.plan,
      comparison: result.comparison,
      current: result.current,
    });
  } catch (err) {
    if (err && err.userMessage) return res.status(400).json({ error: err.message });
    console.error('Shot list organise failed:', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Could not organise the day' });
  }
});

// Apply — the ONLY thing that copies the optimiser ordering into the user
// ordering, and only for the day it was run on. Both orderings still persist.
router.post('/:id/apply-plan', (req, res) => {
  try {
    const shotlist = getShotlistById(req.params.id);
    if (!shotlist) return res.status(404).json({ error: 'Shot list not found' });

    const stored = readPlan(shotlist);
    const days = getDays(shotlist.id);
    const dayId = req.body && req.body.dayId ? Number(req.body.dayId) : (days[0] ? days[0].id : null);
    const dayPlan = stored && stored.days ? stored.days[dayId] : null;
    const order = dayPlan && dayPlan.plan && Array.isArray(dayPlan.plan.order) ? dayPlan.plan.order : null;
    if (!order || order.length === 0) {
      return res.status(400).json({ error: 'Run Organize this on this day before applying a plan' });
    }

    // Scenes on this day take the optimised sequence; every other day keeps the
    // ordering it already had.
    const dayScenes = getScenes(shotlist.id, 'user').filter(sc => sc.day_id === dayId);
    const base = dayScenes.reduce((n, sc) => Math.min(n, sc.sort_order), Number.MAX_SAFE_INTEGER);
    const offset = Number.isFinite(base) && base !== Number.MAX_SAFE_INTEGER ? base : 0;

    const apply = db.transaction(() => {
      const update = db.prepare('UPDATE shotlist_scenes SET sort_order = ? WHERE id = ? AND shotlist_id = ?');
      order.forEach((sceneId, i) => update.run(offset + i, sceneId, shotlist.id));
      db.prepare("UPDATE shotlists SET order_mode = 'user', updated_at = datetime('now') WHERE id = ?")
        .run(shotlist.id);
    });
    apply();
    res.json({ ok: true, day_id: dayId });
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
    callSheetPdf(res, {
      shotlist,
      bundle: loadBundle(shotlist),
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
    photoBoardPdf(res, {
      shotlist,
      bundle: loadBundle(shotlist),
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
