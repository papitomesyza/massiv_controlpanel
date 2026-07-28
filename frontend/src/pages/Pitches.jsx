import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Presentation, Edit2, Trash2, Copy, Link2, Check, Sparkles,
} from 'lucide-react';
import { api, fmtDate } from '../api';

const STATUS_BADGE = {
  draft: 'badge badge-pending',
  published: 'badge badge-active',
};

function TemplateCard({ template, onUse, using }) {
  return (
    <div className="card pitch-template-card">
      <div className="pitch-template-accent" style={{ background: template.accent_color || '#723CEB' }} />
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

function PitchCard({ pitch, onDelete, onDuplicate }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const isPublished = pitch.status === 'published';
  const publicUrl = pitch.slug ? `${window.location.origin}/p/${pitch.slug}` : null;

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
    <div className="card" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column' }} onClick={() => navigate(`/pitches/${pitch.id}`)}>
      <div className="pitch-template-accent" style={{ background: pitch.accent_color || '#723CEB' }} />
      <div style={{ padding: '14px 18px 16px', display: 'flex', flexDirection: 'column', gap: '7px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pitch.title}</span>
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
            /p/{pitch.slug}
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
            <button className="btn-ghost" style={{ padding: '5px 7px', color: copied ? 'var(--success)' : undefined }} title="Copy public link" onClick={copyLink}>
              {copied ? <Check size={13} /> : <Link2 size={13} />}
            </button>
          )}
          <button className="btn-ghost" style={{ padding: '5px 7px', color: 'var(--danger)', marginLeft: 'auto' }} title="Delete" onClick={() => onDelete(pitch)}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Pitches() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [pitches, setPitches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usingId, setUsingId] = useState(null);

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

  async function handleUseTemplate(template) {
    setUsingId(template.id);
    try {
      const res = await api.post(`/pitches/${template.id}/duplicate`, { title: `${template.title} Pitch` });
      navigate(`/pitches/${res.id}`);
    } catch (err) {
      alert(err.message || 'Failed to create pitch');
      setUsingId(null);
    }
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
            <TemplateCard key={t.id} template={t} onUse={handleUseTemplate} using={usingId === t.id} />
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
              <PitchCard key={p.id} pitch={p} onDelete={handleDelete} onDuplicate={handleDuplicate} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
