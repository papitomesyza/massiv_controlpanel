import React, { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, Library, FolderKanban, Archive, ArchiveRestore, Trash2,
  Link2, FileText, MoreHorizontal, Edit2, Youtube, Play,
  Globe, X, AlertCircle, Search, Share2, Copy, Check, GripVertical,
  Instagram, Music2, Star,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from '../components/Modal';
import { api } from '../api';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_LABEL = {
  youtube: 'YouTube', vimeo: 'Vimeo', pinterest: 'Pinterest',
  behance: 'Behance', instagram: 'Instagram', tiktok: 'TikTok',
  dribbble: 'Dribbble', twitter: 'X / Twitter', web: 'Web',
};

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}

function parseInstagramInfo(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const RESERVED = ['explore', 'stories', 'accounts', 'direct', 'login', 'ar', 'challenge', 'about', 'blog', 'legal', 'help'];
    let username = null;
    let postType = 'Post';
    if (parts[0] === 'p') postType = 'Post';
    else if (parts[0] === 'reel' || parts[0] === 'reels') postType = 'Reel';
    else if (parts[0] === 'tv') postType = 'Video';
    else if (parts[0] && !RESERVED.includes(parts[0])) {
      username = parts[0];
      if (parts[1] === 'p') postType = 'Post';
      else if (parts[1] === 'reel' || parts[1] === 'reels') postType = 'Reel';
      else if (parts[1] === 'tv') postType = 'Video';
      else postType = 'Profile';
    }
    return { username, postType };
  } catch (_) {
    return { username: null, postType: 'Post' };
  }
}

function parseTags(tags) {
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(Boolean);
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: 'latest', label: 'Latest added' },
  { value: 'oldest', label: 'Oldest added' },
  { value: 'name',   label: 'Name A–Z' },
  { value: 'custom', label: 'Custom order' },
];

function applySortMode(list, mode) {
  const starred = list.filter(c => c.starred);
  const rest = list.filter(c => !c.starred);
  function sortGroup(arr) {
    if (mode === 'oldest') return [...arr].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (mode === 'name') return [...arr].sort((a, b) => {
      const aKey = (a.title || a.url || '').toLowerCase();
      const bKey = (b.title || b.url || '').toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: 'base' });
    });
    if (mode === 'custom') return [...arr];
    return [...arr].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return [...sortGroup(starred), ...sortGroup(rest)];
}

function SortSelector({ value, onChange }) {
  return (
    <select
      className="select"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ fontSize: '12px', padding: '5px 10px', height: 'auto', width: 'auto' }}
    >
      {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Tag chip ──────────────────────────────────────────────────────────────────

function TagChip({ tag, active, onClick }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(tag); }}
      style={{
        padding: '2px 9px', borderRadius: 50, fontSize: '11px', fontWeight: 600,
        background: active ? 'var(--accent)' : 'rgba(199,255,46,0.08)',
        color: active ? '#0F0F0F' : 'var(--accent)',
        border: 'none', cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
      }}
    >
      {tag}
    </button>
  );
}

// ── Instagram branded placeholder ─────────────────────────────────────────────

function InstagramPlaceholder({ url }) {
  const { username, postType } = parseInstagramInfo(url || '');
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '8px',
    }}>
      <Instagram size={38} color="rgba(255,255,255,0.95)" strokeWidth={1.5} />
      <div style={{ textAlign: 'center', lineHeight: 1.4 }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {postType}
        </div>
        {username && (
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.72)', marginTop: '3px' }}>
            @{username}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TikTok branded placeholder ────────────────────────────────────────────────

function TikTokPlaceholder() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: '#010101',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '8px',
    }}>
      <Music2 size={38} color="rgba(255,255,255,0.90)" strokeWidth={1.5} />
      <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        TikTok
      </div>
    </div>
  );
}

// ── Favicon placeholder (Section 3) ──────────────────────────────────────────

function FaviconPlaceholder({ url }) {
  const domain = getDomain(url);
  const [faviconFailed, setFaviconFailed] = useState(false);
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '10px', background: '#1a1a1a',
    }}>
      {!faviconFailed ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
          alt={domain}
          onError={() => setFaviconFailed(true)}
          style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'contain' }}
        />
      ) : (
        <Globe size={32} color="#555" />
      )}
      <span style={{ fontSize: '12px', color: '#888', fontWeight: 500, maxWidth: '85%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
        {domain}
      </span>
    </div>
  );
}

