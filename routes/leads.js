const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/leads — all active leads with client + category names
router.get('/', (req, res) => {
  const leads = db.prepare(`
    SELECT l.*,
      COALESCE(c.name, l.client_name_manual) AS client_name,
      COALESCE(pc.name, l.category_name_manual) AS category_name
    FROM leads l
    LEFT JOIN clients c ON c.id = l.client_id
    LEFT JOIN project_categories pc ON pc.id = l.category_id
    WHERE l.status = 'active'
    ORDER BY l.created_at DESC
  `).all();
  res.json(leads);
});

// POST /api/leads — create a new lead
router.post('/', (req, res) => {
  const { client_id, client_name_manual, category_id, category_name_manual, note, contacted_at } = req.body;
  const result = db.prepare(`
    INSERT INTO leads (client_id, client_name_manual, category_id, category_name_manual, note, contacted_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    client_id || null,
    client_name_manual || null,
    category_id || null,
    category_name_manual || null,
    note || null,
    contacted_at || new Date().toISOString().split('T')[0]
  );
  const lead = db.prepare(`
    SELECT l.*,
      COALESCE(c.name, l.client_name_manual) AS client_name,
      COALESCE(pc.name, l.category_name_manual) AS category_name
    FROM leads l
    LEFT JOIN clients c ON c.id = l.client_id
    LEFT JOIN project_categories pc ON pc.id = l.category_id
    WHERE l.id = ?
  `).get(result.lastInsertRowid);
  res.json(lead);
});

// DELETE /api/leads/:id — hard delete
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// PUT /api/leads/:id/dismiss — soft dismiss
router.put('/:id/dismiss', (req, res) => {
  db.prepare("UPDATE leads SET status = 'dismissed' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// POST /api/leads/:id/convert — return lead data for pre-fill, then delete
router.post('/:id/convert', (req, res) => {
  const lead = db.prepare(`
    SELECT l.*,
      COALESCE(c.name, l.client_name_manual) AS client_name,
      COALESCE(pc.name, l.category_name_manual) AS category_name
    FROM leads l
    LEFT JOIN clients c ON c.id = l.client_id
    LEFT JOIN project_categories pc ON pc.id = l.category_id
    WHERE l.id = ?
  `).get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json(lead);
});

module.exports = router;
