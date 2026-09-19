import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, List, GanttChart, Lightbulb, ChevronDown, ChevronUp,
  Search, SlidersHorizontal, Camera, Flag,
} from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import { Private } from '../context/PrivacyContext';
import ProjectWizard from '../components/ProjectWizard';
import AddLeadModal from '../components/AddLeadModal';
import LeadsRail from '../components/LeadsRail';
import ProjectTimeline from '../components/ProjectTimeline';
import { makeDeadlinePatcher } from '../lib/patchDeadline';

// The four active statuses, in flow order. Completed lives on its own tab.
const ACTIVE_STATUSES = ['development', 'pre-production', 'production', 'post-production'];

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

// Projected margin: what the project keeps if it collects its agreed budget and
// its committed costs land as booked. It is budget minus crew minus expenses over
// budget, not received over budget, so an unpaid project does not read as a loss.
function getMargin(p) {
  if (!p.agreed_budget || p.agreed_budget <= 0) return null;
  return ((p.agreed_budget - p.total_crew_cost - p.total_expenses) / p.agreed_budget) * 100;
}

/* ── Hover tooltip primitive: a fact travels on hover instead of taking space. ── */
function Tip({ content, children, className = '' }) {
  return (
    <span className={`tip-wrap ${className}`}>
      {children}
      <span className="tip-pop" role="tooltip">{content}</span>
    </span>
  );
}

function MarginBadge({ p }) {
  const margin = getMargin(p);
  if (margin === null) return null;
  const cls = margin >= 30 ? 'badge-profit-high' : margin <= 0 ? 'badge-danger' : 'badge-profit-low';
  return <span className={`badge ${cls}`}>{Math.round(margin)}%</span>;
}

// The status word never prints on the card. The dot carries it; the word lives in
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

