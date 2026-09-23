import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, List, GanttChart, Lightbulb, ChevronDown, ChevronUp, ChevronRight,
  Search, Camera, Flag, CheckCircle2, Circle,
} from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import { Private } from '../context/PrivacyContext';
import ProjectWizard from '../components/ProjectWizard';
import AddLeadModal from '../components/AddLeadModal';
import LeadsRail from '../components/LeadsRail';
import ProjectTimeline from '../components/ProjectTimeline';
import ConfirmDialog from '../components/ConfirmDialog';
import { makeDeadlinePatcher } from '../lib/patchDeadline';
import { advanceToPhase } from '../lib/advancePhase';
import { GROUP_TINT, categoryVisual, CategoryTile } from '../lib/categoryIcons';

// The four active statuses, in flow order. Completed lives on its own tab.
const ACTIVE_STATUSES = ['development', 'pre-production', 'production', 'post-production'];

// The five category groups in a fixed order, so the group filter row never
// reshuffles. Each one carries its own palette tint (see categoryIcons).
const GROUPS = Object.keys(GROUP_TINT);

// One status colour system, shared with the Dashboard hero and the timeline
// (see index.css). The same token decodes the row dot, the filter dot and the
// timeline bar, so all three agree by eye. Completed keeps a distinct hollow
// treatment; overdue is a timeline-only tint with its own legend there.
const STATUS_HUE = {
  'development':     'var(--tl-hue-development)',
  'pre-production':  'var(--tl-hue-pre-production)',
  'production':      'var(--tl-hue-production)',
  'post-production': 'var(--tl-hue-post-production)',
};
const STATUS_LABEL = {
  'development':     'Development',
  'pre-production':  'Pre-Production',
  'production':      'Production',
  'post-production': 'Post-Production',
  'completed':       'Completed',
};

const SORTS = [
  { key: 'newest',      label: 'Newest first' },
  { key: 'oldest',      label: 'Oldest first' },
  { key: 'budget_high', label: 'Budget: high to low' },
  { key: 'budget_low',  label: 'Budget: low to high' },
  { key: 'margin_high', label: 'Margin: high to low' },
];

const NEXT_SHOOT_WINDOW = 30; // days: the ring is full at the shoot, empty a month out

// Projected margin: what the project keeps if it collects its agreed budget and
// its committed costs land as booked. It is budget minus crew minus expenses over
// budget, not received over budget, so an unpaid project does not read as a loss.
function getMargin(p) {
  if (!p.agreed_budget || p.agreed_budget <= 0) return null;
  return ((p.agreed_budget - p.total_crew_cost - p.total_expenses) / p.agreed_budget) * 100;
}

function MarginBadge({ p }) {
  const margin = getMargin(p);
  if (margin === null) return null;
  const cls = margin >= 30 ? 'badge-profit-high' : margin <= 0 ? 'badge-danger' : 'badge-profit-low';
  return <span className={`badge ${cls}`}>{Math.round(margin)}%</span>;
}

// The status word never prints on the row. The dot carries it; the word lives in
// the dot's tooltip and once in the legend at the foot of the page.
function StatusDot({ status, size = 10 }) {
  if (status === 'completed') {
    return (
      <span
        className="status-dot"
        style={{ width: size, height: size, background: 'transparent', border: '1.5px solid var(--color-hairline-strong)' }}
      />
    );
  }
  return (
    <span
      className="status-dot"
      style={{ width: size, height: size, background: STATUS_HUE[status] || 'var(--color-hairline-strong)' }}
    />
  );
}

// A date the user acts on, with its urgency. Text is allowed here: this is a date.
function dateInfo(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((d - today) / 86400000);
  let label, cls;
  if (diff === 0)      { label = 'Today'; cls = 'today'; }
  else if (diff > 0)   { label = `in ${diff}d`; cls = diff <= 7 ? 'urgent' : ''; }
  else                 { label = fmtDate(dateStr); cls = ''; }
  return { diff, label, cls };
}

function DateChip({ info, Icon, muted, title }) {
  return (
    <span className={`shoot-chip${info.cls ? ` ${info.cls}` : ''}${muted ? ' muted' : ''}`} title={title}>
      <Icon size={11} /> {info.label}
    </span>
  );
}

