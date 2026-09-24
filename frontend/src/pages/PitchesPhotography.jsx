import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Presentation, Edit2, Trash2, Copy, Link2, Sparkles, ArrowLeft, CheckSquare, Square,
} from 'lucide-react';
import { api } from '../api';
import { SECTION_LABELS, sectionSummary } from '../lib/pitchSections';
import Overlay from '../components/Overlay';
import ConfirmDialog from '../components/ConfirmDialog';
import IconMenu from '../components/IconMenu';
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

function thumbFor(filename) {
  if (!filename) return null;
  return `/p-media/${filename.replace(/-web\.jpg$/, '-thumb.jpg')}`;
}

function TemplateCard({ template, onUse }) {
  return (
    <button type="button" className="db-card" onClick={() => onUse(template)} title={`${template.section_count} sections`}>
      <span className="prod-swatch" style={{ background: template.accent_color || 'var(--color-mid-gray)' }}>
        <Sparkles size={15} />
      </span>
      <div className="db-main">
        <div className="db-name"><span>{template.title}</span></div>
        <div className="db-meta">
          <span className="db-count"><span className="db-dot" />{template.section_count}</span>
        </div>
      </div>
    </button>
  );
}

// Choosing a template opens this first: name the pitch, then choose which of
// the template's sections to carry over. Nothing is created until Create.
function UseTemplateModal({ template, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/pitches/${template.id}`)
      .then(d => {
        const secs = d.sections || [];
        setSections(secs);
        setPicked(new Set(secs.map(s => s.id))); // everything on by default
      })
      .catch(() => setError('Could not load the template.'))
      .finally(() => setLoading(false));
  }, [template.id]);

  function toggle(id) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allOn = sections && picked.size === sections.length;

  async function create(e) {
    e.preventDefault();
    if (!title.trim()) { setError('Give the pitch a name'); return; }
    if (picked.size === 0) { setError('Pick at least one section'); return; }
    setCreating(true); setError('');
    try {
      const ordered = sections.filter(s => picked.has(s.id)).map(s => s.id);
      const res = await api.post(`/pitches/${template.id}/duplicate`, {
        title: title.trim(),
        sectionIds: ordered,
      });
      onCreated(res.id);
    } catch (err) {
      setError(err.message || 'Could not create the pitch');
      setCreating(false);
    }
  }

  return (
    <Overlay
      title={template.title}
      onClose={onClose}
      width={560}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="pitch-from-template" className="btn btn-primary" disabled={creating || loading}>
          {creating ? 'Creating...' : 'Create'}
        </button>
      </>}
    >
      <form id="pitch-from-template" onSubmit={create}>
        <div className="form-row">
          <label className="form-label">Pitch name</label>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
        </div>

        <div className="form-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            {sections && (
              <span className="db-count" title="Sections"><span className="db-dot" />{picked.size} / {sections.length}</span>
            )}
            {sections && sections.length > 0 && (
              <button
                type="button"
                className="db-iconbtn"
                style={{ marginLeft: 'auto' }}
                title={allOn ? 'Clear all' : 'Select all'}
                aria-label={allOn ? 'Clear all' : 'Select all'}
                onClick={() => setPicked(allOn ? new Set() : new Set(sections.map(s => s.id)))}
              >
                {allOn ? <Square size={15} /> : <CheckSquare size={15} />}
              </button>
            )}
          </div>

          {sections && (
            <div className="pitch-section-picker">
              {sections.map(s => (
                <label key={s.id} className={`pitch-section-row${picked.has(s.id) ? ' on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={picked.has(s.id)}
                    onChange={() => toggle(s.id)}
                    style={{ accentColor: 'var(--accent)', width: 15, height: 15, flexShrink: 0 }}
                  />
                  <span className="pitch-section-type">{SECTION_LABELS[s.type] || s.type}</span>
                  <span className="pitch-section-sum">{sectionSummary(s.type, s.content)}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <p className="prod-error">{error}</p>}
      </form>
    </Overlay>
  );
}

function PitchCover({ pitch }) {
  const [failed, setFailed] = useState(false);
  const src = thumbFor(pitch.cover);
  return (
    <div className="coll-cover" style={pitch.accent_color ? { borderBottom: `2px solid ${pitch.accent_color}` } : undefined}>
      {src && !failed
        ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <Presentation size={26} strokeWidth={1.5} />}
    </div>
  );
}

