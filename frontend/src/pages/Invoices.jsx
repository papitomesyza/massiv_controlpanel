import React, { useEffect, useState, useRef, useLayoutEffect, useMemo } from 'react';
import {
  Receipt, Plus, Download, Trash2, Pencil, Send, Search, MoreVertical,
  Wallet, RotateCcw, X, Settings, Package, Image as ImageIcon, FileText,
} from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import { documentFilename } from '../lib/filename';
import { Private } from '../context/PrivacyContext';
import InvoiceBuilder from '../components/InvoiceBuilder';
import ConfirmDialog from '../components/ConfirmDialog';

const TABS = [
  { key: 'list',  label: 'Invoices' },
  { key: 'setup', label: 'Invoice Setup' },
];

const KOSOVO_BANKS = [
  'Raiffeisen Bank Kosovo',
  'ProCredit Bank',
  'NLB Banka',
  'TEB',
  'Banka Ekonomike',
  'Banka për Biznes (BPB)',
  'Banka Kombëtare Tregtare (BKT)',
  'Banka Kreditore e Prishtinës',
  'Ziraat Bank Kosova',
  'Is Bank',
];

// ─── Status badge ─────────────────────────────────────────────────────────────

// The four payment states shown as dots. Overdue is not a state of its own: it
// is carried by the age ring turning ember, so it never needs a word. Every hue
// is a shared categorical token from index.css.
const INV_STATES = ['draft', 'unpaid', 'partial', 'paid'];
const STATE_LABEL = { draft: 'Draft', unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid' };
const STATE_VAR = {
  draft: 'var(--cat-1)',
  unpaid: 'var(--cat-2)',
  partial: 'var(--cat-4)',
  paid: 'var(--cat-6)',
};
const DUE_SOON_DAYS = 14;   // the ring fills over the final fortnight when there is no issue date to span

const PAY_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];
const METHOD_LABEL = Object.fromEntries(PAY_METHODS.map(m => [m.value, m.label]));

// Today in Pristina local time (Kosovo shares Europe/Belgrade), formatted as
// YYYY-MM-DD. Never UTC, so a payment entered late at night keeps the right day.
function pristinaToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Payment state derived from the balance, not from a stored flag.
function paymentState(inv) {
  const due = Number(inv.amount_due) || 0;
  const paid = Number(inv.amount_paid) || 0;
  if (paid > 0.005 && due - paid <= 0.005) return 'paid';
  if (paid > 0.005) return 'partial';
  return inv.status === 'draft' ? 'draft' : 'unpaid';
}

function isOverdue(inv) {
  const st = paymentState(inv);
  if (st === 'paid' || st === 'draft') return false;
  return inv.due_date && new Date(inv.due_date + 'T23:59:59') < new Date();
}

// How full the age ring is: the invoice's life from issue date to due date, or,
// when there is no issue date to span, the final fortnight before it is due.
function ringFraction(inv) {
  if (!inv.due_date) return null;
  const due = new Date(inv.due_date + 'T23:59:59');
  const now = new Date();
  if (now >= due) return 1;
  const issue = inv.issue_date ? new Date(inv.issue_date + 'T00:00:00') : null;
  if (!issue || due <= issue) {
    const daysLeft = (due - now) / 86400000;
    return Math.max(0, Math.min(1, 1 - daysLeft / DUE_SOON_DAYS));
  }
  return Math.max(0, Math.min(1, (now - issue) / (due - issue)));
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────
function Tip({ content, children, className = '' }) {
  return (
    <span className={`tip-wrap ${className}`}>
      {children}
      <span className="tip-pop" role="tooltip">{content}</span>
    </span>
  );
}

// ── Status dot with age ring ──────────────────────────────────────────────────
// The dot carries the payment state. An unpaid or part paid invoice also gets a
// ring that fills as the due date nears and turns ember once it has passed, so
// urgency reads without a single date on the card.
function StatusDot({ inv, size = 12 }) {
  const state = paymentState(inv);
  const color = STATE_VAR[state] || 'var(--color-mid-gray)';
  const showRing = state === 'unpaid' || state === 'partial';
  const frac = showRing ? ringFraction(inv) : null;
  if (frac === null) {
    return <span className="status-dot" style={{ width: size, height: size, background: color }} />;
  }
  const ringColor = isOverdue(inv) ? 'var(--color-ember)' : color;
  const R = size / 2 + 3;
  const C = 2 * Math.PI * R;
  const box = (R + 2) * 2;
  return (
    <span className="status-dot-ring" style={{ width: box, height: box }}>
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} style={{ position: 'absolute', inset: 0 }}>
        <circle cx={box / 2} cy={box / 2} r={R} fill="none" stroke="var(--color-hairline)" strokeWidth="2" />
        <circle
          cx={box / 2} cy={box / 2} r={R} fill="none" stroke={ringColor} strokeWidth="2"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
          transform={`rotate(-90 ${box / 2} ${box / 2})`}
        />
      </svg>
      <span className="status-dot" style={{ width: size, height: size, background: color }} />
    </span>
  );
}

