const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/calendar?month=YYYY-MM  OR  ?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns events that overlap with the requested range (date-range overlap)
router.get('/', (req, res) => {
  const { month, start, end } = req.query;
  let query = `
    SELECT ce.*, p.title as project_title
    FROM calendar_events ce
    LEFT JOIN projects p ON p.id = ce.project_id
    WHERE 1=1
  `;
  const params = [];
  if (start && end) {
    // Event overlaps [start, end] if: start_date <= end AND COALESCE(end_date, start_date) >= start
    query += ` AND ce.start_date <= ? AND COALESCE(ce.end_date, ce.start_date) >= ?`;
    params.push(end, start);
  } else if (month) {
    // Compute first and last day of the requested month (local-date safe: no toISOString)
    const [y, m] = month.split('-').map(Number);
    const firstDay = `${month}-01`;
    const daysInMonth = new Date(y, m, 0).getDate();
    const lastDay = `${month}-${String(daysInMonth).padStart(2, '0')}`;
    // Event overlaps the month if: start_date <= lastDay AND COALESCE(end_date, start_date) >= firstDay
    query += ` AND ce.start_date <= ? AND COALESCE(ce.end_date, ce.start_date) >= ?`;
    params.push(lastDay, firstDay);
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

// PUT /api/calendar/:id/move — reschedule by shifting start_date (and end_date span)
router.put('/:id/move', (req, res) => {
  const { start_date } = req.body;
  if (!start_date) return res.status(400).json({ error: 'start_date required' });

  const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  let new_end_date = null;
  if (event.end_date) {
    const spanDays = Math.round(
      (new Date(event.end_date + 'T00:00:00') - new Date(event.start_date + 'T00:00:00')) / 86400000
    );
    const d = new Date(start_date + 'T00:00:00');
    d.setDate(d.getDate() + spanDays);
    new_end_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  db.prepare('UPDATE calendar_events SET start_date = ?, end_date = ? WHERE id = ?')
    .run(start_date, new_end_date, req.params.id);

  if (event.project_id) {
    if (event.event_type === 'shoot') {
      db.prepare('UPDATE projects SET shoot_date = ? WHERE id = ?').run(start_date, event.project_id);
    } else if (event.event_type === 'deadline') {
      db.prepare('UPDATE projects SET deadline = ? WHERE id = ?').run(start_date, event.project_id);
    }
  }
  if (event.event_type === 'task' && event.task_id) {
    db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(start_date, event.task_id);
  }

  res.json({ ok: true });
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
