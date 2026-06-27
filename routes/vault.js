const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/vault/meta
router.get('/meta', (req, res) => {
  try {
    const row = db.prepare('SELECT salt, sentinel_cipher, sentinel_iv, iterations FROM vault_meta WHERE id = 1').get();
    if (!row) return res.json({ exists: false });
    res.json({ exists: true, salt: row.salt, sentinel_cipher: row.sentinel_cipher, sentinel_iv: row.sentinel_iv, iterations: row.iterations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vault/setup
router.post('/setup', (req, res) => {
  try {
    const { salt, sentinel_cipher, sentinel_iv, iterations } = req.body;

    if (!salt || typeof salt !== 'string' || !salt.trim()) return res.status(400).json({ error: 'salt is required' });
    if (!sentinel_cipher || typeof sentinel_cipher !== 'string' || !sentinel_cipher.trim()) return res.status(400).json({ error: 'sentinel_cipher is required' });
    if (!sentinel_iv || typeof sentinel_iv !== 'string' || !sentinel_iv.trim()) return res.status(400).json({ error: 'sentinel_iv is required' });
    if (iterations === undefined || iterations === null || typeof iterations !== 'number' || !isFinite(iterations) || iterations < 1) {
      return res.status(400).json({ error: 'iterations must be a positive number' });
    }

    const existing = db.prepare('SELECT id FROM vault_meta WHERE id = 1').get();
    if (existing) return res.status(409).json({ error: 'Vault already set up. Use the change-passphrase flow to update.' });

    db.prepare(
      'INSERT INTO vault_meta (id, salt, sentinel_cipher, sentinel_iv, iterations) VALUES (1, ?, ?, ?, ?)'
    ).run(salt.trim(), sentinel_cipher.trim(), sentinel_iv.trim(), iterations);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
