const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { db } = require('../db/database');

// Keys that must never be read or written through the generic settings API.
const PROTECTED_KEYS = ['password_hash'];
// Keys that may be updated with a real value but must never be deleted via the
// empty-value path (deleting them would corrupt invoicing / tax config).
const NO_DELETE_KEYS = ['invoice_next_num', 'invoice_year', 'tax_rate', 'tax_enabled', 'tax_label'];

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
  const usage = db.prepare('SELECT COUNT(*) as n FROM expenses WHERE category_id = ?').get(req.params.id).n;
  if (usage > 0) return res.status(400).json({ error: `Cannot delete: used by ${usage} expense${usage > 1 ? 's' : ''}` });
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
  const usage = db.prepare('SELECT COUNT(*) as n FROM projects WHERE category_id = ?').get(req.params.id).n;
  if (usage > 0) return res.status(400).json({ error: `Cannot delete: used by ${usage} project${usage > 1 ? 's' : ''}` });
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
  if (PROTECTED_KEYS.includes(key)) return res.status(403).json({ error: 'Forbidden' });
  if (value === null || value === undefined || value === '') {
    if (NO_DELETE_KEYS.includes(key)) return res.status(403).json({ error: 'This setting cannot be deleted' });
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT key, value FROM settings WHERE key NOT IN (${PROTECTED_KEYS.map(() => '?').join(',')})`
  ).all(...PROTECTED_KEYS);
  const result = {};
  rows.forEach(r => { result[r.key] = r.value; });
  res.json(result);
});

// Tax configuration — must be before the /:key catch-all
router.get('/tax', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('tax_rate', 'tax_label', 'tax_enabled')").all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  res.json({
    tax_rate: parseFloat(map.tax_rate || '18'),
    tax_label: map.tax_label || 'Tax',
    tax_enabled: map.tax_enabled !== '0',
  });
});

router.post('/tax', (req, res) => {
  const { tax_rate, tax_label, tax_enabled } = req.body;
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (tax_rate !== undefined) upsert.run('tax_rate', String(Number(tax_rate) || 0));
  if (tax_label !== undefined) upsert.run('tax_label', tax_label || 'Tax');
  if (tax_enabled !== undefined) upsert.run('tax_enabled', tax_enabled ? '1' : '0');
  res.json({ ok: true });
});

router.get('/profile', (req, res) => {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('profile_completed', 'profile_identity', 'profile_focus')"
  ).all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  res.json({
    profile_completed: map.profile_completed === '1',
    identity: map.profile_identity || null,
    focus: map.profile_focus ? JSON.parse(map.profile_focus) : [],
  });
});

router.post('/profile', (req, res) => {
  const { profile_completed, identity, focus } = req.body;
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (profile_completed !== undefined) upsert.run('profile_completed', profile_completed ? '1' : '0');
  if (identity !== undefined) upsert.run('profile_identity', identity);
  if (focus !== undefined) upsert.run('profile_focus', JSON.stringify(focus));
  res.json({ ok: true });
});

router.get('/:key', (req, res) => {
  if (PROTECTED_KEYS.includes(req.params.key)) return res.status(403).json({ error: 'Forbidden' });
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(req.params.key);
  res.json({ value: row ? row.value : null });
});

router.post('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const hashRow = db.prepare("SELECT value FROM settings WHERE key = 'password_hash'").get();
  if (!hashRow) return res.status(500).json({ error: 'Server configuration error' });

  if (!bcrypt.compareSync(currentPassword, hashRow.value)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('password_hash', ?)").run(newHash);
  db.prepare('DELETE FROM sessions').run();

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt);

  res.json({ token });
});

// Authenticated database backup download
router.get('/backup/download', (req, res) => {
  const tmpPath = path.join(os.tmpdir(), `massiv-backup-${Date.now()}.db`);
  const backupDate = new Date().toISOString().slice(0, 10);
  db.backup(tmpPath)
    .then(() => {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="massiv-backup-${backupDate}.db"`);
      const stream = fs.createReadStream(tmpPath);
      stream.pipe(res);
      stream.on('end', () => fs.unlink(tmpPath, () => {}));
      stream.on('error', () => fs.unlink(tmpPath, () => {}));
    })
    .catch(() => res.status(500).json({ error: 'Backup failed' }));
});

module.exports = router;
