import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Activity, TrendingUp, DollarSign, AlertCircle, UserX, FolderCheck, BarChart2, Users as UsersIcon, X, CheckCircle, ArrowRight, Lightbulb, Clock, LayoutGrid, GripHorizontal, Eye, EyeOff } from 'lucide-react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api, fmt, fmtDate } from '../api';
import StatCard from '../components/StatCard';

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Widget definitions
const WIDGET_DEFS = [
  { id: 'stat_cards',    label: 'Revenue & KPI Stats',   cols: 12 },
  { id: 'metric_cards',  label: 'Performance Metrics',   cols: 12 },
  { id: 'active_expenses', label: 'Projects & Expenses', cols: 12 },
  { id: 'pending_leads', label: 'Pending Leads',         cols: 12 },
  { id: 'charts',        label: 'Revenue & Expense Trends', cols: 12 },
];

const DEFAULT_LAYOUT = WIDGET_DEFS.map((w, i) => ({ id: w.id, visible: true, position: i }));

function parseLayout(raw) {
  try {
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_LAYOUT;
    return parsed;
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

  // Layout state
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
      setExpenses(e.slice(0, 10));
      setChartData(ch);
      setLeads(l);
      const parsed = parseLayout(layoutRes?.value);
      setLayout(parsed);
      setSavedLayout(parsed);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const reload = useCallback(() => {
    api.get('/projects').then(p => setProjects(p.filter(x => x.status !== 'completed')));
    api.get(`/finances/stats?month=${currentMonth}`).then(s => setStats(s));
  }, [currentMonth]);

  function enterEditMode() { setEditMode(true); }

  function cancelEdit() {
    setLayout(savedLayout);
    setEditMode(false);
  }

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
      const toIdx = order.findIndex(w => w.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const reordered = [...order];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      return reordered.map((w, i) => ({ ...w, position: i }));
    });
    setDragId(null);
    setDragOverId(null);
  }

  if (loading) return <div className="loading">Loading...</div>;

  const sortedLayout = [...layout].sort((a, b) => a.position - b.position);

  function renderWidget(w) {
    const isDragging = dragId === w.id;
    const isDragOver = dragOverId === w.id;

    const wrapStyle = {
      opacity: isDragging ? 0.4 : 1,
      borderTop: isDragOver && !isDragging ? '2px solid #723CEB' : '2px solid transparent',
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
            border: '1px dashed rgba(114,60,235,0.3)',
            borderRadius: '16px',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            background: 'rgba(114,60,235,0.04)',
          }}>
            <GripHorizontal size={16} style={{ color: '#555' }} />
            <span style={{ color: '#555', fontSize: '13px', flex: 1 }}>
              {WIDGET_DEFS.find(d => d.id === w.id)?.label} — Hidden
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
            background: 'rgba(114,60,235,0.08)',
            border: '1px dashed rgba(114,60,235,0.4)',
            borderBottom: 'none',
            borderRadius: '12px 12px 0 0',
            cursor: 'grab',
          }}>
            <GripHorizontal size={16} style={{ color: '#666' }} />
            <span style={{ fontSize: '11px', color: '#666' }}>{WIDGET_DEFS.find(d => d.id === w.id)?.label}</span>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => toggleVisibility(w.id)}>
              <Eye size={12} /> Hide
            </button>
          </div>
        )}
        <div style={editMode ? { border: '1px dashed rgba(114,60,235,0.4)', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '12px 0' } : {}}>
          <WidgetContent id={w.id} stats={stats} projects={projects} expenses={expenses} chartData={chartData} leads={leads} setActiveModal={setActiveModal} currentMonth={currentMonth} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">{new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {editMode ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={cancelEdit} style={{ borderRadius: '50px' }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={saveLayout} disabled={savingLayout} style={{ borderRadius: '50px' }}>
                <LayoutGrid size={13} /> {savingLayout ? 'Saving...' : 'Save Layout'}
              </button>
            </>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={enterEditMode} style={{ borderRadius: '50px', fontSize: '12px' }}>
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

