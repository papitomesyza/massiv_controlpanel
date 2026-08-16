const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

const { verifyCrewToken, issueCrewToken, checkPasscode } = require('../lib/shotlistAuth');
const { getPublishedBySlug, logActivity, touch } = require('../lib/shotlistStore');

// In-memory rate limiters
const ipSubmissions = new Map();   // ip -> { count, windowStart }
const tokenSubmissions = new Map(); // token -> { count, dayStart }
const unlockIpAttempts = new Map();  // ip -> { count, windowStart }
const unlockSlugAttempts = new Map(); // slug -> { count, windowStart }
const editTokenAttempts = new Map(); // crew token -> { count, windowStart }

function checkIpLimit(ip) {
  const now = Date.now();
  const rec = ipSubmissions.get(ip) || { count: 0, windowStart: now };
  if (now - rec.windowStart > 60000) { rec.count = 0; rec.windowStart = now; }
  return rec;
}

function checkTokenLimit(token) {
  const now = Date.now();
  const rec = tokenSubmissions.get(token) || { count: 0, dayStart: now };
  if (now - rec.dayStart > 86400000) { rec.count = 0; rec.dayStart = now; }
  return rec;
}

function resolveToken(token) {
  const link = db.prepare('SELECT * FROM expense_links WHERE token = ?').get(token);
  if (!link) return { valid: false, reason: 'invalid' };
  if (!link.is_active) return { valid: false, reason: 'revoked' };

  const project = db.prepare('SELECT id, title, status FROM projects WHERE id = ?').get(link.project_id);
  if (!project) return { valid: false, reason: 'invalid' };
  if (project.status === 'completed') return { valid: false, reason: 'expired', project_title: project.title };

  return { valid: true, project_id: project.id, project_title: project.title, project_status: project.status };
}

// GET /api/public/expense/:token
router.get('/expense/:token', (req, res) => {
  const result = resolveToken(req.params.token);
  if (!result.valid) return res.json({ valid: false, reason: result.reason, project_title: result.project_title || null });
  res.json({ valid: true, project_title: result.project_title, project_status: result.project_status });
});

// POST /api/public/expense/:token — multer applied upstream in server.js
router.post('/expense/:token', (req, res) => {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  const token = req.params.token;

  // IP rate limit: 3 per minute
  const ipRec = checkIpLimit(ip);
  if (ipRec.count >= 3) {
    return res.status(429).json({ error: 'Too many submissions. Try again in a minute.' });
  }

  // Token rate limit: 30 per day
  const tokenRec = checkTokenLimit(token);
  if (tokenRec.count >= 30) {
    return res.status(429).json({ error: 'This link has reached its daily submission limit.' });
  }

  const result = resolveToken(token);
  if (!result.valid) return res.status(403).json({ error: result.reason });

  const { category, custom_category, amount, description, submitted_by } = req.body;

  // Validate amount: real finite number > 0 and <= 100000
  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 100000) {
    return res.status(400).json({ error: 'Amount must be a number greater than 0 and at most 100,000' });
  }

  // Store category as text on pending expense; do NOT create category row yet
  const categoryName = category === 'custom' ? (custom_category || 'Custom') : (category || 'Miscellaneous');

  const today = new Date().toISOString().slice(0, 10);
  const imagePath = req.file ? req.file.filename : null;

  // Insert as pending; category_id remains null until approval
  db.prepare(
    "INSERT INTO expenses (project_id, category_id, category_text, amount, date, notes, submitted_by, invoice_image_path, source, status) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'link', 'pending')"
  ).run(result.project_id, categoryName, parsedAmount, today, description || null, submitted_by || null, imagePath);

  // Record successful submission against rate limits
  ipRec.count++;
  ipSubmissions.set(ip, ipRec);
  tokenRec.count++;
  tokenSubmissions.set(token, tokenRec);

  res.json({ success: true });
});

// GET /api/public/expense-categories
router.get('/expense-categories', (req, res) => {
  const cats = db.prepare('SELECT name FROM expense_categories ORDER BY name').all();
  res.json(cats.map(c => c.name));
});