// A static ember ring, used once in the legend to name the overdue treatment.
function OverdueRingSample({ size = 10 }) {
  const R = size / 2 + 3;
  const C = 2 * Math.PI * R;
  const box = (R + 2) * 2;
  return (
    <span className="status-dot-ring" style={{ width: box, height: box }}>
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} style={{ position: 'absolute', inset: 0 }}>
        <circle cx={box / 2} cy={box / 2} r={R} fill="none" stroke="var(--color-hairline)" strokeWidth="2" />
        <circle cx={box / 2} cy={box / 2} r={R} fill="none" stroke="var(--color-ember)" strokeWidth="2"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={0}
          transform={`rotate(-90 ${box / 2} ${box / 2})`} />
      </svg>
      <span className="status-dot" style={{ width: size, height: size, background: 'var(--cat-2)' }} />
    </span>
  );
}

// ── Payment progress bar ──────────────────────────────────────────────────────
// Amount paid against the total, so a part paid invoice is visible at a glance.
function ProgressBar({ inv }) {
  const due = Number(inv.amount_due) || 0;
  const paid = Number(inv.amount_paid) || 0;
  const frac = due > 0 ? Math.max(0, Math.min(1, paid / due)) : (paid > 0 ? 1 : 0);
  const fillColor = paymentState(inv) === 'paid' ? 'var(--cat-6)' : 'var(--cat-4)';
  const tip = (
    <span className="split-tip">
      <span className="split-tip-row">
        <span className="split-tip-swatch" style={{ background: fillColor }} />
        <span className="split-tip-label">Paid</span>
        <Private className="split-tip-val">{fmt(paid)}</Private>
      </span>
      <span className="split-tip-row">
        <span className="split-tip-swatch" style={{ background: 'var(--color-hairline)' }} />
        <span className="split-tip-label">Balance</span>
        <Private className="split-tip-val">{fmt(Math.max(0, due - paid))}</Private>
      </span>
    </span>
  );
  return (
    <Tip content={tip} className="pay-bar-wrap">
      <span className="pay-bar">
        <span className="pay-bar-fill" style={{ width: `${frac * 100}%`, background: fillColor }} />
      </span>
    </Tip>
  );
}

// ── Overflow menu ─────────────────────────────────────────────────────────────
// One control per card, flipping upward when there is no room below. Every
// action lives here as an icon plus a word, so mark-unpaid reads the same as its
// neighbours rather than being a stray text button.
function OverflowMenu({ inv, isOpen, onOpenChange, onAction }) {
  const ref = useRef(null);
  const menuRef = useRef(null);
  const [dropUp, setDropUp] = useState(false);
  const state = paymentState(inv);
  const hasPayments = (Number(inv.amount_paid) || 0) > 0.005;

  useEffect(() => {
    if (!isOpen) return undefined;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) onOpenChange(null); }
    function onKey(e) { if (e.key === 'Escape') onOpenChange(null); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onOpenChange]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const btn = ref.current?.querySelector('.est-overflow-btn');
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const btnRect = btn.getBoundingClientRect();
    const menuH = menu.offsetHeight;
    const spaceBelow = window.innerHeight - btnRect.bottom;
    setDropUp(spaceBelow < menuH + 12 && btnRect.top > menuH);
  }, [isOpen]);

  function pick(action) {
    return (e) => { e.stopPropagation(); onOpenChange(null); onAction(action); };
  }

  return (
    <div className="est-overflow" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        className="btn-icon est-overflow-btn"
        title="Actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={e => { e.stopPropagation(); onOpenChange(isOpen ? null : inv.id); }}
      >
        <MoreVertical size={16} />
      </button>
      {isOpen && (
        <div className={`est-menu ${dropUp ? 'drop-up' : ''}`} ref={menuRef} role="menu">
          <button className="est-menu-item" onClick={pick('edit')}><Pencil size={14} /> Edit</button>
          {state !== 'paid' && (
            <button className="est-menu-item" onClick={pick('record')}><Wallet size={14} /> Record payment</button>
          )}
          <button className="est-menu-item" onClick={pick('pdf')}><Download size={14} /> Export PDF</button>
          {state === 'draft' && (
            <button className="est-menu-item" onClick={pick('issue')}><Send size={14} /> Issue</button>
          )}
          {hasPayments && (
            <button className="est-menu-item" onClick={pick('unpaid')}><RotateCcw size={14} /> Mark unpaid</button>
          )}
          <div className="est-menu-sep" />
          <button className="est-menu-item is-danger" onClick={pick('delete')}><Trash2 size={14} /> Delete</button>
        </div>
      )}
    </div>
  );
}

