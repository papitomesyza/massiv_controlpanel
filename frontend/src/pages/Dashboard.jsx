import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, TrendingUp, DollarSign, AlertCircle, UserX,
  FolderCheck, BarChart2, Users as UsersIcon,
  X, CheckCircle, Lightbulb, LayoutGrid, GripHorizontal, Eye, EyeOff,
  Clock,
} from 'lucide-react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { api, fmt, fmtDate } from '../api';
import StatCard from '../components/StatCard';
import ProjectTimeline from '../components/ProjectTimeline';
import LeadsRail from '../components/LeadsRail';
import { Private, usePrivacy } from '../context/PrivacyContext';
import { convertLeadToProject } from '../lib/convertLead';
import { makeDeadlinePatcher } from '../lib/patchDeadline';

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const WIDGET_DEFS = [
  { id: 'stat_cards',      label: 'Revenue & KPI Stats',      cols: 12 },
  { id: 'active_projects', label: 'Active Projects',          cols: 12 },
  { id: 'pending_leads',   label: 'Pending Leads',            cols: 12 },
  { id: 'metric_cards',    label: 'Performance Metrics',      cols: 12 },
  { id: 'charts',          label: 'Revenue & Expense Trends', cols: 12 },
  { id: 'top_expenses',    label: 'Top Expense Categories',   cols: 12 },
];
const VALID_IDS = new Set(WIDGET_DEFS.map(w => w.id));

const DEFAULT_ORDER = ['stat_cards', 'active_projects', 'pending_leads', 'metric_cards', 'charts', 'top_expenses'];
const DEFAULT_LAYOUT = DEFAULT_ORDER.map((id, i) => ({ id, visible: true, position: i }));

