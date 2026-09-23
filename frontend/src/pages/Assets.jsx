import React, { useEffect, useState } from 'react';
import {
  Plus, Edit2, Archive, RotateCcw, Trash2, MapPin, Package, ChevronDown, ChevronRight, Phone,
  Warehouse, User, Clapperboard, Film, Store, MessageCircle,
} from 'lucide-react';
import { api, fmt } from '../api';
import { Private } from '../context/PrivacyContext';
import Overlay from '../components/Overlay';
import ConfirmDialog from '../components/ConfirmDialog';
import { assetCategoryVisual } from '../lib/categoryIcons';
import { waUrl, telUrl, IconLink } from '../components/DbBits';

const TYPE_SUGGESTIONS = ['Rental House', 'Freelancer', 'Studio', 'Post House', 'Other'];

// Provider types read as a glyph; an unknown type falls back to a store.
const TYPE_ICON = {
  'rental house': Warehouse,
  'freelancer': User,
  'studio': Clapperboard,
  'post house': Film,
};
function providerTypeIcon(type) {
  return TYPE_ICON[String(type || 'Rental House').toLowerCase()] || Store;
}

function AssetIcon({ category }) {
  const { Icon, known } = assetCategoryVisual(category);
  return (
    <span className="db-avatar sm" title={category || undefined} style={known ? { color: 'var(--color-ink-soft)' } : undefined}>
      <Icon size={15} />
    </span>
  );
}