// ── Card thumbnail ────────────────────────────────────────────────────────────

function CardThumbnail({ card }) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasThumbnail = !!card.thumbnail_url && !imgFailed;
  const isInstagramReel = card.source === 'instagram' && !!card.url && /\/(reel|reels)\//.test(card.url);
  const isVideo = card.source === 'youtube' || card.source === 'vimeo' || card.source === 'tiktok' || isInstagramReel;
  const isInstagram = card.source === 'instagram';
  const isTikTok = card.source === 'tiktok';

  return (
    <div style={{
      position: 'relative', width: '100%', paddingBottom: '56.25%',
      background: '#181818', borderRadius: '12px 12px 0 0', overflow: 'hidden', flexShrink: 0,
    }}>
      {hasThumbnail ? (
        <img
          src={card.thumbnail_url}
          alt={card.title || ''}
          onError={() => setImgFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          loading="lazy"
        />
      ) : isInstagram ? (
        <InstagramPlaceholder url={card.url} />
      ) : isTikTok ? (
        <TikTokPlaceholder />
      ) : (
        <FaviconPlaceholder url={card.url || ''} />
      )}
      {isVideo && hasThumbnail && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.22)',
        }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Play size={18} color="white" fill="white" style={{ marginLeft: 2 }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Card dropdown menu — portal-based ────────────────────────────────────────

function CardMenu({ isOpen, onToggle, onEdit, onDelete }) {
  const btnRef = useRef();
  const menuRef = useRef();
  const [menuPos, setMenuPos] = useState(null);

  function handleToggle() {
    if (!isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    onToggle();
  }

  useEffect(() => {
    if (!isOpen) return;
    function handler(e) {
      const inBtn = btnRef.current && btnRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inBtn && !inMenu) onToggle();
    }
    function closeMenu() { onToggle(); }
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [isOpen, onToggle]);

  return (
    <div style={{ flexShrink: 0 }}>
      <button
        ref={btnRef}
        className="btn-ghost"
        onClick={e => { e.stopPropagation(); handleToggle(); }}
        style={{ padding: '3px 6px', opacity: 0.55, border: 'none' }}
        title="Options"
      >
        <MoreHorizontal size={14} />
      </button>

      {isOpen && menuPos && ReactDOM.createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: menuPos.top, right: menuPos.right,
            zIndex: 9999, background: 'var(--bg-card)',
            border: '1px solid var(--border-default)', borderRadius: '10px',
            minWidth: '130px', overflow: 'hidden', boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
          }}
        >
          <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer', textAlign: 'left' }}
            onClick={e => { e.stopPropagation(); onEdit(); onToggle(); }}>
            <Edit2 size={12} /> Edit
          </button>
          <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--danger)', fontSize: '13px', cursor: 'pointer', textAlign: 'left' }}
            onClick={e => { e.stopPropagation(); onDelete(); onToggle(); }}>
            <Trash2 size={12} /> Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Link card ─────────────────────────────────────────────────────────────────

function LinkCard({ card, isMenuOpen, onMenuToggle, onEdit, onDelete, onStar, activeTag, onTagClick }) {
  const tags = parseTags(card.tags);
  const isStarred = !!card.starred;
  return (
    <div
      className="card"
      style={{
        padding: 0, overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column',
        position: 'relative',
        border: isStarred ? '2px solid #F6B93B' : undefined,
        boxShadow: isStarred ? '0 0 0 3px rgba(246,185,59,0.12)' : undefined,
      }}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              className="btn-ghost"
              style={{ padding: '3px 5px', color: isStarred ? '#F6B93B' : undefined, border: 'none' }}
              title={isStarred ? 'Unstar' : 'Star'}
              onClick={() => onStar(card.id)}
            >
              <Star size={13} fill={isStarred ? '#F6B93B' : 'none'} />
            </button>
            <CardMenu isOpen={isMenuOpen} onToggle={onMenuToggle} onEdit={onEdit} onDelete={onDelete} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-muted)', fontSize: '11px' }}>
          <Globe size={10} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {getDomain(card.url)}
          </span>
        </div>
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }} onClick={e => e.stopPropagation()}>
            {tags.map(tag => (
              <TagChip key={tag} tag={tag} active={activeTag === tag} onClick={onTagClick} />
            ))}
          </div>
        )}
      </div>
      {isStarred && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8, zIndex: 10,
          background: '#F6B93B', borderRadius: '50%',
          width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <Star size={10} fill="#000" color="#000" />
        </div>
      )}
    </div>
  );
}

