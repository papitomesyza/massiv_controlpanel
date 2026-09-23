import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit2, Trash2, MessageCircle, Mail, Phone, AtSign, User, Building2, FolderOpen,
} from 'lucide-react';
import { api, fmt } from '../api';
import Overlay from '../components/Overlay';
import ConfirmDialog from '../components/ConfirmDialog';
import Donut from '../components/Donut';
import Ring from '../components/Ring';
import { Private } from '../context/PrivacyContext';
import { waUrl, mailUrl, telUrl, socialUrl, StatusDot, IconLink, useMoneyTip } from '../components/DbBits';
import { ClientFormFields } from './Clients';

// Slice colours: received in ink, pending in ember, upcoming muted.
const SLICES = [
  { key: 'received', name: 'Received', color: 'var(--color-ink)' },
  { key: 'pending',  name: 'Pending',  color: 'var(--color-ember)' },
  { key: 'upcoming', name: 'Upcoming', color: 'var(--color-hairline-strong)' },
];

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const tip = useMoneyTip();

  async function load() {
    try {
      setData(await api.get(`/clients/${id}`));
    } catch { navigate('/clients'); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function doDelete() {
    setDeleting(true);
    try {
      await api.del(`/clients/${id}`);
      navigate('/clients');
    } catch (e) {
      setConfirmDelete(false);
      setNotice(e.message);
    }
    setDeleting(false);
  }

  if (loading) return <div className="loading">Loading...</div>;
  if (!data) return null;

  const { client, projects, owed, stats } = data;
  const figures = { received: stats.totalRevenue, pending: owed.pending, upcoming: owed.upcoming };
  const slices = SLICES.map(s => ({ ...s, total: Number(figures[s.key]) || 0 }));
  const donutData = slices.filter(s => s.total > 0);
  const social = socialUrl(client.socials);

  return (
    <div>
      <div className="db-head">
        <Link to="/clients" className="db-iconbtn lg" title="Clients" aria-label="Back to clients"><ArrowLeft size={16} /></Link>
        <span className="db-avatar">{client.company ? <Building2 size={18} /> : <User size={18} />}</span>
        <div className="db-main">
          <div className="page-title">{client.name}</div>
          {client.company && <div className="db-title-sub">{client.company}</div>}
        </div>
        <div className="db-actions">
          <IconLink href={waUrl(client.phone)} title="WhatsApp"><MessageCircle size={16} /></IconLink>
          <IconLink href={mailUrl(client.email)} title="Email" external={false}><Mail size={16} /></IconLink>
          <button className="db-iconbtn" onClick={() => setEditModal(true)} title="Edit" aria-label="Edit"><Edit2 size={16} /></button>
          <button className="db-iconbtn danger" onClick={() => setConfirmDelete(true)} title="Delete" aria-label="Delete"><Trash2 size={16} /></button>
        </div>
      </div>

      <div className="db-split" style={{ marginBottom: '16px' }}>
        <div className="card db-panel">
          <div className="db-summary">
            {donutData.length > 0 ? (
              <Donut data={donutData} colorFor={(i, e) => e.color} height={220} />
            ) : (
              <Ring value={0} max={0} size={120} stroke={10} />
            )}
            <div className="db-figures">
              {slices.map(s => (
                <div key={s.key} className="db-figure" title={s.name}>
                  <span className="db-dot" style={{ background: s.color }} />
                  <span className={s.key === 'pending' && s.total > 0 ? 'db-owed' : 'db-money'}>
                    <Private>{fmt(s.total)}</Private>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card db-panel">
          <div className="db-contact">
            {client.phone && (
              <IconLink href={telUrl(client.phone)} title={client.phone} external={false}><Phone size={16} /></IconLink>
            )}
            {client.email && (
              <IconLink href={mailUrl(client.email)} title={client.email} external={false}><Mail size={16} /></IconLink>
            )}
            {client.socials && (social ? (
              <IconLink href={social} title={client.socials}><AtSign size={16} /></IconLink>
            ) : (
              <span className="db-iconbtn" title={client.socials} aria-label={client.socials}><AtSign size={16} /></span>
            ))}
          </div>
          {client.notes && <div className="db-notes">{client.notes}</div>}
        </div>
      </div>

      <div className="card">
        {projects.length === 0 ? (
          <div className="db-empty"><FolderOpen size={26} /></div>
        ) : (
          <div className="db-list">
            {projects.map(p => {
              const profit = p.total_received - p.total_crew_cost - p.total_expenses;
              const agreed = Number(p.agreed_budget) || 0;
              return (
                <Link key={p.id} to={`/projects/${p.id}`} className="db-row">
                  <StatusDot status={p.status} />
                  <span className="db-row-title">{p.title}</span>
                  <Ring
                    value={p.total_received}
                    max={agreed}
                    size={22}
                    title={agreed > 0 ? tip('Received', p.total_received) : undefined}
                  />
                  <span className={`db-money ${profit < 0 ? 'neg' : ''}`} style={{ minWidth: '90px', textAlign: 'right' }}>
                    <Private>{fmt(profit)}</Private>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {editModal && (
        <EditClientModal client={client} clientId={id} onClose={() => setEditModal(false)} onSaved={load} />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${client.name}?`}
          message="This cannot be undone."
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {notice && (
        <ConfirmDialog
          title="Cannot delete"
          message={notice}
          confirmLabel="OK"
          cancelLabel={null}
          onConfirm={() => setNotice('')}
          onCancel={() => setNotice('')}
        />
      )}
    </div>
  );
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
  const [err, setErr] = useState('');
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.name.trim()) return setErr('Name is required');
    setSaving(true);
    try {
      await api.put(`/clients/${clientId}`, { ...form, name: form.name.trim() });
      onSaved(); onClose();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <Overlay title="Edit Client" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </>}>
      <ClientFormFields form={form} f={f} />
      {err && <div className="error-msg">{err}</div>}
    </Overlay>
  );
}
