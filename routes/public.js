const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// In-memory rate limiters
const ipSubmissions = new Map();   // ip -> { count, windowStart }
const tokenSubmissions = new Map(); // token -> { count, dayStart }

function checkIpLimit(ip) {
  const now = Date.now();
  const rec = ipSubmissions.get(ip) || { count: 0, windowStart: now };
  if (now - rec.windowStart > 60000) { rec.count = 0; rec.windowStart = now; }
  return rec;
}

function checkTokenLimit(token) {
  const now = Date.now();
  const rec = tokenSubmissions.get(token) || { count: 0, dayStart: now };
  if (now - rec.dayStart > 86400000) { rec.count = 0; rec.dayStart = now; }
  return rec;
}

function resolveToken(token) {
  const link = db.prepare('SELECT * FROM expense_links WHERE token = ?').get(token);
  if (!link) return { valid: false, reason: 'invalid' };
  if (!link.is_active) return { valid: false, reason: 'revoked' };

  const project = db.prepare('SELECT id, title, status FROM projects WHERE id = ?').get(link.project_id);
  if (!project) return { valid: false, reason: 'invalid' };
  if (project.status === 'completed') return { valid: false, reason: 'expired', project_title: project.title };

  return { valid: true, project_id: project.id, project_title: project.title, project_status: project.status };
}

// GET /api/public/expense/:token
router.get('/expense/:token', (req, res) => {
  const result = resolveToken(req.params.token);
  if (!result.valid) return res.json({ valid: false, reason: result.reason, project_title: result.project_title || null });
  res.json({ valid: true, project_title: result.project_title, project_status: result.project_status });
});

// POST /api/public/expense/:token — multer applied upstream in server.js
router.post('/expense/:token', (req, res) => {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  const token = req.params.token;

  // IP rate limit: 3 per minute
  const ipRec = checkIpLimit(ip);
  if (ipRec.count >= 3) {
    return res.status(429).json({ error: 'Too many submissions. Try again in a minute.' });
  }

  // Token rate limit: 30 per day
  const tokenRec = checkTokenLimit(token);
  if (tokenRec.count >= 30) {
    return res.status(429).json({ error: 'This link has reached its daily submission limit.' });
  }

  const result = resolveToken(token);
  if (!result.valid) return res.status(403).json({ error: result.reason });

  const { category, custom_category, amount, description, submitted_by } = req.body;

  // Validate amount: real finite number > 0 and <= 100000
  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 100000) {
    return res.status(400).json({ error: 'Amount must be a number greater than 0 and at most 100,000' });
  }

  // Store category as text on pending expense; do NOT create category row yet
  const categoryName = category === 'custom' ? (custom_category || 'Custom') : (category || 'Miscellaneous');

  const today = new Date().toISOString().slice(0, 10);
  const imagePath = req.file ? req.file.filename : null;

  // Insert as pending; category_id remains null until approval
  db.prepare(
    "INSERT INTO expenses (project_id, category_id, category_text, amount, date, notes, submitted_by, invoice_image_path, source, status) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'link', 'pending')"
  ).run(result.project_id, categoryName, parsedAmount, today, description || null, submitted_by || null, imagePath);

  // Record successful submission against rate limits
  ipRec.count++;
  ipSubmissions.set(ip, ipRec);
  tokenRec.count++;
  tokenSubmissions.set(token, tokenRec);

  res.json({ success: true });
});

// GET /api/public/expense-categories
router.get('/expense-categories', (req, res) => {
  const cats = db.prepare('SELECT name FROM expense_categories ORDER BY name').all();
  res.json(cats.map(c => c.name));
});

module.exports = router;
