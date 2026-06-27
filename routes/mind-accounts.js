const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

const VALID_CATEGORIES = ['project', 'studio', 'personal'];
const VALID_BILLING_CYCLES = ['monthly', 'yearly', 'quarterly', 'weekly', 'one-time'];
const VALID_AUTH_METHODS = ['password', 'google', 'apple', 'microsoft', 'facebook', 'github', 'other'];

function validateAccount(body) {
  const { category, billing_cycle, cost, auth_method } = body;
  if (!VALID_CATEGORIES.includes(category)) {
    return 'category must be one of: project, studio, personal';
  }
  if (billing_cycle !== undefined && !VALID_BILLING_CYCLES.includes(billing_cycle)) {
    return 'billing_cycle must be one of: monthly, yearly, quarterly, weekly, one-time';
  }
  if (cost !== undefined) {
    const n = Number(cost);
    if (!isFinite(n) || n < 0 || n > 1000000) {
      return 'cost must be a number between 0 and 1,000,000';
    }
  }
  if (auth_method !== undefined && !VALID_AUTH_METHODS.includes(auth_method)) {
    return 'auth_method must be one of: ' + VALID_AUTH_METHODS.join(', ');
  }
  return null;
}

// GET /api/mind-accounts/monthly-spend — must be before /:id to avoid route conflict
router.get('/monthly-spend', (req, res) => {
  try {
    const accounts = db.prepare(
      "SELECT cost, billing_cycle FROM mind_accounts WHERE archived = 0 AND has_payment = 1 AND cost > 0"
    ).all();

    let total = 0;
    for (const a of accounts) {
      const cost = Number(a.cost) || 0;
      switch (a.billing_cycle) {
        case 'monthly':   total += cost; break;
        case 'yearly':    total += cost / 12; break;
        case 'quarterly': total += cost / 3; break;
        case 'weekly':    total += (cost * 52) / 12; break;
        case 'one-time':  break;
        default:          total += cost; break;
      }
    }

    res.json({ total: Math.round(total * 100) / 100, currency: 'EUR' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mind-accounts/archived — must be before /:id
router.get('/archived', (req, res) => {
  try {
    const accounts = db.prepare(
      'SELECT * FROM mind_accounts WHERE archived = 1 ORDER BY sort_order ASC, id ASC'
    ).all();
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mind-accounts
router.get('/', (req, res) => {
  try {
    const accounts = db.prepare(
      'SELECT * FROM mind_accounts WHERE archived = 0 ORDER BY sort_order ASC, id ASC'
    ).all();
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mind-accounts
router.post('/', (req, res) => {
  try {
    const { category, platform, username, url, notes, has_payment, cost, billing_cycle, renewal_date, currency, password_cipher, password_iv, auth_method } = req.body;

    if (!platform || !platform.trim()) return res.status(400).json({ error: 'platform is required' });
    const err = validateAccount({ category, billing_cycle, cost, auth_method });
    if (err) return res.status(400).json({ error: err });

    const maxRes = db.prepare('SELECT MAX(sort_order) as m FROM mind_accounts').get();
    const sortOrder = (maxRes.m === null || maxRes.m === undefined) ? 0 : maxRes.m + 1;

    const result = db.prepare(`
      INSERT INTO mind_accounts (category, platform, username, url, notes, has_payment, cost, billing_cycle, renewal_date, currency, sort_order, password_cipher, password_iv, auth_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      category,
      platform.trim(),
      username ? username.trim() : null,
      url ? url.trim() : null,
      notes ? notes.trim() : null,
      has_payment ? 1 : 0,
      cost !== undefined ? Number(cost) : 0,
      billing_cycle || 'monthly',
      renewal_date || null,
      currency || 'EUR',
      sortOrder,
      password_cipher || null,
      password_iv || null,
      auth_method || 'password'
    );

    const created = db.prepare('SELECT * FROM mind_accounts WHERE id = ?').get(result.lastInsertRowid);
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/mind-accounts/:id
router.put('/:id', (req, res) => {
  try {
    const account = db.prepare('SELECT id, password_cipher, password_iv, auth_method FROM mind_accounts WHERE id = ?').get(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { category, platform, username, url, notes, has_payment, cost, billing_cycle, renewal_date, currency, password_cipher, password_iv, auth_method } = req.body;

    if (!platform || !platform.trim()) return res.status(400).json({ error: 'platform is required' });
    const err = validateAccount({ category, billing_cycle, cost, auth_method });
    if (err) return res.status(400).json({ error: err });

    db.prepare(`
      UPDATE mind_accounts
      SET category = ?, platform = ?, username = ?, url = ?, notes = ?,
          has_payment = ?, cost = ?, billing_cycle = ?, renewal_date = ?, currency = ?,
          password_cipher = ?, password_iv = ?, auth_method = ?
      WHERE id = ?
    `).run(
      category,
      platform.trim(),
      username ? username.trim() : null,
      url ? url.trim() : null,
      notes ? notes.trim() : null,
      has_payment ? 1 : 0,
      cost !== undefined ? Number(cost) : 0,
      billing_cycle || 'monthly',
      renewal_date || null,
      currency || 'EUR',
      password_cipher !== undefined ? (password_cipher || null) : account.password_cipher ?? null,
      password_iv !== undefined ? (password_iv || null) : account.password_iv ?? null,
      auth_method || 'password',
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM mind_accounts WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mind-accounts/:id/archive
router.post('/:id/archive', (req, res) => {
  try {
    const account = db.prepare('SELECT id FROM mind_accounts WHERE id = ?').get(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    db.prepare('UPDATE mind_accounts SET archived = 1 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mind-accounts/:id/unarchive
router.post('/:id/unarchive', (req, res) => {
  try {
    const account = db.prepare('SELECT id FROM mind_accounts WHERE id = ?').get(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    db.prepare('UPDATE mind_accounts SET archived = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mind-accounts/:id
router.delete('/:id', (req, res) => {
  try {
    const account = db.prepare('SELECT id FROM mind_accounts WHERE id = ?').get(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    db.prepare('DELETE FROM mind_accounts WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