// A small ring that fills as its date approaches, matching the win-rate ring on
// the Estimates strip. The ring carries the urgency, the numeral inside carries
// the fact: a day count with a small d suffix, the word Today at zero days, and
// a neutral dash in an empty ring when there is no upcoming shoot at all.
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

// ── Stat strip ────────────────────────────────────────────────────────────────
// Opens the page with four figures, matching the construction of the Estimates
// pipeline strip so the two pages read as siblings. Owed is not derived here:
// it is read from the shared owed calculation through /finances/stats.
function StatStrip({ projects, owedTotal }) {
  const strip = useMemo(() => {
    const active = projects.filter(p => p.status !== 'completed');
    // Every active project, meaning every project not yet completed, not only
    // those in the single production status.
    const activeCount = active.length;
    // Active projects whose budget has not been agreed with the client yet (TBC).
    // These contribute nothing to the money figures below, so counting them lets
    // a zero total explain itself.
    const awaitingBudget = active.filter(p => !((Number(p.agreed_budget) || 0) > 0)).length;
    const agreedValue = active.reduce((s, p) => s + (Number(p.agreed_budget) || 0), 0);

    // Next upcoming shoot among active projects. The original YYYY-MM-DD string
    // is kept for the tooltip: formatting a local midnight Date through UTC
    // would read one day early in Pristina.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let nextShoot = null, nextShootDate = null;
    active.forEach(p => {
      if (!p.shoot_date) return;
      const d = new Date(p.shoot_date + 'T00:00:00');
      if (isNaN(d.getTime()) || d < today) return;
      if (!nextShoot || d < nextShoot) { nextShoot = d; nextShootDate = p.shoot_date; }
    });
    let shootDays = null, shootFrac = 0;
    if (nextShoot) {
      shootDays = Math.round((nextShoot - today) / 86400000);
      shootFrac = Math.max(0, Math.min(1, 1 - shootDays / NEXT_SHOOT_WINDOW));
    }
    return { activeCount, awaitingBudget, agreedValue, nextShoot, nextShootDate, shootDays, shootFrac };
  }, [projects]);

  // When every active project is awaiting a budget, the money figures are not
  // zero, they are simply not priced yet. Render them as TBC and drop the note,
  // which would only repeat what the figure now says.
  const allTBC = strip.activeCount > 0 && strip.awaitingBudget === strip.activeCount;

  const awaitingNote = (!allTBC && strip.awaitingBudget > 0) ? (
    <div className="est-pipe-note" title={`${strip.awaitingBudget} active ${strip.awaitingBudget === 1 ? 'project is' : 'projects are'} awaiting a budget (TBC), so ${strip.awaitingBudget === 1 ? 'it contributes' : 'they contribute'} nothing here`}>
      {strip.awaitingBudget} TBC
    </div>
  ) : null;

  const shootTip = strip.nextShoot
    ? `Next shoot ${fmtDate(strip.nextShootDate)}${strip.shootDays === 0 ? ' (today)' : ` (in ${strip.shootDays}d)`}`
    : 'No upcoming shoot';

  return (
    <div className="est-pipeline est-pipeline-4">
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Active projects</div>
        <div className="est-pipe-value">{strip.activeCount}</div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Active agreed value</div>
        <div className="est-pipe-value">
          {allTBC ? <span className="pipe-tbc">TBC</span> : <Private>{fmt(strip.agreedValue)}</Private>}
        </div>
        {awaitingNote}
      </div>
      {/* Everything the agency is owed, from the shared owed calculation: the
          Dashboard's pending plus upcoming, completed projects included. */}
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Owed</div>
        <div className="est-pipe-value"><Private>{fmt(owedTotal)}</Private></div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Next shoot</div>
        <div className="est-pipe-ring" title={shootTip}>
          <ProximityRing frac={strip.shootFrac} color="var(--cat-2)" days={strip.nextShoot ? strip.shootDays : null} />
        </div>
      </div>
    </div>
  );
}

