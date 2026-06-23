const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// ── Link preview helpers ──────────────────────────────────────────────────────

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.text();
  } catch (_) {
    clearTimeout(timer);
    return null;
  }
}

async function parseOgTags(html, baseUrl) {
  let title = null;
  let thumbnail_url = null;
  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    thumbnail_url =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[property="og:image:url"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('meta[name="twitter:image:src"]').attr('content') ||
      null;
    title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').first().text().trim() ||
      null;
  } catch (_) {
    // Regex fallback when cheerio unavailable
    const imgM =
      html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    thumbnail_url = imgM ? imgM[1] : null;
    const ttlM =
      html.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i);
    title = ttlM ? ttlM[1].trim() : null;
  }

  // Resolve relative thumbnail URLs
  if (thumbnail_url && !thumbnail_url.startsWith('http')) {
    try {
      const base = new URL(baseUrl);
      thumbnail_url = thumbnail_url.startsWith('//')
        ? `${base.protocol}${thumbnail_url}`
        : new URL(thumbnail_url, base.origin).href;
    } catch (_) {
      thumbnail_url = null;
    }
  }

  return { title: title || null, thumbnail_url: thumbnail_url || null };
}

function detectSource(url) {
  try {
    const h = new URL(url).hostname.replace(/^(www\.|m\.)/, '');
    if (h.includes('pinterest.')) return 'pinterest';
    if (h.includes('behance.net')) return 'behance';
    if (h.includes('instagram.')) return 'instagram';
    if (h.includes('dribbble.')) return 'dribbble';
    if (h.includes('twitter.') || h === 'x.com') return 'twitter';
  } catch (_) {}
  return 'web';
}

