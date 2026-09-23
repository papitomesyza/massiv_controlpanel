import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Download, Search, X, Receipt, FileText,
} from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import { Private } from '../context/PrivacyContext';
import { GROUP_TINT, categoryVisual, CategoryTile } from '../lib/categoryIcons';
import { pristinaMonth, pristinaYear, addMonths } from '../lib/pristinaDate';
import TrendChart from '../components/TrendChart';
import Donut from '../components/Donut';

// The five category groups in the fixed order the Projects and Map pages use.
const GROUPS = Object.keys(GROUP_TINT);

function monthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function filterQuery(filter) {
  const p = new URLSearchParams();
  if (filter.group) p.set('group', filter.group);
  if (filter.client) p.set('client_id', String(filter.client.id));
  return p;
}

/* ───────────────────────── Shared controls ───────────────────────── */

// Previous and next arrows either side of the period name, matching the
// Calendar header.
function Stepper({ label, onPrev, onNext }) {
  return (
    <div className="fin-stepper">
      <button className="btn btn-ghost btn-sm fin-stepper-btn" onClick={onPrev} aria-label="Previous"><ChevronLeft size={16} /></button>
      <h2 className="fin-stepper-label">{label}</h2>
      <button className="btn btn-ghost btn-sm fin-stepper-btn" onClick={onNext} aria-label="Next"><ChevronRight size={16} /></button>
    </div>
  );
}

