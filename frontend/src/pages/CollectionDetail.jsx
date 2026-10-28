import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronDown, ChevronUp, Library, FolderKanban, Archive, ArchiveRestore, Trash2,
  Link2, Link2Off, FileText, Edit2, Play, Globe, X, SearchX, Share2, Copy, Check, GripVertical,
  Instagram, Music2, Star, Unlink, Clock, History, ArrowDownAZ,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api';
import Overlay from '../components/Overlay';
import ConfirmDialog from '../components/ConfirmDialog';
import IconMenu from '../components/IconMenu';
import SourceIcon from '../components/SourceIcon';
import { IconToggles } from '../components/DbBits';
import { EditCollectionModal } from './Collections';
import '../styles/mind.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}

function parseTags(tags) {
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(Boolean);
}

const SORTS = [
  { key: 'latest', Icon: Clock,        title: 'Newest' },
  { key: 'oldest', Icon: History,      title: 'Oldest' },
  { key: 'name',   Icon: ArrowDownAZ,  title: 'A to Z' },
  { key: 'custom', Icon: GripVertical, title: 'Custom order' },
];

// Starred first, then the chosen order. Custom keeps the stored order.
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

// ── Card pieces ───────────────────────────────────────────────────────────────

function TagChip({ tag, active, onClick }) {
  return (
    <button type="button" className={`card-tag ${active ? 'active' : ''}`} onClick={e => { e.stopPropagation(); onClick(tag); }}>
      {tag}
    </button>
  );
}

function FaviconFallback({ url }) {
  const domain = getDomain(url);
  const [failed, setFailed] = useState(false);
  return (
    <div className="card-thumb-fallback">
      {!failed ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        <Globe size={30} />
      )}
    </div>
  );
}

function CardThumbnail({ card }) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasThumbnail = !!card.thumbnail_url && !imgFailed;
  const isInstagramReel = card.source === 'instagram' && !!card.url && /\/(reel|reels)\//.test(card.url);
  const isVideo = card.source === 'youtube' || card.source === 'vimeo' || card.source === 'tiktok' || isInstagramReel;

  let body;
  if (hasThumbnail) {
    body = <img src={card.thumbnail_url} alt="" loading="lazy" onError={() => setImgFailed(true)} />;
  } else if (card.source === 'instagram') {
    body = <div className="card-thumb-fallback"><Instagram size={34} strokeWidth={1.5} /></div>;
  } else if (card.source === 'tiktok') {
    body = <div className="card-thumb-fallback"><Music2 size={34} strokeWidth={1.5} /></div>;
  } else {
    body = <FaviconFallback url={card.url || ''} />;
  }

  return (
    <div className="card-thumb">
      {body}
      {isVideo && hasThumbnail && (
        <div className="card-play"><span><Play size={17} color="white" fill="white" style={{ marginLeft: 2 }} /></span></div>
      )}
    </div>
  );
}

function StarButton({ starred, onClick }) {
  return (
    <button
      type="button"
      className="db-iconbtn acct-secret-btn"
      style={starred ? { color: 'var(--color-ink)' } : undefined}
      title={starred ? 'Unstar' : 'Star'}
      aria-label={starred ? 'Unstar' : 'Star'}
      onClick={e => { e.stopPropagation(); onClick(); }}
    >
      <Star size={13} fill={starred ? 'currentColor' : 'none'} />
    </button>
  );
}

function cardMenu(onEdit, onDelete) {
  return [
    { key: 'edit', Icon: Edit2, title: 'Edit', onClick: onEdit },
    { key: 'delete', Icon: Trash2, title: 'Delete', danger: true, onClick: onDelete },
  ];
}

