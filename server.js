const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const { initDb, db } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

initDb();

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

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve uploaded files without auth
app.use('/uploads', express.static(UPLOADS_DIR));

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
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'password'").get();
  const currentPassword = setting ? setting.value : 'massiv2026';
  const expected = `Bearer ${Buffer.from(currentPassword).toString('base64')}`;
  if (auth === expected) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

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

// Projects — inject multer for expense upload endpoints
app.use('/api/projects', requireAuth, (req, res, next) => {
  if ((req.method === 'POST' || req.method === 'PUT') && /\/expenses/.test(req.path)) {
    return upload.single('invoice_image')(req, res, next);
  }
  next();
}, require('./routes/projects'));

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  res.sendFile(indexPath);
});

app.listen(PORT, () => {
  console.log(`MASSIV TV running on http://localhost:${PORT}`);
});
