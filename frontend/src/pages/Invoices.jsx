import React, { useEffect, useState, useRef } from 'react';
import {
  Receipt, Plus, Download, Trash2, Pencil, Send, Check,
  CheckCircle, Settings, Package, Image as ImageIcon,
  AlertCircle, FileText,
} from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import { Private } from '../context/PrivacyContext';
import InvoiceBuilder from '../components/InvoiceBuilder';

const TABS = [
  { key: 'list',  label: 'Invoices' },
  { key: 'setup', label: 'Invoice Setup' },
];

const KOSOVO_BANKS = [
  'Raiffeisen Bank Kosovo',
  'ProCredit Bank',
  'NLB Banka',
  'TEB',
  'Banka Ekonomike',
  'Banka për Biznes (BPB)',
  'Banka Kombëtare Tregtare (BKT)',
  'Banka Kreditore e Prishtinës',
  'Ziraat Bank Kosova',
  'Is Bank',
];

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, dueDate }) {
  const now = new Date();
  const isOverdue = status === 'issued' && dueDate && new Date(dueDate + 'T23:59:59') < now;
  if (isOverdue) return (
    <span className="badge" style={{ background: 'var(--ember-soft)', color: 'var(--color-ember)' }}>Overdue</span>
  );
  if (status === 'paid') return (
    <span className="badge" style={{ background: 'var(--overlay-05)', color: 'var(--color-ink)' }}>Paid</span>
  );
  if (status === 'issued') return (
    <span className="badge" style={{ background: 'var(--overlay-04)', color: 'var(--accent)' }}>Issued</span>
  );
  return (
    <span className="badge" style={{ background: 'var(--overlay-04)', color: 'var(--color-mid-gray)' }}>Draft</span>
  );
}

// ─── Invoice List Tab ─────────────────────────────────────────────────────────

