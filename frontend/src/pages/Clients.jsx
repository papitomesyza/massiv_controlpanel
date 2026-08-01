import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, MessageCircle, User, Building2, X, ChevronRight } from 'lucide-react';
import { api, fmt } from '../api';
import Modal from '../components/Modal';

function waUrl(phone) {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : null;
}

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name:'', company:'', phone:'', email:'', socials:'', notes:'' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [detailClient, setDetailClient] = useState(null);

  async function load() {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (sort !== 'newest') params.set('sort', sort);
    const data = await api.get(`/clients?${params}`);
    setClients(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [search, sort]);

  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function create() {
    if (!form.name) return setErr('Name is required');
    setSaving(true);
    try {
      await api.post('/clients', form);
      setShowModal(false);
      setForm({ name:'', company:'', phone:'', email:'', socials:'', notes:'' });
      setErr('');
      load();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Clients</div>
          <div className="page-subtitle">{clients.length} client{clients.length !== 1 ? 's' : ''}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={15} /> New Client</button>
      </div>

      <div className="filter-bar">
        <input
          className="input"
          style={{ maxWidth: '240px' }}
          placeholder="Search by name or company..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="select" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">Newest First</option>
          <option value="name">Name A–Z</option>
          <option value="revenue">Revenue High → Low</option>
          <option value="projects">Most Projects</option>
          <option value="outstanding">Outstanding Balance</option>
        </select>
      </div>

      {clients.length === 0 ? (
        <div className="card card-pad empty">No clients found</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card desktop-table-only">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Projects</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => {
                    const wa = waUrl(c.phone);
                    return (
                      <tr key={c.id}>
                        <td>
                          {c.company
                            ? <Building2 size={14} style={{ color: 'var(--color-mid-gray)' }} />
                            : <User size={14} style={{ color: 'var(--color-mid-gray)' }} />}
                        </td>
                        <td><Link to={`/clients/${c.id}`} className="link text-bold">{c.name}</Link></td>
                        <td className="text-2">{c.company || '—'}</td>
                        <td>
                          <div className="flex-center gap-1">
                            <span className="text-2 text-sm">{c.phone || '—'}</span>
                            {wa && (
                              <a href={wa} target="_blank" rel="noopener noreferrer" className="wa-btn" title="WhatsApp">
                                <MessageCircle size={14} />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="text-2 text-sm">{c.email || '—'}</td>
                        <td>{c.total_projects}</td>
                        <td>{fmt(c.total_revenue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile compact 2-per-row grid */}
          <div className="card mobile-people-grid-wrap">
            <div className="mobile-people-grid">
              {clients.map(c => (
                <button
                  key={c.id}
                  className="people-mini-card"
                  onClick={() => setDetailClient(c)}
                >
                  <div className="people-mini-name">
                    {c.company
                      ? <Building2 size={11} style={{ color: 'var(--color-mid-gray)', flexShrink: 0 }} />
                      : <User size={11} style={{ color: 'var(--color-mid-gray)', flexShrink: 0 }} />}
                    {c.name}
                  </div>
                  {c.company && <div className="people-mini-sub">{c.company}</div>}
                  {!c.company && c.total_projects > 0 && (
                    <div className="people-mini-sub">{c.total_projects} project{c.total_projects !== 1 ? 's' : ''}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Client detail sheet (mobile) */}
      {detailClient && (
        <ClientDetailSheet client={detailClient} onClose={() => setDetailClient(null)} />
      )}

      {showModal && (
        <Modal
          title="New Client"
          onClose={() => { setShowModal(false); setErr(''); }}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={create} disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
          </>}
        >
          <div className="form-row">
            <label className="form-label">Name *</label>
            <input className="input" value={form.name} onChange={e => f('name', e.target.value)} placeholder="Full name" />
          </div>
          <div className="form-row">
            <label className="form-label">Company</label>
            <input className="input" value={form.company} onChange={e => f('company', e.target.value)} placeholder="Company name" />
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
            <label className="form-label">Social Media</label>
            <input className="input" value={form.socials} onChange={e => f('socials', e.target.value)} placeholder="Instagram, LinkedIn, etc." />
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

function ClientDetailSheet({ client, onClose }) {
  const wa = waUrl(client.phone);
  return (
    <div className="detail-sheet-overlay" onClick={onClose}>
      <div className="detail-sheet-box" onClick={e => e.stopPropagation()}>
        <div className="detail-sheet-header">
          <div>
            <div style={{ fontWeight: 700, fontSize: '18px', color: 'var(--color-ink)', lineHeight: 1.2 }}>{client.name}</div>
            {client.company && <div style={{ fontSize: '13px', color: 'var(--color-mid-gray)', marginTop: '3px' }}>{client.company}</div>}
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {client.phone && (
            <div className="fin-row" style={{ padding: '10px 0' }}>
              <span className="text-2" style={{ fontSize: '12px' }}>Phone</span>
              <div className="flex-center gap-1">
                <span style={{ fontSize: '13px' }}>{client.phone}</span>
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="wa-btn">
                    <MessageCircle size={12} /> WA
                  </a>
                )}
              </div>
            </div>
          )}
          {client.email && (
            <div className="fin-row" style={{ padding: '10px 0' }}>
              <span className="text-2" style={{ fontSize: '12px' }}>Email</span>
              <span style={{ fontSize: '13px' }}>{client.email}</span>
            </div>
          )}
          <div className="fin-row" style={{ padding: '10px 0' }}>
            <span className="text-2" style={{ fontSize: '12px' }}>Projects</span>
            <span style={{ fontSize: '13px' }}>{client.total_projects}</span>
          </div>
          <div className="fin-row" style={{ padding: '10px 0', borderBottom: 'none' }}>
            <span className="text-2" style={{ fontSize: '12px' }}>Revenue</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-ink)' }}>{fmt(client.total_revenue)}</span>
          </div>
        </div>

        <div style={{ marginTop: '16px' }}>
          <Link
            to={`/clients/${client.id}`}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={onClose}
          >
            View Full Profile <ChevronRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}
