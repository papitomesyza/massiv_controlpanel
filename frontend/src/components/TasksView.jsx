import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, Edit2, Check, ChevronDown, ChevronUp, Flag, Search, ListChecks,
} from 'lucide-react';
import { api } from '../api';
import { categoryIconEl } from '../lib/categoryIcons';
import Modal from './Modal';

// ── Day boundary ───────────────────────────────────────────────────────────────
// The app treats "today" as Pristina local, the same zone the backups and the
// shot list windows use. toISOString would return the UTC date, which between
// midnight and ~02:00 local reads as yesterday, so a task due yesterday would
// stop reading as overdue during those hours. en-CA gives an ISO-shaped date.
const ZONE = 'Europe/Belgrade';
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONE });
}

// Whole-day difference between an ISO date string and today. Both sides are
// parsed as local midnight, so the diff is stable whatever the browser zone.
function dayDiff(dateStr, todayStr) {
  const a = new Date(todayStr + 'T00:00:00');
  const b = new Date(dateStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

// Relative label a user acts on: today, in 3d, 2d ago. A real date, so text.
function relativeDue(dateStr, todayStr) {
  const diff = dayDiff(dateStr, todayStr);
  if (diff === 0) return 'today';
  if (diff > 0) return `in ${diff}d`;
  return `${-diff}d ago`;
}

// Which time group a pending task belongs to.
function groupOf(dateStr, todayStr) {
  if (!dateStr) return 'none';
  const diff = dayDiff(dateStr, todayStr);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'week';
  return 'later';
}

// Urgency class for the due chip, drawn from the shared palette.
function dueClass(dateStr, todayStr) {
  const diff = dayDiff(dateStr, todayStr);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'soon';
  return 'later';
}

const GROUP_ORDER = ['overdue', 'today', 'week', 'later', 'none'];
const GROUP_LABEL = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
  none: 'No date',
};

const taskKey = t => `${t.source}-${t.id}`;

/* ── inline edit modal (standalone only) ── */
function EditModal({ task, onClose, onSaved, onError }) {
  const [title, setTitle]       = useState(task.title);
  const [notes, setNotes]       = useState(task.notes || '');
  const [dueDate, setDueDate]   = useState(task.due_date || '');
  const [priority, setPriority] = useState(task.priority || 'normal');
  const [saving, setSaving]     = useState(false);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.put(`/standalone-tasks/${task.id}`, {
        title: title.trim(), notes: notes || null, due_date: dueDate || null, priority,
      });
      onSaved();
    } catch (_) {
      onError('Could not save task');
    } finally { setSaving(false); }
  }

  return (
    <Modal title="Edit Task" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving || !title.trim()}>Save</button>
      </>
    }>
      <div className="form-row">
        <label className="form-label">Title</label>
        <input
          className="input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && save()}
          autoFocus
        />
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
      </div>
      <div className="form-grid">
        <div>
          <label className="form-label">Due Date</label>
          <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Priority</label>
          <select className="select input" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}

/* ── completed this week ring ── */
// The numeral inside carries the count; the ring carries completed against the
// total due in the current week. Same construction as the estimates win ring.
function CompletedRing({ completed, total }) {
  const size = 46, R = 19, C = 2 * Math.PI * R;
  const frac = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;
  const cx = size / 2, cy = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="win-ring">
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--color-hairline)" strokeWidth="4" />
      {total > 0 && (
        <circle
          cx={cx} cy={cy} r={R} fill="none" stroke="var(--cat-6)" strokeWidth="4"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="win-ring-num">
        {completed}
      </text>
    </svg>
  );
}

