import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { TrendingUp, FolderCheck, BarChart2, Star, Users, AlertCircle, CheckCircle } from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import StatCard from '../components/StatCard';

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const PIE_COLORS = ['#FF902F', '#723CEB', '#4C11CE', '#a78bfa', '#FF4444', '#4CAF50'];

function ReceivablesSection({ receivables, onMarkReceived }) {
  const today = new Date();
  const daysPending = (dateStr) => {
    if (!dateStr) return 0;
    const d = new Date(dateStr + 'T00:00:00');
    return Math.max(0, Math.floor((today - d) / (1000 * 60 * 60 * 24)));
  };
  const dayColor = (days) => {
    if (days < 7) return '#888888';
    if (days <= 30) return '#FF902F';
    return '#FF4444';
  };
  const total = receivables.reduce((s, r) => s + r.amount, 0);

  return (
    <div style={{ marginTop: '32px' }}>
      <div className="section-header" style={{ marginBottom: '12px' }}>
        <span className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={15} style={{ color: '#FF902F' }} />
          Receivables — Pending Client Payments
        </span>
      </div>
      {receivables.length === 0 ? (
        <div className="card card-pad empty" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#4CAF50' }}>
          <CheckCircle size={15} /> No pending receivables
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Client</th><th>Project</th><th>Amount</th><th>Status</th><th>Days Pending</th><th></th></tr>
              </thead>
              <tbody>
                {receivables.map(row => {
                  const days = typeof row.days_pending === 'number' ? row.days_pending : daysPending(row.date);
                  return (
                    <tr key={row.id}>
                      <td className="text-bold text-sm">{row.client_name || '—'}</td>
                      <td className="text-2 text-sm">{row.project_title}</td>
                      <td style={{ color: '#FF902F', fontWeight: 700 }}>{fmt(row.amount)}</td>
                      <td><span className="badge badge-unpaid">pending</span></td>
                      <td style={{ color: dayColor(days), fontWeight: days > 7 ? 600 : 400, fontSize: '13px' }}>
                        {days}d
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '11px', color: '#4CAF50', borderRadius: '50px', border: '1px solid rgba(76,175,80,0.3)' }}
                          onClick={() => onMarkReceived(row)}
                        >
                          <CheckCircle size={11} /> Mark Received
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td colSpan={2} style={{ fontWeight: 700, paddingTop: '10px' }}>Total Receivables</td>
                  <td style={{ fontWeight: 700, color: '#FF902F', paddingTop: '10px' }}>{fmt(total)}</td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '12px', padding: '10px 14px', fontSize: '12px' }}>
        <div style={{ marginBottom: '4px', color: '#888' }}>{label}</div>
        {payload.map(p => (
          <div key={p.name} style={{ color: p.color }}>{p.name}: {fmt(p.value)}</div>
        ))}
      </div>
    );
  }
  return null;
};

export default function Finances() {
  const [month, setMonth] = useState(getCurrentMonth());
  const [stats, setStats] = useState(null);
  const [chart, setChart] = useState([]);
  const [catData, setCatData] = useState([]);
  const [clientData, setClientData] = useState([]);
  const [expData, setExpData] = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [allCategories, setAllCategories] = useState([]);
  const [allClients, setAllClients] = useState([]);
  const [filterCat, setFilterCat] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/finances/all-time-kpis'),
      api.get('/settings/project-categories'),
      api.get('/clients'),
    ]).then(([k, cats, clients]) => {
      setKpis(k);
      setAllCategories(cats);
      setAllClients(clients);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ month });
    if (filterCat) params.set('category_id', filterCat);
    if (filterClient) params.set('client_id', filterClient);
    Promise.all([
      api.get(`/finances/stats?${params}`),
      api.get('/finances/chart?months=6'),
      api.get('/finances/categories'),
      api.get('/finances/clients'),
      api.get('/finances/expenses'),
      api.get('/finances/receivables'),
    ]).then(([s, ch, ca, cl, ex, rec]) => {
      setStats(s); setChart(ch); setCatData(ca); setClientData(cl); setExpData(ex); setReceivables(rec);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [month, filterCat, filterClient]);

  const years = [];
  for (let y = new Date().getFullYear(); y >= 2020; y--) years.push(y);

  const [selYear, selMon] = month.split('-');

  const groupedCats = allCategories.reduce((acc, c) => {
    acc[c.group_name] = acc[c.group_name] || [];
    acc[c.group_name].push(c);
    return acc;
  }, {});

  return (
    <div>
      {/* All-Time Agency Performance */}
      {kpis && (
        <div style={{ marginBottom: '28px' }}>
          <div className="section-title" style={{ marginBottom: '14px' }}>All-Time Agency Performance</div>
          <div className="stats-grid">
            <StatCard label="Total Revenue Ever" value={fmt(kpis.totalRevenue)} icon={<TrendingUp size={18} />} />
            <StatCard label="Projects Completed" value={kpis.totalCompleted} icon={<FolderCheck size={18} />} />
            <StatCard label="Avg Project Value" value={fmt(kpis.avgProjectValue)} icon={<BarChart2 size={18} />} />
            <StatCard label="Best Month" value={kpis.bestMonth?.month || '—'} sub={kpis.bestMonth ? fmt(kpis.bestMonth.amount) : undefined} icon={<Star size={18} />} />
            <StatCard label="Best Client" value={kpis.bestClient?.name || '—'} sub={kpis.bestClient ? fmt(kpis.bestClient.amount) : undefined} icon={<Users size={18} />} />
          </div>
        </div>
      )}

      <div className="page-header" style={{ marginBottom: '16px' }}>
        <div>
          <div className="page-title">Finances</div>
          <div className="page-subtitle">Monthly overview</div>
        </div>
        <div className="flex-center gap-2" style={{ flexWrap: 'wrap' }}>
          <select className="select" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">All Categories</option>
            {Object.entries(groupedCats).map(([g, cats]) => (
              <optgroup key={g} label={g}>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
          <select className="select" value={filterClient} onChange={e => setFilterClient(e.target.value)}>
            <option value="">All Clients</option>
            {allClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" value={selYear} onChange={e => setMonth(`${e.target.value}-${selMon}`)}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="select" value={selMon} onChange={e => setMonth(`${selYear}-${e.target.value}`)}>
            {MONTHS.map(m => <option key={m} value={m}>{new Date(`2000-${m}-01`).toLocaleString('default', { month: 'long' })}</option>)}
          </select>
        </div>
      </div>

      {loading ? <div className="loading">Loading...</div> : (
        <>
          <div className="stats-grid">
            <StatCard label="Revenue" value={fmt(stats?.revenue)} />
            <StatCard label="Expenses" value={fmt(stats?.expenses)} danger={stats?.expenses > 0} />
            <StatCard label="Crew Costs" value={fmt(stats?.crewCosts)} />
            <StatCard label="Net Profit" value={fmt(stats?.netProfit)} danger={stats?.netProfit < 0} />
          </div>

          {/* Charts */}
          <div className="two-col" style={{ marginBottom: '24px' }}>
            <div className="card card-pad">
              <div className="section-title mb-3" style={{ marginBottom: '16px' }}>Revenue vs Expenses (Last 6 Months)</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chart} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#888' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#888' }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '12px', color: '#888' }} />
                  <Bar dataKey="revenue"   name="Revenue"  fill="#ffffff" radius={[4,4,0,0]} />
                  <Bar dataKey="expenses"  name="Expenses" fill="#723CEB" radius={[4,4,0,0]} />
                  <Bar dataKey="crewCosts" name="Crew"     fill="#FF902F" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card card-pad">
              <div className="section-title mb-3" style={{ marginBottom: '16px' }}>Revenue by Category</div>
              {catData.length === 0 ? (
                <div className="empty">No category data</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={catData} dataKey="total_revenue" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name.split('/')[0].trim()} ${Math.round(percent * 100)}%`} labelLine={false} fontSize={10}>
                      {catData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={v => fmt(v)} contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '12px', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Tables */}
          <div className="two-col" style={{ marginBottom: '24px' }}>
            <div>
              <div className="section-title mb-3" style={{ marginBottom: '12px' }}>Client Rankings</div>
              {clientData.length === 0 ? (
                <div className="card card-pad empty">No data</div>
              ) : (
                <div className="card">
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Client</th><th>Projects</th><th>Revenue</th><th>Margin</th></tr></thead>
                      <tbody>
                        {clientData.map((c, i) => (
                          <tr key={i}>
                            <td><div className="text-bold text-sm">{c.name}</div><div className="text-xs text-2">{c.company || ''}</div></td>
                            <td>{c.total_projects}</td>
                            <td>{fmt(c.total_revenue)}</td>
                            <td><span className={c.margin < 0 ? 'text-danger' : ''}>{c.margin}%</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="section-title mb-3" style={{ marginBottom: '12px' }}>Category Performance</div>
              {catData.length === 0 ? (
                <div className="card card-pad empty">No data</div>
              ) : (
                <div className="card">
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Category</th><th>Projects</th><th>Revenue</th><th>Margin</th></tr></thead>
                      <tbody>
                        {catData.map((c, i) => (
                          <tr key={i}>
                            <td><div className="text-sm">{c.name}</div><div className="text-xs text-2">{c.group_name}</div></td>
                            <td>{c.total_projects}</td>
                            <td>{fmt(c.total_revenue)}</td>
                            <td><span className={c.margin < 0 ? 'text-danger' : ''}>{c.margin}%</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="section-title mb-3" style={{ marginBottom: '12px' }}>Expenses by Category (All Time)</div>
            {expData.length === 0 ? (
              <div className="card card-pad empty">No expense data</div>
            ) : (
              <div className="card">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Category</th><th>Total</th></tr></thead>
                    <tbody>
                      {expData.map((e, i) => (
                        <tr key={i}>
                          <td>{e.name}</td>
                          <td className="text-bold">{fmt(e.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Receivables Section */}
          <ReceivablesSection receivables={receivables} onMarkReceived={async (row) => {
            await api.put(`/projects/${row.project_id}/payments/${row.id}`, {
              amount: row.amount,
              date: new Date().toISOString().split('T')[0],
              method: row.method,
              notes: row.notes || '',
              status: 'received',
            });
            const updated = await api.get('/finances/receivables');
            setReceivables(updated);
          }} />
        </>
      )}
    </div>
  );
}
