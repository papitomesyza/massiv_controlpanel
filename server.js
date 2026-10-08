const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { initDb, db } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Zeabur's reverse proxy — trust the first proxy hop so rate limiters
// (login, public expense) see the real client IP instead of the proxy IP.
app.set('trust proxy', 1);
// Routes match exactly: /API/x must not reach /api/x handlers (blocklist + audit bypass).
app.set('case sensitive routing', true);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

initDb();

// Automated off-site backups (dormant unless configured; never blocks/crashes boot)
require('./db/backup').start();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  cb(null, allowed.includes(file.mimetype));
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// Pitch domain routing — dormant unless PUBLIC_PITCH_DOMAIN is set. Registered
// FIRST, ahead of every API router, the static middleware and the SPA
// catch-all, so on the pitch host nothing but /p, /p-media, /favicon.ico and
// /robots.txt can ever be reached.
const { pitchDomainGuard, isPitchHost, sendPitch404, requestOrigin, logBootStatus } = require('./lib/pitchDomain');
app.use(pitchDomainGuard);

app.use(express.json({ limit: '50mb' }));

// Public: agency branding (no auth needed for public expense page)
app.get('/api/settings/agency-public', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('agency_name', 'agency_logo')").all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  res.json({ agency_name: map.agency_name || null, agency_logo_base64: map.agency_logo || null });
});

// Public expense routes (no auth) — multer on POST only
const publicRouter = require('./routes/public');
app.use('/api/public', (req, res, next) => {
  if (req.method === 'POST' && req.path.startsWith('/expense/')) {
    return upload.single('invoice_image')(req, res, next);
  }
  next();
}, publicRouter);

// Paths a service token (e.g. the Hermes agent) may NEVER reach, even though it
// otherwise has full read/write. The password vault is zero-knowledge anyway,
// and these are the identity/secret surfaces of the panel.
const SERVICE_TOKEN_BLOCKED = [
  /^\/api\/vault(\/|$)/i,
  /^\/api\/settings\/change-password(\/|$)/i,
  /^\/api\/settings\/backup\/download(\/|$)/i,
];

// Canonical form of a request path for security matching: strip query, decode
// (repeatedly, to defeat double encoding), lowercase, collapse // and resolve
// . and .. segments. Undecodable paths are lowercased as-is.
function normalizeApiPath(raw) {
  let p = String(raw || '').split('?')[0].split('#')[0];
  for (let i = 0; i < 3; i++) {
    try { const d = decodeURIComponent(p); if (d === p) break; p = d; } catch (_) { break; }
  }
  p = p.replace(/\\/g, '/').toLowerCase().replace(/\/{2,}/g, '/');
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '.') continue;
    if (seg === '..') { if (out.length > 1) out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/');
}

