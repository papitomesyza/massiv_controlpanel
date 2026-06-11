const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/calendar?month=YYYY-MM
router.get('/', (req, res) => {
  const { month } = req.query;
  let query = `
    SELECT ce.*, p.title as project_title
    FROM calendar_events ce
    LEFT JOIN projects p ON p.id = ce.project_id
    WHERE 1=1
  `;
  const params = [];
  if (month) {
    query += ` AND strftime('%Y-%m', ce.start_date) = ?`;
    params.push(month);
  }
  query += ' ORDER BY ce.start_date ASC, ce.start_time ASC';
  res.json(db.prepare(query).all(...params));
});

// POST /api/calendar
router.post('/', (req, res) => {
  const { project_id, title, event_type, start_date, end_date, start_time, end_time, location, notes, color } = req.body;
  if (!title || !start_date) return res.status(400).json({ error: 'Title and start_date required' });
  const result = db.prepare(`
    INSERT INTO calendar_events (project_id, title, event_type, start_date, end_date, start_time, end_time, location, notes, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project_id || null, title,
    event_type || 'shoot',
    start_date,
    end_date || null,
    start_time || null,
    end_time || null,
    location || null,
    notes || null,
    color || '#723CEB',
  );
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/calendar/:id
router.put('/:id', (req, res) => {
  const event = db.prepare('SELECT id FROM calendar_events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const { project_id, title, event_type, start_date, end_date, start_time, end_time, location, notes, color } = req.body;
  if (!title || !start_date) return res.status(400).json({ error: 'Title and start_date required' });
  db.prepare(`
    UPDATE calendar_events SET
      project_id=?, title=?, event_type=?, start_date=?, end_date=?,
      start_time=?, end_time=?, location=?, notes=?, color=?
    WHERE id=?
  `).run(
    project_id || null, title,
    event_type || 'shoot',
    start_date,
    end_date || null,
    start_time || null,
    end_time || null,
    location || null,
    notes || null,
    color || '#723CEB',
    req.params.id,
  );
  res.json({ ok: true });
});

// DELETE /api/calendar/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/calendar/upcoming?limit=3
router.get('/upcoming', (req, res) => {
  const limit = parseInt(req.query.limit) || 3;
  const today = new Date().toISOString().split('T')[0];
  const events = db.prepare(`
    SELECT * FROM calendar_events
    WHERE start_date >= ?
    ORDER BY start_date ASC, start_time ASC
    LIMIT ?
  `).all(today, limit);
  res.json(events);
});

module.exports = router;
