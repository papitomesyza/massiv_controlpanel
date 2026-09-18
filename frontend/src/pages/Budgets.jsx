import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, FileText, Search, MoreVertical, Pencil, Copy, Download, Receipt, Trash2,
  Video, Camera, Film, Palette, Sparkles, Tag,
} from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import { Private } from '../context/PrivacyContext';
import { useNavigate } from 'react-router-dom';
import BudgetWizard from '../components/BudgetWizard';
import ConfirmDialog from '../components/ConfirmDialog';

// ── Pipeline model ───────────────────────────────────────────────────────────
// Four states. The colour is the only carrier of the state on a card; the words
// live once, in the legend at the foot of the page. Every hue is a shared token
// from index.css, with ember reserved for the one negative outcome.
const STATUSES = ['draft', 'sent', 'accepted', 'rejected'];
const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', rejected: 'Rejected' };
const STATUS_VAR = {
  draft: 'var(--cat-1)',
  sent: 'var(--cat-2)',
  accepted: 'var(--cat-6)',
  rejected: 'var(--color-ember)',
};

const FOLLOW_UP_DAYS = 7;   // a sent estimate is stale once its ring is full

// Project category groups map to one icon each; anything unknown falls back to a
// neutral tag. The word itself is never printed, it lives in the hover tooltip.
const GROUP_ICON = {
  'Video Production': Video,
  'Photography': Camera,
  'Post Production': Film,
  'Branding & Digital': Palette,
  'Animation & Motion': Sparkles,
};

function daysSince(iso) {
  if (!iso) return 0;
  const then = new Date(String(iso).includes('T') ? iso : iso.replace(' ', 'T'));
  if (isNaN(then.getTime())) return 0;
  return Math.max(0, (Date.now() - then.getTime()) / 86400000);
}