function parseLayout(raw) {
  try {
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_LAYOUT;
    // Drop any widget id that no longer exists (e.g. the old active_expenses) so
    // a layout saved before this change never renders nothing or throws.
    const cleaned = parsed.filter(w => w && VALID_IDS.has(w.id));
    const existing = new Set(cleaned.map(w => w.id));
    const maxPos = cleaned.reduce((m, w) => Math.max(m, w.position), -1);
    const merged = [...cleaned];
    // Append any newly introduced widget ids that a saved layout is missing.
    let n = 0;
    WIDGET_DEFS.forEach(def => {
      if (!existing.has(def.id)) merged.push({ id: def.id, visible: true, position: maxPos + 1 + n++ });
    });
    return merged;
  } catch (_) {
    return DEFAULT_LAYOUT;
  }
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState(null);
  const currentMonth = getCurrentMonth();

  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [savedLayout, setSavedLayout] = useState(DEFAULT_LAYOUT);
  const [editMode, setEditMode] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [savingLayout, setSavingLayout] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/finances/stats?month=${currentMonth}`),
      api.get('/projects'),
      api.get('/finances/expenses'),
      api.get('/finances/chart?months=6'),
      api.get('/leads'),
      api.get('/settings/dashboard_layout'),
    ]).then(([s, p, e, ch, l, layoutRes]) => {
      setStats(s);
      setProjects(p.filter(x => x.status !== 'completed'));
      setExpenses(e.slice(0, 8));
      setChartData(ch);
      setLeads(l);
      const parsed = parseLayout(layoutRes?.value);
      setLayout(parsed);
      setSavedLayout(parsed);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const reloadProjects = useCallback(() => {
    return api.get('/projects').then(p => setProjects(p.filter(x => x.status !== 'completed')));
  }, []);

  const reload = useCallback(() => {
    reloadProjects();
    api.get(`/finances/stats?month=${currentMonth}`).then(s => setStats(s));
  }, [currentMonth, reloadProjects]);

  const reloadLeads = useCallback(() => {
    return api.get('/leads').then(setLeads);
  }, []);

  // Optimistic deadline drag through the one shared patch path (see
  // lib/patchDeadline), so the Dashboard and the Projects timeline save and
  // re-sync the calendar identically.
  const onPatchDeadline = useMemo(() => makeDeadlinePatcher(setProjects), []);

  function enterEditMode() { setEditMode(true); }
  function cancelEdit() { setLayout(savedLayout); setEditMode(false); }

  async function saveLayout() {
    setSavingLayout(true);
    try {
      await api.post('/settings', { key: 'dashboard_layout', value: JSON.stringify(layout) });
      setSavedLayout(layout);
      setEditMode(false);
    } catch (_) {}
    setSavingLayout(false);
  }

  function toggleVisibility(widgetId) {
    setLayout(prev => prev.map(w => w.id === widgetId ? { ...w, visible: !w.visible } : w));
  }

  function onDragStart(id) { setDragId(id); }
  function onDragOver(id) { if (id !== dragId) setDragOverId(id); }
  function onDragEnd() { setDragId(null); setDragOverId(null); }

  function onDrop(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    setLayout(prev => {
      const order = [...prev].sort((a, b) => a.position - b.position);
      const fromIdx = order.findIndex(w => w.id === dragId);
      const toIdx   = order.findIndex(w => w.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const reordered = [...order];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      return reordered.map((w, i) => ({ ...w, position: i }));
    });
    setDragId(null); setDragOverId(null);
  }

  if (loading) return <div className="loading">Loading...</div>;

  const sortedLayout = [...layout].sort((a, b) => a.position - b.position);

  function renderWidget(w) {
    const isDragging  = dragId    === w.id;
    const isDragOver  = dragOverId === w.id;
    const wrapStyle = {
      opacity: isDragging ? 0.4 : 1,
      borderTop: isDragOver && !isDragging ? '2px solid var(--accent)' : '2px solid transparent',
      transition: 'opacity 0.15s',
      position: 'relative',
    };

    if (!w.visible && editMode) {
      return (
        <div
          key={w.id}
          style={{ ...wrapStyle, marginBottom: '24px' }}
          draggable={editMode}
          onDragStart={() => onDragStart(w.id)}
          onDragOver={e => { e.preventDefault(); onDragOver(w.id); }}
          onDragLeave={() => setDragOverId(null)}
          onDragEnd={onDragEnd}
          onDrop={() => onDrop(w.id)}
        >
          <div style={{
            border: '1px dashed var(--color-hairline)', borderRadius: '24px',
            padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px',
            background: 'var(--overlay-02)',
          }}>
            <GripHorizontal size={16} style={{ color: 'var(--color-mid-gray)' }} />
            <span style={{ color: 'var(--color-mid-gray)', fontSize: '13px', flex: 1 }}>
              {WIDGET_DEFS.find(d => d.id === w.id)?.label}, hidden
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => toggleVisibility(w.id)} style={{ fontSize: '12px' }}>
              <EyeOff size={13} /> Show
            </button>
          </div>
        </div>
      );
    }

    if (!w.visible) return null;

    return (
      <div
        key={w.id}
        style={{ ...wrapStyle, marginBottom: '24px' }}
        draggable={editMode}
        onDragStart={() => onDragStart(w.id)}
        onDragOver={e => { e.preventDefault(); onDragOver(w.id); }}
        onDragLeave={() => setDragOverId(null)}
        onDragEnd={onDragEnd}
        onDrop={() => onDrop(w.id)}
      >
        {editMode && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 12px', marginBottom: '6px',
            background: 'var(--overlay-02)',
            border: '1px dashed var(--color-ink)',
            borderBottom: 'none',
            borderRadius: '10px 10px 0 0',
            cursor: 'grab',
          }}>
            <GripHorizontal size={16} style={{ color: 'var(--color-mid-gray)' }} />
            <span style={{ fontSize: '11px', color: 'var(--color-mid-gray)' }}>{WIDGET_DEFS.find(d => d.id === w.id)?.label}</span>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => toggleVisibility(w.id)}>
              <Eye size={12} /> Hide
            </button>
          </div>
        )}
        <div style={editMode ? { border: '1px dashed var(--color-ink)', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '12px 0' } : {}}>
          <WidgetContent
            id={w.id}
            stats={stats}
            projects={projects}
            expenses={expenses}
            chartData={chartData}
            leads={leads}
            setLeads={setLeads}
            reloadProjects={reloadProjects}
            reloadLeads={reloadLeads}
            onPatchDeadline={onPatchDeadline}
            setActiveModal={setActiveModal}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">{(() => {
              const d = new Date();
              const wd = d.toLocaleDateString('en-GB', { weekday: 'long' });
              const day = String(d.getDate()).padStart(2, '0');
              const month = String(d.getMonth() + 1).padStart(2, '0');
              return `${wd}, ${day}/${month}/${d.getFullYear()}`;
            })()}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {editMode ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={saveLayout} disabled={savingLayout}>
                <LayoutGrid size={13} /> {savingLayout ? 'Saving…' : 'Save Layout'}
              </button>
            </>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={enterEditMode} style={{ fontSize: '12px' }}>
              <LayoutGrid size={13} /> Edit Layout
            </button>
          )}
        </div>
      </div>

      {sortedLayout.map(w => renderWidget(w))}

      {activeModal && (
        <DashboardModal
          type={activeModal}
          month={currentMonth}
          projects={projects}
          onClose={() => setActiveModal(null)}
          onReload={reload}
        />
      )}
    </div>
  );
}

/* ─── Compact currency for axis ticks ─── */
function compactCurrency(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1000) return `€${(n / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `€${Math.round(n)}`;
}

/* ─── Custom recharts tooltip: three series, privacy aware ─── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const NAMES = { revenue: 'Revenue', expenses: 'Expenses', profit: 'Profit' };
  return (
    <div style={{
      background: 'var(--color-surface-alt)', border: '1px solid var(--color-hairline)',
      borderRadius: '10px', padding: '10px 14px', fontSize: '12px',
    }}>
      <div style={{ color: 'var(--color-mid-gray)', marginBottom: '6px' }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.stroke, display: 'inline-block' }} />
          <span style={{ color: 'var(--color-mid-gray)', minWidth: 60 }}>{NAMES[p.dataKey] || p.name}</span>
          <span style={{ color: 'var(--color-ink)', fontWeight: 600 }}><Private>{fmt(p.value)}</Private></span>
        </div>
      ))}
    </div>
  );
}

/* ─── Privacy aware Y axis tick ─── */
function PrivacyYTick({ x, y, payload }) {
  const { hidden } = usePrivacy();
  return (
    <text
      x={x} y={y} dy={3} textAnchor="end" fontSize={10} fill="var(--color-mid-gray)"
      style={{ filter: hidden ? 'blur(6px)' : 'none', transition: 'filter 0.25s ease' }}
    >
      {compactCurrency(payload.value)}
    </text>
  );
}

/* ─── Widget content ─── */
function WidgetContent({ id, stats, projects, expenses, chartData, leads, setLeads, reloadProjects, reloadLeads, onPatchDeadline, setActiveModal }) {
  switch (id) {

    case 'stat_cards':
      return (
        <div className="stats-grid">
          <StatCard
            label="Active Projects"
            value={projects.length}
            icon={<Activity size={16} />}
            iconTint="purple"
            onClick={() => setActiveModal('active-projects')}
          />
          <StatCard
            label="Revenue This Month"
            value={<Private>{fmt(stats?.revenue)}</Private>}
            icon={<TrendingUp size={16} />}
            onClick={() => setActiveModal('revenue')}
            emphasis
          />
          <StatCard
            label="Profit This Month"
            value={<Private>{fmt(stats?.netProfit)}</Private>}
            danger={stats?.netProfit < 0}
            icon={<DollarSign size={16} />}
            iconTint={stats?.netProfit < 0 ? 'danger' : 'purple'}
            onClick={() => setActiveModal('profit')}
          />
          <StatCard
            label="Pending Payments"
            value={<Private>{fmt(stats?.outstanding)}</Private>}
            danger={stats?.outstanding > 0}
            icon={<AlertCircle size={16} />}
            iconTint={stats?.outstanding > 0 ? 'danger' : 'success'}
            onClick={() => setActiveModal('outstanding')}
          />
          <StatCard
            label="Upcoming"
            value={<Private>{fmt(stats?.upcoming)}</Private>}
            icon={<Clock size={16} />}
            iconTint="blue"
            onClick={() => setActiveModal('upcoming')}
          />
          <StatCard
            label="Unpaid Crew"
            value={<Private>{fmt(stats?.unpaidCrew)}</Private>}
            danger={stats?.unpaidCrew > 0}
            icon={<UserX size={16} />}
            iconTint={stats?.unpaidCrew > 0 ? 'danger' : 'success'}
            onClick={() => setActiveModal('unpaid-crew')}
          />
        </div>
      );

    case 'metric_cards':
      return (
        <div className="stats-grid-3">
          <StatCard
            label="Completed This Month"
            value={stats?.completedThisMonth ?? 0}
            icon={<FolderCheck size={16} />}
            iconTint="success"
          />
          <StatCard
            label="Avg Project Value"
            value={<Private>{fmt(stats?.avgProjectValue)}</Private>}
            icon={<BarChart2 size={16} />}
            iconTint="purple"
          />
          <StatCard
            label="Crew Paid (Month)"
            value={<Private>{fmt(stats?.crewCosts)}</Private>}
            icon={<UsersIcon size={16} />}
            iconTint="orange"
          />
        </div>
      );

    case 'pending_leads':
      return (
        <DashLeadsBand
          leads={leads}
          setLeads={setLeads}
          reloadProjects={reloadProjects}
          reloadLeads={reloadLeads}
        />
      );

    case 'active_projects':
      return (
        <div>
          <div className="section-header">
            <span className="section-title">Active Projects</span>
            <Link to="/projects" className="btn btn-ghost btn-sm">View All</Link>
          </div>
          <div className="card card-pad">
            <ProjectTimeline projects={projects} onPatchDeadline={onPatchDeadline} />
          </div>
        </div>
      );

    case 'top_expenses':
      return (
        <div>
          <div className="section-header">
            <span className="section-title">Top Expense Categories</span>
          </div>
          {expenses.length === 0 ? (
            <div className="card card-pad empty">No expenses recorded</div>
          ) : (
            <div className="card card-pad">
              <ExpenseDonut expenses={expenses} />
            </div>
          )}
        </div>
      );

    case 'charts':
      return (
        <div className="card card-pad">
          <div className="trend-legend">
            <span className="trend-legend-item"><span className="trend-dot" style={{ background: 'var(--chart-revenue)' }} /> Revenue</span>
            <span className="trend-legend-item"><span className="trend-dot" style={{ background: 'var(--chart-expenses)' }} /> Expenses</span>
            <span className="trend-legend-item"><span className="trend-dot" style={{ background: 'var(--chart-profit)' }} /> Profit</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                {/* Revenue: the loudest series, a solid heavy stroke over a
                    subtle fill so the line stays dominant. */}
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--chart-revenue)" stopOpacity={0.20} />
                  <stop offset="95%" stopColor="var(--chart-revenue)" stopOpacity={0.02} />
                </linearGradient>
                {/* Expenses: quieter, a thin stroke over a barely there fill, so
                    it reads as a different weight even where it overlaps. */}
                <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--chart-expenses)" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="var(--chart-expenses)" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              {/* Soft solid gridlines instead of the old heavy dotted ones. */}
              <CartesianGrid vertical={false} stroke="var(--color-hairline)" strokeOpacity={0.45} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-mid-gray)' }} axisLine={false} tickLine={false} />
              <YAxis width={44} tick={<PrivacyYTick />} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              {/* Colour is the primary cue; the weight and fill differences and
                  the dashed profit line are secondary cues so the chart still
                  reads for anyone who cannot separate the hues. */}
              <Area type="monotone" dataKey="revenue" stroke="var(--chart-revenue)" strokeWidth={2.5} fill="url(#revGrad)" dot={false} />
              <Area type="monotone" dataKey="expenses" stroke="var(--chart-expenses)" strokeWidth={1.25} fill="url(#expGrad)" dot={false} />
              <Line type="monotone" dataKey="profit" stroke="var(--chart-profit)" strokeWidth={2} strokeDasharray="5 3" fill="none" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      );

    default:
      return null;
  }
}

