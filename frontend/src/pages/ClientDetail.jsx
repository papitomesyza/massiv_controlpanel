import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit2, AlertCircle, MessageCircle } from 'lucide-react';
import { api, fmt } from '../api';
import Modal from '../components/Modal';
import StatCard from '../components/StatCard';

function waUrl(phone) {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : null;
}

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(false);

  async function load() {
    try {
      const d = await api.get(`/clients/${id}`);
      setData(d);
    } catch { navigate('/clients'); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="loading">Loading...</div>;
  if (!data) return null;

  const { client, projects, outstandingPayments, stats } = data;
  const totalOutstanding = (outstandingPayments || []).reduce((s, p) => s + p.amount, 0);
  const wa = waUrl(client.phone);

  return (
    <div>
      <div className="flex-between mb-4" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div className="flex-center gap-2">
          <Link to="/clients" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /></Link>
          <div>
            <div className="page-title">{client.name}</div>
            {client.company && <div className="text-2 text-sm">{client.company}</div>}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditModal(true)}><Edit2 size={14} /> Edit</button>
      </div>

      <div className="stats-grid" style={{ marginBottom: '16px' }}>
        <StatCard label="Total Projects" value={stats.totalProjects} />
        <StatCard label="Total Revenue" value={fmt(stats.totalRevenue)} />
        <StatCard label="Total Profit" value={fmt(stats.totalProfit)} danger={stats.totalProfit < 0} />
      </div>

      {/* Outstanding Balance Alert — per project (agreed_budget minus received) */}
      {totalOutstanding > 0 && (
        <div className="outstanding-alert" style={{ marginBottom: '20px' }}>
          <div className="flex-center gap-2" style={{ marginBottom: '10px' }}>
            <AlertCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
            <span className="text-bold text-danger">Pending Payments: {fmt(totalOutstanding)}</span>
          </div>
          {outstandingPayments.map(p => (
            <div key={p.project_id} className="flex-between text-sm" style={{ padding: '4px 0' }}>
              <span className="text-2">{p.project_title}</span>
              <span className="text-danger">{fmt(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="two-col">
        <div>
          <div className="card card-pad">
            <div className="section-title mb-3" style={{ marginBottom: '12px' }}>Contact Info</div>
            {client.phone && (
              <div className="fin-row">
                <span className="text-2 text-sm">Phone</span>
                <div className="flex-center gap-1">
                  <span className="text-sm">{client.phone}</span>
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="wa-btn" title="WhatsApp">
                      <MessageCircle size={14} />
                    </a>
                  )}
                </div>
              </div>
            )}
            {client.email && (
              <div className="fin-row">
                <span className="text-2 text-sm">Email</span>
                <span className="text-sm">{client.email}</span>
              </div>
            )}
            {client.socials && (
              <div className="fin-row">
                <span className="text-2 text-sm">Social</span>
                <span className="text-sm">{client.socials}</span>
              </div>
            )}
            {client.notes && (
              <div style={{ marginTop: '12px' }}>
                <div className="text-xs text-2" style={{ marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Notes</div>
                <div className="text-sm" style={{ color: 'var(--color-ink-soft)' }}>{client.notes}</div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="section-title mb-3" style={{ marginBottom: '12px' }}>Projects</div>
          {projects.length === 0 ? (
            <div className="card card-pad empty">No projects</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {projects.map(p => {
                const profit = p.total_received - p.total_crew_cost - p.total_expenses;
                return (
                  <Link key={p.id} to={`/projects/${p.id}`} style={{ textDecoration: 'none' }}>
                    <div className="card card-pad-sm">
                      <div className="flex-between mb-2">
                        <span className="text-bold">{p.title}</span>
                        <StatusBadge status={p.status} />
                      </div>
                      <div className="flex-between text-sm text-2">
                        <span>{p.category_name || '—'}</span>
                        <span>{fmt(p.agreed_budget)} budget</span>
                      </div>
                      <div className="flex-between text-sm mt-1">
                        <span className="text-2">Received: {fmt(p.total_received)}</span>
                        <span className={profit < 0 ? 'text-danger' : ''}>{fmt(profit)} profit</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editModal && (
        <EditClientModal client={client} clientId={id} onClose={() => setEditModal(false)} onSaved={load} />
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    'development':     'badge-development',
    'pre-production':  'badge-pre-production',
    'production':      'badge-production',
    'post-production': 'badge-post-production',
    'completed':       'badge-completed',
  };
  return <span className={`badge ${map[status] || 'badge-pending'}`}>{status?.replace(/-/g, ' ')}</span>;
}

function EditClientModal({ client, clientId, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: client.name || '',
    company: client.company || '',
    phone: client.phone || '',
    email: client.email || '',
    socials: client.socials || '',
    notes: client.notes || '',
  });
  const [saving, setSaving] = useState(false);
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    setSaving(true);
    try { await api.put(`/clients/${clientId}`, form); onSaved(); onClose(); }
    catch (e) { alert(e.message); }
    setSaving(false);
  }

  return (
    <Modal title="Edit Client" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </>}>
      <div className="form-row">
        <label className="form-label">Name *</label>
        <input className="input" value={form.name} onChange={e => f('name', e.target.value)} />
      </div>
      <div className="form-row">
        <label className="form-label">Company</label>
        <input className="input" value={form.company} onChange={e => f('company', e.target.value)} />
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
        <label className="form-label">Socials</label>
        <input className="input" value={form.socials} onChange={e => f('socials', e.target.value)} />
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} />
      </div>
    </Modal>
  );
}