// ── Note card ─────────────────────────────────────────────────────────────────

function NoteCard({ card, isMenuOpen, onMenuToggle, onEdit, onDelete, onStar, isExpanded, onToggleExpand, activeTag, onTagClick }) {
  const isLong = (card.note_text || '').length > 250;
  const tags = parseTags(card.tags);
  const isStarred = !!card.starred;

  return (
    <div
      className="card"
      style={{
        padding: '14px 16px', background: 'rgba(199,255,46,0.04)',
        border: isStarred ? '2px solid #F6B93B' : '1px solid rgba(199,255,46,0.11)',
        boxShadow: isStarred ? '0 0 0 3px rgba(246,185,59,0.12)' : undefined,
        display: 'flex', flexDirection: 'column', gap: '9px', position: 'relative',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
          <button
            className="btn-ghost"
            style={{ padding: '3px 5px', color: isStarred ? '#F6B93B' : undefined, border: 'none' }}
            title={isStarred ? 'Unstar' : 'Star'}
            onClick={e => { e.stopPropagation(); onStar(card.id); }}
          >
            <Star size={13} fill={isStarred ? '#F6B93B' : 'none'} />
          </button>
          <CardMenu isOpen={isMenuOpen} onToggle={onMenuToggle} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
      <p style={{
        fontSize: '13px', lineHeight: 1.65, color: 'var(--text-secondary)', margin: 0,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden',
        display: '-webkit-box', WebkitLineClamp: isExpanded ? 'unset' : 5, WebkitBoxOrient: 'vertical',
        cursor: isLong && !isExpanded ? 'pointer' : 'default',
      }}
        onClick={isLong && !isExpanded ? onToggleExpand : undefined}
      >
        {card.note_text}
      </p>
      {isLong && (
        <button onClick={onToggleExpand} style={{ alignSelf: 'flex-start', fontSize: '11px', fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {isExpanded ? 'Collapse ↑' : 'Read more ↓'}
        </button>
      )}
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {tags.map(tag => <TagChip key={tag} tag={tag} active={activeTag === tag} onClick={onTagClick} />)}
        </div>
      )}
      {isStarred && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8, zIndex: 10,
          background: '#F6B93B', borderRadius: '50%',
          width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <Star size={10} fill="#000" color="#000" />
        </div>
      )}
    </div>
  );
}

// ── Sortable card wrapper (Section 4) ─────────────────────────────────────────

function SortableCardWrapper({ card, ...props }) {
  const isStarred = !!card.starred;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
        zIndex: isDragging ? 999 : undefined,
        position: 'relative',
      }}
      {...attributes}
    >
      {/* Drag handle — disabled for starred (pinned) cards */}
      <div
        {...(isStarred ? {} : listeners)}
        onClick={e => e.stopPropagation()}
        title={isStarred ? 'Starred — unstar to reorder' : 'Drag to reorder'}
        style={{
          position: 'absolute', top: 7, left: 7, zIndex: 20,
          cursor: isStarred ? 'default' : (isDragging ? 'grabbing' : 'grab'),
          background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: '3px 5px',
          color: '#aaa', touchAction: 'none',
          display: 'flex', alignItems: 'center',
          opacity: isStarred ? 0.25 : 1,
        }}
      >
        <GripVertical size={11} />
      </div>
      {card.type === 'link' ? (
        <LinkCard card={card} {...props} />
      ) : (
        <NoteCard card={card} {...props} />
      )}
    </div>
  );
}

// ── Static card wrapper (no drag) ────────────────────────────────────────────