function PitchCard({ pitch, pitchBase, onOpen, onDuplicate, onDelete, onCopy }) {
  const isPublished = pitch.status === 'published';
  // Built from the server's public base, never window.location: the link you
  // copy is the client facing one even when the panel lives on another host.
  const publicUrl = pitch.slug ? `${pitchBase.base}/p/${pitch.slug}` : null;

  return (
    <div
      className="coll-tile"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <PitchCover pitch={pitch} />
      <div className="coll-body">
        <div className="db-main">
          <div className="coll-name">{pitch.title}</div>
          <div className="coll-meta">
            {isPublished && <span className="db-dot ink" title="Published" />}
          </div>
        </div>
        <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          <IconMenu items={[
            { key: 'edit', Icon: Edit2, title: 'Edit', onClick: onOpen },
            { key: 'duplicate', Icon: Copy, title: 'Duplicate', onClick: () => onDuplicate(pitch) },
            isPublished && publicUrl && { key: 'link', Icon: Link2, title: `Copy link (${pitchBase.host})`, onClick: () => onCopy(publicUrl) },
            { key: 'delete', Icon: Trash2, title: 'Delete', danger: true, onClick: () => onDelete(pitch) },
          ]} />
        </span>
      </div>
    </div>
  );
}

export default function PitchesPhotography() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [pitches, setPitches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [templateInUse, setTemplateInUse] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState(null);
  // Falls back to the current origin until the server answers, which is also
  // exactly what the server reports when no pitch domain is configured.
  const [pitchBase, setPitchBase] = useState({
    base: window.location.origin, host: window.location.host, custom: false,
  });

  useEffect(() => {
    api.get('/pitches/public-base')
      .then(b => { if (b && b.base) setPitchBase(b); })
      .catch(() => { /* the current origin stays */ });
  }, []);

  async function loadData() {
    try {
      const data = await api.get('/pitches');
      setTemplates(data.templates);
      setPitches(data.pitches);
      setLoadErr('');
    } catch (err) {
      setLoadErr(err.message || 'Could not load the pitches');
    }
  }

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  async function handleDuplicate(pitch) {
    try {
      const res = await api.post(`/pitches/${pitch.id}/duplicate`, {});
      await loadData();
      navigate(`/pitches/${res.id}`);
    } catch (err) {
      setNotice({ title: 'Not duplicated', message: err.message || 'The pitch could not be duplicated.' });
    }
  }

  async function runDelete() {
    const pitch = confirmDelete;
    setDeleting(true);
    try {
      await api.del(`/pitches/${pitch.id}`);
      setConfirmDelete(null);
      await loadData();
    } catch (err) {
      setConfirmDelete(null);
      setNotice({ title: 'Not deleted', message: err.message || 'The pitch could not be deleted.' });
    }
    setDeleting(false);
  }

  async function handleCopy(url) {
    if (!(await copyText(url))) setNotice({ title: 'Not copied', message: 'The browser did not allow copying.' });
  }

  return (
    <div>
      <div className="page-header prod-head">
        <button className="db-iconbtn lg" onClick={() => navigate('/pitches')} title="Pitches" aria-label="Pitches">
          <ArrowLeft size={16} />
        </button>
        <h1 className="page-title">Photography</h1>
      </div>

      {loadErr && <div className="error-msg" style={{ marginBottom: '12px' }}>{loadErr}</div>}

      {!loading && (
        <>
          <section className="prod-section">
            <div className="prod-section-head" title="Templates">
              <Sparkles size={16} />
              <span className="db-count"><span className="db-dot" />{templates.length}</span>
            </div>
            <div className="db-grid">
              {templates.map(t => <TemplateCard key={t.id} template={t} onUse={setTemplateInUse} />)}
            </div>
          </section>

          <section className="prod-section">
            <div className="prod-section-head" title="Pitches">
              <Presentation size={16} />
              <span className="db-count"><span className="db-dot" />{pitches.length}</span>
            </div>
            {pitches.length === 0 ? (
              <div className="card db-empty"><Presentation size={28} /></div>
            ) : (
              <div className="collections-tile-grid">
                {pitches.map(p => (
                  <PitchCard
                    key={p.id}
                    pitch={p}
                    pitchBase={pitchBase}
                    onOpen={() => navigate(`/pitches/${p.id}`)}
                    onDuplicate={handleDuplicate}
                    onDelete={setConfirmDelete}
                    onCopy={handleCopy}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {templateInUse && (
        <UseTemplateModal
          template={templateInUse}
          onClose={() => setTemplateInUse(null)}
          onCreated={id => navigate(`/pitches/${id}`)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.title}"?`}
          message={`This cannot be undone.${confirmDelete.status === 'published' ? ' Its public link will stop working.' : ''}`}
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
