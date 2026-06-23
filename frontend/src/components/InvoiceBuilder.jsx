import React, { useEffect, useState, useRef } from 'react';
import {
  X, Plus, Trash2, ChevronDown, FileText, Send, Check, Search,
} from 'lucide-react';
import { api, fmt, fmtDate } from '../api';

function uid() { return Math.random().toString(36).slice(2); }

function mkLine(override = {}) {
  return {
    _id: uid(),
    code: '',
    description: '',
    unit: 'Shërbim',
    qty: 1,
    price: 0,
    line_discount_pct: 0,
    amount: 0,
    sort_order: 0,
    ...override,
  };
}

function computeLineAmount(l) {
  const qty = Number(l.qty) || 0;
  const price = Number(l.price) || 0;
  const disc = Number(l.line_discount_pct) || 0;
  return qty * price * (1 - disc / 100);
}

function computeTotals(lines, invoiceDiscount, discountType, taxEnabled, taxRate) {
  const subtotal = lines.reduce((s, l) => s + computeLineAmount(l), 0);
  const discAmt = discountType === 'percent'
    ? subtotal * (Number(invoiceDiscount) || 0) / 100
    : Number(invoiceDiscount) || 0;
  const afterDiscount = Math.max(0, subtotal - discAmt);
  const taxAmt = taxEnabled ? afterDiscount * (Number(taxRate) || 0) / 100 : 0;
  return {
    subtotal,
    discountAmt: discAmt,
    afterDiscount,
    taxAmt,
    amountDue: afterDiscount + taxAmt,
  };
}

function today() {
  return new Date().toISOString().split('T')[0];
}
function todayPlus30() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

