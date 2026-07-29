const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { db } = require('../db/database');
const { renderPresentation, SECTION_TYPES } = require('../lib/renderPresentation');
const { publicPitchBase } = require('../lib/pitchDomain');

function getMediaDir() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'presentation-media');
}

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

// ── Media upload — images only, sharp produces web + thumb, original discarded ──

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file required (jpeg, png or webp, max 25MB)' });
  const mediaDir = getMediaDir();
  if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

  const base = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const webName = `${base}-web.jpg`;
  const thumbName = `${base}-thumb.jpg`;
  try {
    const image = sharp(req.file.buffer, { failOn: 'none' }).rotate();
    await image.clone()
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(mediaDir, webName));
    await image.clone()
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(path.join(mediaDir, thumbName));
    res.json({ filename: webName, thumb: thumbName });
  } catch (err) {
    res.status(400).json({ error: `Could not process image: ${err.message}` });
  }
});

// ── AI copy polish (Opus) ─────────────────────────────────────────────────────
// Declared before the /:id routes so "ai-status" is never read as an id.

const POLISH_SYSTEM = [
  'You are a copywriter and copy editor for premium photography and film production pitches.',
  'Given one piece of pitch copy, write THREE alternative versions of it for the writer to choose from.',
  'Every version fixes any grammar and spelling mistakes, reads clearly, and preserves the original meaning and approximate length.',
  'Make the three genuinely different from one another in phrasing, rhythm or emphasis, not the same sentence with one word swapped. Keep the tone confident, minimal and premium.',
  'Inputs arrive in English or Albanian, and a single text may mix both. Always reply in the language of the input: English input gets English output, Albanian input gets Albanian output. If a text mixes languages, keep each part in its original language. Never translate in either direction. Apply the same fixes with native fluency in both languages. Albanian output uses proper Albanian orthography, including ë and ç, even when the input was typed without diacritics.',
  'Never use em dashes or en dashes anywhere in the output. Restructure with commas, periods, or shorter sentences instead. If the input contains them, remove them in the rewrite.',
  'Return ONLY a JSON array of exactly three strings, for example ["first version","second version","third version"].',
  'No preamble, no commentary, no markdown code fences, no numbering, no object keys.',
].join(' ');

// Belt and suspenders: whatever the model returns, this endpoint is physically
// incapable of emitting a long dash.
function scrubDashes(text) {
  let out = String(text == null ? '' : text);
  out = out.replace(/[ \t]*[—―][ \t]*/g, ', ');     // em dash / horizontal bar
  out = out.replace(/(\d)[ \t]*–[ \t]*(\d)/g, '$1-$2');  // en dash between digits
  out = out.replace(/[ \t]*–[ \t]*/g, ', ');             // any remaining en dash
  out = out.replace(/[ \t]{2,}/g, ' ');                            // doubled spaces
  out = out.replace(/,[ \t]*,/g, ',');                             // ", ," artifacts
  out = out.replace(/[ \t]+([,.!?;:])/g, '$1');
  out = out.replace(/^[ \t,]+/, '');
  return out.trim();
}

// The model is asked for a bare JSON array. Parse defensively anyway: strip
// code fences, fall back to the first bracketed block, then to a numbered or
// line-separated list, so a chatty response still yields usable options.
function parseVariants(raw) {
  let s = String(raw || '').trim()
    .replace(/^```(?:json)?[ \t]*\r?\n?/i, '')
    .replace(/```\s*$/, '')
    .trim();

  let arr = null;
  try {
    const p = JSON.parse(s);
    if (Array.isArray(p)) arr = p;
  } catch (_) {}
  if (!arr) {
    const m = s.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const p = JSON.parse(m[0]);
        if (Array.isArray(p)) arr = p;
      } catch (_) {}
    }
  }
  if (!arr) {
    arr = s.split(/\r?\n+/)
      .map(l => l.replace(/^[ \t]*(?:\d+[.)]|[-*•])[ \t]*/, '').replace(/^["']|["',]+$/g, '').trim())
      .filter(Boolean);
  }

  const out = [];
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const t = scrubDashes(v);
    if (t && !out.includes(t)) out.push(t);
    if (out.length === 3) break;
  }
  return out;
}

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

router.get('/ai-status', (req, res) => {
  try {
    res.json({ enabled: !!process.env.ANTHROPIC_API_KEY });
  } catch (_) {
    res.json({ enabled: false });
  }
});

router.post('/ai-polish', async (req, res) => {
  try {
    const text = req.body && typeof req.body.text === 'string' ? req.body.text : '';
    if (!text.trim()) return res.status(400).json({ error: 'text required' });
    if (text.length > 2000) return res.status(400).json({ error: 'text too long (max 2000 characters)' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(501).json({ error: 'not_configured' });

    const controller = new AbortController();
    // Three variants of a long field take longer than a single rewrite did
    const timer = setTimeout(() => controller.abort(), 30000);
    let upstream;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          // room for three rewrites of a 2000-character field plus JSON syntax
          max_tokens: 3000,
          system: POLISH_SYSTEM,
          messages: [{ role: 'user', content: text }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      console.error('AI polish upstream error:', upstream.status);
      return res.status(502).json({ error: 'polish_failed' });
    }

    const data = await upstream.json();
    const blocks = Array.isArray(data && data.content) ? data.content : [];
    const raw = blocks.filter(b => b && b.type === 'text').map(b => b.text || '').join('').trim();
    if (!raw) return res.status(502).json({ error: 'polish_failed' });

    const variants = parseVariants(raw);
    if (variants.length === 0) return res.status(502).json({ error: 'polish_failed' });

    res.json({ variants });
  } catch (err) {
    // Never log the user's text content
    console.error('AI polish failed:', err && err.name ? err.name : 'error');
    res.status(502).json({ error: 'polish_failed' });
  }
});

// ── Presentations CRUD ────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM presentation_sections s WHERE s.presentation_id = p.id) AS section_count
    FROM presentations p ORDER BY p.updated_at DESC
  `).all();
  res.json({
    templates: rows.filter(r => r.is_template),
    pitches: rows.filter(r => !r.is_template),
  });
});

router.post('/', (req, res) => {
  const { title, category, accent_color } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });
  const result = db.prepare(
    "INSERT INTO presentations (title, category, accent_color, status) VALUES (?, ?, ?, 'draft')"
  ).run(title.trim(), category || null, accent_color || '#723CEB');
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
  // DB rows only — media file cleanup is out of scope for phase 1
  db.prepare('DELETE FROM presentations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Duplicate — used by "new from template" and general duplication.
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
      "INSERT INTO presentations (title, category, accent_color, status, slug, is_template) VALUES (?, ?, ?, 'draft', NULL, 0)"
    ).run(newTitle, original.category, original.accent_color);
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

// Reorder — ordered id array, transaction (same pattern as tasks reorder)
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
  res.json({ ok: true, slug });
});

router.post('/:id/unpublish', (req, res) => {
  const r = db.prepare("UPDATE presentations SET status = 'draft', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Presentation not found' });
  res.json({ ok: true });
});

// ── Preview — same rendered HTML as the public route, drafts included ─────────
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

module.exports = router;