export default function Projects() {
  const [projects, setProjects]       = useState([]);
  const [leads, setLeads]             = useState([]);
  const [owedTotal, setOwedTotal]     = useState(0);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState('active');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [query, setQuery]             = useState('');
  const [sort, setSort]               = useState('newest');
  const [expandedId, setExpandedId]   = useState(null);
  const [backConfirm, setBackConfirm] = useState(null); // { project, targetIndex }
  const [view, setView]               = useState(() => {
    const v = localStorage.getItem('massiv_projects_view');
    return v === 'timeline' || v === 'gantt' ? 'timeline' : 'list';
  });
  const [showWizard, setShowWizard]   = useState(false);
  const [showAddLead, setShowAddLead] = useState(false);
  const [leadsOpen, setLeadsOpen]     = useState(true);
  const [wizardPrefill, setWizardPrefill] = useState(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Everything the page needs is small and fully in memory, so we fetch once on
  // mount and do all filtering and sorting client side.
  async function load() {
    const [p, l, st] = await Promise.all([
      api.get('/projects'),
      api.get('/leads'),
      api.get('/finances/stats').catch(() => null),
    ]);
    setProjects(p);
    setLeads(l);
    setOwedTotal(st ? st.owedTotal : 0);
    setLeadsOpen(l.length > 0);
    setLoading(false);
    return { leads: l };
  }

  // A quieter refetch used to reconcile after an inline phase change, so the
  // leads section and its open/closed state are left untouched.
  async function reloadProjects() {
    const p = await api.get('/projects');
    setProjects(p);
  }

  useEffect(() => { load(); }, []);

  // Handle FAB, quick action and dashboard URL params once data has loaded. Read
  // on every change, so a quick action works while this page is already open.
  useEffect(() => {
    if (loading) return;
    const action    = searchParams.get('new');
    const newLead   = searchParams.get('newlead');
    const convertId = searchParams.get('convert');
    if (action !== '1' && newLead !== '1' && !convertId) return;
    setSearchParams({}, { replace: true });
    if (action === '1') {
      setWizardPrefill(null);
      setShowWizard(true);
    } else if (newLead === '1') {
      setShowAddLead(true);
    } else if (convertId) {
      const lead = leads.find(l => String(l.id) === convertId);
      if (lead) {
        setWizardPrefill(lead);
        setShowWizard(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading]);

  // One shared deadline patch path (see lib/patchDeadline), so dragging a bar on
  // this page saves and re-syncs the calendar exactly as the Dashboard does.
  const onPatchDeadline = useMemo(() => makeDeadlinePatcher(setProjects), []);

  function switchTab(tab) { setActiveTab(tab); setFilterStatus(''); setExpandedId(null); }
  function switchView(v) { setView(v); localStorage.setItem('massiv_projects_view', v); }

  // Clicking a row's status dot drives the same filter the top dot row uses.
  function filterByStatus(status) {
    if (!ACTIVE_STATUSES.includes(status)) return;
    setActiveTab('active');
    setFilterStatus(cur => (cur === status ? '' : status));
  }

  // Inline phase advance. Forward moves happen immediately; a backward move is
  // destructive to the phase record, so it is confirmed first.
  function requestAdvance(project, targetIndex) {
    const current = project.completed_phases || 0;
    const isCurrent = project.status !== 'completed' && targetIndex === current;
    if (isCurrent) return;
    if (targetIndex < current || project.status === 'completed') {
      setBackConfirm({ project, targetIndex });
      return;
    }
    runAdvance(project, targetIndex);
  }

  async function runAdvance(project, targetIndex) {
    const snapshot = projects;
    // Optimistic: fill segments up to the target straight away.
    setProjects(list => list.map(x =>
      x.id === project.id ? { ...x, completed_phases: targetIndex } : x
    ));
    try {
      await advanceToPhase(project, targetIndex);
      await reloadProjects();
    } catch (_) {
      setProjects(snapshot);
    }
  }

  function handleCreated(id) {
    setShowWizard(false);
    setWizardPrefill(null);
    navigate(`/projects/${id}`);
  }

  function handleLeadSaved(lead) {
    setLeads(prev => [lead, ...prev]);
    setLeadsOpen(true);
    setShowAddLead(false);
  }

  async function handleConvertLead(lead) {
    setWizardPrefill(lead);
    setShowWizard(true);
  }

  async function onProjectCreatedFromLead(id) {
    if (wizardPrefill) {
      try { await api.post(`/leads/${wizardPrefill.id}/convert`, {}); } catch (_) {}
      setLeads(prev => prev.filter(l => l.id !== wizardPrefill.id));
    }
    setShowWizard(false);
    setWizardPrefill(null);
    navigate(`/projects/${id}`);
  }

  const displayProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = projects.filter(p =>
      activeTab === 'active' ? p.status !== 'completed' : p.status === 'completed'
    );
    if (activeTab === 'active' && filterStatus) list = list.filter(p => p.status === filterStatus);
    if (filterGroup) list = list.filter(p => p.group_name === filterGroup);
    if (q) list = list.filter(p =>
      (p.title || '').toLowerCase().includes(q) || (p.client_name || '').toLowerCase().includes(q)
    );

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'oldest':      return (a.created_at || '').localeCompare(b.created_at || '');
        case 'budget_high': return (b.agreed_budget || 0) - (a.agreed_budget || 0);
        case 'budget_low':  return (a.agreed_budget || 0) - (b.agreed_budget || 0);
        case 'margin_high': {
          const mA = getMargin(a), mB = getMargin(b);
          if (mA === null && mB === null) return 0;
          if (mA === null) return 1;
          if (mB === null) return -1;
          return mB - mA;
        }
        default:            return (b.created_at || '').localeCompare(a.created_at || '');
      }
    });
    return sorted;
  }, [projects, activeTab, filterStatus, filterGroup, query, sort]);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Projects</div>
        <div className="flex-center gap-2">
          <div className="view-toggle">
            <button className={`view-toggle-btn${view === 'list'     ? ' active' : ''}`} onClick={() => switchView('list')}     title="List view"><List size={15} /></button>
            <button className={`view-toggle-btn${view === 'timeline' ? ' active' : ''}`} onClick={() => switchView('timeline')} title="Timeline view"><GanttChart size={15} /></button>
          </div>
          <button className="btn btn-ghost" onClick={() => setShowAddLead(true)}>
            <Lightbulb size={15} style={{ color: 'var(--accent)' }} /> Add Lead
          </button>
          <button className="btn btn-primary" onClick={() => { setWizardPrefill(null); setShowWizard(true); }}>
            <Plus size={15} /> New Project
          </button>
        </div>
      </div>

      {projects.length > 0 && <StatStrip projects={projects} owedTotal={owedTotal} />}

      {/* Active / Completed tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
        <button
          className={`btn btn-sm ${activeTab === 'active' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderRadius: '18px', padding: '5px 18px' }}
          onClick={() => switchTab('active')}
        >
          Active
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'completed' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderRadius: '18px', padding: '5px 18px' }}
          onClick={() => switchTab('completed')}
        >
          Completed
        </button>
      </div>

      {/* Search, status dots, group dots and an inline sort. */}
      <div className="est-controls">
        <div className="est-search">
          <Search size={15} />
          <input
            className="input"
            placeholder="Search title or client"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {activeTab === 'active' && (
          <div className="est-filter-dots">
            {ACTIVE_STATUSES.map(s => (
              <button
                key={s}
                className={`est-filter-dot ${filterStatus === s ? 'active' : ''}`}
                title={STATUS_LABEL[s]}
                aria-label={STATUS_LABEL[s]}
                onClick={() => setFilterStatus(cur => cur === s ? '' : s)}
              >
                <span className="status-dot" style={{ width: 12, height: 12, background: STATUS_HUE[s] }} />
              </button>
            ))}
          </div>
        )}

        {/* Group filter: the five group glyphs, tinted to match the row tiles. */}
        <div className="est-filter-dots proj-group-dots">
          {GROUPS.map(g => {
            const { Icon, tint } = categoryVisual(undefined, g);
            return (
              <button
                key={g}
                className={`est-filter-dot proj-group-dot ${filterGroup === g ? 'active' : ''}`}
                style={{ '--tint': tint }}
                title={g}
                aria-label={g}
                onClick={() => setFilterGroup(cur => cur === g ? '' : g)}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>

        <select
          className="select input proj-sort-select"
          value={sort}
          onChange={e => setSort(e.target.value)}
          title="Sort"
          aria-label="Sort"
        >
          {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {displayProjects.length === 0 ? (
        <div className="card card-pad empty">No projects found</div>
      ) : view === 'timeline' ? (
        <div className="card card-pad">
          <ProjectTimeline projects={displayProjects} onPatchDeadline={onPatchDeadline} />
        </div>
      ) : (
        <div className="card">
          {displayProjects.map(p => (
            <ProjectRow
              key={p.id}
              p={p}
              expanded={expandedId === p.id}
              onToggleExpand={() => setExpandedId(cur => cur === p.id ? null : p.id)}
              onNavigate={() => navigate(`/projects/${p.id}`)}
              onSegment={idx => requestAdvance(p, idx)}
              onFilterStatus={() => filterByStatus(p.status)}
            />
          ))}
        </div>
      )}

      {/* Legend: the one place status words appear on this page. */}
      {displayProjects.length > 0 && view === 'list' && (
        <div className="est-legend">
          {[...ACTIVE_STATUSES, 'completed'].map(s => (
            <span key={s} className="est-legend-item">
              <StatusDot status={s} size={10} /> {STATUS_LABEL[s]}
            </span>
          ))}
        </div>
      )}

      {/* Leads: the collapsible section wrapper stays, its contents are the shared rail. */}
      <div className="leads-section" style={{ marginTop: '20px' }}>
        <div className="leads-section-header" onClick={() => setLeadsOpen(o => !o)}>
          <div className="flex-center gap-2">
            <span className="leads-section-label">LEADS</span>
            <span className="leads-count-badge">{leads.length}</span>
          </div>
          {leadsOpen ? <ChevronUp size={14} color="var(--color-mid-gray)" /> : <ChevronDown size={14} color="var(--color-mid-gray)" />}
        </div>

        {leadsOpen && (
          <div style={{ paddingTop: '10px' }}>
            <LeadsRail leads={leads} setLeads={setLeads} onConvert={handleConvertLead} />
          </div>
        )}
      </div>

      {showWizard && (
        <ProjectWizardWithPrefill
          prefill={wizardPrefill}
          onClose={() => { setShowWizard(false); setWizardPrefill(null); }}
          onCreated={wizardPrefill ? onProjectCreatedFromLead : handleCreated}
        />
      )}
      {showAddLead && <AddLeadModal onClose={() => setShowAddLead(false)} onSaved={handleLeadSaved} />}

      {backConfirm && (
        <ConfirmDialog
          title="Move this project back a phase?"
          message="Reopening an earlier phase rewrites the phase record and cannot be undone cleanly."
          confirmLabel="Move back"
          tone="danger"
          onConfirm={() => { const bc = backConfirm; setBackConfirm(null); runAdvance(bc.project, bc.targetIndex); }}
          onCancel={() => setBackConfirm(null)}
        />
      )}
    </div>
  );
}

/* ─── Segmented phase track ─── */
// One segment per phase from total_phases (never assumed to be four). Completed
// phases render solid in the status hue, the active phase reads bright and
// outlined, the rest are hollow. Clicking a segment advances the project.
function PhaseTrack({ p, hue, onSegment }) {
  const total = p.total_phases || 0;
  if (total <= 0) return null;
  const done = p.completed_phases || 0;
  const currentIdx = p.status === 'completed' ? -1 : done;
  return (
    <div className="phase-track" style={{ '--hue': hue }} role="group" aria-label="Project phases">
      {Array.from({ length: total }).map((_, i) => {
        const state = i < done ? 'done' : i === currentIdx ? 'current' : 'todo';
        return (
          <button
            key={i}
            type="button"
            className={`phase-seg is-${state}`}
            aria-label={`Go to phase ${i + 1}`}
            onClick={e => { e.stopPropagation(); onSegment(i); }}
          />
        );
      })}
    </div>
  );
}

/* ─── Payment track ─── */
// Received against agreed. When the deadline has passed and the project is not
// fully paid, the track tints ember, the same overdue language as the timeline.
function PaymentTrack({ p, overdue }) {
  const agreed = Number(p.agreed_budget) || 0;
  // No agreed budget: the payment track does not belong in the phase stack,
  // where it reads as a caption for the phases. The TBC state now shows as a
  // muted chip with the money and date chips on the right of the row instead.
  if (agreed <= 0) return null;
  const pct = Math.min(100, Math.round(((Number(p.total_received) || 0) / agreed) * 100));
  return (
    <div className={`pay-track${overdue ? ' is-overdue' : ''}`}>
      <div className="pay-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ─── Project row ─── */
function ProjectRow({ p, expanded, onToggleExpand, onNavigate, onSegment, onFilterStatus }) {
  const rowRef = useRef(null);
  const tipRef = useRef(null);
  // The tooltip opens upward by default so it never covers the row below. It
  // only drops down when there is no row beneath (last row) and the viewport
  // has room; if neither direction fits comfortably it stays upward.
  const [tipDir, setTipDir] = useState('up');

  function placeTip() {
    const row = rowRef.current, tip = tipRef.current;
    if (!row || !tip) return;
    const rect = row.getBoundingClientRect();
    const tipH = tip.offsetHeight || 170;
    const margin = 12;
    const wrap = row.closest('.prow-wrap');
    const next = wrap && wrap.nextElementSibling;
    const hasRowBelow = !!(next && next.classList.contains('prow-wrap'));
    const fitsAbove = rect.top >= tipH + margin;
    const fitsBelow = (window.innerHeight - rect.bottom) >= tipH + margin;
    let dir;
    if (hasRowBelow && fitsAbove) dir = 'up';        // never cover the next row
    else if (fitsBelow) dir = 'down';                // last row with room below
    else dir = 'up';                                 // prefer upward otherwise
    setTipDir(dir);
  }

  const shoot = dateInfo(p.shoot_date);
  const dead  = dateInfo(p.deadline);
  let shootMuted = false, deadMuted = false;
  if (shoot && dead) {
    if (Math.abs(dead.diff) < Math.abs(shoot.diff)) shootMuted = true;
    else deadMuted = true;
  }

  const hue = p.status === 'completed'
    ? 'var(--color-hairline-strong)'
    : (STATUS_HUE[p.status] || 'var(--color-hairline-strong)');

  const agreed = Number(p.agreed_budget) || 0;
  const overdue = !!p.deadline && (dead && dead.diff < 0) && (Number(p.total_received) || 0) < agreed;

  return (
    <div className="prow-wrap">
      <div
        className="project-row"
        ref={rowRef}
        role="button"
        tabIndex={0}
        onClick={onNavigate}
        onMouseEnter={placeTip}
        onFocus={placeTip}
        onKeyDown={e => { if (e.key === 'Enter') onNavigate(); }}
      >
        {/* Left: identity */}
        <div className="prow-left">
          <CategoryTile categoryName={p.category_name} groupName={p.group_name} />
          <div className="prow-identity">
            <span className="prow-title">{p.title}</span>
            {p.client_name && <span className="prow-client">{p.client_name}</span>}
          </div>
        </div>

        {/* Middle: the two tracks sit close after the identity block */}
        <div className="prow-mid">
          <PhaseTrack p={p} hue={hue} onSegment={onSegment} />
          <PaymentTrack p={p} overdue={overdue} />
        </div>

        {/* A flexible spacer absorbs the leftover width, so the emptiness lands
            here between the track and the right hand chips, not before the track. */}
        <div className="prow-spacer" aria-hidden="true" />

        {/* Right: margin, TBC when unbudgeted, dates and the status dot (which filters) */}
        <div className="prow-right">
          <MarginBadge p={p} />
          {agreed <= 0 && (
            <span className="pay-tbc-chip" title="Budget not agreed with the client yet (TBC)">TBC</span>
          )}
          {shoot && <DateChip info={shoot} Icon={Camera} muted={shootMuted} title={`Shoot: ${fmtDate(p.shoot_date)}`} />}
          {dead  && <DateChip info={dead}  Icon={Flag}   muted={deadMuted}  title={`Deadline: ${fmtDate(p.deadline)}`} />}
          <button
            type="button"
            className="prow-dot-btn"
            title={`Filter by ${STATUS_LABEL[p.status] || p.status}`}
            aria-label={`Filter by ${STATUS_LABEL[p.status] || p.status}`}
            onClick={e => { e.stopPropagation(); onFilterStatus(); }}
          >
            <StatusDot status={p.status} />
          </button>
        </div>

        {/* Expand affordance, kept visually distinct from the navigating row */}
        <button
          type="button"
          className={`prow-expand${expanded ? ' is-open' : ''}`}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide phases and tasks' : 'Show phases and tasks'}
          title={expanded ? 'Hide phases and tasks' : 'Show phases and tasks'}
          onClick={e => { e.stopPropagation(); onToggleExpand(); }}
        >
          <ChevronRight size={16} />
        </button>

        {/* Row tooltip: the facts that were dropped from the row itself. */}
        <div className={`prow-tip tip-${tipDir}`} ref={tipRef} role="tooltip">
          <div className="prow-tip-row"><span>Category</span><b>{p.category_name || 'Uncategorised'}</b></div>
          <div className="prow-tip-row"><span>Phase</span><b>{p.current_phase || (p.status === 'completed' ? 'Completed' : 'No active phase')}</b></div>
          <div className="prow-tip-row">
            <span>Payment</span>
            {agreed > 0
              ? <b><Private>{fmt(p.total_received)}</Private> / <Private>{fmt(agreed)}</Private></b>
              : <b className="tip-tbc">TBC</b>}
          </div>
          <div className="prow-tip-row"><span>Shoot</span><b>{p.shoot_date ? fmtDate(p.shoot_date) : 'Not set'}</b></div>
          <div className="prow-tip-row"><span>Deadline</span><b>{p.deadline ? fmtDate(p.deadline) : 'Open'}</b></div>
        </div>
      </div>

      {expanded && <ProjectDrawer projectId={p.id} />}
    </div>
  );
}

/* ─── Expanded row drawer: phase checklist and open tasks ─── */
function ProjectDrawer({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get(`/projects/${projectId}`)
      .then(d => { if (live) { setData(d); setLoading(false); } })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId]);

  if (loading) return <div className="prow-drawer"><div className="prow-drawer-loading">Loading...</div></div>;
  if (!data) return <div className="prow-drawer"><div className="prow-drawer-loading">Could not load.</div></div>;

  const phases = data.phases || [];
  const openTasks = phases.flatMap(ph => (ph.tasks || []).filter(t => t.status !== 'done'));

  return (
    <div className="prow-drawer">
      <div className="prow-drawer-inner">
        <div className="prow-phase-list">
          {phases.map(ph => {
            const done = ph.status === 'completed';
            const active = ph.status === 'active';
            const openCount = (ph.tasks || []).filter(t => t.status !== 'done').length;
            return (
              <div key={ph.id} className={`prow-phase${active ? ' is-active' : ''}`}>
                {done
                  ? <CheckCircle2 size={15} className="prow-phase-done" />
                  : <Circle size={15} className={active ? 'prow-phase-active' : 'prow-phase-todo'} />}
                <span className="prow-phase-name">{ph.phase_name}</span>
                {openCount > 0 && <span className="prow-phase-count">{openCount}</span>}
              </div>
            );
          })}
        </div>

        <div className="prow-task-list">
          {openTasks.length === 0 ? (
            <div className="prow-task-empty">No open tasks</div>
          ) : (
            openTasks.map(t => (
              <div key={t.id} className="prow-task">
                <Circle size={9} className="prow-task-dot" />
                <span className="prow-task-title">{t.title}</span>
                {t.crew_name && <span className="prow-task-crew">{t.crew_name}</span>}
                {t.due_date && <span className="prow-task-due">{fmtDate(t.due_date)}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Project wizard wrapper ─── */
function ProjectWizardWithPrefill({ prefill, onClose, onCreated }) {
  if (!prefill) return <ProjectWizard onClose={onClose} onCreated={onCreated} />;
  return <ProjectWizard onClose={onClose} onCreated={onCreated} prefill={prefill} />;
}
