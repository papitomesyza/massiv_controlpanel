const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

router.get('/expense-categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM expense_categories ORDER BY name').all());
});

router.post('/expense-categories', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare('INSERT INTO expense_categories (name, is_default) VALUES (?, 0)').run(name);
  res.json({ id: result.lastInsertRowid });
});

router.delete('/expense-categories/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Not found' });
  if (cat.is_default) return res.status(400).json({ error: 'Cannot delete default category' });
  db.prepare('DELETE FROM expense_categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/project-categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM project_categories ORDER BY group_name, name').all());
});

router.post('/project-categories', (req, res) => {
  const { name, group_name } = req.body;
  if (!name || !group_name) return res.status(400).json({ error: 'Name and group required' });
  const result = db.prepare('INSERT INTO project_categories (name, group_name, is_default) VALUES (?, ?, 0)').run(name, group_name);
  res.json({ id: result.lastInsertRowid });
});

router.delete('/project-categories/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM project_categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Not found' });
  if (cat.is_default) return res.status(400).json({ error: 'Cannot delete default category' });
  db.prepare('DELETE FROM project_categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/crew-roles', (req, res) => {
  res.json(db.prepare('SELECT * FROM crew_roles ORDER BY name').all());
});

router.post('/crew-roles', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare('INSERT INTO crew_roles (name, is_default) VALUES (?, 0)').run(name);
  res.json({ id: result.lastInsertRowid });
});

router.delete('/crew-roles/:id', (req, res) => {
  const role = db.prepare('SELECT * FROM crew_roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Not found' });
  if (role.is_default) return res.status(400).json({ error: 'Cannot delete default role' });
  db.prepare('DELETE FROM crew_roles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/settings/agency — returns all three branding fields as one object
router.get('/agency', (req, res) => {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('agency_name', 'agency_tagline', 'agency_logo')"
  ).all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  res.json({
    agency_name: map.agency_name || null,
    agency_tagline: map.agency_tagline || null,
    agency_logo_base64: map.agency_logo || null,
  });
});

// POST /api/settings/agency — saves all three branding fields atomically
router.post('/agency', (req, res) => {
  const { agency_name, agency_tagline, agency_logo_base64 } = req.body;
  const setOrDelete = (key, value) => {
    if (value === null || value === undefined || value === '') {
      db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    } else {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    }
  };
  if (agency_name !== undefined) setOrDelete('agency_name', agency_name);
  if (agency_tagline !== undefined) setOrDelete('agency_tagline', agency_tagline);
  if (agency_logo_base64 !== undefined) setOrDelete('agency_logo', agency_logo_base64);
  res.json({ ok: true });
});

router.post('/logo', (req, res) => {
  const { base64 } = req.body;
  if (base64 === undefined) return res.status(400).json({ error: 'base64 required' });
  if (base64 === '' || base64 === null) {
    db.prepare("DELETE FROM settings WHERE key = 'agency_logo'").run();
  } else {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('agency_logo', ?)").run(base64);
  }
  res.json({ ok: true });
});

router.get('/logo', (req, res) => {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'agency_logo'").get();
  res.json({ base64: setting ? setting.value : null });
});

router.post('/', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  if (value === null || value === undefined || value === '') {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  rows.forEach(r => { result[r.key] = r.value; });
  res.json(result);
});

router.get('/:key', (req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(req.params.key);
  res.json({ value: row ? row.value : null });
});

router.post('/change-password', (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('password', ?)").run(newPassword);
  const token = Buffer.from(newPassword).toString('base64');
  res.json({ token });
});

module.exports = router;