function LinkCard({ card, grip, onEdit, onDelete, onStar, activeTag, onTagClick }) {
  const tags = parseTags(card.tags);
  const domain = getDomain(card.url);
  const open = () => window.open(card.url, '_blank', 'noopener,noreferrer');
  return (
    <div
      className={`link-card ${card.starred ? 'card-starred' : ''}`}
      role="link"
      tabIndex={0}
      title={card.url}
      onClick={open}
      onKeyDown={e => { if (e.key === 'Enter') open(); }}
    >
      {grip}
      <CardThumbnail card={card} />
      <div className="card-body">
        <SourceIcon source={card.source} title={domain} style={{ marginTop: 3 }} />
        <p className={`card-title ${card.title ? '' : 'is-domain'}`}>{card.title || domain}</p>
        <span style={{ display: 'inline-flex' }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          <StarButton starred={!!card.starred} onClick={() => onStar(card.id)} />
          <IconMenu items={cardMenu(onEdit, onDelete)} size={14} />
        </span>
      </div>
      {tags.length > 0 && (
        <div className="card-tags" onClick={e => e.stopPropagation()}>
          {tags.map(tag => <TagChip key={tag} tag={tag} active={activeTag === tag} onClick={onTagClick} />)}
        </div>
      )}
    </div>
  );
}

function NoteCard({ card, grip, onEdit, onDelete, onStar, isExpanded, onToggleExpand, activeTag, onTagClick }) {
  const isLong = (card.note_text || '').length > 250;
  const tags = parseTags(card.tags);
  return (
    <div className={`note-card ${card.starred ? 'card-starred' : ''}`}>
      {grip}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span className="source-icon" title="Note"><FileText size={13} /></span>
        <span className="card-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.title}</span>
        <StarButton starred={!!card.starred} onClick={() => onStar(card.id)} />
        <IconMenu items={cardMenu(onEdit, onDelete)} size={14} />
      </div>
      <p className="note-text" style={{ WebkitLineClamp: isExpanded ? 'unset' : 5, paddingRight: 6 }}>{card.note_text}</p>
      {isLong && (
        <button
          type="button"
          className="db-iconbtn acct-secret-btn"
          onClick={onToggleExpand}
          title={isExpanded ? 'Collapse' : 'Expand'}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
      {tags.length > 0 && (
        <div className="card-tags">
          {tags.map(tag => <TagChip key={tag} tag={tag} active={activeTag === tag} onClick={onTagClick} />)}
        </div>
      )}
    </div>
  );
}

function CardItem({ card, ...props }) {
  return card.type === 'link' ? <LinkCard card={card} {...props} /> : <NoteCard card={card} {...props} />;
}

function SortableCard({ card, ...props }) {
  const isStarred = !!card.starred;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const grip = (
    <span
      className={`coll-grip ${isStarred ? 'is-off' : ''}`}
      title={isStarred ? 'Starred' : 'Drag'}
      onClick={e => e.stopPropagation()}
      {...(isStarred ? {} : listeners)}
    >
      <GripVertical size={12} />
    </span>
  );
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
        zIndex: isDragging ? 20 : undefined,
        position: 'relative',
      }}
      {...attributes}
    >
      <CardItem card={card} grip={grip} {...props} />
    </div>
  );
}

// ── Add and edit overlays ─────────────────────────────────────────────────────

function CardFormOverlay({ title, formId, busy, submitLabel, error, onClose, onSubmit, children }) {
  return (
    <Overlay
      title={title}
      onClose={onClose}
      width={460}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Working...' : submitLabel}</button>
      </>}
    >
      <form id={formId} onSubmit={onSubmit}>
        {children}
        {error && <div className="error-msg">{error}</div>}
      </form>
    </Overlay>
  );
}

