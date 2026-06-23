import React, { useEffect, useState } from 'react';
import { X, Check, Plus, Trash2, ChevronLeft, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { api, fmt } from '../api';

const STEP_LABELS = ['Project Info', 'Crew', 'Assets & Rentals', 'Logistical Costs', 'Review & Finalize'];

const FLAT_FEE_CATS = new Set([
  'Video Editing', 'Color Grading', 'VFX / Motion Graphics',
  'Podcast / Audio Production', 'Branding & Identity',
  'Graphic Design', 'Web Design', 'Social Media Content Management',
]);

const NO_EQUIPMENT_CATS = new Set([
  'Branding & Identity', 'Graphic Design', 'Web Design', 'Social Media Content Management',
]);

const NO_LOGISTICS_CATS = new Set([
  'Video Editing', 'Color Grading', 'VFX / Motion Graphics',
  'Podcast / Audio Production', 'Branding & Identity',
  'Graphic Design', 'Web Design', 'Social Media Content Management',
]);

function logisticsPresets(categoryName) {
  if (!categoryName) return [];
  const eventRows = [
    { position_label: 'Transport & Petrol', description: '', amount: 0 },
    { position_label: 'Food & Catering on Set', description: '', amount: 0 },
    { position_label: 'Accommodation', description: '', amount: 0 },
  ];
  const baseRows = [
    { position_label: 'Transport & Petrol', description: '', amount: 0 },
    { position_label: 'Food & Catering on Set', description: '', amount: 0 },
  ];
  if (categoryName.toLowerCase().includes('event')) return eventRows;
  return baseRows;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

function mkCrewLine(override = {}) {
  return { _id: uid(), crew_id: null, position_label: '', days: 1, rate: 0, amount: 0, ...override };
}

function mkEquipLine(override = {}) {
  return { _id: uid(), item_id: null, provider_id: null, position_label: '', provider_name: '', days: 1, rate: 0, amount: 0, ...override };
}

function mkLogLine(override = {}) {
  return { _id: uid(), position_label: '', description: '', amount: 0, ...override };
}

export default function BudgetWizard({ budget, onClose, onSaved }) {
  const isEditing = !!budget;
  const [step, setStep] = useState(isEditing ? 4 : 0);

  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [crewMembers, setCrewMembers] = useState([]);
  const [expenseCats, setExpenseCats] = useState([]);
  const [assetProviders, setAssetProviders] = useState([]);
  const [assetAllItems, setAssetAllItems] = useState([]);

  const [info, setInfo] = useState({
    title: budget?.title || '',
    project_id: budget?.project_id || '',
    category: budget?.category || '',
    client_name: budget?.client_name || '',
    shoot_days: budget?.shoot_days || 1,
    shoot_location: budget?.shoot_location || '',
    notes: budget?.notes || '',
    vat_enabled: !!(budget?.vat_enabled),
    vat_rate: budget?.vat_rate ?? 18,
    status: budget?.status || 'draft',
    show_providers: !!(budget?.show_providers),
  });

  const [crewLines, setCrewLines] = useState(() => {
    if (!budget?.lines) return [];
    return budget.lines.filter(l => l.section === 'crew').map(l => ({ ...l, _id: uid() }));
  });

  const [equipLines, setEquipLines] = useState(() => {
    if (!budget?.lines) return [];
    return budget.lines.filter(l => l.section === 'equipment').map(l => {
      const days = l.days || 1;
      const dbRate = parseFloat(l.rate) || 0;
      const dbAmount = parseFloat(l.amount) || 0;
      // Migrate old flat-amount lines (rate=0, amount>0) to days × rate format
      const rate = dbRate === 0 && dbAmount > 0 ? dbAmount / days : dbRate;
      return {
        ...l,
        _id: uid(),
        days,
        rate,
        amount: days * rate,
        provider_name: l.description || '',
        item_id: null,
        provider_id: null,
      };
    });
  });

  const [logLines, setLogLines] = useState(() => {
    if (!budget?.lines) return [];
    return budget.lines.filter(l => l.section === 'logistical').map(l => ({ ...l, _id: uid() }));
  });

  const [logisticsInitialized, setLogisticsInitialized] = useState(isEditing);
  const [expandedProviders, setExpandedProviders] = useState(new Set());
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savedId, setSavedId] = useState(budget?.id || null);

  useEffect(() => {
    Promise.all([
      api.get('/projects'),
      api.get('/settings/project-categories'),
      api.get('/crew'),
      api.get('/settings/expense-categories'),
      api.get('/assets/providers'),
      api.get('/assets/all-items'),
    ]).then(([projs, cats, crew, ec, providers, allItems]) => {
      setProjects(projs);
      setCategories(cats);
      setCrewMembers(crew.filter(c => !c.archived && !c.is_company));
      setExpenseCats(ec);
      setAssetProviders(providers);
      setAssetAllItems(allItems);
    }).catch(() => {});
  }, []);

  const isFlatFee = FLAT_FEE_CATS.has(info.category);
  const hasEquipment = !NO_EQUIPMENT_CATS.has(info.category);
  const hasLogistics = !NO_LOGISTICS_CATS.has(info.category);

  function getNextStep(from) {
    let next = from + 1;
    while (next < 4) {
      if (next === 2 && !hasEquipment) { next++; continue; }
      if (next === 3 && !hasLogistics) { next++; continue; }
      break;
    }
    return next;
  }

  function getPrevStep(from) {
    let prev = from - 1;
    while (prev > 0) {
      if (prev === 3 && !hasLogistics) { prev--; continue; }
      if (prev === 2 && !hasEquipment) { prev--; continue; }
      break;
    }
    return prev;
  }

  function goNext() {
    if (step === 0 && !info.title.trim()) { setErr('Title required'); return; }
    if (step === 0 && !info.category) { setErr('Category is required'); return; }
    setErr('');

    if (getNextStep(step) === 3 && !logisticsInitialized) {
      const presets = logisticsPresets(info.category);
      if (presets.length > 0) setLogLines(presets.map(p => mkLogLine(p)));
      setLogisticsInitialized(true);
    }

    setStep(getNextStep(step));
  }

  function goPrev() {
    setErr('');
    setStep(step === 4 && isEditing ? 0 : getPrevStep(step));
  }

  function handleProjectSelect(projectId) {
    setInfo(p => ({ ...p, project_id: projectId }));
    if (!projectId) return;
    const proj = projects.find(p => p.id === parseInt(projectId));
    if (!proj) return;
    setInfo(p => ({
      ...p,
      project_id: projectId,
      client_name: proj.client_name || p.client_name,
      shoot_days: proj.shoot_days || p.shoot_days,
      shoot_location: proj.shoot_location || p.shoot_location,
    }));
    if (proj.category_name) {
      setInfo(p => ({ ...p, category: proj.category_name }));
    }
  }

  // ── Crew lines ──
  const crewSelected = new Set(crewLines.filter(l => l.crew_id).map(l => String(l.crew_id)));

  function addCrewMember(member) {
    if (crewSelected.has(String(member.id))) {
      setCrewLines(prev => prev.filter(l => String(l.crew_id) !== String(member.id)));
      return;
    }
    setCrewLines(prev => [
      ...prev,
      mkCrewLine({
        crew_id: member.id,
        position_label: member.role || '',
        days: info.shoot_days || 1,
        rate: member.day_rate || 0,
        amount: isFlatFee ? (member.day_rate || 0) : (member.day_rate || 0) * (info.shoot_days || 1),
      }),
    ]);
  }

  function updateCrewLine(id, field, value) {
    setCrewLines(prev => prev.map(l => {
      if (l._id !== id) return l;
      const updated = { ...l, [field]: value };
      if (!isFlatFee && (field === 'days' || field === 'rate')) {
        updated.amount = (parseFloat(updated.days) || 0) * (parseFloat(updated.rate) || 0);
      }
      return updated;
    }));
  }

  function removeCrewLine(id) {
    setCrewLines(prev => prev.filter(l => l._id !== id));
  }

  // ── Equipment / Asset lines ──
  function addAssetItem(item) {
    const exists = equipLines.find(l => l.provider_id === item.provider_id && l.item_id === item.item_id);
    if (exists) {
      setEquipLines(prev => prev.filter(l => !(l.provider_id === item.provider_id && l.item_id === item.item_id)));
      return;
    }
    const days = parseInt(info.shoot_days) || 1;
    const rate = parseFloat(item.daily_rate) || 0;
    setEquipLines(prev => [
      ...prev,
      mkEquipLine({
        item_id: item.item_id,
        provider_id: item.provider_id,
        position_label: item.item_name,
        provider_name: item.provider_name,
        days,
        rate,
        amount: days * rate,
      }),
    ]);
  }

  function updateEquipLine(id, field, value) {
    setEquipLines(prev => prev.map(l => {
      if (l._id !== id) return l;
      const updated = { ...l, [field]: value };
      if (field === 'days' || field === 'rate') {
        updated.amount = (parseFloat(updated.days) || 0) * (parseFloat(updated.rate) || 0);
      }
      return updated;
    }));
  }

  function removeEquipLine(id) {
    setEquipLines(prev => prev.filter(l => l._id !== id));
  }

  function toggleProviderExpand(id) {
    setExpandedProviders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Logistics lines ──
  function addLogRow() {
    setLogLines(prev => [...prev, mkLogLine()]);
  }

  function updateLogLine(id, field, value) {
    setLogLines(prev => prev.map(l => l._id !== id ? l : { ...l, [field]: value }));
  }

  function removeLogLine(id) {
    setLogLines(prev => prev.filter(l => l._id !== id));
  }

  // ── Totals ──
  const crewSubtotal = crewLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const equipSubtotal = equipLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const logSubtotal = logLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const grandSubtotal = crewSubtotal + equipSubtotal + logSubtotal;
  const vatAmount = info.vat_enabled ? grandSubtotal * (parseFloat(info.vat_rate) / 100) : 0;
  const grandTotal = grandSubtotal + vatAmount;

  async function saveToDB() {
    if (!info.title.trim()) throw new Error('Title required');
    if (!info.category) throw new Error('Category required');

    const payload = {
      title: info.title.trim(),
      project_id: info.project_id || null,
      category: info.category,
      client_name: info.client_name || null,
      shoot_days: parseInt(info.shoot_days) || 1,
      shoot_location: info.shoot_location || null,
      status: info.status,
      vat_enabled: info.vat_enabled ? 1 : 0,
      vat_rate: parseFloat(info.vat_rate) || 18,
      notes: info.notes || null,
      show_providers: info.show_providers ? 1 : 0,
    };

    let budgetId = savedId;
    if (!budgetId) {
      const created = await api.post('/budgets', payload);
      budgetId = created.id;
      setSavedId(budgetId);
    } else {
      await api.put(`/budgets/${budgetId}`, payload);
    }

    const allLines = [
      ...crewLines.map((l, i) => ({
        section: 'crew',
        position_label: l.position_label,
        description: null,
        crew_id: l.crew_id || null,
        days: isFlatFee ? 1 : parseFloat(l.days) || 1,
        rate: isFlatFee ? 0 : parseFloat(l.rate) || 0,
        amount: parseFloat(l.amount) || 0,
        sort_order: i,
      })),
      ...equipLines.map((l, i) => {
        const days = parseFloat(l.days) || 1;
        const rate = parseFloat(l.rate) || 0;
        return {
          section: 'equipment',
          position_label: l.position_label,
          description: l.provider_name || null,
          crew_id: null,
          days,
          rate,
          amount: days * rate,
          sort_order: i,
        };
      }),
      ...logLines.map((l, i) => ({
        section: 'logistical',
        position_label: l.position_label,
        description: l.description || null,
        crew_id: null,
        days: 1,
        rate: 0,
        amount: parseFloat(l.amount) || 0,
        sort_order: i,
      })),
    ];

    await api.post(`/budgets/${budgetId}/lines/batch-replace`, { lines: allLines });
    return budgetId;
  }

  async function handleSave() {
    setErr('');
    setSaving(true);
    try {
      const id = await saveToDB();
      onSaved(id);
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  }

  async function handleExportPdf() {
    setErr('');
    setExporting(true);
    try {
      const id = await saveToDB();
      await api.download(`/budgets/${id}/pdf`, `Investment-Estimation-${info.title.replace(/[^a-z0-9]/gi, '-')}.pdf`);
      onSaved(id);
    } catch (e) {
      setErr(e.message);
    }
    setExporting(false);
  }

  const grouped = categories.reduce((acc, c) => {
    acc[c.group_name] = acc[c.group_name] || [];
    acc[c.group_name].push(c);
    return acc;
  }, {});

  const isLastStep = step === 4;
  const isFirstStep = step === 0;

  const equipSelectedKeys = new Set(
    equipLines
      .filter(l => l.item_id !== null && l.provider_id !== null)
      .map(l => `${l.provider_id}-${l.item_id}`)
  );

  return (
    <div className="wizard-overlay">
      <div className="wizard-box" style={{ maxWidth: '760px' }}>

        <div className="wizard-header">
          <span className="wizard-title">{isEditing ? 'Edit Investment Estimation' : 'New Investment Estimation'}</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="wizard-steps">
          {STEP_LABELS.map((label, i) => {
            const isApplicable = i === 0 || i === 1 || i === 4
              || (i === 2 && hasEquipment)
              || (i === 3 && hasLogistics);
            return (
              <React.Fragment key={i}>
                <div className={`wizard-step-item ${i === step ? 'current' : i < step ? 'done' : ''} ${!isApplicable ? 'budget-step-skip' : ''}`}>
                  <div className="wizard-step-dot">
                    {i < step ? <Check size={10} /> : <span>{i + 1}</span>}
                  </div>
                  <span className="wizard-step-label">{label}</span>
                </div>
                {i < STEP_LABELS.length - 1 && <div className="wizard-step-connector" />}
              </React.Fragment>
            );
          })}
        </div>

        <div className="wizard-content">
          {step === 0 && (
            <StepInfo
              info={info} setInfo={setInfo}
              projects={projects} grouped={grouped}
              onProjectSelect={handleProjectSelect}
            />
          )}
          {step === 1 && (
            <StepCrew
              crewMembers={crewMembers}
              lines={crewLines}
              isFlatFee={isFlatFee}
              shootDays={info.shoot_days}
              selected={crewSelected}
              onToggle={addCrewMember}
              onUpdate={updateCrewLine}
              onRemove={removeCrewLine}
              onAddCustom={() => setCrewLines(prev => [...prev, mkCrewLine({ days: info.shoot_days || 1 })])}
              subtotal={crewSubtotal}
            />
          )}
          {step === 2 && (
            <StepEquipmentAssets
              assetProviders={assetProviders}
              assetAllItems={assetAllItems}
              lines={equipLines}
              selectedKeys={equipSelectedKeys}
              expandedProviders={expandedProviders}
              onToggleExpand={toggleProviderExpand}
              onAddItem={addAssetItem}
              onUpdate={updateEquipLine}
              onRemove={removeEquipLine}
              onAddCustom={() => setEquipLines(prev => [...prev, mkEquipLine({ days: parseInt(info.shoot_days) || 1 })])}
              subtotal={equipSubtotal}
            />
          )}
          {step === 3 && (
            <StepLogistics
              lines={logLines}
              expenseCats={expenseCats}
              onAdd={addLogRow}
              onUpdate={updateLogLine}
              onRemove={removeLogLine}
              subtotal={logSubtotal}
            />
          )}
          {step === 4 && (
            <StepReview
              info={info} setInfo={setInfo}
              crewLines={crewLines} setCrewLines={setCrewLines}
              equipLines={equipLines} setEquipLines={setEquipLines}
              logLines={logLines} setLogLines={setLogLines}
              isFlatFee={isFlatFee} hasEquipment={hasEquipment} hasLogistics={hasLogistics}
              expenseCats={expenseCats}
              crewSubtotal={crewSubtotal}
              equipSubtotal={equipSubtotal}
              logSubtotal={logSubtotal}
              grandSubtotal={grandSubtotal}
              vatAmount={vatAmount}
              grandTotal={grandTotal}
            />
          )}
        </div>

        {err && <div className="error-msg" style={{ padding: '0 28px 4px' }}>{err}</div>}

        <div className="wizard-footer">
          <button className="btn btn-ghost" onClick={isFirstStep ? onClose : goPrev}>
            {isFirstStep ? 'Cancel' : isEditing && step === 4 ? <><ChevronLeft size={14} /> Back to Steps</> : '← Back'}
          </button>
          <div style={{ flex: 1 }} />
          {!isLastStep ? (
            <button className="btn btn-primary" onClick={goNext}>Next →</button>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-ghost" onClick={handleExportPdf} disabled={exporting || saving}>
                <Download size={14} /> {exporting ? 'Exporting...' : 'Export PDF'}
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || exporting}>
                {saving ? 'Saving...' : 'Save Investment Estimation'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Step 1: Project Info ─── */
function StepInfo({ info, setInfo, projects, grouped, onProjectSelect }) {
  function f(k, v) { setInfo(p => ({ ...p, [k]: v })); }

  return (
    <div>
      <div className="form-row">
        <label className="form-label">Investment Estimation Title *</label>
        <input className="input" value={info.title} onChange={e => f('title', e.target.value)} placeholder="e.g. Nike Summer Campaign" autoFocus />
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Link to Project</label>
          <select className="select" value={info.project_id} onChange={e => onProjectSelect(e.target.value)}>
            <option value="">No project linked</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">Category *</label>
          <select className="select" value={info.category} onChange={e => f('category', e.target.value)}>
            <option value="">Select category</option>
            {Object.entries(grouped).map(([g, cats]) => (
              <optgroup key={g} label={g}>{cats.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</optgroup>
            ))}
          </select>
        </div>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Client Name</label>
          <input className="input" value={info.client_name} onChange={e => f('client_name', e.target.value)} placeholder="Client or company name" />
        </div>
        <div className="form-row">
          <label className="form-label">Shoot Days</label>
          <input type="number" min="1" max="30" className="input" value={info.shoot_days} onChange={e => f('shoot_days', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Shoot Location</label>
        <input className="input" value={info.shoot_location} onChange={e => f('shoot_location', e.target.value)} placeholder="Location" />
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={info.notes} onChange={e => f('notes', e.target.value)} placeholder="Internal notes or special conditions..." rows={3} />
      </div>
    </div>
  );
}

/* ─── Step 2: Crew ─── */
function StepCrew({ crewMembers, lines, isFlatFee, shootDays, selected, onToggle, onUpdate, onRemove, onAddCustom, subtotal }) {
  return (
    <div className="budget-split-layout">
      <div className="budget-panel-left">
        <div className="budget-panel-title">{isFlatFee ? 'Service Providers' : 'Crew Members'}</div>
        <div className="budget-card-grid">
          {crewMembers.map(m => (
            <div
              key={m.id}
              className={`budget-person-card ${selected.has(String(m.id)) ? 'selected' : ''}`}
              onClick={() => onToggle(m)}
            >
              <div className="budget-person-name">{m.name}</div>
              <div className="budget-person-role">{m.role || '—'}</div>
              <div className="budget-person-rate">{isFlatFee ? `€${Number(m.day_rate || 0).toFixed(0)} flat` : `€${Number(m.day_rate || 0).toFixed(0)}/day`}</div>
            </div>
          ))}
          {crewMembers.length === 0 && (
            <div style={{ color: '#555', fontSize: '12px', gridColumn: '1/-1', padding: '12px 0' }}>No crew members found.</div>
          )}
        </div>
      </div>

      <div className="budget-panel-divider" />

      <div className="budget-panel-right">
        <div className="budget-panel-title">{isFlatFee ? 'Services' : 'Crew Cost'}</div>

        {lines.length === 0 && (
          <div style={{ color: '#555', fontSize: '12px', padding: '12px 0', fontStyle: 'italic' }}>
            {isFlatFee ? 'Click providers on the left to add services.' : 'Click crew members on the left to add them.'}
          </div>
        )}

        {lines.length > 0 && (
          <div className="budget-line-headers">
            <span style={{ flex: 2 }}>{isFlatFee ? 'Service' : 'Position'}</span>
            {!isFlatFee && <span style={{ width: '60px' }}>Days</span>}
            {!isFlatFee && <span style={{ width: '80px' }}>Rate/Day</span>}
            <span style={{ width: '80px', textAlign: 'right' }}>{isFlatFee ? 'Amount' : 'Total'}</span>
            <span style={{ width: '28px' }} />
          </div>
        )}

        <div className="budget-lines-list">
          {lines.map(line => (
            <div key={line._id} className="budget-line-row">
              <input
                className="input budget-line-input"
                style={{ flex: 2 }}
                value={line.position_label}
                onChange={e => onUpdate(line._id, 'position_label', e.target.value)}
                placeholder={isFlatFee ? 'Service description' : 'Position label'}
              />
              {!isFlatFee && (
                <input
                  type="number"
                  className="input budget-line-input"
                  style={{ width: '60px' }}
                  value={line.days}
                  min="0.5"
                  step="0.5"
                  onChange={e => onUpdate(line._id, 'days', e.target.value)}
                />
              )}
              {!isFlatFee && (
                <input
                  type="number"
                  className="input budget-line-input"
                  style={{ width: '80px' }}
                  value={line.rate}
                  min="0"
                  onChange={e => onUpdate(line._id, 'rate', e.target.value)}
                  placeholder="0"
                />
              )}
              <div className="budget-line-total" style={{ width: '80px' }}>
                {isFlatFee ? (
                  <input
                    type="number"
                    className="input budget-line-input"
                    style={{ width: '80px' }}
                    value={line.amount}
                    min="0"
                    onChange={e => onUpdate(line._id, 'amount', e.target.value)}
                    placeholder="0"
                  />
                ) : (
                  <span>{fmt(line.amount)}</span>
                )}
              </div>
              <button className="btn-icon" style={{ width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0 }} onClick={() => onRemove(line._id)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <button className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }} onClick={onAddCustom}>
          <Plus size={12} /> Add Custom Row
        </button>

        {lines.length > 0 && (
          <div className="budget-subtotal-row">
            <span>Subtotal</span>
            <span>{fmt(subtotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Step 3: Assets & Rentals ─── */
function StepEquipmentAssets({ assetProviders, assetAllItems, lines, selectedKeys, expandedProviders, onToggleExpand, onAddItem, onUpdate, onRemove, onAddCustom, subtotal }) {
  const itemsByProvider = {};
  assetAllItems.forEach(item => {
    if (!itemsByProvider[item.provider_id]) itemsByProvider[item.provider_id] = [];
    itemsByProvider[item.provider_id].push(item);
  });

  return (
    <div className="budget-split-layout">
      <div className="budget-panel-left">
        <div className="budget-panel-title">Asset Providers</div>

        {assetProviders.length === 0 && (
          <div style={{ color: '#555', fontSize: '12px', padding: '12px 0' }}>
            No asset providers yet. Add them in the Assets page.
          </div>
        )}

        {assetProviders.map(provider => {
          const items = itemsByProvider[provider.id] || [];
          const isExpanded = expandedProviders.has(provider.id);
          return (
            <div key={provider.id} style={{ marginBottom: '6px', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 12px', cursor: 'pointer',
                  background: isExpanded ? 'rgba(199,255,46,0.08)' : 'rgba(255,255,255,0.03)',
                  userSelect: 'none',
                }}
                onClick={() => onToggleExpand(provider.id)}
              >
                {isExpanded ? <ChevronDown size={14} color="#666" /> : <ChevronRight size={14} color="#666" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>{provider.name}</div>
                  <div style={{ fontSize: '11px', color: '#666', marginTop: '1px' }}>
                    {provider.type} · {items.length} item{items.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)' }}>
                  {items.length === 0 ? (
                    <div style={{ padding: '10px 12px', fontSize: '12px', color: '#555' }}>No items for this provider.</div>
                  ) : (
                    items.map(item => {
                      const key = `${item.provider_id}-${item.item_id}`;
                      const isSelected = selectedKeys.has(key);
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '8px 12px', cursor: 'pointer',
                            background: isSelected ? 'rgba(199,255,46,0.10)' : 'transparent',
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                          }}
                          onClick={() => onAddItem(item)}
                        >
                          <div style={{
                            width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0,
                            border: `1.5px solid ${isSelected ? 'var(--accent)' : '#444'}`,
                            background: isSelected ? 'var(--accent)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {isSelected && <Check size={10} color="#0F0F0F" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '12px', color: '#e0e0e0' }}>{item.item_name}</div>
                            {item.category && <div style={{ fontSize: '11px', color: '#555' }}>{item.category}</div>}
                          </div>
                          <div style={{ fontSize: '12px', color: '#888', flexShrink: 0 }}>
                            €{Number(item.daily_rate || 0).toFixed(0)}/day
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="budget-panel-divider" />

      <div className="budget-panel-right">
        <div className="budget-panel-title">Asset & Rental Costs</div>

        {lines.length === 0 && (
          <div style={{ color: '#555', fontSize: '12px', padding: '12px 0', fontStyle: 'italic' }}>
            Expand providers on the left to add items, or add custom rows.
          </div>
        )}

        {lines.length > 0 && (
          <div className="budget-line-headers">
            <span style={{ flex: 2 }}>Item</span>
            <span style={{ width: '52px' }}>Days</span>
            <span style={{ width: '76px' }}>Rate/Day €</span>
            <span style={{ width: '72px', textAlign: 'right' }}>Total</span>
            <span style={{ width: '28px' }} />
          </div>
        )}

        <div className="budget-lines-list">
          {lines.map(line => (
            <div key={line._id} style={{ marginBottom: '4px' }}>
              <div className="budget-line-row">
                <input
                  className="input budget-line-input"
                  style={{ flex: 2 }}
                  value={line.position_label}
                  onChange={e => onUpdate(line._id, 'position_label', e.target.value)}
                  placeholder="Item description"
                />
                <input
                  type="number"
                  className="input budget-line-input"
                  style={{ width: '52px' }}
                  value={line.days}
                  min="0.5"
                  step="0.5"
                  onChange={e => onUpdate(line._id, 'days', e.target.value)}
                />
                <input
                  type="number"
                  className="input budget-line-input"
                  style={{ width: '76px' }}
                  value={line.rate}
                  min="0"
                  onChange={e => onUpdate(line._id, 'rate', e.target.value)}
                  placeholder="0"
                />
                <div className="budget-line-total" style={{ width: '72px', textAlign: 'right' }}>
                  {fmt((parseFloat(line.days) || 0) * (parseFloat(line.rate) || 0))}
                </div>
                <button className="btn-icon" style={{ width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0 }} onClick={() => onRemove(line._id)}>
                  <Trash2 size={12} />
                </button>
              </div>
              {line.provider_name && (
                <div style={{ fontSize: '11px', color: '#555', paddingLeft: '6px', marginTop: '-2px' }}>{line.provider_name}</div>
              )}
            </div>
          ))}
        </div>

        <button className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }} onClick={onAddCustom}>
          <Plus size={12} /> Add Custom Row
        </button>

        {lines.length > 0 && (
          <div className="budget-subtotal-row">
            <span>Subtotal</span>
            <span>{fmt(subtotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Step 4: Logistical Costs ─── */
function StepLogistics({ lines, expenseCats, onAdd, onUpdate, onRemove, subtotal }) {
  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <div className="budget-panel-title" style={{ marginBottom: '4px' }}>Logistical Costs</div>
        <div style={{ fontSize: '12px', color: '#666' }}>Add transport, catering, accommodation and other on-location costs.</div>
      </div>

      {lines.length > 0 && (
        <div className="budget-line-headers">
          <span style={{ flex: 1 }}>Category</span>
          <span style={{ flex: 1 }}>Description</span>
          <span style={{ width: '90px', textAlign: 'right' }}>Amount €</span>
          <span style={{ width: '28px' }} />
        </div>
      )}

      <div className="budget-lines-list">
        {lines.map(line => (
          <div key={line._id} className="budget-line-row">
            <select
              className="select budget-line-input"
              style={{ flex: 1 }}
              value={line.position_label}
              onChange={e => onUpdate(line._id, 'position_label', e.target.value)}
            >
              <option value="">Select category</option>
              {expenseCats.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              {line.position_label && !expenseCats.find(c => c.name === line.position_label) && (
                <option value={line.position_label}>{line.position_label}</option>
              )}
            </select>
            <input
              className="input budget-line-input"
              style={{ flex: 1 }}
              value={line.description}
              onChange={e => onUpdate(line._id, 'description', e.target.value)}
              placeholder="Optional detail"
            />
            <input
              type="number"
              className="input budget-line-input"
              style={{ width: '90px' }}
              value={line.amount}
              min="0"
              onChange={e => onUpdate(line._id, 'amount', e.target.value)}
              placeholder="0"
            />
            <button className="btn-icon" style={{ width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0 }} onClick={() => onRemove(line._id)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <button className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }} onClick={onAdd}>
        <Plus size={12} /> Add Row
      </button>

      {lines.length > 0 && (
        <div className="budget-subtotal-row">
          <span>Subtotal</span>
          <span>{fmt(subtotal)}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Step 5: Review & Finalize ─── */
function StepReview({
  info, setInfo,
  crewLines, setCrewLines,
  equipLines, setEquipLines,
  logLines, setLogLines,
  isFlatFee, hasEquipment, hasLogistics,
  expenseCats,
  crewSubtotal, equipSubtotal, logSubtotal,
  grandSubtotal, vatAmount, grandTotal,
}) {
  function f(k, v) { setInfo(p => ({ ...p, [k]: v })); }

  function ProviderToggle() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flex: 1 }}>
          <div
            onClick={() => f('show_providers', !info.show_providers)}
            style={{
              width: '38px', height: '22px', borderRadius: '50px', flexShrink: 0,
              background: info.show_providers ? 'var(--accent)' : '#333',
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute', top: '3px',
              left: info.show_providers ? '19px' : '3px',
              width: '16px', height: '16px', borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s',
              boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            }} />
          </div>
          <span style={{ fontSize: '13px', color: '#ccc' }}>Show provider names on PDF</span>
        </label>
        <span style={{ fontSize: '11px', color: '#555' }}>{info.show_providers ? 'ON' : 'OFF'}</span>
      </div>
    );
  }

  function updateCrew(id, field, value) {
    setCrewLines(prev => prev.map(l => {
      if (l._id !== id) return l;
      const updated = { ...l, [field]: value };
      if (!isFlatFee && (field === 'days' || field === 'rate')) {
        updated.amount = (parseFloat(updated.days) || 0) * (parseFloat(updated.rate) || 0);
      }
      return updated;
    }));
  }

  function updateEquip(id, field, value) {
    setEquipLines(prev => prev.map(l => {
      if (l._id !== id) return l;
      const updated = { ...l, [field]: value };
      if (field === 'days' || field === 'rate') {
        updated.amount = (parseFloat(updated.days) || 0) * (parseFloat(updated.rate) || 0);
      }
      return updated;
    }));
  }

  function updateLog(id, field, value) {
    setLogLines(prev => prev.map(l => l._id !== id ? l : { ...l, [field]: value }));
  }

  return (
    <div>
      <div className="card card-pad" style={{ marginBottom: '20px', background: '#191919' }}>
        <div className="review-meta-grid">
          {[
            ['Title', info.title],
            ['Category', info.category],
            info.client_name && ['Client', info.client_name],
            info.shoot_days && ['Shoot Days', String(info.shoot_days)],
            info.shoot_location && ['Location', info.shoot_location],
          ].filter(Boolean).map(([label, val]) => (
            <div key={label} className="fin-row" style={{ padding: '6px 0' }}>
              <span className="text-2 text-sm">{label}</span>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Section 01 — Crew */}
      <div className="budget-review-section">
        <div className="budget-review-section-title">01 — CREW COST</div>
        {crewLines.length === 0 ? (
          <div style={{ color: '#555', fontSize: '12px', fontStyle: 'italic', padding: '8px 0' }}>No crew lines added.</div>
        ) : (
          <>
            <div className="budget-line-headers">
              <span style={{ flex: 2 }}>{isFlatFee ? 'Service' : 'Position'}</span>
              {!isFlatFee && <span style={{ width: '60px' }}>Days</span>}
              {!isFlatFee && <span style={{ width: '80px' }}>Rate/Day</span>}
              <span style={{ width: '90px', textAlign: 'right' }}>Total</span>
              <span style={{ width: '28px' }} />
            </div>
            {crewLines.map(line => (
              <div key={line._id} className="budget-line-row">
                <input className="input budget-line-input" style={{ flex: 2 }} value={line.position_label}
                  onChange={e => updateCrew(line._id, 'position_label', e.target.value)} />
                {!isFlatFee && (
                  <input type="number" className="input budget-line-input" style={{ width: '60px' }}
                    value={line.days} min="0.5" step="0.5"
                    onChange={e => updateCrew(line._id, 'days', e.target.value)} />
                )}
                {!isFlatFee && (
                  <input type="number" className="input budget-line-input" style={{ width: '80px' }}
                    value={line.rate} min="0"
                    onChange={e => updateCrew(line._id, 'rate', e.target.value)} />
                )}
                {isFlatFee ? (
                  <input type="number" className="input budget-line-input" style={{ width: '90px' }}
                    value={line.amount} min="0"
                    onChange={e => updateCrew(line._id, 'amount', e.target.value)} />
                ) : (
                  <div className="budget-line-total" style={{ width: '90px' }}>{fmt(line.amount)}</div>
                )}
                <button className="btn-icon" style={{ width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0 }}
                  onClick={() => setCrewLines(prev => prev.filter(l => l._id !== line._id))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div className="budget-subtotal-row"><span>Section subtotal</span><span>{fmt(crewSubtotal)}</span></div>
          </>
        )}
      </div>

      {/* Section 02 — Assets & Rentals */}
      {hasEquipment && (
        <div className="budget-review-section">
          <div className="budget-review-section-title">02 — ASSETS & RENTALS</div>
          <ProviderToggle />
          {equipLines.length === 0 ? (
            <div style={{ color: '#555', fontSize: '12px', fontStyle: 'italic', padding: '8px 0' }}>No equipment lines added.</div>
          ) : (
            <>
              <div className="budget-line-headers">
                <span style={{ flex: 2 }}>Item</span>
                <span style={{ width: '52px' }}>Days</span>
                <span style={{ width: '76px' }}>Rate/Day</span>
                <span style={{ width: '80px', textAlign: 'right' }}>Total</span>
                <span style={{ width: '28px' }} />
              </div>
              {equipLines.map(line => (
                <div key={line._id} style={{ marginBottom: '4px' }}>
                  <div className="budget-line-row">
                    <input className="input budget-line-input" style={{ flex: 2 }} value={line.position_label}
                      onChange={e => updateEquip(line._id, 'position_label', e.target.value)} />
                    <input type="number" className="input budget-line-input" style={{ width: '52px' }}
                      value={line.days} min="0.5" step="0.5"
                      onChange={e => updateEquip(line._id, 'days', e.target.value)} />
                    <input type="number" className="input budget-line-input" style={{ width: '76px' }}
                      value={line.rate} min="0"
                      onChange={e => updateEquip(line._id, 'rate', e.target.value)} />
                    <div className="budget-line-total" style={{ width: '80px' }}>
                      {fmt((parseFloat(line.days) || 0) * (parseFloat(line.rate) || 0))}
                    </div>
                    <button className="btn-icon" style={{ width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0 }}
                      onClick={() => setEquipLines(prev => prev.filter(l => l._id !== line._id))}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {line.provider_name && (
                    <div style={{ fontSize: '11px', color: '#555', paddingLeft: '6px', marginTop: '-2px' }}>{line.provider_name}</div>
                  )}
                </div>
              ))}
              <div className="budget-subtotal-row"><span>Section subtotal</span><span>{fmt(equipSubtotal)}</span></div>
            </>
          )}
        </div>
      )}

      {/* Section 03 — Logistical */}
      {hasLogistics && (
        <div className="budget-review-section">
          <div className="budget-review-section-title">03 — LOGISTICAL COSTS</div>
          {logLines.length === 0 ? (
            <div style={{ color: '#555', fontSize: '12px', fontStyle: 'italic', padding: '8px 0' }}>No logistical lines added.</div>
          ) : (
            <>
              <div className="budget-line-headers">
                <span style={{ flex: 1 }}>Category</span>
                <span style={{ flex: 1 }}>Description</span>
                <span style={{ width: '90px', textAlign: 'right' }}>Amount</span>
                <span style={{ width: '28px' }} />
              </div>
              {logLines.map(line => (
                <div key={line._id} className="budget-line-row">
                  <select className="select budget-line-input" style={{ flex: 1 }} value={line.position_label}
                    onChange={e => updateLog(line._id, 'position_label', e.target.value)}>
                    <option value="">Category</option>
                    {expenseCats.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    {line.position_label && !expenseCats.find(c => c.name === line.position_label) && (
                      <option value={line.position_label}>{line.position_label}</option>
                    )}
                  </select>
                  <input className="input budget-line-input" style={{ flex: 1 }} value={line.description || ''}
                    onChange={e => updateLog(line._id, 'description', e.target.value)}
                    placeholder="Optional detail" />
                  <input type="number" className="input budget-line-input" style={{ width: '90px' }}
                    value={line.amount} min="0"
                    onChange={e => updateLog(line._id, 'amount', e.target.value)} />
                  <button className="btn-icon" style={{ width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0 }}
                    onClick={() => setLogLines(prev => prev.filter(l => l._id !== line._id))}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div className="budget-subtotal-row"><span>Section subtotal</span><span>{fmt(logSubtotal)}</span></div>
            </>
          )}
        </div>
      )}

      {/* Totals + VAT */}
      <div className="budget-review-section budget-totals-block">
        <div className="fin-row" style={{ paddingTop: '12px' }}>
          <span className="text-2">Grand Subtotal</span>
          <span style={{ fontWeight: 600 }}>{fmt(grandSubtotal)}</span>
        </div>

        <div className="fin-row" style={{ alignItems: 'flex-start' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#888' }}>
            <input
              type="checkbox"
              checked={info.vat_enabled}
              onChange={e => setInfo(p => ({ ...p, vat_enabled: e.target.checked }))}
            />
            <span>Include VAT</span>
          </label>
          {info.vat_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="number"
                className="input"
                style={{ width: '60px', padding: '4px 8px', fontSize: '13px' }}
                value={info.vat_rate}
                min="0" max="100"
                onChange={e => setInfo(p => ({ ...p, vat_rate: e.target.value }))}
              />
              <span className="text-2 text-sm">%</span>
              <span style={{ fontWeight: 600, color: '#aaa', fontSize: '13px' }}>{fmt(vatAmount)}</span>
            </div>
          )}
        </div>

        <div className="fin-row total" style={{ borderTop: '1px solid rgba(255,255,255,0.10)', marginTop: '6px', paddingTop: '12px', fontSize: '18px' }}>
          <span>TOTAL</span>
          <span style={{ background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {fmt(grandTotal)}
          </span>
        </div>
      </div>

      {/* Notes & Status */}
      <div className="form-grid" style={{ marginTop: '20px' }}>
        <div className="form-row">
          <label className="form-label">Notes (appears on PDF)</label>
          <textarea className="input" rows={3} value={info.notes} onChange={e => setInfo(p => ({ ...p, notes: e.target.value }))} placeholder="Any additional notes for the client..." />
        </div>
        <div className="form-row">
          <label className="form-label">Status</label>
          <select className="select" value={info.status} onChange={e => setInfo(p => ({ ...p, status: e.target.value }))}>
            <option value="draft">Draft</option>
            <option value="finalized">Finalized</option>
          </select>
        </div>
      </div>
    </div>
  );
}
