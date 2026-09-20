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

// GET /all: standalone tasks and project tasks in one normalised shape.
// This is a read-only aggregate for the Tasks page. Project tasks are still
// written through the project task endpoints, so nothing here can damage a
// phase, a crew link or the calendar. Sorting is done here so the client never
// re-derives an ORDER BY that could drift from the server: pending first, then
// due date ascending (no date last), then priority (high first), then creation
// date; completed last, most recently completed first.
router.get('/all', (req, res) => {
  const standalone = db.prepare('SELECT * FROM standalone_tasks').all().map(t => ({
    source: 'standalone',
    id: t.id,
    title: t.title,
    notes: t.notes,
    due_date: t.due_date,
    done: t.done ? 1 : 0,
    completed_at: t.completed_at,
    created_at: t.created_at,
    priority: t.priority || 'normal',
    project_id: null,
    project_title: null,
    category_name: null,
    category_group: null,
    phase_id: null,
    phase_name: null,
    phase_order: null,
    assigned_crew_id: null,
    crew_name: null,
    is_locked: 0,
  }));

  const project = db.prepare(`
    SELECT t.id, t.title, t.notes, t.due_date, t.status, t.created_at, t.is_locked,
           t.project_id, t.assigned_crew_id, t.phase_id,
           p.title AS project_title,
           pc.name AS category_name, pc.group_name AS category_group,
           ph.phase_name AS phase_name, ph.order_index AS phase_order,
           cr.name AS crew_name
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN project_categories pc ON pc.id = p.category_id
    LEFT JOIN project_phases ph ON ph.id = t.phase_id
    LEFT JOIN crew cr ON cr.id = t.assigned_crew_id
  `).all().map(t => ({
    source: 'project',
    id: t.id,
    title: t.title,
    notes: t.notes,
    due_date: t.due_date,
    done: t.status === 'done' ? 1 : 0,
    completed_at: null,
    created_at: t.created_at,
    priority: null,
    project_id: t.project_id,
    project_title: t.project_title,
    category_name: t.category_name,
    category_group: t.category_group,
    phase_id: t.phase_id,
    phase_name: t.phase_name,
    phase_order: t.phase_order,
    assigned_crew_id: t.assigned_crew_id,
    crew_name: t.crew_name,
    is_locked: t.is_locked ? 1 : 0,
  }));

  const priorityRank = p => (p === 'high' ? 0 : 1);
  const all = [...standalone, ...project];
  all.sort((a, b) => {
    if (a.done !== b.done) return a.done - b.done;          // pending before done
    if (a.done === 1) {
      return String(b.completed_at || '').localeCompare(String(a.completed_at || ''));
    }
    if (a.due_date && !b.due_date) return -1;               // dated before undated
    if (!a.due_date && b.due_date) return 1;
    if (a.due_date && b.due_date && a.due_date !== b.due_date) {
      return a.due_date.localeCompare(b.due_date);          // due date ascending
    }
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;                                // high priority first
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });

  res.json(all);
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