export default function Assets() {
  const [providers, setProviders] = useState([]);
  const [archivedProviders, setArchivedProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [providerItems, setProviderItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editingRate, setEditingRate] = useState(null);
  const [removeItem, setRemoveItem] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [notice, setNotice] = useState(null);

  async function loadProviders() {
    const all = await api.get('/assets/providers?all=1');
    setProviders(all.filter(p => !p.archived));
    setArchivedProviders(all.filter(p => p.archived));
  }

  async function loadAllItems() {
    setAllItems(await api.get('/assets/items'));
  }

  useEffect(() => {
    Promise.all([loadProviders(), loadAllItems()])
      .catch(e => setNotice({ title: 'Could not load assets', message: e.message }))
      .finally(() => setLoading(false));
  }, []);

  async function loadProviderItems(providerId) {
    try {
      setProviderItems(await api.get(`/assets/provider-items/${providerId}`));
    } catch (_) { setProviderItems([]); }
  }

  function selectProvider(provider) {
    setSelectedProvider(provider);
    setCategoryFilter('');
    setEditingRate(null);
    loadProviderItems(provider.id);
  }

  async function archiveProvider(provider) {
    try {
      await api.del(`/assets/providers/${provider.id}`);
      if (selectedProvider?.id === provider.id) {
        setSelectedProvider(null);
        setProviderItems([]);
      }
      loadProviders();
    } catch (e) { setNotice({ title: 'Could not archive', message: e.message }); }
  }

  async function restoreProvider(provider) {
    try {
      await api.put(`/assets/providers/${provider.id}/restore`, {});
      loadProviders();
    } catch (e) { setNotice({ title: 'Could not restore', message: e.message }); }
  }

  async function handleSaveProvider(data) {
    if (editingProvider) {
      await api.put(`/assets/providers/${editingProvider.id}`, data);
      if (selectedProvider?.id === editingProvider.id) {
        setSelectedProvider(prev => ({ ...prev, ...data }));
      }
    } else {
      await api.post('/assets/providers', data);
    }
    await loadProviders();
    setShowProviderModal(false);
    setEditingProvider(null);
  }

  async function saveRate(providerItemId, newRate) {
    const item = providerItems.find(i => i.id === providerItemId);
    const rate = newRate === '' ? 0 : Number(newRate);
    setEditingRate(null);
    try {
      await api.put(`/assets/provider-items/${providerItemId}`, { daily_rate: rate, notes: item?.notes || null });
      setProviderItems(prev => prev.map(i => (i.id === providerItemId ? { ...i, daily_rate: rate } : i)));
    } catch (e) { setNotice({ title: 'Rate not saved', message: e.message }); }
  }

  async function confirmRemoveItem() {
    setRemoving(true);
    try {
      await api.del(`/assets/provider-items/${removeItem.id}`);
      setProviderItems(prev => prev.filter(i => i.id !== removeItem.id));
      setRemoveItem(null);
      loadProviders();
    } catch (e) {
      setRemoveItem(null);
      setNotice({ title: 'Could not remove', message: e.message });
    }
    setRemoving(false);
  }

  async function handleAddItem(itemId, dailyRate, notes) {
    await api.post('/assets/provider-items', {
      provider_id: selectedProvider.id,
      item_id: itemId,
      daily_rate: dailyRate === '' ? 0 : Number(dailyRate),
      notes: notes || null,
    });
    await loadProviderItems(selectedProvider.id);
    loadProviders();
    setShowAddItemModal(false);
  }

  async function handleCreateAndAddItem(name, category, dailyRate, notes) {
    const newItem = await api.post('/assets/items', { name, category: category || 'Other' });
    await loadAllItems();
    await handleAddItem(newItem.id, dailyRate, notes);
  }

  const categories = [...new Set(providerItems.map(i => i.category).filter(Boolean))];
  const filteredItems = categoryFilter ? providerItems.filter(i => i.category === categoryFilter) : providerItems;

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Assets</div>
        <button
          className="btn btn-primary"
          onClick={() => { setEditingProvider(null); setShowProviderModal(true); }}
          title="Add provider"
          aria-label="Add provider"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="assets-layout" style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        <div className="assets-providers-panel" style={{ width: '38%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {providers.length === 0 && archivedProviders.length === 0 && (
            <div className="card db-empty"><Package size={28} /></div>
          )}

          {providers.map(provider => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              isSelected={selectedProvider?.id === provider.id}
              onSelect={() => selectProvider(provider)}
              onEdit={() => { setEditingProvider(provider); setShowProviderModal(true); }}
              onArchive={() => archiveProvider(provider)}
            />
          ))}

          {archivedProviders.length > 0 && (
            <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button className="db-archived-toggle" onClick={() => setShowArchived(p => !p)} aria-expanded={showArchived}>
                {showArchived ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Archive size={13} />
                <span className="db-count"><span className="db-dot" />{archivedProviders.length}</span>
              </button>
              {showArchived && archivedProviders.map(provider => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  isSelected={false}
                  onRestore={() => restoreProvider(provider)}
                  archived
                />
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ flex: 1, minHeight: '420px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!selectedProvider ? (
            <div className="db-empty" style={{ flex: 1, alignItems: 'center' }}><Package size={36} /></div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--color-hairline)', gap: '12px', flexWrap: 'wrap' }}>
                <div className="db-main">
                  <div className="db-name"><span>{selectedProvider.name}</span></div>
                </div>
                {categories.length > 1 && (
                  <div className="toggle-group" role="group" aria-label="Category">
                    <button
                      type="button"
                      className={`toggle-btn toggle-icon ${categoryFilter === '' ? 'active' : ''}`}
                      onClick={() => setCategoryFilter('')}
                      title="All"
                      aria-label="All"
                    >
                      <Package size={14} />
                    </button>
                    {categories.map(c => {
                      const { Icon } = assetCategoryVisual(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          className={`toggle-btn toggle-icon ${categoryFilter === c ? 'active' : ''}`}
                          onClick={() => setCategoryFilter(c)}
                          title={c}
                          aria-label={c}
                        >
                          <Icon size={14} />
                        </button>
                      );
                    })}
                  </div>
                )}
                <button className="db-iconbtn lg" onClick={() => setShowAddItemModal(true)} title="Add item" aria-label="Add item">
                  <Plus size={16} />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                {filteredItems.length === 0 ? (
                  <div className="db-empty"><Package size={26} /></div>
                ) : (
                  filteredItems.map(item => (
                    <div key={item.id} className="asset-item-row">
                      <AssetIcon category={item.category} />
                      <div className="db-main">
                        <div className="db-row-title">{item.item_name}</div>
                        {item.notes && <div className="asset-item-note">{item.notes}</div>}
                      </div>
                      {editingRate?.id === item.id ? (
                        <input
                          type="number"
                          min="0"
                          className="input asset-rate-input"
                          value={editingRate.value}
                          autoFocus
                          onChange={e => setEditingRate(p => ({ ...p, value: e.target.value }))}
                          onBlur={() => saveRate(item.id, editingRate.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveRate(item.id, editingRate.value);
                            if (e.key === 'Escape') setEditingRate(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="db-chip"
                          title="Day rate"
                          onClick={() => setEditingRate({ id: item.id, value: String(item.daily_rate || 0) })}
                        >
                          <Private>{fmt(item.daily_rate)}</Private>
                        </button>
                      )}
                      <button
                        className="db-iconbtn danger"
                        title="Remove"
                        aria-label={`Remove ${item.item_name}`}
                        onClick={() => setRemoveItem(item)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showProviderModal && (
        <ProviderModal
          provider={editingProvider}
          onSave={handleSaveProvider}
          onClose={() => { setShowProviderModal(false); setEditingProvider(null); }}
        />
      )}

      {showAddItemModal && selectedProvider && (
        <AddItemModal
          allItems={allItems}
          existingItemIds={new Set(providerItems.map(i => i.item_id))}
          onAdd={handleAddItem}
          onCreate={handleCreateAndAddItem}
          onClose={() => setShowAddItemModal(false)}
        />
      )}

      {removeItem && (
        <ConfirmDialog
          title={`Remove ${removeItem.item_name}?`}
          message={selectedProvider ? `It will no longer be listed by ${selectedProvider.name}.` : undefined}
          confirmLabel="Remove"
          tone="danger"
          busy={removing}
          onConfirm={confirmRemoveItem}
          onCancel={() => setRemoveItem(null)}
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

function ProviderCard({ provider, isSelected, onSelect, onEdit, onArchive, onRestore, archived }) {
  const TypeIcon = providerTypeIcon(provider.type);
  const count = Number(provider.item_count) || 0;
  return (
    <div
      className={`db-card provider-card ${isSelected ? 'is-selected' : ''} ${archived ? 'is-muted' : ''}`}
      role={archived ? undefined : 'button'}
      tabIndex={archived ? undefined : 0}
      onClick={archived ? undefined : onSelect}
      onKeyDown={archived ? undefined : e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      style={archived ? { cursor: 'default' } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span className="db-avatar" title={provider.type || 'Rental House'}><TypeIcon size={17} /></span>
        <div className="db-main">
          <div className="db-name"><span>{provider.name}</span></div>
          <div className="db-meta" style={{ marginTop: '5px' }}>
            <span className="db-count" title={`${count} item${count === 1 ? '' : 's'}`}><span className="db-dot" />{count}</span>
            {provider.location && (
              <span className="db-iconbtn" style={{ width: 22, height: 22 }} title={provider.location} aria-label={provider.location}>
                <MapPin size={13} />
              </span>
            )}
            {provider.phone && (
              <IconLink href={telUrl(provider.phone)} title={provider.phone} external={false} className="sm">
                <Phone size={13} />
              </IconLink>
            )}
            {provider.phone && (
              <IconLink href={waUrl(provider.phone)} title="WhatsApp" className="sm"><MessageCircle size={13} /></IconLink>
            )}
          </div>
        </div>
        <div className="db-actions" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          {!archived && (
            <>
              <button className="db-iconbtn" title="Edit" aria-label="Edit" onClick={onEdit}><Edit2 size={14} /></button>
              <button className="db-iconbtn" title="Archive" aria-label="Archive" onClick={onArchive}><Archive size={14} /></button>
            </>
          )}
          {archived && (
            <button className="db-iconbtn" title="Restore" aria-label="Restore" onClick={onRestore}><RotateCcw size={14} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderModal({ provider, onSave, onClose }) {
  const [form, setForm] = useState({
    name: provider?.name || '',
    type: provider?.type || 'Rental House',
    phone: provider?.phone || '',
    email: provider?.email || '',
    location: provider?.location || '',
    notes: provider?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function handleSave() {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setSaving(true);
    try {
      await onSave({ ...form, name: form.name.trim() });
    } catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <Overlay
      title={provider ? 'Edit Provider' : 'Add Provider'}
      onClose={onClose}
      width={480}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </>}
    >
      <div className="form-row">
        <label className="form-label">Name *</label>
        <input className="input" value={form.name} onChange={e => f('name', e.target.value)} autoFocus />
      </div>
      <div className="form-row">
        <label className="form-label">Type</label>
        <input
          className="input"
          value={form.type}
          onChange={e => f('type', e.target.value)}
          list="provider-type-list"
          placeholder="Rental House"
        />
        <datalist id="provider-type-list">
          {TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}
        </datalist>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Phone</label>
          <input className="input" value={form.phone} onChange={e => f('phone', e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Email</label>
          <input className="input" type="email" value={form.email} onChange={e => f('email', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Location</label>
        <input className="input" value={form.location} onChange={e => f('location', e.target.value)} placeholder="City, Country" />
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" rows={2} value={form.notes} onChange={e => f('notes', e.target.value)} />
      </div>
      {err && <div className="error-msg">{err}</div>}
    </Overlay>
  );
}

function AddItemModal({ allItems, existingItemIds, onAdd, onCreate, onClose }) {
  const [query, setQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [createNew, setCreateNew] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [dailyRate, setDailyRate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const availableItems = allItems.filter(i => !existingItemIds.has(i.id));
  const filtered = query.trim()
    ? availableItems.filter(i => i.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : availableItems.slice(0, 8);

  const exactMatch = allItems.find(i => i.name.toLowerCase() === query.trim().toLowerCase());
  const showCreateOption = query.trim().length > 1 && !exactMatch;

  function pick(item) {
    setSelectedItem(item);
    setCreateNew(false);
    setQuery(item.name);
    setDropdownOpen(false);
  }

  function pickCreateNew() {
    setSelectedItem(null);
    setCreateNew(true);
    setDropdownOpen(false);
  }

  async function handleSave() {
    setErr('');
    if (!query.trim()) { setErr('Item name required'); return; }
    if (!createNew && !selectedItem) { setErr('Pick an item from the list or create a new one'); return; }
    setSaving(true);
    try {
      if (createNew) {
        await onCreate(query.trim(), newCategory.trim() || null, dailyRate, notes);
      } else {
        await onAdd(selectedItem.id, dailyRate, notes);
      }
    } catch (e) { setErr(e.message); setSaving(false); }
  }

  const pickedVisual = createNew ? assetCategoryVisual(newCategory) : selectedItem ? assetCategoryVisual(selectedItem.category) : null;

  return (
    <Overlay
      title="Add Item"
      onClose={onClose}
      width={420}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || (!selectedItem && !createNew)}
        >
          {saving ? 'Adding...' : 'Add'}
        </button>
      </>}
    >
      <div className="form-row" style={{ position: 'relative' }}>
        <label className="form-label">Item *</label>
        <div className="flex-center gap-2">
          {pickedVisual && <span className="db-avatar sm"><pickedVisual.Icon size={15} /></span>}
          <input
            className="input"
            value={query}
            autoFocus
            placeholder="Search or type a new item"
            onChange={e => { setQuery(e.target.value); setSelectedItem(null); setCreateNew(false); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
          />
        </div>
        {dropdownOpen && (filtered.length > 0 || showCreateOption) && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
            background: 'var(--color-surface-alt)', border: '1px solid var(--border)', borderRadius: '10px',
            boxShadow: '0 8px 24px var(--scrim)', marginTop: '4px', overflow: 'hidden',
          }}>
            {filtered.map(item => {
              const { Icon } = assetCategoryVisual(item.category);
              return (
                <div
                  key={item.id}
                  onMouseDown={() => pick(item)}
                  style={{ padding: '9px 14px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid var(--color-hairline)', display: 'flex', alignItems: 'center', gap: '10px' }}
                >
                  <Icon size={14} style={{ color: 'var(--color-mid-gray)' }} />
                  <span style={{ flex: 1 }}>{item.name}</span>
                </div>
              );
            })}
            {showCreateOption && (
              <div
                onMouseDown={pickCreateNew}
                style={{ padding: '9px 14px', cursor: 'pointer', fontSize: '13px', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Plus size={13} />
                {query.trim()}
              </div>
            )}
          </div>
        )}
      </div>

      {createNew && (
        <div className="form-row">
          <label className="form-label">Category</label>
          <input className="input" value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Camera, Lighting, Audio" />
        </div>
      )}

      <div className="form-row">
        <label className="form-label">Day Rate €</label>
        <input type="number" className="input" value={dailyRate} min="0" onChange={e => setDailyRate(e.target.value)} placeholder="0" />
      </div>

      <div className="form-row">
        <label className="form-label">Notes</label>
        <input className="input" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>

      {err && <div className="error-msg">{err}</div>}
    </Overlay>
  );
}
