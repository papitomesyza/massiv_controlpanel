import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, Library, FolderKanban, Archive, ArchiveRestore, Trash2,
  Link2, FileText, MoreHorizontal, Edit2, Youtube, Play,
  Globe, X, AlertCircle,
} from 'lucide-react';
import { api } from '../api';

// ── Source helpers ────────────────────────────────────────────────────────────

const SOURCE_LABEL = {
  youtube: 'YouTube', vimeo: 'Vimeo', pinterest: 'Pinterest',
  behance: 'Behance', instagram: 'Instagram', dribbble: 'Dribbble',
  twitter: 'X / Twitter', web: 'Web',
};

function SourceIcon({ source, size = 12 }) {
  if (source === 'youtube') return <Youtube size={size} />;
  return <Globe size={size} />;
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}

// ── Card thumbnail with source-icon fallback ──────────────────────────────────

function CardThumbnail({ card }) {
  const [imgFailed, setImgFailed] = useState(false);
  const isVideo = card.source === 'youtube' || card.source === 'vimeo';

  return (
    <div style={{
      position: 'relative', width: '100%', paddingBottom: '56.25%',
      background: '#181818', borderRadius: '12px 12px 0 0', overflow: 'hidden', flexShrink: 0,
    }}>
      {card.thumbnail_url && !imgFailed ? (
        <img
          src={card.thumbnail_url}
          alt={card.title || ''}
          onError={() => setImgFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          loading="lazy"
        />
      ) : (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '8px', color: 'var(--text-muted)',
        }}>
          <SourceIcon source={card.source} size={30} />
          <span style={{ fontSize: '11px' }}>{SOURCE_LABEL[card.source] || 'Web'}</span>
        </div>
      )}
      {isVideo && card.thumbnail_url && !imgFailed && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.22)',
        }}>
          <div style={{
            width: 46, height: 46, borderRadius: '50%',
            background: 'rgba(0,0,0,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Play size={18} color="white" fill="white" style={{ marginLeft: 2 }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Card dropdown menu ────────────────────────────────────────────────────────

function CardMenu({ isOpen, onToggle, onEdit, onDelete }) {
  const ref = useRef();
  useEffect(() => {
    if (!isOpen) return;
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onToggle();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onToggle]);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        className="btn-ghost"
        onClick={e => { e.stopPropagation(); onToggle(); }}
        style={{ padding: '3px 6px', opacity: 0.55, border: 'none' }}
        title="Options"
      >
        <MoreHorizontal size={14} />
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 60,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: '10px', minWidth: '130px', overflow: 'hidden',
          boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
        }}>
          <button
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              width: '100%', padding: '10px 14px',
              background: 'none', border: 'none', color: 'var(--text-primary)',
              fontSize: '13px', cursor: 'pointer', textAlign: 'left',
            }}
            onClick={e => { e.stopPropagation(); onEdit(); onToggle(); }}
          >
            <Edit2 size={12} /> Edit
          </button>
          <button
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              width: '100%', padding: '10px 14px',
              background: 'none', border: 'none', color: 'var(--danger)',
              fontSize: '13px', cursor: 'pointer', textAlign: 'left',
            }}
            onClick={e => { e.stopPropagation(); onDelete(); onToggle(); }}
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Link card ─────────────────────────────────────────────────────────────────

