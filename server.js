const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { initDb, db } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Zeabur's reverse proxy — trust the first proxy hop so rate limiters
// (login, public expense) see the real client IP instead of the proxy IP.
app.set('trust proxy', 1);

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

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
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

app.use('/api/auth', require('./routes/auth'));
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
const PRESENTATION_MEDIA_DIR = path.join(DATA_DIR, 'presentation-media');
const SHOTLIST_MEDIA_DIR = path.join(DATA_DIR, 'shotlist-media');

app.get('/p-media/:filename', (req, res) => serveMediaFile(req, res, PRESENTATION_MEDIA_DIR));
app.get('/s-media/:filename', (req, res) => serveMediaFile(req, res, SHOTLIST_MEDIA_DIR));

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
app.get('/s/:slug', (req, res, next) => {
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

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  res.sendFile(indexPath);
});

app.listen(PORT, () => {
  console.log(`MASSIV TV running on http://localhost:${PORT}`);
  logBootStatus();
});
