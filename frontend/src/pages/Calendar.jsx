import React, { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Trash2, Edit2 } from 'lucide-react';
import { api } from '../api';

const EVENT_TYPE_COLORS = {
  shoot: '#723CEB',
  meeting: '#3B82F6',
  deadline: '#FF4444',
  other: '#888888',
};

const PRESET_COLORS = ['#723CEB', '#FF902F', '#4CAF50', '#FF4444', '#3B82F6', '#888888'];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function dateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fmtShortDate(d) {
  if (!d) return '';
  const date = new Date(d + 'T00:00:00');
  if (isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

export default function Calendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [events, setEvents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [addModal, setAddModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [editModal, setEditModal] = useState(null);

  const loadEvents = useCallback(() => {
    const key = getMonthKey(year, month);
    api.get(`/calendar?month=${key}`).then(setEvents).catch(() => {});
  }, [year, month]);

  useEffect(() => {
    loadEvents();
    api.get('/projects').then(setProjects).catch(() => {});
  }, [loadEvents]);

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function goToday() {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDOW = getFirstDayOfWeek(year, month);
  const prevDays = getDaysInMonth(year, month === 0 ? 11 : month - 1);
  const today = new Date();

  const eventsByDate = {};
  events.forEach(ev => {
    const start = new Date(ev.start_date + 'T00:00:00');
    const end = ev.end_date ? new Date(ev.end_date + 'T00:00:00') : start;
    const cur = new Date(start);
    while (cur <= end) {
      // Use local date components to avoid UTC offset shifting the date
      const k = dateStr(cur.getFullYear(), cur.getMonth(), cur.getDate());
      if (!eventsByDate[k]) eventsByDate[k] = [];
      if (!eventsByDate[k].find(e => e.id === ev.id)) eventsByDate[k].push(ev);
      cur.setDate(cur.getDate() + 1);
    }
  });

  const totalCells = Math.ceil((firstDOW + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDOW + 1;
    let cellYear = year, cellMonth = month, cellDay;
    let isCurrentMonth = true;
    if (i < firstDOW) {
      isCurrentMonth = false;
      cellDay = prevDays - firstDOW + i + 1;
      cellMonth = month === 0 ? 11 : month - 1;
      cellYear = month === 0 ? year - 1 : year;
    } else if (dayNum > daysInMonth) {
      isCurrentMonth = false;
      cellDay = dayNum - daysInMonth;
      cellMonth = month === 11 ? 0 : month + 1;
      cellYear = month === 11 ? year + 1 : year;
    } else {
      cellDay = dayNum;
    }
    const ds = dateStr(cellYear, cellMonth, cellDay);
    const isToday = isSameDay(new Date(cellYear, cellMonth, cellDay), today);
    const cellEvents = eventsByDate[ds] || [];
    cells.push({ ds, cellDay, isCurrentMonth, isToday, events: cellEvents });
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '20px' }}>
        <div>
          <div className="page-title">Calendar</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setAddModal({ date: dateStr(year, month, today.getDate()) })}>
            <Plus size={14} /> Add Event
          </button>
        </div>
      </div>

      {/* Month Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button className="btn btn-ghost btn-sm" style={{ padding: '6px 8px' }} onClick={prevMonth}>
          <ChevronLeft size={16} />
        </button>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', minWidth: '160px', textAlign: 'center' }}>
          {MONTH_NAMES[month]} {year}
        </h2>
        <button className="btn btn-ghost btn-sm" style={{ padding: '6px 8px' }} onClick={nextMonth}>
          <ChevronRight size={16} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={goToday} style={{ marginLeft: '4px', borderRadius: '50px', padding: '5px 14px', fontSize: '12px' }}>
          Today
        </button>
      </div>

      {/* Day headers + Grid — scrollable on mobile */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: '380px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: '10px', fontWeight: 700, color: '#888', textTransform: 'uppercase', padding: '4px 0' }}>
                {d}
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
            {cells.map((cell, idx) => (
              <DayCell
                key={idx}
                cell={cell}
                onClickEmpty={() => setAddModal({ date: cell.ds })}
                onClickEvent={ev => setDetailModal(ev)}
              />
            ))}
          </div>
        </div>
      </div>

      <footer style={{ marginTop: '32px', textAlign: 'center', fontSize: '11px', color: '#444' }}>built by year28</footer>

      {addModal && (
        <EventModal
          mode="add"
          initialDate={addModal.date}
          projects={projects}
          onClose={() => setAddModal(null)}
          onSaved={() => { setAddModal(null); loadEvents(); }}
        />
      )}
      {detailModal && !editModal && (
        <EventDetailModal
          event={detailModal}
          onClose={() => setDetailModal(null)}
          onEdit={() => { setEditModal(detailModal); setDetailModal(null); }}
          onDelete={async () => {
            await api.del(`/calendar/${detailModal.id}`);
            setDetailModal(null);
            loadEvents();
          }}
        />
      )}
      {editModal && (
        <EventModal
          mode="edit"
          event={editModal}
          projects={projects}
          onClose={() => setEditModal(null)}
          onSaved={() => { setEditModal(null); loadEvents(); }}
        />
      )}
    </div>
  );
}

function DayCell({ cell, onClickEmpty, onClickEvent }) {
  const { cellDay, isCurrentMonth, isToday, events, ds } = cell;
  const MAX_VISIBLE = 3;
  const visible = events.slice(0, MAX_VISIBLE);
  const overflow = events.length - MAX_VISIBLE;

  return (
    <div
      onClick={() => onClickEmpty()}
      style={{
        background: '#1e1e1e',
        border: isToday ? '1px solid #723CEB' : '1px solid rgba(255,255,255,0.06)',
        borderRadius: '8px',
        minHeight: '90px',
        padding: '6px',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <div style={{ fontSize: '13px', color: isCurrentMonth ? '#fff' : '#555', fontWeight: isToday ? 700 : 400, marginBottom: '4px' }}>
        {cellDay}
      </div>
      {visible.map(ev => (
        <div
          key={ev.id}
          onClick={e => { e.stopPropagation(); onClickEvent(ev); }}
          style={{
            background: ev.color || '#723CEB',
            borderRadius: '4px',
            padding: '1px 5px',
            fontSize: '11px',
            color: '#fff',
            marginBottom: '2px',
            cursor: 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}
        >
          {ev.start_time ? `${ev.start_time.slice(0, 5)} ` : ''}{ev.title}
        </div>
      ))}
      {overflow > 0 && (
        <div style={{ fontSize: '10px', color: '#888', marginTop: '1px' }}>+{overflow} more</div>
      )}
    </div>
  );
}

function EventDetailModal({ event, onClose, onEdit, onDelete }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm('Delete this event?')) return;
    setDeleting(true);
    await onDelete();
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: event.color || '#723CEB', flexShrink: 0 }} />
            <span className="modal-title">{event.title}</span>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: '0 0 16px' }}>
          <div className="fin-row" style={{ padding: '8px 0' }}>
            <span className="text-2">Type</span>
            <span style={{ textTransform: 'capitalize' }}>{event.event_type}</span>
          </div>
          <div className="fin-row" style={{ padding: '8px 0' }}>
            <span className="text-2">Date</span>
            <span>
              {fmtShortDate(event.start_date)}
              {event.end_date && event.end_date !== event.start_date ? ` → ${fmtShortDate(event.end_date)}` : ''}
            </span>
          </div>
          {(event.start_time || event.end_time) && (
            <div className="fin-row" style={{ padding: '8px 0' }}>
              <span className="text-2">Time</span>
              <span>{event.start_time || ''}{event.end_time ? ` – ${event.end_time}` : ''}</span>
            </div>
          )}
          {event.location && (
            <div className="fin-row" style={{ padding: '8px 0' }}>
              <span className="text-2">Location</span>
              <span>{event.location}</span>
            </div>
          )}
          {event.project_title && (
            <div className="fin-row" style={{ padding: '8px 0' }}>
              <span className="text-2">Project</span>
              <span>{event.project_title}</span>
            </div>
          )}
          {event.notes && (
            <div style={{ marginTop: '12px', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', fontSize: '13px', color: '#aaa' }}>
              {event.notes}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
            <Trash2 size={13} /> {deleting ? 'Deleting...' : 'Delete'}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={onEdit}><Edit2 size={13} /> Edit</button>
        </div>
      </div>
    </div>
  );
}

function EventModal({ mode, event, initialDate, projects, onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const [form, setForm] = useState({
    title: event?.title || '',
    project_id: event?.project_id || '',
    event_type: event?.event_type || 'shoot',
    start_date: event?.start_date || initialDate || '',
    end_date: event?.end_date || '',
    start_time: event?.start_time || '',
    end_time: event?.end_time || '',
    location: event?.location || '',
    notes: event?.notes || '',
    color: event?.color || EVENT_TYPE_COLORS['shoot'],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function f(k, v) {
    setForm(p => {
      const next = { ...p, [k]: v };
      if (k === 'event_type') next.color = EVENT_TYPE_COLORS[v] || '#888888';
      if (k === 'project_id' && v) {
        const proj = projects.find(pr => String(pr.id) === String(v));
        if (proj) {
          if (!next.title) next.title = proj.title;
          if (proj.shoot_date && !next.start_date) next.start_date = proj.shoot_date;
          if (proj.shoot_location && !next.location) next.location = proj.shoot_location;
        }
      }
      return next;
    });
  }

  async function save() {
    if (!form.title.trim() || !form.start_date) { setErr('Title and start date are required'); return; }
    setSaving(true);
    setErr('');
    try {
      const payload = {
        ...form,
        project_id: form.project_id || null,
        end_date: form.end_date || null,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        location: form.location || null,
        notes: form.notes || null,
      };
      if (isEdit) await api.put(`/calendar/${event.id}`, payload);
      else await api.post('/calendar', payload);
      onSaved();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: '520px' }}>
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Event' : 'Add Event'}</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="form-row">
          <label className="form-label">Title *</label>
          <input className="input" value={form.title} onChange={e => f('title', e.target.value)} placeholder="Event title" autoFocus />
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label className="form-label">Link to Project</label>
            <select className="select" value={form.project_id} onChange={e => f('project_id', e.target.value)}>
              <option value="">No project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">Event Type</label>
            <select className="select" value={form.event_type} onChange={e => f('event_type', e.target.value)}>
              <option value="shoot">Shoot</option>
              <option value="meeting">Meeting</option>
              <option value="deadline">Deadline</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label className="form-label">Start Date *</label>
            <input type="date" className="input" value={form.start_date} onChange={e => f('start_date', e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label">End Date</label>
            <input type="date" className="input" value={form.end_date} onChange={e => f('end_date', e.target.value)} />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label className="form-label">Start Time</label>
            <input type="time" className="input" value={form.start_time} onChange={e => f('start_time', e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label">End Time</label>
            <input type="time" className="input" value={form.end_time} onChange={e => f('end_time', e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <label className="form-label">Location</label>
          <input className="input" value={form.location} onChange={e => f('location', e.target.value)} placeholder="Location" />
        </div>

        <div className="form-row">
          <label className="form-label">Color</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingTop: '4px' }}>
            {PRESET_COLORS.map(c => (
              <div
                key={c}
                onClick={() => f('color', c)}
                style={{
                  width: '26px', height: '26px', borderRadius: '50%',
                  background: c, cursor: 'pointer',
                  border: form.color === c ? '3px solid #fff' : '3px solid transparent',
                  boxSizing: 'border-box',
                  transition: 'border 0.15s',
                }}
              />
            ))}
          </div>
        </div>

        <div className="form-row">
          <label className="form-label">Notes</label>
          <textarea className="input" rows={3} value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Notes..." />
        </div>

        {err && <div className="error-msg">{err}</div>}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Event'}
          </button>
        </div>
      </div>
    </div>
  );
}
