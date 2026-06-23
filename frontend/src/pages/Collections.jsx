import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, FolderKanban, Library, X, Archive, ArchiveRestore } from 'lucide-react';
import { api } from '../api';

function CollectionTile({ collection, onEdit, onDelete, onArchive, onClick }) {
  const isProject = collection.project_id !== null;
  return (
    <div
      className="card"
      style={{ cursor: 'pointer', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative', opacity: collection.archived ? 0.75 : 1 }}
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
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {!isProject && !collection.archived && (
            <button
              className="btn-ghost"
              style={{ padding: '4px 8px', fontSize: '12px' }}
              title="Edit"
              onClick={() => onEdit(collection)}
            >
              <Edit2 size={13} />
            </button>
          )}
          <button
            className="btn-ghost"
            style={{ padding: '4px 8px', fontSize: '12px' }}
            title={collection.archived ? 'Unarchive' : 'Archive'}
            onClick={() => onArchive(collection)}
          >
            {collection.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
          </button>
          <button
            className="btn-ghost"
            style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--danger)' }}
            title="Delete"
            onClick={() => onDelete(collection)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {collection.description && (
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
          {collection.description}
        </p>
      )}
      {isProject && collection.project_title && (
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h3 className="modal-title">Edit Collection</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="form-group">
            <label className="form-label">Name *</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <input className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewCollectionModal({ projects, onClose, onCreated }) {
  const [step, setStep] = useState('type'); // 'type' | 'project' | 'other'
  const [collType, setCollType] = useState(null);

  // Project collection fields
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');

  // Other collection fields
  const [otherName, setOtherName] = useState('');
  const [otherDesc, setOtherDesc] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function pickType(type) {
    setCollType(type);
    setStep(type);
    setError('');
  }

  function onProjectChange(pid) {
    setSelectedProjectId(pid);
    const proj = projects.find(p => String(p.id) === String(pid));
    if (proj) setProjName(proj.title);
    else setProjName('');
  }

  async function handleCreateProject(e) {
    e.preventDefault();
    if (!selectedProjectId) { setError('Select a project'); return; }
    if (!projName.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await api.post('/collections', {
        name: projName.trim(),
        description: projDesc.trim() || undefined,
        project_id: Number(selectedProjectId),
      });
      onCreated(res, !!res.alreadyExisted);
    } catch (err) {
      setError(err.message || 'Failed to create');
      setSaving(false);
    }
  }

  async function handleCreateOther(e) {
    e.preventDefault();
    if (!otherName.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await api.post('/collections', {
        name: otherName.trim(),
        description: otherDesc.trim() || undefined,
      });
      onCreated(res);
    } catch (err) {
      setError(err.message || 'Failed to create');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3 className="modal-title">New Collection</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {step === 'type' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '4px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>What kind of collection do you want to create?</p>
            <button
              className="card"
              style={{ cursor: 'pointer', padding: '16px 18px', textAlign: 'left', border: '1px solid var(--border)', background: 'var(--card-bg)' }}
              onClick={() => pickType('project')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(199,255,46,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FolderKanban size={16} color="var(--accent)" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px' }}>Project Collection</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Linked to a specific project. One per project.</div>
                </div>
              </div>
            </button>
            <button
              className="card"
              style={{ cursor: 'pointer', padding: '16px 18px', textAlign: 'left', border: '1px solid var(--border)', background: 'var(--card-bg)' }}
              onClick={() => pickType('other')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(199,255,46,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Library size={16} color="var(--accent)" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px' }}>Other Collection</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>General-purpose inspiration board or reference.</div>
                </div>
              </div>
            </button>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}

        {step === 'project' && (
          <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label">Project *</label>
              <select
                className="form-input"
                value={selectedProjectId}
                onChange={e => onProjectChange(e.target.value)}
                autoFocus
              >
                <option value="">— select a project —</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Collection Name *</label>
              <input
                className="form-input"
                value={projName}
                onChange={e => setProjName(e.target.value)}
                placeholder="Defaults to project title"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input
                className="form-input"
                value={projDesc}
                onChange={e => setProjDesc(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: 0 }}>{error}</p>}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={() => { setStep('type'); setError(''); }}>Back</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        )}

        {step === 'other' && (
          <form onSubmit={handleCreateOther} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input
                className="form-input"
                value={otherName}
                onChange={e => setOtherName(e.target.value)}
                placeholder="e.g. UI/UX Inspiration"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input
                className="form-input"
                value={otherDesc}
                onChange={e => setOtherDesc(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: 0 }}>{error}</p>}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={() => { setStep('type'); setError(''); }}>Back</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const SECTION_LABEL = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '14px',
};
const TILE_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: '14px',
};

export default function Collections() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingColl, setEditingColl] = useState(null);

  async function loadData() {
    try {
      const [colls, projs] = await Promise.all([
        api.get('/collections'),
        api.get('/projects'),
      ]);
      setCollections(colls);
      setProjects(projs);
    } catch (_) {}
  }

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const activeCollections = collections.filter(c => !c.archived);
  const archivedCollections = collections.filter(c => c.archived);

  const activeProject = activeCollections.filter(c => c.project_id !== null);
  const activeOther = activeCollections.filter(c => c.project_id === null);
  const archivedProject = archivedCollections.filter(c => c.project_id !== null);
  const archivedOther = archivedCollections.filter(c => c.project_id === null);

  async function handleCreated(coll, alreadyExists = false) {
    setShowNewModal(false);
    if (alreadyExists) {
      await loadData();
      navigate(`/collections/${coll.id}`);
    } else {
      await loadData();
      navigate(`/collections/${coll.id}`);
    }
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
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  }

  async function handleArchive(coll) {
    const newArchived = !coll.archived;
    try {
      await api.patch(`/collections/${coll.id}/archive`, { archived: newArchived });
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to update');
    }
  }

  function CollectionSection({ label, list, emptyMsg }) {
    return (
      <section style={{ marginBottom: '32px' }}>
        <h2 style={SECTION_LABEL}>{label}</h2>
        {list.length === 0 ? (
          <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            {emptyMsg}
          </div>
        ) : (
          <div style={TILE_GRID}>
            {list.map(c => (
              <CollectionTile
                key={c.id}
                collection={c}
                onEdit={coll => setEditingColl(coll)}
                onDelete={handleDelete}
                onArchive={handleArchive}
                onClick={() => navigate(`/collections/${c.id}`)}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  if (loading) return (
    <div className="page-header">
      <h1 className="page-title">Collections</h1>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Collections</h1>
        <button className="btn-primary" onClick={() => setShowNewModal(true)}>
          <Plus size={16} style={{ marginRight: 6 }} /> New Collection
        </button>
      </div>

      {/* Active | Archived toggle */}
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
            {tab === 'active' && activeCollections.length > 0 && (
              <span style={{ marginLeft: '6px', fontSize: '11px', background: 'var(--accent)', color: '#000', borderRadius: '10px', padding: '1px 6px', fontWeight: 700 }}>
                {activeCollections.length}
              </span>
            )}
            {tab === 'archived' && archivedCollections.length > 0 && (
              <span style={{ marginLeft: '6px', fontSize: '11px', background: '#333', color: '#888', borderRadius: '10px', padding: '1px 6px', fontWeight: 700 }}>
                {archivedCollections.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'active' && (
        <>
          {activeProject.length === 0 && activeOther.length === 0 ? (
            <div className="card" style={{ padding: '48px 20px', textAlign: 'center' }}>
              <Library size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                No collections yet. Create one to start saving references and inspiration.
              </p>
              <button className="btn-primary" onClick={() => setShowNewModal(true)}>
                <Plus size={15} style={{ marginRight: 6 }} /> Create your first collection
              </button>
            </div>
          ) : (
            <>
              <CollectionSection
                label="Project Collections"
                list={activeProject}
                emptyMsg="No project collections yet. Create one from a project or here."
              />
              <CollectionSection
                label="Other Collections"
                list={activeOther}
                emptyMsg="No other collections yet."
              />
            </>
          )}
        </>
      )}

      {activeTab === 'archived' && (
        <>
          {archivedProject.length === 0 && archivedOther.length === 0 ? (
            <div className="card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              No archived collections.
            </div>
          ) : (
            <>
              {archivedProject.length > 0 && (
                <CollectionSection
                  label="Project Collections (Archived)"
                  list={archivedProject}
                  emptyMsg=""
                />
              )}
              {archivedOther.length > 0 && (
                <CollectionSection
                  label="Other Collections (Archived)"
                  list={archivedOther}
                  emptyMsg=""
                />
              )}
            </>
          )}
        </>
      )}

      {showNewModal && (
        <NewCollectionModal
          projects={projects}
          onClose={() => setShowNewModal(false)}
          onCreated={handleCreated}
        />
      )}

      {editingColl && (
        <EditModal
          collection={editingColl}
          onSave={handleEdit}
          onClose={() => setEditingColl(null)}
        />
      )}
    </div>
  );
}
