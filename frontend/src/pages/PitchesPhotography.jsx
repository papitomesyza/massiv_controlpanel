import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Presentation, Edit2, Trash2, Copy, Link2, Check, Sparkles, X,
} from 'lucide-react';
import { api, fmtDate } from '../api';
import { SECTION_LABELS, sectionSummary } from '../lib/pitchSections';

const STATUS_BADGE = {
  draft: 'badge badge-pending',
  published: 'badge badge-active',
};

function TemplateCard({ template, onUse, using }) {
  return (
    <div className="card pitch-template-card">
      <div className="pitch-template-accent" style={{ background: template.accent_color || 'var(--color-mid-gray)' }} />
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={13} color="var(--accent)" />
          <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Template
          </span>
        </div>
        <div style={{ fontWeight: 700, fontSize: '14px' }}>{template.title}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {template.section_count} sections
        </div>
        <button
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 'auto', justifyContent: 'center' }}
          disabled={using}
          onClick={() => onUse(template)}
        >
          {using ? 'Creating…' : 'Use template'}
        </button>
      </div>
    </div>
  );
}

// "Use template" opens this first: name the pitch, then choose which of the
// template's sections to carry over. Nothing is created until Create is clicked.
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
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span className="modal-title">New pitch from “{template.title}”</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={create}>
          <div className="form-row">
            <label className="form-label">Pitch name *</label>
            <input
              className="input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Nike SS26 Editorial"
              autoFocus
            />
          </div>

          <div className="form-row">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label className="form-label" style={{ margin: 0 }}>
                Sections to include {sections ? `(${picked.size}/${sections.length})` : ''}
              </label>
              {sections && sections.length > 0 && (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  onClick={() => setPicked(allOn ? new Set() : new Set(sections.map(s => s.id)))}
                >
                  {allOn ? 'Clear all' : 'Select all'}
                </button>
              )}
            </div>

            {loading && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading sections…</p>}

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

          {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={creating || loading}>
              {creating ? 'Creating…' : 'Create pitch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PitchCard({ pitch, onDelete, onDuplicate, pitchBase }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const isPublished = pitch.status === 'published';
  // Built from the server's public base, never window.location — the link you
  // copy is the client-facing one even when the panel lives on another host.
  const publicUrl = pitch.slug ? `${pitchBase.base}/p/${pitch.slug}` : null;

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
    <div className="card pitch-saved-card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/pitches/${pitch.id}`)}>
      <div className="pitch-template-accent" style={{ background: pitch.accent_color || 'var(--color-mid-gray)' }} />
      <div style={{ padding: '14px 18px 16px', display: 'flex', flexDirection: 'column', gap: '7px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pitch.title}</span>
          <span className={STATUS_BADGE[pitch.status] || 'badge badge-pending'}>{pitch.status}</span>
        </div>
        {pitch.category && (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{pitch.category}</span>
        )}
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {pitch.section_count} sections · updated {fmtDate(String(pitch.updated_at || '').replace(' ', 'T'))}
        </span>
        {isPublished && publicUrl && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pitchBase.host}/p/{pitch.slug}
          </span>
        )}
        <div style={{ display: 'flex', gap: '4px', marginTop: 'auto', paddingTop: '8px' }} onClick={e => e.stopPropagation()}>
          <button className="btn-ghost" style={{ padding: '5px 7px' }} title="Edit" onClick={() => navigate(`/pitches/${pitch.id}`)}>
            <Edit2 size={13} />
          </button>
          <button className="btn-ghost" style={{ padding: '5px 7px' }} title="Duplicate" onClick={() => onDuplicate(pitch)}>
            <Copy size={13} />
          </button>
          {isPublished && publicUrl && (
            <>
              <button className="btn-ghost" style={{ padding: '5px 7px', color: copied ? 'var(--success)' : undefined }} title={`Copy public link (${pitchBase.host})`} onClick={copyLink}>
                {copied ? <Check size={13} /> : <Link2 size={13} />}
              </button>
              {/* Which domain the copied link points at, at a glance */}
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '50%' }}>
                {pitchBase.host}
              </span>
            </>
          )}
          <button className="btn-ghost" style={{ padding: '5px 7px', color: 'var(--danger)', marginLeft: 'auto' }} title="Delete" onClick={() => onDelete(pitch)}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PitchesPhotography() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [pitches, setPitches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [templateInUse, setTemplateInUse] = useState(null);
  // Falls back to the current origin until the server answers, which is also
  // exactly what the server reports when no pitch domain is configured.
  const [pitchBase, setPitchBase] = useState({
    base: window.location.origin, host: window.location.host, custom: false,
  });

  useEffect(() => {
    api.get('/pitches/public-base')
      .then(b => { if (b && b.base) setPitchBase(b); })
      .catch(() => {});
  }, []);

  async function loadData() {
    try {
      const data = await api.get('/pitches');
      setTemplates(data.templates);
      setPitches(data.pitches);
    } catch (_) {}
  }

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  // Naming and section selection happen in the modal; nothing is created until
  // the writer confirms there.
  function handleUseTemplate(template) {
    setTemplateInUse(template);
  }

  async function handleDuplicate(pitch) {
    try {
      const res = await api.post(`/pitches/${pitch.id}/duplicate`, {});
      await loadData();
      navigate(`/pitches/${res.id}`);
    } catch (err) { alert(err.message || 'Failed to duplicate'); }
  }

  async function handleDelete(pitch) {
    if (!confirm(`Delete pitch "${pitch.title}"? This cannot be undone.${pitch.status === 'published' ? ' Its public link will stop working.' : ''}`)) return;
    try {
      await api.del(`/pitches/${pitch.id}`);
      await loadData();
    } catch (err) { alert(err.message || 'Failed to delete'); }
  }

  if (loading) return (
    <div className="page-header">
      <h1 className="page-title">Photography Concepts</h1>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Photography Concepts</h1>
      </div>

      <section style={{ marginBottom: '36px' }}>
        <h2 style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '14px' }}>
          Start from a template
        </h2>
        <div className="pitch-card-grid">
          {templates.map(t => (
            <TemplateCard key={t.id} template={t} onUse={handleUseTemplate} using={false} />
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '14px' }}>
          Your pitches
        </h2>
        {pitches.length === 0 ? (
          <div className="card" style={{ padding: '48px 20px', textAlign: 'center' }}>
            <Presentation size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px', display: 'block' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              No pitches yet. Pick a template above to build your first presentation.
            </p>
          </div>
        ) : (
          <div className="pitch-card-grid">
            {pitches.map(p => (
              <PitchCard key={p.id} pitch={p} onDelete={handleDelete} onDuplicate={handleDuplicate} pitchBase={pitchBase} />
            ))}
          </div>
        )}
      </section>

      {templateInUse && (
        <UseTemplateModal
          template={templateInUse}
          onClose={() => setTemplateInUse(null)}
          onCreated={id => navigate(`/pitches/${id}`)}
        />
      )}
    </div>
  );
}