function monthKey(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).includes('T') ? iso : iso.replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth()}`;
}

// ── Hover tooltip ────────────────────────────────────────────────────────────
// One small tooltip primitive so a fact can travel on hover instead of taking
// up permanent space. `content` may be JSX, so privacy-wrapped amounts work.
function Tip({ content, children, className = '', style }) {
  return (
    <span className={`tip-wrap ${className}`} style={style}>
      {children}
      <span className="tip-pop" role="tooltip">{content}</span>
    </span>
  );
}

// ── Status dot with age ring ─────────────────────────────────────────────────
// The dot carries the state. A sent estimate also gets a ring that fills over
// the follow-up window and turns ember once it is full, so a stale estimate is
// visible without reading a single date.
function StatusDot({ status, sentAt, size = 12 }) {
  const color = STATUS_VAR[status] || 'var(--color-mid-gray)';
  if (status !== 'sent') {
    return <span className="status-dot" style={{ width: size, height: size, background: color }} />;
  }
  const days = daysSince(sentAt);
  const frac = Math.max(0, Math.min(1, days / FOLLOW_UP_DAYS));
  const overdue = days >= FOLLOW_UP_DAYS;
  const ringColor = overdue ? 'var(--color-ember)' : color;
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

// ── Category icon ────────────────────────────────────────────────────────────
function CategoryIcon({ category, group }) {
  const Icon = GROUP_ICON[group] || Tag;
  return (
    <Tip content={category || 'Uncategorised'}>
      <span className="est-cat-icon"><Icon size={15} /></span>
    </Tip>
  );
}

// ── Crew / equipment / logistics split bar ───────────────────────────────────
// The shape of the estimate at a glance: three hues, no labels, amounts on
// hover only and privacy-aware. A zero-value estimate shows a flat neutral bar.
function SplitBar({ crew, equip, log }) {
  const segs = [
    { key: 'crew', label: 'Crew', v: crew, color: 'var(--cat-1)' },
    { key: 'equip', label: 'Equipment', v: equip, color: 'var(--cat-3)' },
    { key: 'log', label: 'Logistics', v: log, color: 'var(--cat-7)' },
  ];
  const total = segs.reduce((s, x) => s + (x.v || 0), 0);
  const tip = (
    <span className="split-tip">
      {segs.map(s => (
        <span key={s.key} className="split-tip-row">
          <span className="split-tip-swatch" style={{ background: s.color }} />
          <span className="split-tip-label">{s.label}</span>
          <Private className="split-tip-val">{fmt(s.v || 0)}</Private>
        </span>
      ))}
    </span>
  );
  return (
    <Tip content={tip} className="split-bar-wrap">
      <span className="split-bar">
        {total > 0
          ? segs.filter(s => (s.v || 0) > 0).map(s => (
              <span key={s.key} className="split-seg" style={{ flex: s.v, background: s.color }} />
            ))
          : <span className="split-seg" style={{ flex: 1, background: 'var(--color-hairline)' }} />}
      </span>
    </Tip>
  );
}

// ── Overflow menu ────────────────────────────────────────────────────────────
function OverflowMenu({ budget, onAction, onStatus }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function pick(fn) {
    return (e) => { e.stopPropagation(); setOpen(false); fn(); };
  }

  const nextStatuses = STATUSES.filter(s => s !== budget.status);

  return (
    <div className="est-overflow" ref={ref} onClick={e => e.stopPropagation()}>
      <button className="btn-icon est-overflow-btn" title="Actions" onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="est-menu">
          <button className="est-menu-item" onClick={pick(() => onAction('edit'))}><Pencil size={14} /> Edit</button>
          <button className="est-menu-item" onClick={pick(() => onAction('duplicate'))}><Copy size={14} /> Duplicate</button>
          <button className="est-menu-item" onClick={pick(() => onAction('pdf'))}><Download size={14} /> Export PDF</button>
          <button className="est-menu-item" onClick={pick(() => onAction('invoice'))}><Receipt size={14} /> Create invoice</button>
          <div className="est-menu-sep" />
          <div className="est-menu-heading">Move to</div>
          {nextStatuses.map(s => (
            <button key={s} className="est-menu-item" onClick={pick(() => onStatus(s))}>
              <span className="status-dot" style={{ width: 10, height: 10, background: STATUS_VAR[s] }} />
              {STATUS_LABEL[s]}
            </button>
          ))}
          <div className="est-menu-sep" />
          <button className="est-menu-item is-danger" onClick={pick(() => onAction('delete'))}><Trash2 size={14} /> Delete</button>
        </div>
      )}
    </div>
  );
}

// ── Estimate card ────────────────────────────────────────────────────────────
function EstimateCard({ budget, catGroup, onOpen, onAction, onStatus }) {
  const metaTip = (
    <span>
      <div>{budget.project_title ? `Project: ${budget.project_title}` : 'No linked project'}</div>
      <div>{`Created: ${fmtDate(budget.created_at?.split('T')[0] || budget.created_at?.split(' ')[0])}`}</div>
      {budget.status === 'sent' && budget.sent_at && (
        <div>{`Sent: ${fmtDate(budget.sent_at.split('T')[0] || budget.sent_at.split(' ')[0])}`}</div>
      )}
    </span>
  );

  return (
    <div className="est-card" onClick={() => onOpen(budget)} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(budget); }}>
      <div className="est-card-top">
        <Tip content={metaTip} className="est-status">
          <StatusDot status={budget.status} sentAt={budget.sent_at} />
        </Tip>
        <CategoryIcon category={budget.category} group={catGroup} />
        <div style={{ flex: 1 }} />
        <OverflowMenu budget={budget} onAction={a => onAction(a, budget)} onStatus={s => onStatus(s, budget)} />
      </div>

      <div className="est-card-title">{budget.title}</div>
      <div className="est-card-client">{budget.client_name || 'No client'}</div>

      <div className="est-card-total">
        <Private>{fmt(budget.total)}</Private>
      </div>

      <SplitBar crew={budget.crew_total} equip={budget.equip_total} log={budget.log_total} />
    </div>
  );
}

// ── Win rate ring ────────────────────────────────────────────────────────────
function WinRing({ accepted, rejected }) {
  const denom = accepted + rejected;
  const frac = denom > 0 ? accepted / denom : 0;
  const size = 46, R = 19, C = 2 * Math.PI * R;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="win-ring">
      <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="var(--color-hairline)" strokeWidth="4" />
      <circle
        cx={size / 2} cy={size / 2} r={R} fill="none" stroke="var(--cat-6)" strokeWidth="4"
        strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

// ── Pipeline strip ───────────────────────────────────────────────────────────
function PipelineStrip({ budgets }) {
  const now = monthKey(new Date().toISOString());
  const outForApproval = budgets.filter(b => b.status === 'sent').reduce((s, b) => s + (b.total || 0), 0);
  const acceptedThisMonth = budgets
    .filter(b => b.status === 'accepted' && monthKey(b.responded_at) === now)
    .reduce((s, b) => s + (b.total || 0), 0);
  const accepted = budgets.filter(b => b.status === 'accepted').length;
  const rejected = budgets.filter(b => b.status === 'rejected').length;

  return (
    <div className="est-pipeline">
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Out for approval</div>
        <div className="est-pipe-value"><Private>{fmt(outForApproval)}</Private></div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Accepted this month</div>
        <div className="est-pipe-value"><Private>{fmt(acceptedThisMonth)}</Private></div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Win rate</div>
        <div className="est-pipe-ring"><WinRing accepted={accepted} rejected={rejected} /></div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Budgets() {
  const navigate = useNavigate();
  const [budgets, setBudgets] = useState([]);
  const [catGroups, setCatGroups] = useState({});   // category name → group name
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [editingBudget, setEditingBudget] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [confirm, setConfirm] = useState(null);      // active ConfirmDialog config
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [data, cats] = await Promise.all([
        api.get('/budgets'),
        api.get('/settings/project-categories').catch(() => []),
      ]);
      setBudgets(data);
      const map = {};
      (cats || []).forEach(c => { map[c.name] = c.group_name; });
      setCatGroups(map);
    } catch (_) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function openEstimate(budget) {
    try {
      const full = await api.get(`/budgets/${budget.id}`);
      setEditingBudget(full);
      setShowWizard(true);
    } catch (e) { setError(e.message); }
  }

  function handleNew() {
    setEditingBudget(null);
    setShowWizard(true);
  }

  async function exportPdf(budget) {
    try {
      await api.download(`/budgets/${budget.id}/pdf`, `Estimate-${budget.title.replace(/[^a-z0-9]/gi, '-')}.pdf`);
    } catch (e) { setError(e.message); }
  }

  async function createInvoice(budget) {
    try {
      await api.post(`/invoices/from-estimate/${budget.id}`, {});
      navigate('/invoices');
    } catch (e) { setError(e.message); }
  }

  async function duplicate(budget) {
    try {
      const { id } = await api.post(`/budgets/${budget.id}/duplicate`, {});
      const full = await api.get(`/budgets/${id}`);
      await load();
      setEditingBudget(full);   // opens the copy at step 0
      setShowWizard(true);
    } catch (e) { setError(e.message); }
  }

  // Overflow actions route here. Delete asks first via the in-app dialog.
  function handleAction(action, budget) {
    setError('');
    if (action === 'edit') return openEstimate(budget);
    if (action === 'pdf') return exportPdf(budget);
    if (action === 'invoice') return createInvoice(budget);
    if (action === 'duplicate') return duplicate(budget);
    if (action === 'delete') {
      setConfirm({
        kind: 'delete',
        budget,
        title: `Delete estimate "${budget.title}"?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        tone: 'danger',
      });
    }
  }

  async function handleStatus(status, budget) {
    setError('');
    try {
      await api.post(`/budgets/${budget.id}/status`, { status });
      await load();
      // Accepting an estimate is the natural moment to spin up a project, but
      // it is offered, never forced.
      if (status === 'accepted') {
        setConfirm({
          kind: 'project',
          budget,
          title: 'Create a project from this estimate?',
          message: 'A new project will be created with this estimate as its agreed budget.',
          confirmLabel: 'Create project',
          tone: 'default',
        });
      }
    } catch (e) { setError(e.message); }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'delete') {
        await api.del(`/budgets/${confirm.budget.id}`);
        await load();
      } else if (confirm.kind === 'project') {
        await api.post(`/budgets/${confirm.budget.id}/project`, {});
        navigate('/projects');
      }
      setConfirm(null);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  function handleWizardClose() { setShowWizard(false); setEditingBudget(null); }
  function handleWizardSaved() { setShowWizard(false); setEditingBudget(null); load(); }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return budgets.filter(b => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (!q) return true;
      return (b.title || '').toLowerCase().includes(q) || (b.client_name || '').toLowerCase().includes(q);
    });
  }, [budgets, query, statusFilter]);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Estimates</div>
        <button className="btn btn-primary" onClick={handleNew}>
          <Plus size={15} /> New Estimate
        </button>
      </div>

      {budgets.length > 0 && <PipelineStrip budgets={budgets} />}

      {budgets.length > 0 && (
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
          <div className="est-filter-dots">
            {STATUSES.map(s => (
              <button
                key={s}
                className={`est-filter-dot ${statusFilter === s ? 'active' : ''}`}
                title={STATUS_LABEL[s]}
                aria-label={STATUS_LABEL[s]}
                onClick={() => setStatusFilter(cur => cur === s ? null : s)}
              >
                <span className="status-dot" style={{ width: 12, height: 12, background: STATUS_VAR[s] }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="error-msg" style={{ marginBottom: '12px' }}>{error}</div>}

      {budgets.length === 0 ? (
        <div className="card">
          <div className="empty" style={{ padding: '64px 32px' }}>
            <FileText size={40} color="var(--color-hairline-strong)" style={{ marginBottom: '16px' }} />
            <div style={{ marginBottom: '8px', color: 'var(--color-ink)', fontWeight: 600, fontSize: '16px' }}>No estimates yet</div>
            <div style={{ marginBottom: '24px' }}>Create your first estimate.</div>
            <button className="btn btn-primary" onClick={handleNew}><Plus size={15} /> New Estimate</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty" style={{ padding: '48px 32px' }}>No estimates match.</div></div>
      ) : (
        <div className="est-grid">
          {filtered.map(b => (
            <EstimateCard
              key={b.id}
              budget={b}
              catGroup={catGroups[b.category]}
              onOpen={openEstimate}
              onAction={handleAction}
              onStatus={handleStatus}
            />
          ))}
        </div>
      )}

      {/* Legend: the only place the status words appear. */}
      {budgets.length > 0 && (
        <div className="est-legend">
          {STATUSES.map(s => (
            <span key={s} className="est-legend-item">
              <span className="status-dot" style={{ width: 10, height: 10, background: STATUS_VAR[s] }} />
              {STATUS_LABEL[s]}
            </span>
          ))}
          <span className="est-legend-item est-legend-ring">
            <StatusDot status="sent" sentAt={new Date(Date.now() - 8 * 86400000).toISOString()} size={10} />
            Follow up ({FOLLOW_UP_DAYS}d+)
          </span>
        </div>
      )}

      {showWizard && (
        <BudgetWizard
          budget={editingBudget}
          onClose={handleWizardClose}
          onSaved={handleWizardSaved}
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
