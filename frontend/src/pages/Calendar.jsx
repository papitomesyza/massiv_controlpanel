import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Edit2,
  CalendarDays, CalendarRange, Camera, Flag, Check, Users, Circle,
  CheckCircle2, ListTodo, FolderOpen, Lock,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DndContext, useDraggable, useDroppable, PointerSensor, TouchSensor, useSensors, useSensor, pointerWithin } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api';
import { GROUP_TINT, categoryVisual } from '../lib/categoryIcons';
import Overlay from '../components/Overlay';
import ConfirmDialog from '../components/ConfirmDialog';
import DateField from '../components/DateField';

// One visual per event type. Colour is derived from the type at render, never
// stored: each type takes one hue from the shared categorical palette in
// index.css, and one lucide glyph, so the month reads at a glance without a
// single type word being printed. The four coloured types are spread across the
// wheel so no two read as one colour at chip size: shoot amber, deadline blue,
// task green, meeting rose. Shoot and deadline, the two most important types,
// sit near opposite each other (amber vs blue) so they are unmistakable even
// from across the room. Shoot keeps the amber the Projects next-shoot ring
// uses, so a shoot reads the same colour wherever it appears. A task and a
// standalone task are both work items, so they share the task visual.
const EVENT_TYPE_VISUAL = {
  shoot:           { Icon: Camera, hue: 'var(--cat-2)',          label: 'Shoot' },
  deadline:        { Icon: Flag,   hue: 'var(--cat-1)',          label: 'Deadline' },
  task:            { Icon: Check,  hue: 'var(--cat-6)',          label: 'Task' },
  standalone_task: { Icon: Check,  hue: 'var(--cat-6)',          label: 'Task' },
  meeting:         { Icon: Users,  hue: 'var(--cat-5)',          label: 'Meeting' },
  other:           { Icon: Circle, hue: 'var(--color-mid-gray)', label: 'Other' },
};
function eventVisual(type) {
  return EVENT_TYPE_VISUAL[type] || EVENT_TYPE_VISUAL.other;
}

