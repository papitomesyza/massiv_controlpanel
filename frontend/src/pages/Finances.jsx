import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, FolderCheck, BarChart2, Star, Users, AlertCircle,
  CheckCircle, Download, FileText, Clock, Receipt,
} from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import StatCard from '../components/StatCard';

const MONTHS_LIST = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const PIE_COLORS = ['#FF902F', '#723CEB', '#4C11CE', '#a78bfa', '#FF4444', '#4CAF50', '#00BCD4', '#E91E63'];
const BUCKET_META = {
  current:  { label: 'Current (0–30d)',  color: '#4CAF50', bg: 'rgba(76,175,80,0.10)' },
  '31-60':  { label: '31–60 Days',       color: '#FF902F', bg: 'rgba(255,144,47,0.10)' },
  '61-90':  { label: '61–90 Days',       color: '#FF6B2B', bg: 'rgba(255,107,43,0.10)' },
  '90+':    { label: '90+ Days',         color: '#FF4444', bg: 'rgba(255,68,68,0.10)' },
};

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getYears() {
  const y = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, i) => y - i);
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '12px', padding: '10px 14px', fontSize: '12px' }}>
      <div style={{ marginBottom: '4px', color: '#888' }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color }}>{p.name}: {fmt(p.value)}</div>
      ))}
    </div>
  );
};

/* ───────────────────────── OVERVIEW TAB ───────────────────────── */

