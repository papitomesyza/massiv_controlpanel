import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Edit2, Trash2, FolderKanban, Library, Clapperboard, User,
  Archive, ArchiveRestore, Link2, Link2Off, FileText, GripVertical,
  Instagram, Music2, Star, Share2, Copy, Check, Unlink, RefreshCw,
  Clock, History, ArrowDownAZ,
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
import { IconToggles, useDebounced } from '../components/DbBits';
import '../styles/mind.css';

// ── Kinds, sorts and tabs ─────────────────────────────────────────────────────

const KINDS = ['project', 'studio', 'personal'];
const KIND_META = {
  project:  { title: 'Project', Icon: FolderKanban },
  studio:   { title: 'Studio', Icon: Clapperboard },
  personal: { title: 'Personal', Icon: User },
};
const KIND_TOGGLES = KINDS.map(key => ({ key, Icon: KIND_META[key].Icon, title: KIND_META[key].title }));

const SORTS = [
  { key: 'latest', Icon: Clock,        title: 'Newest' },
  { key: 'oldest', Icon: History,      title: 'Oldest' },
  { key: 'name',   Icon: ArrowDownAZ,  title: 'A to Z' },
  { key: 'custom', Icon: GripVertical, title: 'Custom order' },
];

const TABS = [
  { key: 'active', Icon: Library, title: 'Active' },
  { key: 'archived', Icon: Archive, title: 'Archived' },
];

