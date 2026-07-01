const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET / — all tasks, ordered: pending first (due_date asc, then no-date, newest tiebreak), then done (completed_at desc)
router.get('/', (req, res) => {
  const tasks = db.prepare(`
    SELECT * FROM standalone_tasks
    ORDER BY
      done ASC,
      CASE WHEN done = 0 AND due_date IS NOT NULL THEN 0 ELSE 1 END ASC,
      CASE WHEN done = 0 AND due_date IS NOT NULL THEN due_date END ASC,
      CASE WHEN done = 0 THEN created_at END DESC,
      completed_at DESC
  `).all();
  res.json(tasks);
});

// POST / — create
router.post('/', (req, res) => {
  const { title, notes, due_date, priority } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const p = ['normal', 'high'].includes(priority) ? priority : 'normal';
  const result = db.prepare(`
    INSERT INTO standalone_tasks (title, notes, due_date, priority)
    VALUES (?, ?, ?, ?)
  `).run(title.trim(), notes || null, due_date || null, p);
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(result.lastInsertRowid);
  syncStandaloneTaskCalendarEvent(task.id);
  res.json(task);
});

// PUT /:id — update editable fields
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  const { title, notes, due_date, priority } = req.body;
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
    return res.status(400).json({ error: 'title must be a non-empty string' });
  }
  const p = ['normal', 'high'].includes(priority) ? priority : existing.priority;
  db.prepare(`
    UPDATE standalone_tasks SET title=?, notes=?, due_date=?, priority=? WHERE id=?
  `).run(
    title !== undefined ? title.trim() : existing.title,
    notes !== undefined ? (notes || null) : existing.notes,
    due_date !== undefined ? (due_date || null) : existing.due_date,
    p,
    req.params.id
  );
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(req.params.id);
  syncStandaloneTaskCalendarEvent(task.id);
  res.json(task);
});

// POST /:id/toggle — flip done
router.post('/:id/toggle', (req, res) => {
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.done === 0) {
    db.prepare("UPDATE standalone_tasks SET done=1, completed_at=datetime('now') WHERE id=?").run(req.params.id);
  } else {
    db.prepare('UPDATE standalone_tasks SET done=0, completed_at=NULL WHERE id=?').run(req.params.id);
  }
  const updated = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(req.params.id);
  syncStandaloneTaskCalendarEvent(updated.id);
  res.json(updated);
});

// DELETE /:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM calendar_events WHERE event_type = ? AND standalone_task_id = ?')
    .run('standalone_task', req.params.id);
  db.prepare('DELETE FROM standalone_tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── helper: keeps the calendar event for a standalone task in sync ──
function syncStandaloneTaskCalendarEvent(taskId) {
  db.prepare('DELETE FROM calendar_events WHERE event_type = ? AND standalone_task_id = ?')
    .run('standalone_task', taskId);
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(taskId);
  if (!task) return;
  if (task.due_date && task.done === 0) {
    db.prepare(`
      INSERT INTO calendar_events (standalone_task_id, event_type, start_date, title, color)
      VALUES (?, 'standalone_task', ?, ?, '#E879F9')
    `).run(taskId, task.due_date, task.title);
  }
}

module.exports = router;