function OverviewTab({ month, setMonth, filterCat, setFilterCat, filterClient, setFilterClient, allCategories, allClients }) {
  const [stats, setStats] = useState(null);
  const [chart, setChart] = useState([]);
  const [catData, setCatData] = useState([]);
  const [clientData, setClientData] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/finances/all-time-kpis').then(k => setKpis(k)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ month });
    if (filterCat) p.set('category_id', filterCat);
    if (filterClient) p.set('client_id', filterClient);
    Promise.all([
      api.get(`/finances/stats?${p}`),
      api.get('/finances/chart?months=6'),
      api.get('/finances/categories'),
      api.get('/finances/clients'),
    ]).then(([s, ch, ca, cl]) => {
      setStats(s); setChart(ch); setCatData(ca); setClientData(cl);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [month, filterCat, filterClient]);

  const years = getYears();
  const [selYear, selMon] = month.split('-');
  const groupedCats = allCategories.reduce((acc, c) => {
    acc[c.group_name] = acc[c.group_name] || [];
    acc[c.group_name].push(c);
    return acc;
  }, {});

  return (
    <div>
      {/* Period + filter controls */}
      <div className="filter-bar" style={{ marginBottom: '20px' }}>
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
          {MONTHS_LIST.map(m => <option key={m} value={m}>{new Date(`2000-${m}-01`).toLocaleString('default', { month: 'long' })}</option>)}
        </select>
      </div>

      {/* All-time KPIs */}
      {kpis && (
        <div style={{ marginBottom: '24px' }}>
          <div className="section-title" style={{ marginBottom: '12px' }}>All-Time Performance</div>
          <div className="stats-grid">
            <StatCard label="Total Revenue Ever" value={fmt(kpis.totalRevenue)} icon={<TrendingUp size={18} />} />
            <StatCard label="Projects Completed" value={kpis.totalCompleted} icon={<FolderCheck size={18} />} />
            <StatCard label="Avg Completed Project" value={fmt(kpis.avgProjectValue)} icon={<BarChart2 size={18} />} />
            <StatCard label="Best Month" value={kpis.bestMonth?.month || '—'} sub={kpis.bestMonth ? fmt(kpis.bestMonth.amount) : undefined} icon={<Star size={18} />} />
            <StatCard label="Best Client" value={kpis.bestClient?.name || '—'} sub={kpis.bestClient ? fmt(kpis.bestClient.amount) : undefined} icon={<Users size={18} />} />
          </div>
        </div>
      )}

      {loading ? <div className="loading">Loading...</div> : (
        <>
          {/* Period KPI cards */}
          <div style={{ marginBottom: '20px' }}>
            <div className="section-title" style={{ marginBottom: '12px' }}>
              {`${month.slice(5)}/${month.slice(0, 4)}`}
            </div>
            <div className="stats-grid">
              <StatCard label="Realized Revenue" value={fmt(stats?.revenue)} icon={<TrendingUp size={18} />} gradient />
              <StatCard label="Expenses" value={fmt(stats?.expenses)} icon={<Receipt size={18} />} danger={stats?.expenses > 0} />
              <StatCard label="Crew Costs" value={fmt(stats?.crewCosts)} icon={<Users size={18} />} />
              <StatCard label="Net Profit" value={fmt(stats?.netProfit)} icon={<BarChart2 size={18} />} danger={stats?.netProfit < 0} />
            </div>
          </div>

          {/* Charts */}
          <div className="two-col" style={{ marginBottom: '24px' }}>
            <div className="card card-pad">
              <div className="section-title" style={{ marginBottom: '16px' }}>Revenue vs Expenses (Last 6 Months)</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chart} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#888' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#888' }} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '12px', color: '#888' }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#ffffff" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#723CEB" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="crewCosts" name="Crew" fill="#FF902F" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card card-pad">
              <div className="section-title" style={{ marginBottom: '16px' }}>Revenue by Category</div>
              {catData.length === 0 ? (
                <div className="empty">No category data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={catData} dataKey="total_revenue" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                      label={({ name, percent }) => `${name.split('/')[0].trim()} ${Math.round(percent * 100)}%`}
                      labelLine={false} fontSize={10}>
                      {catData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={v => fmt(v)} contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '12px', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Rankings tables */}
          <div className="two-col">
            <div>
              <div className="section-title" style={{ marginBottom: '12px' }}>Client Rankings</div>
              {clientData.length === 0 ? (
                <div className="card card-pad empty">No client data yet</div>
              ) : (
                <div className="card">
                  <div className="table-wrap table-responsive">
                    <table>
                      <thead><tr><th>Client</th><th>Projects</th><th>Revenue</th><th>Margin</th></tr></thead>
                      <tbody>
                        {clientData.map((c, i) => (
                          <tr key={i}>
                            <td data-label="Client"><div className="text-bold text-sm">{c.name}</div><div className="text-xs text-2">{c.company || ''}</div></td>
                            <td data-label="Projects">{c.total_projects}</td>
                            <td data-label="Revenue">{fmt(c.total_revenue)}</td>
                            <td data-label="Margin"><span className={c.margin < 0 ? 'text-danger' : ''}>{c.margin}%</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div>
              <div className="section-title" style={{ marginBottom: '12px' }}>Category Performance</div>
              {catData.length === 0 ? (
                <div className="card card-pad empty">No category data yet</div>
              ) : (
                <div className="card">
                  <div className="table-wrap table-responsive">
                    <table>
                      <thead><tr><th>Category</th><th>Projects</th><th>Revenue</th><th>Margin</th></tr></thead>
                      <tbody>
                        {catData.map((c, i) => (
                          <tr key={i}>
                            <td data-label="Category"><div className="text-sm">{c.name}</div><div className="text-xs text-2">{c.group_name}</div></td>
                            <td data-label="Projects">{c.total_projects}</td>
                            <td data-label="Revenue">{fmt(c.total_revenue)}</td>
                            <td data-label="Margin"><span className={c.margin < 0 ? 'text-danger' : ''}>{c.margin}%</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────── PROFIT & LOSS TAB ─────────────────────── */

function PLTab() {
  const years = getYears();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [viewMode, setViewMode] = useState('year'); // 'year' | 'month'
  const [selMonth, setSelMonth] = useState(getCurrentMonth());
  const [plData, setPlData] = useState(null);
  const [monthStats, setMonthStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/finances/pl?year=${year}`).then(d => { setPlData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [year]);

  useEffect(() => {
    if (viewMode === 'month') {
      api.get(`/finances/stats?month=${selMonth}`).then(s => setMonthStats(s)).catch(() => {});
    }
  }, [viewMode, selMonth]);

  async function exportPDF() {
    setPdfLoading(true);
    try { await api.download(`/finances/pl-pdf?year=${year}`, `${year}-Profit-Loss.pdf`); } catch (_) {}
    setPdfLoading(false);
  }

  const statement = viewMode === 'year'
    ? (plData?.totals || null)
    : (monthStats ? { revenue: monthStats.revenue, expenses: monthStats.expenses, crewCosts: monthStats.crewCosts, netProfit: monthStats.netProfit } : null);

  const periodLabel = viewMode === 'year'
    ? `Full Year ${year}`
    : `${selMonth.slice(5)}/${selMonth.slice(0, 4)}`;

  const grossProfit = statement ? statement.revenue - statement.crewCosts - statement.expenses : 0;

  const [selYr, selMo] = selMonth.split('-');

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <select className="select" value={year} onChange={e => setYear(e.target.value)}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="flex-center gap-1">
          <button
            className={`btn btn-sm ${viewMode === 'year' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '50px', padding: '5px 16px' }}
            onClick={() => setViewMode('year')}
          >Full Year</button>
          <button
            className={`btn btn-sm ${viewMode === 'month' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '50px', padding: '5px 16px' }}
            onClick={() => setViewMode('month')}
          >Month</button>
        </div>
        {viewMode === 'month' && (
          <>
            <select className="select" value={selYr} onChange={e => setSelMonth(`${e.target.value}-${selMo}`)}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="select" value={selMo} onChange={e => setSelMonth(`${selYr}-${e.target.value}`)}>
              {MONTHS_LIST.map(m => <option key={m} value={m}>{new Date(`2000-${m}-01`).toLocaleString('default', { month: 'long' })}</option>)}
            </select>
          </>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportPDF} disabled={pdfLoading} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Download size={14} /> {pdfLoading ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>

      {loading ? <div className="loading">Loading…</div> : (
        <div className="two-col" style={{ alignItems: 'flex-start' }}>
          {/* P&L Statement */}
          <div>
            <div className="section-title" style={{ marginBottom: '12px' }}>Statement — {periodLabel}</div>
            {!statement ? (
              <div className="card card-pad empty">No data for this period</div>
            ) : (
              <div className="card card-pad">
                {/* Revenue */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 600, fontSize: '15px' }}>Revenue</span>
                  <span style={{ fontWeight: 700, fontSize: '15px' }}>{fmt(statement.revenue)}</span>
                </div>

                {/* Cost of Services */}
                <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>Cost of Services</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 4px 16px', fontSize: '13px' }}>
                    <span style={{ color: '#aaa' }}>Crew Costs</span>
                    <span>{fmt(statement.crewCosts)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 4px 16px', fontSize: '13px' }}>
                    <span style={{ color: '#aaa' }}>Expenses</span>
                    <span>{fmt(statement.expenses)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: '6px', borderTop: '1px solid var(--border)', fontWeight: 600, fontSize: '13px' }}>
                    <span>Total Cost of Services</span>
                    <span>{fmt(statement.crewCosts + statement.expenses)}</span>
                  </div>
                </div>

                {/* Gross Profit */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '2px solid var(--border)' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>Gross Profit</span>
                  <span style={{ fontWeight: 700, fontSize: '14px', color: grossProfit < 0 ? '#FF4444' : '#4CAF50' }}>{fmt(grossProfit)}</span>
                </div>

                {/* Net Profit */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 20px', margin: '12px -24px -24px',
                  background: statement.netProfit < 0 ? 'rgba(255,68,68,0.06)' : 'rgba(76,175,80,0.06)',
                  borderTop: '2px solid ' + (statement.netProfit < 0 ? 'rgba(255,68,68,0.2)' : 'rgba(76,175,80,0.2)'),
                  borderRadius: '0 0 16px 16px',
                }}>
                  <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '0.02em' }}>NET PROFIT</span>
                  <span style={{ fontWeight: 800, fontSize: '18px', color: statement.netProfit < 0 ? '#FF4444' : '#4CAF50' }}>{fmt(statement.netProfit)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Monthly breakdown */}
          <div>
            <div className="section-title" style={{ marginBottom: '12px' }}>Monthly Breakdown — {year}</div>
            {!plData ? (
              <div className="card card-pad empty">No data</div>
            ) : (
              <div className="card">
                <div className="table-wrap table-responsive">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th style={{ textAlign: 'right' }}>Revenue</th>
                        <th style={{ textAlign: 'right' }}>Crew</th>
                        <th style={{ textAlign: 'right' }}>Expenses</th>
                        <th style={{ textAlign: 'right' }}>Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plData.months.map(m => {
                        const isEmpty = m.revenue === 0 && m.expenses === 0 && m.crewCosts === 0;
                        const isSelected = viewMode === 'month' && m.month === selMonth;
                        return (
                          <tr key={m.month} style={isSelected ? { background: 'rgba(114,60,235,0.10)' } : {}}>
                            <td data-label="Month" style={{ color: isEmpty ? '#444' : '#fff', fontWeight: isSelected ? 700 : 400 }}>{m.label}</td>
                            <td data-label="Revenue" style={{ textAlign: 'right', color: isEmpty ? '#444' : '#fff' }}>{isEmpty ? '—' : fmt(m.revenue)}</td>
                            <td data-label="Crew" style={{ textAlign: 'right', color: isEmpty ? '#444' : '#aaa' }}>{isEmpty ? '—' : fmt(m.crewCosts)}</td>
                            <td data-label="Expenses" style={{ textAlign: 'right', color: isEmpty ? '#444' : '#aaa' }}>{isEmpty ? '—' : fmt(m.expenses)}</td>
                            <td data-label="Net" style={{ textAlign: 'right', fontWeight: 600, color: isEmpty ? '#444' : m.netProfit < 0 ? '#FF4444' : '#4CAF50' }}>
                              {isEmpty ? '—' : fmt(m.netProfit)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                        <td data-label="Month">TOTAL</td>
                        <td data-label="Revenue" style={{ textAlign: 'right' }}>{fmt(plData.totals.revenue)}</td>
                        <td data-label="Crew" style={{ textAlign: 'right', color: '#aaa' }}>{fmt(plData.totals.crewCosts)}</td>
                        <td data-label="Expenses" style={{ textAlign: 'right', color: '#aaa' }}>{fmt(plData.totals.expenses)}</td>
                        <td data-label="Net" style={{ textAlign: 'right', fontWeight: 700, color: plData.totals.netProfit < 0 ? '#FF4444' : '#4CAF50' }}>{fmt(plData.totals.netProfit)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── RECEIVABLES TAB ─────────────────────── */

function ReceivablesTab() {
  const years = getYears();
  const [arData, setArData] = useState(null);
  const [taxRecords, setTaxRecords] = useState([]);
  const [taxSettings, setTaxSettings] = useState(null);
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(true);

  const loadAR = useCallback(async () => {
    const ar = await api.get('/finances/ar-aging');
    setArData(ar);
  }, []);

  const loadTax = useCallback(async () => {
    const [tax, sett] = await Promise.all([
      api.get(`/finances/tax-records?year=${taxYear}`),
      api.get('/settings/tax'),
    ]);
    setTaxRecords(tax);
    setTaxSettings(sett);
  }, [taxYear]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAR(), loadTax()]).then(() => setLoading(false)).catch(() => setLoading(false));
  }, [loadAR, loadTax]);

  async function markReceived(row) {
    await api.put(`/projects/${row.project_id}/payments/${row.id}`, {
      amount: row.amount,
      date: new Date().toISOString().split('T')[0],
      method: row.method || 'bank_transfer',
      notes: row.notes || '',
      status: 'received',
    });
    await loadAR();
  }

  async function markTaxPaid(id) {
    await api.patch(`/finances/tax-records/${id}/paid`, {});
    await loadTax();
  }

  async function markTaxUnpaid(id) {
    await api.patch(`/finances/tax-records/${id}/unpaid`, {});
    await loadTax();
  }

  const taxOwed = taxRecords.filter(r => r.tax_status === 'unpaid').reduce((s, r) => s + (r.tax_amount || 0), 0);
  const taxPaid = taxRecords.filter(r => r.tax_status === 'paid').reduce((s, r) => s + (r.tax_amount || 0), 0);
  const taxLabel = taxSettings?.tax_label || 'Tax';

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div>
      {/* ── A/R Aging Section ── */}
      <div style={{ marginBottom: '32px' }}>
        <div className="section-title" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={15} style={{ color: '#FF902F' }} />
          Accounts Receivable Aging
        </div>

        {/* Bucket summary cards */}
        <div className="ar-buckets-grid">
          {Object.entries(BUCKET_META).map(([key, meta]) => (
            <div key={key} className="card card-pad" style={{ borderTop: `3px solid ${meta.color}`, textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>{meta.label}</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: meta.color }}>{fmt(arData?.buckets[key] || 0)}</div>
            </div>
          ))}
        </div>

        {/* Total band */}
        {arData?.total > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,144,47,0.06)', border: '1px solid rgba(255,144,47,0.15)', borderRadius: '12px', padding: '12px 20px', marginBottom: '16px' }}>
            <span style={{ color: '#888', fontSize: '13px' }}>Total Outstanding</span>
            <span style={{ fontWeight: 700, fontSize: '18px', color: '#FF902F' }}>{fmt(arData.total)}</span>
          </div>
        )}

        {/* AR table */}
        {!arData?.rows?.length ? (
          <div className="card card-pad empty" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#4CAF50' }}>
            <CheckCircle size={15} /> No outstanding receivables
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Project</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th style={{ textAlign: 'right' }}>Days</th>
                    <th>Bucket</th>
                    <th>Type</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {arData.rows.map((row, i) => {
                    const meta = BUCKET_META[row.bucket];
                    return (
                      <tr key={i}>
                        <td data-label="Client" className="text-bold text-sm">{row.client_name || '—'}</td>
                        <td data-label="Project" className="text-sm text-2">{row.project_title}</td>
                        <td data-label="Amount" style={{ textAlign: 'right', fontWeight: 700, color: '#FF902F' }}>{fmt(row.amount)}</td>
                        <td data-label="Days" style={{ textAlign: 'right', fontWeight: 600, color: meta.color, fontSize: '13px' }}>{row.days_aged}d</td>
                        <td data-label="Bucket">
                          <span style={{ fontSize: '11px', fontWeight: 600, color: meta.color, background: meta.bg, borderRadius: '6px', padding: '2px 8px' }}>
                            {meta.label}
                          </span>
                        </td>
                        <td data-label="Type" className="text-xs text-2">{row.source === 'payment' ? 'Payment' : 'Balance'}</td>
                        <td className="mobile-actions">
                          {row.source === 'payment' ? (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: '11px', color: '#4CAF50', borderRadius: '50px', border: '1px solid rgba(76,175,80,0.3)' }}
                              onClick={() => markReceived(row)}
                            >
                              <CheckCircle size={11} /> Mark Received
                            </button>
                          ) : (
                            <span className="text-xs text-2">Add payment in project</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Tax Section ── */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={15} style={{ color: '#723CEB' }} />
            {taxLabel} Obligations
          </div>
          <div className="flex-center gap-2">
            <span style={{ fontSize: '12px', color: '#888' }}>Year:</span>
            <select className="select" value={taxYear} onChange={e => setTaxYear(e.target.value)}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {taxSettings && !taxSettings.tax_enabled ? (
          <div className="card card-pad empty">Tax tracking is disabled. Enable it in Settings.</div>
        ) : taxRecords.length === 0 ? (
          <div className="card card-pad" style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(114,60,235,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Receipt size={22} style={{ color: '#723CEB' }} />
            </div>
            <div style={{ fontWeight: 600, marginBottom: '6px' }}>No {taxLabel} records for {taxYear}</div>
            <div style={{ fontSize: '12px', color: '#666', maxWidth: '340px', margin: '0 auto' }}>
              {taxLabel} obligations will appear here once invoices are issued. This section tracks which invoices have their tax settled.
            </div>
          </div>
        ) : (
          <>
            {/* Tax summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div className="card card-pad" style={{ borderLeft: '3px solid #FF4444' }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{taxLabel} Owed (Unpaid)</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#FF4444' }}>{fmt(taxOwed)}</div>
              </div>
              <div className="card card-pad" style={{ borderLeft: '3px solid #4CAF50' }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{taxLabel} Paid</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#4CAF50' }}>{fmt(taxPaid)}</div>
              </div>
            </div>

            {/* Tax records table */}
            <div className="card">
              <div className="table-wrap table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th style={{ textAlign: 'right' }}>Invoice Total</th>
                      <th style={{ textAlign: 'right' }}>Rate</th>
                      <th style={{ textAlign: 'right' }}>{taxLabel}</th>
                      <th>Status</th>
                      <th>Paid Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxRecords.map(r => (
                      <tr key={r.id}>
                        <td data-label="Invoice" className="text-sm">{r.invoice_number || `#${r.id}`}</td>
                        <td data-label="Total" style={{ textAlign: 'right' }}>{fmt(r.invoice_total)}</td>
                        <td data-label="Rate" style={{ textAlign: 'right', color: '#888' }}>{r.tax_rate_applied}%</td>
                        <td data-label={taxLabel} style={{ textAlign: 'right', fontWeight: 600, color: r.tax_status === 'paid' ? '#4CAF50' : '#FF902F' }}>{fmt(r.tax_amount)}</td>
                        <td data-label="Status">
                          <span className={`badge badge-${r.tax_status === 'paid' ? 'paid' : 'unpaid'}`}>{r.tax_status}</span>
                        </td>
                        <td data-label="Paid" className="text-xs text-2">{r.paid_date ? fmtDate(r.paid_date) : '—'}</td>
                        <td className="mobile-actions">
                          {r.tax_status === 'unpaid' ? (
                            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px', color: '#4CAF50', borderRadius: '50px', border: '1px solid rgba(76,175,80,0.3)' }} onClick={() => markTaxPaid(r.id)}>
                              Mark Paid
                            </button>
                          ) : (
                            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px', color: '#888', borderRadius: '50px' }} onClick={() => markTaxUnpaid(r.id)}>
                              Mark Unpaid
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────── MAIN PAGE ────────────────────────── */

const TABS = [
  { key: 'overview',     label: 'Overview' },
  { key: 'pl',           label: 'Profit & Loss' },
  { key: 'receivables',  label: 'Receivables' },
];

export default function Finances() {
  const [activeTab, setActiveTab] = useState('overview');
  const [month, setMonth] = useState(getCurrentMonth());
  const [filterCat, setFilterCat] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [allCategories, setAllCategories] = useState([]);
  const [allClients, setAllClients] = useState([]);

  useEffect(() => {
    Promise.all([
      api.get('/settings/project-categories'),
      api.get('/clients'),
    ]).then(([cats, clients]) => {
      setAllCategories(cats);
      setAllClients(clients);
    }).catch(() => {});
  }, []);

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '20px' }}>
        <div>
          <div className="page-title">Finances</div>
          <div className="page-subtitle">Agency financial overview</div>
        </div>
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`btn btn-sm ${activeTab === t.key ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '50px', padding: '6px 20px', fontWeight: activeTab === t.key ? 600 : 400 }}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <OverviewTab
          month={month} setMonth={setMonth}
          filterCat={filterCat} setFilterCat={setFilterCat}
          filterClient={filterClient} setFilterClient={setFilterClient}
          allCategories={allCategories} allClients={allClients}
        />
      )}
      {activeTab === 'pl' && <PLTab />}
      {activeTab === 'receivables' && <ReceivablesTab />}
    </div>
  );
}
