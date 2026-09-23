import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, ChevronDown, ChevronRight, Trash2, Building2, User, Users, MessageCircle, FileDown,
  Settings2, ArrowDownAZ, Coins, TrendingUp, CircleDollarSign, ArchiveRestore, NotebookPen,
} from 'lucide-react';
import { api, fmt } from '../api';
import { Private } from '../context/PrivacyContext';
import Overlay from '../components/Overlay';
import ConfirmDialog from '../components/ConfirmDialog';
import DateField from '../components/DateField';
import { waUrl, IconToggles, IconLink, useMoneyTip, useDebounced } from '../components/DbBits';
import { pristinaToday } from '../lib/pristinaDate';

const TYPES = [
  { key: '',           Icon: Users,     title: 'All' },
  { key: 'individual', Icon: User,      title: 'Individuals' },
  { key: 'company',    Icon: Building2, title: 'Companies' },
];

const SORTS = [
  { key: 'name',        Icon: ArrowDownAZ,      title: 'A to Z' },
  { key: 'rate_high',   Icon: Coins,            title: 'Day rate' },
  { key: 'earned_high', Icon: TrendingUp,       title: 'Earned' },
  { key: 'owed',        Icon: CircleDollarSign, title: 'Owed' },
];

const EMPTY_FORM = { name: '', role: '', phone: '', email: '', location: '', day_rate: '', notes: '', service_type: '' };