/* ── stat strip ── */
// Opens the page with the three figures that matter today, matching the
// construction of the Estimates and Projects strips so the pages read as
// siblings. No subtitles: the label and the figure carry it.
function StatStrip({ tasks, todayStr }) {
  const strip = useMemo(() => {
    const pending = tasks.filter(t => t.done === 0);
    const overdue = pending.filter(t => t.due_date && dayDiff(t.due_date, todayStr) < 0).length;
    const dueToday = pending.filter(t => t.due_date && dayDiff(t.due_date, todayStr) === 0).length;

    // Current week window, Monday to Sunday, in Pristina local terms. Tasks with
    // a due date inside it form the denominator; the done ones the numerator.
    const t0 = new Date(todayStr + 'T00:00:00');
    const dow = (t0.getDay() + 6) % 7;   // 0 = Monday
    const monday = new Date(t0); monday.setDate(t0.getDate() - dow);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const iso = d => d.toLocaleDateString('en-CA');
    const wkStart = iso(monday), wkEnd = iso(sunday);

    const weekTasks = tasks.filter(t => t.due_date && t.due_date >= wkStart && t.due_date <= wkEnd);
    const weekTotal = weekTasks.length;
    const weekDone = weekTasks.filter(t => t.done === 1).length;

    return { overdue, dueToday, weekTotal, weekDone };
  }, [tasks, todayStr]);

  return (
    <div className="est-pipeline">
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Overdue</div>
        <div className="est-pipe-value" style={strip.overdue > 0 ? { color: 'var(--color-ember)' } : {}}>
          {strip.overdue}
        </div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Due today</div>
        <div className="est-pipe-value">{strip.dueToday}</div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Completed this week</div>
        <div
          className="est-pipe-ring"
          title={`${strip.weekDone} of ${strip.weekTotal} tasks due this week completed`}
        >
          <CompletedRing completed={strip.weekDone} total={strip.weekTotal} />
        </div>
      </div>
    </div>
  );
}

