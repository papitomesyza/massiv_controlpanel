// Crew unlock for the public shot list page.
//
// Viewing needs only the link. Changing anything needs the shot list's
// passcode, which is stored bcrypt-hashed exactly like the panel login
// password and is never logged, never returned and never sent to the client.
//
// A successful unlock mints a signed crew token scoped to ONE shot list. The
// token is stateless (HMAC over the payload with a server-side secret), so no
// extra table is needed, and it dies the moment the passcode changes because
// the passcode hash's fingerprint is part of what is signed.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');

const TOKEN_TTL_DAYS = 30;
const SECRET_KEY = 'shotlist_crew_secret';

function getSecret() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SECRET_KEY);
  if (row && row.value) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SECRET_KEY, secret);
  return secret;
}

// A short fingerprint of the stored hash. Changing the passcode changes this,
// which invalidates every token minted against the old one.
function passcodeVersion(passcodeHash) {
  return crypto.createHash('sha256').update(String(passcodeHash || '')).digest('hex').slice(0, 12);
}

function b64url(str) {
  return Buffer.from(String(str), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(str) {
  const pad = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(pad, 'base64').toString('utf8');
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex').slice(0, 32);
}

function issueCrewToken(shotlist, name) {
  const payload = [
    shotlist.id,
    Math.floor(Date.now() / 1000),
    passcodeVersion(shotlist.passcode_hash),
    b64url(String(name || '').slice(0, 60)),
  ].join('.');
  return `${payload}.${sign(payload)}`;
}

// Returns { valid, name } — never throws, never explains why a token failed.
function verifyCrewToken(token, shotlist) {
  try {
    if (!token || typeof token !== 'string' || !shotlist || !shotlist.passcode_hash) {
      return { valid: false };
    }
    const parts = token.split('.');
    if (parts.length !== 5) return { valid: false };
    const [rawId, rawIssued, version, nameEnc, sig] = parts;
    const payload = [rawId, rawIssued, version, nameEnc].join('.');

    const expected = sign(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false };

    if (Number(rawId) !== Number(shotlist.id)) return { valid: false };
    if (version !== passcodeVersion(shotlist.passcode_hash)) return { valid: false };

    const issued = Number(rawIssued) * 1000;
    if (!Number.isFinite(issued)) return { valid: false };
    if (Date.now() - issued > TOKEN_TTL_DAYS * 86400000) return { valid: false };

    return { valid: true, name: unb64url(nameEnc) };
  } catch (_) {
    return { valid: false };
  }
}

function hashPasscode(passcode) {
  return bcrypt.hashSync(String(passcode), 10);
}

function checkPasscode(passcode, passcodeHash) {
  try {
    if (!passcodeHash) return false;
    return bcrypt.compareSync(String(passcode || ''), passcodeHash);
  } catch (_) {
    return false;
  }
}

module.exports = {
  issueCrewToken,
  verifyCrewToken,
  hashPasscode,
  checkPasscode,
  TOKEN_TTL_DAYS,
};