// The five group glyphs, tinted like the Projects filter. Click to filter, click
// again to clear.
function GroupFilter({ value, onChange }) {
  return (
    <div className="est-filter-dots">
      {GROUPS.map(g => {
        const { Icon, tint } = categoryVisual(undefined, g);
        return (
          <button
            key={g}
            className={`est-filter-dot proj-group-dot ${value === g ? 'active' : ''}`}
            style={{ '--tint': tint }}
            title={g}
            aria-label={g}
            aria-pressed={value === g}
            onClick={() => onChange(value === g ? '' : g)}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

// Type to find a client, pick one to filter, clear with the X.
function ClientSearch({ clients, value, onChange }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? clients.filter(c => `${c.name} ${c.company || ''}`.toLowerCase().includes(t))
      : clients;
    return list.slice(0, 8);
  }, [clients, q]);

  if (value) {
    return (
      <div className="est-search fin-client-chip">
        <Search size={14} />
        <span className="input fin-client-picked">{value.name}</span>
        <button className="fin-client-clear" onClick={() => onChange(null)} aria-label="Clear client"><X size={14} /></button>
      </div>
    );
  }

  return (
    <div className="est-search fin-client-search" ref={wrapRef}>
      <Search size={14} />
      <input
        className="input"
        value={q}
        placeholder="Client"
        aria-label="Filter by client"
        onFocus={() => setOpen(true)}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'Enter' && matches[0]) { onChange(matches[0]); setQ(''); setOpen(false); }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="fin-client-menu">
          {matches.map(c => (
            <li key={c.id}>
              <button onMouseDown={e => { e.preventDefault(); onChange(c); setQ(''); setOpen(false); }}>{c.name}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────────── Overview tab ───────────────────────── */

// A signed percentage, coloured: profit green, loss ember. No margin, no value.
function MarginValue({ margin }) {
  if (margin === null || margin === undefined) return <span className="rank-margin rank-margin-none" />;
  return (
    <span className={`rank-margin ${margin < 0 ? 'is-neg' : 'is-pos'}`}>
      {margin > 0 ? '+' : ''}{margin}%
    </span>
  );
}

// One row per item: a glyph or name, a bar proportional to revenue, and the
// margin. Exact figures appear on hover.
function RankedBars({ rows, renderLabel }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...rows.map(r => r.total_revenue || 0));
  if (rows.length === 0) return <div className="rank-empty" />;
  return (
    <ul className="rank-list">
      {rows.map((r, i) => (
        <li
          key={r.id ?? i}
          className="rank-row"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        >
          <div className="rank-label">{renderLabel(r)}</div>
          <div className="rank-track">
            <div className="rank-bar" style={{ width: `${Math.max(2, (r.total_revenue / max) * 100)}%` }} />
          </div>
          <MarginValue margin={r.margin} />
          {hover === i && (
            <div className="rank-tip">
              <div className="rank-tip-row"><span>Revenue</span><Private>{fmt(r.total_revenue)}</Private></div>
              {r.completed_projects > 0 && (
                <>
                  <div className="rank-tip-row"><span>Completed revenue</span><Private>{fmt(r.completed_revenue)}</Private></div>
                  <div className="rank-tip-row"><span>Crew paid</span><Private>{fmt(r.total_crew)}</Private></div>
                  <div className="rank-tip-row"><span>Expenses</span><Private>{fmt(r.total_expenses)}</Private></div>
                  <div className="rank-tip-row rank-tip-total"><span>Project profit</span><Private>{fmt(r.net_profit)}</Private></div>
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function OverviewTab({ month, setMonth, filter, setFilter, clients }) {
  const [stats, setStats] = useState(null);
  const [chart, setChart] = useState([]);
  const [catData, setCatData] = useState([]);
  const [clientData, setClientData] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const fq = filterQuery(filter);
    const sp = new URLSearchParams(fq); sp.set('month', month);
    const cp = new URLSearchParams(fq); cp.set('months', '6'); cp.set('end', month);
    Promise.all([
      api.get(`/finances/stats?${sp}`),
      api.get(`/finances/chart?${cp}`),
      api.get(`/finances/categories?${fq}`),
      api.get(`/finances/clients?${fq}`),
      api.get(`/finances/all-time-kpis?${fq}`),
    ]).then(([s, ch, ca, cl, k]) => {
      setStats(s);
      setChart(ch.map(r => ({ ...r, costs: Math.round((r.expenses + r.crewCosts) * 100) / 100 })));
      setCatData(ca);
      setClientData(cl);
      setKpis(k);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [month, filter]);

  const costs = stats ? stats.expenses + stats.crewCosts : 0;
  const donutData = catData.filter(c => c.total_revenue > 0);

  return (
    <div>
      <div className="fin-controls">
        <Stepper
          label={monthName(month)}
          onPrev={() => setMonth(addMonths(month, -1))}
          onNext={() => setMonth(addMonths(month, 1))}
        />
        <div className="fin-filters">
          <GroupFilter value={filter.group} onChange={g => setFilter(f => ({ ...f, group: g }))} />
          <ClientSearch clients={clients} value={filter.client} onChange={c => setFilter(f => ({ ...f, client: c }))} />
        </div>
      </div>

      {loading && !stats ? <div className="loading">Loading...</div> : (
        <>
          <div className="est-pipeline fin-strip">
            <div className="est-pipe-cell">
              <div className="est-pipe-label">Revenue</div>
              <div className="est-pipe-value"><Private>{fmt(stats?.revenue)}</Private></div>
            </div>
            <div className="est-pipe-cell">
              <div className="est-pipe-label">Costs</div>
              <div className="est-pipe-value"><Private>{fmt(costs)}</Private></div>
            </div>
            <div className="est-pipe-cell">
              <div className="est-pipe-label">Project profit</div>
              <div className="est-pipe-value" style={{ color: stats?.netProfit < 0 ? 'var(--color-ember)' : undefined }}>
                <Private>{fmt(stats?.netProfit)}</Private>
              </div>
            </div>
          </div>

          {kpis && (
            <div className="fin-quiet">
              <div className="fin-quiet-item"><span>All time</span><Private>{fmt(kpis.totalRevenue)}</Private></div>
              <div className="fin-quiet-item"><span>Completed</span>{kpis.totalCompleted}</div>
              <div className="fin-quiet-item"><span>Avg project</span><Private>{fmt(kpis.avgProjectValue)}</Private></div>
              {kpis.bestMonth && (
                <div className="fin-quiet-item"><span>Best month</span>{monthName(kpis.bestMonth.month)}</div>
              )}
              {kpis.bestClient && !filter.client && (
                <div className="fin-quiet-item"><span>Best client</span>{kpis.bestClient.name}</div>
              )}
            </div>
          )}

          <div className="two-col fin-charts">
            <div className="card card-pad">
              <TrendChart data={chart} costKey="costs" costLabel="Costs" />
            </div>
            <div className="card card-pad">
              {donutData.length === 0 ? <div className="rank-empty" /> : (
                <Donut data={donutData} valueKey="total_revenue" nameKey="name" />
              )}
            </div>
          </div>

          <div className="two-col">
            <div className="card card-pad">
              <RankedBars rows={clientData} renderLabel={r => <span className="rank-name">{r.name}</span>} />
            </div>
            <div className="card card-pad">
              <RankedBars
                rows={catData}
                renderLabel={r => (
                  <span className="rank-cat" title={r.name}>
                    <CategoryTile categoryName={r.name} groupName={r.group_name} size={26} />
                  </span>
                )}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────── Profit and loss tab ─────────────────────── */

function PLTab() {
  const [year, setYear] = useState(pristinaYear());
  const [viewMode, setViewMode] = useState('year'); // 'year' | 'month'
  const [selMonth, setSelMonth] = useState(pristinaMonth());
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

  // Stepping the month into another year moves the table's year with it.
  useEffect(() => {
    if (viewMode === 'month' && selMonth.slice(0, 4) !== year) setYear(selMonth.slice(0, 4));
  }, [selMonth, viewMode, year]);

  async function exportPDF() {
    setPdfLoading(true);
    try { await api.download(`/finances/pl-pdf?year=${year}`, `${year}-Profit-Loss.pdf`); } catch (_) {}
    setPdfLoading(false);
  }

  const statement = viewMode === 'year'
    ? (plData?.totals || null)
    : (monthStats ? { revenue: monthStats.revenue, expenses: monthStats.expenses, crewCosts: monthStats.crewCosts, netProfit: monthStats.netProfit } : null);

  const maxAbs = plData ? Math.max(1, ...plData.months.map(m => Math.abs(m.netProfit))) : 1;

  return (
    <div>
      <div className="fin-controls">
        {viewMode === 'year' ? (
          <Stepper label={year} onPrev={() => setYear(String(Number(year) - 1))} onNext={() => setYear(String(Number(year) + 1))} />
        ) : (
          <Stepper label={monthName(selMonth)} onPrev={() => setSelMonth(addMonths(selMonth, -1))} onNext={() => setSelMonth(addMonths(selMonth, 1))} />
        )}
        <div className="fin-filters">
          <div className="toggle-group">
            <button className={`toggle-btn ${viewMode === 'year' ? 'active' : ''}`} onClick={() => setViewMode('year')}>Year</button>
            <button className={`toggle-btn ${viewMode === 'month' ? 'active' : ''}`} onClick={() => { setSelMonth(m => (m.slice(0, 4) === year ? m : `${year}-01`)); setViewMode('month'); }}>Month</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={exportPDF} disabled={pdfLoading} aria-label="Export PDF" title="Export PDF">
            <Download size={14} /> PDF
          </button>
        </div>
      </div>

      {loading ? <div className="loading">Loading...</div> : (
        <div className="pl-layout">
          <div className="card card-pad pl-statement">
            {!statement ? <div className="rank-empty" /> : (
              <>
                <div className="pl-line pl-line-strong"><span>Revenue</span><Private>{fmt(statement.revenue)}</Private></div>
                <div className="pl-line pl-line-sub"><span>Crew</span><Private>{fmt(statement.crewCosts)}</Private></div>
                <div className="pl-line pl-line-sub"><span>Expenses</span><Private>{fmt(statement.expenses)}</Private></div>
                <div className="pl-line"><span>Costs</span><Private>{fmt(statement.crewCosts + statement.expenses)}</Private></div>
                <div className={`pl-line pl-line-total ${statement.netProfit < 0 ? 'is-neg' : ''}`}>
                  <span>Project profit</span><Private>{fmt(statement.netProfit)}</Private>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="pl-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Revenue</th>
                    <th className="num pl-minor">Crew</th>
                    <th className="num pl-minor">Expenses</th>
                    <th className="num">Project profit</th>
                    <th className="pl-bar-col" aria-label="Shape" />
                  </tr>
                </thead>
                <tbody>
                  {plData.months.map(m => {
                    const isEmpty = m.revenue === 0 && m.expenses === 0 && m.crewCosts === 0;
                    const isSelected = viewMode === 'month' && m.month === selMonth;
                    const neg = m.netProfit < 0;
                    const w = (Math.abs(m.netProfit) / maxAbs) * 100;
                    return (
                      <tr
                        key={m.month}
                        className={`${isEmpty ? 'pl-empty' : ''} ${neg ? 'pl-neg' : ''} ${isSelected ? 'pl-selected' : ''}`}
                        onClick={() => { setSelMonth(m.month); setViewMode('month'); }}
                      >
                        <td data-label="Month">{m.label}</td>
                        <td data-label="Revenue" className="num">{isEmpty ? null : <Private>{fmt(m.revenue)}</Private>}</td>
                        <td data-label="Crew" className="num text-2 pl-minor">{isEmpty ? null : <Private>{fmt(m.crewCosts)}</Private>}</td>
                        <td data-label="Expenses" className="num text-2 pl-minor">{isEmpty ? null : <Private>{fmt(m.expenses)}</Private>}</td>
                        <td data-label="Project profit" className="num pl-profit">{isEmpty ? null : <Private>{fmt(m.netProfit)}</Private>}</td>
                        <td className="pl-bar-col">
                          {!isEmpty && (
                            <div className="pl-bar-track">
                              <div className={`pl-bar ${neg ? 'is-neg' : ''}`} style={{ width: `${Math.max(2, w)}%` }} />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className={`pl-total ${plData.totals.netProfit < 0 ? 'pl-neg' : ''}`}>
                    <td data-label="Month">{year}</td>
                    <td data-label="Revenue" className="num"><Private>{fmt(plData.totals.revenue)}</Private></td>
                    <td data-label="Crew" className="num text-2 pl-minor"><Private>{fmt(plData.totals.crewCosts)}</Private></td>
                    <td data-label="Expenses" className="num text-2 pl-minor"><Private>{fmt(plData.totals.expenses)}</Private></td>
                    <td data-label="Project profit" className="num pl-profit"><Private>{fmt(plData.totals.netProfit)}</Private></td>
                    <td className="pl-bar-col" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Receivables tab ─────────────────────── */

// Age buckets in order, coloured from neutral to ember as age increases. The
// not yet invoiced balance is its own distinct, hatched segment: it is owed but
// has no invoice date to age from.
const BUCKETS = [
  { key: 'current',    label: 'Not due',          cls: 'ar-seg-0' },
  { key: '1-30',       label: '1-30d',            cls: 'ar-seg-1' },
  { key: '31-60',      label: '31-60d',           cls: 'ar-seg-2' },
  { key: '61-90',      label: '61-90d',           cls: 'ar-seg-3' },
  { key: '90+',        label: '90d+',             cls: 'ar-seg-4' },
  { key: 'uninvoiced', label: 'Not yet invoiced', cls: 'ar-seg-un' },
];
const BUCKET_BY_KEY = Object.fromEntries(BUCKETS.map(b => [b.key, b]));

function AgingBar({ buckets, total, active, onPick }) {
  const present = BUCKETS.filter(b => (buckets?.[b.key] || 0) > 0);
  return (
    <div className="ar-aging">
      <div className="ar-bar" role="group" aria-label="Receivables by age">
        {total > 0 ? present.map(b => (
          <button
            key={b.key}
            className={`ar-seg ${b.cls} ${active && active !== b.key ? 'is-dim' : ''}`}
            style={{ flexGrow: buckets[b.key] }}
            title={b.label}
            aria-label={b.label}
            aria-pressed={active === b.key}
            onClick={() => onPick(active === b.key ? null : b.key)}
          />
        )) : <div className="ar-seg ar-seg-empty" />}
      </div>
      <div className="ar-legend">
        {present.map(b => (
          <button
            key={b.key}
            className={`ar-legend-item ${active === b.key ? 'active' : ''}`}
            onClick={() => onPick(active === b.key ? null : b.key)}
          >
            <span className={`ar-swatch ${b.cls}`} />
            <span className="ar-legend-label">{b.label}</span>
            <span className="ar-legend-amt"><Private>{fmt(buckets[b.key])}</Private></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function YearStepper({ year, setYear }) {
  return <Stepper label={year} onPrev={() => setYear(String(Number(year) - 1))} onNext={() => setYear(String(Number(year) + 1))} />;
}

function ReceivablesTab() {
  const [arData, setArData] = useState(null);
  const [bucket, setBucket] = useState(null);
  const [taxRecords, setTaxRecords] = useState([]);
  const [taxSettings, setTaxSettings] = useState(null);
  const [taxYear, setTaxYear] = useState(pristinaYear());
  const [loading, setLoading] = useState(true);

  const loadAR = useCallback(async () => {
    setArData(await api.get('/finances/ar-aging'));
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

  if (loading) return <div className="loading">Loading...</div>;

  const rows = (arData?.rows || []).filter(r => !bucket || r.bucket === bucket);

  return (
    <div>
      <div className="est-pipeline fin-strip">
        <div className="est-pipe-cell">
          <div className="est-pipe-label">Owed</div>
          <div className="est-pipe-value"><Private>{fmt(arData?.total)}</Private></div>
        </div>
        <div className="est-pipe-cell">
          <div className="est-pipe-label">Invoiced</div>
          <div className="est-pipe-value" style={{ color: arData?.overdue > 0 ? 'var(--color-ember)' : undefined }}>
            <Private>{fmt(arData?.invoiced)}</Private>
          </div>
        </div>
        <div className="est-pipe-cell">
          <div className="est-pipe-label">Not yet invoiced</div>
          <div className="est-pipe-value"><Private>{fmt(arData?.uninvoiced)}</Private></div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: '16px' }}>
        <AgingBar buckets={arData?.buckets} total={arData?.total || 0} active={bucket} onPick={setBucket} />
      </div>

      {rows.length > 0 && (
        <div className="card ar-list">
          {rows.map((r, i) => {
            const meta = BUCKET_BY_KEY[r.bucket];
            // An invoice row opens that invoice; an uninvoiced balance opens its project.
            const to = r.source === 'invoice' && r.invoice_id
              ? `/invoices?id=${r.invoice_id}`
              : (r.project_id ? `/projects/${r.project_id}` : '/invoices');
            return (
              <Link key={`${r.source}-${r.invoice_id ?? r.project_id}-${i}`} to={to} className="ar-row">
                <span className={`ar-swatch ${meta.cls}`} title={meta.label} />
                <span className="ar-row-main">
                  <span className="ar-row-client">{r.client_name || r.project_title}</span>
                  {r.project_title && r.client_name && <span className="ar-row-project">{r.project_title}</span>}
                </span>
                {r.source === 'invoice' ? (
                  <span className="ar-row-due" title={r.invoice_number ? `Invoice ${r.invoice_number}` : undefined}>
                    {r.due_date ? fmtDate(r.due_date) : null}
                    {r.days_overdue > 0 && <span className="ar-row-days">{r.days_overdue}d</span>}
                  </span>
                ) : (
                  <span className="ar-row-due" />
                )}
                <span className="ar-row-amt"><Private>{fmt(r.amount)}</Private></span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Tax */}
      <div className="fin-tax">
        <div className="fin-controls">
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={15} /> {taxLabel}
          </div>
          <YearStepper year={taxYear} setYear={setTaxYear} />
        </div>

        {taxSettings && !taxSettings.tax_enabled ? (
          <div className="card card-pad empty">Tax tracking is disabled. Enable it in Settings.</div>
        ) : taxRecords.length === 0 ? (
          <div className="card card-pad fin-tax-empty">
            <Receipt size={22} />
          </div>
        ) : (
          <>
            <div className="est-pipeline fin-strip fin-strip-2">
              <div className="est-pipe-cell">
                <div className="est-pipe-label">Owed</div>
                <div className="est-pipe-value" style={{ color: taxOwed > 0 ? 'var(--color-ember)' : undefined }}><Private>{fmt(taxOwed)}</Private></div>
              </div>
              <div className="est-pipe-cell">
                <div className="est-pipe-label">Paid</div>
                <div className="est-pipe-value"><Private>{fmt(taxPaid)}</Private></div>
              </div>
            </div>

            <div className="card">
              <div className="table-wrap table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th className="num">Total</th>
                      <th className="num">Rate</th>
                      <th className="num">{taxLabel}</th>
                      <th>Paid</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxRecords.map(r => (
                      <tr key={r.id}>
                        <td data-label="Invoice" className="text-sm">{r.invoice_number || `#${r.id}`}</td>
                        <td data-label="Total" className="num"><Private>{fmt(r.invoice_total)}</Private></td>
                        <td data-label="Rate" className="num text-2">{r.tax_rate_applied}%</td>
                        <td data-label={taxLabel} className="num" style={{ fontWeight: 600, color: r.tax_status === 'paid' ? 'var(--color-ink)' : 'var(--color-ember)' }}><Private>{fmt(r.tax_amount)}</Private></td>
                        <td data-label="Paid" className="text-xs text-2">{r.paid_date ? fmtDate(r.paid_date) : null}</td>
                        <td className="mobile-actions">
                          {r.tax_status === 'unpaid' ? (
                            <button className="btn btn-ghost btn-sm" onClick={() => markTaxPaid(r.id)}>Mark Paid</button>
                          ) : (
                            <button className="btn btn-ghost btn-sm text-2" onClick={() => markTaxUnpaid(r.id)}>Mark Unpaid</button>
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

/* ────────────────────────── Main page ────────────────────────── */

const TABS = [
  { key: 'overview',     label: 'Overview' },
  { key: 'pl',           label: 'Profit & Loss' },
  { key: 'receivables',  label: 'Receivables' },
];

export default function Finances() {
  const [activeTab, setActiveTab] = useState('overview');
  const [month, setMonth] = useState(pristinaMonth());
  const [filter, setFilter] = useState({ group: '', client: null });
  const [clients, setClients] = useState([]);

  useEffect(() => {
    api.get('/clients').then(setClients).catch(() => {});
  }, []);

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '20px' }}>
        <div className="page-title">Finances</div>
      </div>

      <div className="toggle-group fin-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`toggle-btn ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <OverviewTab month={month} setMonth={setMonth} filter={filter} setFilter={setFilter} clients={clients} />
      )}
      {activeTab === 'pl' && <PLTab />}
      {activeTab === 'receivables' && <ReceivablesTab />}
    </div>
  );
}
