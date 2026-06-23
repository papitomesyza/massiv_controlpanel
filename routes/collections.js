const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/collections?archived=0|1  (defaults to returning all; frontend splits)
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

// GET /api/collections/:id — single collection
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
    res.json(coll);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collections — create collection (project or other)
// Body: { name, description?, project_id? }
// If project_id is provided, validates the project exists and enforces one-per-project.
// If a collection already exists for that project, returns 409 with the existing collection.
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

    // Other collection (project_id null)
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

// PATCH /api/collections/:id/archive — toggle archived flag
router.patch('/:id/archive', (req, res) => {
  const coll = db.prepare('SELECT id FROM collections WHERE id = ?').get(req.params.id);
  if (!coll) return res.status(404).json({ error: 'Collection not found' });
  const { archived } = req.body;
  if (archived === undefined) return res.status(400).json({ error: 'archived field required' });
  db.prepare('UPDATE collections SET archived = ? WHERE id = ?').run(archived ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/collections/:id — both project and other collections
router.delete('/:id', (req, res) => {
  const coll = db.prepare('SELECT id FROM collections WHERE id = ?').get(req.params.id);
  if (!coll) return res.status(404).json({ error: 'Collection not found' });
  db.prepare('DELETE FROM collections WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