// ── Invoice card ──────────────────────────────────────────────────────────────
function InvoiceCard({ inv, onOpen, onAction, menuOpen, onMenuChange }) {
  const metaTip = (
    <span>
      <div>{`Issued: ${fmtDate(inv.issue_date) || 'not set'}`}</div>
      <div>{`Due: ${fmtDate(inv.due_date) || 'not set'}`}</div>
    </span>
  );
  return (
    <div className={`est-card ${menuOpen ? 'is-menu-open' : ''}`} onClick={() => onOpen(inv)} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(inv); }}>
      <div className="est-card-top">
        <Tip content={metaTip} className="est-status">
          <StatusDot inv={inv} />
        </Tip>
        <div style={{ flex: 1 }} />
        <OverflowMenu inv={inv} isOpen={menuOpen} onOpenChange={onMenuChange} onAction={a => onAction(a, inv)} />
      </div>

      <div className="est-card-title" style={inv.invoice_number ? undefined : { color: 'var(--color-mid-gray)' }}>
        {inv.invoice_number || 'Draft'}
      </div>
      <div className="est-card-client">{inv.client_name || 'No client'}</div>

      <div className="est-card-total"><Private>{fmt(inv.amount_due)}</Private></div>

      <ProgressBar inv={inv} />
    </div>
  );
}

// ── Stat strip ────────────────────────────────────────────────────────────────
// The same construction the other pages use. Three figures, no subtitles, all
// privacy aware. Overdue draws in ember so the eye lands on it.
function StatStrip({ stats }) {
  return (
    <div className="est-pipeline">
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Outstanding</div>
        <div className="est-pipe-value"><Private>{fmt(stats.outstanding)}</Private></div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Overdue</div>
        <div className="est-pipe-value" style={{ color: (stats.overdue || 0) > 0 ? 'var(--color-ember)' : undefined }}>
          <Private>{fmt(stats.overdue)}</Private>
        </div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Collected this month</div>
        <div className="est-pipe-value"><Private>{fmt(stats.collected)}</Private></div>
      </div>
    </div>
  );
}

