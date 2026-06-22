const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');

// In-memory rate limiter: max 10 failed attempts per IP per 15 minutes
const loginAttempts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const rec = loginAttempts.get(ip) || { count: 0, windowStart: now };
  if (now - rec.windowStart > windowMs) {
    rec.count = 0;
    rec.windowStart = now;
  }
  return rec;
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt);
  return token;
}

router.post('/login', (req, res) => {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  const rec = checkRateLimit(ip);

  if (rec.count >= 10) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const hashRow = db.prepare("SELECT value FROM settings WHERE key = 'password_hash'").get();
  if (!hashRow) return res.status(500).json({ error: 'Server configuration error' });

  if (!bcrypt.compareSync(password, hashRow.value)) {
    rec.count++;
    loginAttempts.set(ip, rec);
    return res.status(401).json({ error: 'Invalid password' });
  }

  loginAttempts.delete(ip);
  const token = createSession();
  res.json({ token });
});

router.post('/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.json({ ok: true });
});

module.exports = router;
