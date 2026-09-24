import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListVideo, Plus, Link2, Trash2, ArrowLeft } from 'lucide-react';
import { api, fmtDate } from '../api';
import Overlay from '../components/Overlay';
import ConfirmDialog from '../components/ConfirmDialog';
import DateField from '../components/DateField';
import IconMenu from '../components/IconMenu';
import Ring from '../components/Ring';
import '../styles/mind.css';
import '../styles/production.css';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

// A linked shot list whose first day no longer reads the project's shoot date.
function dateDrift(firstDate, projectDate, linked) {
  if (!linked || !projectDate) return false;
  return String(firstDate || '').slice(0, 10) !== String(projectDate).slice(0, 10);
}

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
    <Overlay
      title="New shot list"
      onClose={onClose}
      width={460}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="shotlist-new" className="btn btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
      </>}
    >
      <form id="shotlist-new" onSubmit={submit}>
        <div className="form-row">
          <label className="form-label">Title</label>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">Project</label>
          <select className="select" style={{ width: '100%' }} value={projectId} onChange={e => linkProject(e.target.value)}>
            <option value="" />
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div className="form-row" style={{ flex: 1 }}>
            <label className="form-label">Shoot date</label>
            <DateField value={shootDate} onChange={setShootDate} />
          </div>
          <div className="form-row" style={{ flex: 1 }}>
            <label className="form-label">Call time</label>
            <input className="input" type="time" value={callTime} onChange={e => setCallTime(e.target.value)} />
          </div>
        </div>
        {error && <p className="prod-error">{error}</p>}
      </form>
    </Overlay>
  );
}

function ShotlistCard({ shotlist, base, onOpen, onCopy, onDelete }) {
  const isPublished = shotlist.status === 'published';
  const publicUrl = shotlist.slug ? `${base.base}/shotlist/${shotlist.slug}` : null;
  const firstDate = shotlist.first_day_date || shotlist.shoot_date;
  const drift = dateDrift(firstDate, shotlist.project_shoot_date, !!shotlist.project_id);
  const total = Number(shotlist.shot_count) || 0;
  const done = Number(shotlist.completed_count) || 0;

  return (
    <div
      className="db-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <Ring value={done} max={total} size={34} stroke={3} title={`${done} / ${total}`}>
        <ListVideo size={13} />
      </Ring>
      <div className="db-main">
        <div className="db-name">
          <span>{shotlist.title}</span>
          <span className="prod-dots">
            {isPublished && <span className="db-dot ink" title="Published" />}
            {drift && <span className="db-dot" title={`Project ${fmtDate(shotlist.project_shoot_date)}`} />}
          </span>
        </div>
        {shotlist.project_title && <div className="db-sub">{shotlist.project_title}</div>}
        {firstDate && (
          <div className="db-meta">
            <span className="prod-date">{fmtDate(firstDate)}</span>
          </div>
        )}
      </div>
      <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <IconMenu items={[
          isPublished && publicUrl && { key: 'link', Icon: Link2, title: `Copy link (${base.host})`, onClick: () => onCopy(publicUrl) },
          { key: 'delete', Icon: Trash2, title: 'Delete', danger: true, onClick: () => onDelete(shotlist) },
        ]} />
      </span>
    </div>
  );
}

export default function Shotlists() {
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [base, setBase] = useState({ base: window.location.origin, host: window.location.host, custom: false });

  async function load() {
    try {
      const data = await api.get('/shotlists');
      setLists(data);
      setLoadErr('');
    } catch (err) {
      setLoadErr(err.message || 'Could not load the shot lists');
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    api.get('/projects')
      .then(p => setProjects(Array.isArray(p) ? p : []))
      .catch(err => setLoadErr(err.message || 'Could not load the projects'));
    // The public base only changes the copied link; the current origin stands
    // in until it answers.
    api.get('/shotlists/public-base').then(b => { if (b && b.base) setBase(b); }).catch(() => { /* the current origin stays */ });
  }, []);

  async function runDelete() {
    const shotlist = confirmDelete;
    setDeleting(true);
    try {
      await api.del(`/shotlists/${shotlist.id}`);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setConfirmDelete(null);
      setNotice({ title: 'Not deleted', message: err.message || 'The shot list could not be deleted.' });
    }
    setDeleting(false);
  }

  async function handleCopy(url) {
    if (!(await copyText(url))) setNotice({ title: 'Not copied', message: 'The browser did not allow copying.' });
  }

  return (
    <div>
      <div className="page-header prod-head">
        <button className="db-iconbtn lg" onClick={() => navigate('/production')} title="Production" aria-label="Production">
          <ArrowLeft size={16} />
        </button>
        <h1 className="page-title">Shot Lists</h1>
        <button className="btn btn-primary" onClick={() => setShowNew(true)} title="New shot list" aria-label="New shot list">
          <Plus size={16} />
        </button>
      </div>

      {loadErr && <div className="error-msg" style={{ marginBottom: '12px' }}>{loadErr}</div>}

      {loading ? null : lists.length === 0 ? (
        <div className="card db-empty"><ListVideo size={28} /></div>
      ) : (
        <div className="db-grid">
          {lists.map(s => (
            <ShotlistCard
              key={s.id}
              shotlist={s}
              base={base}
              onOpen={() => navigate(`/production/shotlists/${s.id}`)}
              onCopy={handleCopy}
              onDelete={setConfirmDelete}
            />
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

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.title}"?`}
          message={`Its scenes, shots, locations and activity go with it.${confirmDelete.status === 'published' ? ' The public link will stop working.' : ''}`}
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          onConfirm={runDelete}
          onCancel={() => setConfirmDelete(null)}
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
