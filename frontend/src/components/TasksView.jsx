import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, Edit2, Check, ChevronDown, ChevronUp, Flag, Search, ListChecks, FolderOpen,
} from 'lucide-react';
import { api } from '../api';
import DateField from './DateField';
import { categoryIconEl } from '../lib/categoryIcons';
import Overlay from './Overlay';

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
const projKey = pid => `massiv_tasks_proj_${pid}`;

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
    <Overlay title="Edit Task" onClose={onClose} footer={
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
          <DateField value={dueDate} onChange={setDueDate} />
        </div>
        <div>
          <label className="form-label">Priority</label>
          <select className="select input" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
    </Overlay>
  );
}

/* ── completed this week ring (stat strip) ── */
// The numeral inside carries the count completed this week; the ring carries
// that count against this week's actionable load (completed plus still open and
// due by week end). Same construction as the estimates win ring.
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

/* ── per-project progress ring (section header) ── */
// The arc fills with completed against total, so a barely started project reads
// as a nearly empty ring and a finished one as a full ring, distinct at a
// glance. The numeral inside is the outstanding count, the number still to do,
// since that is what the user acts on. Same win ring construction used on the
// Estimates and Projects strips.
function ProjectRing({ done, total }) {
  const size = 34, R = 13, C = 2 * Math.PI * R;
  const frac = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  const outstanding = Math.max(0, total - done);
  // A project with tasks and nothing left to do is finished, not empty. The full
  // arc plus a check reads as done at a glance, where a zero would read as
  // nothing. Every other state keeps the outstanding count.
  const finished = total > 0 && outstanding === 0;
  const cx = size / 2, cy = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="win-ring proj-ring">
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--color-hairline)" strokeWidth="3" />
      {frac > 0 && (
        <circle
          cx={cx} cy={cy} r={R} fill="none" stroke="var(--cat-6)" strokeWidth="3"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      {finished ? (
        <polyline
          points="11,17 15,21 23,12" fill="none" stroke="var(--cat-6)" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
        />
      ) : (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="proj-ring-num">
          {outstanding}
        </text>
      )}
    </svg>
  );
}

