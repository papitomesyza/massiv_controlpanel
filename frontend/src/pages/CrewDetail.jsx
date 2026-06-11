import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit2, Archive, Building2, MessageCircle, DollarSign, Plus, Trash2, CheckCircle, Receipt, X } from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import Modal from '../components/Modal';
import StatCard from '../components/StatCard';

function waUrl(phone) {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : null;
}

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
  const [markPaidDate, setMarkPaidDate] = useState(new Date().toISOString().slice(0, 10));

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
    try {
      const dbs = await api.get(`/crew/${id}/debts`);
      setDebts(dbs);
    } catch (_) {}
  }

  useEffect(() => { load(); }, [id]);

  async function toggleArchive() {
    await api.put(`/crew/${id}/archive`, {});
    load();
  }

  if (loading) return <div className="loading">Loading...</div>;
  if (!data) return null;

  const { member, assignments } = data;
  const totalEarned = assignments.reduce((s, a) => s + a.total_cost, 0);
  const unpaidTotal = debts.filter(d => d.status === 'unpaid').reduce((s, d) => s + d.amount, 0);
  const paidTotal = debts.filter(d => d.status === 'paid').reduce((s, d) => s + d.amount, 0);
  const isCompany = !!member.is_company;
  const wa = waUrl(member.phone);

  return (
    <div>
      <div className="flex-between mb-4" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div className="flex-center gap-2">
          <Link to="/crew" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /></Link>
          <div>
            <div className="flex-center gap-2">
              {isCompany && <Building2 size={16} style={{ color: '#888' }} />}
              <div className="page-title">{member.name}</div>
            </div>
            {isCompany
              ? <div className="text-2 text-sm">{member.service_type || 'Company'}</div>
              : member.role && <div className="text-2 text-sm">{member.role}</div>
            }
          </div>
        </div>
        <div className="flex-center gap-2">
          {member.archived && <span className="badge badge-danger">Archived</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => setEditModal(true)}><Edit2 size={14} /> Edit</button>
          <button className="btn btn-ghost btn-sm" onClick={toggleArchive}><Archive size={14} /> {member.archived ? 'Restore' : 'Archive'}</button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <StatCard label="Total Earnings" value={fmt(totalEarned)} icon={<DollarSign size={18} />} />
        <StatCard label="Projects" value={assignments.length} />
        <StatCard label="Paid" value={assignments.filter(a => a.paid_status === 'paid').length + ' / ' + assignments.length} />
      </div>

      <div className="two-col">
        <div>
          <div className="card card-pad">
            <div className="section-title mb-3" style={{ marginBottom: '12px' }}>Contact Info</div>
            {member.phone && (
              <div className="fin-row">
                <span className="text-2 text-sm">{isCompany ? 'Phone' : 'Phone'}</span>
                <div className="flex-center gap-1">
                  <span className="text-sm">{member.phone}</span>
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="wa-btn" title="WhatsApp">
                      <MessageCircle size={14} />
                    </a>
                  )}
                </div>
              </div>
            )}
            {[
              [isCompany ? 'Service Type' : 'Role', isCompany ? member.service_type : member.role],
              ['Email', member.email],
              ['Location', member.location],
              [isCompany ? 'Rate (€)' : 'Day Rate', member.day_rate ? fmt(member.day_rate) : null],
            ].filter(([, v]) => v).map(([label, val]) => (
              <div key={label} className="fin-row">
                <span className="text-2 text-sm">{label}</span>
                <span className="text-sm">{val}</span>
              </div>
            ))}
            {member.notes && (
              <div style={{ marginTop: '12px' }}>
                <div className="text-xs text-2" style={{ marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Notes</div>
                <div className="text-sm" style={{ color: '#ccc' }}>{member.notes}</div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="section-title mb-3" style={{ marginBottom: '12px' }}>Project History</div>
          {assignments.length === 0 ? (
            <div className="card card-pad empty">No project assignments</div>
          ) : (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Role</th>
                      <th>Days</th>
                      <th>Rate</th>
                      <th>Total</th>
                      <th>Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map(a => (
                      <tr key={a.id}>
                        <td><Link to={`/projects/${a.project_id}`} className="link text-bold text-sm">{a.project_title}</Link></td>
                        <td className="text-2 text-sm">{a.role_on_project || a.crew_role || '—'}</td>
                        <td className="text-sm">{a.days}</td>
                        <td className="text-sm">{fmt(a.rate_per_day)}</td>
                        <td className="text-bold text-sm">{fmt(a.total_cost)}</td>
                        <td><span className={`badge ${a.paid_status === 'paid' ? 'badge-paid' : a.paid_status === 'partial' ? 'badge-partial' : 'badge-unpaid'}`}>{a.paid_status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transactions & Debts */}
      <div style={{ marginTop: '24px' }}>
        <div className="section-header" style={{ marginBottom: '12px' }}>
          <span className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Receipt size={15} style={{ color: '#888' }} />
            Transactions &amp; Debts
            {unpaidTotal > 0 && (
              <span style={{ background: '#FF4444', color: '#fff', fontSize: '10px', fontWeight: 700, borderRadius: '50px', padding: '2px 8px', lineHeight: 1.4 }}>
                {fmt(unpaidTotal)} owed
              </span>
            )}
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => setDebtModal({})}>
            <Plus size={13} /> Add Transaction
          </button>
        </div>

        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '16px' }}>
          <StatCard label="Total Owed" value={fmt(unpaidTotal)} danger={unpaidTotal > 0} />
          <StatCard label="Total Paid" value={fmt(paidTotal)} />
          <StatCard label="Total Transactions" value={debts.length} />
        </div>

        {debts.length === 0 ? (
          <div className="card card-pad empty">No transactions recorded</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th><th>Notes</th><th></th></tr>
                </thead>
                <tbody>
                  {debts.map(debt => (
                    <tr key={debt.id}>
                      <td className="text-sm text-2">{fmtDate(debt.date_incurred)}</td>
                      <td className="text-sm text-bold">{debt.description}</td>
                      <td className="text-bold">{fmt(debt.amount)}</td>
                      <td>
                        <span className={`badge ${debt.status === 'paid' ? 'badge-paid' : 'badge-unpaid'}`}>
                          {debt.status === 'paid' ? 'Paid' : 'Unpaid'}
                        </span>
                      </td>
                      <td className="text-2 text-xs">{debt.notes || '—'}</td>
                      <td>
                        <div className="flex-center gap-1">
                          {debt.status !== 'paid' && (
                            markPaidId === debt.id ? (
                              <div className="flex-center gap-1">
                                <input
                                  type="date"
                                  className="input"
                                  style={{ fontSize: '11px', padding: '3px 6px', width: '130px' }}
                                  value={markPaidDate}
                                  onChange={e => setMarkPaidDate(e.target.value)}
                                />
                                <button className="btn btn-primary btn-sm" style={{ fontSize: '11px' }} onClick={async () => {
                                  await api.put(`/crew/${id}/debts/${debt.id}`, { ...debt, status: 'paid', payment_date: markPaidDate });
                                  setMarkPaidId(null);
                                  loadDebts();
                                }}>Confirm</button>
                                <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px' }} onClick={() => setMarkPaidId(null)}>✕</button>
                              </div>
                            ) : (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: '11px', color: '#4CAF50' }}
                                onClick={() => { setMarkPaidId(debt.id); setMarkPaidDate(new Date().toISOString().slice(0, 10)); }}
                                title="Mark as Paid"
                              >
                                <CheckCircle size={13} /> Mark Paid
                              </button>
                            )
                          )}
                          <button className="btn btn-ghost btn-sm" onClick={() => setDebtModal(debt)} style={{ padding: '4px 6px' }}><Edit2 size={12} /></button>
                          <button className="btn btn-danger btn-sm" onClick={async () => {
                            await api.del(`/crew/${id}/debts/${debt.id}`);
                            loadDebts();
                          }} style={{ padding: '4px 6px' }}><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {editModal && <EditCrewModal member={member} crewId={id} roles={roles} onClose={() => setEditModal(false)} onSaved={load} />}
      {debtModal !== null && (
        <DebtModal debt={debtModal} crewId={id} onClose={() => setDebtModal(null)} onSaved={() => { setDebtModal(null); loadDebts(); }} />
      )}
    </div>
  );
}

function DebtModal({ debt, crewId, onClose, onSaved }) {
  const isEdit = !!debt?.id;
  const [form, setForm] = useState({
    description: debt?.description || '',
    amount: debt?.amount || '',
    date_incurred: debt?.date_incurred || new Date().toISOString().slice(0, 10),
    status: debt?.status || 'unpaid',
    payment_date: debt?.payment_date || '',
    notes: debt?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.description || !form.amount) return setErr('Description and amount required');
    setSaving(true);
    try {
      if (isEdit) await api.put(`/crew/${crewId}/debts/${debt.id}`, form);
      else await api.post(`/crew/${crewId}/debts`, form);
      onSaved();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <Modal title={isEdit ? 'Edit Transaction' : 'Add Transaction'} onClose={onClose} footer={<>
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
          <label className="form-label">Date Incurred</label>
          <input type="date" className="input" value={form.date_incurred} onChange={e => f('date_incurred', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Status</label>
        <select className="select" value={form.status} onChange={e => f('status', e.target.value)}>
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
        </select>
      </div>
      {form.status === 'paid' && (
        <div className="form-row">
          <label className="form-label">Payment Date</label>
          <input type="date" className="input" value={form.payment_date} onChange={e => f('payment_date', e.target.value)} />
        </div>
      )}
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Notes..." />
      </div>
      {err && <div className="error-msg">{err}</div>}
    </Modal>
  );
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
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/crew/${crewId}`, { ...form, is_company: isCompany, day_rate: parseFloat(form.day_rate) || 0 });
      onSaved(); onClose();
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  return (
    <Modal title="Edit Crew Member" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </>}>
      <div className="form-row">
        <div className="toggle-group">
          <button type="button" className={`toggle-btn ${!isCompany ? 'active' : ''}`} onClick={() => setIsCompany(false)}>Individual</button>
          <button type="button" className={`toggle-btn ${isCompany ? 'active' : ''}`} onClick={() => setIsCompany(true)}>Company</button>
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">{isCompany ? 'Company Name *' : 'Name *'}</label>
        <input className="input" value={form.name} onChange={e => f('name', e.target.value)} />
      </div>
      {isCompany ? (
        <>
          <div className="form-row">
            <label className="form-label">Service Type</label>
            <input className="input" value={form.service_type} onChange={e => f('service_type', e.target.value)} placeholder="e.g. Rental House..." />
          </div>
          <div className="form-row">
            <label className="form-label">Rate (€)</label>
            <input type="number" className="input" value={form.day_rate} onChange={e => f('day_rate', e.target.value)} />
          </div>
        </>
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
            <label className="form-label">Day Rate (€)</label>
            <input type="number" className="input" value={form.day_rate} onChange={e => f('day_rate', e.target.value)} />
          </div>
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
        <input className="input" value={form.location} onChange={e => f('location', e.target.value)} />
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} />
      </div>
    </Modal>
  );
}