// A synced event mirrors a date held on its source: a project's shoot date or
// deadline, or a task's due date. Every change goes through that source on the
// server (see lib/calendarSync), so here the event type and project are locked
// and only the fields the source can hold stay editable.
const SYNC_EDITABLE = {
  shoot:           ['start_date', 'start_time', 'end_time'],
  deadline:        ['start_date'],
  task:            ['start_date'],
  standalone_task: ['start_date'],
};
function isSynced(ev) {
  if (!ev) return false;
  if (ev.event_type === 'shoot' || ev.event_type === 'deadline') return !!ev.project_id;
  if (ev.event_type === 'task') return !!ev.task_id;
  if (ev.event_type === 'standalone_task') return !!ev.standalone_task_id;
  return false;
}
// What deleting a synced event changes, named for the confirm dialog.
function syncedDeleteCopy(ev) {
  const project = ev.project_title || 'this project';
  if (ev.event_type === 'shoot') return { title: `Clear the shoot date of ${project}?`, message: `${project} will have no shoot date and this event is removed.` };
  if (ev.event_type === 'deadline') return { title: `Clear the deadline of ${project}?`, message: `${project} will have no deadline and this event is removed.` };
  return { title: `Clear the due date of ${ev.title}?`, message: 'The task stays, without a due date, and this event is removed.' };
}
// The five toggles in the type filter. standalone_task folds into task, so one
// task toggle governs both.
const FILTER_TYPES = ['shoot', 'deadline', 'task', 'meeting', 'other'];
function filterKey(type) {
  return type === 'standalone_task' ? 'task' : (EVENT_TYPE_VISUAL[type] ? type : 'other');
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const NEXT_SHOOT_WINDOW = 30; // days: the ring is full at the shoot, empty a month out

const VIEW_KEY = 'massiv_calendar_view';
const HIDDEN_KEY = 'massiv_calendar_hidden_types';

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

function dateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fmtDS(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDS(ds) {
  return new Date(ds + 'T00:00:00');
}

function addDaysStr(ds, days) {
  const d = parseDS(ds);
  d.setDate(d.getDate() + days);
  return fmtDS(d);
}

function getGridRange(year, month) {
  const dim = getDaysInMonth(year, month);
  const firstDOW = getFirstDayOfWeek(year, month);
  const totalCells = Math.ceil((firstDOW + dim) / 7) * 7;
  const firstDate = addDaysStr(dateStr(year, month, 1), -firstDOW);
  const lastDate = addDaysStr(firstDate, totalCells - 1);
  return { firstDate, lastDate };
}

// Monday of the week containing the given date string.
function getWeekStart(ds) {
  const d = parseDS(ds);
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - dow);
  return fmtDS(d);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtShortDate(d) {
  if (!d) return '';
  const date = parseDS(d);
  if (isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

// A small ring that fills as its date approaches, matching the next-shoot ring on
// the Projects and Estimates strips. The ring carries urgency, the numeral inside
// carries the day count; an empty ring shows a neutral dash.
function ProximityRing({ frac, color, days }) {
  const size = 46, R = 19, C = 2 * Math.PI * R;
  const cx = size / 2, cy = size / 2;
  const empty = days == null;
  const f = empty ? 0 : Math.max(0, Math.min(1, frac || 0));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="win-ring">
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--color-hairline)" strokeWidth="4" />
      {!empty && (
        <circle
          cx={cx} cy={cy} r={R} fill="none" stroke={color} strokeWidth="4"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - f)}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      {empty ? (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="win-ring-dash">-</text>
      ) : days === 0 ? (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="win-ring-today">Today</text>
      ) : (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="win-ring-num">
          {days}<tspan dx="1" className="win-ring-suffix">d</tspan>
        </text>
      )}
    </svg>
  );
}

// Opens the page with three figures, matching the Estimates and Projects strips.
function StatStrip({ monthEvents, allEvents }) {
  const stat = useMemo(() => {
    // Distinct days in the month carrying a shoot.
    const shootDays = new Set();
    let deadlines = 0;
    monthEvents.forEach(({ ds, ev }) => {
      if (ev.event_type === 'shoot') shootDays.add(ds);
      if (ev.event_type === 'deadline') deadlines++;
    });

    // Next upcoming shoot across all loaded events.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let nextShoot = null;
    allEvents.forEach(ev => {
      if (ev.event_type !== 'shoot') return;
      const d = parseDS(ev.start_date);
      if (isNaN(d.getTime()) || d < today) return;
      if (!nextShoot || d < nextShoot) nextShoot = d;
    });
    let untilShoot = null, shootFrac = 0;
    if (nextShoot) {
      untilShoot = Math.round((nextShoot - today) / 86400000);
      shootFrac = Math.max(0, Math.min(1, 1 - untilShoot / NEXT_SHOOT_WINDOW));
    }
    return { shootDays: shootDays.size, deadlines, untilShoot, shootFrac, nextShoot };
  }, [monthEvents, allEvents]);

  const shootTip = stat.nextShoot
    ? `Next shoot ${fmtShortDate(fmtDS(stat.nextShoot))}${stat.untilShoot === 0 ? ' (today)' : ` (in ${stat.untilShoot}d)`}`
    : 'No upcoming shoot';

  return (
    <div className="est-pipeline cal-stat-strip">
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Shoot days this month</div>
        <div className="est-pipe-value">{stat.shootDays}</div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Deadlines this month</div>
        <div className="est-pipe-value">{stat.deadlines}</div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Days until next shoot</div>
        <div className="est-pipe-ring" title={shootTip}>
          <ProximityRing frac={stat.shootFrac} color="var(--cat-2)" days={stat.nextShoot ? stat.untilShoot : null} />
        </div>
      </div>
    </div>
  );
}

// True below the mobile breakpoint, kept in sync with a matchMedia listener so
// the grid switches to the density layout without a reload.
function useIsMobile() {
  const query = '(max-width: 768px)';
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = e => setMobile(e.matches);
    mq.addEventListener('change', on);
    setMobile(mq.matches);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

export default function Calendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [weekStart, setWeekStart] = useState(() => getWeekStart(fmtDS(now)));
  const [view, setView] = useState(() => (localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month'));
  const [hiddenTypes, setHiddenTypes] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
      return new Set(Array.isArray(raw) ? raw : []);
    } catch (_) { return new Set(); }
  });

  const [events, setEvents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [addModal, setAddModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [dayDrawer, setDayDrawer] = useState(null);
  const [dragError, setDragError] = useState('');
  const [highlightDate, setHighlightDate] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);

  const isMobile = useIsMobile();
  const cellRefs = useRef({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // The month the stat strip and the "this month" figures describe. In week view
  // it is the month containing the visible week's Monday.
  const statMonth = view === 'week'
    ? { year: parseDS(weekStart).getFullYear(), month: parseDS(weekStart).getMonth() }
    : { year, month };

  // Fetch one range that covers the visible grid, the stat month and the agenda's
  // next seven days, then derive every view from it. Events are few, so a single
  // fetch keeps all views consistent.
  const loadEvents = useCallback(() => {
    const grid = view === 'week'
      ? { firstDate: weekStart, lastDate: addDaysStr(weekStart, 6) }
      : getGridRange(year, month);
    const monthRange = getGridRange(statMonth.year, statMonth.month);
    const todayDS = fmtDS(new Date());
    const agendaEnd = addDaysStr(todayDS, 6);
    const starts = [grid.firstDate, monthRange.firstDate, todayDS];
    const ends = [grid.lastDate, monthRange.lastDate, agendaEnd];
    const start = starts.reduce((a, b) => (a < b ? a : b));
    const end = ends.reduce((a, b) => (a > b ? a : b));
    api.get(`/calendar?start=${start}&end=${end}`).then(setEvents).catch(() => {});
  }, [view, year, month, weekStart, statMonth.year, statMonth.month]);

  useEffect(() => {
    loadEvents();
    api.get('/projects').then(setProjects).catch(() => {});
  }, [loadEvents]);

  // The mobile day panel defaults to today when today is in the displayed month
  // or week, otherwise to the first visible day. Navigating months resets it;
  // tapping a day overrides it until the next navigation. Scrolling never
  // touches these deps, so the selection persists while the user scrolls.
  useEffect(() => {
    if (view === 'week') {
      const todayDS = fmtDS(new Date());
      const inWeek = todayDS >= weekStart && todayDS <= addDaysStr(weekStart, 6);
      setSelectedDay(inWeek ? todayDS : weekStart);
    } else {
      const t = new Date();
      if (t.getFullYear() === year && t.getMonth() === month) setSelectedDay(fmtDS(t));
      else setSelectedDay(dateStr(year, month, 1));
    }
  }, [view, year, month, weekStart]);

  // project_id -> category group name, for the chip's project-identity left edge.
  const projectGroupById = useMemo(() => {
    const m = {};
    projects.forEach(p => { m[p.id] = p.group_name || null; });
    return m;
  }, [projects]);

  function edgeTintFor(ev) {
    if (!ev.project_id) return null;
    const group = projectGroupById[ev.project_id];
    if (!group) return null;
    return categoryVisual(null, group).tint;
  }

  function switchView(v) {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
    if (v === 'week') setWeekStart(getWeekStart(fmtDS(new Date(year, month, 1) > new Date() ? new Date(year, month, 1) : new Date())));
  }

  function toggleType(t) {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch (_) {}
      return next;
    });
  }

  function prev() {
    if (view === 'week') { setWeekStart(addDaysStr(weekStart, -7)); return; }
    if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1);
  }
  function next() {
    if (view === 'week') { setWeekStart(addDaysStr(weekStart, 7)); return; }
    if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1);
  }
  function goToday() {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth());
    setWeekStart(getWeekStart(fmtDS(t)));
  }

  function handleDragEnd({ active, over }) {
    if (!over) return;
    const eventId = active.id;
    const newDate = String(over.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
    const ev = events.find(e => e.id === eventId);
    if (!ev || ev.start_date === newDate) return;
    const dayDiff = Math.round((parseDS(newDate) - parseDS(ev.start_date)) / 86400000);
    const newEndDate = ev.end_date ? addDaysStr(ev.end_date, dayDiff) : null;
    const prevEvents = [...events];
    setEvents(evs => evs.map(e => e.id === eventId ? { ...e, start_date: newDate, end_date: newEndDate } : e));
    setDragError('');
    api.put(`/calendar/${eventId}/move`, { start_date: newDate })
      .then(() => loadEvents())
      .catch(() => {
        setEvents(prevEvents);
        setDragError('Failed to move event. Please try again.');
      });
  }

  // Events grouped by date (start..end span), filtered by the type toggles.
  const eventsByDate = useMemo(() => {
    const byDate = {};
    events.forEach(ev => {
      if (hiddenTypes.has(filterKey(ev.event_type))) return;
      const start = parseDS(ev.start_date);
      const end = ev.end_date ? parseDS(ev.end_date) : start;
      const cur = new Date(start);
      while (cur <= end) {
        const k = fmtDS(cur);
        if (!byDate[k]) byDate[k] = [];
        if (!byDate[k].find(e => e.id === ev.id)) byDate[k].push(ev);
        cur.setDate(cur.getDate() + 1);
      }
    });
    // Timed events first (by time), then untimed, so a day reads top to bottom.
    Object.values(byDate).forEach(list => list.sort((a, b) => {
      const ta = a.start_time || '99:99', tb = b.start_time || '99:99';
      return ta.localeCompare(tb);
    }));
    return byDate;
  }, [events, hiddenTypes]);

  // Unfiltered events in the stat month, for the figures (facts, not the filter).
  const monthEvents = useMemo(() => {
    const out = [];
    const first = dateStr(statMonth.year, statMonth.month, 1);
    const last = dateStr(statMonth.year, statMonth.month, getDaysInMonth(statMonth.year, statMonth.month));
    events.forEach(ev => {
      const start = parseDS(ev.start_date);
      const end = ev.end_date ? parseDS(ev.end_date) : start;
      const cur = new Date(start);
      while (cur <= end) {
        const k = fmtDS(cur);
        if (k >= first && k <= last) out.push({ ds: k, ev });
        cur.setDate(cur.getDate() + 1);
      }
    });
    return out;
  }, [events, statMonth.year, statMonth.month]);

  const today = new Date();

  // Month cells, chunked into weeks so an event-free week can shrink.
  const monthCells = useMemo(() => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDOW = getFirstDayOfWeek(year, month);
    const totalCells = Math.ceil((firstDOW + daysInMonth) / 7) * 7;
    const cells = [];
    const firstDate = addDaysStr(dateStr(year, month, 1), -firstDOW);
    for (let i = 0; i < totalCells; i++) {
      const ds = addDaysStr(firstDate, i);
      const d = parseDS(ds);
      cells.push({
        ds,
        cellDay: d.getDate(),
        isCurrentMonth: d.getMonth() === month,
        isToday: isSameDay(d, today),
        events: eventsByDate[ds] || [],
      });
    }
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      const wk = cells.slice(i, i + 7);
      weeks.push({ cells: wk, hasEvents: wk.some(c => c.events.length > 0) });
    }
    return weeks;
  }, [year, month, eventsByDate]);

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i)), [weekStart]);

  // Agenda: the next seven days from today, empty days kept.
  const agenda = useMemo(() => {
    const todayDS = fmtDS(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const ds = addDaysStr(todayDS, i);
      return { ds, events: eventsByDate[ds] || [] };
    });
  }, [eventsByDate]);

  // The whole seven day window empty reads as broken when shown as seven dashes,
  // so it collapses to a single quiet state instead.
  const agendaEmpty = agenda.every(d => d.events.length === 0);

  // Scroll the grid to a highlighted day and clear the highlight shortly after.
  useEffect(() => {
    if (!highlightDate) return;
    const el = cellRefs.current[highlightDate];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const t = setTimeout(() => setHighlightDate(null), 1800);
    return () => clearTimeout(t);
  }, [highlightDate]);

  function goToDay(ds) {
    const d = parseDS(ds);
    if (view === 'week') {
      setWeekStart(getWeekStart(ds));
    } else {
      setYear(d.getFullYear());
      setMonth(d.getMonth());
    }
    setHighlightDate(ds);
    setSelectedDay(ds); // keep the mobile day panel in step with the agenda
  }

  const navLabel = view === 'week'
    ? `${parseDS(weekStart).getDate()} ${MONTH_SHORT[parseDS(weekStart).getMonth()]} - ${parseDS(weekDates[6]).getDate()} ${MONTH_SHORT[parseDS(weekDates[6]).getMonth()]} ${parseDS(weekDates[6]).getFullYear()}`
    : `${MONTH_NAMES[month]} ${year}`;

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '20px' }}>
        <div className="page-title">Calendar</div>
        <div className="flex-center gap-2">
          <div className="view-toggle">
            <button className={`view-toggle-btn${view === 'month' ? ' active' : ''}`} onClick={() => switchView('month')} title="Month view"><CalendarDays size={15} /></button>
            <button className={`view-toggle-btn${view === 'week' ? ' active' : ''}`} onClick={() => switchView('week')} title="Week view"><CalendarRange size={15} /></button>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setAddModal({ date: fmtDS(new Date()) })}>
            <Plus size={14} /> Add Event
          </button>
        </div>
      </div>

      <StatStrip monthEvents={monthEvents} allEvents={events} />

      {/* Type filter: one icon toggle per type. Bright means shown, dimmed hidden. */}
      <div className="cal-type-filters" role="group" aria-label="Filter event types">
        {FILTER_TYPES.map(t => {
          const { Icon, hue, label } = eventVisual(t);
          const shown = !hiddenTypes.has(t);
          return (
            <button
              key={t}
              className={`est-filter-dot cal-type-dot${shown ? ' active' : ''}`}
              style={{ '--tint': hue }}
              title={shown ? `${label} (shown)` : `${label} (hidden)`}
              aria-pressed={shown}
              aria-label={label}
              onClick={() => toggleType(t)}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <button className="btn btn-ghost btn-sm" style={{ padding: '6px 8px' }} onClick={prev}><ChevronLeft size={16} /></button>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-ink)', minWidth: '190px', textAlign: 'center' }}>{navLabel}</h2>
        <button className="btn btn-ghost btn-sm" style={{ padding: '6px 8px' }} onClick={next}><ChevronRight size={16} /></button>
        <button className="btn btn-ghost btn-sm" onClick={goToday} style={{ marginLeft: '4px', borderRadius: '18px', padding: '5px 14px', fontSize: '12px' }}>Today</button>
      </div>

      {dragError && (
        <div style={{ padding: '8px 12px', background: 'var(--ember-soft)', border: '1px solid var(--color-ember)', borderRadius: '6px', color: 'var(--color-ember-text)', fontSize: '12px', marginBottom: '12px' }}>
          {dragError}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
        <div className="cal-layout">
          <div className="cal-main">
            {view === 'month' ? (
              isMobile ? (
                // Mobile month: a density grid. Each cell carries only the date
                // and a row of type coloured dots, and no chip text truncates.
                // Tapping a day reveals its full events in the panel beneath.
                <>
                  <div className="calendar-grid-outer">
                    <div className="calendar-day-headers">
                      {DAYS.map(d => <div key={d} className="calendar-day-label">{d}</div>)}
                    </div>
                    <div className="cal-mgrid">
                      {monthCells.flatMap(wk => wk.cells).map(cell => (
                        <MobileDensityCell
                          key={cell.ds}
                          ds={cell.ds}
                          cellDay={cell.cellDay}
                          isCurrentMonth={cell.isCurrentMonth}
                          isToday={cell.isToday}
                          isSelected={cell.ds === selectedDay}
                          events={cell.events}
                          onSelect={setSelectedDay}
                        />
                      ))}
                    </div>
                  </div>
                  <DayEventsPanel ds={selectedDay} events={eventsByDate[selectedDay] || []} onClickEvent={ev => setDetailModal(ev)} />
                </>
              ) : (
                <div className="calendar-grid-outer">
                  <div className="calendar-day-headers">
                    {DAYS.map(d => <div key={d} className="calendar-day-label">{d}</div>)}
                  </div>
                  <div className="calendar-day-grid">
                    {monthCells.map((wk, wi) =>
                      wk.cells.map((cell, ci) => (
                        <DroppableDayCell
                          key={`${wi}-${ci}`}
                          cell={cell}
                          compact={!wk.hasEvents}
                          highlight={cell.ds === highlightDate}
                          edgeTintFor={edgeTintFor}
                          registerRef={el => { cellRefs.current[cell.ds] = el; }}
                          onClickEmpty={() => setAddModal({ date: cell.ds })}
                          onClickEvent={ev => setDetailModal(ev)}
                          onOverflow={() => setDayDrawer({ ds: cell.ds, events: cell.events })}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            ) : (
              isMobile ? (
                // Mobile week: the same density principle across seven days.
                <>
                  <div className="cal-mweek">
                    {weekDates.map(ds => {
                      const d = parseDS(ds);
                      return (
                        <MobileDensityCell
                          key={ds}
                          ds={ds}
                          dow={DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}
                          cellDay={d.getDate()}
                          isCurrentMonth
                          isToday={isSameDay(d, today)}
                          isSelected={ds === selectedDay}
                          events={eventsByDate[ds] || []}
                          onSelect={setSelectedDay}
                        />
                      );
                    })}
                  </div>
                  <DayEventsPanel ds={selectedDay} events={eventsByDate[selectedDay] || []} onClickEvent={ev => setDetailModal(ev)} />
                </>
              ) : (
                <div className="cal-week">
                  {weekDates.map(ds => {
                    const d = parseDS(ds);
                    return (
                      <WeekDayColumn
                        key={ds}
                        ds={ds}
                        isToday={isSameDay(d, today)}
                        highlight={ds === highlightDate}
                        events={eventsByDate[ds] || []}
                        edgeTintFor={edgeTintFor}
                        registerRef={el => { cellRefs.current[ds] = el; }}
                        onClickEmpty={() => setAddModal({ date: ds })}
                        onClickEvent={ev => setDetailModal(ev)}
                      />
                    );
                  })}
                </div>
              )
            )}
          </div>

          {/* Agenda: next seven days, empty days kept so the week's rhythm shows. */}
          <div className="cal-agenda">
            <div className="cal-agenda-title">Next 7 days</div>
            {agendaEmpty ? (
              <div className="cal-agenda-empty">
                <CalendarDays size={18} />
                <span>Nothing scheduled</span>
              </div>
            ) : agenda.map(({ ds, events: dayEvents }) => {
              const d = parseDS(ds);
              const isToday = isSameDay(d, today);
              return (
                <button
                  key={ds}
                  className={`cal-agenda-day${dayEvents.length === 0 ? ' is-empty' : ''}${isToday ? ' is-today' : ''}`}
                  onClick={() => goToDay(ds)}
                  title="Show in grid"
                >
                  <div className="cal-agenda-date">
                    <span className="cal-agenda-dow">{DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}</span>
                    <span className="cal-agenda-num">{d.getDate()}</span>
                  </div>
                  <div className="cal-agenda-events">
                    {dayEvents.length === 0
                      ? <span className="cal-agenda-none">-</span>
                      : dayEvents.map(ev => {
                          const { Icon, hue } = eventVisual(ev.event_type);
                          return (
                            <span key={ev.id} className="cal-agenda-line" style={{ color: hue }}>
                              <Icon size={12} />
                              <span className="cal-agenda-line-title">
                                {ev.start_time ? `${ev.start_time.slice(0, 5)} ` : ''}{ev.title}
                              </span>
                            </span>
                          );
                        })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </DndContext>

      {addModal && (
        <EventModal mode="add" initialDate={addModal.date} projects={projects}
          onClose={() => setAddModal(null)} onSaved={() => { setAddModal(null); loadEvents(); }} />
      )}
      {detailModal && !editModal && (
        <EventDetailModal event={detailModal}
          onClose={() => setDetailModal(null)}
          onEdit={() => { setEditModal(detailModal); setDetailModal(null); }}
          onChanged={() => { setDetailModal(null); loadEvents(); }} />
      )}
      {editModal && (
        <EventModal mode="edit" event={editModal} projects={projects}
          onClose={() => setEditModal(null)} onSaved={() => { setEditModal(null); loadEvents(); }} />
      )}
      {dayDrawer && (
        <DayDrawer ds={dayDrawer.ds} events={dayDrawer.events} edgeTintFor={edgeTintFor}
          onClose={() => setDayDrawer(null)}
          onClickEvent={ev => { setDayDrawer(null); setDetailModal(ev); }} />
      )}
    </div>
  );
}

// A chip carries type by hue and glyph, project identity by a thin tinted left
// edge, and text only for the time and title. The background is a wash of the
// type hue and the text is the same hue, so it is readable in both themes: the
// chip never assumes an ink colour.
function EventChipInner({ ev, edgeTint, dragging }) {
  const { Icon, hue } = eventVisual(ev.event_type);
  return (
    <div
      className="cal-chip"
      style={{
        '--chip-hue': hue,
        borderLeft: edgeTint ? `3px solid ${edgeTint}` : undefined,
        opacity: dragging ? 0.4 : 1,
      }}
    >
      <Icon size={12} className="cal-chip-icon" />
      <span className="cal-chip-text">
        {ev.start_time ? `${ev.start_time.slice(0, 5)} ` : ''}{ev.title}
      </span>
    </div>
  );
}

function DraggableEventChip({ ev, edgeTint, onClick }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: ev.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      style={{
        cursor: isDragging ? 'grabbing' : 'grab',
        transform: CSS.Translate.toString(transform),
        position: 'relative',
        zIndex: isDragging ? 999 : 'auto',
      }}
    >
      <EventChipInner ev={ev} edgeTint={edgeTint} dragging={isDragging} />
    </div>
  );
}

function DroppableDayCell({ cell, compact, highlight, edgeTintFor, registerRef, onClickEmpty, onClickEvent, onOverflow }) {
  const { setNodeRef, isOver } = useDroppable({ id: cell.ds });
  const { cellDay, isCurrentMonth, isToday, events } = cell;
  const MAX_VISIBLE = 3;
  const visible = events.slice(0, MAX_VISIBLE);
  const overflow = events.length - MAX_VISIBLE;

  return (
    <div
      ref={el => { setNodeRef(el); registerRef(el); }}
      onClick={onClickEmpty}
      className={`calendar-day-cell${isToday ? ' is-today' : ''}${compact ? ' is-compact' : ''}${isOver ? ' is-over' : ''}${highlight ? ' is-highlight' : ''}`}
    >
      <div className={`cal-daynum${isToday ? ' is-today' : ''}${isCurrentMonth ? '' : ' is-out'}`}>{cellDay}</div>
      {visible.map(ev => (
        <DraggableEventChip key={ev.id} ev={ev} edgeTint={edgeTintFor(ev)} onClick={e => { e.stopPropagation(); onClickEvent(ev); }} />
      ))}
      {overflow > 0 && (
        <button className="cal-more" onClick={e => { e.stopPropagation(); onOverflow(); }}>+{overflow} more</button>
      )}
    </div>
  );
}

function WeekDayColumn({ ds, isToday, highlight, events, edgeTintFor, registerRef, onClickEmpty, onClickEvent }) {
  const { setNodeRef, isOver } = useDroppable({ id: ds });
  const d = parseDS(ds);
  const untimed = events.filter(e => !e.start_time);
  const timed = events.filter(e => e.start_time);
  return (
    <div className={`cal-week-col${isToday ? ' is-today' : ''}${isOver ? ' is-over' : ''}${highlight ? ' is-highlight' : ''}`}>
      <div className={`cal-week-head${isToday ? ' is-today' : ''}`}>
        <span className="cal-week-dow">{DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}</span>
        <span className={`cal-daynum${isToday ? ' is-today' : ''}`}>{d.getDate()}</span>
      </div>
      <div
        className="cal-week-body"
        ref={el => { setNodeRef(el); registerRef(el); }}
        onClick={onClickEmpty}
      >
        {untimed.map(ev => (
          <DraggableEventChip key={ev.id} ev={ev} edgeTint={edgeTintFor(ev)} onClick={e => { e.stopPropagation(); onClickEvent(ev); }} />
        ))}
        {untimed.length > 0 && timed.length > 0 && <div className="cal-week-sep" />}
        {timed.map(ev => (
          <DraggableEventChip key={ev.id} ev={ev} edgeTint={edgeTintFor(ev)} onClick={e => { e.stopPropagation(); onClickEvent(ev); }} />
        ))}
      </div>
    </div>
  );
}

// A mobile day cell: date number and a row of type coloured dots, capped at
// three with a plus marker when more. No event text renders here, so nothing
// truncates. Tapping selects the day for the panel beneath the grid.
function MobileDensityCell({ ds, dow, cellDay, isCurrentMonth, isToday, isSelected, events, onSelect }) {
  const MAX_DOTS = 3;
  const dots = events.slice(0, MAX_DOTS);
  const extra = events.length - MAX_DOTS;
  return (
    <button
      type="button"
      className={`cal-mcell${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${isCurrentMonth ? '' : ' is-out'}`}
      onClick={() => onSelect(ds)}
      aria-pressed={isSelected}
    >
      {dow && <span className="cal-mcell-dow">{dow}</span>}
      <span className={`cal-mcell-num${isToday ? ' is-today' : ''}`}>{cellDay}</span>
      <span className="cal-mcell-dots">
        {dots.map(ev => (
          <span key={ev.id} className="cal-mdot" style={{ background: eventVisual(ev.event_type).hue }} />
        ))}
        {extra > 0 && <span className="cal-mdot-more">+</span>}
      </span>
    </button>
  );
}

// The selected day's events below the mobile grid, as readable rows carrying the
// type icon, the time and the full untruncated title.
function DayEventsPanel({ ds, events, onClickEvent }) {
  if (!ds) return null;
  const d = parseDS(ds);
  const dow = DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1];
  return (
    <div className="cal-day-panel">
      <div className="cal-day-panel-head">{dow} {d.getDate()} {MONTH_NAMES[d.getMonth()]}</div>
      {events.length === 0 ? (
        <div className="cal-day-panel-empty">
          <CalendarDays size={18} />
          <span>Nothing scheduled</span>
        </div>
      ) : (
        events.map(ev => {
          const { Icon, hue } = eventVisual(ev.event_type);
          return (
            <button type="button" key={ev.id} className="cal-day-row" onClick={() => onClickEvent(ev)}>
              <span className="cal-day-row-icon" style={{ color: hue }}><Icon size={15} /></span>
              {ev.start_time && <span className="cal-day-row-time">{ev.start_time.slice(0, 5)}</span>}
              <span className="cal-day-row-title">{ev.title}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

function DayDrawer({ ds, events, edgeTintFor, onClose, onClickEvent }) {
  const d = parseDS(ds);
  return (
    <Overlay title={<>{DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]} {d.getDate()} {MONTH_NAMES[d.getMonth()]} {d.getFullYear()}</>} onClose={onClose} width={420} guard={false}>
      <div className="cal-drawer-list">
        {events.map(ev => (
          <div key={ev.id} onClick={() => onClickEvent(ev)} style={{ cursor: 'pointer' }}>
            <EventChipInner ev={ev} edgeTint={edgeTintFor(ev)} />
          </div>
        ))}
      </div>
    </Overlay>
  );
}

function EventDetailModal({ event, onClose, onEdit, onChanged }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const navigate = useNavigate();
  const isTask = event.event_type === 'task' || event.event_type === 'standalone_task';
  const synced = isSynced(event);
  const { Icon, hue, label } = eventVisual(event.event_type);
  const deleteCopy = synced
    ? syncedDeleteCopy(event)
    : { title: `Delete ${event.title}?`, message: 'This cannot be undone.' };

  // Deleting a synced event clears the date on its source (server side), so it
  // does not come back on the next save. A manual event is simply removed.
  async function runDelete() {
    setBusy(true);
    setErr('');
    try {
      await api.del(`/calendar/${event.id}`);
      setConfirmDelete(false);
      onChanged();
    } catch (e) { setErr(e.message); setConfirmDelete(false); setBusy(false); }
  }

  // Marks the task done through its own endpoint, exactly as the Tasks page and
  // the project page do. The event then drops off, since done tasks carry none.
  async function markDone() {
    setBusy(true);
    setErr('');
    try {
      if (event.event_type === 'task') {
        const full = await api.get(`/projects/${event.project_id}`);
        const task = full.phases.flatMap(ph => ph.tasks || []).find(t => t.id === event.task_id);
        if (!task) throw new Error('This task no longer exists.');
        if (task.status !== 'done') {
          await api.put(`/projects/${event.project_id}/tasks/${task.id}`, { ...task, status: 'done' });
        }
      } else {
        // Toggle flips the flag, so it is only sent while the task is still open.
        const all = await api.get('/standalone-tasks');
        const task = all.find(t => t.id === event.standalone_task_id);
        if (!task) throw new Error('This task no longer exists.');
        if (!task.done) await api.post(`/standalone-tasks/${task.id}/toggle`, {});
      }
      onChanged();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  function go(to) {
    navigate(to);
    onClose();
  }

  return (
    <Overlay title={event.title} onClose={onClose} width={480}>
      <div style={{ padding: '0 0 16px' }}>
        <div className="fin-row" style={{ padding: '8px 0' }}>
          <span className="text-2">Type</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: hue }}>
            <Icon size={13} /> {label}
          </span>
        </div>
        <div className="fin-row" style={{ padding: '8px 0' }}>
          <span className="text-2">Date</span>
          <span>
            {fmtShortDate(event.start_date)}
            {event.end_date && event.end_date !== event.start_date ? ` to ${fmtShortDate(event.end_date)}` : ''}
          </span>
        </div>
        {(event.start_time || event.end_time) && (
          <div className="fin-row" style={{ padding: '8px 0' }}>
            <span className="text-2">Time</span>
            <span>{event.start_time || ''}{event.end_time ? ` to ${event.end_time}` : ''}</span>
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
          <div style={{ marginTop: '12px', padding: '10px 12px', background: 'var(--overlay-02)', borderRadius: '10px', fontSize: '13px', color: 'var(--color-mid-gray)' }}>
            {event.notes}
          </div>
        )}
        {err && <div className="error-msg">{err}</div>}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost btn-sm cal-delete-btn" onClick={() => setConfirmDelete(true)} disabled={busy} title="Delete" aria-label="Delete">
          <Trash2 size={14} />
        </button>
        <div style={{ flex: 1 }} />
        {event.event_type === 'standalone_task' && (
          <button className="btn btn-ghost" onClick={() => go('/tasks')} title="Open in Tasks"><ListTodo size={14} /> Tasks</button>
        )}
        {event.project_id && (
          <button className="btn btn-ghost" onClick={() => go(`/projects/${event.project_id}`)} title="Open project"><FolderOpen size={14} /> Project</button>
        )}
        {isTask && synced && (
          <button className="btn btn-ghost" onClick={markDone} disabled={busy} title="Mark done"><CheckCircle2 size={14} /> Done</button>
        )}
        <button className="btn btn-primary" onClick={onEdit} disabled={busy}><Edit2 size={13} /> Edit</button>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={deleteCopy.title}
          message={deleteCopy.message}
          confirmLabel={synced ? 'Clear date' : 'Delete'}
          tone="danger"
          busy={busy}
          onConfirm={runDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Overlay>
  );
}

function EventModal({ mode, event, initialDate, projects, onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const synced = isEdit && isSynced(event);
  const editable = synced ? (SYNC_EDITABLE[event.event_type] || []) : null;
  // A field is locked on a synced event when its source has no place for it.
  const locked = k => !!editable && !editable.includes(k);
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
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function f(k, v) {
    setForm(p => {
      const next = { ...p, [k]: v };
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

  const { Icon: TypeIcon, hue: typeHue, label: typeLabel } = eventVisual(form.event_type);
  const sourceName = event?.event_type === 'standalone_task' || event?.event_type === 'task' ? 'task' : 'project';

  return (
    <Overlay title={isEdit ? 'Edit Event' : 'Add Event'} onClose={onClose} width={520} className="cal-event-form">

      <div className="form-row">
        <label className="form-label">Title *</label>
        <input className="input" value={form.title} onChange={e => f('title', e.target.value)} placeholder="Event title" autoFocus={!synced} disabled={locked('title')} />
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Link to Project</label>
          {synced ? (
            <div className="cal-locked-field" title="Linked to its source">
              <Lock size={12} /> <span>{event.project_title || 'No project'}</span>
            </div>
          ) : (
            <select className="select" value={form.project_id} onChange={e => f('project_id', e.target.value)}>
              <option value="">No project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          )}
        </div>
        <div className="form-row">
          <label className="form-label">Event Type</label>
          {synced ? (
            <div className="cal-locked-field" style={{ color: typeHue }} title={typeLabel}>
              <Lock size={12} /> <TypeIcon size={14} />
            </div>
          ) : (
            <select className="select" value={form.event_type} onChange={e => f('event_type', e.target.value)}>
              <option value="shoot">Shoot</option>
              <option value="meeting">Meeting</option>
              <option value="deadline">Deadline</option>
              <option value="other">Other</option>
            </select>
          )}
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Start Date *</label>
          <DateField value={form.start_date} onChange={v => f('start_date', v)} />
        </div>
        <div className="form-row">
          <label className="form-label">End Date</label>
          <DateField value={form.end_date} onChange={v => f('end_date', v)} disabled={locked('end_date')} />
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Start Time</label>
          <input type="time" className="input" value={form.start_time} onChange={e => f('start_time', e.target.value)} disabled={locked('start_time')} />
        </div>
        <div className="form-row">
          <label className="form-label">End Time</label>
          <input type="time" className="input" value={form.end_time} onChange={e => f('end_time', e.target.value)} disabled={locked('end_time')} />
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">Location</label>
        <input className="input" value={form.location} onChange={e => f('location', e.target.value)} placeholder="Location" disabled={locked('location')} />
      </div>

      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" rows={3} value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Notes..." disabled={locked('notes')} />
      </div>

      {synced && (
        <div className="cal-sync-note">
          <Lock size={12} /> Greyed fields live on the {sourceName}. Change them there.
        </div>
      )}

      {err && <div className="error-msg">{err}</div>}

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Event'}
        </button>
      </div>
    </Overlay>
  );
}
