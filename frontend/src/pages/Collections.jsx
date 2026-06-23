import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, FolderKanban, Library, X } from 'lucide-react';
import { api } from '../api';

function CollectionTile({ collection, onEdit, onDelete, onClick }) {
  return (
    <div
      className="card"
      style={{ cursor: 'pointer', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(199,255,46,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Library size={16} color="var(--accent)" />
          </div>
          <span style={{ fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {collection.name}
          </span>
        </div>
        {!collection.project_id && (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              className="btn-ghost"
              style={{ padding: '4px 8px', fontSize: '12px' }}
              onClick={() => onEdit(collection)}
            >
              <Edit2 size={13} />
            </button>
            <button
              className="btn-ghost"
              style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--danger)' }}
              onClick={() => onDelete(collection)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      {collection.description && (
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
          {collection.description}
        </p>
      )}
      {collection.project_id && collection.project_title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <FolderKanban size={12} color="var(--text-muted)" />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{collection.project_title}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {collection.card_count} {collection.card_count === 1 ? 'card' : 'cards'}
        </span>
      </div>
    </div>
  );
}

function CollectionModal({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h3 className="modal-title">{initial ? 'Edit Collection' : 'New Collection'}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="form-group">
            <label className="form-label">Name *</label>
            <input
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. UI/UX Inspiration"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <input
              className="form-input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Collections() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingColl, setEditingColl] = useState(null);

  async function loadCollections() {
    try {
      const data = await api.get('/collections');
      setCollections(data);
    } catch (_) {}
  }

  useEffect(() => {
    loadCollections().finally(() => setLoading(false));
  }, []);

  const projectCollections = collections.filter(c => c.project_id !== null);
  const otherCollections = collections.filter(c => c.project_id === null);

  async function handleCreate(data) {
    await api.post('/collections', data);
    await loadCollections();
  }

  async function handleEdit(data) {
    await api.put(`/collections/${editingColl.id}`, data);
    await loadCollections();
    setEditingColl(null);
  }

  async function handleDelete(coll) {
    if (!confirm(`Delete collection "${coll.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/collections/${coll.id}`);
      await loadCollections();
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  }

  const TILE_GRID = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '14px',
  };

  if (loading) return (
    <div className="page-header">
      <h1 className="page-title">Collections</h1>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Collections</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} style={{ marginRight: 6 }} /> New Collection
        </button>
      </div>

      {/* Project Collections */}
      <section style={{ marginBottom: '36px' }}>
        <h2 style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '14px' }}>
          Project Collections
        </h2>
        {projectCollections.length === 0 ? (
          <div className="card" style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Project collections appear here automatically when you create a project.
          </div>
        ) : (
          <div style={TILE_GRID}>
            {projectCollections.map(c => (
              <CollectionTile
                key={c.id}
                collection={c}
                onEdit={() => {}}
                onDelete={() => {}}
                onClick={() => navigate(`/collections/${c.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Other Collections */}
      <section>
        <h2 style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '14px' }}>
          Other Collections
        </h2>
        {otherCollections.length === 0 ? (
          <div className="card" style={{ padding: '36px 20px', textAlign: 'center' }}>
            <Library size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
              No collections yet. Create one to start saving inspiration.
            </p>
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={15} style={{ marginRight: 6 }} /> Create your first collection
            </button>
          </div>
        ) : (
          <div style={TILE_GRID}>
            {otherCollections.map(c => (
              <CollectionTile
                key={c.id}
                collection={c}
                onEdit={coll => setEditingColl(coll)}
                onDelete={handleDelete}
                onClick={() => navigate(`/collections/${c.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      {(showModal || editingColl) && (
        <CollectionModal
          initial={editingColl}
          onSave={editingColl ? handleEdit : handleCreate}
          onClose={() => { setShowModal(false); setEditingColl(null); }}
        />
      )}
    </div>
  );
}
