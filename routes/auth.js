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

function setting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value != null && row.value !== '' ? row.value : fallback;
}

// role: 'owner' (Andi's password login) or 'finance' (the scoped Google login).
// Only a finance session is restricted; owner keeps the whole panel.
function createSession(role = 'owner', email = null) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, expires_at, role, email) VALUES (?, ?, ?, ?)')
    .run(token, expiresAt, role, email);
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
  const token = createSession('owner');
  res.json({ token, role: 'owner' });
});

router.post('/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.json({ ok: true });
});

// ── Google sign-in for the finance login ─────────────────────────────────────
// Server-side authorization-code flow: the client secret never reaches the
// browser. Every login lands as the 'finance' role (scoped in server.js), so
// there is no other way to become finance, and only allowlisted addresses pass.
// Config lives in settings (google_oauth_client_id / google_oauth_client_secret /
// finance_login_emails), each falling back to a GOOGLE_OAUTH_* env var.
const OAUTH_STATES = new Map();
const OAUTH_TTL_MS = 10 * 60 * 1000;

function pruneStates() {
  const now = Date.now();
  for (const [k, v] of OAUTH_STATES) if (v < now) OAUTH_STATES.delete(k);
}

// Built from the incoming host, so the same app works on the panel host and on
// a finance subdomain; each origin is registered on the OAuth client.
function redirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/auth/oauth/google/callback`;
}

function allowedEmails() {
  return String(setting('finance_login_emails', 'finances@madebymassiv.com'))
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

router.get('/oauth/google/start', (req, res) => {
  const clientId = setting('google_oauth_client_id') || process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return res.status(503).send('Google sign-in is not configured yet.');
  pruneStates();
  const state = crypto.randomBytes(16).toString('hex');
  OAUTH_STATES.set(state, Date.now() + OAUTH_TTL_MS);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri(req));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email');
  u.searchParams.set('state', state);
  u.searchParams.set('prompt', 'select_account');
  res.redirect(u.toString());
});

router.get('/oauth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const back = frag => res.redirect(`/login#${frag}`);
  if (error) return back('error=' + encodeURIComponent(String(error)));
  const st = String(state || '');
  if (!code || !st || !OAUTH_STATES.has(st) || OAUTH_STATES.get(st) < Date.now()) {
    return back('error=expired');
  }
  OAUTH_STATES.delete(st);

  const clientId = setting('google_oauth_client_id') || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = setting('google_oauth_client_secret') || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const tok = await tokenRes.json();
    if (!tok.id_token) throw new Error(tok.error_description || 'no id_token');
    // The id_token arrives straight from Google's token endpoint over TLS in our
    // own code exchange, so its payload is trusted without a JWKS check.
    const claims = JSON.parse(Buffer.from(String(tok.id_token).split('.')[1], 'base64url').toString('utf8'));
    const email = String(claims.email || '').toLowerCase();
    if (!claims.email_verified) throw new Error('email not verified');
    if (!allowedEmails().includes(email)) return back('error=not_allowed');
    back('t=' + createSession('finance', email));
  } catch (err) {
    console.error('Google sign-in failed:', err && err.message ? err.message : err);
    back('error=failed');
  }
});

module.exports = router;