function AddCardModal({ kind, collectionId, onAdded, onClose }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (kind === 'link' && !url.trim()) { setError('URL is required'); return; }
    if (kind === 'note' && !noteText.trim()) { setError('Note is required'); return; }
    setBusy(true);
    setError('');
    try {
      const body = kind === 'link'
        ? { type: 'link', url: url.trim(), tags: tags.trim() || undefined }
        : { type: 'note', title: title.trim() || undefined, note_text: noteText.trim(), tags: tags.trim() || undefined };
      onAdded(await api.post(`/collections/${collectionId}/cards`, body));
    } catch (err) {
      setError(err.message || 'Failed to add');
      setBusy(false);
    }
  }

  return (
    <CardFormOverlay
      title={kind === 'link' ? 'Add Link' : 'Add Note'}
      formId="card-add"
      busy={busy}
      submitLabel="Add"
      error={error}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {kind === 'link' ? (
        <div className="form-row">
          <label className="form-label">URL *</label>
          <input className="input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" autoFocus disabled={busy} />
        </div>
      ) : (
        <>
          <div className="form-row">
            <label className="form-label">Title</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus disabled={busy} />
          </div>
          <div className="form-row">
            <label className="form-label">Note *</label>
            <textarea className="input" value={noteText} onChange={e => setNoteText(e.target.value)} rows={5} style={{ resize: 'vertical', minHeight: '90px' }} disabled={busy} />
          </div>
        </>
      )}
      <div className="form-row">
        <label className="form-label">Tags</label>
        <input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="design, color, 3D" disabled={busy} />
      </div>
    </CardFormOverlay>
  );
}

