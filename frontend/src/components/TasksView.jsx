import React, { useEffect, useState, useRef } from 'react';
import {
  Plus, Trash2, Edit2, Check, ChevronDown, ChevronUp, Flag, X, CalendarDays,
} from 'lucide-react';
import { api } from '../api';
import Modal from './Modal';

function today() {
  return new Date().toISOString().split('T')[0];
}

function isPast(dateStr) {
  if (!dateStr) return false;
  return dateStr < today();
}

function fmtDue(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/* ── inline edit modal ── */
function EditModal({ task, onClose, onSaved }) {
  const [title, setTitle]     = useState(task.title);
  const [notes, setNotes]     = useState(task.notes || '');
  const [dueDate, setDueDate] = useState(task.due_date || '');
  const [priority, setPriority] = useState(task.priority || 'normal');
  const [saving, setSaving]   = useState(false);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const updated = await api.put(`/standalone-tasks/${task.id}`, {
        title: title.trim(), notes: notes || null, due_date: dueDate || null, priority,
      });
      onSaved(updated);
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

/* ── single task row ── */
function TaskRow({ task, onToggle, onDelete, onEdit }) {
  const [confirming, setConfirming] = useState(false);
  const done = task.done === 1;
  const overdue = !done && isPast(task.due_date);

  return (
    <div
      className="standalone-task-row"
      style={{ opacity: done ? 0.55 : 1 }}
    >
      {/* checkbox */}
      <button
        className={`standalone-task-check${done ? ' done' : ''}`}
        onClick={() => onToggle(task.id)}
        title={done ? 'Mark pending' : 'Mark done'}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>

      {/* title + meta */}
      <div className="standalone-task-body">
        <span className="standalone-task-title" style={done ? { textDecoration: 'line-through', color: '#666' } : {}}>
          {task.title}
        </span>
        <div className="standalone-task-meta">
          {task.due_date && (
            <span
              className="standalone-task-due"
              style={overdue ? { color: 'var(--warning)', fontWeight: 600 } : { color: '#888' }}
            >
              <CalendarDays size={11} />
              {fmtDue(task.due_date)}
              {overdue && ' · overdue'}
            </span>
          )}
          {task.priority === 'high' && (
            <span className="standalone-task-flag">
              <Flag size={11} style={{ color: '#FF4444' }} /> high
            </span>
          )}
          {task.notes && (
            <span className="standalone-task-notes-preview">{task.notes}</span>
          )}
        </div>
      </div>

      {/* actions */}
      <div className="standalone-task-actions">
        {confirming ? (
          <>
            <span style={{ fontSize: '12px', color: '#888' }}>Delete?</span>
            <button className="btn btn-danger btn-sm" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => onDelete(task.id)}>Yes</button>
            <button className="btn btn-ghost btn-sm"  style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => setConfirming(false)}>No</button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm standalone-action-btn" onClick={() => onEdit(task)} title="Edit">
              <Edit2 size={13} />
            </button>
            <button className="btn btn-ghost btn-sm standalone-action-btn" onClick={() => setConfirming(true)} title="Delete">
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── main view ── */
export default function TasksView() {
  const [tasks, setTasks]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [newTitle, setNewTitle]   = useState('');
  const [newDue, setNewDue]       = useState('');
  const [newPriority, setNewPriority] = useState('normal');
  const [adding, setAdding]       = useState(false);
  const [doneOpen, setDoneOpen]   = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const inputRef = useRef(null);

  async function load() {
    const data = await api.get('/standalone-tasks');
    setTasks(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd() {
    if (!newTitle.trim() || adding) return;
    setAdding(true);
    try {
      const task = await api.post('/standalone-tasks', {
        title: newTitle.trim(),
        due_date: newDue || null,
        priority: newPriority,
      });
      setTasks(prev => [task, ...prev]);
      setNewTitle('');
      setNewDue('');
      setNewPriority('normal');
      inputRef.current?.focus();
    } finally { setAdding(false); }
  }

  async function handleToggle(id) {
    const updated = await api.post(`/standalone-tasks/${id}/toggle`, {});
    setTasks(prev => {
      const next = prev.map(t => t.id === id ? updated : t);
      // re-sort: pending first, then done
      return [
        ...next.filter(t => t.done === 0).sort((a, b) => {
          if (a.due_date && !b.due_date) return -1;
          if (!a.due_date && b.due_date) return 1;
          if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
          return b.created_at.localeCompare(a.created_at);
        }),
        ...next.filter(t => t.done === 1).sort((a, b) =>
          (b.completed_at || '').localeCompare(a.completed_at || '')
        ),
      ];
    });
  }

  async function handleDelete(id) {
    await api.del(`/standalone-tasks/${id}`);
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  function handleSaved(updated) {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    setEditingTask(null);
  }

  const pending = tasks.filter(t => t.done === 0);
  const done    = tasks.filter(t => t.done === 1);

  if (loading) return <div className="loading">Loading tasks…</div>;

  return (
    <div className="standalone-tasks-wrap">
      {/* ── quick-add ── */}
      <div className="card card-pad standalone-add-row">
        <input
          ref={inputRef}
          className="input standalone-add-input"
          placeholder="Add a task…"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
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
            title={newPriority === 'high' ? 'Priority: High — click to set Normal' : 'Priority: Normal — click to set High'}
            type="button"
          >
            <Flag size={13} />
            {newPriority === 'high' ? 'High' : 'Normal'}
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

      {/* ── pending tasks ── */}
      {pending.length === 0 ? (
        <div className="card card-pad empty" style={{ textAlign: 'center', color: '#555', fontSize: '14px' }}>
          No pending tasks — add one above
        </div>
      ) : (
        <div className="card">
          {pending.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onEdit={setEditingTask}
            />
          ))}
        </div>
      )}

      {/* ── completed section (collapsible) ── */}
      {done.length > 0 && (
        <div className="card" style={{ marginTop: '16px' }}>
          <button
            className="standalone-done-header"
            onClick={() => setDoneOpen(o => !o)}
          >
            <span className="standalone-done-label">
              Completed
              <span className="standalone-done-count">{done.length}</span>
            </span>
            {doneOpen ? <ChevronUp size={14} color="#888" /> : <ChevronDown size={14} color="#888" />}
          </button>

          {doneOpen && (
            <div>
              {done.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEdit={setEditingTask}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {editingTask && (
        <EditModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