export default function InvoiceBuilder({ invoice, onClose, onSaved }) {
  const isEditing = !!invoice;

  // ── Responsive detection ────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Master data ─────────────────────────────────────────────────────────────
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [services, setServices] = useState([]);
  const [invSettings, setInvSettings] = useState(null);

  // ── Form state ───────────────────────────────────────────────────────────────
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientNrUniq, setClientNrUniq] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [projectId, setProjectId] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(todayPlus30());
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [language, setLanguage] = useState('sq');
  const [lines, setLines] = useState([mkLine()]);
  const [invoiceDiscount, setInvoiceDiscount] = useState('0');
  const [discountType, setDiscountType] = useState('amount');
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxRate, setTaxRate] = useState(18);

  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [err, setErr] = useState('');
  const [showServicePicker, setShowServicePicker] = useState(null);
  const scrollRef = useRef(null);

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      api.get('/clients'),
      api.get('/projects'),
      api.get('/invoices/services'),
      api.get('/invoices/settings'),
    ]).then(([cl, pr, sv, st]) => {
      setClients(cl);
      setProjects(pr);
      setServices(sv);
      setInvSettings(st);
      setTaxRate(st.tax_rate || 18);
      if (!isEditing) {
        setTaxEnabled(st.tax_enabled !== false);
        setLanguage(st.language || 'sq');
      }
    }).catch(() => {});
  }, []);

  // ── Populate form when editing ─────────────────────────────────────────────
  useEffect(() => {
    if (!invoice) return;
    setClientId(invoice.client_id ? String(invoice.client_id) : '');
    setClientName(invoice.client_name || '');
    setClientNrUniq(invoice.client_nr_unik || '');
    setClientAddress(invoice.client_address || '');
    setProjectId(invoice.project_id ? String(invoice.project_id) : '');
    setIssueDate(invoice.issue_date || today());
    setDueDate(invoice.due_date || todayPlus30());
    setDescription(invoice.description || '');
    setNotes(invoice.notes || '');
    setLanguage(invoice.language || 'sq');
    setInvoiceDiscount(String(invoice.invoice_discount || 0));
    setDiscountType(invoice.discount_type || 'amount');
    setTaxEnabled(!!invoice.tax_enabled);
    setTaxRate(invoice.tax_rate_applied || 18);
    if (invoice.lines && invoice.lines.length > 0) {
      setLines(invoice.lines.map(l => ({ ...l, _id: uid() })));
    }
  }, [invoice]);

  // ── Client auto-fill ──────────────────────────────────────────────────────
  function handleClientSelect(e) {
    const id = e.target.value;
    setClientId(id);
    if (id) {
      const cl = clients.find(c => String(c.id) === id);
      if (cl) {
        setClientName(cl.company || cl.name || '');
        setClientNrUniq('');
        setClientAddress('');
      }
    }
  }

  // ── Line helpers ──────────────────────────────────────────────────────────
  function addLine() {
    setLines(prev => [...prev, mkLine({ sort_order: prev.length })]);
  }

  function removeLine(id) {
    setLines(prev => prev.filter(l => l._id !== id));
  }

  function updateLine(id, field, value) {
    setLines(prev => prev.map(l => {
      if (l._id !== id) return l;
      const updated = { ...l, [field]: value };
      updated.amount = computeLineAmount(updated);
      return updated;
    }));
  }

  function applyService(lineId, svc) {
    setLines(prev => prev.map(l => {
      if (l._id !== lineId) return l;
      const updated = {
        ...l,
        code: svc.code || '',
        description: svc.name,
        unit: svc.unit || 'Shërbim',
        price: svc.default_price || 0,
      };
      updated.amount = computeLineAmount(updated);
      return updated;
    }));
    setShowServicePicker(null);
  }

  // ── Computed totals ───────────────────────────────────────────────────────
  const totals = computeTotals(lines, invoiceDiscount, discountType, taxEnabled, taxRate);

  // ── Build payload ──────────────────────────────────────────────────────────
  function buildPayload() {
    return {
      project_id: projectId || null,
      client_id: clientId || null,
      client_name: clientName,
      client_nr_unik: clientNrUniq,
      client_address: clientAddress,
      issue_date: issueDate,
      due_date: dueDate || null,
      description,
      notes,
      language,
      invoice_discount: Number(invoiceDiscount) || 0,
      discount_type: discountType,
      tax_enabled: taxEnabled ? 1 : 0,
      tax_rate_applied: taxRate,
      lines: lines.map((l, i) => ({
        code: l.code || null,
        description: l.description,
        unit: l.unit,
        qty: Number(l.qty) || 0,
        price: Number(l.price) || 0,
        line_discount_pct: Number(l.line_discount_pct) || 0,
        sort_order: i,
      })),
    };
  }

  // ── Save draft ────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setErr('');
    try {
      const payload = buildPayload();
      if (isEditing) {
        await api.put(`/invoices/${invoice.id}`, payload);
      } else {
        await api.post('/invoices', payload);
      }
      onSaved();
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  }

  // ── Issue invoice ──────────────────────────────────────────────────────────
  async function handleIssue() {
    setIssuing(true);
    setErr('');
    try {
      const payload = buildPayload();
      let invId = invoice?.id;

      if (isEditing) {
        await api.put(`/invoices/${invoice.id}`, payload);
      } else {
        const res = await api.post('/invoices', payload);
        invId = res.id;
      }

      await api.post(`/invoices/${invId}/issue`, {});
      onSaved();
    } catch (e) {
      setErr(e.message);
    }
    setIssuing(false);
  }

  const isLocked = invoice?.status === 'paid';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div className="inv-topbar">
        <div className="inv-topbar-left">
          <FileText size={18} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: '16px' }}>
            {isEditing ? (invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : 'Edit Draft') : 'New Invoice'}
          </span>
          {invoice?.status && (
            <StatusBadge status={invoice.status} dueDate={invoice.due_date} />
          )}
        </div>
        <div className="inv-topbar-right">
          {err && <span style={{ color: '#FF4444', fontSize: '13px' }}>{err}</span>}
          {!isLocked && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={handleSave} disabled={saving || issuing}>
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              {invoice?.status !== 'issued' && invoice?.status !== 'paid' && (
                <button
                  className="btn btn-primary btn-sm"
                  style={{ gap: '6px' }}
                  onClick={handleIssue}
                  disabled={saving || issuing}
                >
                  <Send size={13} />
                  {issuing ? 'Issuing…' : 'Issue Invoice'}
                </button>
              )}
              {invoice?.status === 'issued' && (
                <button
                  className="btn btn-sm"
                  style={{ background: '#4CAF50', color: '#fff', gap: '6px', borderRadius: '50px' }}
                  onClick={async () => {
                    try {
                      await api.put(`/invoices/${invoice.id}`, buildPayload());
                      await api.post(`/invoices/${invoice.id}/paid`, {});
                      onSaved();
                    } catch (e) { setErr(e.message); }
                  }}
                >
                  <Check size={13} /> Mark Paid
                </button>
              )}
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Service picker modal */}
      {showServicePicker && (
        <ServicePickerModal
          services={services}
          onSelect={svc => applyService(showServicePicker, svc)}
          onClose={() => setShowServicePicker(null)}
        />
      )}

      {/* Scrollable body */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px' : '24px' }}>
        <div style={{ maxWidth: '920px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ── Row 1: Client + Invoice Meta ───────────────────────────────── */}
          <div className="inv-grid-top">
            {/* Client block */}
            <div className="card card-pad">
              <div className="section-title" style={{ marginBottom: '14px', fontSize: '12px' }}>Client</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <select className="select" value={clientId} onChange={handleClientSelect} disabled={isLocked}
                  style={{ width: '100%' }}>
                  <option value="">— Custom / no client —</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.company || c.name}</option>
                  ))}
                </select>
                <input className="input" placeholder="Client name *" value={clientName}
                  onChange={e => setClientName(e.target.value)} disabled={isLocked} />
                <input className="input" placeholder="Nr. Unik" value={clientNrUniq}
                  onChange={e => setClientNrUniq(e.target.value)} disabled={isLocked} />
                <input className="input" placeholder="Address" value={clientAddress}
                  onChange={e => setClientAddress(e.target.value)} disabled={isLocked} />
              </div>
            </div>

            {/* Invoice meta */}
            <div className="card card-pad">
              <div className="section-title" style={{ marginBottom: '14px', fontSize: '12px' }}>Invoice Details</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>
                    Linked Project
                  </label>
                  <select className="select" value={projectId}
                    onChange={e => setProjectId(e.target.value)} disabled={isLocked} style={{ width: '100%' }}>
                    <option value="">— None —</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Issue Date</label>
                    <input className="input" type="date" value={issueDate}
                      onChange={e => setIssueDate(e.target.value)} disabled={isLocked} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Due Date</label>
                    <input className="input" type="date" value={dueDate}
                      onChange={e => setDueDate(e.target.value)} disabled={isLocked} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Language</label>
                  <select className="select" value={language}
                    onChange={e => setLanguage(e.target.value)} disabled={isLocked} style={{ width: '100%' }}>
                    <option value="sq">Albanian (Shqip)</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <input className="input" placeholder="Description / subject" value={description}
                  onChange={e => setDescription(e.target.value)} disabled={isLocked} />
              </div>
            </div>
          </div>

          {/* ── Line Items ─────────────────────────────────────────────────── */}
          <div className="card">
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div className="section-title" style={{ fontSize: '12px' }}>Line Items</div>
              {!isLocked && !isMobile && (
                <button className="btn btn-ghost btn-sm" onClick={addLine} style={{ gap: '5px' }}>
                  <Plus size={13} /> Add Line
                </button>
              )}
            </div>

            {isMobile ? (
              /* ── Mobile: stacked cards ── */
              <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {lines.map(line => (
                  <div key={line._id} className="inv-line-card">
                    {/* Code + Unit */}
                    <div className="inv-line-row-2">
                      <div>
                        <label className="inv-line-label">Shifra</label>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <input className="input" style={{ fontSize: '13px', padding: '9px 10px', minWidth: 0 }}
                            placeholder="2001" value={line.code}
                            onChange={e => updateLine(line._id, 'code', e.target.value)}
                            disabled={isLocked} />
                          {!isLocked && services.length > 0 && (
                            <button className="btn btn-ghost btn-sm"
                              style={{ padding: '8px 10px', flexShrink: 0 }}
                              onClick={() => setShowServicePicker(line._id)}>
                              <ChevronDown size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="inv-line-label">Njësia</label>
                        <input className="input" style={{ fontSize: '13px', padding: '9px 10px' }}
                          placeholder="Shërbim" value={line.unit}
                          onChange={e => updateLine(line._id, 'unit', e.target.value)}
                          disabled={isLocked} />
                      </div>
                    </div>

                    {/* Description */}
                    <div style={{ marginTop: '10px' }}>
                      <label className="inv-line-label">Emërtimi</label>
                      <input className="input" style={{ fontSize: '13px', padding: '9px 10px' }}
                        placeholder="Service description" value={line.description}
                        onChange={e => updateLine(line._id, 'description', e.target.value)}
                        disabled={isLocked} />
                    </div>

                    {/* Qty + Price */}
                    <div className="inv-line-row-2" style={{ marginTop: '10px' }}>
                      <div>
                        <label className="inv-line-label">Sasia</label>
                        <input className="input" style={{ fontSize: '13px', padding: '9px 10px' }}
                          type="number" min="0" step="any" value={line.qty}
                          onChange={e => updateLine(line._id, 'qty', e.target.value)}
                          disabled={isLocked} />
                      </div>
                      <div>
                        <label className="inv-line-label">Çmimi (€)</label>
                        <input className="input" style={{ fontSize: '13px', padding: '9px 10px' }}
                          type="number" min="0" step="any" value={line.price}
                          onChange={e => updateLine(line._id, 'price', e.target.value)}
                          disabled={isLocked} />
                      </div>
                    </div>

                    {/* Discount + Amount + Delete */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginTop: '10px', paddingTop: '10px',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      gap: '8px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                        <label className="inv-line-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Rabat %</label>
                        <input className="input" style={{ width: '70px', fontSize: '13px', padding: '9px 10px', flexShrink: 0 }}
                          type="number" min="0" max="100" step="any" value={line.line_discount_pct}
                          onChange={e => updateLine(line._id, 'line_discount_pct', e.target.value)}
                          disabled={isLocked} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '16px', color: '#fff', whiteSpace: 'nowrap' }}>
                        {fmt(computeLineAmount(line))}
                      </span>
                      {!isLocked && (
                        <button className="btn btn-ghost btn-sm" style={{ padding: '8px', flexShrink: 0 }}
                          onClick={() => removeLine(line._id)}>
                          <Trash2 size={14} style={{ color: '#FF4444' }} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {lines.length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#555', fontSize: '13px' }}>
                    No line items yet — add one below
                  </div>
                )}

                {!isLocked && (
                  <button className="btn btn-ghost" onClick={addLine}
                    style={{ justifyContent: 'center', gap: '6px', width: '100%' }}>
                    <Plus size={14} /> Add Line
                  </button>
                )}
              </div>
            ) : (
              /* ── Desktop: horizontal table ── */
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                      {['Shifra', 'Emërtimi', 'Njësia', 'Sasia', 'Çmimi (€)', 'Rabat %', 'Vlera'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', fontSize: '11px', color: '#666',
                          fontWeight: 600, textAlign: h === 'Vlera' || h === 'Sasia' || h === 'Çmimi (€)' || h === 'Rabat %' ? 'right' : 'left',
                          whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                      {!isLocked && <th style={{ width: '32px' }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line._id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                        {/* Code */}
                        <td style={{ padding: '6px 8px', width: '80px' }}>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <input className="input" style={{ fontSize: '12px', padding: '5px 8px', width: '54px' }}
                              placeholder="2001" value={line.code}
                              onChange={e => updateLine(line._id, 'code', e.target.value)}
                              disabled={isLocked} />
                            {!isLocked && services.length > 0 && (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ padding: '4px 6px' }}
                                title="Pick from catalogue"
                                onClick={() => setShowServicePicker(line._id)}
                              >
                                <ChevronDown size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                        {/* Description */}
                        <td style={{ padding: '6px 8px', minWidth: '180px' }}>
                          <input className="input" style={{ fontSize: '12px', padding: '5px 8px', width: '100%' }}
                            placeholder="Service description"
                            value={line.description}
                            onChange={e => updateLine(line._id, 'description', e.target.value)}
                            disabled={isLocked} />
                        </td>
                        {/* Unit */}
                        <td style={{ padding: '6px 8px', width: '90px' }}>
                          <input className="input" style={{ fontSize: '12px', padding: '5px 8px', width: '80px' }}
                            placeholder="Shërbim"
                            value={line.unit}
                            onChange={e => updateLine(line._id, 'unit', e.target.value)}
                            disabled={isLocked} />
                        </td>
                        {/* Qty */}
                        <td style={{ padding: '6px 8px', width: '70px' }}>
                          <input className="input" style={{ fontSize: '12px', padding: '5px 8px', width: '60px', textAlign: 'right' }}
                            type="number" min="0" step="any"
                            value={line.qty}
                            onChange={e => updateLine(line._id, 'qty', e.target.value)}
                            disabled={isLocked} />
                        </td>
                        {/* Price */}
                        <td style={{ padding: '6px 8px', width: '100px' }}>
                          <input className="input" style={{ fontSize: '12px', padding: '5px 8px', width: '90px', textAlign: 'right' }}
                            type="number" min="0" step="any"
                            value={line.price}
                            onChange={e => updateLine(line._id, 'price', e.target.value)}
                            disabled={isLocked} />
                        </td>
                        {/* Line discount % */}
                        <td style={{ padding: '6px 8px', width: '70px' }}>
                          <input className="input" style={{ fontSize: '12px', padding: '5px 8px', width: '60px', textAlign: 'right' }}
                            type="number" min="0" max="100" step="any"
                            value={line.line_discount_pct}
                            onChange={e => updateLine(line._id, 'line_discount_pct', e.target.value)}
                            disabled={isLocked} />
                        </td>
                        {/* Amount */}
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', fontSize: '13px' }}>
                          {fmt(computeLineAmount(line))}
                        </td>
                        {!isLocked && (
                          <td style={{ padding: '6px 8px' }}>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '4px' }}
                              onClick={() => removeLine(line._id)}>
                              <Trash2 size={13} style={{ color: '#FF4444' }} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: '#555', fontSize: '13px' }}>
                          No line items yet — add one above
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Bottom: Notes + Discount + Tax + Totals ─────────────────────── */}
          <div className="inv-grid-bottom">
            {/* Notes */}
            <div className="card card-pad">
              <div className="section-title" style={{ marginBottom: '10px', fontSize: '12px' }}>
                Vërejtje (Notes)
              </div>
              <textarea className="input" rows={4} style={{ resize: 'vertical', width: '100%', fontFamily: 'inherit' }}
                placeholder="Additional notes printed on the invoice…"
                value={notes} onChange={e => setNotes(e.target.value)} disabled={isLocked} />
            </div>

            {/* Discount + Tax + Totals */}
            <div className="card card-pad inv-totals-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="section-title" style={{ fontSize: '12px' }}>Totals</div>

              {/* Invoice-level discount */}
              <div>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '6px' }}>
                  Rabat-i (Invoice Discount)
                </label>
                <div className="inv-totals-disc-row" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input className="input" type="number" min="0" step="any"
                    style={{ flex: 1, minWidth: 0 }}
                    value={invoiceDiscount}
                    onChange={e => setInvoiceDiscount(e.target.value)}
                    disabled={isLocked} />
                  <button
                    className={`btn btn-sm ${discountType === 'amount' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '10px', padding: '8px 14px', fontSize: '13px', flexShrink: 0 }}
                    onClick={() => !isLocked && setDiscountType('amount')}
                  >€</button>
                  <button
                    className={`btn btn-sm ${discountType === 'percent' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '10px', padding: '8px 14px', fontSize: '13px', flexShrink: 0 }}
                    onClick={() => !isLocked && setDiscountType('percent')}
                  >%</button>
                </div>
              </div>

              {/* Tax toggle */}
              <div className="inv-tax-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ fontSize: '13px', color: '#888', lineHeight: 1.3 }}>
                  Tax ({invSettings?.tax_label || 'Tax'}) {taxRate}%
                </div>
                <button
                  className={`btn btn-sm ${taxEnabled ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ borderRadius: '50px', padding: '8px 18px', fontSize: '13px', flexShrink: 0 }}
                  onClick={() => !isLocked && setTaxEnabled(!taxEnabled)}
                >
                  {taxEnabled ? 'On' : 'Off'}
                </button>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px' }}>
                <TotalRow label="Gjithsejt" value={fmt(totals.subtotal)} />
                {totals.discountAmt > 0 && (
                  <TotalRow label="Rabat-i" value={`- ${fmt(totals.discountAmt)}`} />
                )}
                {totals.discountAmt > 0 && (
                  <TotalRow label="Vlera me zbritje" value={fmt(totals.afterDiscount)} />
                )}
                {taxEnabled && (
                  <TotalRow label={`${invSettings?.tax_label || 'Tax'} ${taxRate}%`} value={fmt(totals.taxAmt)} />
                )}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: '8px', paddingTop: '8px' }}>
                  <TotalRow label="Për pagesë" value={fmt(totals.amountDue)} bold large />
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function TotalRow({ label, value, bold, large }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
      <span style={{ fontSize: large ? '13px' : '12px', color: bold ? '#bbb' : '#777', fontWeight: bold ? 600 : 400 }}>
        {label}
      </span>
      <span style={{ fontSize: large ? '16px' : '13px', fontWeight: bold ? 700 : 500, color: bold ? '#fff' : '#bbb' }}>
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status, dueDate }) {
  const now = new Date();
  const isOverdue = status === 'issued' && dueDate && new Date(dueDate + 'T23:59:59') < now;

  if (isOverdue) return (
    <span className="badge" style={{ background: 'rgba(255,68,68,0.15)', color: '#FF4444', fontSize: '11px' }}>
      Overdue
    </span>
  );
  if (status === 'paid') return (
    <span className="badge" style={{ background: 'rgba(76,175,80,0.15)', color: '#4CAF50', fontSize: '11px' }}>
      Paid
    </span>
  );
  if (status === 'issued') return (
    <span className="badge" style={{ background: 'rgba(199,255,46,0.12)', color: 'var(--accent)', fontSize: '11px' }}>
      Issued
    </span>
  );
  return (
    <span className="badge" style={{ background: 'rgba(255,255,255,0.08)', color: '#888', fontSize: '11px' }}>
      Draft
    </span>
  );
}

function ServicePickerModal({ services, onSelect, onClose }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = q.trim()
    ? services.filter(s =>
        (s.code && s.code.toLowerCase().includes(q.toLowerCase())) ||
        s.name.toLowerCase().includes(q.toLowerCase())
      )
    : services;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#1e1e1e', borderRadius: '16px',
        width: '420px', maxWidth: '92vw', maxHeight: '70vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
        border: '1px solid rgba(255,255,255,0.10)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: '14px' }}>Select Service</span>
          <button className="btn btn-ghost btn-sm" style={{ padding: '4px' }} onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        {/* Search */}
        <div style={{ padding: '12px 18px 8px', flexShrink: 0, position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: '28px', top: '50%', transform: 'translateY(-50%)', color: '#555', pointerEvents: 'none' }} />
          <input
            ref={inputRef}
            className="input"
            placeholder="Search by code or name…"
            value={q}
            onChange={e => setQ(e.target.value)}
            style={{ width: '100%', fontSize: '13px', paddingLeft: '30px' }}
          />
        </div>
        {/* Service list */}
        <div style={{ overflowY: 'auto', flex: 1, paddingBottom: '8px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '28px 18px', textAlign: 'center', color: '#555', fontSize: '13px', lineHeight: 1.5 }}>
              {services.length === 0
                ? 'No services in catalogue yet — add them in Invoice Setup.'
                : 'No services match your search.'}
            </div>
          ) : (
            filtered.map(s => (
              <button key={s.id} onClick={() => onSelect(s)}
                style={{
                  width: '100%', background: 'none', border: 'none',
                  padding: '11px 18px', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(199,255,46,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div>
                  <div>
                    {s.code && (
                      <span style={{ fontSize: '11px', color: 'var(--accent)', marginRight: '8px', fontWeight: 700 }}>
                        {s.code}
                      </span>
                    )}
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>{s.name}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>{s.unit}</div>
                </div>
                <span style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: '16px' }}>
                  {fmt(s.default_price)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
