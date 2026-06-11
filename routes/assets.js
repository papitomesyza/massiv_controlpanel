const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/assets/providers
router.get('/providers', (req, res) => {
  const where = req.query.all ? '' : 'WHERE ap.archived = 0';
  const rows = db.prepare(`
    SELECT ap.*,
      (SELECT COUNT(*) FROM asset_provider_items api2 WHERE api2.provider_id = ap.id) as item_count
    FROM asset_providers ap
    ${where}
    ORDER BY ap.archived ASC, ap.name ASC
  `).all();
  res.json(rows);
});

// GET /api/assets/providers/:id
router.get('/providers/:id', (req, res) => {
  const provider = db.prepare('SELECT * FROM asset_providers WHERE id = ?').get(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const items = db.prepare(`
    SELECT api.*, ai.name as item_name, ai.category
    FROM asset_provider_items api
    JOIN asset_items ai ON ai.id = api.item_id
    WHERE api.provider_id = ?
    ORDER BY ai.category, ai.name
  `).all(req.params.id);
  res.json({ ...provider, items });
});

// POST /api/assets/providers
router.post('/providers', (req, res) => {
  const { name, type, phone, email, location, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(`
    INSERT INTO asset_providers (name, type, phone, email, location, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, type || 'Rental House', phone || null, email || null, location || null, notes || null);
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/assets/providers/:id
router.put('/providers/:id', (req, res) => {
  const { name, type, phone, email, location, notes } = req.body;
  db.prepare(`
    UPDATE asset_providers SET name=?, type=?, phone=?, email=?, location=?, notes=? WHERE id=?
  `).run(name, type || 'Rental House', phone || null, email || null, location || null, notes || null, req.params.id);
  res.json({ ok: true });
});

// PUT /api/assets/providers/:id/restore
router.put('/providers/:id/restore', (req, res) => {
  db.prepare('UPDATE asset_providers SET archived=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/assets/providers/:id — archive
router.delete('/providers/:id', (req, res) => {
  db.prepare('UPDATE asset_providers SET archived=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/assets/items
router.get('/items', (req, res) => {
  const rows = db.prepare('SELECT * FROM asset_items ORDER BY category, name').all();
  res.json(rows);
});

// POST /api/assets/items
router.post('/items', (req, res) => {
  const { name, category, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(`
    INSERT INTO asset_items (name, category, description) VALUES (?, ?, ?)
  `).run(name, category || 'Other', description || null);
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/assets/items/:id
router.put('/items/:id', (req, res) => {
  const { name, category, description } = req.body;
  db.prepare('UPDATE asset_items SET name=?, category=?, description=? WHERE id=?')
    .run(name, category || 'Other', description || null, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/assets/items/:id — only if not referenced
router.delete('/items/:id', (req, res) => {
  const refs = db.prepare('SELECT COUNT(*) as c FROM asset_provider_items WHERE item_id=?').get(req.params.id);
  if (refs.c > 0) return res.status(400).json({ error: 'Item is used by one or more providers' });
  db.prepare('DELETE FROM asset_items WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/assets/provider-items/:providerId
router.get('/provider-items/:providerId', (req, res) => {
  const rows = db.prepare(`
    SELECT api.*, ai.name as item_name, ai.category, ai.description as item_description
    FROM asset_provider_items api
    JOIN asset_items ai ON ai.id = api.item_id
    WHERE api.provider_id = ?
    ORDER BY ai.category, ai.name
  `).all(req.params.providerId);
  res.json(rows);
});

// POST /api/assets/provider-items
router.post('/provider-items', (req, res) => {
  const { provider_id, item_id, daily_rate, notes } = req.body;
  if (!provider_id || !item_id) return res.status(400).json({ error: 'provider_id and item_id required' });
  try {
    const result = db.prepare(`
      INSERT INTO asset_provider_items (provider_id, item_id, daily_rate, notes)
      VALUES (?, ?, ?, ?)
    `).run(provider_id, item_id, daily_rate || 0, notes || null);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Item already linked to this provider' });
    }
    throw e;
  }
});

// PUT /api/assets/provider-items/:id
router.put('/provider-items/:id', (req, res) => {
  const { daily_rate, notes } = req.body;
  db.prepare('UPDATE asset_provider_items SET daily_rate=?, notes=? WHERE id=?')
    .run(daily_rate != null ? daily_rate : 0, notes || null, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/assets/provider-items/:id
router.delete('/provider-items/:id', (req, res) => {
  db.prepare('DELETE FROM asset_provider_items WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/assets/all-items — for Investment Estimation wizard
router.get('/all-items', (req, res) => {
  const rows = db.prepare(`
    SELECT api.*, ai.name as item_name, ai.category, ap.name as provider_name
    FROM asset_provider_items api
    JOIN asset_items ai ON ai.id = api.item_id
    JOIN asset_providers ap ON ap.id = api.provider_id
    WHERE ap.archived = 0
    ORDER BY ap.name, ai.category, ai.name
  `).all();
  res.json(rows);
});

module.exports = router;
