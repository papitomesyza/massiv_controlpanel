import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, List, GanttChart, Lightbulb, ChevronDown, ChevronUp, ArrowRight, X } from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import ProjectWizard from '../components/ProjectWizard';
import AddLeadModal from '../components/AddLeadModal';

const STATUSES = ['development','pre-production','production','post-production','completed'];

function getMargin(p) {
  if (!p.agreed_budget || p.agreed_budget <= 0) return null;
  return ((p.total_received - p.total_crew_cost - p.total_expenses) / p.agreed_budget) * 100;
}

function MarginBadge({ p }) {
  const margin = getMargin(p);
  if (margin === null) return <span className="text-2">—</span>;
  const cls = margin >= 30 ? 'badge-profit-high' : margin <= 0 ? 'badge-danger' : 'badge-profit-low';
  return <span className={`badge ${cls}`}>{Math.round(margin)}%</span>;
}

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [sort, setSort] = useState('newest');
  const [view, setView] = useState(() => localStorage.getItem('massiv_projects_view') || 'list');
  const [showWizard, setShowWizard] = useState(false);
  const [showAddLead, setShowAddLead] = useState(false);
  const [leadsOpen, setLeadsOpen] = useState(true);
  const [wizardPrefill, setWizardPrefill] = useState(null);
  const navigate = useNavigate();

  async function load() {
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    if (filterCat) params.set('category_id', filterCat);
    if (sort && sort !== 'newest') params.set('sort', sort);
    const [p, ca, l] = await Promise.all([
      api.get(`/projects?${params}`),
      api.get('/settings/project-categories'),
      api.get('/leads'),
    ]);
    setProjects(p);
    setCategories(ca);
    setLeads(l);
    setLeadsOpen(l.length > 0);
    setLoading(false);
  }

  useEffect(() => { load(); }, [filterStatus, filterCat, sort]);

  function switchView(v) {
    setView(v);
    localStorage.setItem('massiv_projects_view', v);
  }

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

  function handleLeadDismissed(id) {
    setLeads(prev => prev.filter(l => l.id !== id));
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

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Projects</div>
          <div className="page-subtitle">{projects.length} project{projects.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="flex-center gap-2">
          <div className="view-toggle">
            <button className={`view-toggle-btn${view === 'list' ? ' active' : ''}`} onClick={() => switchView('list')} title="List view"><List size={15} /></button>
            <button className={`view-toggle-btn${view === 'gantt' ? ' active' : ''}`} onClick={() => switchView('gantt')} title="Timeline view"><GanttChart size={15} /></button>
          </div>
          <button className="btn btn-ghost" onClick={() => setShowAddLead(true)}>
            <Lightbulb size={15} style={{ color: '#FF902F' }} /> Add Lead
          </button>
          <button className="btn btn-primary" onClick={() => { setWizardPrefill(null); setShowWizard(true); }}>
            <Plus size={15} /> New Project
          </button>
        </div>
      </div>

      {/* Leads section */}
      <div className="leads-section">
        <div className="leads-section-header" onClick={() => setLeadsOpen(o => !o)}>
          <div className="flex-center gap-2">
            <span className="leads-section-label">LEADS</span>
            <span className="leads-count-badge">{leads.length}</span>
          </div>
          {leadsOpen ? <ChevronUp size={14} color="#888" /> : <ChevronDown size={14} color="#888" />}
        </div>

        {leadsOpen && (
          <div>
            {leads.length === 0 ? (
              <div className="leads-empty">No active leads. Click "Add Lead" to track potential projects.</div>
            ) : (
              <div className="leads-scroll-row">
                {leads.map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onDismiss={handleLeadDismissed}
                    onConvert={handleConvertLead}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="filter-bar">
        <select className="select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/-/g,' ')}</option>)}
        </select>
        <select className="select" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">All Categories</option>
          {Object.entries(grouped).map(([g, cats]) => (
            <optgroup key={g} label={g}>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
        <select className="select" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="budget_high">Budget High → Low</option>
          <option value="budget_low">Budget Low → High</option>
          <option value="margin_high">Margin High → Low</option>
        </select>
      </div>

      {projects.length === 0 ? (
        <div className="card card-pad empty">No projects found</div>
      ) : view === 'gantt' ? (
        <GanttView projects={projects} />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Client</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Budget</th>
                  <th>Received</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id}>
                    <td><Link to={`/projects/${p.id}`} className="link text-bold">{p.title}</Link></td>
                    <td className="text-2">{p.client_name || '—'}</td>
                    <td className="text-2 text-sm">{p.category_name || '—'}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>{fmt(p.agreed_budget)}</td>
                    <td>{fmt(p.total_received)}</td>
                    <td><MarginBadge p={p} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

/* Wraps ProjectWizard and applies prefill data */
function ProjectWizardWithPrefill({ prefill, onClose, onCreated }) {
  if (!prefill) {
    return <ProjectWizard onClose={onClose} onCreated={onCreated} />;
  }
  return <ProjectWizard onClose={onClose} onCreated={onCreated} prefill={prefill} />;
}

/* Lead card */
function LeadCard({ lead, onDismiss, onConvert }) {
  const [confirming, setConfirming] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [visible, setVisible] = useState(true);

  async function dismiss() {
    setDismissing(true);
    try {
      await api.put(`/leads/${lead.id}/dismiss`, {});
      setVisible(false);
      setTimeout(() => onDismiss(lead.id), 220);
    } catch (_) { setDismissing(false); }
  }

  if (!visible) return <div className="lead-card lead-card-exit" />;

  return (
    <div className="lead-card lead-card-enter">
      <div className="lead-card-category">
        <Lightbulb size={11} style={{ color: '#FF902F', flexShrink: 0 }} />
        {lead.category_name || 'Uncategorized'}
      </div>
      <div className="lead-card-client">{lead.client_name || '—'}</div>
      {lead.note && <div className="lead-card-note">{lead.note}</div>}
      <div className="lead-card-footer">
        <span className="lead-card-date">{fmtDate(lead.contacted_at)}</span>
        {confirming ? (
          <div className="lead-card-confirm">
            <span className="lead-card-confirm-text">Dismiss?</span>
            <button className="btn btn-danger btn-sm" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={dismiss} disabled={dismissing}>
              Yes
            </button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={() => setConfirming(false)}>
              No
            </button>
          </div>
        ) : (
          <div className="flex-center gap-1">
            <button className="btn btn-primary btn-sm lead-btn-convert" onClick={() => onConvert(lead)}>
              <ArrowRight size={12} /> Convert
            </button>
            <button className="btn btn-ghost btn-sm lead-btn-dismiss" onClick={() => setConfirming(true)}>
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function GanttView({ projects }) {
  const withDates = projects.filter(p => p.shoot_date);
  if (withDates.length < 2) {
    return (
      <div className="card card-pad empty">
        Not enough data for timeline view. Set shoot dates on at least 2 projects to enable this view.
      </div>
    );
  }

  const allDates = projects.flatMap(p => [
    new Date(p.created_at),
    p.shoot_date ? new Date(p.shoot_date + 'T00:00:00') : new Date(),
  ]);
  const rawMin = new Date(Math.min(...allDates));
  const rawMax = new Date(Math.max(...allDates));

  const startDate = new Date(rawMin.getFullYear(), rawMin.getMonth(), 1);
  const endDate = new Date(rawMax.getFullYear(), rawMax.getMonth() + 2, 1);
  const totalMs = endDate - startDate;

  function posPercent(date) {
    return Math.max(0, Math.min(100, ((date - startDate) / totalMs) * 100));
  }

  const months = [];
  const d = new Date(startDate);
  while (d < endDate) {
    months.push({ label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), pos: posPercent(new Date(d)) });
    d.setMonth(d.getMonth() + 1);
  }

  const now = new Date();

  return (
    <div className="card card-pad gantt-wrap">
      <div style={{ position: 'relative', height: '22px', marginLeft: '180px', marginBottom: '8px' }}>
        {months.map((m, i) => (
          <div key={i} style={{ position: 'absolute', left: `${m.pos}%`, fontSize: '10px', color: '#888', whiteSpace: 'nowrap', transform: 'translateX(-50%)' }}>
            {m.label}
          </div>
        ))}
      </div>

      <div style={{ position: 'relative' }}>
        {months.map((m, i) => (
          <div key={i} style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `calc(180px + ${m.pos}% * (100% - 180px) / 100)`,
            width: '1px', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none',
          }} />
        ))}

        {projects.map(p => {
          const start = new Date(p.created_at);
          const end = p.shoot_date ? new Date(p.shoot_date + 'T00:00:00') : now;
          const isOverdue = p.shoot_date && end < now && p.status !== 'completed';
          const color = p.status === 'completed' ? '#333333' : isOverdue ? 'rgba(255,68,68,0.55)' : 'linear-gradient(135deg, #FF902F 0%, #723CEB 50%, #4C11CE 100%)';
          const opacity = p.status === 'completed' ? 0.5 : 0.9;
          const left = posPercent(start);
          const right = posPercent(end);
          const width = Math.max(0.5, right - left);

          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', height: '30px' }}>
              <div style={{ width: '180px', flexShrink: 0, paddingRight: '12px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '12px', color: '#ccc' }}>
                <Link to={`/projects/${p.id}`} className="link" style={{ color: 'inherit', fontSize: '12px' }}>{p.title}</Link>
              </div>
              <div style={{ flex: 1, position: 'relative', height: '20px' }}>
                <div
                  className="gantt-bar"
                  title={`${p.title} | ${p.client_name || 'No client'} | ${p.category_name || ''} | ${p.shoot_date ? fmtDate(p.shoot_date) : 'No shoot date'} | ${p.status}`}
                  style={{ left: `${left}%`, width: `${width}%`, background: color, opacity }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-center gap-2" style={{ marginTop: '16px', fontSize: '11px', color: '#888' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '12px', height: '8px', background: 'linear-gradient(90deg, #FF902F, #723CEB)', borderRadius: '2px', display: 'inline-block' }} /> Active</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '12px', height: '8px', background: '#333333', borderRadius: '2px', display: 'inline-block' }} /> Completed</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '12px', height: '8px', background: 'rgba(255,68,68,0.55)', borderRadius: '2px', display: 'inline-block' }} /> Overdue</span>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    'development':     'badge-development',
    'pre-production':  'badge-pre-production',
    'production':      'badge-production',
    'post-production': 'badge-post-production',
    'completed':       'badge-completed',
  };
  return <span className={`badge ${map[status] || 'badge-pending'}`}>{status?.replace(/-/g, ' ')}</span>;
}