// Constant-time comparison of the presented bearer against HERMES_API_TOKEN.
// The env var is the whole switch: unset it (or change it) on Zeabur to revoke.
function isServiceToken(token) {
  const expected = (process.env.HERMES_API_TOKEN || '').trim();
  if (!expected || typeof token !== 'string') return false;
  const a = Buffer.from(token.trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7).trim();

  if (isServiceToken(token)) {
    const url = normalizeApiPath(req.originalUrl);
    if (SERVICE_TOKEN_BLOCKED.some(re => re.test(url))) {
      return res.status(403).json({ error: 'Forbidden for service token' });
    }
    req.serviceToken = true;
    return next();
  }

  const session = db.prepare("SELECT id FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Authenticated upload file serving
app.get('/api/uploads/:filename', requireAuth, (req, res) => {
  const filename = req.params.filename;
  // Reject path traversal attempts
  if (/[/\\]/.test(filename) || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

  const ext = path.extname(filename).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
    '.pdf': 'application/pdf',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.sendFile(filePath);
});

// Global guard (runs before any router, any casing): a service token can never
// reach a blocked path, even if routing would 404 it. Deterministic 403.
app.use((req, res, next) => {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ') && isServiceToken(auth.slice(7).trim())
      && SERVICE_TOKEN_BLOCKED.some(re => re.test(normalizeApiPath(req.originalUrl)))) {
    return res.status(403).json({ error: 'Forbidden for service token' });
  }
  next();
});

// ── Audit spine ────────────────────────────────────────────────────────────
// One row per mutating /api request. actor: hermes (service token) or andi
// (session). source: X-CoS-Source header when present, else a default. This is
// what lets a payment logged in the panel and an edit driven from chat land in
// one ordered stream, read back through GET /api/audit/changes.
const AUDIT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUDIT_SKIP = [
  /^\/api\/auth(\/|$)/i,
  /^\/api\/public(\/|$)/i,
  /^\/api\/vault(\/|$)/i,
  /^\/api\/settings\/change-password(\/|$)/i,
  /^\/api\/settings\/backup(\/|$)/i,
];

const AUDIT_SOURCES = new Set(['panel', 'api', 'telegram', 'desktop', 'voice']);
// Request-body keys that may be stored in audit meta (whitelist only).
const AUDIT_BODY_KEYS = ['amount', 'status', 'title', 'name', 'phase_name', 'phase', 'client_id', 'currency', 'rate_per_day', 'days', 'payment_id', 'project_id'];
const AUDIT_SECRET_RE = /password|secret|token|key|backup|base64/i;
const AUDIT_META_CAP = 2048;
// In-memory count of audit inserts that failed (the business write still
// succeeded). Exposed on GET /api/audit/changes so a reader knows rows may be missing.
const auditStats = { failures: 0 };
app.locals.auditStats = auditStats;

function auditBodySubset(body) {
  const out = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out;
  for (const k of AUDIT_BODY_KEYS) {
    if (!(k in body) || AUDIT_SECRET_RE.test(k)) continue;
    const v = body[k];
    if (v === null || v === undefined || typeof v === 'object') continue;
    if (typeof v === 'string' && /^\s*data:/i.test(v)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
}

// Derived verb, e.g. project.create, payment.create, project.status, client.update.
function auditVerb(method, routePath, body) {
  const segs = normalizeApiPath(routePath).split('/').filter(Boolean).slice(1); // drop 'api'
  const subMap = {
    payments: 'payment', expenses: 'expense', tasks: 'task', crew: 'crew_assignment',
    phases: 'phase', logs: 'log', lines: 'line', scenes: 'scene', shots: 'shot',
    revisions: 'revision', characters: 'character', locations: 'location', days: 'day',
  };
  const rootMap = {
    clients: 'client', crew: 'crew', projects: 'project', budgets: 'budget',
    invoices: 'invoice', calendar: 'calendar_event', collections: 'collection',
    'mind-accounts': 'mind_account', leads: 'lead', assets: 'asset',
    'standalone-tasks': 'standalone_task', shotlists: 'shotlist', finances: 'finance',
    settings: 'setting', tasks: 'task',
  };
  const isId = x => /^\d+$/.test(x);
  const root = segs[0] || 'api';
  let noun = rootMap[root] || root;
  const named = segs.slice(1).filter(x => !isId(x));
  if (named.length && subMap[named[0]]) noun = subMap[named[0]];
  let action = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[method] || method.toLowerCase();
  const last = segs[segs.length - 1] || '';
  if (/^(complete|status|accept|send|archive|restore|pay|paid|done|toggle)$/.test(last)) {
    action = last;
  } else if (method !== 'POST' && method !== 'DELETE' && !named.length && body && typeof body === 'object' && 'status' in body) {
    action = 'status';
  }
  return `${noun}.${action}`;
}

function auditEntityType(routePath) {
  const m = routePath.match(/^\/api\/([a-z0-9-]+)/i);
  if (!m) return 'api';
  const seg = m[1].toLowerCase();
  const map = {
    clients: 'client', crew: 'crew', projects: 'project', budgets: 'budget',
    invoices: 'invoice', calendar: 'calendar_event', collections: 'collection',
    'mind-accounts': 'mind_account', leads: 'lead', assets: 'asset',
    'standalone-tasks': 'standalone_task', shotlists: 'shotlist',
    finances: 'finance', settings: 'setting',
  };
  return map[seg] || seg;
}

function auditEntityId(req, body) {
  const p = req.params || {};
  for (const k of ['id', 'payId', 'paymentId', 'taskId', 'sceneId', 'shotId', 'lineId', 'cardId', 'assignId', 'expId', 'revId', 'locationId', 'characterId', 'dayId']) {
    const v = parseInt(p[k], 10);
    if (Number.isFinite(v)) return v;
  }
  if (body && typeof body === 'object') {
    for (const k of ['id', 'payment_id', 'project_id', 'client_id']) {
      const v = parseInt(body[k], 10);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

// Fail loud: if the audit insert cannot be prepared, the server must not boot
// with a silently disabled audit spine.
const insertAudit = db.prepare(
  'INSERT INTO audit_log (actor, source, method, path, entity_type, entity_id, summary, meta, verb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

app.use((req, res, next) => {
  if (!AUDIT_METHODS.has(req.method)) return next();
  const routePath = (req.originalUrl || '').split('?')[0];
  const normPath = normalizeApiPath(routePath);
  if (!/^\/api\//i.test(normPath) || AUDIT_SKIP.some(re => re.test(normPath))) return next();

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    try {
      if (res.statusCode < 400) {
        const actor = req.serviceToken ? 'hermes' : 'andi';
        const hdr = String(req.get('x-cos-source') || '').trim().toLowerCase();
        const source = AUDIT_SOURCES.has(hdr) ? hdr : (req.serviceToken ? 'api' : 'panel');
        // Handlers may set res.locals.cosAudit to make the row exact (e.g. payment delete/update).
        const cos = res.locals && res.locals.cosAudit;
        const entity_type = (cos && cos.entity_type) || auditEntityType(routePath);
        const entity_id = (cos && cos.entity_id != null) ? cos.entity_id : auditEntityId(req, body);
        let meta = null;
        try {
          const keys = body && typeof body === 'object' ? Object.keys(body).slice(0, 25) : [];
          meta = JSON.stringify({ keys, req: auditBodySubset(Object.assign({}, req.body, cos && cos.req)) });
          if (meta.length > AUDIT_META_CAP) meta = JSON.stringify({ keys: keys.slice(0, 10), truncated: true });
        } catch (_) { meta = null; }
        const verb = auditVerb(req.method, routePath, req.body);
        insertAudit.run(actor, source, req.method, routePath, entity_type, entity_id, `${req.method} ${routePath}`, meta, verb);
      }
    } catch (err) {
      auditStats.failures++;
      console.error('audit failed:', err && err.message ? err.message : err);
    }
    return originalJson(body);
  };
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/audit', requireAuth, require('./routes/audit'));
app.use('/api/export', requireAuth, require('./routes/export'));
app.use('/api/tasks', requireAuth, require('./routes/tasks'));
app.use('/api/clients', requireAuth, require('./routes/clients'));
app.use('/api/crew', requireAuth, require('./routes/crew'));
app.use('/api/finances', requireAuth, require('./routes/finances'));
app.use('/api/settings', requireAuth, require('./routes/settings'));
app.use('/api/budgets', requireAuth, require('./routes/budgets'));
app.use('/api/leads', requireAuth, require('./routes/leads'));
app.use('/api/assets', requireAuth, require('./routes/assets'));
app.use('/api/calendar', requireAuth, require('./routes/calendar'));
app.use('/api/invoices', requireAuth, require('./routes/invoices'));
app.use('/api/collections', requireAuth, require('./routes/collections'));
app.use('/api/mind-accounts', requireAuth, require('./routes/mind-accounts'));
app.use('/api/vault', requireAuth, require('./routes/vault'));
app.use('/api/shotlists', requireAuth, require('./routes/shotlists'));
app.use('/api/standalone-tasks', requireAuth, require('./routes/standalone-tasks'));

// Pitches — the preview endpoint is embedded in an iframe that cannot send an
// Authorization header, so that ONE route authenticates via a ?token= query
// parameter validated against the sessions table exactly like requireAuth.
// Everything else on the router goes through requireAuth as normal.
app.use('/api/pitches', (req, res, next) => {
  if (req.method === 'GET' && /^\/\d+\/preview\/?$/.test(req.path)) {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const session = db.prepare("SELECT id FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    return next();
  }
  return requireAuth(req, res, next);
}, require('./routes/pitches'));

// Projects — inject multer for expense upload endpoints
app.use('/api/projects', requireAuth, (req, res, next) => {
  if ((req.method === 'POST' || req.method === 'PUT') && /\/expenses/.test(req.path)) {
    return upload.single('invoice_image')(req, res, next);
  }
  next();
}, require('./routes/projects'));

// Public media — no auth (public presentations and shot lists must load these).
// Filenames are timestamp-unique, so long immutable caching is safe. Both
// routes share one handler: same traversal guard, same mime map, same headers.
const { serveMediaFile } = require('./lib/mediaStore');
const { coverPng } = require('./lib/renderCover');
const PRESENTATION_MEDIA_DIR = path.join(DATA_DIR, 'presentation-media');
const SHOTLIST_MEDIA_DIR = path.join(DATA_DIR, 'shotlist-media');

app.get('/p-media/:filename', (req, res) => serveMediaFile(req, res, PRESENTATION_MEDIA_DIR));
app.get('/shotlist-media/:filename', (req, res) => serveMediaFile(req, res, SHOTLIST_MEDIA_DIR));

// Link preview covers. Unfurlers will not run JavaScript and will not take an
// SVG, so each public page has a real PNG at a stable URL showing the project
// name and what the link is — nothing from inside the document, since a
// preview is shown in a chat list before anyone has opened it.
function sendCover(req, res, { title, kind }) {
  const agencyRow = db.prepare("SELECT value FROM settings WHERE key = 'agency_name'").get();
  coverPng({ title, kind, agency: agencyRow ? agencyRow.value : null })
    .then(png => {
      res.setHeader('Content-Type', 'image/png');
      // Long enough that an unfurler retrying does not redraw it, short enough
      // that a renamed project catches up on its own.
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(png);
    })
    .catch(err => {
      console.error('Cover render failed:', err && err.message ? err.message : err);
      res.status(404).end();
    });
}

app.get('/shotlist/:slug/cover.png', (req, res) => {
  try {
    const shotlist = db.prepare(
      "SELECT title FROM shotlists WHERE slug = ? AND status = 'published'"
    ).get(req.params.slug);
    if (!shotlist) return res.status(404).end();
    sendCover(req, res, { title: shotlist.title, kind: 'Shot list' });
  } catch (err) {
    console.error('Shot list cover failed:', err && err.message ? err.message : err);
    res.status(404).end();
  }
});

app.get('/c/:slug/cover.png', (req, res) => {
  try {
    const shotlist = db.prepare(
      "SELECT title FROM shotlists WHERE casting_slug = ? AND casting_status = 'published'"
    ).get(req.params.slug);
    if (!shotlist) return res.status(404).end();
    sendCover(req, res, { title: shotlist.title, kind: 'Casting' });
  } catch (err) {
    console.error('Casting cover failed:', err && err.message ? err.message : err);
    res.status(404).end();
  }
});

// Public pitch presentations — published only; drafts and unknown slugs fall
// through to the SPA's generic behavior, revealing nothing. Must be registered
// BEFORE the static middleware and the SPA catch-all.
app.get('/p/:slug', (req, res, next) => {
  // On the pitch domain a miss is a dead end (the minimal 404); on the panel
  // domain it keeps falling through to the SPA exactly as before.
  const onPitchHost = isPitchHost(req);
  const miss = () => (onPitchHost ? sendPitch404(req, res) : next());

  try {
    const presentation = db.prepare(
      "SELECT * FROM presentations WHERE slug = ? AND status = 'published' AND is_template = 0"
    ).get(req.params.slug);
    if (!presentation) return miss();

    const sections = db.prepare(
      'SELECT * FROM presentation_sections WHERE presentation_id = ? ORDER BY sort_order ASC, id ASC'
    ).all(presentation.id);

    const { renderPresentation } = require('./lib/renderPresentation');
    const agencyRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('agency_name', 'agency_logo')").all();
    const agencyMap = {};
    agencyRows.forEach(r => { agencyMap[r.key] = r.value; });

    const html = renderPresentation(presentation, sections, {
      // Built from the incoming host, so a pitch opened on the pitch domain
      // advertises that domain and never the panel's.
      origin: requestOrigin(req),
      agency: { name: agencyMap.agency_name || null, logo: agencyMap.agency_logo || null },
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // No caching — post-publish edits must appear immediately (media stays long-cached)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(html);
  } catch (err) {
    // No global error handler here — on the pitch domain a failure must render
    // the same blank 404 rather than Express's default stack page.
    console.error('Public pitch render failed:', err && err.message ? err.message : err);
    if (onPitchHost) return sendPitch404(req, res);
    return next();
  }
});

// Public shot lists — published only; drafts and unknown slugs behave exactly
// like the pitch route does on this domain, revealing nothing. Registered
// alongside the pitch route, BEFORE the static middleware and the SPA
// catch-all.
app.get('/shotlist/:slug', (req, res, next) => {
  const onPitchHost = isPitchHost(req);
  const miss = () => (onPitchHost ? sendPitch404(req, res) : next());

  try {
    const shotlist = db.prepare(
      "SELECT * FROM shotlists WHERE slug = ? AND status = 'published'"
    ).get(req.params.slug);
    if (!shotlist) return miss();

    const { loadBundle, orderLabelFor } = require('./lib/shotlistStore');
    const { renderShotlist } = require('./lib/renderShotlist');
    const bundle = loadBundle(shotlist);

    const agencyRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('agency_name')").all();
    const agencyMap = {};
    agencyRows.forEach(r => { agencyMap[r.key] = r.value; });

    const html = renderShotlist(shotlist, bundle, {
      agency: { name: agencyMap.agency_name || null },
      orderLabel: orderLabelFor(shotlist),
      // Built from the incoming host, so a shot list opened on the public
      // domain advertises that domain and never the panel's.
      origin: requestOrigin(req),
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // No caching — a completion or a post-publish edit must show immediately
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(html);
  } catch (err) {
    // No global error handler here — a failure must behave like a miss rather
    // than render Express's default stack page.
    console.error('Public shot list render failed:', err && err.message ? err.message : err);
    if (onPitchHost) return sendPitch404(req, res);
    return next();
  }
});

// Public casting grid — the casting agency's view, published separately from
// the crew link. Same miss behaviour as the pitch and shot list routes: an
// unshared or unknown slug reveals nothing.
app.get('/c/:slug', (req, res, next) => {
  const onPitchHost = isPitchHost(req);
  const miss = () => (onPitchHost ? sendPitch404(req, res) : next());

  try {
    const shotlist = db.prepare(
      "SELECT * FROM shotlists WHERE casting_slug = ? AND casting_status = 'published'"
    ).get(req.params.slug);
    if (!shotlist) return miss();

    const { loadBundle, getShotCountsByCharacter, castSchedule } = require('./lib/shotlistStore');
    const { renderCasting } = require('./lib/renderCasting');

    const agencyRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('agency_name')").all();
    const agencyMap = {};
    agencyRows.forEach(r => { agencyMap[r.key] = r.value; });

    // The schedule is derived from the same timeline the crew page and the call
    // sheet are built from, so a casting agency can never be told a different
    // time from the one the unit is working to.
    const bundle = loadBundle(shotlist);

    const html = renderCasting(shotlist, bundle.characters, {
      agency: { name: agencyMap.agency_name || null },
      origin: requestOrigin(req),
      shotCounts: getShotCountsByCharacter(shotlist.id),
      schedule: castSchedule(bundle),
      days: bundle.timelines.map(t => ({
        day_number: t.day.day_number,
        shoot_date: t.day.shoot_date,
        crew_call: t.totals.crew_call,
        wrap: t.totals.wrap,
        locations: [...new Set(
          t.items.filter(i => i.kind === 'scene' && i.location_name).map(i => i.location_name)
        )],
      })),
      locations: bundle.locations,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // No caching — an edit must show immediately (media stays long-cached)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(html);
  } catch (err) {
    // No global error handler here — a failure must behave like a miss rather
    // than render Express's default stack page.
    console.error('Public casting render failed:', err && err.message ? err.message : err);
    if (onPitchHost) return sendPitch404(req, res);
    return next();
  }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  res.sendFile(indexPath);
});

app.listen(PORT, () => {
  console.log(`MASSIV TV running on http://localhost:${PORT}`);
  logBootStatus();
});
