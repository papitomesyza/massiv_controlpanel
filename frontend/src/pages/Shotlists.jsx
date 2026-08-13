import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListVideo, Plus, Link2, Check, Trash2, ArrowLeft } from 'lucide-react';
import { api, fmtDate } from '../api';
import Modal from '../components/Modal';

const STATUS_BADGE = {
  draft: 'badge badge-pending',
  published: 'badge badge-active',
};

function NewShotlistModal({ projects, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [shootDate, setShootDate] = useState('');
  const [callTime, setCallTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Linking a project prefills the title and the shoot date from it.
  function linkProject(value) {
    setProjectId(value);
    const project = projects.find(p => String(p.id) === String(value));
    if (!project) return;
    if (!title.trim()) setTitle(project.title);
    if (!shootDate && project.shoot_date) setShootDate(String(project.shoot_date).slice(0, 10));
  }

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) { setError('Give the shot list a name'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post('/shotlists', {
        title: title.trim(),
        project_id: projectId || null,
        shoot_date: shootDate || null,
        call_time: callTime || null,
      });
      onCreated(res.id);
    } catch (err) {
      setError(err.message || 'Could not create the shot list');
      setSaving(false);
    }
  }

  return (
    <Modal title="New shot list" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-row">
          <label className="form-label">Title *</label>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Nike SS26 — Day 1" autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">Project</label>
          <select className="select" style={{ width: '100%' }} value={projectId} onChange={e => linkProject(e.target.value)}>
            <option value="">— none —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div className="form-row" style={{ flex: 1 }}>
            <label className="form-label">Shoot date</label>
            <input className="input" type="date" value={shootDate} onChange={e => setShootDate(e.target.value)} />
          </div>
          <div className="form-row" style={{ flex: 1 }}>
            <label className="form-label">Call time</label>
            <input className="input" type="time" value={callTime} onChange={e => setCallTime(e.target.value)} />
          </div>
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ShotlistCard({ shotlist, base, onDelete }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const publicUrl = shotlist.slug ? `${base.base}/shotlist/${shotlist.slug}` : null;
  const isPublished = shotlist.status === 'published';

  async function copyLink(e) {
    e.stopPropagation();
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = publicUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card shotlist-card" onClick={() => navigate(`/production/shotlists/${shotlist.id}`)}>
      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: '7px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', flex: 1, minWidth: 0 }}>{shotlist.title}</span>
          <span className={STATUS_BADGE[shotlist.status] || 'badge badge-pending'}>{shotlist.status}</span>
        </div>
        {shotlist.project_title && (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{shotlist.project_title}</span>
        )}
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {shotlist.shoot_date ? fmtDate(shotlist.shoot_date) : 'No shoot date'}
          {shotlist.call_time ? ` · call ${shotlist.call_time}` : ''}
          {` · ${shotlist.scene_count} scene${shotlist.scene_count === 1 ? '' : 's'}`}
          {` · ${shotlist.shot_count} shot${shotlist.shot_count === 1 ? '' : 's'}`}
          {shotlist.completed_count > 0 ? ` · ${shotlist.completed_count} done` : ''}
        </span>
        <div style={{ display: 'flex', gap: '4px', marginTop: 'auto', paddingTop: '8px' }} onClick={e => e.stopPropagation()}>
          {isPublished && publicUrl && (
            <button
              className="btn-ghost"
              style={{ padding: '5px 7px', color: copied ? 'var(--success)' : undefined }}
              title={`Copy public link (${base.host})`}
              onClick={copyLink}
            >
              {copied ? <Check size={13} /> : <Link2 size={13} />}
            </button>
          )}
          <button
            className="btn-ghost"
            style={{ padding: '5px 7px', color: 'var(--danger)', marginLeft: 'auto' }}
            title="Delete"
            onClick={() => onDelete(shotlist)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Shotlists() {
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [base, setBase] = useState({ base: window.location.origin, host: window.location.host, custom: false });

  async function load() {
    try {
      const data = await api.get('/shotlists');
      setLists(data);
    } catch (_) {}
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    api.get('/projects').then(p => setProjects(Array.isArray(p) ? p : [])).catch(() => {});
    api.get('/shotlists/public-base').then(b => { if (b && b.base) setBase(b); }).catch(() => {});
  }, []);

  async function handleDelete(shotlist) {
    if (!confirm(`Delete "${shotlist.title}"? Its scenes, shots, locations and activity go with it.${shotlist.status === 'published' ? ' The public link will stop working.' : ''}`)) return;
    try {
      await api.del(`/shotlists/${shotlist.id}`);
      await load();
    } catch (err) { alert(err.message || 'Failed to delete'); }
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <button className="btn-ghost" style={{ padding: '6px 8px' }} onClick={() => navigate('/production')} title="Back to Production">
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">Shot Lists</h1>
          <p className="page-subtitle">A timed day plan the crew can open on a phone.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New shot list
        </button>
      </div>

      {loading ? null : lists.length === 0 ? (
        <div className="card" style={{ padding: '48px 20px', textAlign: 'center' }}>
          <ListVideo size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px', display: 'block' }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            No shot lists yet. Create one to plan a shoot day, scene by scene.
          </p>
        </div>
      ) : (
        <div className="pitch-card-grid">
          {lists.map(s => (
            <ShotlistCard key={s.id} shotlist={s} base={base} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showNew && (
        <NewShotlistModal
          projects={projects}
          onClose={() => setShowNew(false)}
          onCreated={id => navigate(`/production/shotlists/${id}`)}
        />
      )}
    </div>
  );
}
