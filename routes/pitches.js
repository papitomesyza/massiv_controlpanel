const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db } = require('../db/database');
const { singleImageUpload, storeImage, isSafeMediaName } = require('../lib/mediaStore');
const { renderPresentation, SECTION_TYPES } = require('../lib/renderPresentation');
const { publicPitchBase } = require('../lib/pitchDomain');
const { renderPresentationPdf } = require('../lib/renderPresentationPdf');
const { hashPasscode, PASSCODE_MIN } = require('../lib/shotlistAuth');

function getMediaDir() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'presentation-media');
}

// Where the Collections (the Mind) store their uploaded images. A treatment
// pulls a COPY from here, so deleting the collection later cannot break a
// treatment that already used the picture.
function getCollectionMediaDir() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'collection-media');
}

const KINDS = ['photography', 'treatment'];

function touch(id) {
  db.prepare("UPDATE presentations SET updated_at = datetime('now') WHERE id = ?").run(id);
}

function getAgency() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('agency_name', 'agency_logo')").all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  return { name: map.agency_name || null, logo: map.agency_logo || null };
}

function getSections(presentationId) {
  return db.prepare(
    'SELECT * FROM presentation_sections WHERE presentation_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(presentationId);
}

function parseSection(row) {
  let content = {};
  try { content = JSON.parse(row.content || '{}'); } catch (_) {}
  return { id: row.id, type: row.type, sort_order: row.sort_order, content };
}

// ── Media upload: images only, sharp produces web + thumb, original discarded ──
// The processing itself lives in lib/mediaStore.js, shared with shot list
// media. Same rules, same output, same presentation-media folder as before.

// Same limits as the shot list uploader: one image, jpeg, png, webp or gif,
// 25MB, each refusal with its own status and message.
router.post('/upload', singleImageUpload('image'), async (req, res) => {
  try {
    const out = await storeImage(req.file.buffer, getMediaDir());
    res.json({ filename: out.filename, thumb: out.thumb });
  } catch (err) {
    res.status(400).json({ error: `Could not process image: ${err.message}` });
  }
});

// ── Public link base ──────────────────────────────────────────────────────────
// Declared before the /:id routes so "public-base" is never read as an id.
// The panel builds every client-facing pitch URL from this, so a configured
// PUBLIC_PITCH_DOMAIN is what gets copied and sent, not the panel's origin.

router.get('/public-base', (req, res) => {
  try {
    res.json(publicPitchBase(req));
  } catch (_) {
    const host = req.get('host') || '';
    res.json({ base: `${req.protocol}://${host}`, host, custom: false });
  }
});

// ── Pulling pictures in from the Collections (the Mind) ───────────────────────
// Declared before the /:id routes: these are single-segment paths and would
// otherwise be read as an id. A treatment copies the picture it picks, so a
// later edit or delete in the collection cannot change a sent treatment.

function collectionMediaName(url) {
  const m = String(url || '').match(/^\/collection-media\/([^/]+)$/);
  if (!m) return null;
  return isSafeMediaName(m[1]) ? m[1] : null;
}

router.get('/collection-images', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT c.id AS collection_id, c.name AS collection_name, cc.id AS card_id, cc.title,
             cc.url, cc.thumbnail_url
      FROM collection_cards cc JOIN collections c ON c.id = cc.collection_id
      WHERE cc.type = 'image' AND cc.url IS NOT NULL
      UNION ALL
      SELECT c.id AS collection_id, c.name AS collection_name, cc.id AS card_id, cc.title,
             m.url, m.thumbnail_url
      FROM collection_card_media m
      JOIN collection_cards cc ON cc.id = m.card_id
      JOIN collections c ON c.id = cc.collection_id
    `).all();

    const byCollection = new Map();
    for (const row of rows) {
      const filename = collectionMediaName(row.url);
      if (!filename) continue;
      if (!byCollection.has(row.collection_id)) {
        byCollection.set(row.collection_id, { id: row.collection_id, name: row.collection_name, images: [] });
      }
      byCollection.get(row.collection_id).images.push({
        filename,
        thumb: collectionMediaName(row.thumbnail_url) || filename,
        title: row.title || '',
      });
    }
    res.json({ collections: [...byCollection.values()] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /import-collection-image  body: { filename }
// The filename is the collection copy; it is re-stored into the pitch media
// store so the treatment owns its own web + thumbnail pair.
router.post('/import-collection-image', async (req, res) => {
  try {
    const filename = String((req.body && req.body.filename) || '');
    if (!isSafeMediaName(filename)) return res.status(400).json({ error: 'bad_filename' });
    const src = path.join(getCollectionMediaDir(), filename);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'not_found' });
    const out = await storeImage(fs.readFileSync(src), getMediaDir());
    res.json({ filename: out.filename, thumb: out.thumb });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Presentations CRUD ────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  // Optional kind filter: the Photography list asks for 'photography', the
  // Director Treatments list for 'treatment'. No kind returns both, so an older
  // caller keeps working.
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : null;
  const rows = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM presentation_sections s WHERE s.presentation_id = p.id) AS section_count
    FROM presentations p ${kind ? "WHERE COALESCE(p.kind, 'photography') = ?" : ''} ORDER BY p.updated_at DESC
  `).all(...(kind ? [kind] : []));
  // The first image in a pitch's running order is its cover on the list.
  const coverStmt = db.prepare(
    'SELECT content FROM presentation_sections WHERE presentation_id = ? ORDER BY sort_order ASC, id ASC'
  );
  const coverOf = id => {
    for (const row of coverStmt.all(id)) {
      let c = {};
      try { c = JSON.parse(row.content || '{}'); } catch (_) { continue; }
      const name = c.image || (Array.isArray(c.images) && c.images.find(Boolean));
      if (name && typeof name === 'string' && !/[/\\]/.test(name)) return name;
    }
    return null;
  };
  res.json({
    templates: rows.filter(r => r.is_template),
    pitches: rows.filter(r => !r.is_template).map(r => ({ ...r, cover: coverOf(r.id) })),
  });
});