// ── Record payment modal ──────────────────────────────────────────────────────
// Records a payment against the invoice and lists the payments already recorded,
// each removable. The amount defaults to the remaining balance, the date to
// today in Pristina, the method to bank transfer.
function RecordPaymentModal({ invoice, onClose, onChanged }) {
  const [inv, setInv] = useState(invoice);
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState({ amount: '', date: pristinaToday(), method: 'bank_transfer' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const due = Number(inv.amount_due) || 0;
  const paid = Number(inv.amount_paid) || 0;
  const balance = Math.max(0, Math.round((due - paid) * 100) / 100);

  async function reload() {
    try {
      const [full, pays] = await Promise.all([
        api.get(`/invoices/${invoice.id}`),
        api.get(`/invoices/${invoice.id}/payments`),
      ]);
      setInv(full);
      setPayments(pays);
      const nextBal = Math.max(0, Math.round(((Number(full.amount_due) || 0) - (Number(full.amount_paid) || 0)) * 100) / 100);
      setForm(f => ({ ...f, amount: nextBal ? String(nextBal) : '' }));
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    setForm(f => ({ ...f, amount: balance ? String(balance) : '' }));
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function record() {
    setError('');
    const amt = Number(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than zero.'); return; }
    setBusy(true);
    try {
      await api.post(`/invoices/${invoice.id}/payments`, { amount: amt, date: form.date, method: form.method });
      await reload();
      onChanged();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  async function remove(paymentId) {
    setError('');
    setBusy(true);
    try {
      await api.del(`/invoices/${invoice.id}/payments/${paymentId}`);
      await reload();
      onChanged();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  const cleared = balance <= 0.005;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ width: '460px', maxWidth: '94vw' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Record payment</div>
            <div style={{ fontSize: '12px', color: 'var(--color-mid-gray)', marginTop: '2px' }}>
              {inv.invoice_number || 'Draft'} · {inv.client_name || 'No client'}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Balance readout */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--overlay-02)', borderRadius: '10px' }}>
            <span style={{ fontSize: '12px', color: 'var(--color-mid-gray)' }}>Remaining balance</span>
            <span style={{ fontSize: '18px', fontWeight: 700, color: cleared ? 'var(--cat-6)' : 'var(--color-ink)' }}>
              <Private>{fmt(balance)}</Private>
            </span>
          </div>

          {!cleared && (
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Amount (EUR)</label>
                <input className="input" type="number" min="0" step="0.01" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Date</label>
                <input className="input" type="date" value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Method</label>
                <select className="select" style={{ width: '100%' }} value={form.method}
                  onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
                  {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {error && <div className="error-msg">{error}</div>}

          {/* Recorded payments */}
          {payments.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-mid-gray)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: '8px' }}>
                Recorded
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {payments.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--overlay-01)', border: '1px solid var(--color-hairline)', borderRadius: '10px' }}>
                    <span className="status-dot" style={{ width: 8, height: 8, background: 'var(--cat-6)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}><Private>{fmt(p.amount)}</Private></div>
                      <div style={{ fontSize: '11px', color: 'var(--color-mid-gray)' }}>
                        {fmtDate(p.date)} · {METHOD_LABEL[p.method] || p.method}
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm" title="Remove payment" disabled={busy} onClick={() => remove(p.id)}>
                      <Trash2 size={13} style={{ color: 'var(--color-ember)' }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {!cleared && (
            <button className="btn btn-primary" onClick={record} disabled={busy}>
              {busy ? 'Working...' : 'Record payment'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Invoice List Tab ─────────────────────────────────────────────────────────

function InvoicesListTab({ onEdit, refresh }) {
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState({ outstanding: 0, overdue: 0, collected: 0 });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [recordFor, setRecordFor] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [data, s] = await Promise.all([
        api.get('/invoices'),
        api.get('/invoices/stats').catch(() => ({ outstanding: 0, overdue: 0, collected: 0 })),
      ]);
      setInvoices(data);
      setStats(s);
    } catch (_) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [refresh]);

  async function exportPdf(inv) {
    try {
      // Same clean shape an estimate downloads with; the anchor's download name wins.
      const name = `${documentFilename('Invoice', inv.id, inv.client_name)}.pdf`;
      await api.download(`/invoices/${inv.id}/pdf`, name);
    } catch (e) { setError(e.message); }
  }

  async function issue(inv) {
    setError('');
    try { await api.post(`/invoices/${inv.id}/issue`, {}); await load(); } catch (e) { setError(e.message); }
  }

  function handleAction(action, inv) {
    setError('');
    if (action === 'edit') return onEdit(inv);
    if (action === 'pdf') return exportPdf(inv);
    if (action === 'issue') return issue(inv);
    if (action === 'record') {
      if (!inv.project_id) {
        setError('Link this invoice to a project before recording a payment: income is recorded against a project, so without one there is nowhere for the money to go. Open the invoice to add one.');
        return;
      }
      return setRecordFor(inv);
    }
    if (action === 'unpaid') {
      return setConfirm({
        kind: 'unpaid', inv,
        title: `Mark ${inv.invoice_number || 'this invoice'} unpaid?`,
        message: 'Every payment recorded against it will be removed and the books reversed.',
        confirmLabel: 'Mark unpaid', tone: 'danger',
      });
    }
    if (action === 'delete') {
      if ((Number(inv.amount_paid) || 0) > 0.005) {
        setError('This invoice has recorded payments. Mark it unpaid first, so no received money is left in the books without a document behind it.');
        return;
      }
      return setConfirm({
        kind: 'delete', inv,
        title: `Delete ${inv.invoice_number || 'this draft'}?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete', tone: 'danger',
      });
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'delete') {
        await api.del(`/invoices/${confirm.inv.id}`);
      } else if (confirm.kind === 'unpaid') {
        await api.post(`/invoices/${confirm.inv.id}/unpaid`, {});
      }
      await load();
      setConfirm(null);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter(inv => {
      if (stateFilter && paymentState(inv) !== stateFilter) return false;
      if (!q) return true;
      return (inv.invoice_number || '').toLowerCase().includes(q)
        || (inv.client_name || '').toLowerCase().includes(q);
    });
  }, [invoices, query, stateFilter]);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      {invoices.length > 0 && <StatStrip stats={stats} />}

      {invoices.length > 0 && (
        <div className="est-controls">
          <div className="est-search">
            <Search size={15} />
            <input
              className="input"
              placeholder="Search number or client"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <div className="est-filter-dots">
            {INV_STATES.map(s => (
              <button
                key={s}
                className={`est-filter-dot ${stateFilter === s ? 'active' : ''}`}
                title={STATE_LABEL[s]}
                aria-label={STATE_LABEL[s]}
                onClick={() => setStateFilter(cur => cur === s ? null : s)}
              >
                <span className="status-dot" style={{ width: 12, height: 12, background: STATE_VAR[s] }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="error-msg" style={{ marginBottom: '12px' }}>{error}</div>}

      {invoices.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center', padding: '64px 32px' }}>
          <Receipt size={40} color="var(--color-hairline-strong)" style={{ marginBottom: '16px' }} />
          <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '8px' }}>No invoices yet</div>
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '13px' }}>
            Create your first invoice with the button above.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty" style={{ padding: '48px 32px' }}>No invoices match.</div></div>
      ) : (
        <div className="est-grid">
          {filtered.map(inv => (
            <InvoiceCard
              key={inv.id}
              inv={inv}
              onOpen={onEdit}
              onAction={handleAction}
              menuOpen={openMenuId === inv.id}
              onMenuChange={setOpenMenuId}
            />
          ))}
        </div>
      )}

      {/* Legend: the one place the status words appear. */}
      {invoices.length > 0 && (
        <div className="est-legend">
          {INV_STATES.map(s => (
            <span key={s} className="est-legend-item">
              <span className="status-dot" style={{ width: 10, height: 10, background: STATE_VAR[s] }} />
              {STATE_LABEL[s]}
            </span>
          ))}
          <span className="est-legend-item est-legend-ring">
            <OverdueRingSample />
            Overdue
          </span>
        </div>
      )}

      {recordFor && (
        <RecordPaymentModal
          invoice={recordFor}
          onClose={() => setRecordFor(null)}
          onChanged={load}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          tone={confirm.tone}
          busy={busy}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ─── Invoice Setup Tab ─────────────────────────────────────────────────────────

function InvoiceSetupTab() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({
    billing_name: '', billing_address: '', billing_tel: '',
    billing_nr_unik: '', billing_bank_account: '', billing_bank_name: '',
    billing_bank_name_custom: '',
    billing_swift: '',
    language: 'sq', next_num_seed: '34', next_year_seed: '25',
    tax_enabled: false,
  });
  const [logo, setLogo] = useState(null);
  const [stamp, setStamp] = useState(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const logoRef = useRef(null);
  const stampRef = useRef(null);

  // Services catalogue
  const [services, setServices] = useState([]);
  const [svcForm, setSvcForm] = useState({ code: '', name: '', unit: 'Shërbim', default_price: '' });
  const [editingSvc, setEditingSvc] = useState(null);
  const [svcMsg, setSvcMsg] = useState('');

  async function loadSettings() {
    setLoading(true);
    try {
      const s = await api.get('/invoices/settings');
      setSettings(s);
      const rawBankName = s.billing_bank_name || '';
      const isKnownBank = KOSOVO_BANKS.includes(rawBankName);
      setForm({
        billing_name: s.billing_name || '',
        billing_address: s.billing_address || '',
        billing_tel: s.billing_tel || '',
        billing_nr_unik: s.billing_nr_unik || '',
        billing_bank_account: s.billing_bank_account || '',
        billing_bank_name: isKnownBank ? rawBankName : (rawBankName ? 'Other' : ''),
        billing_bank_name_custom: !isKnownBank && rawBankName ? rawBankName : '',
        billing_swift: s.billing_swift || '',
        language: s.language || 'sq',
        next_num_seed: String(s.next_num_seed || 34),
        next_year_seed: String(s.next_year_seed || '25'),
        tax_enabled: !!s.tax_enabled,
      });
      setLogo(s.logo_base64 || null);
      setStamp(s.stamp_base64 || null);
    } catch (_) {}
    setLoading(false);
  }

  async function loadServices() {
    try { setServices(await api.get('/invoices/services')); } catch (_) {}
  }

  useEffect(() => {
    loadSettings();
    loadServices();
  }, []);

  async function saveSettings() {
    try {
      const bankNameToSave = form.billing_bank_name === 'Other'
        ? form.billing_bank_name_custom
        : form.billing_bank_name;
      await api.post('/invoices/settings', {
        billing_name: form.billing_name,
        billing_address: form.billing_address,
        billing_tel: form.billing_tel,
        billing_nr_unik: form.billing_nr_unik,
        billing_bank_account: form.billing_bank_account,
        billing_bank_name: bankNameToSave,
        billing_swift: form.billing_swift,
        language: form.language,
        next_num_seed: parseInt(form.next_num_seed, 10),
        next_year_seed: form.next_year_seed,
        logo_base64: logo,
        stamp_base64: stamp,
        tax_enabled: form.tax_enabled ? 1 : 0,
      });
      setMsg('Settings saved');
      loadSettings();
    } catch (e) { setMsg('Error: ' + e.message); }
    setTimeout(() => setMsg(''), 3000);
  }

  function handleLogoFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setLogo(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleStampFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setStamp(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // Service CRUD
  async function saveSvc() {
    try {
      if (editingSvc) {
        await api.put(`/invoices/services/${editingSvc.id}`, svcForm);
      } else {
        await api.post('/invoices/services', svcForm);
      }
      setSvcForm({ code: '', name: '', unit: 'Shërbim', default_price: '' });
      setEditingSvc(null);
      loadServices();
      setSvcMsg('Service saved');
    } catch (e) { setSvcMsg('Error: ' + e.message); }
    setTimeout(() => setSvcMsg(''), 3000);
  }

  async function deleteSvc(id) {
    if (!window.confirm('Delete this service?')) return;
    try { await api.del(`/invoices/services/${id}`); loadServices(); } catch (e) { alert(e.message); }
  }

  function startEditSvc(s) {
    setEditingSvc(s);
    setSvcForm({ code: s.code || '', name: s.name, unit: s.unit, default_price: String(s.default_price) });
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '760px' }}>

      {/* ── Billing Identity ───────────────────────────────────────────────── */}
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
          <Settings size={14} style={{ color: 'var(--accent)' }} />
          <div className="section-title">Company Billing Identity</div>
        </div>
        <div className="form-grid">
          {[
            { key: 'billing_name',        label: 'Company Name' },
            { key: 'billing_address',     label: 'Adresa (Address)' },
            { key: 'billing_tel',         label: 'Tel' },
            { key: 'billing_nr_unik',     label: 'Nr. Unik (Business No.)' },
            { key: 'billing_bank_account', label: 'Bank Account (IBAN)' },
            { key: 'billing_swift',       label: 'SWIFT' },
          ].map(({ key, label }) => (
            <div key={key}>
              <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>{label}</label>
              <input className="input" value={form[key]}
                placeholder={key === 'billing_bank_account' ? 'e.g. 2020-0002-3941-2856' : ''}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        {/* Bank dropdown */}
        <div className="form-grid" style={{ marginTop: '12px' }}>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Bank</label>
            <select className="select" style={{ width: '100%' }}
              value={form.billing_bank_name}
              onChange={e => setForm(f => ({ ...f, billing_bank_name: e.target.value, billing_bank_name_custom: '' }))}>
              <option value="">— Select bank —</option>
              {KOSOVO_BANKS.map(b => <option key={b} value={b}>{b}</option>)}
              <option value="Other">Other (specify)</option>
            </select>
          </div>
          {form.billing_bank_name === 'Other' && (
            <div>
              <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Bank Name</label>
              <input className="input" value={form.billing_bank_name_custom}
                placeholder="Enter bank name"
                onChange={e => setForm(f => ({ ...f, billing_bank_name_custom: e.target.value }))} />
            </div>
          )}
        </div>
      </div>

      {/* ── Invoice Language ───────────────────────────────────────────────── */}
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <FileText size={14} style={{ color: 'var(--accent)' }} />
          <div className="section-title">Invoice Settings</div>
        </div>
        <div className="form-grid">
          <div>
            <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Invoice Language</label>
            <select className="select" value={form.language}
              onChange={e => setForm(f => ({ ...f, language: e.target.value }))} style={{ width: '100%' }}>
              <option value="sq">Albanian (Shqip) — Faturë</option>
              <option value="en">English — Invoice</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>
              Starting Number / Year
            </label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input className="input" type="number" min="1" value={form.next_num_seed}
                onChange={e => setForm(f => ({ ...f, next_num_seed: e.target.value }))}
                style={{ width: '90px' }}
                placeholder="34" />
              <span style={{ fontSize: '14px', color: 'var(--color-mid-gray)' }}>/</span>
              <input className="input" value={form.next_year_seed}
                onChange={e => setForm(f => ({ ...f, next_year_seed: e.target.value }))}
                style={{ width: '60px' }}
                placeholder="25" />
              <span style={{ fontSize: '13px', color: 'var(--color-mid-gray)', whiteSpace: 'nowrap' }}>
                → Next: <strong style={{ color: 'var(--color-ink)' }}>{settings?.next_number_preview || '—'}</strong>
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-mid-gray)', marginTop: '5px' }}>
              Year never changes automatically — you control it here.
            </div>
          </div>
        </div>

        {/* Tax enabled toggle */}
        {settings && (
          <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--overlay-02)', borderRadius: '10px' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-mid-gray)' }}>
              <Receipt size={12} style={{ marginRight: '6px', verticalAlign: 'middle', color: 'var(--accent)' }} />
              Tax: <strong style={{ color: 'var(--color-ink)' }}>{settings.tax_label} {settings.tax_rate}%</strong>
            </div>
            <button
              className={`btn btn-sm ${form.tax_enabled ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: '18px', padding: '4px 16px', fontSize: '12px' }}
              onClick={() => setForm(f => ({ ...f, tax_enabled: !f.tax_enabled }))}
            >
              {form.tax_enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        )}
      </div>

      {/* ── Logo + Stamp Upload ─────────────────────────────────────────────── */}
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
          <ImageIcon size={14} style={{ color: 'var(--accent)' }} />
          <div className="section-title">Invoice Images</div>
        </div>
        <div className="form-grid" style={{ gap: '20px' }}>
          {/* Invoice Logo */}
          <div>
            <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '8px' }}>
              Company Logo (for invoice header)
            </label>
            {logo ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <img src={logo} alt="Invoice logo" style={{ maxHeight: '60px', maxWidth: '160px', objectFit: 'contain', background: 'var(--surface-card)', borderRadius: '10px', padding: '6px' }} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => logoRef.current?.click()}>Replace</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-ember)' }} onClick={() => setLogo(null)}>Remove</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => logoRef.current?.click()}>
                <Plus size={13} /> Upload Logo
              </button>
            )}
            <input type="file" ref={logoRef} accept="image/*" style={{ display: 'none' }} onChange={handleLogoFile} />
          </div>

          {/* Stamp + Signature */}
          <div>
            <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '8px' }}>
              Stamp + Signature (transparent PNG — overlays Dorezoi line)
            </label>
            {stamp ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <img src={stamp} alt="Stamp" style={{ maxHeight: '80px', maxWidth: '160px', objectFit: 'contain', background: 'repeating-conic-gradient(var(--color-hairline) 0% 25%, var(--surface-card) 0% 50%) 0 0 / 12px 12px', borderRadius: '10px' }} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => stampRef.current?.click()}>Replace</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-ember)' }} onClick={() => setStamp(null)}>Remove</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => stampRef.current?.click()}>
                <Plus size={13} /> Upload Stamp+Signature
              </button>
            )}
            <input type="file" ref={stampRef} accept="image/png,image/webp" style={{ display: 'none' }} onChange={handleStampFile} />
          </div>
        </div>
      </div>

      {/* Save button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button className="btn btn-primary" onClick={saveSettings}>Save Invoice Settings</button>
        {msg && <span style={{ fontSize: '13px', color: msg.startsWith('Error') ? 'var(--color-ember)' : 'var(--color-ink)' }}>{msg}</span>}
      </div>

      {/* ── Services Catalogue ─────────────────────────────────────────────── */}
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
          <Package size={14} style={{ color: 'var(--accent)' }} />
          <div className="section-title">Services Catalogue</div>
          <span style={{ fontSize: '11px', color: 'var(--color-mid-gray)', marginLeft: 'auto' }}>
            Used in invoice line items — auto-fills code, name, unit, price
          </span>
        </div>

        {/* Add / Edit form */}
        <div className="svc-form-grid">
          <div>
            <label style={{ fontSize: '10px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Shifra</label>
            <input className="input" style={{ fontSize: '12px' }} placeholder="2001"
              value={svcForm.code} onChange={e => setSvcForm(f => ({ ...f, code: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: '10px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Emërtimi *</label>
            <input className="input" style={{ fontSize: '12px' }} placeholder="Service name"
              value={svcForm.name} onChange={e => setSvcForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: '10px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Njësia</label>
            <input className="input" style={{ fontSize: '12px' }} placeholder="Shërbim"
              value={svcForm.unit} onChange={e => setSvcForm(f => ({ ...f, unit: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: '10px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Çmimi (€)</label>
            <input className="input" type="number" min="0" step="any" style={{ fontSize: '12px' }}
              placeholder="0"
              value={svcForm.default_price} onChange={e => setSvcForm(f => ({ ...f, default_price: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn btn-primary btn-sm" onClick={saveSvc} disabled={!svcForm.name.trim()}>
              {editingSvc ? 'Update' : <><Plus size={13} /> Add</>}
            </button>
            {editingSvc && (
              <button className="btn btn-ghost btn-sm" onClick={() => {
                setEditingSvc(null);
                setSvcForm({ code: '', name: '', unit: 'Shërbim', default_price: '' });
              }}>Cancel</button>
            )}
          </div>
        </div>

        {svcMsg && (
          <div style={{ fontSize: '12px', color: svcMsg.startsWith('Error') ? 'var(--color-ember)' : 'var(--color-ink)', marginBottom: '10px' }}>
            {svcMsg}
          </div>
        )}

        {services.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Shifra</th>
                  <th>Emërtimi</th>
                  <th>Njësia</th>
                  <th style={{ textAlign: 'right' }}>Çmimi</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {services.map(s => (
                  <tr key={s.id} style={editingSvc?.id === s.id ? { background: 'var(--overlay-02)' } : {}}>
                    <td className="text-sm" style={{ color: 'var(--accent)' }}>{s.code || '—'}</td>
                    <td className="text-sm text-bold">{s.name}</td>
                    <td className="text-sm text-2">{s.unit}</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>{<Private>{fmt(s.default_price)}</Private>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => startEditSvc(s)}><Pencil size={12} /></button>
                        <button className="btn btn-ghost btn-sm" onClick={() => deleteSvc(s.id)}>
                          <Trash2 size={12} style={{ color: 'var(--color-ember)' }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-mid-gray)', fontSize: '13px' }}>
            No services in catalogue yet — add one above
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Invoices() {
  const [activeTab, setActiveTab] = useState('list');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [showFromEstimate, setShowFromEstimate] = useState(false);
  const [refresh, setRefresh] = useState(0);

  // Load budgets for "From Estimate" action
  useEffect(() => {
    api.get('/budgets').then(setBudgets).catch(() => {});
  }, []);

  function handleNew() {
    setEditingInvoice(null);
    setShowBuilder(true);
  }

  async function handleEdit(inv) {
    try {
      const full = await api.get(`/invoices/${inv.id}`);
      setEditingInvoice(full);
      setShowBuilder(true);
    } catch (e) { alert(e.message); }
  }

  async function handleFromEstimate(budgetId) {
    try {
      const { id } = await api.post(`/invoices/from-estimate/${budgetId}`, {});
      const full = await api.get(`/invoices/${id}`);
      setShowFromEstimate(false);
      setEditingInvoice(full);
      setShowBuilder(true);
    } catch (e) { alert(e.message); }
  }

  function handleBuilderClose() {
    setShowBuilder(false);
    setEditingInvoice(null);
  }

  function handleBuilderSaved() {
    setShowBuilder(false);
    setEditingInvoice(null);
    setRefresh(r => r + 1);
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '20px' }}>
        <div>
          <div className="page-title">Invoices</div>
        </div>
        {activeTab === 'list' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowFromEstimate(true)}>
              <FileText size={14} /> From Estimate
            </button>
            <button className="btn btn-primary" onClick={handleNew}>
              <Plus size={15} /> New Invoice
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
        {TABS.map(t => (
          <button key={t.key}
            className={`btn btn-sm ${activeTab === t.key ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '18px', padding: '6px 20px', fontWeight: activeTab === t.key ? 600 : 400 }}
            onClick={() => setActiveTab(t.key)}
          >
            {t.key === 'setup' ? <><Settings size={13} style={{ marginRight: '5px' }} />{t.label}</> : t.label}
          </button>
        ))}
      </div>

      {activeTab === 'list' && (
        <InvoicesListTab onEdit={handleEdit} refresh={refresh} />
      )}
      {activeTab === 'setup' && <InvoiceSetupTab />}

      {/* Invoice Builder modal */}
      {showBuilder && (
        <InvoiceBuilder
          invoice={editingInvoice}
          onClose={handleBuilderClose}
          onSaved={handleBuilderSaved}
        />
      )}

      {/* From Estimate picker */}
      {showFromEstimate && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 900,
          background: 'var(--scrim-strong)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card card-pad" style={{ width: '480px', maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>Create Invoice from Estimate</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowFromEstimate(false)}>✕</button>
            </div>
            {budgets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-mid-gray)', fontSize: '13px' }}>
                No estimates found. Create one in Estimates first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {budgets.map(b => (
                  <button key={b.id}
                    onClick={() => handleFromEstimate(b.id)}
                    style={{
                      background: 'var(--overlay-01)', border: '1px solid var(--color-hairline)',
                      borderRadius: '10px', padding: '12px 16px', cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      textAlign: 'left', color: 'var(--color-ink)', width: '100%',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--overlay-01)'}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '2px' }}>{b.title}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-mid-gray)' }}>
                        {b.client_name || b.project_title || 'No client'} · {b.status}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap', marginLeft: '16px' }}>
                      {b.total != null ? <Private>€{Number(b.total).toFixed(2)}</Private> : '—'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