/* ─── Leads band ─── */
// The band header and the direct convert path live here; the rail itself is the
// shared LeadsRail component, identical to the one on the Projects page.
function DashLeadsBand({ leads, setLeads, reloadProjects, reloadLeads }) {
  async function handleConvert(lead) {
    try {
      await convertLeadToProject(lead);
      setLeads(prev => prev.filter(l => l.id !== lead.id));
      await Promise.all([reloadProjects(), reloadLeads()]);
    } catch (_) {}
  }

  return (
    <div className="dash-leads-band">
      <div className="dash-leads-header">
        <div className="dash-leads-title">
          <Lightbulb size={14} />
          Pending Leads
          {leads.length > 0 && <span className="dash-leads-count">{leads.length}</span>}
        </div>
        <Link to="/projects" className="btn btn-ghost btn-sm" style={{ fontSize: '12px' }}>View All</Link>
      </div>

      <LeadsRail leads={leads} setLeads={setLeads} onConvert={handleConvert} />
    </div>
  );
}

/* ─── Expense donut ─── */
// The shared eight hue categorical palette (see index.css). Categories have no
// order, so a slice and its legend dot just take the next hue, cycling if there
// are ever more categories than hues.
const CATEGORICAL = Array.from({ length: 8 }, (_, i) => `var(--cat-${i + 1})`);
const catColor = i => CATEGORICAL[i % CATEGORICAL.length];