function LinkCard({ card, isMenuOpen, onMenuToggle, onEdit, onDelete }) {
  return (
    <div
      className="card"
      style={{ padding: 0, overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
      onClick={() => window.open(card.url, '_blank', 'noopener,noreferrer')}
      title={card.url}
    >
      <CardThumbnail card={card} />
      <div style={{ padding: '11px 14px 13px', display: 'flex', flexDirection: 'column', gap: '5px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
          {card.title ? (
            <p style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.4, flex: 1, margin: 0, wordBreak: 'break-word' }}>
              {card.title}
            </p>
          ) : (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', flex: 1, margin: 0, wordBreak: 'break-all' }}>
              {getDomain(card.url)}
            </p>
          )}
          <div onClick={e => e.stopPropagation()}>
            <CardMenu isOpen={isMenuOpen} onToggle={onMenuToggle} onEdit={onEdit} onDelete={onDelete} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-muted)', fontSize: '11px' }}>
          <SourceIcon source={card.source} size={10} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {getDomain(card.url)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Note card ─────────────────────────────────────────────────────────────────

function NoteCard({ card, isMenuOpen, onMenuToggle, onEdit, onDelete, isExpanded, onToggleExpand }) {
  const isLong = (card.note_text || '').length > 250;

  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        background: 'rgba(199,255,46,0.04)',
        border: '1px solid rgba(199,255,46,0.11)',
        display: 'flex', flexDirection: 'column', gap: '9px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: 0 }}>
          <FileText size={12} color="var(--accent)" style={{ flexShrink: 0 }} />
          {card.title && (
            <span style={{ fontSize: '13px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {card.title}
            </span>
          )}
        </div>
        <CardMenu isOpen={isMenuOpen} onToggle={onMenuToggle} onEdit={onEdit} onDelete={onDelete} />
      </div>
      <p
        style={{
          fontSize: '13px', lineHeight: 1.65, color: 'var(--text-secondary)', margin: 0,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: isExpanded ? 'unset' : 5,
          WebkitBoxOrient: 'vertical',
          cursor: isLong && !isExpanded ? 'pointer' : 'default',
        }}
        onClick={isLong && !isExpanded ? onToggleExpand : undefined}
      >
        {card.note_text}
      </p>
      {isLong && (
        <button
          onClick={onToggleExpand}
          style={{
            alignSelf: 'flex-start', fontSize: '11px', fontWeight: 700,
            color: 'var(--accent)', background: 'none', border: 'none',
            cursor: 'pointer', padding: 0,
          }}
        >
          {isExpanded ? 'Collapse ↑' : 'Read more ↓'}
        </button>
      )}
    </div>
  );
}

// ── Edit card modal ───────────────────────────────────────────────────────────

function EditCardModal({ card, collectionId, onSave, onClose }) {
  const [title, setTitle] = useState(card.title || '');
  const [noteText, setNoteText] = useState(card.note_text || '');
  const [url, setUrl] = useState(card.url || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (card.type === 'note' && !noteText.trim()) { setError('Note text is required'); return; }
    if (card.type === 'link' && !url.trim()) { setError('URL is required'); return; }
    setSaving(true);
    try {
      await onSave(card.id, card.type === 'note'
        ? { title: title.trim() || undefined, note_text: noteText }
        : { title: title.trim() || undefined, url: url.trim() });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3 className="modal-title">Edit {card.type === 'note' ? 'Note' : 'Link'}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {card.type === 'link' && (
            <div className="form-group">
              <label className="form-label">URL *</label>
              <input
                className="form-input"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://…"
                autoFocus
              />
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', margin: '4px 0 0' }}>
                Changing the URL re-fetches the thumbnail.
              </p>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Title {card.type === 'note' ? '(optional)' : '(optional override)'}</label>
            <input
              className="form-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={card.type === 'note' ? 'Optional title' : 'Leave blank to use fetched title'}
              autoFocus={card.type === 'note'}
            />
          </div>
          {card.type === 'note' && (
            <div className="form-group">
              <label className="form-label">Note *</label>
              <textarea
                className="form-input"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={5}
                style={{ resize: 'vertical', minHeight: '80px' }}
              />
            </div>
          )}
          {error && (
            <p style={{ color: 'var(--danger)', fontSize: '13px', margin: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
              <AlertCircle size={13} /> {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CollectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [collection, setCollection] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Add form
  const [addMode, setAddMode] = useState(null); // null | 'link' | 'note'
  const [linkUrl, setLinkUrl] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  // Cards UI state
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());

  async function loadCollection() {
    try {
      const data = await api.get(`/collections/${id}`);
      setCollection(data);
      setCards(data.cards || []);
    } catch (_) {
      setNotFound(true);
    }
  }

  useEffect(() => {
    setLoading(true);
    loadCollection().finally(() => setLoading(false));
  }, [id]);

  async function handleAddLink(e) {
    e.preventDefault();
    if (!linkUrl.trim()) { setAddError('Please enter a URL'); return; }
    setAdding(true);
    setAddError('');
    try {
      const card = await api.post(`/collections/${id}/cards`, { type: 'link', url: linkUrl.trim() });
      setCards(prev => [card, ...prev]);
      setLinkUrl('');
      setAddMode(null);
    } catch (err) {
      setAddError(err.message || 'Failed to add link');
    } finally {
      setAdding(false);
    }
  }

  async function handleAddNote(e) {
    e.preventDefault();
    if (!noteText.trim()) { setAddError('Note text is required'); return; }
    setAdding(true);
    setAddError('');
    try {
      const card = await api.post(`/collections/${id}/cards`, {
        type: 'note',
        title: noteTitle.trim() || undefined,
        note_text: noteText.trim(),
      });
      setCards(prev => [card, ...prev]);
      setNoteTitle('');
      setNoteText('');
      setAddMode(null);
    } catch (err) {
      setAddError(err.message || 'Failed to add note');
    } finally {
      setAdding(false);
    }
  }

  async function handleEditCard(cardId, data) {
    const updated = await api.put(`/collections/${id}/cards/${cardId}`, data);
    setCards(prev => prev.map(c => c.id === cardId ? updated : c));
  }

  async function handleDeleteCard(cardId) {
    if (!confirm('Delete this card? This cannot be undone.')) return;
    try {
      await api.del(`/collections/${id}/cards/${cardId}`);
      setCards(prev => prev.filter(c => c.id !== cardId));
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  }

  async function handleArchive() {
    const newArchived = collection.archived ? 0 : 1;
    try {
      await api.patch(`/collections/${id}/archive`, { archived: newArchived });
      setCollection(prev => ({ ...prev, archived: newArchived }));
    } catch (err) {
      alert(err.message || 'Failed');
    }
  }

  async function handleDeleteCollection() {
    if (!confirm(`Delete collection "${collection.name}"?\nAll ${cards.length} card(s) inside will be permanently deleted.`)) return;
    try {
      await api.del(`/collections/${id}`);
      navigate('/collections');
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  }

  function cancelAdd() {
    setAddMode(null);
    setLinkUrl('');
    setNoteTitle('');
    setNoteText('');
    setAddError('');
  }

  function toggleExpand(cardId) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(cardId) ? next.delete(cardId) : next.add(cardId);
      return next;
    });
  }

  function toggleMenu(cardId) {
    setOpenMenuId(prev => prev === cardId ? null : cardId);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ padding: '24px' }}>
      <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
    </div>
  );

  if (notFound) return (
    <div style={{ padding: '24px' }}>
      <button className="btn-ghost" style={{ marginBottom: 16 }} onClick={() => navigate('/collections')}>
        <ChevronLeft size={16} style={{ marginRight: 4 }} /> Collections
      </button>
      <p style={{ color: 'var(--text-muted)' }}>Collection not found.</p>
    </div>
  );

  return (
    <div>
      {/* ── Page header ── */}
      <div style={{ marginBottom: '24px' }}>
        <button
          className="btn-ghost"
          style={{ padding: '6px 10px', fontSize: '13px', marginBottom: '16px', border: 'none' }}
          onClick={() => navigate('/collections')}
        >
          <ChevronLeft size={15} style={{ marginRight: 4 }} /> Collections
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'rgba(199,255,46,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Library size={20} color="var(--accent)" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>{collection.name}</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', flexWrap: 'wrap' }}>
                {collection.project_id && collection.project_title && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FolderKanban size={12} color="var(--text-muted)" />
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{collection.project_title}</span>
                  </div>
                )}
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {cards.length} {cards.length === 1 ? 'card' : 'cards'}
                </span>
                {collection.archived === 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Archive size={11} color="var(--text-muted)" />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Archived</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              className="btn-ghost"
              style={{ padding: '7px 13px', fontSize: '12px' }}
              onClick={handleArchive}
              title={collection.archived ? 'Unarchive' : 'Archive'}
            >
              {collection.archived
                ? <><ArchiveRestore size={13} style={{ marginRight: 5 }} /> Unarchive</>
                : <><Archive size={13} style={{ marginRight: 5 }} /> Archive</>}
            </button>
            <button
              className="btn-ghost"
              style={{ padding: '7px 13px', fontSize: '12px', color: 'var(--danger)', borderColor: 'rgba(255,68,68,0.3)' }}
              onClick={handleDeleteCollection}
              title="Delete collection"
            >
              <Trash2 size={13} style={{ marginRight: 5 }} /> Delete
            </button>
          </div>
        </div>

        {collection.description && (
          <p style={{ marginTop: '10px', color: 'var(--text-secondary)', fontSize: '13px' }}>
            {collection.description}
          </p>
        )}
      </div>

      {/* ── Add affordance buttons (when no form is open) ── */}
      {!addMode && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <button
            className="btn-primary"
            style={{ fontSize: '13px', padding: '8px 18px' }}
            onClick={() => { setAddMode('link'); setAddError(''); }}
          >
            <Link2 size={14} style={{ marginRight: 6 }} /> Add Link
          </button>
          <button
            className="btn-ghost"
            style={{ fontSize: '13px', padding: '8px 18px' }}
            onClick={() => { setAddMode('note'); setAddError(''); }}
          >
            <FileText size={14} style={{ marginRight: 6 }} /> Add Note
          </button>
        </div>
      )}

      {/* ── Add Link inline form ── */}
      {addMode === 'link' && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: '24px', border: '1px solid rgba(199,255,46,0.22)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Link2 size={14} color="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: '14px' }}>Add Link</span>
            <button
              onClick={cancelAdd}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
            >
              <X size={15} />
            </button>
          </div>
          <form onSubmit={handleAddLink} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              className="form-input"
              style={{ flex: 1, minWidth: '200px' }}
              placeholder="Paste a URL — YouTube, Vimeo, Pinterest, Behance, or any site…"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              autoFocus
              disabled={adding}
            />
            <button type="submit" className="btn-primary" style={{ flexShrink: 0 }} disabled={adding}>
              {adding ? 'Fetching…' : 'Add'}
            </button>
            <button type="button" className="btn-ghost" style={{ flexShrink: 0 }} onClick={cancelAdd} disabled={adding}>
              Cancel
            </button>
          </form>
          {adding && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
              Fetching preview — this may take a few seconds…
            </p>
          )}
          {addError && !adding && (
            <p style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <AlertCircle size={12} /> {addError}
            </p>
          )}
        </div>
      )}

      {/* ── Add Note inline form ── */}
      {addMode === 'note' && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: '24px', border: '1px solid rgba(199,255,46,0.22)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <FileText size={14} color="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: '14px' }}>Add Note</span>
            <button
              onClick={cancelAdd}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
            >
              <X size={15} />
            </button>
          </div>
          <form onSubmit={handleAddNote} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              className="form-input"
              placeholder="Title (optional)"
              value={noteTitle}
              onChange={e => setNoteTitle(e.target.value)}
              autoFocus
              disabled={adding}
            />
            <textarea
              className="form-input"
              placeholder="Write your note…"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={4}
              style={{ resize: 'vertical', minHeight: '80px' }}
              disabled={adding}
            />
            {addError && (
              <p style={{ color: 'var(--danger)', fontSize: '12px', margin: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
                <AlertCircle size={12} /> {addError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={cancelAdd} disabled={adding}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={adding}>
                {adding ? 'Saving…' : 'Add Note'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Empty state ── */}
      {cards.length === 0 && (
        <div className="card" style={{ padding: '52px 24px', textAlign: 'center' }}>
          <Library size={36} color="var(--text-muted)" style={{ margin: '0 auto 14px', display: 'block' }} />
          <p style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>Nothing here yet</p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '22px' }}>
            Add a link or a note to start filling this collection.
          </p>
          {!addMode && (
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn-primary" style={{ fontSize: '13px' }} onClick={() => setAddMode('link')}>
                <Link2 size={14} style={{ marginRight: 6 }} /> Add Link
              </button>
              <button className="btn-ghost" style={{ fontSize: '13px' }} onClick={() => setAddMode('note')}>
                <FileText size={14} style={{ marginRight: 6 }} /> Add Note
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Masonry card grid ── */}
      {cards.length > 0 && (
        <div style={{ columnWidth: '300px', columnGap: '16px' }}>
          {cards.map(card => (
            <div key={card.id} style={{ breakInside: 'avoid', marginBottom: '16px' }}>
              {card.type === 'link' ? (
                <LinkCard
                  card={card}
                  isMenuOpen={openMenuId === card.id}
                  onMenuToggle={() => toggleMenu(card.id)}
                  onEdit={() => { setEditingCard(card); setOpenMenuId(null); }}
                  onDelete={() => handleDeleteCard(card.id)}
                />
              ) : (
                <NoteCard
                  card={card}
                  isMenuOpen={openMenuId === card.id}
                  onMenuToggle={() => toggleMenu(card.id)}
                  onEdit={() => { setEditingCard(card); setOpenMenuId(null); }}
                  onDelete={() => handleDeleteCard(card.id)}
                  isExpanded={expandedIds.has(card.id)}
                  onToggleExpand={() => toggleExpand(card.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Edit modal ── */}
      {editingCard && (
        <EditCardModal
          card={editingCard}
          collectionId={id}
          onSave={handleEditCard}
          onClose={() => setEditingCard(null)}
        />
      )}
    </div>
  );
}
