import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ChevronDown, ChevronRight, Trash2, Edit2, Archive, Building2, User, MessageCircle, FileDown, X } from 'lucide-react';
import { api, fmt } from '../api';
import Modal from '../components/Modal';

function waUrl(phone) {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : null;
}

export default function Crew() {
  const [crew, setCrew] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [roleInput, setRoleInput] = useState('');
  const [isCompany, setIsCompany] = useState(false);
  const [form, setForm] = useState({ name: '', role: '', phone: '', email: '', location: '', day_rate: '', notes: '', service_type: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [typeFilter, setTypeFilter] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [debtSummary, setDebtSummary] = useState({});
  const [quickDebtMember, setQuickDebtMember] = useState(null);

  async function load() {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (sort !== 'name') params.set('sort', sort);
    if (typeFilter) params.set('type', typeFilter);
    const [c, r, ds] = await Promise.all([
      api.get(`/crew?${params}`),
      api.get('/crew/roles'),
      api.get('/crew/debt-summary'),
    ]);
    setCrew(c); setRoles(r); setDebtSummary(ds || {}); setLoading(false);
  }

  useEffect(() => { load(); }, [search, sort, typeFilter]);

  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.name) return setErr('Name required');
    setSaving(true);
    try {
      if (editMember) {
        await api.put(`/crew/${editMember.id}`, { ...form, is_company: isCompany, day_rate: parseFloat(form.day_rate) || 0 });
      } else {
        await api.post('/crew', { ...form, is_company: isCompany, day_rate: parseFloat(form.day_rate) || 0 });
      }
      setShowModal(false); setEditMember(null);
      setForm({ name: '', role: '', phone: '', email: '', location: '', day_rate: '', notes: '', service_type: '' });
      setIsCompany(false);
      setErr(''); load();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  function openEdit(member) {
    setForm({
      name: member.name, role: member.role || '', phone: member.phone || '',
      email: member.email || '', location: member.location || '',
      day_rate: member.day_rate || '', notes: member.notes || '',
      service_type: member.service_type || '',
    });
    setIsCompany(!!member.is_company);
    setEditMember(member); setShowModal(true);
  }

  async function toggleArchive(member) {
    await api.put(`/crew/${member.id}/archive`, {});
    load();
  }

  async function addRole() {
    if (!roleInput.trim()) return;
    try { await api.post('/crew/roles', { name: roleInput.trim() }); setRoleInput(''); load(); }
    catch (e) { alert(e.message); }
  }

  async function deleteRole(id) {
    try { await api.del(`/crew/roles/${id}`); load(); }
    catch (e) { alert(e.message); }
  }

  async function exportPdf() {
    setPdfLoading(true);
    try { await api.download('/crew/payment-summary-pdf', 'MASSIV-Crew-Payment-Summary.pdf'); }
    catch (e) { alert(e.message); }
    setPdfLoading(false);
  }

  const active = crew.filter(c => !c.archived);
  const archived = crew.filter(c => c.archived);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Crew</div>
          <div className="page-subtitle">{active.length} active member{active.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="flex-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={exportPdf} disabled={pdfLoading}>
            <FileDown size={14} /> {pdfLoading ? 'Exporting...' : 'Export Payment Summary'}
          </button>
          <button className="btn btn-primary" onClick={() => {
            setEditMember(null);
            setForm({ name: '', role: '', phone: '', email: '', location: '', day_rate: '', notes: '', service_type: '' });
            setIsCompany(false); setShowModal(true);
          }}>
            <Plus size={15} /> Add Crew
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <input
          className="input"
          style={{ maxWidth: '220px' }}
          placeholder="Search by name or role..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="toggle-group">
          <button type="button" className={`toggle-btn ${typeFilter === '' ? 'active' : ''}`} onClick={() => setTypeFilter('')}>All</button>
          <button type="button" className={`toggle-btn ${typeFilter === 'individual' ? 'active' : ''}`} onClick={() => setTypeFilter('individual')}>Individual</button>
          <button type="button" className={`toggle-btn ${typeFilter === 'company' ? 'active' : ''}`} onClick={() => setTypeFilter('company')}>Company</button>
        </div>
        <select className="select" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="name">Name A–Z</option>
          <option value="rate_high">Rate High → Low</option>
          <option value="rate_low">Rate Low → High</option>
          <option value="earned_high">Total Earned High → Low</option>
        </select>
      </div>

      {active.length === 0 ? (
        <div className="card card-pad empty">No crew members found</div>
      ) : (
        <div className="card mb-4" style={{ marginBottom: '24px' }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th></th><th>Name</th><th>Role / Type</th><th>Location</th><th>Rate</th><th>Phone</th><th></th></tr>
              </thead>
              <tbody>
                {active.map(member => {
                  const wa = waUrl(member.phone);
                  return (
                    <tr key={member.id}>
                      <td style={{ width: '32px', paddingRight: 0 }}>
                        {member.is_company
                          ? <Building2 size={14} style={{ color: '#888' }} />
                          : <User size={14} style={{ color: '#666' }} />}
                      </td>
                      <td>
                        <div className="flex-center gap-1">
                          <Link to={`/crew/${member.id}`} className="link text-bold">{member.name}</Link>
                          {debtSummary[member.id] > 0 && (
                            <div
                              style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#FF4444', flexShrink: 0 }}
                              title={`€${Number(debtSummary[member.id]).toFixed(2)} in unpaid debts`}
                            />
                          )}
                        </div>
                      </td>
                      <td className="text-2">{member.is_company ? (member.service_type || 'Company') : (member.role || '—')}</td>
                      <td className="text-2 text-sm">{member.location || '—'}</td>
                      <td>{fmt(member.day_rate)}</td>
                      <td>
                        <div className="flex-center gap-1">
                          <span className="text-2 text-sm">{member.phone || '—'}</span>
                          {wa && (
                            <a href={wa} target="_blank" rel="noopener noreferrer" className="wa-btn" title="WhatsApp">
                              <MessageCircle size={13} />
                            </a>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex-center gap-1">
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: '11px', borderRadius: '50px', color: '#FF902F', padding: '3px 8px' }}
                            onClick={() => setQuickDebtMember(member)}
                            title="Add Transaction"
                          >
                            <Plus size={11} /> Txn
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(member)}><Edit2 size={13} /></button>
                          <button className="btn btn-ghost btn-sm" onClick={() => toggleArchive(member)} title="Archive"><Archive size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <button
            className="flex-center gap-2"
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '8px 0', fontSize: '13px' }}
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            Archived ({archived.length})
          </button>
          {showArchived && (
            <div className="card" style={{ marginTop: '8px' }}>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Role</th><th></th></tr></thead>
                  <tbody>
                    {archived.map(member => (
                      <ArchivedCrewRow key={member.id} member={member} onRestore={toggleArchive} onDeleted={load} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Roles */}
      <div className="card card-pad">
        <div className="section-title" style={{ marginBottom: '12px' }}>Crew Roles</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
          {roles.map(r => (
            <div key={r.id} className="flex-center gap-1" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 10px', fontSize: '12px' }}>
              <span>{r.name}</span>
              {!r.is_default && (
                <button onClick={() => deleteRole(r.id)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0 0 0 4px', lineHeight: 1 }}>
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex-center gap-2">
          <input
            className="input" style={{ maxWidth: '200px' }} placeholder="Add custom role..."
            value={roleInput} onChange={e => setRoleInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addRole()}
          />
          <button className="btn btn-ghost btn-sm" onClick={addRole}><Plus size={13} /> Add</button>
        </div>
      </div>

      {quickDebtMember && (
        <QuickDebtModal
          member={quickDebtMember}
          onClose={() => setQuickDebtMember(null)}
          onSaved={() => { setQuickDebtMember(null); load(); }}
        />
      )}

      {showModal && (
        <Modal
          title={editMember ? 'Edit Crew Member' : 'Add Crew Member'}
          onClose={() => { setShowModal(false); setErr(''); setEditMember(null); setIsCompany(false); }}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </>}
        >
          <div className="form-row">
            <div className="toggle-group">
              <button type="button" className={`toggle-btn ${!isCompany ? 'active' : ''}`} onClick={() => setIsCompany(false)}>Individual</button>
              <button type="button" className={`toggle-btn ${isCompany ? 'active' : ''}`} onClick={() => setIsCompany(true)}>Company</button>
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">{isCompany ? 'Company Name *' : 'Name *'}</label>
            <input className="input" value={form.name} onChange={e => f('name', e.target.value)} placeholder={isCompany ? 'Company name' : 'Full name'} />
          </div>
          {isCompany ? (
            <div className="form-row">
              <label className="form-label">Service Type</label>
              <input className="input" value={form.service_type} onChange={e => f('service_type', e.target.value)} placeholder="e.g. Rental House, Catering..." />
            </div>
          ) : (
            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Role</label>
                <select className="select" value={form.role} onChange={e => f('role', e.target.value)}>
                  <option value="">Select role</option>
                  {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label className="form-label">{isCompany ? 'Rate (€)' : 'Day Rate (€)'}</label>
                <input type="number" className="input" value={form.day_rate} onChange={e => f('day_rate', e.target.value)} placeholder="0.00" />
              </div>
            </div>
          )}
          {isCompany && (
            <div className="form-row">
              <label className="form-label">Rate (€)</label>
              <input type="number" className="input" value={form.day_rate} onChange={e => f('day_rate', e.target.value)} placeholder="0.00" />
            </div>
          )}
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
            <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Notes..." />
          </div>
          {err && <div className="error-msg">{err}</div>}
        </Modal>
      )}
    </div>
  );
}

function QuickDebtModal({ member, onClose, onSaved }) {
  const [form, setForm] = useState({
    description: '',
    amount: '',
    date_incurred: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.description || !form.amount) return setErr('Description and amount required');
    setSaving(true);
    try {
      await api.post(`/crew/${member.id}/debts`, { ...form, status: 'unpaid' });
      onSaved();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <Modal title={`+ Transaction — ${member.name}`} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </>}>
      <div className="form-row">
        <label className="form-label">Description *</label>
        <input className="input" value={form.description} onChange={e => f('description', e.target.value)} placeholder="Description" autoFocus />
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Amount € *</label>
          <input type="number" className="input" value={form.amount} onChange={e => f('amount', e.target.value)} placeholder="0.00" />
        </div>
        <div className="form-row">
          <label className="form-label">Date</label>
          <input type="date" className="input" value={form.date_incurred} onChange={e => f('date_incurred', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Notes..." />
      </div>
      {err && <div className="error-msg">{err}</div>}
    </Modal>
  );
}

function ArchivedCrewRow({ member, onRestore, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    setDeleting(true);
    try {
      await api.del(`/crew/${member.id}`);
      onDeleted();
    } catch (_) { setDeleting(false); }
  }

  return (
    <tr style={{ opacity: 0.5 }}>
      <td>{member.name}</td>
      <td className="text-2">{member.is_company ? (member.service_type || 'Company') : (member.role || '—')}</td>
      <td>
        {confirming ? (
          <div className="flex-center gap-1" style={{ flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: '#FF4444', whiteSpace: 'nowrap' }}>
              Permanently delete {member.name}? This cannot be undone.
            </span>
            <button className="btn btn-danger btn-sm" style={{ fontSize: '11px' }} onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Confirm'}
            </button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px' }} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex-center gap-1">
            <button className="btn btn-ghost btn-sm" onClick={() => onRestore(member)}>Restore</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)} title="Permanently delete" style={{ color: '#FF4444' }}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