/* ── stat strip ── */
// Opens the page with the three figures that matter today, counting across both
// task types. Same construction as the Estimates and Projects strips.
function StatStrip({ tasks, todayStr }) {
  const strip = useMemo(() => {
    const pending = tasks.filter(t => t.done === 0);
    const overdue = pending.filter(t => t.due_date && dayDiff(t.due_date, todayStr) < 0).length;
    const dueToday = pending.filter(t => t.due_date && dayDiff(t.due_date, todayStr) === 0).length;

    // Current week window, Monday to Sunday, in Pristina local terms.
    const t0 = new Date(todayStr + 'T00:00:00');
    const dow = (t0.getDay() + 6) % 7;   // 0 = Monday
    const monday = new Date(t0); monday.setDate(t0.getDate() - dow);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const iso = d => d.toLocaleDateString('en-CA');
    const wkStart = iso(monday), wkEnd = iso(sunday);

    // Numerator: tasks whose completion landed inside this week, whatever their
    // due date and whether they ever had one. completed_at is a datetime, so its
    // date portion is what the week window is compared against. Both task types
    // now carry completed_at, so both count equally.
    const inWeek = ts => { const d = (ts || '').slice(0, 10); return d >= wkStart && d <= wkEnd; };
    const weekDone = tasks.filter(t => t.done === 1 && t.completed_at && inWeek(t.completed_at)).length;

    // Denominator: this week's actionable load, so the ring reads as how much of
    // what needed clearing is cleared. That is the tasks completed this week plus
    // the tasks still open that are due by the end of this week, overdue ones
    // included. A full ring means nothing due is left open.
    const pendingDue = pending.filter(t => t.due_date && t.due_date <= wkEnd).length;
    const weekTotal = weekDone + pendingDue;

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
          title={`${strip.weekDone} completed this week, of ${strip.weekTotal} due or done this week`}
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

/* ── compact done row ── */
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

/* ── one project section in the right column ── */
function ProjectSection({ section, totals, open, onToggle, todayStr, onToggleTask, onOpenProject }) {
  const t = totals || { total: 0, done: 0 };

  // Group this project's visible tasks by phase, in real phase order. A phase
  // with no visible task is not rendered.
  const phases = useMemo(() => {
    const map = new Map();
    section.tasks.forEach(task => {
      const key = task.phase_id == null ? 'none' : task.phase_id;
      if (!map.has(key)) {
        map.set(key, {
          key,
          phase_name: task.phase_name || 'No phase',
          phase_order: task.phase_order == null ? 9999 : task.phase_order,
          tasks: [],
        });
      }
      map.get(key).tasks.push(task);
    });
    return [...map.values()].sort((a, b) => a.phase_order - b.phase_order);
  }, [section.tasks]);

  return (
    <div className="proj-section">
      <button className="proj-section-header" onClick={onToggle} aria-expanded={open}>
        <span className="proj-section-icon">
          {categoryIconEl(section.category_name, section.category_group, 16)}
        </span>
        <span className="proj-section-name">{section.project_title}</span>
        <span className="proj-section-ring" title={`${t.done} of ${t.total} tasks done`}>
          <ProjectRing done={t.done} total={t.total} />
        </span>
        {open ? <ChevronUp size={15} color="var(--color-mid-gray)" /> : <ChevronDown size={15} color="var(--color-mid-gray)" />}
      </button>

      {open && phases.map(ph => (
        <div key={ph.key} className="proj-phase">
          <div className="proj-phase-label">{ph.phase_name}</div>
          {ph.tasks.map(task => (
            task.done
              ? <DoneRow key={taskKey(task)} task={task} onToggle={onToggleTask} onOpenProject={onOpenProject} />
              : <TaskRow key={taskKey(task)} task={task} todayStr={todayStr} onToggle={onToggleTask} onOpenProject={onOpenProject} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── main view ── */
export default function TasksView() {
  const [tasks, setTasks]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [query, setQuery]             = useState('');
  const [newTitle, setNewTitle]       = useState('');
  const [newDue, setNewDue]           = useState('');
  const [newPriority, setNewPriority] = useState('normal');
  const [adding, setAdding]           = useState(false);
  const [doneOpen, setDoneOpen]       = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [openMap, setOpenMap]         = useState({});   // project id -> user override
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

  // Hydrate the per-project open/closed overrides from localStorage whenever the
  // task set changes, so a user's stored choices survive a reload. Projects with
  // no stored choice fall back to the auto default computed at render time.
  useEffect(() => {
    const stored = {};
    tasks.forEach(t => {
      if (t.source !== 'project' || t.project_id == null) return;
      if (t.project_id in stored) return;
      let v = null;
      try { v = localStorage.getItem(projKey(t.project_id)); } catch (_) {}
      if (v === '1' || v === '0') stored[t.project_id] = v === '1';
    });
    setOpenMap(stored);
  }, [tasks]);

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

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // ── Left column: standalone tasks, title-matched while searching ──
  const standalonePending = useMemo(() => {
    const map = { overdue: [], today: [], week: [], later: [], none: [] };
    tasks
      .filter(t => t.source === 'standalone' && t.done === 0)
      .filter(t => !q || (t.title || '').toLowerCase().includes(q))
      .forEach(t => { map[groupOf(t.due_date, todayStr)].push(t); });
    return map;
  }, [tasks, q, todayStr]);

  const standaloneDone = useMemo(() => tasks
    .filter(t => t.source === 'standalone' && t.done === 1)
    .filter(t => !q || (t.title || '').toLowerCase().includes(q)),
  [tasks, q]);

  const hasPending = GROUP_ORDER.some(k => standalonePending[k].length);

  // ── Right column: project tasks grouped by project ──
  // Totals for the ring and the auto-open rule are computed from ALL of a
  // project's tasks, unaffected by the search filter, so a ring always reads the
  // project's real completed against total.
  const projectTotals = useMemo(() => {
    const map = new Map();
    tasks.filter(t => t.source === 'project').forEach(t => {
      const e = map.get(t.project_id) || { total: 0, done: 0, overdue: 0, today: 0 };
      e.total++;
      if (t.done) e.done++;
      else if (t.due_date) {
        const d = dayDiff(t.due_date, todayStr);
        if (d < 0) e.overdue++;
        else if (d === 0) e.today++;
      }
      map.set(t.project_id, e);
    });
    return map;
  }, [tasks, todayStr]);

  const projectSections = useMemo(() => {
    const matches = t => !q
      || (t.title || '').toLowerCase().includes(q)
      || (t.project_title || '').toLowerCase().includes(q)
      || (t.phase_name || '').toLowerCase().includes(q);

    const map = new Map();
    tasks
      .filter(t => t.source === 'project')
      .filter(matches)
      .forEach(t => {
        if (!map.has(t.project_id)) {
          map.set(t.project_id, {
            project_id: t.project_id,
            project_title: t.project_title,
            category_name: t.category_name,
            category_group: t.category_group,
            tasks: [],
          });
        }
        map.get(t.project_id).tasks.push(t);
      });

    // A project with no tasks renders no section. Sections are built from task
    // rows, so an empty project produces none, but the guard keeps that true if
    // the build ever changes.
    return [...map.values()].filter(s => s.tasks.length > 0).sort((a, b) => {
      const ta = projectTotals.get(a.project_id) || {};
      const tb = projectTotals.get(b.project_id) || {};
      const ra = ta.overdue > 0 ? 0 : ta.today > 0 ? 1 : 2;
      const rb = tb.overdue > 0 ? 0 : tb.today > 0 ? 1 : 2;
      if (ra !== rb) return ra - rb;
      return (a.project_title || '').localeCompare(b.project_title || '');
    });
  }, [tasks, q, projectTotals]);

  function autoOpen(pid) {
    const t = projectTotals.get(pid);
    return !!(t && (t.overdue > 0 || t.today > 0));
  }
  function sectionOpen(pid) {
    if (searching) return true;                 // a match forces the section open
    if (pid in openMap) return openMap[pid];    // the user's stored choice
    return autoOpen(pid);                        // otherwise the auto default
  }
  function toggleSection(pid) {
    const cur = (pid in openMap) ? openMap[pid] : autoOpen(pid);
    const next = !cur;
    setOpenMap(m => ({ ...m, [pid]: next }));
    try { localStorage.setItem(projKey(pid), next ? '1' : '0'); } catch (_) {}
  }

  if (loading) return <div className="loading">Loading tasks...</div>;

  return (
    <div className="tasks-page">
      <StatStrip tasks={tasks} todayStr={todayStr} />

      {/* One search above both columns: filters both at once. */}
      <div className="est-controls">
        <div className="est-search">
          <Search size={15} />
          <input
            className="input"
            placeholder="Search task, project or phase"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="error-msg" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="two-col tasks-split">
        {/* ── LEFT: My tasks ── */}
        <div className="tasks-col">
          <div className="tasks-col-head">My tasks</div>

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
              <DateField
                className="standalone-date-input"
                wrapClassName="standalone-date-wrap"
                value={newDue}
                onChange={setNewDue}
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

          {hasPending ? (
            <div className="card" style={{ marginTop: '10px' }}>
              {GROUP_ORDER.map(key => {
                const items = standalonePending[key];
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
              <ListChecks size={36} color="var(--color-hairline-strong)" />
              <div className="task-empty-text">{searching ? 'No matches' : 'All clear'}</div>
            </div>
          )}

          {/* Completed sub-section: collapsible, collapsed by default. */}
          {standaloneDone.length > 0 && (
            <div className="card" style={{ marginTop: '10px' }}>
              <button className="standalone-done-header" onClick={() => setDoneOpen(o => !o)}>
                <span className="standalone-done-label">
                  Completed
                  <span className="standalone-done-count">{standaloneDone.length}</span>
                </span>
                {doneOpen ? <ChevronUp size={14} color="var(--color-mid-gray)" /> : <ChevronDown size={14} color="var(--color-mid-gray)" />}
              </button>
              {doneOpen && standaloneDone.map(t => (
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
        </div>

        {/* ── RIGHT: Project tasks ── */}
        <div className="tasks-col">
          <div className="tasks-col-head">Project tasks</div>

          {projectSections.length > 0 ? (
            <div className="card">
              {projectSections.map(section => (
                <ProjectSection
                  key={section.project_id}
                  section={section}
                  totals={projectTotals.get(section.project_id)}
                  open={sectionOpen(section.project_id)}
                  onToggle={() => toggleSection(section.project_id)}
                  todayStr={todayStr}
                  onToggleTask={handleToggle}
                  onOpenProject={openProject}
                />
              ))}
            </div>
          ) : (
            <div className="task-empty">
              <FolderOpen size={36} color="var(--color-hairline-strong)" />
              <div className="task-empty-text">{searching ? 'No matches' : 'No project tasks'}</div>
            </div>
          )}
        </div>
      </div>

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
