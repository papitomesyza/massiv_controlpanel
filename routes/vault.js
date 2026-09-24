const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// The vault is zero knowledge: the browser derives the key from the passphrase
// and only ever sends ciphertext, a salt and a sentinel. Nothing here logs or
// echoes ciphertext back beyond what GET /meta already hands the page.

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validIterations(n) {
  return typeof n === 'number' && isFinite(n) && n >= 1;
}

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

    if (!nonEmpty(salt)) return res.status(400).json({ error: 'salt is required' });
    if (!nonEmpty(sentinel_cipher)) return res.status(400).json({ error: 'sentinel_cipher is required' });
    if (!nonEmpty(sentinel_iv)) return res.status(400).json({ error: 'sentinel_iv is required' });
    if (!validIterations(iterations)) return res.status(400).json({ error: 'iterations must be a positive number' });

    const existing = db.prepare('SELECT id FROM vault_meta WHERE id = 1').get();
    if (existing) {
      return res.status(409).json({ error: 'The vault is already set up. Unlock it on the Accounts page and use Change passphrase to replace the passphrase.' });
    }

    db.prepare(
      'INSERT INTO vault_meta (id, salt, sentinel_cipher, sentinel_iv, iterations) VALUES (1, ?, ?, ?, ?)'
    ).run(salt.trim(), sentinel_cipher.trim(), sentinel_iv.trim(), iterations);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vault/rotate
// Change passphrase. The page decrypts every stored password with the old key,
// encrypts it again under the new one and sends the lot here with a new salt
// and sentinel. It is applied in one transaction, and only when the ids sent
// are exactly the accounts that hold a password right now, so no password is
// ever left encrypted under a key that no longer exists.
router.post('/rotate', (req, res) => {
  try {
    const { salt, sentinel_cipher, sentinel_iv, iterations, accounts } = req.body || {};

    if (!nonEmpty(salt)) return res.status(400).json({ error: 'salt is required' });
    if (!nonEmpty(sentinel_cipher)) return res.status(400).json({ error: 'sentinel_cipher is required' });
    if (!nonEmpty(sentinel_iv)) return res.status(400).json({ error: 'sentinel_iv is required' });
    if (!validIterations(iterations)) return res.status(400).json({ error: 'iterations must be a positive number' });
    if (!Array.isArray(accounts)) return res.status(400).json({ error: 'accounts must be a list' });

    const sent = new Map();
    for (const a of accounts) {
      const id = Number(a && a.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Every account needs a valid id' });
      if (!nonEmpty(a.password_cipher) || !nonEmpty(a.password_iv)) {
        return res.status(400).json({ error: 'Every account needs password_cipher and password_iv' });
      }
      if (sent.has(id)) return res.status(400).json({ error: 'An account id was sent twice' });
      sent.set(id, { cipher: a.password_cipher.trim(), iv: a.password_iv.trim() });
    }

    const run = db.transaction(() => {
      const meta = db.prepare('SELECT id FROM vault_meta WHERE id = 1').get();
      if (!meta) return { status: 404, body: { error: 'The vault is not set up' } };

      const stored = db.prepare('SELECT id FROM mind_accounts WHERE password_cipher IS NOT NULL').all().map(r => r.id);
      const matches = stored.length === sent.size && stored.every(id => sent.has(id));
      if (!matches) {
        return {
          status: 409,
          body: { error: 'The stored passwords changed while the passphrase was being changed. Nothing was saved. Reload the page and try again.' },
        };
      }

      db.prepare('UPDATE vault_meta SET salt = ?, sentinel_cipher = ?, sentinel_iv = ?, iterations = ? WHERE id = 1')
        .run(salt.trim(), sentinel_cipher.trim(), sentinel_iv.trim(), iterations);
      const update = db.prepare('UPDATE mind_accounts SET password_cipher = ?, password_iv = ? WHERE id = ?');
      for (const [id, v] of sent) update.run(v.cipher, v.iv, id);
      return { status: 200, body: { ok: true, rotated: sent.size } };
    });

    const out = run();
    res.status(out.status).json(out.body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