async function fetchLinkPreview(rawUrl) {
  try {
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

    // YouTube
    const ytMatch = url.match(
      /(?:youtube\.com\/(?:watch\?(?:[^#&?]*&)*v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    if (ytMatch) {
      const videoId = ytMatch[1];
      try {
        const r = await fetchWithTimeout(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
          5000
        );
        if (r.ok) {
          const d = await r.json();
          return {
            title: d.title || null,
            thumbnail_url: d.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            source: 'youtube',
          };
        }
      } catch (_) {}
      return { title: null, thumbnail_url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, source: 'youtube' };
    }

    // Vimeo
    const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeoMatch) {
      try {
        const r = await fetchWithTimeout(
          `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
          5000
        );
        if (r.ok) {
          const d = await r.json();
          return { title: d.title || null, thumbnail_url: d.thumbnail_url || null, source: 'vimeo' };
        }
      } catch (_) {}
      return { title: null, thumbnail_url: null, source: 'vimeo' };
    }

    // General (Pinterest, Behance, any site)
    const source = detectSource(url);
    const html = await fetchHtml(url);
    if (!html) return { title: null, thumbnail_url: null, source };
    const { title, thumbnail_url } = await parseOgTags(html, url);
    return { title, thumbnail_url, source };
  } catch (_) {
    return { title: null, thumbnail_url: null, source: 'web' };
  }
}

function normalizeUrl(raw) {
  const s = (raw || '').trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

// ── Collection CRUD ───────────────────────────────────────────────────────────

// GET /api/collections?archived=0|1
router.get('/', (req, res) => {
  try {
    const { archived } = req.query;
    let sql = `
      SELECT c.id, c.name, c.project_id, c.description, c.archived, c.created_at,
             p.title as project_title,
             (SELECT COUNT(*) FROM collection_cards cc WHERE cc.collection_id = c.id) as card_count
      FROM collections c
      LEFT JOIN projects p ON p.id = c.project_id
    `;
    const params = [];
    if (archived !== undefined) {
      sql += ' WHERE c.archived = ?';
      params.push(Number(archived));
    }
    sql += ' ORDER BY c.project_id IS NULL ASC, c.created_at DESC';
    const collections = db.prepare(sql).all(...params);
    res.json(collections);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/collections/:id — single collection + its cards
router.get('/:id', (req, res) => {
  try {
    const coll = db.prepare(`
      SELECT c.id, c.name, c.project_id, c.description, c.archived, c.created_at,
             p.title as project_title,
             (SELECT COUNT(*) FROM collection_cards cc WHERE cc.collection_id = c.id) as card_count
      FROM collections c
      LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!coll) return res.status(404).json({ error: 'Collection not found' });

    const cards = db.prepare(
      'SELECT * FROM collection_cards WHERE collection_id = ? ORDER BY created_at DESC'
    ).all(req.params.id);

    res.json({ ...coll, cards });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collections
router.post('/', (req, res) => {
  const { name, description, project_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

  try {
    if (project_id) {
      const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(project_id);
      if (!project) return res.status(400).json({ error: 'Project not found' });

      const existing = db.prepare(`
        SELECT c.id, c.name, c.project_id, c.description, c.archived, c.created_at,
               p.title as project_title,
               (SELECT COUNT(*) FROM collection_cards cc WHERE cc.collection_id = c.id) as card_count
        FROM collections c LEFT JOIN projects p ON p.id = c.project_id
        WHERE c.project_id = ?
      `).get(project_id);
      if (existing) return res.json({ ...existing, alreadyExisted: true });

      const result = db.prepare(
        'INSERT INTO collections (name, description, project_id) VALUES (?, ?, ?)'
      ).run(name.trim(), description ? description.trim() : null, project_id);

      const created = db.prepare(`
        SELECT c.*, p.title as project_title,
          (SELECT COUNT(*) FROM collection_cards cc WHERE cc.collection_id = c.id) as card_count
        FROM collections c LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = ?
      `).get(result.lastInsertRowid);
      return res.json(created);
    }

    const result = db.prepare(
      'INSERT INTO collections (name, description, project_id) VALUES (?, ?, NULL)'
    ).run(name.trim(), description ? description.trim() : null);

    const created = db.prepare(`
      SELECT c.*, NULL as project_title,
        (SELECT COUNT(*) FROM collection_cards cc WHERE cc.collection_id = c.id) as card_count
      FROM collections c WHERE c.id = ?
    `).get(result.lastInsertRowid);
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/collections/:id
router.put('/:id', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const coll = db.prepare('SELECT id FROM collections WHERE id = ?').get(req.params.id);
  if (!coll) return res.status(404).json({ error: 'Collection not found' });
  db.prepare('UPDATE collections SET name = ?, description = ? WHERE id = ?')
    .run(name.trim(), description ? description.trim() : null, req.params.id);
  res.json({ ok: true });
});

// PATCH /api/collections/:id/archive
router.patch('/:id/archive', (req, res) => {
  const coll = db.prepare('SELECT id FROM collections WHERE id = ?').get(req.params.id);
  if (!coll) return res.status(404).json({ error: 'Collection not found' });
  const { archived } = req.body;
  if (archived === undefined) return res.status(400).json({ error: 'archived field required' });
  db.prepare('UPDATE collections SET archived = ? WHERE id = ?').run(archived ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/collections/:id
router.delete('/:id', (req, res) => {
  const coll = db.prepare('SELECT id FROM collections WHERE id = ?').get(req.params.id);
  if (!coll) return res.status(404).json({ error: 'Collection not found' });
  db.prepare('DELETE FROM collections WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Card CRUD ─────────────────────────────────────────────────────────────────

// POST /api/collections/:id/cards
router.post('/:id/cards', async (req, res) => {
  try {
    const coll = db.prepare('SELECT id FROM collections WHERE id = ?').get(req.params.id);
    if (!coll) return res.status(404).json({ error: 'Collection not found' });

    const { type, url, title, note_text, tags } = req.body;
    if (!type || !['link', 'note'].includes(type)) {
      return res.status(400).json({ error: 'type must be "link" or "note"' });
    }

    if (type === 'note') {
      if (!note_text || !note_text.trim()) {
        return res.status(400).json({ error: 'note_text is required' });
      }
      const result = db.prepare(
        'INSERT INTO collection_cards (collection_id, type, title, note_text, tags) VALUES (?, ?, ?, ?, ?)'
      ).run(req.params.id, 'note', title ? title.trim() : null, note_text.trim(), tags || null);
      const card = db.prepare('SELECT * FROM collection_cards WHERE id = ?').get(result.lastInsertRowid);
      return res.json(card);
    }

    // Link card
    if (!url || !url.trim()) return res.status(400).json({ error: 'url is required' });
    const normalUrl = normalizeUrl(url);

    let preview = { title: null, thumbnail_url: null, source: 'web' };
    try {
      preview = await fetchLinkPreview(normalUrl);
    } catch (_) {}

    const result = db.prepare(
      'INSERT INTO collection_cards (collection_id, type, url, title, thumbnail_url, source, tags) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      req.params.id, 'link', normalUrl,
      preview.title || (title ? title.trim() : null),
      preview.thumbnail_url || null,
      preview.source || 'web',
      tags || null
    );
    const card = db.prepare('SELECT * FROM collection_cards WHERE id = ?').get(result.lastInsertRowid);
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/collections/:id/cards/:cardId
router.put('/:id/cards/:cardId', async (req, res) => {
  try {
    const card = db.prepare(
      'SELECT * FROM collection_cards WHERE id = ? AND collection_id = ?'
    ).get(req.params.cardId, req.params.id);
    if (!card) return res.status(404).json({ error: 'Card not found' });

    const { title, note_text, url, tags } = req.body;

    if (card.type === 'note') {
      const newText = note_text !== undefined ? note_text : card.note_text;
      if (!newText || !newText.trim()) return res.status(400).json({ error: 'note_text cannot be empty' });
      db.prepare(
        'UPDATE collection_cards SET title = ?, note_text = ?, tags = ? WHERE id = ?'
      ).run(
        title !== undefined ? (title ? title.trim() : null) : card.title,
        newText.trim(),
        tags !== undefined ? (tags || null) : card.tags,
        card.id
      );
    } else {
      // Link card
      const newUrl = url && url.trim() ? normalizeUrl(url.trim()) : null;
      const urlChanged = newUrl && newUrl !== card.url;

      let preview = null;
      if (urlChanged) {
        try { preview = await fetchLinkPreview(newUrl); } catch (_) {}
      }

      db.prepare(
        'UPDATE collection_cards SET url = ?, title = ?, thumbnail_url = ?, source = ?, tags = ? WHERE id = ?'
      ).run(
        urlChanged ? newUrl : card.url,
        preview ? (preview.title || (title ? title.trim() : null)) : (title !== undefined ? (title ? title.trim() : null) : card.title),
        preview ? (preview.thumbnail_url || null) : card.thumbnail_url,
        preview ? (preview.source || 'web') : card.source,
        tags !== undefined ? (tags || null) : card.tags,
        card.id
      );
    }

    const updated = db.prepare('SELECT * FROM collection_cards WHERE id = ?').get(card.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/collections/:id/cards/:cardId
router.delete('/:id/cards/:cardId', (req, res) => {
  try {
    const card = db.prepare(
      'SELECT id FROM collection_cards WHERE id = ? AND collection_id = ?'
    ).get(req.params.cardId, req.params.id);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    db.prepare('DELETE FROM collection_cards WHERE id = ?').run(card.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
