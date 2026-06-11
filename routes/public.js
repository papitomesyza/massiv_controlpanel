const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

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
  const result = resolveToken(req.params.token);
  if (!result.valid) return res.status(403).json({ error: result.reason });

  const { category, custom_category, amount, description, submitted_by } = req.body;
  if (!amount) return res.status(400).json({ error: 'Amount required' });

  const categoryName = category === 'custom' ? (custom_category || 'Custom') : (category || 'Miscellaneous');
  let catRow = db.prepare('SELECT id FROM expense_categories WHERE name = ?').get(categoryName);
  if (!catRow) {
    const r = db.prepare('INSERT INTO expense_categories (name, is_default) VALUES (?, 0)').run(categoryName);
    catRow = { id: r.lastInsertRowid };
  }

  const today = new Date().toISOString().slice(0, 10);
  const imagePath = req.file ? req.file.filename : null;

  db.prepare(
    'INSERT INTO expenses (project_id, category_id, amount, date, notes, submitted_by, invoice_image_path, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(result.project_id, catRow.id, parseFloat(amount), today, description || null, submitted_by || null, imagePath, 'link');

  res.json({ success: true });
});

// GET /api/public/expense-categories
router.get('/expense-categories', (req, res) => {
  const cats = db.prepare('SELECT name FROM expense_categories ORDER BY name').all();
  res.json(cats.map(c => c.name));
});

module.exports = router;
