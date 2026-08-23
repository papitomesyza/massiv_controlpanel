import React, { useEffect, useState } from 'react';
import { X, Lightbulb } from 'lucide-react';
import { api } from '../api';

export default function AddLeadModal({ onClose, onSaved, lead: existingLead }) {
  const isEdit = !!existingLead;
  const [clients, setClients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [useManualClient, setUseManualClient] = useState(
    isEdit ? !!existingLead.client_name_manual && !existingLead.client_id : false
  );
  const [form, setForm] = useState({
    client_id: isEdit ? (existingLead.client_id ? String(existingLead.client_id) : '') : '',
    client_name_manual: isEdit ? (existingLead.client_name_manual || '') : '',
    category_id: isEdit ? (existingLead.category_id ? String(existingLead.category_id) : '') : '',
    category_name_manual: isEdit ? (existingLead.category_name_manual || '') : '',
    note: isEdit ? (existingLead.note || '') : '',
    value: isEdit ? (existingLead.value != null ? String(existingLead.value) : '') : '',
    contacted_at: isEdit ? (existingLead.contacted_at || new Date().toISOString().split('T')[0]) : new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([api.get('/clients'), api.get('/settings/project-categories')])
      .then(([cl, ca]) => { setClients(cl); setCategories(ca); });
  }, []);

  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!useManualClient && !form.client_id && !form.client_name_manual) {
      setErr('Please select or enter a client name');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const payload = {
        client_id: !useManualClient && form.client_id ? form.client_id : null,
        client_name_manual: useManualClient ? form.client_name_manual || null : null,
        category_id: form.category_id || null,
        category_name_manual: form.category_name_manual || null,
        note: form.note || null,
        value: form.value === '' ? null : Number(form.value),
        contacted_at: form.contacted_at,
      };
      const lead = isEdit
        ? await api.put(`/leads/${existingLead.id}`, payload)
        : await api.post('/leads', payload);
      onSaved(lead);
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  }

  const grouped = categories.reduce((acc, c) => {
    acc[c.group_name] = acc[c.group_name] || [];
    acc[c.group_name].push(c);
    return acc;
  }, {});

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Lightbulb size={17} style={{ color: 'var(--accent)' }} /> {isEdit ? 'Edit Lead' : 'New Lead'}
          </span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Client toggle */}
        <div className="form-row">
          <div className="toggle-group" style={{ marginBottom: '8px' }}>
            <button type="button" className={`toggle-btn ${!useManualClient ? 'active' : ''}`} onClick={() => setUseManualClient(false)}>
              Select existing
            </button>
            <button type="button" className={`toggle-btn ${useManualClient ? 'active' : ''}`} onClick={() => setUseManualClient(true)}>
              Type name
            </button>
          </div>
          {!useManualClient ? (
            <select className="select" value={form.client_id} onChange={e => f('client_id', e.target.value)}>
              <option value="">— No client —</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              value={form.client_name_manual}
              onChange={e => f('client_name_manual', e.target.value)}
              placeholder="Client name..."
              autoFocus
            />
          )}
        </div>

        {/* Category */}
        <div className="form-row">
          <label className="form-label">Category</label>
          <select className="select" value={form.category_id} onChange={e => f('category_id', e.target.value)}>
            <option value="">— No category —</option>
            {Object.entries(grouped).map(([g, cats]) => (
              <optgroup key={g} label={g}>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Estimated value, optional, blank allowed */}
        <div className="form-row">
          <label className="form-label">Estimated value <span style={{ color: 'var(--color-mid-gray)', fontWeight: 400 }}>(optional)</span></label>
          <input
            type="number"
            className="input"
            value={form.value}
            onChange={e => f('value', e.target.value)}
            placeholder="Leave blank if unknown"
            min="0"
            step="any"
          />
        </div>

        {/* Note */}
        <div className="form-row">
          <label className="form-label">Note</label>
          <textarea
            className="input"
            value={form.note}
            onChange={e => f('note', e.target.value)}
            placeholder="What did they ask for? Any details about the project..."
            rows={3}
          />
        </div>

        {/* Date Contacted */}
        <div className="form-row">
          <label className="form-label">Date Contacted</label>
          <input type="date" className="input" value={form.contacted_at} onChange={e => f('contacted_at', e.target.value)} />
        </div>

        {err && <div className="error-msg">{err}</div>}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Save' : 'Save Lead'}
          </button>
        </div>
      </div>
    </div>
  );
}