/* ── one pending task row ── */
function TaskRow({ task, todayStr, onToggle, onDelete, onEdit, onOpenProject }) {
  const [leaving, setLeaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const isProject = task.source === 'project';
  const high = task.source === 'standalone' && task.priority === 'high';

  function handleDone() {
    setLeaving(true);
    setTimeout(() => onToggle(task), 200);
  }
  function handleDelete() {
    setLeaving(true);
    setTimeout(() => onDelete(task), 200);
  }

  return (
    <div className={`task-row${high ? ' is-high' : ''}${leaving ? ' is-leaving' : ''}`}>
      <button
        className="task-check"
        onClick={handleDone}
        title="Mark done"
        aria-label="Mark done"
      />

      <div
        className={`task-main${isProject ? ' is-project' : ''}`}
        onClick={isProject ? () => onOpenProject(task) : undefined}
        role={isProject ? 'button' : undefined}
        tabIndex={isProject ? 0 : undefined}
        onKeyDown={isProject ? (e => { if (e.key === 'Enter') onOpenProject(task); }) : undefined}
        title={isProject ? `Open ${task.project_title}` : undefined}
      >
        <span className="task-title">{task.title}</span>
        {isProject && (
          <span className="task-project" style={{ '--tint': 'var(--color-mid-gray)' }}>
            <span className="task-project-icon">{categoryIconEl(task.category_name, task.category_group, 13)}</span>
            <span className="task-project-name">{task.project_title}</span>
          </span>
        )}
      </div>

      {task.due_date && (
        <span className={`task-due-chip ${dueClass(task.due_date, todayStr)}`}>
          {relativeDue(task.due_date, todayStr)}
        </span>
      )}

      {!isProject && (
        confirming ? (
          <div className="task-actions is-confirm">
            <button className="btn btn-danger btn-sm" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={handleDelete}>Yes</button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={() => setConfirming(false)}>No</button>
          </div>
        ) : (
          <div className="task-actions">
            <button className="btn btn-ghost btn-sm task-action-btn" onClick={() => onEdit(task)} title="Edit task">
              <Edit2 size={14} />
            </button>
            <button className="btn btn-ghost btn-sm task-action-btn" onClick={() => setConfirming(true)} title="Delete task">
              <Trash2 size={14} />
            </button>
          </div>
        )
      )}
    </div>
  );
}

/* ── compact done row inside the collapsible completed sub-section ── */
function DoneRow({ task, onToggle, onDelete, onOpenProject }) {
  const [confirming, setConfirming] = useState(false);
  const isProject = task.source === 'project';

  return (
    <div className="task-row is-done">
      <button className="task-check done" onClick={() => onToggle(task)} title="Reopen">
        <Check size={12} strokeWidth={3} />
      </button>
      <div
        className={`task-main${isProject ? ' is-project' : ''}`}
        onClick={isProject ? () => onOpenProject(task) : undefined}
        role={isProject ? 'button' : undefined}
        tabIndex={isProject ? 0 : undefined}
      >
        <span className="task-title task-title-done">{task.title}</span>
      </div>
      {!isProject && (
        confirming ? (
          <div className="task-actions is-confirm">
            <button className="btn btn-danger btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => onDelete(task)}>Yes</button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => setConfirming(false)}>No</button>
          </div>
        ) : (
          <div className="task-actions">
            <button className="btn btn-ghost btn-sm task-action-btn" onClick={() => setConfirming(true)} title="Delete">
              <Trash2 size={13} />
            </button>
          </div>
        )
      )}
    </div>
  );
}

/* ── main view ── */
export default function TasksView() {
  const [tasks, setTasks]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [query, setQuery]             = useState('');
  const [standaloneOnly, setStandaloneOnly] = useState(false);
  const [newTitle, setNewTitle]       = useState('');
  const [newDue, setNewDue]           = useState('');
  const [newPriority, setNewPriority] = useState('normal');
  const [adding, setAdding]           = useState(false);
  const [doneOpen, setDoneOpen]       = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const todayStr = today();

  async function load() {
    const data = await api.get('/standalone-tasks/all');
    setTasks(data);
  }

  useEffect(() => {
    load().catch(() => setError('Could not load tasks')).finally(() => setLoading(false));
  }, []);

  function flashError(msg) {
    setError(msg);
    setTimeout(() => setError(''), 3000);
  }

  async function handleAdd() {
    if (!newTitle.trim() || adding) return;
    setAdding(true);
    try {
      await api.post('/standalone-tasks', {
        title: newTitle.trim(),
        due_date: newDue || null,
        priority: newPriority,
      });
      await load();
      setNewTitle('');
      setNewDue('');
      setNewPriority('normal');
      inputRef.current?.focus();
    } catch (_) {
      flashError('Could not add task');
    } finally { setAdding(false); }
  }

  // Optimistic flip, then write through the right endpoint. Project tasks round
  // trip their existing fields so the project's phase progress and calendar stay
  // correct. On failure the whole list rolls back to the snapshot.
  async function handleToggle(task) {
    const snapshot = tasks;
    setTasks(prev => prev.map(t =>
      taskKey(t) === taskKey(task) ? { ...t, done: t.done ? 0 : 1 } : t
    ));
    try {
      if (task.source === 'standalone') {
        await api.post(`/standalone-tasks/${task.id}/toggle`, {});
      } else {
        await api.put(`/projects/${task.project_id}/tasks/${task.id}`, {
          title: task.title,
          assigned_crew_id: task.assigned_crew_id ?? null,
          due_date: task.due_date || null,
          notes: task.notes || null,
          status: task.done ? 'todo' : 'done',
        });
      }
      await load();
    } catch (_) {
      setTasks(snapshot);
      flashError('Could not update task');
    }
  }

  async function handleDelete(task) {
    if (task.source !== 'standalone') return;
    const snapshot = tasks;
    setTasks(prev => prev.filter(t => taskKey(t) !== taskKey(task)));
    try {
      await api.del(`/standalone-tasks/${task.id}`);
    } catch (_) {
      setTasks(snapshot);
      flashError('Could not delete task');
    }
  }

  function openProject(task) {
    navigate(`/projects/${task.project_id}`);
  }

  async function handleSaved() {
    setEditingTask(null);
    try { await load(); } catch (_) { flashError('Could not refresh tasks'); }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter(t => {
      if (standaloneOnly && t.source !== 'standalone') return false;
      if (!q) return true;
      return (t.title || '').toLowerCase().includes(q) ||
             (t.project_title || '').toLowerCase().includes(q);
    });
  }, [tasks, query, standaloneOnly]);

  const pending = visible.filter(t => t.done === 0);
  const done    = visible.filter(t => t.done === 1);

  const groups = useMemo(() => {
    const map = { overdue: [], today: [], week: [], later: [], none: [] };
    pending.forEach(t => { map[groupOf(t.due_date, todayStr)].push(t); });
    return map;
  }, [pending, todayStr]);

  if (loading) return <div className="loading">Loading tasks...</div>;

  const hasPending = pending.length > 0;

  return (
    <div>
      <StatStrip tasks={tasks} todayStr={todayStr} />

      {/* Search and the standalone-only filter, same placement as the other pages. */}
      <div className="est-controls">
        <div className="est-search">
          <Search size={15} />
          <input
            className="input"
            placeholder="Search task or project"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <button
          className={`btn btn-sm ${standaloneOnly ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderRadius: '18px', padding: '6px 16px', flexShrink: 0 }}
          onClick={() => setStandaloneOnly(v => !v)}
          title="Show only your own tasks"
        >
          My tasks only
        </button>
      </div>

      {error && <div className="error-msg" style={{ marginBottom: '12px' }}>{error}</div>}

      {/* Quick add, standalone tasks only. */}
      <div className="standalone-add-row">
        <div className="standalone-add-controls" style={{ flexWrap: 'nowrap' }}>
          <input
            ref={inputRef}
            className="input standalone-add-input"
            placeholder="Add a task..."
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
        </div>
        <div className="standalone-add-controls">
          <input
            className="input standalone-date-input"
            type="date"
            value={newDue}
            onChange={e => setNewDue(e.target.value)}
            title="Due date (optional)"
          />
          <button
            className={`standalone-priority-toggle${newPriority === 'high' ? ' is-high' : ''}`}
            onClick={() => setNewPriority(p => p === 'normal' ? 'high' : 'normal')}
            title={newPriority === 'high' ? 'Priority: High' : 'Priority: Normal'}
            type="button"
          >
            <Flag size={13} />
          </button>
          <button
            className="btn btn-primary"
            style={{ flexShrink: 0 }}
            onClick={handleAdd}
            disabled={!newTitle.trim() || adding}
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* Time groups. Empty groups are not rendered. */}
      {hasPending ? (
        <div className="card" style={{ marginTop: '16px' }}>
          {GROUP_ORDER.map(key => {
            const items = groups[key];
            if (!items.length) return null;
            return (
              <div key={key} className={`task-group group-${key}`}>
                <div className="task-group-header">
                  <span className="task-group-name">{GROUP_LABEL[key]}</span>
                  <span className="task-group-count">{items.length}</span>
                </div>
                {items.map(t => (
                  <TaskRow
                    key={taskKey(t)}
                    task={t}
                    todayStr={todayStr}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    onEdit={setEditingTask}
                    onOpenProject={openProject}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="task-empty">
          <ListChecks size={40} color="var(--color-hairline-strong)" />
          <div className="task-empty-text">{query || standaloneOnly ? 'No matches' : 'All clear'}</div>
        </div>
      )}

      {/* Completed sub-section: collapsible, collapsed by default. */}
      {done.length > 0 && (
        <div className="card" style={{ marginTop: '16px' }}>
          <button className="standalone-done-header" onClick={() => setDoneOpen(o => !o)}>
            <span className="standalone-done-label">
              Completed
              <span className="standalone-done-count">{done.length}</span>
            </span>
            {doneOpen ? <ChevronUp size={14} color="var(--color-mid-gray)" /> : <ChevronDown size={14} color="var(--color-mid-gray)" />}
          </button>
          {doneOpen && done.map(t => (
            <DoneRow
              key={taskKey(t)}
              task={t}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onOpenProject={openProject}
            />
          ))}
        </div>
      )}

      {editingTask && (
        <EditModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={handleSaved}
          onError={flashError}
        />
      )}
    </div>
  );
}