export default function Crew() {
  const navigate = useNavigate();
  const [crew, setCrew] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [search, setSearch] = useState('');
  // The search term reloads 250 ms after typing stops.
  const query = useDebounced(search, 250);
  const [sort, setSort] = useState('name');
  const [typeFilter, setTypeFilter] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [quickLedgerMember, setQuickLedgerMember] = useState(null);
  const [deleteMember, setDeleteMember] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState(null);

  async function load() {
    const params = new URLSearchParams();
    if (query) params.set('search', query);
    if (sort !== 'name') params.set('sort', sort);
    if (typeFilter) params.set('type', typeFilter);
    try {
      const [c, r] = await Promise.all([api.get(`/crew?${params}`), api.get('/crew/roles')]);
      setCrew(c); setRoles(r); setLoadErr('');
    } catch (e) { setLoadErr(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [query, sort, typeFilter]);

  async function restore(member) {
    try { await api.put(`/crew/${member.id}/archive`, {}); load(); }
    catch (e) { setNotice({ title: 'Could not restore', message: e.message }); }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await api.del(`/crew/${deleteMember.id}`);
      setDeleteMember(null);
      load();
    } catch (e) {
      setDeleteMember(null);
      setNotice({ title: 'Cannot delete', message: e.message });
    }
    setDeleting(false);
  }

  async function exportPdf() {
    setPdfLoading(true);
    try { await api.download('/crew/payment-summary-pdf', 'MASSIV-Crew-Payment-Summary.pdf'); }
    catch (e) { setNotice({ title: 'Export failed', message: e.message }); }
    setPdfLoading(false);
  }

  const active = crew.filter(c => !c.archived);
  const archived = crew.filter(c => c.archived);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Crew</div>
        <div className="flex-center gap-2">
          <button className="db-iconbtn lg" onClick={() => setShowRoles(true)} title="Crew roles" aria-label="Crew roles">
            <Settings2 size={16} />
          </button>
          <button className="db-iconbtn lg" onClick={exportPdf} disabled={pdfLoading} title="Export payment summary" aria-label="Export payment summary">
            <FileDown size={16} />
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)} title="Add crew" aria-label="Add crew">
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="db-toolbar">
        <input className="input" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} />
        <IconToggles options={TYPES} value={typeFilter} onChange={setTypeFilter} label="Type" />
        <IconToggles options={SORTS} value={sort} onChange={setSort} label="Sort" />
      </div>

      {loadErr && <div className="error-msg" style={{ marginBottom: '12px' }}>{loadErr}</div>}

      {active.length === 0 ? (
        <div className="card db-empty"><Users size={28} /></div>
      ) : (
        <div className="db-grid">
          {active.map(m => (
            <CrewCard
              key={m.id}
              m={m}
              onOpen={() => navigate(`/crew/${m.id}`)}
              onLedger={() => setQuickLedgerMember(m)}
            />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <button className="db-archived-toggle" onClick={() => setShowArchived(v => !v)} aria-expanded={showArchived}>
            {showArchived ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <span className="db-count" title={`${archived.length} archived`}><span className="db-dot" />{archived.length}</span>
          </button>
          {showArchived && (
            <div className="db-grid" style={{ marginTop: '8px' }}>
              {archived.map(m => (
                <div
                  key={m.id}
                  className="db-card is-muted"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/crew/${m.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter') navigate(`/crew/${m.id}`); }}
                >
                  <span className="db-avatar sm">{m.is_company ? <Building2 size={15} /> : <User size={15} />}</span>
                  <div className="db-main">
                    <div className="db-name"><span>{m.name}</span></div>
                    <div className="db-sub">{m.is_company ? m.service_type : m.role}</div>
                  </div>
                  <div className="db-actions" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                    <button className="db-iconbtn" onClick={() => restore(m)} title="Restore" aria-label="Restore">
                      <ArchiveRestore size={15} />
                    </button>
                    <button className="db-iconbtn danger" onClick={() => setDeleteMember(m)} title="Delete" aria-label="Delete">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showRoles && <RolesOverlay roles={roles} onChanged={load} onClose={() => setShowRoles(false)} />}

      {quickLedgerMember && (
        <QuickLedgerModal
          member={quickLedgerMember}
          onClose={() => setQuickLedgerMember(null)}
          onSaved={() => { setQuickLedgerMember(null); load(); }}
        />
      )}

      {showModal && (
        <AddCrewModal
          roles={roles}
          onClose={() => setShowModal(false)}
          onSaved={id => { setShowModal(false); navigate(`/crew/${id}`); }}
        />
      )}

      {deleteMember && (
        <ConfirmDialog
          title={`Delete ${deleteMember.name}?`}
          message="This cannot be undone."
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteMember(null)}
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

function CrewCard({ m, onOpen, onLedger }) {
  const owed = Number(m.owed_total) || 0;
  const tip = useMoneyTip();
  const sub = m.is_company ? m.service_type : m.role;
  return (
    <div
      className="db-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <span className="db-avatar">{m.is_company ? <Building2 size={17} /> : <User size={17} />}</span>
      <div className="db-main">
        <div className="db-name"><span>{m.name}</span></div>
        {sub && <div className="db-sub">{sub}</div>}
        <div className="db-meta">
          {Number(m.day_rate) > 0 && (
            <span className="db-chip" title="Day rate"><Private>{fmt(m.day_rate)}</Private></span>
          )}
          {owed > 0 && (
            <span className="db-owed" title={tip('Owed', owed)}>
              <span className="db-dot" /><Private>{fmt(owed)}</Private>
            </span>
          )}
        </div>
      </div>
      <div className="db-actions">
        <IconLink href={waUrl(m.phone)} title="WhatsApp"><MessageCircle size={15} /></IconLink>
        <button
          className="db-iconbtn"
          title="Ledger entry"
          aria-label="Ledger entry"
          onClick={e => { e.stopPropagation(); onLedger(); }}
          onKeyDown={e => e.stopPropagation()}
        >
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}

function RolesOverlay({ roles, onChanged, onClose }) {
  const [roleInput, setRoleInput] = useState('');
  const [err, setErr] = useState('');

  async function addRole() {
    if (!roleInput.trim()) return;
    try { await api.post('/crew/roles', { name: roleInput.trim() }); setRoleInput(''); setErr(''); onChanged(); }
    catch (e) { setErr(e.message); }
  }

  async function deleteRole(id) {
    try { await api.del(`/crew/roles/${id}`); setErr(''); onChanged(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <Overlay title="Crew Roles" onClose={onClose} guard={false} width={460} footer={
      <button className="btn btn-ghost" onClick={onClose}>Done</button>
    }>
      <div className="db-roles">
        {roles.map(r => (
          <span key={r.id} className="db-role">
            {r.name}
            {!r.is_default && (
              <button className="db-iconbtn danger" onClick={() => deleteRole(r.id)} title="Remove" aria-label={`Remove ${r.name}`}>
                <Trash2 size={11} />
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="flex-center gap-2">
        <input
          className="input" placeholder="New role"
          value={roleInput} onChange={e => setRoleInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addRole()}
        />
        <button className="db-iconbtn lg" onClick={addRole} title="Add role" aria-label="Add role"><Plus size={16} /></button>
      </div>
      {err && <div className="error-msg" style={{ marginTop: '10px' }}>{err}</div>}
    </Overlay>
  );
}

function QuickLedgerModal({ member, onClose, onSaved }) {
  const [form, setForm] = useState({ description: '', amount: '', date_incurred: pristinaToday(), notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.description.trim() || form.amount === '') return setErr('Description and amount required');
    setSaving(true);
    try {
      await api.post(`/crew/${member.id}/debts`, { ...form, status: 'unpaid' });
      onSaved();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <Overlay
      title={<span className="flex-center gap-2"><NotebookPen size={16} /> {member.name}</span>}
      label={`Ledger entry for ${member.name}`}
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
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} />
      </div>
      {err && <div className="error-msg">{err}</div>}
    </Overlay>
  );
}

// Shared by the Crew list (add) and CrewDetail (edit).
export function CrewFormFields({ form, f, isCompany, setIsCompany, roles }) {
  return (
    <>
      <div className="form-row">
        <IconToggles
          options={[
            { key: 'individual', Icon: User, title: 'Individual' },
            { key: 'company', Icon: Building2, title: 'Company' },
          ]}
          value={isCompany ? 'company' : 'individual'}
          onChange={k => setIsCompany(k === 'company')}
          label="Type"
        />
      </div>
      <div className="form-row">
        <label className="form-label">Name *</label>
        <input className="input" value={form.name} onChange={e => f('name', e.target.value)} autoFocus />
      </div>
      <div className="form-grid">
        {isCompany ? (
          <div className="form-row">
            <label className="form-label">Service Type</label>
            <input className="input" value={form.service_type} onChange={e => f('service_type', e.target.value)} placeholder="Rental House, Catering" />
          </div>
        ) : (
          <div className="form-row">
            <label className="form-label">Role</label>
            <select className="select" value={form.role} onChange={e => f('role', e.target.value)}>
              <option value=""></option>
              {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          </div>
        )}
        <div className="form-row">
          <label className="form-label">Day Rate €</label>
          <input type="number" min="0" className="input" value={form.day_rate} onChange={e => f('day_rate', e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Phone</label>
          <input className="input" value={form.phone} onChange={e => f('phone', e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Email</label>
          <input type="email" className="input" value={form.email} onChange={e => f('email', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Location</label>
        <input className="input" value={form.location} onChange={e => f('location', e.target.value)} placeholder="City, Country" />
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} />
      </div>
    </>
  );
}

function AddCrewModal({ roles, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [isCompany, setIsCompany] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.name.trim()) return setErr('Name is required');
    setSaving(true);
    try {
      const { id } = await api.post('/crew', {
        ...form, name: form.name.trim(), is_company: isCompany, day_rate: parseFloat(form.day_rate) || 0,
      });
      onSaved(id);
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <Overlay title="Add Crew" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </>}>
      <CrewFormFields form={form} f={f} isCompany={isCompany} setIsCompany={setIsCompany} roles={roles} />
      {err && <div className="error-msg">{err}</div>}
    </Overlay>
  );
}