function WidgetContent({ id, stats, projects, expenses, chartData, leads, setActiveModal, currentMonth }) {
  switch (id) {
    case 'stat_cards':
      return (
        <div className="stats-grid">
          <StatCard label="Active Projects" value={projects.length} icon={<Activity size={16} />} onClick={() => setActiveModal('active-projects')} />
          <StatCard label="Revenue This Month" value={fmt(stats?.revenue)} icon={<TrendingUp size={16} />} onClick={() => setActiveModal('revenue')} gradient />
          <StatCard label="Profit This Month" value={fmt(stats?.netProfit)} danger={stats?.netProfit < 0} icon={<DollarSign size={16} />} onClick={() => setActiveModal('profit')} />
          <StatCard label="Outstanding Payments" value={fmt(stats?.outstanding)} danger={stats?.outstanding > 0} icon={<AlertCircle size={16} />} onClick={() => setActiveModal('outstanding')} />
          <StatCard label="Unpaid Crew" value={fmt(stats?.unpaidCrew)} danger={stats?.unpaidCrew > 0} icon={<UserX size={16} />} onClick={() => setActiveModal('unpaid-crew')} />
          <StatCard label="Awaiting Payment" value={fmt(stats?.outstanding)} warn={stats?.outstanding > 0} icon={<Clock size={16} />} onClick={() => setActiveModal('awaiting-payment')} />
        </div>
      );

    case 'metric_cards':
      return (
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <StatCard label="Completed This Month" value={stats?.completedThisMonth ?? 0} icon={<FolderCheck size={16} />} />
          <StatCard label="Avg Project Value" value={fmt(stats?.avgProjectValue)} icon={<BarChart2 size={16} />} />
          <StatCard label="Total Crew Spend (Month)" value={fmt(stats?.crewCosts)} icon={<UsersIcon size={16} />} />
        </div>
      );

    case 'active_expenses':
      return (
        <div className="two-col">
          <div>
            <div className="section-header">
              <span className="section-title">Active Projects</span>
              <Link to="/projects" className="btn btn-ghost btn-sm">View All</Link>
            </div>
            {projects.length === 0 && <div className="card card-pad empty">No active projects</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '520px', overflowY: 'auto', paddingRight: '4px' }}>
              {projects.map(p => {
                const progress = p.completed_phases / 4;
                return (
                  <Link key={p.id} to={`/projects/${p.id}`} style={{ textDecoration: 'none', flexShrink: 0 }}>
                    <div className="card card-pad-sm" style={{ cursor: 'pointer' }}>
                      <div className="flex-between mb-2">
                        <span style={{ fontWeight: 600, fontSize: '14px' }}>{p.title}</span>
                        <StatusBadge status={p.status} />
                      </div>
                      <div className="flex-between" style={{ marginBottom: '8px' }}>
                        <span className="text-2 text-sm">{p.client_name || 'No client'}</span>
                        <span className="text-2 text-xs">{p.category_name || '—'}</span>
                      </div>
                      <div className="text-xs text-2 mb-2">{p.current_phase || '—'}</div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                      </div>
                      <div className="flex-between mt-1">
                        <span className="text-xs text-2">{p.completed_phases}/4 phases</span>
                        <span className="text-xs text-2">{fmt(p.agreed_budget)}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
          <div>
            <div className="section-header">
              <span className="section-title">Top Expense Categories</span>
            </div>
            {expenses.length === 0 ? (
              <div className="card card-pad empty">No expenses recorded</div>
            ) : (
              <div className="card">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Category</th><th>Total</th></tr></thead>
                    <tbody>
                      {expenses.map((e, i) => (
                        <tr key={i}><td>{e.name}</td><td className="text-bold">{fmt(e.total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      );

    case 'pending_leads':
      if (!leads || leads.length === 0) return null;
      return (
        <div>
          <div className="section-header">
            <span className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Lightbulb size={15} style={{ color: '#FF902F' }} />
              Pending Leads
              <span style={{ background: '#FF902F', color: '#fff', fontSize: '10px', fontWeight: 700, borderRadius: '50px', padding: '2px 8px', lineHeight: 1.4 }}>{leads.length}</span>
            </span>
            <Link to="/projects" className="btn btn-ghost btn-sm">View All</Link>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table>
                <tbody>
                  {leads.slice(0, 5).map(lead => (
                    <tr key={lead.id}>
                      <td style={{ width: '8px', padding: '8px 0 8px 14px' }}>
                        <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#FF902F', flexShrink: 0 }} />
                      </td>
                      <td className="text-bold text-sm">{lead.client_name || '—'}</td>
                      <td className="text-2 text-sm">{lead.category_name || '—'}</td>
                      <td className="text-2 text-sm" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.note || ''}</td>
                      <td className="text-2 text-xs" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtDate(lead.contacted_at)}</td>
                      <td style={{ textAlign: 'right', paddingRight: '12px' }}>
                        <Link to="/projects" className="btn btn-ghost btn-sm" style={{ fontSize: '11px' }}>
                          <ArrowRight size={11} /> Convert
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leads.length > 5 && (
              <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: '12px', color: '#888' }}>
                <Link to="/projects" style={{ color: '#FF902F', textDecoration: 'none' }}>
                  View all {leads.length} leads →
                </Link>
              </div>
            )}
          </div>
        </div>
      );

    case 'charts':
      return (
        <div className="two-col">
          <div className="card card-pad">
            <div className="section-title" style={{ marginBottom: '12px' }}>Revenue Trend (6 months)</div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#723CEB" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#723CEB" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '12px', fontSize: '12px' }}
                  formatter={v => [fmt(v), 'Revenue']}
                  labelStyle={{ color: '#888' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#723CEB" strokeWidth={2} fill="url(#revGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="card card-pad">
            <div className="section-title" style={{ marginBottom: '12px' }}>Expenses Trend (6 months)</div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF902F" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#FF902F" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '12px', fontSize: '12px' }}
                  formatter={v => [fmt(v), 'Expenses']}
                  labelStyle={{ color: '#888' }}
                />
                <Area type="monotone" dataKey="expenses" stroke="#FF902F" strokeWidth={2} fill="url(#expGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      );

    default:
      return null;
  }
}

function DashboardModal({ type, month, projects, onClose, onReload }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (type === 'active-projects') { setData(projects); setLoading(false); return; }
    const endpointMap = {
      'revenue': `/finances/details/revenue?month=${month}`,
      'profit': `/finances/details/profit?month=${month}`,
      'outstanding': '/finances/details/outstanding',
      'unpaid-crew': '/finances/details/unpaid-crew',
      'awaiting-payment': '/finances/details/outstanding',
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

  async function markReceived(row) {
    await api.put(`/projects/${row.project_id}/payments/${row.id}`, {
      amount: row.amount,
      date: new Date().toISOString().split('T')[0],
      method: row.method,
      notes: row.notes || '',
      status: 'received',
    });
    const updated = await api.get('/finances/details/outstanding');
    setData(updated);
    onReload();
  }

  const titles = {
    'active-projects': 'Active Projects',
    'revenue': 'Revenue This Month',
    'profit': 'Profit This Month',
    'outstanding': 'Outstanding Payments',
    'unpaid-crew': 'Unpaid Crew',
    'awaiting-payment': 'Awaiting Payment',
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: '680px' }}>
        <div className="modal-header">
          <span className="modal-title">{titles[type]}</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <>
            {type === 'active-projects' && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Project</th><th>Client</th><th>Phase</th><th>Budget</th></tr></thead>
                  <tbody>
                    {data.map(p => (
                      <tr key={p.id}>
                        <td><Link to={`/projects/${p.id}`} className="link text-bold" onClick={onClose}>{p.title}</Link></td>
                        <td className="text-2 text-sm">{p.client_name || '—'}</td>
                        <td className="text-sm">{p.current_phase || '—'}</td>
                        <td>{fmt(p.agreed_budget)}</td>
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
                        <td className="text-2 text-sm">{row.client_name || '—'}</td>
                        <td className="text-bold">{fmt(row.amount)}</td>
                        <td className="text-2 text-sm">{fmtDate(row.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length === 0 && <div className="empty">No received payments this month</div>}
                {data.length > 0 && (
                  <div style={{ padding: '10px 12px', fontWeight: 700, borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                    Total: {fmt(data.reduce((s, r) => s + r.amount, 0))}
                  </div>
                )}
              </div>
            )}

            {type === 'profit' && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Project</th><th>Client</th><th>Revenue</th><th>Crew</th><th>Expenses</th><th>Net Profit</th></tr></thead>
                  <tbody>
                    {data.map(row => (
                      <tr key={row.id}>
                        <td className="text-sm">{row.title}</td>
                        <td className="text-2 text-sm">{row.client_name || '—'}</td>
                        <td>{fmt(row.revenue)}</td>
                        <td className="text-2">{fmt(row.crew_cost)}</td>
                        <td className="text-2">{fmt(row.expenses)}</td>
                        <td className={row.net_profit < 0 ? 'text-danger text-bold' : 'text-bold'}>{fmt(row.net_profit)}</td>
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
                  <thead><tr><th>Client</th><th>Project</th><th>Amount</th><th>Date</th></tr></thead>
                  <tbody>
                    {data.map(row => (
                      <tr key={row.id}>
                        <td className="text-sm">{row.client_name || '—'}</td>
                        <td className="text-2 text-sm">{row.project_title}</td>
                        <td className="text-bold text-danger">{fmt(row.amount)}</td>
                        <td className="text-2 text-sm">{fmtDate(row.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length === 0 && <div className="empty">No outstanding payments</div>}
                {data.length > 0 && (
                  <div style={{ padding: '10px 12px', fontWeight: 700, borderTop: '1px solid var(--border)', textAlign: 'right', color: 'var(--danger)' }}>
                    Total Outstanding: {fmt(data.reduce((s, r) => s + r.amount, 0))}
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
                        <td className="text-2 text-sm">{row.role_on_project || '—'}</td>
                        <td>{fmt(row.total_cost)}</td>
                        <td className="text-2">{fmt(row.payment_amount)}</td>
                        <td className="text-danger">{fmt(row.remaining)}</td>
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

            {type === 'awaiting-payment' && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Client</th><th>Project</th><th>Amount</th><th>Method</th><th></th></tr></thead>
                  <tbody>
                    {data.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px' }}>
                        <div className="flex-center gap-2" style={{ justifyContent: 'center', color: '#4CAF50' }}>
                          <CheckCircle size={16} /> All payments received
                        </div>
                      </td></tr>
                    ) : data.map(row => (
                      <tr key={row.id}>
                        <td className="text-sm text-bold">{row.client_name || '—'}</td>
                        <td className="text-2 text-sm">{row.project_title}</td>
                        <td style={{ color: '#FF902F', fontWeight: 700 }}>{fmt(row.amount)}</td>
                        <td className="text-2 text-sm">{(row.method || '').replace('_', ' ') || '—'}</td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: '11px', color: '#4CAF50', borderRadius: '50px', border: '1px solid rgba(76,175,80,0.3)' }}
                            onClick={() => markReceived(row)}
                          >
                            <CheckCircle size={11} /> Mark Received
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length > 0 && (
                  <div style={{ padding: '10px 12px', fontWeight: 700, borderTop: '1px solid var(--border)', textAlign: 'right', color: '#FF902F' }}>
                    Total: {fmt(data.reduce((s, r) => s + r.amount, 0))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
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
