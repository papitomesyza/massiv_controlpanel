const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { pristinaToday } = require('../lib/pristinaDate');

const { verifyCrewToken, issueCrewToken, checkPasscode, PASSCODE_MIN } = require('../lib/shotlistAuth');
const { getPublishedBySlug, logActivity, touch } = require('../lib/shotlistStore');
const path = require('path');
const { storeImage } = require('../lib/mediaStore');
const { attachMedia } = require('../lib/cardMedia');
// Reuse the panel's link preview (defined in routes/collections.js) so a link
// card carries a picture no matter which end saved it.
const { fetchLinkPreview } = require('./collections');

// Moodboard uploads live beside the shot list's, in their own directory.
const COLLECTION_MEDIA_DIR = path.join(
  process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  'collection-media'
);

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

// POST /api/public/expense/:token, multer applied upstream in server.js
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

  const today = pristinaToday();
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

// GET /api/public/collection/:token, read-only shared collection view
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

    res.json({ valid: true, collection: coll, cards: attachMedia(cards) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/mind/:token, read-only shared Collections page
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
        return { ...coll, cards: attachMedia(cards) };
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
// limited the same way the public expense endpoint is, and every failure
// (unknown slug, draft shot list, no passcode set, wrong passcode) returns the
// identical response so nothing about the panel can be enumerated.

const UNLOCK_IP_PER_MIN = 5;
const UNLOCK_SLUG_PER_MIN = 10;
// On top of the per minute limits: at most this many FAILED unlocks per slug in
// a day. Past it every attempt gets the same 429 as the minute limits.
const UNLOCK_SLUG_FAILS_PER_DAY = 50;
const DAY_MS = 86400000;
const unlockSlugFailures = new Map(); // slug -> { count, windowStart }

function checkWindowLimit(map, key, windowMs) {
  const now = Date.now();
  const rec = map.get(key) || { count: 0, windowStart: now };
  if (now - rec.windowStart > windowMs) { rec.count = 0; rec.windowStart = now; }
  return rec;
}

// The limiter maps are keyed by IPs, slugs and tokens that arrive from the
// public internet, so entries whose window has passed are swept every five
// minutes and the maps cannot grow without bound.
const SWEEP_MS = 5 * 60000;
const SWEPT = [
  [unlockIpAttempts, 60000],
  [unlockSlugAttempts, 60000],
  [editTokenAttempts, 60000],
  [unlockSlugFailures, DAY_MS],
];
function sweepLimiters(now = Date.now()) {
  SWEPT.forEach(([map, windowMs]) => {
    map.forEach((rec, key) => { if (now - rec.windowStart > windowMs) map.delete(key); });
  });
}
setInterval(sweepLimiters, SWEEP_MS).unref();

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
    const failRec = checkWindowLimit(unlockSlugFailures, slug, DAY_MS);
    if (failRec.count >= UNLOCK_SLUG_FAILS_PER_DAY) {
      return res.status(429).json({ error: 'too_many_attempts' });
    }
    // Every attempt counts, successful or not, a valid passcode is not a way
    // around the limiter.
    ipRec.count++; unlockIpAttempts.set(ip, ipRec);
    slugRec.count++; unlockSlugAttempts.set(slug, slugRec);

    const name = String((req.body && req.body.name) || '').trim().slice(0, 60);
    const passcode = (req.body && req.body.passcode) || '';
    if (!name) return res.status(400).json({ error: 'name_required' });

    // Every failure, whatever its cause, counts toward the daily cap and gets
    // the identical answer.
    const failed = () => {
      failRec.count++; unlockSlugFailures.set(slug, failRec);
      return unlockDenied(res);
    };
    const shotlist = getPublishedBySlug(slug);
    if (!shotlist || !shotlist.passcode_hash) return failed();
    if (!checkPasscode(passcode, shotlist.passcode_hash)) return failed();

    // The hash cannot say how long the passcode is, so a passcode set before
    // the 6 character minimum is measured here, the one place it is seen.
    const short = String(passcode).length < PASSCODE_MIN ? 1 : 0;
    if (shotlist.passcode_short !== short) {
      db.prepare('UPDATE shotlists SET passcode_short = ? WHERE id = ?').run(short, shotlist.id);
    }

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

// ── The First AD window ─────────────────────────────────────────────────────
// A project's moodboard, written from a public link. Viewing needs only the
// link; adding, editing or deleting a card needs the collection's passcode,
// which mints the same signed, stateless crew token the shot list uses, scoped
// to this ONE collection and dead the moment the passcode changes.
//
// Two rules the panel side does not need:
//   • a card can only be edited or deleted by whoever added it, so a link in
//     one person's hands can never rewrite another's work;
//   • a link card is enriched through the panel's own preview, so the board
//     shows a picture. fetchLinkPreview refuses private hosts and odd
//     redirects before it fetches, which is what keeps that safe.

// One row per collection, so the read-only client link and the First AD window
// share it: 'view' rows stay as they were, 'collab' rows carry the slug and
// the passcode hash.
function resolveCollab(slug) {
  const link = db.prepare(
    "SELECT * FROM collection_share_links WHERE slug = ? AND mode = 'collab' AND enabled = 1"
  ).get(String(slug || ''));
  if (!link || !link.passcode_hash) return { valid: false, reason: 'invalid' };

  const collection = db.prepare(
    'SELECT id, name, description, project_id FROM collections WHERE id = ? AND archived = 0'
  ).get(link.collection_id);
  if (!collection) return { valid: false, reason: 'invalid' };

  const project = collection.project_id
    ? db.prepare('SELECT id, title, status FROM projects WHERE id = ?').get(collection.project_id)
    : null;
  // The window closes with the production, the same rule the expense link uses.
  if (project && project.status === 'completed') {
    return { valid: false, reason: 'expired', project_title: project.title };
  }
  return { valid: true, link, collection, project };
}

// What the token is signed against: the collection id and the passcode version.
function authTarget(link) {
  return { id: link.collection_id, passcode_hash: link.passcode_hash };
}

function moodCards(collectionId) {
  return attachMedia(db.prepare(
    `SELECT id, type, url, title, note_text, thumbnail_url, source, tags, created_by
     FROM collection_cards WHERE collection_id = ?
     ORDER BY sort_order ASC, created_at DESC`
  ).all(collectionId));
}

// GET /api/public/collab/:slug, the board as it stands
router.get('/collab/:slug', (req, res) => {
  try {
    const r = resolveCollab(req.params.slug);
    if (!r.valid) {
      return res.json({ valid: false, reason: r.reason, project_title: r.project_title || null });
    }
    res.json({
      valid: true,
      collection: { name: r.collection.name, description: r.collection.description },
      project_title: r.project ? r.project.title : null,
      cards: moodCards(r.collection.id),
    });
  } catch (err) {
    console.error('Moodboard load failed:', err && err.name ? err.name : 'error');
    res.status(500).json({ error: 'load_failed' });
  }
});

// POST /api/public/collab/:slug/unlock  body: { name, passcode }
router.post('/collab/:slug/unlock', (req, res) => {
  try {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    const slug = String(req.params.slug || '');

    const ipRec = checkWindowLimit(unlockIpAttempts, ip, 60000);
    if (ipRec.count >= UNLOCK_IP_PER_MIN) return res.status(429).json({ error: 'too_many_attempts' });
    const slugRec = checkWindowLimit(unlockSlugAttempts, slug, 60000);
    if (slugRec.count >= UNLOCK_SLUG_PER_MIN) return res.status(429).json({ error: 'too_many_attempts' });
    // Keyed apart from the shot list's failures: one production's wrong
    // passcodes must never lock out another's, and vice versa.
    const failRec = checkWindowLimit(unlockSlugFailures, `mood:${slug}`, DAY_MS);
    if (failRec.count >= UNLOCK_SLUG_FAILS_PER_DAY) return res.status(429).json({ error: 'too_many_attempts' });

    ipRec.count++; unlockIpAttempts.set(ip, ipRec);
    slugRec.count++; unlockSlugAttempts.set(slug, slugRec);

    const name = String((req.body && req.body.name) || '').trim().slice(0, 60);
    const passcode = (req.body && req.body.passcode) || '';
    if (!name) return res.status(400).json({ error: 'name_required' });

    // Every failure answers identically, so nothing about the link enumerates.
    const failed = () => {
      failRec.count++; unlockSlugFailures.set(`mood:${slug}`, failRec);
      return unlockDenied(res);
    };

    const r = resolveCollab(slug);
    if (!r.valid) return failed();
    if (!checkPasscode(passcode, r.link.passcode_hash)) return failed();

    db.prepare("UPDATE collection_share_links SET last_used_at = datetime('now') WHERE id = ?").run(r.link.id);
    // Opening the window is a write of its own (last_used_at), so it is
    // attributed to the crew member rather than to a blank session.
    req.publicActor = name;
    res.locals.cosAudit = { entity_type: 'collection_access', entity_id: r.collection.id };
    res.json({ token: issueCrewToken(authTarget(r.link), name), name });
  } catch (err) {
    console.error('Moodboard unlock failed:', err && err.name ? err.name : 'error');
    res.status(500).json({ error: 'unlock_failed' });
  }
});

// Spend one edit from a device's per-minute budget; 429 when it is gone.
function spendEdit(req, res) {
  const token = (req.body && req.body.token) || '';
  const rec = checkWindowLimit(editTokenAttempts, token, 60000);
  if (rec.count >= EDIT_TOKEN_PER_MIN) {
    res.status(429).json({ error: 'too_many_edits' });
    return null;
  }
  rec.count++; editTokenAttempts.set(token, rec);
  return token;
}

// The title/thumbnail/source a link card carries. Same preview the panel grid
// stores, so the crew window and the panel show the same picture; an unsafe or
// unreachable URL falls back to a bare link, exactly as the panel does.
async function previewLink(url) {
  const fallback = { title: null, thumbnail_url: null, source: 'crew' };
  try {
    const p = await fetchLinkPreview(url);
    return {
      title: p.title || null,
      thumbnail_url: p.thumbnail_url || null,
      source: p.source || 'crew',
    };
  } catch (_) {
    return fallback;
  }
}

// POST /api/public/collab/:slug/cards
// body: JSON { token, type: 'link'|'note', url, title, note_text, tags }
//   or: multipart { token, type: 'image'|'album', title } + the image field,
//       repeated for an album (a batch of location stills on one card)
router.post('/collab/:slug/cards', async (req, res) => {
  try {
    const r = resolveCollab(req.params.slug);
    if (!r.valid) return unlockDenied(res);

    const token = spendEdit(req, res);
    if (token === null) return;
    const auth = verifyCrewToken(token, authTarget(r.link));
    if (!auth.valid) return unlockDenied(res);

    const files = req.files || [];
    const type = String((req.body && req.body.type) || (files.length ? (files.length > 1 ? 'album' : 'image') : ''));
    let title = cleanNote(req.body && req.body.title, 200);
    const note = cleanNote(req.body && req.body.note_text, 4000);
    const tags = cleanNote(req.body && req.body.tags, 200);

    const maxRes = db.prepare('SELECT MAX(sort_order) as m FROM collection_cards WHERE collection_id = ?').get(r.collection.id);
    const sortOrder = (maxRes.m === null || maxRes.m === undefined) ? 0 : maxRes.m + 1;

    // An album is one card holding many images, so the card row has to exist
    // before the images can point at it.
    if (type === 'album') {
      if (!files.length) return res.status(400).json({ error: 'images_required' });
      const result = db.prepare(
        `INSERT INTO collection_cards (collection_id, type, url, title, note_text, thumbnail_url, source, tags, sort_order, created_by)
         VALUES (?, 'album', NULL, ?, NULL, NULL, 'upload', ?, ?, ?)`
      ).run(r.collection.id, title, tags, sortOrder, auth.name || 'Crew');
      const cardId = result.lastInsertRowid;
      const insertMedia = db.prepare(
        'INSERT INTO collection_card_media (card_id, url, thumbnail_url, sort_order) VALUES (?, ?, ?, ?)'
      );
      let cover = null;
      for (let i = 0; i < files.length; i++) {
        const out = await storeImage(files[i].buffer, COLLECTION_MEDIA_DIR);
        insertMedia.run(cardId, `/collection-media/${out.filename}`, `/collection-media/${out.thumb}`, i);
        if (!cover) cover = `/collection-media/${out.thumb}`;
      }
      db.prepare('UPDATE collection_cards SET thumbnail_url = ? WHERE id = ?').run(cover, cardId);
      const card = db.prepare('SELECT * FROM collection_cards WHERE id = ?').get(cardId);
      req.publicActor = auth.name;
      res.locals.cosAudit = { entity_type: 'collection_card', entity_id: cardId };
      return res.json({ ok: true, card: attachMedia([card])[0] });
    }

    let row;
    if (type === 'image') {
      const file = files[0] || req.file;
      if (!file) return res.status(400).json({ error: 'image_required' });
      const out = await storeImage(file.buffer, COLLECTION_MEDIA_DIR);
      row = { type: 'image', url: `/collection-media/${out.filename}`, thumbnail_url: `/collection-media/${out.thumb}`, source: 'upload' };
    } else if (type === 'note') {
      if (!note) return res.status(400).json({ error: 'note_text_required' });
      row = { type: 'note', url: null, thumbnail_url: null, source: null };
    } else if (type === 'link') {
      const raw = String((req.body && req.body.url) || '').trim();
      if (!/^https?:\/\//i.test(raw)) return res.status(400).json({ error: 'url_required' });
      const link = raw.slice(0, 2000);
      const preview = await previewLink(link);
      title = title || preview.title;
      row = { type: 'link', url: link, thumbnail_url: preview.thumbnail_url, source: preview.source };
    } else {
      return res.status(400).json({ error: 'bad_type' });
    }

    const result = db.prepare(
      `INSERT INTO collection_cards (collection_id, type, url, title, note_text, thumbnail_url, source, tags, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(r.collection.id, row.type, row.url, title, note, row.thumbnail_url, row.source, tags, sortOrder, auth.name || 'Crew');

    const card = db.prepare('SELECT * FROM collection_cards WHERE id = ?').get(result.lastInsertRowid);
    // The audit row carries the crew member's name, not a blank 'andi'.
    req.publicActor = auth.name;
    res.locals.cosAudit = { entity_type: 'collection_card', entity_id: card.id };
    res.json({ ok: true, card });
  } catch (err) {
    console.error('Moodboard add failed:', err && err.name ? err.name : 'error');
    res.status(500).json({ error: 'add_failed' });
  }
});

// PUT /api/public/collab/:slug/cards/:cardId, own cards only
router.put('/collab/:slug/cards/:cardId', async (req, res) => {
  try {
    const r = resolveCollab(req.params.slug);
    if (!r.valid) return unlockDenied(res);

    const token = spendEdit(req, res);
    if (token === null) return;
    const auth = verifyCrewToken(token, authTarget(r.link));
    if (!auth.valid) return unlockDenied(res);

    const card = db.prepare('SELECT * FROM collection_cards WHERE id = ? AND collection_id = ?')
      .get(req.params.cardId, r.collection.id);
    if (!card) return res.status(404).json({ error: 'not_found' });
    if (String(card.created_by || '') !== String(auth.name || 'Crew')) {
      return res.status(403).json({ error: 'not_yours' });
    }

    const body = req.body || {};
    const title = 'title' in body ? cleanNote(body.title, 200) : card.title;
    // A note that empties its text is a mistake, not a way to blank a card:
    // clearing is what delete is for.
    const note = ('note_text' in body && card.type === 'note')
      ? (cleanNote(body.note_text, 4000) || card.note_text)
      : card.note_text;
    const tags = 'tags' in body ? cleanNote(body.tags, 200) : card.tags;
    const url = 'url' in body ? (cleanNote(body.url, 2000) || card.url) : card.url;

    // Re-preview only when a link points somewhere new, so the card never keeps
    // a stale picture. Notes and uploads keep theirs untouched.
    let thumbnail_url = card.thumbnail_url;
    let source = card.source;
    let cardTitle = title;
    if (card.type === 'link' && url !== card.url) {
      const preview = await previewLink(url);
      thumbnail_url = preview.thumbnail_url;
      source = preview.source;
      cardTitle = title || preview.title;
    }

    db.prepare('UPDATE collection_cards SET title = ?, note_text = ?, tags = ?, url = ?, thumbnail_url = ?, source = ? WHERE id = ?')
      .run(cardTitle, note, tags, url, thumbnail_url, source, card.id);

    req.publicActor = auth.name;
    res.locals.cosAudit = { entity_type: 'collection_card', entity_id: card.id };
    res.json({ ok: true, card: attachMedia([db.prepare('SELECT * FROM collection_cards WHERE id = ?').get(card.id)])[0] });
  } catch (err) {
    console.error('Moodboard edit failed:', err && err.name ? err.name : 'error');
    res.status(500).json({ error: 'update_failed' });
  }
});

// DELETE /api/public/collab/:slug/cards/:cardId, own cards only
// body or query: { token }
router.delete('/collab/:slug/cards/:cardId', (req, res) => {
  try {
    const r = resolveCollab(req.params.slug);
    if (!r.valid) return unlockDenied(res);

    const token = (req.body && req.body.token) || (req.query && req.query.token) || '';
    const auth = verifyCrewToken(token, authTarget(r.link));
    if (!auth.valid) return unlockDenied(res);

    const card = db.prepare('SELECT id, created_by FROM collection_cards WHERE id = ? AND collection_id = ?')
      .get(req.params.cardId, r.collection.id);
    if (!card) return res.status(404).json({ error: 'not_found' });
    if (String(card.created_by || '') !== String(auth.name || 'Crew')) {
      return res.status(403).json({ error: 'not_yours' });
    }

    db.prepare('DELETE FROM collection_cards WHERE id = ?').run(card.id);
    req.publicActor = auth.name;
    res.locals.cosAudit = { entity_type: 'collection_card', entity_id: card.id };
    res.json({ ok: true });
  } catch (err) {
    console.error('Moodboard delete failed:', err && err.name ? err.name : 'error');
    res.status(500).json({ error: 'delete_failed' });
  }
});

module.exports = router;
