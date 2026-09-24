// Calendar events that mirror a date held somewhere else. A shoot or deadline
// event is the project's shoot date or deadline, a task event is the task's due
// date, and a standalone task event is the standalone task's due date. The
// source row owns the date; the calendar row is regenerated from it.
//
// Every change to a synced event goes through applySyncedEventChange: it writes
// the source, then lets the matching sync rebuild the event. Dragging, the edit
// form and delete all use it, so there is exactly one write path and a later
// save of the project or task can never revert a calendar edit.

const { db } = require('../db/database');
const { followProjectShootDate } = require('./shotlistStore');

const PRODUCTION_GROUPS = ['Video Production', 'Photography'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}(:\d{2})?$/;

function syncTaskCalendarEvent(taskId) {
  db.prepare("DELETE FROM calendar_events WHERE event_type='task' AND task_id = ?").run(taskId);
  const task = db.prepare(
    'SELECT t.due_date, t.status, t.title, t.project_id, p.title AS project_title FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?'
  ).get(taskId);
  if (!task || !task.due_date || task.status === 'done') return;
  const title = task.project_title ? `${task.project_title}: ${task.title}` : task.title;
  // Colour is derived from event_type at render time, never stored. NULL is set
  // explicitly so existing databases do not fall back to the old column default.
  db.prepare(
    "INSERT INTO calendar_events (project_id, task_id, title, event_type, start_date, color) VALUES (?, ?, ?, 'task', ?, NULL)"
  ).run(task.project_id, taskId, title, task.due_date);
}

function syncProjectCalendarEvents(projectId, title, deadline, shootDate, shootLocation, shootStartTime, shootEndTime) {
  db.prepare("DELETE FROM calendar_events WHERE project_id = ? AND event_type IN ('shoot', 'deadline')").run(projectId);

  const catRow = db.prepare(
    'SELECT pc.group_name FROM projects p LEFT JOIN project_categories pc ON pc.id = p.category_id WHERE p.id = ?'
  ).get(projectId);
  const groupName = catRow?.group_name || null;

  // Colour is derived from event_type at render time, never stored. NULL is set
  // explicitly so existing databases do not fall back to the old column default.
  if (deadline) {
    db.prepare(
      "INSERT INTO calendar_events (project_id, title, event_type, start_date, color) VALUES (?, ?, 'deadline', ?, NULL)"
    ).run(projectId, title, deadline);
  }

  if (shootDate && PRODUCTION_GROUPS.includes(groupName)) {
    db.prepare(
      "INSERT INTO calendar_events (project_id, title, event_type, start_date, location, start_time, end_time, color) VALUES (?, ?, 'shoot', ?, ?, ?, ?, NULL)"
    ).run(projectId, title, shootDate, shootLocation || null, shootStartTime || null, shootEndTime || null);
  }
}

// Rebuild a project's shoot and deadline events from its stored row.
function resyncProject(projectId) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!p) return;
  syncProjectCalendarEvents(p.id, p.title, p.deadline || null, p.shoot_date || null,
    p.shoot_location || null, p.shoot_start_time || null, p.shoot_end_time || null);
}

function syncStandaloneTaskCalendarEvent(taskId) {
  db.prepare('DELETE FROM calendar_events WHERE event_type = ? AND standalone_task_id = ?')
    .run('standalone_task', taskId);
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(taskId);
  if (!task) return;
  if (task.due_date && task.done === 0) {
    // Colour is derived from event_type at render time, never stored. NULL is set
    // explicitly so existing databases do not fall back to the old column default.
    db.prepare(`
      INSERT INTO calendar_events (standalone_task_id, event_type, start_date, title, color)
      VALUES (?, 'standalone_task', ?, ?, NULL)
    `).run(taskId, task.due_date, task.title);
  }
}

// The source a calendar event mirrors, or null for a manually created event
// (meeting, other, or a synced type whose source no longer exists).
function eventSource(event) {
  if (!event) return null;
  if ((event.event_type === 'shoot' || event.event_type === 'deadline') && event.project_id) {
    const p = db.prepare('SELECT id, title FROM projects WHERE id = ?').get(event.project_id);
    if (!p) return null;
    return { kind: event.event_type, id: p.id, name: p.title };
  }
  if (event.event_type === 'task' && event.task_id) {
    const t = db.prepare('SELECT id, title, project_id FROM tasks WHERE id = ?').get(event.task_id);
    if (!t) return null;
    return { kind: 'task', id: t.id, name: t.title, project_id: t.project_id };
  }
  if (event.event_type === 'standalone_task' && event.standalone_task_id) {
    const t = db.prepare('SELECT id, title FROM standalone_tasks WHERE id = ?').get(event.standalone_task_id);
    if (!t) return null;
    return { kind: 'standalone_task', id: t.id, name: t.title };
  }
  return null;
}

// Which event fields each source can hold. Anything else on a synced event has
// no home and would be lost on the next sync, so it is not editable.
const EDITABLE = {
  shoot: ['start_date', 'start_time', 'end_time'],
  deadline: ['start_date'],
  task: ['start_date'],
  standalone_task: ['start_date'],
};

// Apply a change to a synced event by writing its source, then regenerating the
// event. change.start_date is a YYYY-MM-DD date, or null to clear the source
// date (which removes the event). For a shoot, start_time and end_time may be
// passed too. Runs in one transaction: better-sqlite3 is synchronous, so no
// other write can land between the source update and the resync.
// Returns the source that was changed, or null when the event is not synced.
const applySyncedEventChange = db.transaction((eventId, change) => {
  const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId);
  const source = eventSource(event);
  if (!source) return null;

  const date = change.start_date === null ? null : String(change.start_date || '');
  if (date !== null && !YMD.test(date)) {
    const err = new Error('start_date must be a YYYY-MM-DD date');
    err.status = 400;
    throw err;
  }

  if (source.kind === 'shoot') {
    const before = db.prepare('SELECT shoot_date FROM projects WHERE id = ?').get(source.id);
    const sets = ['shoot_date = ?'];
    const params = [date];
    ['start_time', 'end_time'].forEach(k => {
      if (!(k in change)) return;
      const v = change[k] || null;
      if (v !== null && !HM.test(v)) {
        const err = new Error(`${k} must be HH:MM`);
        err.status = 400;
        throw err;
      }
      sets.push(`shoot_${k} = ?`);
      params.push(v);
    });
    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params, source.id);
    // Linked shot lists follow the shoot, in this same transaction.
    followProjectShootDate(source.id, before && before.shoot_date, date);
    resyncProject(source.id);
  } else if (source.kind === 'deadline') {
    db.prepare('UPDATE projects SET deadline = ? WHERE id = ?').run(date, source.id);
    resyncProject(source.id);
  } else if (source.kind === 'task') {
    db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(date, source.id);
    syncTaskCalendarEvent(source.id);
  } else if (source.kind === 'standalone_task') {
    db.prepare('UPDATE standalone_tasks SET due_date = ? WHERE id = ?').run(date, source.id);
    syncStandaloneTaskCalendarEvent(source.id);
  }
  return source;
});

module.exports = {
  PRODUCTION_GROUPS,
  EDITABLE,
  syncTaskCalendarEvent,
  syncProjectCalendarEvents,
  syncStandaloneTaskCalendarEvent,
  resyncProject,
  eventSource,
  applySyncedEventChange,
};