function InvoicesListTab({ onEdit, refresh }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/invoices');
      setInvoices(data);
    } catch (_) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [refresh]);

  async function handleDelete(inv) {
    if (!window.confirm(`Delete invoice ${inv.invoice_number || '#' + inv.id}? This cannot be undone.`)) return;
    try { await api.del(`/invoices/${inv.id}`); load(); } catch (e) { alert(e.message); }
  }

  async function handleMarkPaid(inv) {
    try { await api.post(`/invoices/${inv.id}/paid`, {}); load(); } catch (e) { alert(e.message); }
  }

  async function handleMarkUnpaid(inv) {
    try { await api.post(`/invoices/${inv.id}/unpaid`, {}); load(); } catch (e) { alert(e.message); }
  }

  async function handleIssue(inv) {
    try { await api.post(`/invoices/${inv.id}/issue`, {}); load(); } catch (e) { alert(e.message); }
  }

  async function handlePdf(inv) {
    try {
      const name = `Invoice-${(inv.invoice_number || inv.id).toString().replace(/\//g, '-')}-${(inv.client_name || '').replace(/[^a-z0-9]/gi, '-')}.pdf`;
      await api.download(`/invoices/${inv.id}/pdf`, name);
    } catch (e) { alert(e.message); }
  }

  const filtered = invoices.filter(inv => {
    if (filter === 'all') return true;
    if (filter === 'draft') return inv.status === 'draft';
    if (filter === 'issued') return inv.status === 'issued';
    if (filter === 'paid') return inv.status === 'paid';
    if (filter === 'overdue') {
      const now = new Date();
      return inv.status === 'issued' && inv.due_date && new Date(inv.due_date + 'T23:59:59') < now;
    }
    return true;
  });

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div>
      {/* Filter chips */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: 'All' },
          { key: 'draft', label: 'Draft' },
          { key: 'issued', label: 'Issued' },
          { key: 'paid', label: 'Paid' },
          { key: 'overdue', label: 'Overdue' },
        ].map(f => (
          <button key={f.key}
            className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '18px', padding: '5px 16px' }}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center', padding: '64px 32px' }}>
          <Receipt size={40} color="var(--color-hairline-strong)" style={{ marginBottom: '16px' }} />
          <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '8px' }}>
            {filter === 'all' ? 'No invoices yet' : `No ${filter} invoices`}
          </div>
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '13px' }}>
            {filter === 'all' && 'Create your first invoice with the button above.'}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Client</th>
                  <th>Issue Date</th>
                  <th>Due Date</th>
                  <th style={{ textAlign: 'right' }}>Amount Due</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const now = new Date();
                  const isOverdue = inv.status === 'issued' && inv.due_date &&
                    new Date(inv.due_date + 'T23:59:59') < now;
                  return (
                    <tr key={inv.id} style={isOverdue ? { background: 'var(--ember-soft)' } : {}}>
                      <td data-label="Invoice">
                        <span style={{ fontWeight: 700, color: inv.invoice_number ? 'var(--color-ink)' : 'var(--color-faint)' }}>
                          {inv.invoice_number || `Draft #${inv.id}`}
                        </span>
                      </td>
                      <td data-label="Client" className="text-sm">{inv.client_name || <span style={{ color: 'var(--color-mid-gray)' }}>—</span>}</td>
                      <td data-label="Issued" className="text-sm text-2">{fmtDate(inv.issue_date)}</td>
                      <td data-label="Due" className="text-sm text-2" style={{ color: isOverdue ? 'var(--color-ember)' : undefined }}>
                        {fmtDate(inv.due_date) || '—'}
                      </td>
                      <td data-label="Amount" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>
                        {<Private>{fmt(inv.amount_due)}</Private>}
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={inv.status} dueDate={inv.due_date} />
                      </td>
                      <td className="mobile-actions">
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost btn-sm" title="Edit"
                            onClick={() => onEdit(inv)}>
                            <Pencil size={13} />
                          </button>
                          <button className="btn btn-ghost btn-sm" title="Export PDF"
                            onClick={() => handlePdf(inv)}>
                            <Download size={13} />
                          </button>
                          {inv.status === 'draft' && (
                            <button className="btn btn-ghost btn-sm" title="Issue"
                              style={{ color: 'var(--accent)' }}
                              onClick={() => handleIssue(inv)}>
                              <Send size={13} />
                            </button>
                          )}
                          {inv.status === 'issued' && (
                            <button className="btn btn-ghost btn-sm" title="Mark Paid"
                              style={{ color: 'var(--color-ink)' }}
                              onClick={() => handleMarkPaid(inv)}>
                              <Check size={13} />
                            </button>
                          )}
                          {inv.status === 'paid' && (
                            <button className="btn btn-ghost btn-sm" title="Mark Unpaid"
                              style={{ color: 'var(--color-mid-gray)', fontSize: '11px' }}
                              onClick={() => handleMarkUnpaid(inv)}>
                              Unpaid
                            </button>
                          )}
                          <button className="btn btn-ghost btn-sm" title="Delete"
                            onClick={() => handleDelete(inv)}>
                            <Trash2 size={13} style={{ color: 'var(--color-ember)' }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Invoice Setup Tab ─────────────────────────────────────────────────────────

function InvoiceSetupTab() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({
    billing_name: '', billing_address: '', billing_tel: '',
    billing_nr_unik: '', billing_bank_account: '', billing_bank_name: '',
    billing_bank_name_custom: '',
    billing_swift: '',
    language: 'sq', next_num_seed: '34', next_year_seed: '25',
    tax_enabled: false,
  });
  const [logo, setLogo] = useState(null);
  const [stamp, setStamp] = useState(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const logoRef = useRef(null);
  const stampRef = useRef(null);

  // Services catalogue
  const [services, setServices] = useState([]);
  const [svcForm, setSvcForm] = useState({ code: '', name: '', unit: 'Shërbim', default_price: '' });
  const [editingSvc, setEditingSvc] = useState(null);
  const [svcMsg, setSvcMsg] = useState('');

  async function loadSettings() {
    setLoading(true);
    try {
      const s = await api.get('/invoices/settings');
      setSettings(s);
      const rawBankName = s.billing_bank_name || '';
      const isKnownBank = KOSOVO_BANKS.includes(rawBankName);
      setForm({
        billing_name: s.billing_name || '',
        billing_address: s.billing_address || '',
        billing_tel: s.billing_tel || '',
        billing_nr_unik: s.billing_nr_unik || '',
        billing_bank_account: s.billing_bank_account || '',
        billing_bank_name: isKnownBank ? rawBankName : (rawBankName ? 'Other' : ''),
        billing_bank_name_custom: !isKnownBank && rawBankName ? rawBankName : '',
        billing_swift: s.billing_swift || '',
        language: s.language || 'sq',
        next_num_seed: String(s.next_num_seed || 34),
        next_year_seed: String(s.next_year_seed || '25'),
        tax_enabled: !!s.tax_enabled,
      });
      setLogo(s.logo_base64 || null);
      setStamp(s.stamp_base64 || null);
    } catch (_) {}
    setLoading(false);
  }

  async function loadServices() {
    try { setServices(await api.get('/invoices/services')); } catch (_) {}
  }

  useEffect(() => {
    loadSettings();
    loadServices();
  }, []);

  async function saveSettings() {
    try {
      const bankNameToSave = form.billing_bank_name === 'Other'
        ? form.billing_bank_name_custom
        : form.billing_bank_name;
      await api.post('/invoices/settings', {
        billing_name: form.billing_name,
        billing_address: form.billing_address,
        billing_tel: form.billing_tel,
        billing_nr_unik: form.billing_nr_unik,
        billing_bank_account: form.billing_bank_account,
        billing_bank_name: bankNameToSave,
        billing_swift: form.billing_swift,
        language: form.language,
        next_num_seed: parseInt(form.next_num_seed, 10),
        next_year_seed: form.next_year_seed,
        logo_base64: logo,
        stamp_base64: stamp,
        tax_enabled: form.tax_enabled ? 1 : 0,
      });
      setMsg('Settings saved');
      loadSettings();
    } catch (e) { setMsg('Error: ' + e.message); }
    setTimeout(() => setMsg(''), 3000);
  }

  function handleLogoFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setLogo(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleStampFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setStamp(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // Service CRUD
  async function saveSvc() {
    try {
      if (editingSvc) {
        await api.put(`/invoices/services/${editingSvc.id}`, svcForm);
      } else {
        await api.post('/invoices/services', svcForm);
      }
      setSvcForm({ code: '', name: '', unit: 'Shërbim', default_price: '' });
      setEditingSvc(null);
      loadServices();
      setSvcMsg('Service saved');
    } catch (e) { setSvcMsg('Error: ' + e.message); }
    setTimeout(() => setSvcMsg(''), 3000);
  }

  async function deleteSvc(id) {
    if (!window.confirm('Delete this service?')) return;
    try { await api.del(`/invoices/services/${id}`); loadServices(); } catch (e) { alert(e.message); }
  }

  function startEditSvc(s) {
    setEditingSvc(s);
    setSvcForm({ code: s.code || '', name: s.name, unit: s.unit, default_price: String(s.default_price) });
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '760px' }}>

      {/* ── Billing Identity ───────────────────────────────────────────────── */}
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
          <Settings size={14} style={{ color: 'var(--accent)' }} />
          <div className="section-title">Company Billing Identity</div>
        </div>
        <div className="form-grid">
          {[
            { key: 'billing_name',        label: 'Company Name' },
            { key: 'billing_address',     label: 'Adresa (Address)' },
            { key: 'billing_tel',         label: 'Tel' },
            { key: 'billing_nr_unik',     label: 'Nr. Unik (Business No.)' },
            { key: 'billing_bank_account', label: 'Bank Account (IBAN)' },
            { key: 'billing_swift',       label: 'SWIFT' },
          ].map(({ key, label }) => (
            <div key={key}>
              <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>{label}</label>
              <input className="input" value={form[key]}
                placeholder={key === 'billing_bank_account' ? 'e.g. 2020-0002-3941-2856' : ''}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        {/* Bank dropdown */}
        <div className="form-grid" style={{ marginTop: '12px' }}>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Bank</label>
            <select className="select" style={{ width: '100%' }}
              value={form.billing_bank_name}
              onChange={e => setForm(f => ({ ...f, billing_bank_name: e.target.value, billing_bank_name_custom: '' }))}>
              <option value="">— Select bank —</option>
              {KOSOVO_BANKS.map(b => <option key={b} value={b}>{b}</option>)}
              <option value="Other">Other (specify)</option>
            </select>
          </div>
          {form.billing_bank_name === 'Other' && (
            <div>
              <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Bank Name</label>
              <input className="input" value={form.billing_bank_name_custom}
                placeholder="Enter bank name"
                onChange={e => setForm(f => ({ ...f, billing_bank_name_custom: e.target.value }))} />
            </div>
          )}
        </div>
      </div>

      {/* ── Invoice Language ───────────────────────────────────────────────── */}
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <FileText size={14} style={{ color: 'var(--accent)' }} />
          <div className="section-title">Invoice Settings</div>
        </div>
        <div className="form-grid">
          <div>
            <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Invoice Language</label>
            <select className="select" value={form.language}
              onChange={e => setForm(f => ({ ...f, language: e.target.value }))} style={{ width: '100%' }}>
              <option value="sq">Albanian (Shqip) — Faturë</option>
              <option value="en">English — Invoice</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>
              Starting Number / Year
            </label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input className="input" type="number" min="1" value={form.next_num_seed}
                onChange={e => setForm(f => ({ ...f, next_num_seed: e.target.value }))}
                style={{ width: '90px' }}
                placeholder="34" />
              <span style={{ fontSize: '14px', color: 'var(--color-mid-gray)' }}>/</span>
              <input className="input" value={form.next_year_seed}
                onChange={e => setForm(f => ({ ...f, next_year_seed: e.target.value }))}
                style={{ width: '60px' }}
                placeholder="25" />
              <span style={{ fontSize: '13px', color: 'var(--color-mid-gray)', whiteSpace: 'nowrap' }}>
                → Next: <strong style={{ color: 'var(--color-ink)' }}>{settings?.next_number_preview || '—'}</strong>
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-mid-gray)', marginTop: '5px' }}>
              Year never changes automatically — you control it here.
            </div>
          </div>
        </div>

        {/* Tax enabled toggle */}
        {settings && (
          <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--overlay-02)', borderRadius: '10px' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-mid-gray)' }}>
              <Receipt size={12} style={{ marginRight: '6px', verticalAlign: 'middle', color: 'var(--accent)' }} />
              Tax: <strong style={{ color: 'var(--color-ink)' }}>{settings.tax_label} {settings.tax_rate}%</strong>
            </div>
            <button
              className={`btn btn-sm ${form.tax_enabled ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: '18px', padding: '4px 16px', fontSize: '12px' }}
              onClick={() => setForm(f => ({ ...f, tax_enabled: !f.tax_enabled }))}
            >
              {form.tax_enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        )}
      </div>

      {/* ── Logo + Stamp Upload ─────────────────────────────────────────────── */}
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
          <ImageIcon size={14} style={{ color: 'var(--accent)' }} />
          <div className="section-title">Invoice Images</div>
        </div>
        <div className="form-grid" style={{ gap: '20px' }}>
          {/* Invoice Logo */}
          <div>
            <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '8px' }}>
              Company Logo (for invoice header)
            </label>
            {logo ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <img src={logo} alt="Invoice logo" style={{ maxHeight: '60px', maxWidth: '160px', objectFit: 'contain', background: 'var(--surface-card)', borderRadius: '10px', padding: '6px' }} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => logoRef.current?.click()}>Replace</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-ember)' }} onClick={() => setLogo(null)}>Remove</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => logoRef.current?.click()}>
                <Plus size={13} /> Upload Logo
              </button>
            )}
            <input type="file" ref={logoRef} accept="image/*" style={{ display: 'none' }} onChange={handleLogoFile} />
          </div>

          {/* Stamp + Signature */}
          <div>
            <label style={{ fontSize: '11px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '8px' }}>
              Stamp + Signature (transparent PNG — overlays Dorezoi line)
            </label>
            {stamp ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <img src={stamp} alt="Stamp" style={{ maxHeight: '80px', maxWidth: '160px', objectFit: 'contain', background: 'repeating-conic-gradient(var(--color-hairline) 0% 25%, var(--surface-card) 0% 50%) 0 0 / 12px 12px', borderRadius: '10px' }} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => stampRef.current?.click()}>Replace</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-ember)' }} onClick={() => setStamp(null)}>Remove</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => stampRef.current?.click()}>
                <Plus size={13} /> Upload Stamp+Signature
              </button>
            )}
            <input type="file" ref={stampRef} accept="image/png,image/webp" style={{ display: 'none' }} onChange={handleStampFile} />
          </div>
        </div>
      </div>

      {/* Save button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button className="btn btn-primary" onClick={saveSettings}>Save Invoice Settings</button>
        {msg && <span style={{ fontSize: '13px', color: msg.startsWith('Error') ? 'var(--color-ember)' : 'var(--color-ink)' }}>{msg}</span>}
      </div>

      {/* ── Services Catalogue ─────────────────────────────────────────────── */}
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
          <Package size={14} style={{ color: 'var(--accent)' }} />
          <div className="section-title">Services Catalogue</div>
          <span style={{ fontSize: '11px', color: 'var(--color-mid-gray)', marginLeft: 'auto' }}>
            Used in invoice line items — auto-fills code, name, unit, price
          </span>
        </div>

        {/* Add / Edit form */}
        <div className="svc-form-grid">
          <div>
            <label style={{ fontSize: '10px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Shifra</label>
            <input className="input" style={{ fontSize: '12px' }} placeholder="2001"
              value={svcForm.code} onChange={e => setSvcForm(f => ({ ...f, code: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: '10px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Emërtimi *</label>
            <input className="input" style={{ fontSize: '12px' }} placeholder="Service name"
              value={svcForm.name} onChange={e => setSvcForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: '10px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Njësia</label>
            <input className="input" style={{ fontSize: '12px' }} placeholder="Shërbim"
              value={svcForm.unit} onChange={e => setSvcForm(f => ({ ...f, unit: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: '10px', color: 'var(--color-mid-gray)', display: 'block', marginBottom: '4px' }}>Çmimi (€)</label>
            <input className="input" type="number" min="0" step="any" style={{ fontSize: '12px' }}
              placeholder="0"
              value={svcForm.default_price} onChange={e => setSvcForm(f => ({ ...f, default_price: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn btn-primary btn-sm" onClick={saveSvc} disabled={!svcForm.name.trim()}>
              {editingSvc ? 'Update' : <><Plus size={13} /> Add</>}
            </button>
            {editingSvc && (
              <button className="btn btn-ghost btn-sm" onClick={() => {
                setEditingSvc(null);
                setSvcForm({ code: '', name: '', unit: 'Shërbim', default_price: '' });
              }}>Cancel</button>
            )}
          </div>
        </div>

        {svcMsg && (
          <div style={{ fontSize: '12px', color: svcMsg.startsWith('Error') ? 'var(--color-ember)' : 'var(--color-ink)', marginBottom: '10px' }}>
            {svcMsg}
          </div>
        )}

        {services.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Shifra</th>
                  <th>Emërtimi</th>
                  <th>Njësia</th>
                  <th style={{ textAlign: 'right' }}>Çmimi</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {services.map(s => (
                  <tr key={s.id} style={editingSvc?.id === s.id ? { background: 'var(--overlay-02)' } : {}}>
                    <td className="text-sm" style={{ color: 'var(--accent)' }}>{s.code || '—'}</td>
                    <td className="text-sm text-bold">{s.name}</td>
                    <td className="text-sm text-2">{s.unit}</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>{<Private>{fmt(s.default_price)}</Private>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => startEditSvc(s)}><Pencil size={12} /></button>
                        <button className="btn btn-ghost btn-sm" onClick={() => deleteSvc(s.id)}>
                          <Trash2 size={12} style={{ color: 'var(--color-ember)' }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-mid-gray)', fontSize: '13px' }}>
            No services in catalogue yet — add one above
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Invoices() {
  const [activeTab, setActiveTab] = useState('list');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [showFromEstimate, setShowFromEstimate] = useState(false);
  const [refresh, setRefresh] = useState(0);

  // Load budgets for "From Estimate" action
  useEffect(() => {
    api.get('/budgets').then(setBudgets).catch(() => {});
  }, []);

  function handleNew() {
    setEditingInvoice(null);
    setShowBuilder(true);
  }

  async function handleEdit(inv) {
    try {
      const full = await api.get(`/invoices/${inv.id}`);
      setEditingInvoice(full);
      setShowBuilder(true);
    } catch (e) { alert(e.message); }
  }

  async function handleFromEstimate(budgetId) {
    try {
      const { id } = await api.post(`/invoices/from-estimate/${budgetId}`, {});
      const full = await api.get(`/invoices/${id}`);
      setShowFromEstimate(false);
      setEditingInvoice(full);
      setShowBuilder(true);
    } catch (e) { alert(e.message); }
  }

  function handleBuilderClose() {
    setShowBuilder(false);
    setEditingInvoice(null);
  }

  function handleBuilderSaved() {
    setShowBuilder(false);
    setEditingInvoice(null);
    setRefresh(r => r + 1);
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '20px' }}>
        <div>
          <div className="page-title">Invoices</div>
          <div className="page-subtitle">Issue, track and export client invoices</div>
        </div>
        {activeTab === 'list' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowFromEstimate(true)}>
              <FileText size={14} /> From Estimate
            </button>
            <button className="btn btn-primary" onClick={handleNew}>
              <Plus size={15} /> New Invoice
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
        {TABS.map(t => (
          <button key={t.key}
            className={`btn btn-sm ${activeTab === t.key ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '18px', padding: '6px 20px', fontWeight: activeTab === t.key ? 600 : 400 }}
            onClick={() => setActiveTab(t.key)}
          >
            {t.key === 'setup' ? <><Settings size={13} style={{ marginRight: '5px' }} />{t.label}</> : t.label}
          </button>
        ))}
      </div>

      {activeTab === 'list' && (
        <InvoicesListTab onEdit={handleEdit} refresh={refresh} />
      )}
      {activeTab === 'setup' && <InvoiceSetupTab />}

      {/* Invoice Builder modal */}
      {showBuilder && (
        <InvoiceBuilder
          invoice={editingInvoice}
          onClose={handleBuilderClose}
          onSaved={handleBuilderSaved}
        />
      )}

      {/* From Estimate picker */}
      {showFromEstimate && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 900,
          background: 'var(--scrim-strong)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card card-pad" style={{ width: '480px', maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>Create Invoice from Estimate</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowFromEstimate(false)}>✕</button>
            </div>
            {budgets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-mid-gray)', fontSize: '13px' }}>
                No estimates found. Create one in Estimates first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {budgets.map(b => (
                  <button key={b.id}
                    onClick={() => handleFromEstimate(b.id)}
                    style={{
                      background: 'var(--overlay-01)', border: '1px solid var(--color-hairline)',
                      borderRadius: '10px', padding: '12px 16px', cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      textAlign: 'left', color: 'var(--color-ink)', width: '100%',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--overlay-01)'}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '2px' }}>{b.title}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-mid-gray)' }}>
                        {b.client_name || b.project_title || 'No client'} · {b.status}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap', marginLeft: '16px' }}>
                      {b.total != null ? `€${Number(b.total).toFixed(2)}` : '—'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
