const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/collections
router.get('/', (req, res) => {
  try {
    const collections = db.prepare(`
      SELECT c.id, c.name, c.project_id, c.description, c.created_at,
             p.title as project_title,
             (SELECT COUNT(*) FROM collection_cards cc WHERE cc.collection_id = c.id) as card_count
      FROM collections c
      LEFT JOIN projects p ON p.id = c.project_id
      ORDER BY c.project_id IS NULL ASC, c.created_at DESC
    `).all();
    res.json(collections);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collections — create OTHER collection only (project_id always null)
router.post('/', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const result = db.prepare(
      'INSERT INTO collections (name, description, project_id) VALUES (?, ?, NULL)'
    ).run(name.trim(), description ? description.trim() : null);
    const collection = db.prepare(`
      SELECT c.*, NULL as project_title,
        (SELECT COUNT(*) FROM collection_cards cc WHERE cc.collection_id = c.id) as card_count
      FROM collections c WHERE c.id = ?
    `).get(result.lastInsertRowid);
    res.json(collection);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/collections/:id — rename / edit description
router.put('/:id', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const coll = db.prepare('SELECT id FROM collections WHERE id = ?').get(req.params.id);
  if (!coll) return res.status(404).json({ error: 'Collection not found' });
  db.prepare('UPDATE collections SET name = ?, description = ? WHERE id = ?')
    .run(name.trim(), description ? description.trim() : null, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/collections/:id — only OTHER collections (project_id IS NULL)
router.delete('/:id', (req, res) => {
  const coll = db.prepare('SELECT id, project_id FROM collections WHERE id = ?').get(req.params.id);
  if (!coll) return res.status(404).json({ error: 'Collection not found' });
  if (coll.project_id !== null) {
    return res.status(403).json({ error: 'Project collections cannot be deleted directly. Delete the project to remove it.' });
  }
  db.prepare('DELETE FROM collections WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