function EditCardModal({ card, onSave, onClose }) {
  const [title, setTitle] = useState(card.title || '');
  const [noteText, setNoteText] = useState(card.note_text || '');
  const [url, setUrl] = useState(card.url || '');
  const [tags, setTags] = useState(card.tags || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isNote = card.type === 'note';

  async function handleSubmit(e) {
    e.preventDefault();
    if (isNote && !noteText.trim()) { setError('Note is required'); return; }
    if (!isNote && !url.trim()) { setError('URL is required'); return; }
    setBusy(true);
    try {
      await onSave(card.id, isNote
        ? { title: title.trim() || undefined, note_text: noteText, tags: tags.trim() || null }
        : { title: title.trim() || undefined, url: url.trim(), tags: tags.trim() || null });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save');
      setBusy(false);
    }
  }

  return (
    <CardFormOverlay
      title={isNote ? 'Edit Note' : 'Edit Link'}
      formId="card-edit"
      busy={busy}
      submitLabel="Save"
      error={error}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {!isNote && (
        <div className="form-row">
          <label className="form-label">URL *</label>
          <input className="input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" autoFocus />
        </div>
      )}
      <div className="form-row">
        <label className="form-label">Title</label>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus={isNote} />
      </div>
      {isNote && (
        <div className="form-row">
          <label className="form-label">Note *</label>
          <textarea className="input" value={noteText} onChange={e => setNoteText(e.target.value)} rows={5} style={{ resize: 'vertical', minHeight: '90px' }} />
        </div>
      )}
      <div className="form-row">
        <label className="form-label">Tags</label>
        <input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="design, color, 3D" />
      </div>
    </CardFormOverlay>
  );
}

// ── Share one collection ──────────────────────────────────────────────────────

function ShareModal({ collectionId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState(null);

  const shareUrl = token ? `${window.location.origin}/shared/collection/${token}` : '';

  // Read the link as it stands. A revoked link stays revoked until it is
  // turned back on here, through the confirm.
  useEffect(() => {
    api.get(`/collections/${collectionId}/share`)
      .then(data => {
        if (data.has_link) {
          setToken(data.token);
          setEnabled(!!data.enabled);
        }
      })
      .catch(err => setNotice({ title: 'Share link not loaded', message: err.message }))
      .finally(() => setLoading(false));
  }, [collectionId]);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function create() {
    setBusy(true);
    try {
      const data = await api.post(`/collections/${collectionId}/share`);
      setToken(data.token);
      setEnabled(!!data.enabled);
    } catch (err) {
      setNotice({ title: 'Link not created', message: err.message || 'The link could not be created.' });
    }
    setBusy(false);
  }

  async function toggleEnabled() {
    setConfirming(false);
    setBusy(true);
    try {
      await api.put(`/collections/${collectionId}/share`, { enabled: !enabled });
      setEnabled(v => !v);
    } catch (err) {
      setNotice({ title: 'Link not updated', message: err.message || 'The link could not be updated.' });
    }
    setBusy(false);
  }

  async function copy() {
    if (await copyText(shareUrl)) setCopied(true);
    else setNotice({ title: 'Not copied', message: 'The browser did not allow copying.' });
  }

  let footer = null;
  if (!loading) {
    footer = !token ? (
      <>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={create} disabled={busy} title="Create link" aria-label="Create link">
          <Link2 size={15} />
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          className={`db-iconbtn ${enabled ? 'danger' : ''}`}
          onClick={() => setConfirming(true)}
          disabled={busy}
          title={enabled ? 'Revoke link' : 'Turn link on'}
          aria-label={enabled ? 'Revoke link' : 'Turn link on'}
        >
          {enabled ? <Link2Off size={16} /> : <Link2 size={16} />}
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </>
    );
  }

  return (
    <Overlay title="Share Collection" onClose={onClose} guard={false} width={480} footer={footer}>
      {loading ? (
        <div className="loading" style={{ padding: '16px' }}>Loading...</div>
      ) : token ? (
        <div className="share-field">
          <span className={enabled ? 'db-dot ink' : 'db-dot muted'} title={enabled ? 'On' : 'Off'} />
          <input className={`input ${enabled ? '' : 'is-off'}`} value={shareUrl} readOnly onFocus={e => e.target.select()} />
          <button type="button" className="db-iconbtn lg" onClick={copy} disabled={!enabled} title="Copy" aria-label="Copy link">
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      ) : (
        <div className="db-empty" style={{ padding: '12px' }}><Link2 size={24} /></div>
      )}
      {confirming && (
        <ConfirmDialog
          title={enabled ? 'Revoke this link?' : 'Turn this link back on?'}
          message={enabled
            ? 'Anyone holding the link loses access until it is turned back on.'
            : 'Anyone holding the link can view this collection again.'}
          confirmLabel={enabled ? 'Revoke' : 'Turn on'}
          tone={enabled ? 'danger' : 'default'}
          onConfirm={toggleEnabled}
          onCancel={() => setConfirming(false)}
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
    </Overlay>
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

  const [addKind, setAddKind] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [editingCollection, setEditingCollection] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [showShare, setShowShare] = useState(false);
  const [confirmDeleteCard, setConfirmDeleteCard] = useState(null);
  const [confirmDeleteCollection, setConfirmDeleteCollection] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState(null);

  // The sort is never persisted and always opens on newest.
  const [cardSortMode, setCardSortMode] = useState('latest');
  const [cardSearch, setCardSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);

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

  function showNotice(title, message) {
    setNotice({ title, message });
  }

  const sortedCards = applySortMode(cards, cardSortMode);
  const displayedCards = sortedCards.filter(card => {
    const q = cardSearch.trim().toLowerCase();
    const matchSearch = !q || [card.title, card.note_text, card.url, card.source, card.tags]
      .some(f => f && f.toLowerCase().includes(q));
    const matchTag = !activeTag
      || parseTags(card.tags).some(t => t.toLowerCase() === activeTag.toLowerCase());
    return matchSearch && matchTag;
  });

  // The new order shows at once. When the server refuses it the previous
  // order comes back and a notice says so.
  async function handleDragEnd({ active, over }) {
    if (cardSortMode !== 'custom') return;
    if (!over || active.id === over.id) return;
    const activeCard = cards.find(c => c.id === active.id);
    const overCard = cards.find(c => c.id === over.id);
    if (activeCard?.starred || overCard?.starred) return;
    const previous = cards;
    const next = arrayMove(cards, cards.findIndex(c => c.id === active.id), cards.findIndex(c => c.id === over.id));
    setCards(next);
    try {
      await api.put(`/collections/${id}/cards/reorder`, { orderedIds: next.map(c => c.id) });
    } catch (err) {
      setCards(previous);
      showNotice('Order not saved', err.message || 'The new order could not be saved.');
    }
  }

  async function handleStarCard(cardId) {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    try {
      await api.put(`/collections/${id}/cards/${cardId}/star`, { starred: !card.starred });
      await loadCollection();
    } catch (err) {
      showNotice('Not updated', err.message || 'The card could not be updated.');
    }
  }

  function handleAdded(card) {
    setCards(prev => [card, ...prev]);
    setAddKind(null);
  }

  async function handleEditCard(cardId, data) {
    const updated = await api.put(`/collections/${id}/cards/${cardId}`, data);
    setCards(prev => prev.map(c => (c.id === cardId ? updated : c)));
  }

  async function handleEditCollection(data) {
    await api.put(`/collections/${id}`, data);
    setCollection(prev => ({ ...prev, name: data.name, description: data.description || null }));
  }

  async function runDeleteCard() {
    const cardId = confirmDeleteCard.id;
    setDeleting(true);
    try {
      await api.del(`/collections/${id}/cards/${cardId}`);
      setCards(prev => prev.filter(c => c.id !== cardId));
      setConfirmDeleteCard(null);
    } catch (err) {
      setConfirmDeleteCard(null);
      showNotice('Not deleted', err.message || 'The card could not be deleted.');
    }
    setDeleting(false);
  }

  async function handleArchive() {
    const next = collection.archived ? 0 : 1;
    try {
      await api.patch(`/collections/${id}/archive`, { archived: next });
      setCollection(prev => ({ ...prev, archived: next }));
    } catch (err) {
      showNotice('Not updated', err.message || 'The collection could not be updated.');
    }
  }

  async function runDeleteCollection() {
    setDeleting(true);
    try {
      await api.del(`/collections/${id}`);
      navigate('/collections');
    } catch (err) {
      setConfirmDeleteCollection(false);
      setDeleting(false);
      showNotice('Not deleted', err.message || 'The collection could not be deleted.');
    }
  }

  function toggleExpand(cardId) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
      return next;
    });
  }

  function handleTagClick(tag) {
    setActiveTag(prev => (prev === tag ? null : tag));
  }

  if (loading) return <div className="loading">Loading...</div>;

  if (notFound) {
    return (
      <div>
        <div className="db-head">
          <button type="button" className="db-iconbtn lg" onClick={() => navigate('/collections')} title="Collections" aria-label="Back to collections">
            <ChevronLeft size={18} />
          </button>
        </div>
        <div className="card db-empty"><SearchX size={28} /></div>
      </div>
    );
  }

  const isProject = collection.kind === 'project';
  const cardProps = card => ({
    onEdit: () => setEditingCard(card),
    onDelete: () => setConfirmDeleteCard(card),
    onStar: handleStarCard,
    isExpanded: expandedIds.has(card.id),
    onToggleExpand: () => toggleExpand(card.id),
    activeTag,
    onTagClick: handleTagClick,
  });

  return (
    <div>
      <div className="db-head">
        <button type="button" className="db-iconbtn lg" onClick={() => navigate('/collections')} title="Collections" aria-label="Back to collections">
          <ChevronLeft size={18} />
        </button>
        <div className="db-main">
          <div className="page-title">{collection.name}</div>
          <div className="coll-meta">
            <span className="db-count" title={`${cards.length} card${cards.length === 1 ? '' : 's'}`}>
              <span className="db-dot" />{cards.length}
            </span>
            {isProject && (collection.project_id && collection.project_title ? (
              <span className="db-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <FolderKanban size={12} />{collection.project_title}
              </span>
            ) : (
              <span className="source-icon" title="No project" aria-label="No project" style={{ color: 'var(--color-hairline-strong)' }}>
                <Unlink size={12} />
              </span>
            ))}
            {!!collection.archived && (
              <span className="source-icon" title="Archived" aria-label="Archived"><Archive size={12} /></span>
            )}
          </div>
        </div>
        <div className="db-actions">
          <button type="button" className="db-iconbtn" onClick={() => setShowShare(true)} title="Share" aria-label="Share"><Share2 size={16} /></button>
          <button type="button" className="db-iconbtn" onClick={() => setEditingCollection(true)} title="Edit" aria-label="Edit"><Edit2 size={16} /></button>
          <button type="button" className="db-iconbtn" onClick={handleArchive} title={collection.archived ? 'Unarchive' : 'Archive'} aria-label={collection.archived ? 'Unarchive' : 'Archive'}>
            {collection.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </button>
          <button type="button" className="db-iconbtn danger" onClick={() => setConfirmDeleteCollection(true)} title="Delete" aria-label="Delete"><Trash2 size={16} /></button>
        </div>
      </div>

      {collection.description && (
        <p className="db-sub" style={{ whiteSpace: 'normal', margin: '-8px 0 18px' }}>{collection.description}</p>
      )}

      <div className="mind-toolbar">
        {cards.length > 0 && (
          <>
            <input className="input" value={cardSearch} onChange={e => setCardSearch(e.target.value)} placeholder="Search" />
            <IconToggles options={SORTS} value={cardSortMode} onChange={setCardSortMode} label="Sort" />
          </>
        )}
        {activeTag && (
          <button type="button" className="card-tag active" onClick={() => setActiveTag(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {activeTag} <X size={11} />
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="db-iconbtn lg" onClick={() => setAddKind('link')} title="Add link" aria-label="Add link"><Link2 size={17} /></button>
        <button type="button" className="db-iconbtn lg" onClick={() => setAddKind('note')} title="Add note" aria-label="Add note"><FileText size={17} /></button>
      </div>

      {cards.length === 0 ? (
        <div className="card db-empty"><Library size={28} /></div>
      ) : displayedCards.length === 0 ? (
        <div className="card db-empty" style={{ gap: 10, alignItems: 'center' }}>
          <SearchX size={26} />
          <button
            type="button"
            className="db-iconbtn"
            onClick={() => { setCardSearch(''); setActiveTag(null); }}
            title="Clear filters"
            aria-label="Clear filters"
          >
            <X size={15} />
          </button>
        </div>
      ) : cardSortMode === 'custom' ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayedCards.map(c => c.id)} strategy={rectSortingStrategy}>
            <div className="card-grid">
              {displayedCards.map(card => <SortableCard key={card.id} card={card} {...cardProps(card)} />)}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="card-grid">
          {displayedCards.map(card => <CardItem key={card.id} card={card} {...cardProps(card)} />)}
        </div>
      )}

      {addKind && (
        <AddCardModal kind={addKind} collectionId={id} onAdded={handleAdded} onClose={() => setAddKind(null)} />
      )}
      {editingCard && (
        <EditCardModal card={editingCard} onSave={handleEditCard} onClose={() => setEditingCard(null)} />
      )}
      {editingCollection && (
        <EditCollectionModal collection={collection} onSave={handleEditCollection} onClose={() => setEditingCollection(false)} />
      )}
      {showShare && <ShareModal collectionId={id} onClose={() => setShowShare(false)} />}
      {confirmDeleteCard && (
        <ConfirmDialog
          title="Delete this card?"
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          onConfirm={runDeleteCard}
          onCancel={() => setConfirmDeleteCard(null)}
        />
      )}
      {confirmDeleteCollection && (
        <ConfirmDialog
          title={`Delete ${collection.name}?`}
          message={cards.length > 0 ? `${cards.length} card${cards.length === 1 ? '' : 's'} inside will be deleted too.` : undefined}
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          onConfirm={runDeleteCollection}
          onCancel={() => setConfirmDeleteCollection(false)}
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
