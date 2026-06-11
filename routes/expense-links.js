const express = require('express');
const router = express.Router({ mergeParams: true });
const crypto = require('crypto');
const { db } = require('../db/database');

// GET /api/projects/:id/expense-link
router.get('/', (req, res) => {
  const link = db.prepare('SELECT * FROM expense_links WHERE project_id = ?').get(req.params.id);
  if (!link) return res.json({ exists: false });
  res.json({
    exists: true,
    is_active: !!link.is_active,
    token: link.token,
    url: `/expense/${link.token}`,
  });
});

// POST /api/projects/:id/expense-link — generate or regenerate link
router.post('/', (req, res) => {
  const project = db.prepare('SELECT id, title FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const token = crypto.randomBytes(16).toString('hex');
  const existing = db.prepare('SELECT id FROM expense_links WHERE project_id = ?').get(req.params.id);

  if (existing) {
    db.prepare('UPDATE expense_links SET token = ?, is_active = 1 WHERE project_id = ?').run(token, req.params.id);
  } else {
    db.prepare('INSERT INTO expense_links (project_id, token) VALUES (?, ?)').run(req.params.id, token);
  }

  res.json({ token, url: `/expense/${token}` });
});

// DELETE /api/projects/:id/expense-link — revoke link
router.delete('/', (req, res) => {
  db.prepare('UPDATE expense_links SET is_active = 0 WHERE project_id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