// GET /api/public/collection/:token — read-only shared collection view
router.get('/collection/:token', (req, res) => {
  try {
    const link = db.prepare('SELECT * FROM collection_share_links WHERE token = ?').get(req.params.token);
    if (!link) return res.json({ valid: false, reason: 'invalid' });
    if (!link.enabled) return res.json({ valid: false, reason: 'revoked' });

    const coll = db.prepare(
      'SELECT id, name, description FROM collections WHERE id = ? AND archived = 0'
    ).get(link.collection_id);
    if (!coll) return res.json({ valid: false, reason: 'invalid' });

    const cards = db.prepare(
      `SELECT id, type, url, title, note_text, thumbnail_url, source, tags
       FROM collection_cards WHERE collection_id = ?
       ORDER BY sort_order ASC, created_at DESC`
    ).all(coll.id);

    res.json({ valid: true, collection: coll, cards });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/mind/:token — read-only shared Collections page
router.get('/mind/:token', (req, res) => {
  try {
    const link = db.prepare('SELECT * FROM mind_share_links WHERE token = ?').get(req.params.token);
    if (!link) return res.json({ valid: false, reason: 'invalid' });

    let categories;
    try { categories = JSON.parse(link.categories); } catch (_) {
      categories = (link.categories || '').split(',').map(c => c.trim()).filter(Boolean);
    }

    const VALID_CATS = ['project', 'studio', 'personal'];
    const LABELS = { project: 'Project Collections', studio: 'Studio', personal: 'Personal' };

    const sections = {};
    for (const cat of categories) {
      if (!VALID_CATS.includes(cat)) continue;
      const collections = db.prepare(`
        SELECT id, name, description,
               (SELECT COUNT(*) FROM collection_cards cc WHERE cc.collection_id = c.id) as card_count,
               (SELECT thumbnail_url FROM collection_cards
                WHERE collection_id = c.id AND thumbnail_url IS NOT NULL
                ORDER BY created_at DESC LIMIT 1) as cover_thumbnail,
               (SELECT source FROM collection_cards
                WHERE collection_id = c.id AND type = 'link'
                ORDER BY created_at DESC LIMIT 1) as cover_source
        FROM collections c
        WHERE c.kind = ? AND c.archived = 0
        ORDER BY c.starred DESC, c.sort_order ASC, c.created_at DESC
      `).all(cat);

      const collectionsWithCards = collections.map(coll => {
        const cards = db.prepare(
          `SELECT id, type, url, title, note_text, thumbnail_url, source, tags
           FROM collection_cards WHERE collection_id = ?
           ORDER BY sort_order ASC, created_at DESC`
        ).all(coll.id);
        return { ...coll, cards };
      });

      sections[cat] = { label: LABELS[cat], collections: collectionsWithCards };
    }

    res.json({ valid: true, categories, sections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Public shot list crew endpoints ──────────────────────────────────────────
// Viewing a shot list needs only the link. CHANGING anything needs the
// production passcode, which mints a crew token scoped to that one shot list.
//
// This is a public authentication surface, so the unlock endpoint is rate
// limited the same way the public expense endpoint is, and every failure —
// unknown slug, draft shot list, no passcode set, wrong passcode — returns the
// identical response so nothing about the panel can be enumerated.

const UNLOCK_IP_PER_MIN = 5;
const UNLOCK_SLUG_PER_MIN = 10;

function checkWindowLimit(map, key, windowMs) {
  const now = Date.now();
  const rec = map.get(key) || { count: 0, windowStart: now };
  if (now - rec.windowStart > windowMs) { rec.count = 0; rec.windowStart = now; }
  return rec;
}

function unlockDenied(res) {
  return res.status(401).json({ error: 'invalid' });
}

// POST /api/public/shotlist/:slug/unlock
router.post('/shotlist/:slug/unlock', (req, res) => {
  try {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    const slug = String(req.params.slug || '');

    const ipRec = checkWindowLimit(unlockIpAttempts, ip, 60000);
    if (ipRec.count >= UNLOCK_IP_PER_MIN) {
      return res.status(429).json({ error: 'too_many_attempts' });
    }
    const slugRec = checkWindowLimit(unlockSlugAttempts, slug, 60000);
    if (slugRec.count >= UNLOCK_SLUG_PER_MIN) {
      return res.status(429).json({ error: 'too_many_attempts' });
    }
    // Every attempt counts, successful or not — a valid passcode is not a way
    // around the limiter.
    ipRec.count++; unlockIpAttempts.set(ip, ipRec);
    slugRec.count++; unlockSlugAttempts.set(slug, slugRec);

    const name = String((req.body && req.body.name) || '').trim().slice(0, 60);
    const passcode = (req.body && req.body.passcode) || '';
    if (!name) return res.status(400).json({ error: 'name_required' });

    const shotlist = getPublishedBySlug(slug);
    if (!shotlist || !shotlist.passcode_hash) return unlockDenied(res);
    if (!checkPasscode(passcode, shotlist.passcode_hash)) return unlockDenied(res);

    logActivity(shotlist.id, null, 'unlocked', name);
    res.json({ token: issueCrewToken(shotlist, name), name });
  } catch (err) {
    // Never log the passcode or the body
    console.error('Shot list unlock failed:', err && err.name ? err.name : 'error');
    res.status(500).json({ error: 'unlock_failed' });
  }
});

// POST /api/public/shotlist/:slug/shots/:shotId/complete
// Completion and un-completion both go through here, both need a valid crew
// token, and both are recorded in the activity log with the crew member's name.
router.post('/shotlist/:slug/shots/:shotId/complete', (req, res) => {
  try {
    const shotlist = getPublishedBySlug(String(req.params.slug || ''));
    if (!shotlist || !shotlist.passcode_hash) return unlockDenied(res);

    const auth = verifyCrewToken((req.body && req.body.token) || '', shotlist);
    if (!auth.valid) return unlockDenied(res);

    const shot = db.prepare('SELECT * FROM shots WHERE id = ? AND shotlist_id = ?')
      .get(req.params.shotId, shotlist.id);
    if (!shot) return res.status(404).json({ error: 'not_found' });

    const completed = !!(req.body && req.body.completed);
    if (completed) {
      db.prepare(`
        UPDATE shots SET status = 'completed', completed_by = ?, completed_at = datetime('now') WHERE id = ?
      `).run(auth.name || 'Crew', shot.id);
    } else {
      db.prepare(`
        UPDATE shots SET status = 'pending', completed_by = NULL, completed_at = NULL WHERE id = ?
      `).run(shot.id);
    }
    logActivity(shotlist.id, shot.id, completed ? 'completed' : 'uncompleted', auth.name || 'Crew');

    res.json({ completed, completed_by: completed ? (auth.name || 'Crew') : null });
  } catch (err) {
    console.error('Shot completion failed:', err && err.name ? err.name : 'error');
    res.status(500).json({ error: 'update_failed' });
  }
});

// ── Set design, written from the link ────────────────────────────────────────
// The first field the crew can actually edit rather than tick. A set designer
// changes the dressing on the day; making them ask someone with a panel login
// to type it in is how the document goes stale by mid-morning.
//
// Set design ONLY. The column is chosen server-side from this table, never from
// the request, so a crew token can never be aimed at costume, at a title, or at
// anything structural. Everything else on the page stays panel-only.
const SET_DESIGN_TARGETS = {
  // Lengths match what the panel accepts for the same column, so a note written
  // on the day cannot be longer than one written at the desk.
  scene: { table: 'shotlist_scenes', max: 4000 },
  shot: { table: 'shots', max: 2000 },
};

const EDIT_TOKEN_PER_MIN = 30;

// Same shape as cleanText in routes/shotlists.js: blank means "clear it".
function cleanNote(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

// POST /api/public/shotlist/:slug/set-design
// body: { token, target: 'scene' | 'shot', id, value }
router.post('/shotlist/:slug/set-design', (req, res) => {
  try {
    const shotlist = getPublishedBySlug(String(req.params.slug || ''));
    if (!shotlist || !shotlist.passcode_hash) return unlockDenied(res);

    const token = (req.body && req.body.token) || '';
    const auth = verifyCrewToken(token, shotlist);
    if (!auth.valid) return unlockDenied(res);

    // A valid token is not an open tap: cap how fast one device can write.
    const rec = checkWindowLimit(editTokenAttempts, token, 60000);
    if (rec.count >= EDIT_TOKEN_PER_MIN) {
      return res.status(429).json({ error: 'too_many_edits' });
    }
    rec.count++; editTokenAttempts.set(token, rec);

    const target = SET_DESIGN_TARGETS[String((req.body && req.body.target) || '')];
    if (!target) return res.status(400).json({ error: 'bad_target' });

    const id = Number(req.body && req.body.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_target' });

    // The row has to belong to THIS shot list. Without this check a token for
    // one production could write set design onto another's scenes.
    const row = db.prepare(
      `SELECT id FROM ${target.table} WHERE id = ? AND shotlist_id = ?`
    ).get(id, shotlist.id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    const value = cleanNote(req.body && req.body.value, target.max);
    db.prepare(`UPDATE ${target.table} SET set_design = ? WHERE id = ?`).run(value, row.id);
    touch(shotlist.id);

    logActivity(
      shotlist.id,
      target === SET_DESIGN_TARGETS.shot ? row.id : null,
      value ? 'edited_set_design' : 'cleared_set_design',
      auth.name || 'Crew'
    );

    // Echo back what was stored, not what was sent: the client renders the
    // trimmed, truncated value so the page never disagrees with the database.
    res.json({ value: value || '' });
  } catch (err) {
    console.error('Set design edit failed:', err && err.name ? err.name : 'error');
    res.status(500).json({ error: 'update_failed' });
  }
});

module.exports = router;
