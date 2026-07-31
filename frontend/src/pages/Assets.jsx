import React, { useEffect, useState, useRef } from 'react';
import { Plus, Edit2, Archive, RotateCcw, Trash2, MapPin, Package, ChevronDown, ChevronRight, Phone, X } from 'lucide-react';
import { api } from '../api';

const TYPE_SUGGESTIONS = ['Rental House', 'Freelancer', 'Studio', 'Post House', 'Other'];

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

  async function loadProviders() {
    const all = await api.get('/assets/providers?all=1');
    setProviders(all.filter(p => !p.archived));
    setArchivedProviders(all.filter(p => p.archived));
  }

  async function loadAllItems() {
    const items = await api.get('/assets/items');
    setAllItems(items);
  }

  useEffect(() => {
    Promise.all([loadProviders(), loadAllItems()]).finally(() => setLoading(false));
  }, []);

  async function loadProviderItems(providerId) {
    try {
      const items = await api.get(`/assets/provider-items/${providerId}`);
      setProviderItems(items);
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
    } catch (e) { alert(e.message); }
  }

  async function restoreProvider(provider) {
    try {
      await api.put(`/assets/providers/${provider.id}/restore`, {});
      loadProviders();
    } catch (e) { alert(e.message); }
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
    try {
      await api.put(`/assets/provider-items/${providerItemId}`, {
        daily_rate: parseFloat(newRate) || 0,
        notes: item?.notes || null,
      });
      setProviderItems(prev => prev.map(i =>
        i.id === providerItemId ? { ...i, daily_rate: parseFloat(newRate) || 0 } : i
      ));
    } catch (e) { alert(e.message); }
    setEditingRate(null);
  }

  async function deleteProviderItem(id) {
    if (!window.confirm('Remove this item from the provider?')) return;
    try {
      await api.del(`/assets/provider-items/${id}`);
      setProviderItems(prev => prev.filter(i => i.id !== id));
      loadProviders();
    } catch (e) { alert(e.message); }
  }

  async function handleAddItem(itemId, dailyRate, notes) {
    await api.post('/assets/provider-items', {
      provider_id: selectedProvider.id,
      item_id: itemId,
      daily_rate: parseFloat(dailyRate) || 0,
      notes: notes || null,
    });
    await loadProviderItems(selectedProvider.id);
    loadProviders();
    setShowAddItemModal(false);
  }

  async function handleCreateAndAddItem(name, category, dailyRate, notes) {
    const newItem = await api.post('/assets/items', { name, category: category || 'Other' });
    await handleAddItem(newItem.id, dailyRate, notes);
    await loadAllItems();
  }

  const categories = [...new Set(providerItems.map(i => i.category).filter(Boolean))];
  const filteredItems = categoryFilter ? providerItems.filter(i => i.category === categoryFilter) : providerItems;

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Assets</div>
          <div className="page-subtitle">Equipment providers, rental houses, and item rates</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditingProvider(null); setShowProviderModal(true); }}>
          <Plus size={15} /> Add Provider
        </button>
      </div>

      <div className="assets-layout" style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>

        {/* Left panel — Providers */}
        <div className="assets-providers-panel" style={{ width: '38%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {providers.length === 0 && archivedProviders.length === 0 && (
            <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
              <Package size={36} color="#d4d4d4" style={{ margin: '0 auto 12px' }} />
              <div style={{ color: '#0a0a0a', fontWeight: 600, marginBottom: '8px' }}>No providers yet</div>
              <div style={{ color: '#737373', fontSize: '13px', marginBottom: '20px' }}>Add your first asset provider to get started.</div>
              <button className="btn btn-primary" onClick={() => setShowProviderModal(true)}>
                <Plus size={14} /> Add Provider
              </button>
            </div>
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
            <div style={{ marginTop: '4px' }}>
              <button
                onClick={() => setShowArchived(p => !p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#737373', fontSize: '12px', padding: '6px 2px', width: '100%',
                }}
              >
                {showArchived ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Archived ({archivedProviders.length})
              </button>
              {showArchived && archivedProviders.map(provider => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  isSelected={false}
                  onSelect={() => {}}
                  onEdit={() => {}}
                  onArchive={() => {}}
                  onRestore={() => restoreProvider(provider)}
                  archived
                />
              ))}
            </div>
          )}
        </div>

        {/* Right panel — Items */}
        <div className="card" style={{ flex: 1, minHeight: '420px', display: 'flex', flexDirection: 'column' }}>
          {!selectedProvider ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '64px 24px', color: '#737373' }}>
              <Package size={40} color="#d4d4d4" style={{ marginBottom: '12px' }} />
              <div style={{ fontSize: '14px' }}>Select a provider to view their items</div>
            </div>
          ) : (
            <>
              {/* Panel header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>{selectedProvider.name}</div>
                  <div style={{ fontSize: '12px', color: '#737373', marginTop: '2px' }}>{selectedProvider.type}</div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {categories.length > 1 && (
                    <select
                      className="select"
                      style={{ fontSize: '12px', padding: '5px 8px', height: 'auto' }}
                      value={categoryFilter}
                      onChange={e => setCategoryFilter(e.target.value)}
                    >
                      <option value="">All categories</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                  <button className="btn btn-primary btn-sm" onClick={() => setShowAddItemModal(true)}>
                    <Plus size={13} /> Add Item
                  </button>
                </div>
              </div>

              {/* Items — desktop table */}
              <div className="assets-items-table-wrap" style={{ flex: 1, overflowY: 'auto' }}>
                {filteredItems.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', color: '#737373' }}>
                    <div style={{ fontSize: '13px', marginBottom: '16px' }}>
                      {categoryFilter ? `No items in "${categoryFilter}"` : 'No items yet for this provider'}
                    </div>
                    {!categoryFilter && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowAddItemModal(true)}>
                        <Plus size={13} /> Add first item
                      </button>
                    )}
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '10px 20px', fontSize: '11px', color: '#737373', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Item Name</th>
                        <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '11px', color: '#737373', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Category</th>
                        <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '11px', color: '#737373', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Daily Rate €</th>
                        <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '11px', color: '#737373', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', width: '160px' }}>Notes</th>
                        <th style={{ width: '44px', borderBottom: '1px solid var(--border)' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map(item => (
                        <tr key={item.id} style={{ borderBottom: '1px solid #e5e5e5' }}>
                          <td style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 500 }}>{item.item_name}</td>
                          <td style={{ padding: '10px 12px' }}>
                            {item.category ? (
                              <span style={{ background: 'rgba(10,10,10,0.04)', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', color: '#737373' }}>{item.category}</span>
                            ) : <span style={{ color: '#737373' }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                            {editingRate?.id === item.id ? (
                              <input
                                type="number"
                                className="input"
                                style={{ width: '80px', padding: '3px 8px', fontSize: '13px', textAlign: 'right', display: 'inline-block' }}
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
                              <span
                                title="Click to edit"
                                onClick={() => setEditingRate({ id: item.id, value: String(item.daily_rate || 0) })}
                                style={{ cursor: 'pointer', fontWeight: 600, fontSize: '13px', padding: '3px 10px', borderRadius: '6px', background: 'rgba(10,10,10,0.03)', display: 'inline-block' }}
                              >
                                €{Number(item.daily_rate || 0).toFixed(0)}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: '12px', color: '#737373', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.notes || <span style={{ color: '#d4d4d4' }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <button
                              className="btn-icon"
                              style={{ color: '#e7000b' }}
                              title="Remove from provider"
                              onClick={() => deleteProviderItem(item.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Items — mobile cards */}
              <div className="assets-items-cards-wrap">
                {filteredItems.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 16px', color: '#737373', fontSize: '13px' }}>
                    {categoryFilter ? `No items in "${categoryFilter}"` : 'No items yet'}
                  </div>
                ) : (
                  filteredItems.map(item => (
                    <div key={item.id} className="assets-item-card">
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '14px', color: '#0a0a0a', marginBottom: '4px' }}>{item.item_name}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {item.category && (
                              <span style={{ background: 'rgba(10,10,10,0.04)', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', color: '#737373' }}>{item.category}</span>
                            )}
                            {editingRate?.id === item.id ? (
                              <input
                                type="number"
                                className="input"
                                style={{ width: '90px', padding: '3px 8px', fontSize: '13px', display: 'inline-block' }}
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
                              <span
                                title="Tap to edit rate"
                                onClick={() => setEditingRate({ id: item.id, value: String(item.daily_rate || 0) })}
                                style={{ cursor: 'pointer', fontWeight: 700, fontSize: '13px', color: 'var(--accent)' }}
                              >
                                €{Number(item.daily_rate || 0).toFixed(0)}/day
                              </span>
                            )}
                          </div>
                          {item.notes && (
                            <div style={{ fontSize: '12px', color: '#737373', marginTop: '4px' }}>{item.notes}</div>
                          )}
                        </div>
                        <button
                          className="btn-icon"
                          style={{ color: '#e7000b', flexShrink: 0 }}
                          title="Remove from provider"
                          onClick={() => deleteProviderItem(item.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
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
    </div>
  );
}

function ProviderCard({ provider, isSelected, onSelect, onEdit, onArchive, onRestore, archived }) {
  const waNumber = provider.phone ? provider.phone.replace(/[^0-9+]/g, '').replace(/^\+/, '') : null;
  const waLink = waNumber ? `https://wa.me/${waNumber}` : null;

  return (
    <div
      onClick={archived ? undefined : onSelect}
      style={{
        background: isSelected ? 'rgba(10,10,10,0.05)' : 'rgba(10,10,10,0.02)',
        border: `1px solid ${isSelected ? '#0a0a0a' : 'var(--border)'}`,
        borderRadius: '10px',
        padding: '14px 16px',
        cursor: archived ? 'default' : 'pointer',
        opacity: archived ? 0.55 : 1,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '5px' }}>{provider.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '24px',
              background: 'rgba(10,10,10,0.05)', color: 'var(--accent)',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {provider.type || 'Rental House'}
            </span>
            <span style={{ fontSize: '11px', color: '#737373' }}>
              {provider.item_count} item{provider.item_count !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {!archived && (
            <>
              <button className="btn-icon" title="Edit" onClick={onEdit}><Edit2 size={13} /></button>
              <button className="btn-icon" title="Archive" onClick={onArchive}><Archive size={13} /></button>
            </>
          )}
          {archived && (
            <button className="btn-icon" title="Restore" onClick={onRestore}><RotateCcw size={13} /></button>
          )}
        </div>
      </div>

      {(provider.location || provider.phone) && (
        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {provider.location && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#737373' }}>
              <MapPin size={11} />
              {provider.location}
            </div>
          )}
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#171717', textDecoration: 'none' }}
              onClick={e => e.stopPropagation()}
            >
              <Phone size={11} />
              {provider.phone}
            </a>
          )}
        </div>
      )}
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
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <span>{provider ? 'Edit Provider' : 'Add Provider'}</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label className="form-label">Name *</label>
            <input className="input" value={form.name} onChange={e => f('name', e.target.value)} autoFocus placeholder="e.g. Camera House Berlin" />
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
              <input className="input" value={form.phone} onChange={e => f('phone', e.target.value)} placeholder="+49 123 456789" />
            </div>
            <div className="form-row">
              <label className="form-label">Email</label>
              <input className="input" type="email" value={form.email} onChange={e => f('email', e.target.value)} placeholder="contact@example.com" />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Location</label>
            <input className="input" value={form.location} onChange={e => f('location', e.target.value)} placeholder="City, Country" />
          </div>
          <div className="form-row">
            <label className="form-label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Optional notes..." />
          </div>
          {err && <div className="error-msg">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
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
    if (!createNew && !selectedItem) { setErr('Select an item from the list or type to create a new one'); return; }
    setSaving(true);
    try {
      if (createNew) {
        await onCreate(query.trim(), newCategory.trim() || null, dailyRate, notes);
      } else {
        await onAdd(selectedItem.id, dailyRate, notes);
      }
    } catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: '420px' }}>
        <div className="modal-header">
          <span>Add Item to Provider</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row" style={{ position: 'relative' }}>
            <label className="form-label">Item *</label>
            <input
              className="input"
              value={query}
              autoFocus
              placeholder="Search or type new item name..."
              onChange={e => { setQuery(e.target.value); setSelectedItem(null); setCreateNew(false); setDropdownOpen(true); }}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            />
            {dropdownOpen && (filtered.length > 0 || showCreateOption) && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                background: '#fafafa', border: '1px solid var(--border)', borderRadius: '10px',
                boxShadow: '0 8px 24px rgba(10,10,10,0.35)', marginTop: '4px', overflow: 'hidden',
              }}>
                {filtered.map(item => (
                  <div
                    key={item.id}
                    onMouseDown={() => pick(item)}
                    style={{ padding: '9px 14px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <span style={{ flex: 1 }}>{item.name}</span>
                    {item.category && <span style={{ color: '#737373', fontSize: '11px' }}>{item.category}</span>}
                  </div>
                ))}
                {showCreateOption && (
                  <div
                    onMouseDown={pickCreateNew}
                    style={{ padding: '9px 14px', cursor: 'pointer', fontSize: '13px', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Plus size={13} />
                    Create new: "{query.trim()}"
                  </div>
                )}
              </div>
            )}
            {(selectedItem || createNew) && (
              <div style={{ marginTop: '4px', fontSize: '11px', color: createNew ? 'var(--accent)' : '#0a0a0a' }}>
                {createNew ? `Will create new item "${query.trim()}"` : 'Existing item selected'}
              </div>
            )}
          </div>

          {createNew && (
            <div className="form-row">
              <label className="form-label">Category</label>
              <input className="input" value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="e.g. Camera, Lighting, Audio" />
            </div>
          )}

          <div className="form-row">
            <label className="form-label">Daily Rate €</label>
            <input type="number" className="input" value={dailyRate} min="0" onChange={e => setDailyRate(e.target.value)} placeholder="0" />
          </div>

          <div className="form-row">
            <label className="form-label">Notes</label>
            <input className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
          </div>

          {err && <div className="error-msg">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || (!selectedItem && !createNew)}
          >
            {saving ? 'Adding...' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  );
}