function ExpenseDonut({ expenses }) {
  const [active, setActive] = useState(null); // hovered arc / legend row index
  const total = expenses.reduce((s, e) => s + (Number(e.total) || 0), 0);

  return (
    <div className="donut-2col">
      <div className="donut-chart">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={expenses}
              dataKey="total"
              nameKey="name"
              innerRadius={68}
              outerRadius={100}
              paddingAngle={1.5}
              stroke="var(--surface-card)"
              strokeWidth={2}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {expenses.map((e, i) => (
                <Cell
                  key={i}
                  fill={catColor(i)}
                  fillOpacity={active === null || active === i ? 1 : 0.3}
                  style={{ transition: 'fill-opacity 0.15s ease' }}
                />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <span className="donut-center-label">Total</span>
          <span className="donut-center-value"><Private>{fmt(total)}</Private></span>
        </div>
      </div>
      <ul className="donut-legend">
        {expenses.map((e, i) => (
          <li
            key={i}
            className={`donut-legend-item${active === i ? ' active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="donut-dot" style={{ background: catColor(i) }} />
            <span className="donut-legend-name">{e.name}</span>
            {active === i && (
              <span className="donut-legend-amt"><Private>{fmt(e.total)}</Private></span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  return (
    <div style={{
      background: 'var(--color-surface-alt)', border: '1px solid var(--color-hairline)',
      borderRadius: '10px', padding: '8px 12px', fontSize: '12px',
    }}>
      <div style={{ color: 'var(--color-mid-gray)', marginBottom: '3px' }}>{row.name}</div>
      <div style={{ color: 'var(--color-ink)', fontWeight: 600 }}><Private>{fmt(row.value)}</Private></div>
    </div>
  );
}


/* ─── Dashboard detail modals ─── */
function DashboardModal({ type, month, projects, onClose, onReload }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (type === 'active-projects') { setData(projects); setLoading(false); return; }
    const endpointMap = {
      'revenue':     `/finances/details/revenue?month=${month}`,
      'profit':      `/finances/details/profit?month=${month}`,
      'outstanding': '/finances/details/outstanding',
      'upcoming':    '/finances/details/upcoming',
      'unpaid-crew': '/finances/details/unpaid-crew',
    };
    api.get(endpointMap[type]).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [type, month, projects]);

  async function markPaid(row) {
    await api.put(`/projects/${row.project_id}/crew/${row.id}`, {
      role_on_project: row.role_on_project,
      days: row.days,
      rate_per_day: row.rate_per_day,
      paid_status: 'paid',
      payment_date: new Date().toISOString().split('T')[0],
      payment_amount: row.total_cost,
      payment_method: row.payment_method || 'bank_transfer',
      payment_notes: row.payment_notes || '',
    });
    const updated = await api.get('/finances/details/unpaid-crew');
    setData(updated);
    onReload();
  }

  const titles = {
    'active-projects': 'Active Projects',
    'revenue':         'Revenue This Month',
    'profit':          'Profit This Month',
    'outstanding':     'Pending Payments',
    'upcoming':        'Upcoming, Future Shoots',
    'unpaid-crew':     'Unpaid Crew',
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: '680px' }}>
        <div className="modal-header">
          <span className="modal-title">{titles[type]}</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {loading ? <div className="loading">Loading…</div> : (
          <>
            {type === 'active-projects' && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Project</th><th>Client</th><th>Phase</th><th>Budget</th></tr></thead>
                  <tbody>
                    {data.map(p => (
                      <tr key={p.id}>
                        <td><Link to={`/projects/${p.id}`} className="link text-bold" onClick={onClose}>{p.title}</Link></td>
                        <td className="text-2 text-sm">{p.client_name || '-'}</td>
                        <td className="text-sm">{p.current_phase || '-'}</td>
                        <td><Private>{fmt(p.agreed_budget)}</Private></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length === 0 && <div className="empty">No active projects</div>}
              </div>
            )}

            {type === 'revenue' && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Project</th><th>Client</th><th>Amount</th><th>Date</th></tr></thead>
                  <tbody>
                    {data.map(row => (
                      <tr key={row.id}>
                        <td className="text-sm">{row.project_title}</td>
                        <td className="text-2 text-sm">{row.client_name || '-'}</td>
                        <td className="text-bold"><Private>{fmt(row.amount)}</Private></td>
                        <td className="text-2 text-sm">{fmtDate(row.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length === 0 && <div className="empty">No received payments this month</div>}
                {data.length > 0 && (
                  <div style={{ padding: '10px 12px', fontWeight: 700, borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                    Total: <Private>{fmt(data.reduce((s, r) => s + r.amount, 0))}</Private>
                  </div>
                )}
              </div>
            )}

            {type === 'profit' && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Project</th><th>Client</th><th>Revenue</th><th>Crew</th><th>Expenses</th><th>Profit</th></tr></thead>
                  <tbody>
                    {data.map(row => (
                      <tr key={row.id}>
                        <td className="text-sm">{row.title}</td>
                        <td className="text-2 text-sm">{row.client_name || '-'}</td>
                        <td><Private>{fmt(row.revenue)}</Private></td>
                        <td className="text-2"><Private>{fmt(row.crew_cost)}</Private></td>
                        <td className="text-2"><Private>{fmt(row.expenses)}</Private></td>
                        <td className={row.net_profit < 0 ? 'text-danger text-bold' : 'text-bold'}><Private>{fmt(row.net_profit ?? row.realized_profit)}</Private></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length === 0 && <div className="empty">No revenue data this month</div>}
              </div>
            )}

            {type === 'outstanding' && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Project</th><th>Client</th><th>Budget</th><th>Received</th><th>Outstanding</th></tr></thead>
                  <tbody>
                    {data.map(row => (
                      <tr key={row.id}>
                        <td><Link to={`/projects/${row.id}`} className="link text-bold" onClick={onClose}>{row.project_title}</Link></td>
                        <td className="text-2 text-sm">{row.client_name || '-'}</td>
                        <td className="text-sm"><Private>{fmt(row.agreed_budget)}</Private></td>
                        <td className="text-2 text-sm"><Private>{fmt(row.total_received)}</Private></td>
                        <td className="text-bold text-danger"><Private>{fmt(row.outstanding)}</Private></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length === 0 && <div className="empty">No pending payments</div>}
                {data.length > 0 && (
                  <div style={{ padding: '10px 12px', fontWeight: 700, borderTop: '1px solid var(--border)', textAlign: 'right', color: 'var(--danger)' }}>
                    Total Pending: <Private>{fmt(data.reduce((s, r) => s + r.outstanding, 0))}</Private>
                  </div>
                )}
              </div>
            )}

            {type === 'upcoming' && (
              <div className="table-wrap">
                <div style={{ padding: '8px 12px 4px', fontSize: '12px', color: 'var(--color-mid-gray)' }}>
                  Future shoots with an unpaid balance, not yet due.
                </div>
                <table>
                  <thead><tr><th>Project</th><th>Client</th><th>Budget</th><th>Received</th><th>Balance</th><th>Shoot Date</th></tr></thead>
                  <tbody>
                    {data.map(row => (
                      <tr key={row.id}>
                        <td><Link to={`/projects/${row.id}`} className="link text-bold" onClick={onClose}>{row.project_title}</Link></td>
                        <td className="text-2 text-sm">{row.client_name || '-'}</td>
                        <td className="text-sm"><Private>{fmt(row.agreed_budget)}</Private></td>
                        <td className="text-2 text-sm"><Private>{fmt(row.total_received)}</Private></td>
                        <td className="text-bold" style={{ color: 'var(--color-mid-gray)' }}><Private>{fmt(row.outstanding)}</Private></td>
                        <td className="text-sm">{fmtDate(row.shoot_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length === 0 && <div className="empty">No upcoming shoots with a balance</div>}
                {data.length > 0 && (
                  <div style={{ padding: '10px 12px', fontWeight: 700, borderTop: '1px solid var(--border)', textAlign: 'right', color: 'var(--color-mid-gray)' }}>
                    Total Expected: <Private>{fmt(data.reduce((s, r) => s + r.outstanding, 0))}</Private>
                  </div>
                )}
              </div>
            )}

            {type === 'unpaid-crew' && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Crew</th><th>Project</th><th>Role</th><th>Total</th><th>Paid</th><th>Remaining</th><th></th></tr></thead>
                  <tbody>
                    {data.map(row => (
                      <tr key={row.id}>
                        <td className="text-sm text-bold">{row.crew_name}</td>
                        <td className="text-2 text-sm">{row.project_title}</td>
                        <td className="text-2 text-sm">{row.role_on_project || '-'}</td>
                        <td><Private>{fmt(row.total_cost)}</Private></td>
                        <td className="text-2"><Private>{fmt(row.payment_amount)}</Private></td>
                        <td className="text-danger"><Private>{fmt(row.remaining)}</Private></td>
                        <td>
                          <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px' }} onClick={() => markPaid(row)}>
                            <CheckCircle size={12} /> Mark Paid
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length === 0 && <div className="empty">No unpaid crew assignments</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