router.post('/', (req, res) => {
  const { title, category, accent_color } = req.body;
  const kind = KINDS.includes(req.body.kind) ? req.body.kind : 'photography';
  // Same check the update route makes: a colour reaches CSS, so it is a hex
  // string or it is the default, never whatever the client sent.
  const accent = (typeof accent_color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(accent_color))
    ? accent_color : '#723CEB';
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });
  const result = db.prepare(
    "INSERT INTO presentations (title, category, accent_color, kind, status) VALUES (?, ?, ?, ?, 'draft')"
  ).run(title.trim(), category || null, accent, kind);
  res.json({ id: result.lastInsertRowid });
});

router.get('/:id', (req, res) => {
  const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!pres) return res.status(404).json({ error: 'Presentation not found' });
  res.json({ ...pres, sections: getSections(pres.id).map(parseSection) });
});

router.put('/:id', (req, res) => {
  const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!pres) return res.status(404).json({ error: 'Presentation not found' });

  const { title, category, accent_color, slug } = req.body;
  if (title !== undefined && (!title || !title.trim())) {
    return res.status(400).json({ error: 'Title cannot be empty' });
  }
  if (accent_color !== undefined && !/^#[0-9a-fA-F]{3,8}$/.test(accent_color)) {
    return res.status(400).json({ error: 'Invalid accent color' });
  }

  let newSlug = pres.slug;
  if (slug !== undefined && slug !== pres.slug) {
    if (slug === null || slug === '') {
      newSlug = null;
    } else {
      const cleaned = String(slug).toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (!cleaned) return res.status(400).json({ error: 'Invalid slug' });
      const clash = db.prepare('SELECT id FROM presentations WHERE slug = ? AND id != ?').get(cleaned, pres.id);
      if (clash) return res.status(400).json({ error: 'Slug already in use' });
      newSlug = cleaned;
    }
  }

  db.prepare(`
    UPDATE presentations SET title = ?, category = ?, accent_color = ?, slug = ?, updated_at = datetime('now') WHERE id = ?
  `).run(
    title !== undefined ? title.trim() : pres.title,
    category !== undefined ? (category || null) : pres.category,
    accent_color !== undefined ? accent_color : pres.accent_color,
    newSlug,
    pres.id
  );
  res.json({ ok: true, slug: newSlug });
});

