import React, { useEffect, useState, useRef } from 'react';
import {
  Plus, Trash2, Edit2, Check, ChevronDown, ChevronUp, Flag, CalendarDays,
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
  const [title, setTitle]       = useState(task.title);
  const [notes, setNotes]       = useState(task.notes || '');
  const [dueDate, setDueDate]   = useState(task.due_date || '');
  const [priority, setPriority] = useState(task.priority || 'normal');
  const [saving, setSaving]     = useState(false);

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

/* ── task card — visually identical to LeadCard ── */
function TaskCard({ task, onToggle, onDelete, onEdit }) {
  const [confirming, setConfirming] = useState(false);
  const [visible, setVisible]       = useState(true);
  const overdue = isPast(task.due_date);

  function handleDone() {
    setVisible(false);
    setTimeout(() => onToggle(task.id), 220);
  }

  function handleDelete() {
    setVisible(false);
    setTimeout(() => onDelete(task.id), 220);
  }

  if (!visible) return <div className="lead-card lead-card-exit" />;

  return (
    <div className="lead-card lead-card-enter">
      {/* top label row — mirrors lead-card-category */}
      <div className="lead-card-category">
        <Check size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        TASK
        {task.priority === 'high' && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#FF4444', fontWeight: 700, fontSize: '10px' }}>
            <Flag size={10} /> HIGH
          </span>
        )}
      </div>

      {/* title — mirrors lead-card-client */}
      <div className="lead-card-client">{task.title}</div>

      {/* notes — mirrors lead-card-note */}
      {task.notes && <div className="lead-card-note">{task.notes}</div>}

      {/* footer — mirrors lead-card-footer */}
      <div className="lead-card-footer">
        {task.due_date ? (
          <span
            className="lead-card-date"
            style={overdue ? { color: '#FF4444', fontWeight: 600 } : {}}
          >
            <CalendarDays size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '3px' }} />
            {fmtDue(task.due_date)}{overdue ? ' · overdue' : ''}
          </span>
        ) : (
          <span />
        )}

        {confirming ? (
          <div className="lead-card-confirm">
            <span className="lead-card-confirm-text">Delete?</span>
            <button className="btn btn-danger btn-sm" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={handleDelete}>Yes</button>
            <button className="btn btn-ghost btn-sm"  style={{ fontSize: '11px', padding: '4px 10px' }} onClick={() => setConfirming(false)}>No</button>
          </div>
        ) : (
          <div className="flex-center gap-1">
            <button className="btn btn-primary btn-sm lead-btn-convert" onClick={handleDone} title="Mark as done">
              <Check size={12} /> Done
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onEdit(task)} title="Edit task">
              <Edit2 size={12} />
            </button>
            <button className="btn btn-ghost btn-sm lead-btn-dismiss" onClick={() => setConfirming(true)} title="Delete task">
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── compact done row inside the collapsible completed sub-section ── */
function DoneRow({ task, onToggle, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="standalone-task-row" style={{ opacity: 0.55 }}>
      <button
        className="standalone-task-check done"
        onClick={() => onToggle(task.id)}
        title="Mark pending"
      >
        <Check size={12} strokeWidth={3} />
      </button>
      <div className="standalone-task-body">
        <span className="standalone-task-title" style={{ textDecoration: 'line-through', color: '#666' }}>
          {task.title}
        </span>
      </div>
      <div className="standalone-task-actions" style={{ opacity: 1 }}>
        {confirming ? (
          <>
            <span style={{ fontSize: '12px', color: '#888' }}>Del?</span>
            <button className="btn btn-danger btn-sm" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => onDelete(task.id)}>Yes</button>
            <button className="btn btn-ghost btn-sm"  style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => setConfirming(false)}>No</button>
          </>
        ) : (
          <button
            className="btn btn-ghost btn-sm standalone-action-btn"
            onClick={() => setConfirming(true)}
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── main view ── */
export default function TasksView() {
  const [tasks, setTasks]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [newTitle, setNewTitle]       = useState('');
  const [newDue, setNewDue]           = useState('');
  const [newPriority, setNewPriority] = useState('normal');
  const [adding, setAdding]           = useState(false);
  const [sectionOpen, setSectionOpen] = useState(true);
  const [doneOpen, setDoneOpen]       = useState(false);
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
    <div className="leads-section">
      {/* ── collapsible section header ── */}
      <div className="leads-section-header" onClick={() => setSectionOpen(o => !o)}>
        <div className="flex-center gap-2">
          <span className="leads-section-label">TASKS</span>
          {pending.length > 0 && <span className="leads-count-badge">{pending.length}</span>}
        </div>
        {sectionOpen ? <ChevronUp size={14} color="#888" /> : <ChevronDown size={14} color="#888" />}
      </div>

      {sectionOpen && (
        <div>
          {/* ── quick-add row ── */}
          <div className="standalone-add-row" style={{ paddingTop: '14px' }}>
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

          {/* ── pending task cards in horizontal scroll row ── */}
          {pending.length === 0 ? (
            <div className="leads-empty">No pending tasks — add one above</div>
          ) : (
            <div className="leads-scroll-row">
              {pending.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEdit={setEditingTask}
                />
              ))}
            </div>
          )}

          {/* ── completed sub-section (collapsible, de-emphasized) ── */}
          {done.length > 0 && (
            <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-subtle)', paddingTop: '4px' }}>
              <button
                className="standalone-done-header"
                onClick={e => { e.stopPropagation(); setDoneOpen(o => !o); }}
              >
                <span className="standalone-done-label">
                  Completed
                  <span className="standalone-done-count">{done.length}</span>
                </span>
                {doneOpen ? <ChevronUp size={14} color="#888" /> : <ChevronDown size={14} color="#888" />}
              </button>
              {doneOpen && done.map(task => (
                <DoneRow
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
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