export default function Projects() {
  const [projects, setProjects]       = useState([]);
  const [categories, setCategories]   = useState([]);
  const [leads, setLeads]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState('active');
  const [filterStatus, setFilterStatus] = useState('');
  const [query, setQuery]             = useState('');
  const [filterCat, setFilterCat]     = useState('');
  const [sort, setSort]               = useState('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  // mount and do all filtering and sorting client side. The API query params are
  // left intact for other callers; this page just stops using them.
  async function load() {
    const [p, ca, l] = await Promise.all([
      api.get('/projects'),
      api.get('/settings/project-categories'),
      api.get('/leads'),
    ]);
    setProjects(p);
    setCategories(ca);
    setLeads(l);
    setLeadsOpen(l.length > 0);
    setLoading(false);
    return { leads: l };
  }

  useEffect(() => {
    load().then(({ leads: loadedLeads }) => {
      // Handle FAB / dashboard URL params after data loads.
      const action    = searchParams.get('new');
      const newLead   = searchParams.get('newlead');
      const convertId = searchParams.get('convert');

      if (action === '1') {
        setShowWizard(true);
        setSearchParams({});
      } else if (newLead === '1') {
        setShowAddLead(true);
        setSearchParams({});
      } else if (convertId) {
        const lead = loadedLeads.find(l => String(l.id) === convertId);
        if (lead) {
          setWizardPrefill(lead);
          setShowWizard(true);
        }
        setSearchParams({});
      }
    });
  }, []);

  // One shared deadline patch path (see lib/patchDeadline), so dragging a bar on
  // this page saves and re-syncs the calendar exactly as the Dashboard does.
  const onPatchDeadline = useMemo(() => makeDeadlinePatcher(setProjects), []);

  function switchTab(tab) { setActiveTab(tab); setFilterStatus(''); }
  function switchView(v) { setView(v); localStorage.setItem('massiv_projects_view', v); }

  const grouped = categories.reduce((acc, c) => {
    acc[c.group_name] = acc[c.group_name] || [];
    acc[c.group_name].push(c);
    return acc;
  }, {});

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

  // Convert on this page keeps the richer wizard based flow: prefill the wizard,
  // and on success mark the lead converted and drop it.
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
    if (filterCat) list = list.filter(p => String(p.category_id) === String(filterCat));
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
  }, [projects, activeTab, filterStatus, filterCat, query, sort]);

  const moreActive = filterCat !== '' || sort !== 'newest';

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

      {/* Search + status dots + a single compact control for category and sort. */}
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

        <div className="proj-filter-more">
          <button
            className={`est-filter-dot${moreActive ? ' active' : ''}`}
            title="Category and sort"
            aria-label="Category and sort"
            onClick={() => setFiltersOpen(o => !o)}
          >
            <SlidersHorizontal size={15} />
          </button>
          {filtersOpen && (
            <>
              <div className="proj-filter-scrim" onClick={() => setFiltersOpen(false)} />
              <div className="proj-filter-pop">
                <label className="form-label">Category</label>
                <select className="select input" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                  <option value="">All categories</option>
                  {Object.entries(grouped).map(([g, cats]) => (
                    <optgroup key={g} label={g}>
                      {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <label className="form-label" style={{ marginTop: '10px' }}>Sort</label>
                <select className="select input" value={sort} onChange={e => setSort(e.target.value)}>
                  {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {displayProjects.length === 0 ? (
        <div className="card card-pad empty">No projects found</div>
      ) : view === 'timeline' ? (
        <div className="card card-pad">
          <ProjectTimeline projects={displayProjects} onPatchDeadline={onPatchDeadline} />
        </div>
      ) : (
        <div className="card">
          {displayProjects.map(p => <ProjectRowCard key={p.id} p={p} />)}
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
    </div>
  );
}

/* ─── Project row card ─── */
function ProjectRowCard({ p }) {
  const shoot = dateInfo(p.shoot_date);
  const dead  = dateInfo(p.deadline);
  // The nearer date (smaller distance from today) reads as the emphasised chip.
  let shootMuted = false, deadMuted = false;
  if (shoot && dead) {
    if (Math.abs(dead.diff) < Math.abs(shoot.diff)) shootMuted = true;
    else deadMuted = true;
  }

  const totalPhases   = p.total_phases || 4;
  const phaseProgress = totalPhases > 0 ? Math.round((p.completed_phases / totalPhases) * 100) : 0;
  const receivedPct   = p.agreed_budget > 0
    ? Math.min(100, Math.round((p.total_received / p.agreed_budget) * 100)) : 0;

  return (
    <Link to={`/projects/${p.id}`} style={{ textDecoration: 'none', display: 'block', color: 'inherit' }}>
      <div className="project-row-card">
        {/* Row 1: Title + status dot + date chips */}
        <div className="project-row-top">
          <span className="project-row-title">{p.title}</span>
          <Tip content={STATUS_LABEL[p.status] || p.status}>
            <StatusDot status={p.status} />
          </Tip>
          {shoot && <DateChip info={shoot} Icon={Camera} muted={shootMuted} title={`Shoot: ${fmtDate(p.shoot_date)}`} />}
          {dead  && <DateChip info={dead}  Icon={Flag}   muted={deadMuted}  title={`Deadline: ${fmtDate(p.deadline)}`} />}
        </div>

        {/* Row 2: Client · Category + margin */}
        <div className="project-row-meta">
          {p.client_name && <span>{p.client_name}</span>}
          {p.client_name && p.category_name && <span style={{ color: 'var(--color-hairline-strong)' }}>·</span>}
          {p.category_name && <span>{p.category_name}</span>}
          <span style={{ marginLeft: 'auto' }}><MarginBadge p={p} /></span>
        </div>

        {/* Row 3: Progress bars — the bars carry the proportion, no counters or figures. */}
        <div className="project-row-bars">
          {/* Phase progress: the bar shows the proportion, the label names the phase. */}
          <div>
            <div className="project-bar-label">
              <span>{p.current_phase || 'No active phase'}</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${phaseProgress}%` }} />
            </div>
          </div>

          {/* Budget received: the fill shows the proportion, the exact amounts on hover. */}
          {p.agreed_budget > 0 ? (
            <Tip
              className="project-bar-tip"
              content={<span><Private>{fmt(p.total_received)}</Private> / <Private>{fmt(p.agreed_budget)}</Private> received</span>}
            >
              <div className="mini-bar-track">
                <div className="mini-bar-fill mini-bar-received" style={{ width: `${receivedPct}%` }} />
              </div>
            </Tip>
          ) : (
            <div />
          )}
        </div>
      </div>
    </Link>
  );
}

/* ─── Project wizard wrapper ─── */
function ProjectWizardWithPrefill({ prefill, onClose, onCreated }) {
  if (!prefill) return <ProjectWizard onClose={onClose} onCreated={onCreated} />;
  return <ProjectWizard onClose={onClose} onCreated={onCreated} prefill={prefill} />;
}
