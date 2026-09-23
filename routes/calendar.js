const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { pristinaToday, addDays } = require('../lib/pristinaDate');
const { applySyncedEventChange, eventSource, EDITABLE } = require('../lib/calendarSync');

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
  // Colour is no longer stored: it is derived from event_type at render time.
  const { project_id, title, event_type, start_date, end_date, start_time, end_time, location, notes } = req.body;
  if (!title || !start_date) return res.status(400).json({ error: 'Title and start_date required' });
  // color is written as NULL: existing databases still carry the old column
  // default, so it is set explicitly rather than omitted.
  const result = db.prepare(`
    INSERT INTO calendar_events (project_id, title, event_type, start_date, end_date, start_time, end_time, location, notes, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    project_id || null, title,
    event_type || 'shoot',
    start_date,
    end_date || null,
    start_time || null,
    end_time || null,
    location || null,
    notes || null,
  );
  res.json({ id: result.lastInsertRowid });
});

// Send a thrown validation error back with its status, anything else as a 500.
function fail(res, err) {
  res.status(err.status || 500).json({ error: err.message });
}

// PUT /api/calendar/:id/move: reschedule by shifting start_date. A synced event
// moves its source (the project shoot date or deadline, or the task due date)
// through the one shared write path; a manual event shifts itself, keeping the
// span to its end date.
router.put('/:id/move', (req, res) => {
  const { start_date } = req.body;
  if (!start_date || !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
    return res.status(400).json({ error: 'start_date required' });
  }

  const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  try {
    if (applySyncedEventChange(event.id, { start_date })) return res.json({ ok: true });
  } catch (err) { return fail(res, err); }

  let newEndDate = null;
  if (event.end_date) {
    const span = Math.round(
      (Date.parse(`${event.end_date}T00:00:00Z`) - Date.parse(`${event.start_date}T00:00:00Z`)) / 86400000
    );
    newEndDate = addDays(start_date, span);
  }
  db.prepare('UPDATE calendar_events SET start_date = ?, end_date = ? WHERE id = ?')
    .run(start_date, newEndDate, event.id);
  res.json({ ok: true });
});

// PUT /api/calendar/:id
// A synced event is edited through its source, the same write path a drag
// uses. Its type and linked project are locked, and a field its source has no
// place for is refused rather than silently dropped on the next sync.
router.put('/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  // Colour is no longer stored: it is derived from event_type at render time.
  const { project_id, title, event_type, start_date, end_date, start_time, end_time, location, notes } = req.body;
  if (!title || !start_date) return res.status(400).json({ error: 'Title and start_date required' });

  const source = eventSource(event);
  if (source) {
    const norm = v => (v === undefined || v === null || v === '' ? null : String(v));
    const sameTime = (a, b) => (norm(a) || '').slice(0, 5) === (norm(b) || '').slice(0, 5);
    if ((event_type || event.event_type) !== event.event_type || norm(project_id) !== norm(event.project_id)) {
      return res.status(400).json({ error: 'The type and project of a synced event cannot be changed' });
    }
    const editable = EDITABLE[source.kind] || [];
    const incoming = { title, end_date, start_time, end_time, location, notes };
    const locked = Object.keys(incoming).filter(k => {
      if (editable.includes(k)) return false;
      if (k === 'start_time' || k === 'end_time') return !sameTime(incoming[k], event[k]);
      return norm(incoming[k]) !== norm(event[k]);
    });
    if (locked.length) {
      return res.status(400).json({ error: `These fields live on the source and cannot be changed here: ${locked.join(', ')}` });
    }
    const change = { start_date };
    if (editable.includes('start_time')) change.start_time = start_time || null;
    if (editable.includes('end_time')) change.end_time = end_time || null;
    try {
      applySyncedEventChange(event.id, change);
    } catch (err) { return fail(res, err); }
    return res.json({ ok: true });
  }

  db.prepare(`
    UPDATE calendar_events SET
      project_id=?, title=?, event_type=?, start_date=?, end_date=?,
      start_time=?, end_time=?, location=?, notes=?
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
    req.params.id,
  );
  res.json({ ok: true });
});

// DELETE /api/calendar/:id
// Deleting a synced event clears the date on its source, so the event does not
// return on the next save of that project or task. A manual event is removed.
router.delete('/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
  if (!event) return res.json({ ok: true });
  try {
    const source = applySyncedEventChange(event.id, { start_date: null });
    if (source) return res.json({ ok: true, cleared: { kind: source.kind, id: source.id, name: source.name } });
  } catch (err) { return fail(res, err); }
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(event.id);
  res.json({ ok: true });
});

// GET /api/calendar/upcoming?limit=3
router.get('/upcoming', (req, res) => {
  const limit = parseInt(req.query.limit) || 3;
  const today = pristinaToday();
  const events = db.prepare(`
    SELECT * FROM calendar_events
    WHERE start_date >= ?
    ORDER BY start_date ASC, start_time ASC
    LIMIT ?
  `).all(today, limit);
  res.json(events);
});

module.exports = router;
