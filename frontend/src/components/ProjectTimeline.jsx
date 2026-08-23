import React, { useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';
import { fmt, fmtDate } from '../api';
import { Private } from '../context/PrivacyContext';

const DAY = 86400000;
const SPAN_DAYS = 70;          // ten weeks
const LABEL_W = 150;

// Status is encoded by bar tone, never by a word. The tones are a monochrome
// ramp derived from the ink color (see index.css), consistent with the app's
// badge system. The legend at the foot is the one place the words appear.
const STATUSES = [
  { key: 'development',     label: 'Development' },
  { key: 'pre-production',  label: 'Pre' },
  { key: 'production',      label: 'Production' },
  { key: 'post-production', label: 'Post' },
];
const TONE = {
  'development':     'var(--tl-development)',
  'pre-production':  'var(--tl-pre-production)',
  'production':      'var(--tl-production)',
  'post-production': 'var(--tl-post-production)',
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

  const { axisStart, todayPct, weeks } = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    const start = new Date(now);
    start.setDate(now.getDate() - dow);
    const totalMs = SPAN_DAYS * DAY;
    const pct = ((now - start) / totalMs) * 100;
    const marks = [];
    for (let w = 0; w < 10; w++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7);
      marks.push({
        left: (w / 10) * 100,
        label: `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`,
      });
    }
    return { axisStart: start, todayPct: pct, weeks: marks };
  }, []);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const totalMs = SPAN_DAYS * DAY;
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
            const tone = overdue ? 'var(--tl-overdue)' : (TONE[p.status] || 'var(--tl-development)');

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
              shootBlock = <div className="ptl-shoot" style={{ left: `${sL}%`, width: `${sW}%` }} />;
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

      {/* Legend: the one place the status words are allowed. */}
      <div className="ptl-legend">
        {STATUSES.map(s => (
          <span key={s.key} className="ptl-legend-item">
            <span className="ptl-dot" style={{ background: TONE[s.key], borderColor: TONE[s.key] }} />
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
