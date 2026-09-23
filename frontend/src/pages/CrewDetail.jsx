import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit2, Archive, ArchiveRestore, Building2, User, MessageCircle, Mail, Phone, MapPin,
  Plus, Trash2, Check, X, NotebookPen, FolderOpen,
} from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import Overlay from '../components/Overlay';
import ConfirmDialog from '../components/ConfirmDialog';
import DateField from '../components/DateField';
import Ring from '../components/Ring';
import { Private } from '../context/PrivacyContext';
import { waUrl, mailUrl, telUrl, StatusDot, IconLink, IconToggles, useMoneyTip } from '../components/DbBits';
import { CrewFormFields } from './Crew';
import { pristinaToday } from '../lib/pristinaDate';

export default function CrewDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(false);
  const [debts, setDebts] = useState([]);
  const [debtModal, setDebtModal] = useState(null);
  const [markPaidId, setMarkPaidId] = useState(null);
  const [markPaidDate, setMarkPaidDate] = useState(pristinaToday());
  const [deleteDebt, setDeleteDebt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const tip = useMoneyTip();

  async function load() {
    try {
      const [d, r, dbs] = await Promise.all([
        api.get(`/crew/${id}`),
        api.get('/crew/roles'),
        api.get(`/crew/${id}/debts`),
      ]);
      setData(d); setRoles(r); setDebts(dbs);
    } catch { navigate('/crew'); }
    setLoading(false);
  }

  async function loadDebts() {
    try { setDebts(await api.get(`/crew/${id}/debts`)); }
    catch (e) { setNotice({ title: 'Could not load the ledger', message: e.message }); }
  }

  useEffect(() => { load(); }, [id]);

  async function toggleArchive() {
    try { await api.put(`/crew/${id}/archive`, {}); load(); }
    catch (e) { setNotice({ title: 'Could not update', message: e.message }); }
  }

  async function markPaid(debt) {
    setBusy(true);
    try {
      await api.put(`/crew/${id}/debts/${debt.id}`, { ...debt, status: 'paid', payment_date: markPaidDate });
      setMarkPaidId(null);
      loadDebts();
    } catch (e) { setNotice({ title: 'Could not mark paid', message: e.message }); }
    setBusy(false);
  }

  async function confirmDeleteDebt() {
    setBusy(true);
    try {
      await api.del(`/crew/${id}/debts/${deleteDebt.id}`);
      setDeleteDebt(null);
      loadDebts();
    } catch (e) {
      setDeleteDebt(null);
      setNotice({ title: 'Could not delete', message: e.message });
    }
    setBusy(false);
  }

  if (loading) return <div className="loading">Loading...</div>;
  if (!data) return null;

  const { member, assignments, totals } = data;
  const ledgerUnpaid = debts.filter(d => d.status === 'unpaid').reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const isCompany = !!member.is_company;
  const sub = isCompany ? member.service_type : member.role;

  return (
    <div>
      <div className="db-head">
        <Link to="/crew" className="db-iconbtn lg" title="Crew" aria-label="Back to crew"><ArrowLeft size={16} /></Link>
        <span className="db-avatar">{isCompany ? <Building2 size={18} /> : <User size={18} />}</span>
        <div className="db-main">
          <div className="page-title">
            {member.name}
            {!!member.archived && <Archive size={16} style={{ color: 'var(--color-mid-gray)' }} aria-label="Archived" />}
          </div>
          {sub && <div className="db-title-sub">{sub}</div>}
        </div>
        <div className="db-actions">
          <IconLink href={waUrl(member.phone)} title="WhatsApp"><MessageCircle size={16} /></IconLink>
          <IconLink href={mailUrl(member.email)} title="Email" external={false}><Mail size={16} /></IconLink>
          <button className="db-iconbtn" onClick={() => setEditModal(true)} title="Edit" aria-label="Edit"><Edit2 size={16} /></button>
          <button
            className="db-iconbtn"
            onClick={toggleArchive}
            title={member.archived ? 'Restore' : 'Archive'}
            aria-label={member.archived ? 'Restore' : 'Archive'}
          >
            {member.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </button>
        </div>
      </div>

      <div className="db-split" style={{ marginBottom: '16px' }}>
        <div className="card db-panel">
          <div className="db-summary">
            <Ring value={totals.paid} max={totals.agreed} size={120} stroke={10} title={tip('Paid', totals.paid)} />
            <div className="db-figures">
              <div className="db-figure lead" title="Agreed">
                <span className="db-money"><Private>{fmt(totals.agreed)}</Private></span>
              </div>
              <div className="db-figure" title="Paid">
                <span className="db-dot ink" />
                <span className="db-money"><Private>{fmt(totals.paid)}</Private></span>
              </div>
              <div className="db-figure" title="Remaining">
                <span className="db-dot" />
                <span className={totals.remaining > 0 ? 'db-owed' : 'db-money'}><Private>{fmt(totals.remaining)}</Private></span>
              </div>
            </div>
          </div>
        </div>

        <div className="card db-panel">
          <div className="db-contact">
            {member.phone && (
              <IconLink href={telUrl(member.phone)} title={member.phone} external={false}><Phone size={16} /></IconLink>
            )}
            {member.email && (
              <IconLink href={mailUrl(member.email)} title={member.email} external={false}><Mail size={16} /></IconLink>
            )}
            {member.location && (
              <span className="db-iconbtn" title={member.location} aria-label={member.location}><MapPin size={16} /></span>
            )}
            {Number(member.day_rate) > 0 && (
              <span className="db-chip" title="Day rate" style={{ alignSelf: 'center' }}><Private>{fmt(member.day_rate)}</Private></span>
            )}
          </div>
          {member.notes && <div className="db-notes">{member.notes}</div>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        {assignments.length === 0 ? (
          <div className="db-empty"><FolderOpen size={26} /></div>
        ) : (
          <div className="db-list">
            {assignments.map(a => (
              <div key={a.id} className="db-row">
                <StatusDot status={a.project_status} />
                <span className="db-row-title">
                  <Link to={`/projects/${a.project_id}`}>{a.project_title}</Link>
                </span>
                <span className="db-chip">{a.days} x <Private>{fmt(a.rate_per_day)}</Private></span>
                <Ring value={a.paid} max={a.agreed} size={22} title={tip('Paid', a.paid)} />
                <span style={{ minWidth: '84px', textAlign: 'right' }}>
                  {a.remaining > 0 && <span className="db-owed"><Private>{fmt(a.remaining)}</Private></span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="db-section-head">
        <span className="section-title"><NotebookPen size={15} style={{ color: 'var(--color-mid-gray)' }} /> Ledger</span>
        {ledgerUnpaid > 0 && (
          <span className="db-owed" title={tip('Unpaid', ledgerUnpaid)}><span className="db-dot" /><Private>{fmt(ledgerUnpaid)}</Private></span>
        )}
        <span className="spacer" />
        <button className="db-iconbtn lg" onClick={() => setDebtModal({})} title="New entry" aria-label="New ledger entry">
          <Plus size={16} />
        </button>
      </div>

      <div className="card">
        {debts.length === 0 ? (
          <div className="db-empty"><NotebookPen size={24} /></div>
        ) : (
          <div className="db-list">
            {debts.map(debt => {
              const paid = debt.status === 'paid';
              return (
                <div key={debt.id} className={`db-row ${paid ? 'is-paid' : ''}`}>
                  <span className="db-row-date">{fmtDate(debt.date_incurred)}</span>
                  <span className="db-row-title" title={debt.notes || undefined}>{debt.description}</span>
                  <span className="db-money"><Private>{fmt(debt.amount)}</Private></span>
                  <span
                    className={`db-dot ${paid ? 'ink' : ''}`}
                    title={paid ? `Paid ${fmtDate(debt.payment_date)}`.trim() : 'Unpaid'}
                  />
                  <div className="db-actions">
                    {!paid && (markPaidId === debt.id ? (
                      <>
                        <DateField value={markPaidDate} onChange={setMarkPaidDate} aria-label="Payment date" wrapClassName="db-inline-date" />
                        <button className="db-iconbtn" onClick={() => markPaid(debt)} disabled={busy || !markPaidDate} title="Confirm paid" aria-label="Confirm paid">
                          <Check size={15} />
                        </button>
                        <button className="db-iconbtn" onClick={() => setMarkPaidId(null)} title="Cancel" aria-label="Cancel">
                          <X size={15} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="db-iconbtn"
                        onClick={() => { setMarkPaidId(debt.id); setMarkPaidDate(pristinaToday()); }}
                        title="Mark paid"
                        aria-label="Mark paid"
                      >
                        <Check size={15} />
                      </button>
                    ))}
                    <button className="db-iconbtn" onClick={() => setDebtModal(debt)} title="Edit" aria-label="Edit"><Edit2 size={14} /></button>
                    <button className="db-iconbtn danger" onClick={() => setDeleteDebt(debt)} title="Delete" aria-label="Delete"><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editModal && <EditCrewModal member={member} crewId={id} roles={roles} onClose={() => setEditModal(false)} onSaved={load} />}
      {debtModal !== null && (
        <LedgerModal debt={debtModal} crewId={id} onClose={() => setDebtModal(null)} onSaved={() => { setDebtModal(null); loadDebts(); }} />
      )}

      {deleteDebt && (
        <ConfirmDialog
          title={`Delete ${deleteDebt.description}?`}
          message="This cannot be undone."
          confirmLabel="Delete"
          tone="danger"
          busy={busy}
          onConfirm={confirmDeleteDebt}
          onCancel={() => setDeleteDebt(null)}
        />
      )}

      {notice && (
        <ConfirmDialog
          title={notice.title}
          message={notice.message}
          confirmLabel="OK"
          cancelLabel={null}
          onConfirm={() => setNotice(null)}
          onCancel={() => setNotice(null)}
        />
      )}
    </div>
  );
}

function LedgerModal({ debt, crewId, onClose, onSaved }) {
  const isEdit = !!debt?.id;
  const [form, setForm] = useState({
    description: debt?.description || '',
    amount: debt?.amount ?? '',
    date_incurred: debt?.date_incurred || pristinaToday(),
    status: debt?.status || 'unpaid',
    payment_date: debt?.payment_date || '',
    notes: debt?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.description.trim() || form.amount === '') return setErr('Description and amount required');
    setSaving(true);
    try {
      if (isEdit) await api.put(`/crew/${crewId}/debts/${debt.id}`, form);
      else await api.post(`/crew/${crewId}/debts`, form);
      onSaved();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <Overlay
      title={<span className="flex-center gap-2"><NotebookPen size={16} /> Ledger</span>}
      label={isEdit ? 'Edit ledger entry' : 'New ledger entry'}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </>}
    >
      <div className="form-row">
        <label className="form-label">Description *</label>
        <input className="input" value={form.description} onChange={e => f('description', e.target.value)} autoFocus />
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Amount € *</label>
          <input type="number" min="0" step="0.01" className="input" value={form.amount} onChange={e => f('amount', e.target.value)} placeholder="0.00" />
        </div>
        <div className="form-row">
          <label className="form-label">Date</label>
          <DateField value={form.date_incurred} onChange={v => f('date_incurred', v)} />
        </div>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <IconToggles
            options={[
              { key: 'unpaid', Icon: CircleDotEmber, title: 'Unpaid' },
              { key: 'paid', Icon: Check, title: 'Paid' },
            ]}
            value={form.status}
            onChange={k => setForm(p => ({ ...p, status: k, payment_date: k === 'paid' ? (p.payment_date || pristinaToday()) : '' }))}
            label="Status"
          />
        </div>
        {form.status === 'paid' && (
          <div className="form-row">
            <label className="form-label">Paid on</label>
            <DateField value={form.payment_date} onChange={v => f('payment_date', v)} />
          </div>
        )}
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} />
      </div>
      {err && <div className="error-msg">{err}</div>}
    </Overlay>
  );
}

// The unpaid glyph for the status toggle: the same ember dot the rows use.
function CircleDotEmber() {
  return <span className="db-dot" />;
}

function EditCrewModal({ member, crewId, roles, onClose, onSaved }) {
  const [isCompany, setIsCompany] = useState(!!member.is_company);
  const [form, setForm] = useState({
    name: member.name || '', role: member.role || '', phone: member.phone || '',
    email: member.email || '', location: member.location || '',
    day_rate: member.day_rate || '', notes: member.notes || '',
    service_type: member.service_type || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.name.trim()) return setErr('Name is required');
    setSaving(true);
    try {
      await api.put(`/crew/${crewId}`, {
        ...form, name: form.name.trim(), is_company: isCompany, day_rate: parseFloat(form.day_rate) || 0,
      });
      onSaved(); onClose();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <Overlay title="Edit Crew" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </>}>
      <CrewFormFields form={form} f={f} isCompany={isCompany} setIsCompany={setIsCompany} roles={roles} />
      {err && <div className="error-msg">{err}</div>}
    </Overlay>
  );
}
