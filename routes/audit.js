const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// Read-only surface over the audit_log spine. Written to by the recordAudit
// middleware in server.js on every mutating /api request. Chief of Staff (the
// Hermes agent) polls /changes with a cursor to reconcile panel edits and
// chat-driven edits into one stream.

// GET /api/audit/changes?since=<id>&limit=<n>
// Everything with id > since, oldest first. `cursor` is the id to pass next
// time. A client that stores the cursor never misses a row.
router.get('/changes', (req, res) => {
  let since = 0;
  if (req.query.since !== undefined) {
    const raw = String(req.query.since).trim();
    if (!/^\d+$/.test(raw)) return res.status(400).json({ error: 'since must be a non-negative integer' });
    since = parseInt(raw, 10);
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 2000);
  const rows = db.prepare(
    'SELECT * FROM audit_log WHERE id > ? ORDER BY id ASC LIMIT ?'
  ).all(since, limit);
  const cursor = rows.length ? rows[rows.length - 1].id : since;
  // audit_failures: in-memory count of audit inserts that failed since boot
  // (business write succeeded, row lost). Non-zero means the stream may have gaps.
  const stats = (req.app.locals && req.app.locals.auditStats) || { failures: 0 };
  res.json({ cursor, count: rows.length, has_more: rows.length === limit, audit_failures: stats.failures, rows });
});

// GET /api/audit?limit=<n>&entity_type=<t>&entity_id=<id>
// Newest first, for a panel view or a quick human look.
router.get('/', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
  const where = [];
  const args = [];
  if (req.query.entity_type) { where.push('entity_type = ?'); args.push(String(req.query.entity_type)); }
  if (req.query.entity_id) { where.push('entity_id = ?'); args.push(parseInt(req.query.entity_id, 10)); }
  const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
  res.json(db.prepare(sql).all(...args, limit));
});

module.exports = router;