function StaticCardItem({ card, ...props }) {
  return card.type === 'link' ? (
    <LinkCard card={card} {...props} />
  ) : (
    <NoteCard card={card} {...props} />
  );
}

// ── Edit card modal ───────────────────────────────────────────────────────────

function EditCardModal({ card, onSave, onClose }) {
  const [title, setTitle] = useState(card.title || '');
  const [noteText, setNoteText] = useState(card.note_text || '');
  const [url, setUrl] = useState(card.url || '');
  const [tags, setTags] = useState(card.tags || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (card.type === 'note' && !noteText.trim()) { setError('Note text is required'); return; }
    if (card.type === 'link' && !url.trim()) { setError('URL is required'); return; }
    setSaving(true);
    try {
      await onSave(card.id, card.type === 'note'
        ? { title: title.trim() || undefined, note_text: noteText, tags: tags.trim() || null }
        : { title: title.trim() || undefined, url: url.trim(), tags: tags.trim() || null });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <span className="modal-title">Edit {card.type === 'note' ? 'Note' : 'Link'}</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {card.type === 'link' && (
            <div className="form-row">
              <label className="form-label">URL *</label>
              <input className="input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" autoFocus />
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Changing the URL re-fetches the thumbnail.
              </p>
            </div>
          )}
          <div className="form-row">
            <label className="form-label">Title {card.type === 'note' ? '(optional)' : '(optional override)'}</label>
            <input
              className="input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={card.type === 'note' ? 'Optional title' : 'Leave blank to use fetched title'}
              autoFocus={card.type === 'note'}
            />
          </div>
          {card.type === 'note' && (
            <div className="form-row">
              <label className="form-label">Note *</label>
              <textarea className="input" value={noteText} onChange={e => setNoteText(e.target.value)} rows={5} style={{ resize: 'vertical', minHeight: '80px' }} />
            </div>
          )}
          <div className="form-row">
            <label className="form-label">Tags <span style={{ color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400 }}>(comma-separated)</span></label>
            <input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="design, color, 3D" />
          </div>
          {error && (
            <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <AlertCircle size={13} /> {error}
            </p>
          )}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Share modal (Section 5) ───────────────────────────────────────────────────

function ShareModal({ collectionId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [copied, setCopied] = useState(false);
  const [toggling, setToggling] = useState(false);

  const shareUrl = token ? `${window.location.origin}/shared/collection/${token}` : '';

  useEffect(() => {
    // Generate / fetch existing share link
    api.post(`/collections/${collectionId}/share`)
      .then(data => {
        setToken(data.token);
        setEnabled(!!data.enabled);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collectionId]);

  async function toggleEnabled() {
    setToggling(true);
    try {
      await api.put(`/collections/${collectionId}/share`, { enabled: !enabled });
      setEnabled(p => !p);
    } catch (_) {}
    setToggling(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Modal title="Share Collection" onClose={onClose}>
      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '8px 0' }}>Generating link…</p>
      ) : !token ? (
        <p style={{ color: 'var(--danger)', fontSize: '13px' }}>Failed to generate share link.</p>
      ) : (
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
            Anyone with this link can view the collection read-only — no account needed.
            They can click links but cannot add, edit, or delete anything.
          </p>

          {/* Link display + copy */}
          <div className="form-row">
            <label className="form-label">Share Link</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                className="input"
                value={enabled ? shareUrl : '— link disabled —'}
                readOnly
                style={{ flex: 1, fontSize: '12px', opacity: enabled ? 1 : 0.5, color: enabled ? 'var(--text-primary)' : 'var(--text-muted)' }}
              />
              <button
                className="btn btn-primary"
                style={{ flexShrink: 0, minWidth: 80 }}
                onClick={copyLink}
                disabled={!enabled}
              >
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
              </button>
            </div>
          </div>

          {/* Enable/disable toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0 4px', borderTop: '1px solid var(--border-default)' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Link {enabled ? 'Active' : 'Disabled'}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: 2 }}>
                {enabled ? 'Anyone with the link can view this collection.' : 'The link is revoked — no one can open it.'}
              </div>
            </div>
            <button
              className={`btn btn-sm ${enabled ? 'btn-ghost' : 'btn-primary'}`}
              style={{ minWidth: 80, marginLeft: 12 }}
              onClick={toggleEnabled}
              disabled={toggling}
            >
              {toggling ? '…' : enabled ? 'Revoke' : 'Re-enable'}
            </button>
          </div>
        </div>
      )}
    </Modal>
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

  // Add form state
  const [addMode, setAddMode] = useState(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTags, setLinkTags] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteTags, setNoteTags] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  // Cards UI state
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [showShare, setShowShare] = useState(false);

  // Sort mode — never persisted, always defaults to 'latest' on page load
  const [cardSortMode, setCardSortMode] = useState('latest');

  // Search + tag filter
  const [cardSearch, setCardSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

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

  // Sorted then filtered cards
  const sortedCards = applySortMode(cards, cardSortMode);
  const displayedCards = sortedCards.filter(card => {
    const q = cardSearch.trim().toLowerCase();
    const matchSearch = !q || [card.title, card.note_text, card.url, card.source, card.tags]
      .some(f => f && f.toLowerCase().includes(q));
    const matchTag = !activeTag
      || parseTags(card.tags).some(t => t.toLowerCase() === activeTag.toLowerCase());
    return matchSearch && matchTag;
  });

  // ── dnd-kit drag-end handler ──────────────────────────────────────────────

  function handleDragEnd({ active, over }) {
    if (cardSortMode !== 'custom') return;
    if (!over || active.id === over.id) return;
    const activeCard = cards.find(c => c.id === active.id);
    const overCard = cards.find(c => c.id === over.id);
    if (activeCard?.starred || overCard?.starred) return;
    setCards(prev => {
      const oldIndex = prev.findIndex(c => c.id === active.id);
      const newIndex = prev.findIndex(c => c.id === over.id);
      const newOrder = arrayMove(prev, oldIndex, newIndex);
      api.put(`/collections/${id}/cards/reorder`, { orderedIds: newOrder.map(c => c.id) }).catch(() => {});
      return newOrder;
    });
  }

  async function handleStarCard(cardId) {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    try {
      await api.put(`/collections/${id}/cards/${cardId}/star`, { starred: !card.starred });
      await loadCollection();
    } catch (err) { alert(err.message || 'Failed to update'); }
  }

  // ── Card actions ──────────────────────────────────────────────────────────

  async function handleAddLink(e) {
    e.preventDefault();
    if (!linkUrl.trim()) { setAddError('Please enter a URL'); return; }
    setAdding(true); setAddError('');
    try {
      const card = await api.post(`/collections/${id}/cards`, {
        type: 'link', url: linkUrl.trim(),
        tags: linkTags.trim() || undefined,
      });
      setCards(prev => [card, ...prev]);
      setLinkUrl(''); setLinkTags(''); setAddMode(null);
    } catch (err) {
      setAddError(err.message || 'Failed to add link');
    } finally {
      setAdding(false);
    }
  }

  async function handleAddNote(e) {
    e.preventDefault();
    if (!noteText.trim()) { setAddError('Note text is required'); return; }
    setAdding(true); setAddError('');
    try {
      const card = await api.post(`/collections/${id}/cards`, {
        type: 'note',
        title: noteTitle.trim() || undefined,
        note_text: noteText.trim(),
        tags: noteTags.trim() || undefined,
      });
      setCards(prev => [card, ...prev]);
      setNoteTitle(''); setNoteText(''); setNoteTags(''); setAddMode(null);
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
    } catch (err) { alert(err.message || 'Failed'); }
  }

  async function handleDeleteCollection() {
    if (!confirm(`Delete collection "${collection.name}"?\nAll ${cards.length} card(s) inside will be permanently deleted.`)) return;
    try {
      await api.del(`/collections/${id}`);
      navigate('/collections');
    } catch (err) { alert(err.message || 'Failed to delete'); }
  }

  function cancelAdd() {
    setAddMode(null);
    setLinkUrl(''); setLinkTags('');
    setNoteTitle(''); setNoteText(''); setNoteTags('');
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

  function handleTagClick(tag) {
    setActiveTag(prev => prev === tag ? null : tag);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ padding: '24px' }}>
      <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
    </div>
  );

  if (notFound) return (
    <div style={{ padding: '24px' }}>
      <button className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={() => navigate('/collections')}>
        <ChevronLeft size={16} /> Collections
      </button>
      <p style={{ color: 'var(--text-muted)' }}>Collection not found.</p>
    </div>
  );

  return (
    <div>
      {/* ── Page header ── */}
      <div style={{ marginBottom: '24px' }}>
        <button
          className="btn btn-ghost"
          style={{ padding: '6px 12px', fontSize: '13px', marginBottom: '16px' }}
          onClick={() => navigate('/collections')}
        >
          <ChevronLeft size={15} /> Collections
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(199,255,46,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
            <button className="btn btn-ghost" style={{ padding: '7px 13px', fontSize: '12px' }} onClick={() => setShowShare(true)} title="Share collection">
              <Share2 size={13} /> Share
            </button>
            <button className="btn btn-ghost" style={{ padding: '7px 13px', fontSize: '12px' }} onClick={handleArchive} title={collection.archived ? 'Unarchive' : 'Archive'}>
              {collection.archived
                ? <><ArchiveRestore size={13} /> Unarchive</>
                : <><Archive size={13} /> Archive</>}
            </button>
            <button className="btn btn-ghost" style={{ padding: '7px 13px', fontSize: '12px', color: 'var(--danger)', borderColor: 'rgba(255,68,68,0.3)' }} onClick={handleDeleteCollection} title="Delete collection">
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>

        {collection.description && (
          <p style={{ marginTop: '10px', color: 'var(--text-secondary)', fontSize: '13px' }}>
            {collection.description}
          </p>
        )}
      </div>

      {/* ── Add buttons (Section 1 — polished) ── */}
      {!addMode && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" style={{ fontSize: '13px' }} onClick={() => { setAddMode('link'); setAddError(''); }}>
            <Link2 size={14} /> Add Link
          </button>
          <button className="btn btn-ghost" style={{ fontSize: '13px' }} onClick={() => { setAddMode('note'); setAddError(''); }}>
            <FileText size={14} /> Add Note
          </button>
        </div>
      )}

      {/* ── Add Link inline form (Section 1 — polished card) ── */}
      {addMode === 'link' && (
        <div className="card" style={{ padding: '20px 22px', marginBottom: '24px', border: '1px solid rgba(199,255,46,0.22)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Link2 size={14} color="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: '14px' }}>Add Link</span>
            <button onClick={cancelAdd} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
              <X size={15} />
            </button>
          </div>
          <form onSubmit={handleAddLink}>
            <div className="form-row">
              <label className="form-label">URL</label>
              <input
                className="input"
                placeholder="Paste a URL — YouTube, Vimeo, Pinterest, Behance, or any site…"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                autoFocus
                disabled={adding}
              />
            </div>
            <div className="form-row">
              <label className="form-label">Tags <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-muted)' }}>(comma-separated, optional)</span></label>
              <input
                className="input"
                placeholder="design, color, 3D"
                value={linkTags}
                onChange={e => setLinkTags(e.target.value)}
                disabled={adding}
              />
            </div>
            {adding && (
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 12px' }}>Fetching preview — this may take a few seconds…</p>
            )}
            {addError && !adding && (
              <p style={{ color: 'var(--danger)', fontSize: '12px', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <AlertCircle size={12} /> {addError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={cancelAdd} disabled={adding}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={adding}>{adding ? 'Fetching…' : 'Add Link'}</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Add Note inline form (Section 1 — polished card) ── */}
      {addMode === 'note' && (
        <div className="card" style={{ padding: '20px 22px', marginBottom: '24px', border: '1px solid rgba(199,255,46,0.22)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <FileText size={14} color="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: '14px' }}>Add Note</span>
            <button onClick={cancelAdd} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
              <X size={15} />
            </button>
          </div>
          <form onSubmit={handleAddNote}>
            <div className="form-row">
              <label className="form-label">Title <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-muted)' }}>(optional)</span></label>
              <input className="input" placeholder="Note title" value={noteTitle} onChange={e => setNoteTitle(e.target.value)} autoFocus disabled={adding} />
            </div>
            <div className="form-row">
              <label className="form-label">Note *</label>
              <textarea className="input" placeholder="Write your note…" value={noteText} onChange={e => setNoteText(e.target.value)} rows={4} style={{ resize: 'vertical', minHeight: '80px' }} disabled={adding} />
            </div>
            <div className="form-row">
              <label className="form-label">Tags <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-muted)' }}>(comma-separated, optional)</span></label>
              <input className="input" placeholder="design, color, 3D" value={noteTags} onChange={e => setNoteTags(e.target.value)} disabled={adding} />
            </div>
            {addError && (
              <p style={{ color: 'var(--danger)', fontSize: '12px', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <AlertCircle size={12} /> {addError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={cancelAdd} disabled={adding}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={adding}>{adding ? 'Saving…' : 'Add Note'}</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Search bar + tag filter ── */}
      {cards.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: activeTag ? '10px' : 0 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                className="input"
                value={cardSearch}
                onChange={e => setCardSearch(e.target.value)}
                placeholder="Search cards by title, text, URL, tags…"
                style={{ paddingLeft: 36, paddingRight: cardSearch ? 32 : 12, fontSize: '13px' }}
              />
              {cardSearch && (
                <button
                  onClick={() => setCardSearch('')}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <SortSelector value={cardSortMode} onChange={setCardSortMode} />
          </div>
          {activeTag && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Filtering by tag:</span>
              <button
                onClick={() => setActiveTag(null)}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: 50, fontSize: '12px', fontWeight: 600, background: 'var(--accent)', color: '#0F0F0F', border: 'none', cursor: 'pointer' }}
              >
                {activeTag} <X size={11} />
              </button>
            </div>
          )}
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
              <button className="btn btn-primary" style={{ fontSize: '13px' }} onClick={() => setAddMode('link')}>
                <Link2 size={14} /> Add Link
              </button>
              <button className="btn btn-ghost" style={{ fontSize: '13px' }} onClick={() => setAddMode('note')}>
                <FileText size={14} /> Add Note
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Card grid with dnd-kit (Section 4) ── */}
      {cards.length > 0 && (
        displayedCards.length === 0 ? (
          <div className="card" style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            No cards match{activeTag ? ` tag "${activeTag}"` : ''}{cardSearch ? ` "${cardSearch}"` : ''}.
            {(cardSearch || activeTag) && (
              <button
                onClick={() => { setCardSearch(''); setActiveTag(null); }}
                style={{ marginLeft: '10px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : cardSortMode === 'custom' ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={displayedCards.map(c => c.id)} strategy={rectSortingStrategy}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '16px',
              }}>
                {displayedCards.map(card => (
                  <SortableCardWrapper
                    key={card.id}
                    card={card}
                    isMenuOpen={openMenuId === card.id}
                    onMenuToggle={() => toggleMenu(card.id)}
                    onEdit={() => { setEditingCard(card); setOpenMenuId(null); }}
                    onDelete={() => handleDeleteCard(card.id)}
                    onStar={handleStarCard}
                    isExpanded={expandedIds.has(card.id)}
                    onToggleExpand={() => toggleExpand(card.id)}
                    activeTag={activeTag}
                    onTagClick={handleTagClick}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '16px',
          }}>
            {displayedCards.map(card => (
              <StaticCardItem
                key={card.id}
                card={card}
                isMenuOpen={openMenuId === card.id}
                onMenuToggle={() => toggleMenu(card.id)}
                onEdit={() => { setEditingCard(card); setOpenMenuId(null); }}
                onDelete={() => handleDeleteCard(card.id)}
                onStar={handleStarCard}
                isExpanded={expandedIds.has(card.id)}
                onToggleExpand={() => toggleExpand(card.id)}
                activeTag={activeTag}
                onTagClick={handleTagClick}
              />
            ))}
          </div>
        )
      )}

      {/* ── Edit card modal ── */}
      {editingCard && (
        <EditCardModal
          card={editingCard}
          onSave={handleEditCard}
          onClose={() => setEditingCard(null)}
        />
      )}

      {/* ── Share modal (Section 5) ── */}
      {showShare && (
        <ShareModal collectionId={id} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}