// Starred first, then the chosen order inside each group.
function applySortMode(list, mode) {
  const starred = list.filter(c => c.starred);
  const rest = list.filter(c => !c.starred);
  function sortGroup(arr) {
    if (mode === 'oldest') return [...arr].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (mode === 'name') return [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    if (mode === 'custom') return [...arr].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
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

// ── Collection tile ───────────────────────────────────────────────────────────

function TileCover({ collection }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (collection.cover_thumbnail && !imgFailed) {
    return (
      <div className="coll-cover">
        <img src={collection.cover_thumbnail} alt="" loading="lazy" onError={() => setImgFailed(true)} />
      </div>
    );
  }
  const Icon = collection.cover_source === 'instagram' ? Instagram
    : collection.cover_source === 'tiktok' ? Music2
    : Library;
  return <div className="coll-cover"><Icon size={26} strokeWidth={1.5} /></div>;
}

function CollectionTile({ collection, grip, onOpen, onEdit, onDelete, onArchive, onStar }) {
  const isStarred = !!collection.starred;
  const isProject = collection.kind === 'project';
  return (
    <div
      className={`coll-tile ${collection.archived ? 'is-muted' : ''} ${isStarred ? 'card-starred' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      {grip}
      <TileCover collection={collection} />
      <div className="coll-body">
        <div className="db-main">
          <div className="coll-name">{collection.name}</div>
          <div className="coll-meta">
            <span className="db-count" title={`${collection.card_count} card${collection.card_count === 1 ? '' : 's'}`}>
              <span className="db-dot" />{collection.card_count}
            </span>
            {isStarred && <span className="coll-star" title="Starred"><Star size={11} fill="currentColor" /></span>}
            {isProject && (collection.project_id && collection.project_title ? (
              <span className="db-sub" title={collection.project_title}>{collection.project_title}</span>
            ) : (
              <span className="source-icon" title="No project" aria-label="No project" style={{ color: 'var(--color-hairline-strong)' }}>
                <Unlink size={11} />
              </span>
            ))}
          </div>
        </div>
        <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          <IconMenu items={[
            { key: 'star', Icon: Star, title: isStarred ? 'Unstar' : 'Star', active: isStarred, onClick: () => onStar(collection) },
            { key: 'edit', Icon: Edit2, title: 'Edit', onClick: () => onEdit(collection) },
            collection.archived
              ? { key: 'unarchive', Icon: ArchiveRestore, title: 'Unarchive', onClick: () => onArchive(collection) }
              : { key: 'archive', Icon: Archive, title: 'Archive', onClick: () => onArchive(collection) },
            { key: 'delete', Icon: Trash2, title: 'Delete', danger: true, onClick: () => onDelete(collection) },
          ]} />
        </span>
      </div>
    </div>
  );
}

function SortableCollectionTile(props) {
  const { collection } = props;
  const isStarred = !!collection.starred;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: collection.id });
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
      <CollectionTile {...props} grip={grip} />
    </div>
  );
}

// ── Section: kind icon, count dot, tiles ──────────────────────────────────────

function CollectionSection({ kind, list, archived, sortable, onReorder, tileProps }) {
  const { Icon, title } = KIND_META[kind];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const activeItem = list.find(c => c.id === active.id);
    const overItem = list.find(c => c.id === over.id);
    if (activeItem?.starred || overItem?.starred) return;
    const oldIndex = list.findIndex(c => c.id === active.id);
    const newIndex = list.findIndex(c => c.id === over.id);
    onReorder(kind, list, arrayMove(list, oldIndex, newIndex));
  }

  const tile = c => ({ key: c.id, collection: c, ...tileProps(c) });

  let body;
  if (list.length === 0) {
    body = <div className="card db-empty"><Icon size={24} /></div>;
  } else if (sortable) {
    body = (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={list.map(c => c.id)} strategy={rectSortingStrategy}>
          <div className="collections-tile-grid">
            {list.map(c => { const { key, ...p } = tile(c); return <SortableCollectionTile key={key} {...p} />; })}
          </div>
        </SortableContext>
      </DndContext>
    );
  } else {
    body = (
      <div className="collections-tile-grid">
        {list.map(c => { const { key, ...p } = tile(c); return <CollectionTile key={key} {...p} />; })}
      </div>
    );
  }

  return (
    <section className="mind-section">
      <div className="mind-section-head" title={title}>
        <Icon size={16} />
        {archived && <Archive size={14} className="muted" />}
        <span className="db-count"><span className="db-dot" />{list.length}</span>
      </div>
      {body}
    </section>
  );
}

// ── Edit overlay ──────────────────────────────────────────────────────────────

export function EditCollectionModal({ collection, onSave, onClose }) {
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim() });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <Overlay
      title="Edit Collection"
      onClose={onClose}
      width={460}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="collection-edit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </>}
    >
      <form id="collection-edit" onSubmit={handleSubmit}>
        <div className="form-row">
          <label className="form-label">Name *</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">Description</label>
          <input className="input" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        {error && <div className="error-msg">{error}</div>}
      </form>
    </Overlay>
  );
}

// ── New collection overlay ────────────────────────────────────────────────────

function NewCollectionModal({ projects, onClose, onCreated }) {
  const [kind, setKind] = useState('studio');
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function onProjectChange(pid) {
    setProjectId(pid);
    const proj = projects.find(p => String(p.id) === String(pid));
    if (proj && !name.trim()) setName(proj.title);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (kind === 'project' && !projectId) { setError('Select a project'); return; }
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const body = { name: name.trim(), description: description.trim() || undefined, kind };
      if (kind === 'project') body.project_id = Number(projectId);
      onCreated(await api.post('/collections', body));
    } catch (err) {
      setError(err.message || 'Failed to create');
      setSaving(false);
    }
  }

  return (
    <Overlay
      title="New Collection"
      onClose={onClose}
      width={460}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="collection-new" className="btn btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
      </>}
    >
      <form id="collection-new" onSubmit={handleSubmit}>
        <div className="form-row">
          <IconToggles options={KIND_TOGGLES} value={kind} onChange={k => { setKind(k); setError(''); }} label="Kind" />
        </div>
        {kind === 'project' && (
          <div className="form-row">
            <label className="form-label">Project *</label>
            <select className="select" value={projectId} onChange={e => onProjectChange(e.target.value)}>
              <option value="" />
              {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        )}
        <div className="form-row">
          <label className="form-label">Name *</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">Description</label>
          <input className="input" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        {error && <div className="error-msg">{error}</div>}
      </form>
    </Overlay>
  );
}

// ── Share the whole page ──────────────────────────────────────────────────────

function MindShareModal({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(null);
  const [linkCategories, setLinkCategories] = useState([]);
  const [selected, setSelected] = useState(KINDS);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [notice, setNotice] = useState(null);

  const shareUrl = token ? `${window.location.origin}/shared/mind/${token}` : '';

  useEffect(() => {
    api.get('/collections/mind-share')
      .then(data => {
        if (data.has_link) {
          setToken(data.token);
          setLinkCategories(data.categories || []);
          setSelected(data.categories && data.categories.length ? data.categories : KINDS);
        }
      })
      .catch(err => setNotice({ title: 'Share link not loaded', message: err.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  function toggle(cat) {
    setSelected(prev => (prev.includes(cat) ? prev.filter(c => c !== cat) : KINDS.filter(k => k === cat || prev.includes(k))));
  }

  async function generate() {
    setConfirming(null);
    setBusy(true);
    try {
      const data = await api.post('/collections/mind-share', { categories: selected });
      setToken(data.token);
      setLinkCategories(data.categories || selected);
    } catch (err) {
      setNotice({ title: 'Link not created', message: err.message || 'The link could not be created.' });
    }
    setBusy(false);
  }

  async function revoke() {
    setConfirming(null);
    setBusy(true);
    try {
      await api.del('/collections/mind-share');
      setToken(null);
      setLinkCategories([]);
    } catch (err) {
      setNotice({ title: 'Link not revoked', message: err.message || 'The link could not be revoked.' });
    }
    setBusy(false);
  }

  async function copy() {
    if (await copyText(shareUrl)) setCopied(true);
    else setNotice({ title: 'Not copied', message: 'The browser did not allow copying.' });
  }

  const changed = token && (selected.length !== linkCategories.length || selected.some(c => !linkCategories.includes(c)));

  const footer = loading ? null : token ? (
    <>
      <button type="button" className="db-iconbtn danger" onClick={() => setConfirming('revoke')} disabled={busy} title="Revoke link" aria-label="Revoke link">
        <Link2Off size={16} />
      </button>
      <span className="spacer" />
      <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      <button
        type="button"
        className={`btn ${changed ? 'btn-primary' : 'btn-ghost'}`}
        onClick={() => setConfirming('regenerate')}
        disabled={busy || selected.length === 0}
        title="New link"
        aria-label="New link"
      >
        <RefreshCw size={15} />
      </button>
    </>
  ) : (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" onClick={generate} disabled={busy || selected.length === 0} title="Create link" aria-label="Create link">
        <Link2 size={15} />
      </button>
    </>
  );

  return (
    <Overlay title="Share Collections" onClose={onClose} guard={false} width={480} footer={footer}>
      {loading ? (
        <div className="loading" style={{ padding: '16px' }}>Loading...</div>
      ) : (
        <>
          <div className="form-row">
            <div className="toggle-group mind-toggles" role="group" aria-label="Shared kinds">
              {KINDS.map(k => {
                const { Icon, title } = KIND_META[k];
                const on = selected.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    className={`toggle-btn toggle-icon ${on ? 'active' : ''}`}
                    onClick={() => toggle(k)}
                    title={title}
                    aria-label={title}
                    aria-pressed={on}
                  >
                    <Icon size={15} />
                  </button>
                );
              })}
            </div>
          </div>
          {token && (
            <div className="form-row">
              <div className="share-field">
                <input className="input" value={shareUrl} readOnly onFocus={e => e.target.select()} />
                <button type="button" className="db-iconbtn lg" onClick={copy} title="Copy" aria-label="Copy link">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {confirming === 'revoke' && (
        <ConfirmDialog
          title="Revoke this link?"
          message="The current link stops working at once and cannot be restored."
          confirmLabel="Revoke"
          tone="danger"
          onConfirm={revoke}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === 'regenerate' && (
        <ConfirmDialog
          title="Replace this link?"
          message="A new link is made with the selected kinds, and the current link stops working for good."
          confirmLabel="Replace"
          tone="danger"
          onConfirm={generate}
          onCancel={() => setConfirming(null)}
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

export default function Collections() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [activeTab, setActiveTab] = useState('active');
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingColl, setEditingColl] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const query = useDebounced(searchQuery.trim(), 280);
  const [searchResults, setSearchResults] = useState(null);
  const [showMindShare, setShowMindShare] = useState(false);
  const [sortMode, setSortMode] = useState('latest');
  const [sorted, setSorted] = useState({ project: [], studio: [], personal: [] });

  async function loadData() {
    try {
      const [colls, projs] = await Promise.all([api.get('/collections'), api.get('/projects')]);
      setCollections(colls);
      setProjects(projs);
      setLoadErr('');
    } catch (err) {
      setLoadErr(err.message || 'Failed to load');
    }
  }

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const active = collections.filter(c => !c.archived);
    const next = {};
    KINDS.forEach(k => { next[k] = applySortMode(active.filter(c => c.kind === k), sortMode); });
    setSorted(next);
  }, [collections, sortMode]);

  useEffect(() => {
    if (!query) { setSearchResults(null); return undefined; }
    let live = true;
    api.get(`/collections/search?q=${encodeURIComponent(query)}`)
      .then(res => { if (live) setSearchResults(res); })
      .catch(err => { if (live) setLoadErr(err.message || 'Search failed'); });
    return () => { live = false; };
  }, [query]);

  function showNotice(title, message) {
    setNotice({ title, message });
  }

  // The new order shows at once. When the server refuses it the previous
  // order comes back and a notice says so.
  async function handleReorder(kind, previous, next) {
    setSorted(s => ({ ...s, [kind]: next }));
    try {
      await api.put('/collections/reorder', { orderedIds: next.map(c => c.id) });
      const order = new Map(next.map((c, i) => [c.id, i]));
      setCollections(prev => prev.map(c => (order.has(c.id) && !c.starred ? { ...c, sort_order: order.get(c.id) } : c)));
    } catch (err) {
      setSorted(s => ({ ...s, [kind]: previous }));
      showNotice('Order not saved', err.message || 'The new order could not be saved.');
    }
  }

  async function handleCreated(coll) {
    setShowNewModal(false);
    await loadData();
    navigate(`/collections/${coll.id}`);
  }

  async function handleEdit(data) {
    await api.put(`/collections/${editingColl.id}`, data);
    await loadData();
  }

  async function runDelete() {
    const coll = confirmDelete;
    setDeleting(true);
    try {
      await api.del(`/collections/${coll.id}`);
      setConfirmDelete(null);
      await loadData();
    } catch (err) {
      setConfirmDelete(null);
      showNotice('Not deleted', err.message || 'The collection could not be deleted.');
    }
    setDeleting(false);
  }

  async function handleStar(coll) {
    try {
      await api.put(`/collections/${coll.id}/star`, { starred: !coll.starred });
      await loadData();
    } catch (err) {
      showNotice('Not updated', err.message || 'The collection could not be updated.');
    }
  }

  async function handleArchive(coll) {
    try {
      await api.patch(`/collections/${coll.id}/archive`, { archived: !coll.archived });
      await loadData();
    } catch (err) {
      showNotice('Not updated', err.message || 'The collection could not be updated.');
    }
  }

  if (loading) return <div className="loading">Loading...</div>;

  const tileProps = c => ({
    onOpen: () => navigate(`/collections/${c.id}`),
    onEdit: setEditingColl,
    onDelete: setConfirmDelete,
    onArchive: handleArchive,
    onStar: handleStar,
  });

  const activeCollections = collections.filter(c => !c.archived);
  const archivedCollections = collections.filter(c => c.archived);
  const isSearchMode = searchQuery.trim().length > 0;
  const q = searchQuery.trim().toLowerCase();
  const matchingCollections = isSearchMode
    ? activeCollections.filter(c => c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q))
    : [];
  const matchingCards = searchResults ? searchResults.cards : [];

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Collections</div>
        <div className="db-actions" style={{ gap: '8px' }}>
          <button type="button" className="db-iconbtn lg" onClick={() => setShowMindShare(true)} title="Share page" aria-label="Share page">
            <Share2 size={17} />
          </button>
          <button className="btn btn-primary" onClick={() => setShowNewModal(true)} title="New collection" aria-label="New collection">
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="mind-toolbar">
        <input className="input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search" />
        {!isSearchMode && <IconToggles options={TABS} value={activeTab} onChange={setActiveTab} label="Show" />}
        {!isSearchMode && activeTab === 'active' && (
          <IconToggles options={SORTS} value={sortMode} onChange={setSortMode} label="Sort" />
        )}
      </div>

      {loadErr && <div className="error-msg" style={{ marginBottom: '12px' }}>{loadErr}</div>}

      {isSearchMode ? (
        <>
          <section className="mind-section">
            <div className="mind-section-head" title="Collections">
              <Library size={16} />
              <span className="db-count"><span className="db-dot" />{matchingCollections.length}</span>
            </div>
            {matchingCollections.length === 0 ? (
              <div className="card db-empty"><Library size={24} /></div>
            ) : (
              <div className="collections-tile-grid">
                {matchingCollections.map(c => <CollectionTile key={c.id} collection={c} {...tileProps(c)} />)}
              </div>
            )}
          </section>
          <section className="mind-section">
            <div className="mind-section-head" title="Cards">
              <FileText size={16} />
              <span className="db-count"><span className="db-dot" />{matchingCards.length}</span>
            </div>
            {matchingCards.length === 0 ? (
              <div className="card db-empty"><FileText size={24} /></div>
            ) : (
              <div className="card db-list">
                {matchingCards.map(card => (
                  <div
                    key={card.id}
                    className="db-row"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/collections/${card.collection_id}`)}
                    onKeyDown={e => { if (e.key === 'Enter') navigate(`/collections/${card.collection_id}`); }}
                  >
                    <span className="source-icon">{card.type === 'note' ? <FileText size={14} /> : <Link2 size={14} />}</span>
                    <span className="db-row-title">{card.title || card.url || card.note_text}</span>
                    <span className="db-sub" style={{ marginTop: 0, display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '40%' }}>
                      <Library size={12} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.collection_name}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : activeTab === 'active' ? (
        activeCollections.length === 0 ? (
          <div className="card db-empty"><Library size={28} /></div>
        ) : (
          KINDS.map(kind => (
            <CollectionSection
              key={kind}
              kind={kind}
              list={sorted[kind] || []}
              sortable={sortMode === 'custom'}
              onReorder={handleReorder}
              tileProps={tileProps}
            />
          ))
        )
      ) : archivedCollections.length === 0 ? (
        <div className="card db-empty"><Archive size={28} /></div>
      ) : (
        KINDS.filter(kind => archivedCollections.some(c => c.kind === kind)).map(kind => (
          <CollectionSection
            key={kind}
            kind={kind}
            archived
            list={archivedCollections.filter(c => c.kind === kind)}
            tileProps={tileProps}
          />
        ))
      )}

      {showNewModal && (
        <NewCollectionModal projects={projects} onClose={() => setShowNewModal(false)} onCreated={handleCreated} />
      )}
      {editingColl && (
        <EditCollectionModal collection={editingColl} onSave={handleEdit} onClose={() => setEditingColl(null)} />
      )}
      {showMindShare && <MindShareModal onClose={() => setShowMindShare(false)} />}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.name}?`}
          message={confirmDelete.card_count > 0
            ? `${confirmDelete.card_count} card${confirmDelete.card_count === 1 ? '' : 's'} inside will be deleted too.`
            : undefined}
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
