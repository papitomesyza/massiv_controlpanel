import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, MessageCircle, Mail, User, Building2, Users, Clock, ArrowDownAZ, TrendingUp, CircleDollarSign,
} from 'lucide-react';
import { api, fmt } from '../api';
import { Private } from '../context/PrivacyContext';
import Overlay from '../components/Overlay';
import Ring from '../components/Ring';
import { waUrl, mailUrl, IconToggles, IconLink, useMoneyTip, useDebounced } from '../components/DbBits';

const SORTS = [
  { key: 'newest',      Icon: Clock,            title: 'Newest' },
  { key: 'name',        Icon: ArrowDownAZ,      title: 'A to Z' },
  { key: 'revenue',     Icon: TrendingUp,       title: 'Revenue' },
  { key: 'outstanding', Icon: CircleDollarSign, title: 'Owed' },
];

const EMPTY_FORM = { name: '', company: '', phone: '', email: '', socials: '', notes: '' };

export default function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  // The search term reloads 250 ms after typing stops.
  const query = useDebounced(search, 250);
  const [sort, setSort] = useState('newest');

  async function load() {
    const params = new URLSearchParams();
    if (query) params.set('search', query);
    if (sort !== 'newest') params.set('sort', sort);
    try {
      setClients(await api.get(`/clients?${params}`));
      setLoadErr('');
    } catch (e) { setLoadErr(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [query, sort]);

  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  function closeModal() { setShowModal(false); setErr(''); setForm(EMPTY_FORM); }

  async function create() {
    if (!form.name.trim()) return setErr('Name is required');
    setSaving(true);
    try {
      const { id } = await api.post('/clients', { ...form, name: form.name.trim() });
      closeModal();
      navigate(`/clients/${id}`);
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Clients</div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)} title="New client" aria-label="New client">
          <Plus size={16} />
        </button>
      </div>

      <div className="db-toolbar">
        <input
          className="input"
          placeholder="Search"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <IconToggles options={SORTS} value={sort} onChange={setSort} label="Sort" />
      </div>

      {loadErr && <div className="error-msg" style={{ marginBottom: '12px' }}>{loadErr}</div>}

      {clients.length === 0 ? (
        <div className="card db-empty"><Users size={28} /></div>
      ) : (
        <div className="db-grid">
          {clients.map(c => <ClientCard key={c.id} c={c} onOpen={() => navigate(`/clients/${c.id}`)} />)}
        </div>
      )}

      {showModal && (
        <Overlay
          title="New Client"
          onClose={closeModal}
          footer={<>
            <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
            <button className="btn btn-primary" onClick={create} disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
          </>}
        >
          <ClientFormFields form={form} f={f} />
          {err && <div className="error-msg">{err}</div>}
        </Overlay>
      )}
    </div>
  );
}

function ClientCard({ c, onOpen }) {
  const received = Number(c.total_revenue) || 0;
  const owed = Number(c.owed_total) || 0;
  const pending = Number(c.owed_pending) || 0;
  const tip = useMoneyTip();
  return (
    <div
      className="db-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <span className="db-avatar">{c.company ? <Building2 size={17} /> : <User size={17} />}</span>
      <div className="db-main">
        <div className="db-name">
          <span>{c.name}</span>
          {pending > 0 && <span className="db-dot" title={tip('Pending', pending)} />}
        </div>
        {c.company && <div className="db-sub">{c.company}</div>}
        <div className="db-meta">
          <span className="db-count" title={`${c.total_projects} project${c.total_projects === 1 ? '' : 's'}`}>
            <span className="db-dot" />{c.total_projects}
          </span>
          <span className="db-money"><Private>{fmt(received)}</Private></span>
        </div>
      </div>
      <div className="db-actions">
        <IconLink href={waUrl(c.phone)} title="WhatsApp"><MessageCircle size={15} /></IconLink>
        <IconLink href={mailUrl(c.email)} title="Email" external={false}><Mail size={15} /></IconLink>
        <Ring
          value={received}
          max={received + owed}
          size={26}
          title={owed > 0 ? tip('Owed', owed) : undefined}
        />
      </div>
    </div>
  );
}

export function ClientFormFields({ form, f }) {
  return (
    <>
      <div className="form-row">
        <label className="form-label">Name *</label>
        <input className="input" value={form.name} onChange={e => f('name', e.target.value)} placeholder="Full name" autoFocus />
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
        <input className="input" value={form.socials} onChange={e => f('socials', e.target.value)} placeholder="Instagram, LinkedIn, website" />
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} />
      </div>
    </>
  );
}
