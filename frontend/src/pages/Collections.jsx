import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Edit2, Trash2, FolderKanban, Library, Clapperboard, User, X,
  Archive, ArchiveRestore, Search, Link2, FileText, GripVertical,
  Instagram, Music2,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api';

// ── Kind metadata ─────────────────────────────────────────────────────────────

const KIND_META = {
  project:  { label: 'Project Collections', icon: FolderKanban, emptyMsg: 'No project collections yet. Link one to a project.' },
  studio:   { label: 'Studio',              icon: Clapperboard,  emptyMsg: 'No Studio collections yet. Add creative references for the agency.' },
  personal: { label: 'Personal',            icon: User,          emptyMsg: 'No Personal collections yet. Save ideas and personal inspiration here.' },
};

// ── Collection tile ───────────────────────────────────────────────────────────

function CollectionTile({ collection, onEdit, onDelete, onArchive, onClick }) {
  const isProject = collection.kind === 'project';
  const [imgFailed, setImgFailed] = useState(false);
  const hasCover = !!collection.cover_thumbnail && !imgFailed;
  const isInstagramCover = !hasCover && collection.cover_source === 'instagram';
  const isTikTokCover = !hasCover && collection.cover_source === 'tiktok';

  return (
    <div
      className="card"
      style={{
        cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        position: 'relative', opacity: collection.archived ? 0.75 : 1,
      }}
      onClick={onClick}
    >
      {/* Cover image / placeholder */}
      <div style={{ width: '100%', height: '118px', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
        {hasCover ? (
          <img
            src={collection.cover_thumbnail}
            alt=""
            onError={() => setImgFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            loading="lazy"
          />
        ) : isInstagramCover ? (
          <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Instagram size={30} color="rgba(255,255,255,0.92)" strokeWidth={1.5} />
          </div>
        ) : isTikTokCover ? (
          <div style={{
            width: '100%', height: '100%', background: '#010101',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Music2 size={30} color="rgba(255,255,255,0.85)" strokeWidth={1.5} />
          </div>
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Library size={28} color="var(--text-muted)" style={{ opacity: 0.28 }} />
          </div>
        )}
      </div>

      {/* Content area */}
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: '5px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
          <span style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {collection.name}
          </span>
          <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            {!isProject && !collection.archived && (
              <button className="btn-ghost" style={{ padding: '3px 5px' }} title="Edit" onClick={() => onEdit(collection)}>
                <Edit2 size={12} />
              </button>
            )}
            <button className="btn-ghost" style={{ padding: '3px 5px' }} title={collection.archived ? 'Unarchive' : 'Archive'} onClick={() => onArchive(collection)}>
              {collection.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
            </button>
            <button className="btn-ghost" style={{ padding: '3px 5px', color: 'var(--danger)' }} title="Delete" onClick={() => onDelete(collection)}>
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {collection.description && (
          <p style={{
            fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {collection.description}
          </p>
        )}

        {isProject && collection.project_title && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <FolderKanban size={11} color="var(--text-muted)" />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{collection.project_title}</span>
          </div>
        )}

        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
          {collection.card_count} {collection.card_count === 1 ? 'card' : 'cards'}
        </span>
      </div>
    </div>
  );
}

// ── Sortable tile wrapper ─────────────────────────────────────────────────────

function SortableCollectionTile(props) {
  const { collection } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: collection.id });
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
      {/* Drag handle */}
      <div
        {...listeners}
        onClick={e => e.stopPropagation()}
        title="Drag to reorder"
        style={{
          position: 'absolute', top: 7, left: 7, zIndex: 20,
          cursor: isDragging ? 'grabbing' : 'grab',
          background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: '3px 5px',
          color: '#aaa', touchAction: 'none', display: 'flex', alignItems: 'center',
        }}
      >
        <GripVertical size={11} />
      </div>
      <CollectionTile {...props} />
    </div>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({ collection, onSave, onClose }) {
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <span className="modal-title">Edit Collection</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="form-label">Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="form-row">
            <label className="form-label">Description</label>
            <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── New Collection modal (3 types) ───────────────────────────────────────────

function NewCollectionModal({ projects, onClose, onCreated }) {
  const [step, setStep] = useState('type');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [studioName, setStudioName] = useState('');
  const [studioDesc, setStudioDesc] = useState('');
  const [personalName, setPersonalName] = useState('');
  const [personalDesc, setPersonalDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function pickType(type) { setStep(type); setError(''); }

  function onProjectChange(pid) {
    setSelectedProjectId(pid);
    const proj = projects.find(p => String(p.id) === String(pid));
    setProjName(proj ? proj.title : '');
  }

  async function handleCreateProject(e) {
    e.preventDefault();
    if (!selectedProjectId) { setError('Select a project'); return; }
    if (!projName.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post('/collections', {
        name: projName.trim(), description: projDesc.trim() || undefined,
        project_id: Number(selectedProjectId), kind: 'project',
      });
      onCreated(res, !!res.alreadyExisted);
    } catch (err) { setError(err.message || 'Failed to create'); setSaving(false); }
  }

  async function handleCreateStudio(e) {
    e.preventDefault();
    if (!studioName.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post('/collections', { name: studioName.trim(), description: studioDesc.trim() || undefined, kind: 'studio' });
      onCreated(res);
    } catch (err) { setError(err.message || 'Failed to create'); setSaving(false); }
  }

  async function handleCreatePersonal(e) {
    e.preventDefault();
    if (!personalName.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post('/collections', { name: personalName.trim(), description: personalDesc.trim() || undefined, kind: 'personal' });
      onCreated(res);
    } catch (err) { setError(err.message || 'Failed to create'); setSaving(false); }
  }

  const typeCardBase = {
    width: '100%', textAlign: 'left', cursor: 'pointer',
    background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
    borderRadius: 14, padding: '16px 18px',
    color: 'var(--text-primary)', fontFamily: 'var(--font)',
    transition: 'border-color 0.15s, background 0.15s',
  };

  const typeOptions = [
    {
      key: 'project',
      icon: <FolderKanban size={18} color="var(--accent)" />,
      title: 'Project Collection',
      sub: 'Linked to a specific project. One per project.',
    },
    {
      key: 'studio',
      icon: <Clapperboard size={18} color="var(--accent)" />,
      title: 'Studio',
      sub: 'Creative agency references — Music Videos, Commercials, Directors…',
    },
    {
      key: 'personal',
      icon: <User size={18} color="var(--accent)" />,
      title: 'Personal',
      sub: 'Personal inspiration — ideas, moodboards, anything for you.',
    },
  ];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <span className="modal-title">New Collection</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {step === 'type' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 6px' }}>
              What kind of collection?
            </p>
            {typeOptions.map(opt => (
              <button
                key={opt.key}
                style={typeCardBase}
                onClick={() => pickType(opt.key)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'rgba(199,255,46,0.04)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'var(--bg-secondary)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '13px' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(199,255,46,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {opt.icon}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: 3 }}>{opt.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{opt.sub}</div>
                  </div>
                </div>
              </button>
            ))}
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}

        {step === 'project' && (
          <form onSubmit={handleCreateProject}>
            <div className="form-row">
              <label className="form-label">Project *</label>
              <select className="select" value={selectedProjectId} onChange={e => onProjectChange(e.target.value)} autoFocus>
                <option value="">— select a project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">Collection Name *</label>
              <input className="input" value={projName} onChange={e => setProjName(e.target.value)} placeholder="Defaults to project title" />
            </div>
            <div className="form-row">
              <label className="form-label">Description</label>
              <input className="input" value={projDesc} onChange={e => setProjDesc(e.target.value)} placeholder="Optional description" />
            </div>
            {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 10px' }}>{error}</p>}
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => { setStep('type'); setError(''); }}>Back</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        )}

        {step === 'studio' && (
          <form onSubmit={handleCreateStudio}>
            <div className="form-row">
              <label className="form-label">Name *</label>
              <input className="input" value={studioName} onChange={e => setStudioName(e.target.value)} placeholder="e.g. Music Video References" autoFocus />
            </div>
            <div className="form-row">
              <label className="form-label">Description</label>
              <input className="input" value={studioDesc} onChange={e => setStudioDesc(e.target.value)} placeholder="Optional description" />
            </div>
            {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 10px' }}>{error}</p>}
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => { setStep('type'); setError(''); }}>Back</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        )}

        {step === 'personal' && (
          <form onSubmit={handleCreatePersonal}>
            <div className="form-row">
              <label className="form-label">Name *</label>
              <input className="input" value={personalName} onChange={e => setPersonalName(e.target.value)} placeholder="e.g. Business Ideas" autoFocus />
            </div>
            <div className="form-row">
              <label className="form-label">Description</label>
              <input className="input" value={personalDesc} onChange={e => setPersonalDesc(e.target.value)} placeholder="Optional description" />
            </div>
            {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 10px' }}>{error}</p>}
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => { setStep('type'); setError(''); }}>Back</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Sortable section (one per kind) ──────────────────────────────────────────

const SECTION_LABEL = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '14px',
};
const TILE_GRID = 'collections-tile-grid';

function SortableSection({ kind, list, onListChange, onEdit, onDelete, onArchive, navigate }) {
  const meta = KIND_META[kind];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIndex = list.findIndex(c => c.id === active.id);
    const newIndex = list.findIndex(c => c.id === over.id);
    const newList = arrayMove(list, oldIndex, newIndex);
    onListChange(kind, newList);
    api.put('/collections/reorder', { orderedIds: newList.map(c => c.id) }).catch(() => {});
  }

  return (
    <section style={{ marginBottom: '32px' }}>
      <h2 style={SECTION_LABEL}>{meta.label}</h2>
      {list.length === 0 ? (
        <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          {meta.emptyMsg}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={list.map(c => c.id)} strategy={rectSortingStrategy}>
            <div className={TILE_GRID}>
              {list.map(c => (
                <SortableCollectionTile
                  key={c.id}
                  collection={c}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onArchive={onArchive}
                  onClick={() => navigate(`/collections/${c.id}`)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

// ── Simple (non-sortable) tile grid for archived view ─────────────────────────

function StaticTileGrid({ list, onEdit, onDelete, onArchive, navigate }) {
  return (
    <div className={TILE_GRID}>
      {list.map(c => (
        <CollectionTile
          key={c.id}
          collection={c}
          onEdit={onEdit}
          onDelete={onDelete}
          onArchive={onArchive}
          onClick={() => navigate(`/collections/${c.id}`)}
        />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Collections() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingColl, setEditingColl] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  // Per-section sorted lists (active only; derived from collections)
  const [sortedProject, setSortedProject] = useState([]);
  const [sortedStudio, setSortedStudio] = useState([]);
  const [sortedPersonal, setSortedPersonal] = useState([]);

  async function loadData() {
    try {
      const [colls, projs] = await Promise.all([api.get('/collections'), api.get('/projects')]);
      setCollections(colls);
      setProjects(projs);
    } catch (_) {}
  }

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  // Sync sorted lists when collections change
  useEffect(() => {
    const active = collections.filter(c => !c.archived);
    const byKind = kind => active.filter(c => c.kind === kind).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    setSortedProject(byKind('project'));
    setSortedStudio(byKind('studio'));
    setSortedPersonal(byKind('personal'));
  }, [collections]);

  function handleSectionListChange(kind, newList) {
    if (kind === 'project') setSortedProject(newList);
    else if (kind === 'studio') setSortedStudio(newList);
    else setSortedPersonal(newList);
  }

  // Debounced search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/collections/search?q=${encodeURIComponent(q)}`);
        setSearchResults(res);
      } catch (_) {}
      setSearching(false);
    }, 280);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const isSearchMode = searchQuery.trim().length > 0;
  const activeCollections = collections.filter(c => !c.archived);
  const archivedCollections = collections.filter(c => c.archived);

  const searchFilteredCollections = isSearchMode
    ? collections.filter(c => {
        if (c.archived) return false;
        const q = searchQuery.toLowerCase();
        return c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q);
      })
    : [];

  const archivedByKind = kind => archivedCollections.filter(c => c.kind === kind);

  async function handleCreated(coll) {
    setShowNewModal(false);
    await loadData();
    navigate(`/collections/${coll.id}`);
  }

  async function handleEdit(data) {
    await api.put(`/collections/${editingColl.id}`, data);
    await loadData();
    setEditingColl(null);
  }

  async function handleDelete(coll) {
    if (!confirm(`Delete collection "${coll.name}"? This will also delete all cards inside. This cannot be undone.`)) return;
    try {
      await api.del(`/collections/${coll.id}`);
      await loadData();
    } catch (err) { alert(err.message || 'Failed to delete'); }
  }

  async function handleArchive(coll) {
    try {
      await api.patch(`/collections/${coll.id}/archive`, { archived: !coll.archived });
      await loadData();
    } catch (err) { alert(err.message || 'Failed to update'); }
  }

  if (loading) return (
    <div className="page-header">
      <h1 className="page-title">Collections</h1>
    </div>
  );

  const totalActive = activeCollections.length;
  const totalArchived = archivedCollections.length;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Collections</h1>
        <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
          <Plus size={16} /> New Collection
        </button>
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: '24px' }}>
        <Search size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input
          className="input"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search collections and cards…"
          style={{ paddingLeft: 40, paddingRight: searchQuery ? 36 : 14 }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Search results ── */}
      {isSearchMode ? (
        <div>
          <section style={{ marginBottom: '32px' }}>
            <h2 style={SECTION_LABEL}>
              Matching Collections{searchFilteredCollections.length > 0 ? ` (${searchFilteredCollections.length})` : ''}
            </h2>
            {searchFilteredCollections.length === 0 ? (
              <div className="card" style={{ padding: '14px 18px', color: 'var(--text-muted)', fontSize: '13px' }}>
                No collections match "{searchQuery}"
              </div>
            ) : (
              <div className={TILE_GRID}>
                {searchFilteredCollections.map(c => (
                  <CollectionTile key={c.id} collection={c} onEdit={setEditingColl} onDelete={handleDelete} onArchive={handleArchive} onClick={() => navigate(`/collections/${c.id}`)} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 style={SECTION_LABEL}>
              Matching Cards{searchResults && searchResults.cards.length > 0 ? ` (${searchResults.cards.length})` : ''}
            </h2>
            {searching ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Searching…</p>
            ) : searchResults && searchResults.cards.length === 0 ? (
              <div className="card" style={{ padding: '14px 18px', color: 'var(--text-muted)', fontSize: '13px' }}>
                No cards match "{searchQuery}"
              </div>
            ) : searchResults ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {searchResults.cards.map(card => (
                  <div
                    key={card.id}
                    className="card"
                    style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}
                    onClick={() => navigate(`/collections/${card.collection_id}`)}
                  >
                    <div style={{ flexShrink: 0, color: card.type === 'note' ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {card.type === 'note' ? <FileText size={14} /> : <Link2 size={14} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {card.title || card.url || 'Untitled'}
                      </div>
                      {card.note_text && (
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                          {card.note_text.slice(0, 120)}
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      in {card.collection_name}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '28px', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
            {['active', 'archived'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '8px 16px', fontSize: '13px', fontWeight: 600,
                  color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: '-1px', textTransform: 'capitalize', transition: 'color 0.15s',
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'active' && totalActive > 0 && (
                  <span style={{ marginLeft: '6px', fontSize: '11px', background: 'var(--accent)', color: '#000', borderRadius: '10px', padding: '1px 6px', fontWeight: 700 }}>
                    {totalActive}
                  </span>
                )}
                {tab === 'archived' && totalArchived > 0 && (
                  <span style={{ marginLeft: '6px', fontSize: '11px', background: '#333', color: '#888', borderRadius: '10px', padding: '1px 6px', fontWeight: 700 }}>
                    {totalArchived}
                  </span>
                )}
              </button>
            ))}
          </div>

          {activeTab === 'active' && (
            <>
              {totalActive === 0 ? (
                <div className="card" style={{ padding: '48px 20px', textAlign: 'center' }}>
                  <Library size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px', display: 'block' }} />
                  <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                    No collections yet. Create one to start saving references and inspiration.
                  </p>
                  <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
                    <Plus size={15} /> Create your first collection
                  </button>
                </div>
              ) : (
                <>
                  <SortableSection kind="project" list={sortedProject} onListChange={handleSectionListChange} onEdit={setEditingColl} onDelete={handleDelete} onArchive={handleArchive} navigate={navigate} />
                  <SortableSection kind="studio"  list={sortedStudio}  onListChange={handleSectionListChange} onEdit={setEditingColl} onDelete={handleDelete} onArchive={handleArchive} navigate={navigate} />
                  <SortableSection kind="personal" list={sortedPersonal} onListChange={handleSectionListChange} onEdit={setEditingColl} onDelete={handleDelete} onArchive={handleArchive} navigate={navigate} />
                </>
              )}
            </>
          )}

          {activeTab === 'archived' && (
            <>
              {totalArchived === 0 ? (
                <div className="card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  No archived collections.
                </div>
              ) : (
                <>
                  {archivedByKind('project').length > 0 && (
                    <section style={{ marginBottom: '32px' }}>
                      <h2 style={SECTION_LABEL}>Project Collections — Archived</h2>
                      <StaticTileGrid list={archivedByKind('project')} onEdit={setEditingColl} onDelete={handleDelete} onArchive={handleArchive} navigate={navigate} />
                    </section>
                  )}
                  {archivedByKind('studio').length > 0 && (
                    <section style={{ marginBottom: '32px' }}>
                      <h2 style={SECTION_LABEL}>Studio — Archived</h2>
                      <StaticTileGrid list={archivedByKind('studio')} onEdit={setEditingColl} onDelete={handleDelete} onArchive={handleArchive} navigate={navigate} />
                    </section>
                  )}
                  {archivedByKind('personal').length > 0 && (
                    <section style={{ marginBottom: '32px' }}>
                      <h2 style={SECTION_LABEL}>Personal — Archived</h2>
                      <StaticTileGrid list={archivedByKind('personal')} onEdit={setEditingColl} onDelete={handleDelete} onArchive={handleArchive} navigate={navigate} />
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {showNewModal && (
        <NewCollectionModal projects={projects} onClose={() => setShowNewModal(false)} onCreated={handleCreated} />
      )}
      {editingColl && (
        <EditModal collection={editingColl} onSave={handleEdit} onClose={() => setEditingColl(null)} />
      )}
    </div>
  );
}