router.delete('/:id', (req, res) => {
  // DB rows only; media file cleanup is out of scope for phase 1
  db.prepare('DELETE FROM presentation_share_links WHERE presentation_id = ?').run(req.params.id);
  db.prepare('DELETE FROM presentations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Duplicate, used by "new from template" and general duplication.
// Media files are referenced, not copied. An optional sectionIds array copies
// only those sections (order preserved); omitted means every section.
router.post('/:id/duplicate', (req, res) => {
  const original = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Presentation not found' });

  const { title, sectionIds } = req.body || {};
  const newTitle = (title && title.trim()) || `${original.title} Copy`;

  let sections = getSections(original.id);
  if (sectionIds !== undefined) {
    if (!Array.isArray(sectionIds)) return res.status(400).json({ error: 'sectionIds must be an array' });
    const wanted = new Set(sectionIds.map(Number));
    sections = sections.filter(s => wanted.has(s.id));
    if (sections.length === 0) return res.status(400).json({ error: 'Select at least one section' });
  }

  const duplicate = db.transaction(() => {
    const r = db.prepare(
      "INSERT INTO presentations (title, category, accent_color, kind, status, slug, is_template) VALUES (?, ?, ?, ?, 'draft', NULL, 0)"
    ).run(newTitle, original.category, original.accent_color, original.kind || 'photography');
    const newId = r.lastInsertRowid;
    const insert = db.prepare(
      'INSERT INTO presentation_sections (presentation_id, type, sort_order, content) VALUES (?, ?, ?, ?)'
    );
    // Re-index so a partial selection has no gaps in sort_order
    sections.forEach((s, i) => insert.run(newId, s.type, i, s.content));
    return newId;
  });
  res.json({ id: duplicate() });
});

// ── Sections ──────────────────────────────────────────────────────────────────

router.post('/:id/sections', (req, res) => {
  const pres = db.prepare('SELECT id FROM presentations WHERE id = ?').get(req.params.id);
  if (!pres) return res.status(404).json({ error: 'Presentation not found' });

  const { type, content } = req.body;
  if (!SECTION_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid section type' });
  if (content === undefined || typeof content !== 'object' || content === null || Array.isArray(content)) {
    return res.status(400).json({ error: 'content object required' });
  }

  const maxRow = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM presentation_sections WHERE presentation_id = ?').get(pres.id);
  const result = db.prepare(
    'INSERT INTO presentation_sections (presentation_id, type, sort_order, content) VALUES (?, ?, ?, ?)'
  ).run(pres.id, type, maxRow.m + 1, JSON.stringify(content));
  touch(pres.id);
  res.json({ id: result.lastInsertRowid });
});

// Reorder: ordered id array, transaction (same pattern as tasks reorder)
router.patch('/:id/sections/reorder', (req, res) => {
  const { sectionIds } = req.body;
  if (!Array.isArray(sectionIds)) return res.status(400).json({ error: 'sectionIds array required' });
  const update = db.prepare('UPDATE presentation_sections SET sort_order = ? WHERE id = ? AND presentation_id = ?');
  const updateAll = db.transaction(ids => {
    ids.forEach((sid, index) => update.run(index, sid, req.params.id));
  });
  updateAll(sectionIds);
  touch(req.params.id);
  res.json({ ok: true });
});

router.put('/:id/sections/:sectionId', (req, res) => {
  const { content } = req.body;
  if (content === undefined || typeof content !== 'object' || content === null || Array.isArray(content)) {
    return res.status(400).json({ error: 'content object required' });
  }
  const r = db.prepare('UPDATE presentation_sections SET content = ? WHERE id = ? AND presentation_id = ?')
    .run(JSON.stringify(content), req.params.sectionId, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Section not found' });
  touch(req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/sections/:sectionId', (req, res) => {
  db.prepare('DELETE FROM presentation_sections WHERE id = ? AND presentation_id = ?')
    .run(req.params.sectionId, req.params.id);
  touch(req.params.id);
  res.json({ ok: true });
});

// ── Publish / unpublish ───────────────────────────────────────────────────────

function generateSlug(title, excludeId) {
  const base = String(title).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'pitch';
  let slug = base;
  let n = 2;
  const exists = db.prepare('SELECT id FROM presentations WHERE slug = ? AND id != ?');
  while (exists.get(slug, excludeId)) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

router.post('/:id/publish', (req, res) => {
  const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!pres) return res.status(404).json({ error: 'Presentation not found' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM presentation_sections WHERE presentation_id = ?').get(pres.id).c;
  if (count === 0) return res.status(400).json({ error: 'Add at least one section before publishing' });

  const slug = pres.slug || generateSlug(pres.title, pres.id);
  db.prepare(`
    UPDATE presentations SET status = 'published', slug = ?, published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `).run(slug, pres.id);
  // Symmetric with unpublish: publishing hands the window back to the First AD,
  // on the passcode already issued, without a trip to the panel to re-enable it.
  db.prepare('UPDATE presentation_share_links SET enabled = 1 WHERE presentation_id = ?').run(pres.id);
  res.json({ ok: true, slug });
});

router.post('/:id/unpublish', (req, res) => {
  const r = db.prepare("UPDATE presentations SET status = 'draft', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Presentation not found' });
  // Withdrawing the document also closes its window: an unpublished treatment
  // must not stay writable through a link somebody already has.
  db.prepare('UPDATE presentation_share_links SET enabled = 0 WHERE presentation_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Preview: same rendered HTML as the public route, drafts included ─────────
// The builder embeds this in an iframe which cannot send an Authorization
// header, so server.js authenticates this one route via a ?token= query
// parameter validated against the sessions table (the only endpoint allowed
// to do query-token auth).
router.get('/:id/preview', (req, res) => {
  const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!pres) return res.status(404).json({ error: 'Presentation not found' });
  const origin = `${req.protocol}://${req.get('host')}`;
  // isPreview: empty image slots show dashed placeholders here and nowhere else
  const html = renderPresentation(pres, getSections(pres.id), { origin, agency: getAgency(), isPreview: true });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(html);
});

// ── Director Treatment: the PDF, and the First AD window ─────────────────────
// The PDF is the same document as the published page, laid out by PDFKit (the
// same library the shot lists and invoices already use), so the treatment
// leaves the panel as a file without a browser in the loop.
router.get('/:id/pdf', (req, res) => {
  const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!pres) return res.status(404).json({ error: 'Presentation not found' });
  const origin = `${req.protocol}://${req.get('host')}`;
  const name = String(pres.slug || pres.title || 'treatment').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name || 'treatment'}.pdf"`);
  renderPresentationPdf(res, pres, getSections(pres.id), { origin, agency: getAgency() });
});

// One window per treatment, opened with a passcode, that lets the First AD
// write straight into the treatment's sections. Same shape as the project
// collection's collab link, so crew learn one flow for both.
function treatmentSlug(title) {
  const base = String(title || 'treatment').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || 'treatment';
}

function uniqueTreatmentSlug(title) {
  for (let i = 0; i < 20; i++) {
    const slug = `${treatmentSlug(title)}-${crypto.randomBytes(3).toString('hex')}`;
    const taken = db.prepare('SELECT 1 FROM presentation_share_links WHERE slug = ?').get(slug);
    if (!taken) return slug;
  }
  return `${treatmentSlug(title)}-${Date.now().toString(36)}`;
}

router.get('/:id/collab-link', (req, res) => {
  try {
    const link = db.prepare('SELECT * FROM presentation_share_links WHERE presentation_id = ?').get(req.params.id);
    if (!link || !link.slug || !link.passcode_hash) return res.json({ has_link: false });
    res.json({
      has_link: true,
      enabled: link.enabled ? 1 : 0,
      slug: link.slug,
      url: `${publicPitchBase(req).base}/t/${link.slug}`,
      last_used_at: link.last_used_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/collab-link', (req, res) => {
  try {
    const pres = db.prepare('SELECT id, title FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'Presentation not found' });

    const passcode = String((req.body && req.body.passcode) || '');
    if (passcode.length < PASSCODE_MIN) {
      return res.status(400).json({ error: `Passcode must be at least ${PASSCODE_MIN} characters` });
    }

    const existing = db.prepare('SELECT * FROM presentation_share_links WHERE presentation_id = ?').get(pres.id);
    const slug = existing ? existing.slug : uniqueTreatmentSlug(pres.title);
    if (existing) {
      db.prepare('UPDATE presentation_share_links SET passcode_hash = ?, enabled = 1 WHERE id = ?')
        .run(hashPasscode(passcode), existing.id);
    } else {
      // One link per presentation: a straggler from a concurrent create would
      // otherwise make the GET pick whichever row SQLite hands back first.
      db.prepare('DELETE FROM presentation_share_links WHERE presentation_id = ?').run(pres.id);
      db.prepare('INSERT INTO presentation_share_links (presentation_id, slug, passcode_hash) VALUES (?, ?, ?)')
        .run(pres.id, slug, hashPasscode(passcode));
    }
    res.json({ ok: true, url: `${publicPitchBase(req).base}/t/${slug}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
