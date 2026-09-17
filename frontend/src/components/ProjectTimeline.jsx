import React, { useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';
import { fmt, fmtDate } from '../api';
import { Private } from '../context/PrivacyContext';

const DAY = 86400000;
const LABEL_W = 150;

// Axis window bounds. The span adapts to the data (see the memo below) but is
// clamped so a single near deadline does not zoom the axis absurdly and one far
// future project does not crush everything else.
const MIN_DAYS = 28;
const MAX_DAYS = 180;
const PAD_DAYS = 7;   // roughly one week of breathing room past the last deadline

// Status is encoded by colour, never by a word. Each status has one hue from the
// shared palette (see index.css), and the bar and its legend dot draw from the
// exact same token so they match by eye. Overdue overrides with ember red.
const STATUSES = [
  { key: 'development',     label: 'Development' },
  { key: 'pre-production',  label: 'Pre' },
  { key: 'production',      label: 'Production' },
  { key: 'post-production', label: 'Post' },
];
const STATUS_HUE = {
  'development':     'var(--tl-hue-development)',
  'pre-production':  'var(--tl-hue-pre-production)',
  'production':      'var(--tl-hue-production)',
  'post-production': 'var(--tl-hue-post-production)',
};

function parseDate(v) {
  if (!v) return null;
  const s = String(v).includes('T') ? String(v) : String(v).replace(' ', 'T');
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  return isNaN(d.getTime()) ? null : d;
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ProjectTimeline({ projects, onPatchDeadline }) {
  const navigate = useNavigate();
  const tracksRef = useRef(null);
  const [drag, setDrag] = useState(null); // { id, deadline }

  const { axisStart, totalMs, todayPct, weeks } = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    const start = new Date(now);
    start.setDate(now.getDate() - dow);

    // End at the latest deadline plus padding. Projects with no deadline do not
    // contribute to the range. Clamp the span so it never zooms too far in or out.
    let latest = null;
    (projects || []).forEach(p => {
      const d = parseDate(p.deadline);
      if (d && (!latest || d > latest)) latest = d;
    });
    let spanDays = MIN_DAYS;
    if (latest) {
      const raw = Math.ceil((latest - start) / DAY) + PAD_DAYS;
      spanDays = Math.min(MAX_DAYS, Math.max(MIN_DAYS, raw));
    }
    const span = spanDays * DAY;
    const pct = ((now - start) / span) * 100;

    // Tick interval scales with the span so the header never crowds.
    const interval = spanDays <= 56 ? 7 : spanDays <= 120 ? 14 : 28;
    const marks = [];
    for (let t = 0; t < spanDays; t += interval) {
      const d = new Date(start.getTime() + t * DAY);
      marks.push({
        left: (t / spanDays) * 100,
        label: `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`,
      });
    }
    return { axisStart: start, totalMs: span, todayPct: pct, weeks: marks };
  }, [projects]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const pctOf = d => ((d - axisStart) / totalMs) * 100;
  const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

  function dateFromClientX(clientX) {
    const el = tracksRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
    const d = new Date(axisStart.getTime() + frac * totalMs);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function startResize(e, p) {
    e.preventDefault();
    e.stopPropagation();
    const move = ev => {
      const d = dateFromClientX(ev.clientX);
      if (!d) return;
      // Never let the deadline fall before the start of the bar.
      const floor = new Date(Math.max(today.getTime(), (parseDate(p.created_at) || today).getTime()));
      if (d < floor) d.setTime(floor.getTime());
      setDrag({ id: p.id, deadline: toISODate(d) });
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dateFromClientX(ev.clientX);
      setDrag(null);
      if (!d) return;
      const floor = new Date(Math.max(today.getTime(), (parseDate(p.created_at) || today).getTime()));
      if (d < floor) d.setTime(floor.getTime());
      const iso = toISODate(d);
      if (iso !== (p.deadline || null)) onPatchDeadline(p, iso);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  if (!projects || projects.length === 0) {
    return (
      <div className="ptl-empty">
        <FolderOpen size={22} style={{ color: 'var(--color-hairline-strong)' }} />
        <span>No active projects</span>
      </div>
    );
  }

  return (
    <div className="ptl">
      {/* Week axis */}
      <div className="ptl-head">
        <div className="ptl-head-spacer" style={{ width: LABEL_W }} />
        <div className="ptl-head-track">
          {weeks.map((w, i) => (
            <span key={i} className="ptl-week" style={{ left: `${w.left}%` }}>{w.label}</span>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="ptl-body">
        <div className="ptl-labels" style={{ width: LABEL_W }}>
          {projects.map(p => (
            <div key={p.id} className="ptl-rowlabel" onClick={() => navigate(`/projects/${p.id}`)}>
              <div className="ptl-title">{p.title}</div>
              <div className="ptl-client">{p.client_name || 'No client'}</div>
            </div>
          ))}
        </div>

        <div className="ptl-tracks" ref={tracksRef}>
          <div className="ptl-today" style={{ left: `${clamp(todayPct)}%` }} />
          {projects.map(p => {
            const deadlineStr = drag && drag.id === p.id ? drag.deadline : p.deadline;
            const deadline = parseDate(deadlineStr);
            const created = parseDate(p.created_at);
            const barStart = created && created > axisStart ? created : today;
            const startPct = clamp(pctOf(barStart));

            const budget = Number(p.agreed_budget) || 0;
            const received = Number(p.total_received) || 0;
            const receivedPct = budget > 0 ? clamp((received / budget) * 100) : 0;

            const overdue = deadline && deadline < today && received < budget;
            const tone = overdue ? 'var(--tl-overdue)' : (STATUS_HUE[p.status] || 'var(--tl-hue-development)');

            let bar;
            if (!deadline) {
              // Open ended: a short muted stub with a dashed right edge.
              bar = (
                <div
                  className="ptl-bar ptl-bar-open"
                  style={{ left: `${startPct}%`, width: '46px', ['--tone']: tone }}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  title="No deadline set"
                >
                  <div className="ptl-fill" style={{ width: `${receivedPct}%` }} />
                </div>
              );
            } else {
              const endPct = clamp(pctOf(deadline));
              const left = Math.min(startPct, endPct);
              const width = Math.max(1.5, Math.abs(endPct - left));
              bar = (
                <div
                  className={`ptl-bar${overdue ? ' ptl-bar-overdue' : ''}`}
                  style={{ left: `${left}%`, width: `${width}%`, ['--tone']: tone }}
                  onClick={() => navigate(`/projects/${p.id}`)}
                >
                  <div className="ptl-fill" style={{ width: `${receivedPct}%` }} />
                  <div
                    className="ptl-handle"
                    onPointerDown={e => startResize(e, p)}
                    onClick={e => e.stopPropagation()}
                    title="Drag to change deadline"
                  />
                  <TimelineTooltip p={p} deadlineStr={deadlineStr} />
                </div>
              );
            }

            // Shoot block, positioned independently within the track.
            const shoot = parseDate(p.shoot_date);
            let shootBlock = null;
            if (shoot) {
              const days = Math.max(1, Number(p.shoot_days) || 1);
              const shootEnd = new Date(shoot.getTime() + days * DAY);
              const sL = clamp(pctOf(shoot));
              const sW = Math.max(0.8, clamp(pctOf(shootEnd)) - sL);
              shootBlock = <div className="ptl-shoot" style={{ left: `${sL}%`, width: `${sW}%`, ['--tone']: tone }} />;
            }

            return (
              <div key={p.id} className="ptl-rowtrack">
                {shootBlock}
                {bar}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend: the one place the status words are allowed. Each dot uses the
          same token as the bars it decodes. */}
      <div className="ptl-legend">
        {STATUSES.map(s => (
          <span key={s.key} className="ptl-legend-item">
            <span className="ptl-dot" style={{ background: STATUS_HUE[s.key], borderColor: STATUS_HUE[s.key] }} />
            {s.label}
          </span>
        ))}
        <span className="ptl-legend-item">
          <span className="ptl-dot" style={{ background: 'var(--tl-overdue)', borderColor: 'var(--tl-overdue)' }} />
          Overdue
        </span>
      </div>
    </div>
  );
}

function TimelineTooltip({ p, deadlineStr }) {
  const shoot = parseDate(p.shoot_date);
  const days = Math.max(1, Number(p.shoot_days) || 1);
  let shootLabel = 'No shoot';
  if (shoot) {
    if (days > 1) {
      const end = new Date(shoot.getTime() + (days - 1) * DAY);
      shootLabel = `${fmtDate(p.shoot_date)} to ${fmtDate(toISODate(end))}`;
    } else {
      shootLabel = fmtDate(p.shoot_date);
    }
  }
  return (
    <div className="ptl-tip">
      <div className="ptl-tip-row"><span>Deadline</span><b>{deadlineStr ? fmtDate(deadlineStr) : 'Open'}</b></div>
      <div className="ptl-tip-row"><span>Shoot</span><b>{shootLabel}</b></div>
      <div className="ptl-tip-row"><span>Received</span><b><Private>{fmt(p.total_received)}</Private></b></div>
      <div className="ptl-tip-row"><span>Agreed</span><b><Private>{fmt(p.agreed_budget)}</Private></b></div>
    </div>
  );
}
