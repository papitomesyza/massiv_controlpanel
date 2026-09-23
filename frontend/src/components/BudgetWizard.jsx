import React, { useEffect, useRef, useState } from 'react';
import { X, Check, Plus, Trash2, Download, ChevronDown, ChevronRight, Search, Pencil } from 'lucide-react';
import { api, fmt } from '../api';
import { documentFilename } from '../lib/filename';
import { Private } from '../context/PrivacyContext';
import Overlay from './Overlay';

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
  return { _id: uid(), crew_id: null, position_label: '', days: 1, rate: 0, amount: 0, discount: 0, price_pending: 0, ...override };
}

function mkEquipLine(override = {}) {
  return { _id: uid(), item_id: null, provider_id: null, position_label: '', provider_name: '', days: 1, rate: 0, amount: 0, discount: 0, price_pending: 0, ...override };
}

function mkLogLine(override = {}) {
  return { _id: uid(), position_label: '', description: '', amount: 0, discount: 0, price_pending: 0, ...override };
}

// A line whose price is not settled yet prints TBC rather than a zero euro
// figure, which would read to a client as free. Toggling it on forces the line
// to contribute nothing to any total, exactly like a zero line, so the totals
// math never needs a special case.
function TbcToggle({ active, onToggle }) {
  return (
    <button
      type="button"
      className="budget-tbc-toggle"
      title={active ? 'Price pending (TBC). Click to price this line now.' : 'Mark this line as price pending (TBC)'}
      onClick={onToggle}
      style={{
        width: 'auto', height: '28px', padding: '0 9px', borderRadius: '10px',
        fontSize: '11px', fontWeight: 600, flexShrink: 0, cursor: 'pointer',
        color: active ? 'var(--accent-contrast, #fff)' : 'var(--color-mid-gray)',
        background: active ? 'var(--accent)' : 'transparent',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--color-hairline)'}`,
      }}
    >
      TBC
    </button>
  );
}

// Muted TBC marker used in place of an amount wherever a line is price pending.
function TbcAmount({ style }) {
  return (
    <span style={{ color: 'var(--color-mid-gray)', fontStyle: 'italic', fontSize: '13px', textAlign: 'right', ...style }}>
      TBC
    </span>
  );
}

function discountLabel(amount, discount) {
  const amt = parseFloat(amount) || 0;
  const eff = Math.min(parseFloat(discount) || 0, amt);
  if (eff <= 0) return null;
  const pct = amt > 0 ? (eff / amt) * 100 : 0;
  return `−€${eff.toFixed(2)} (−${pct.toFixed(1)}%)`;
}

export default function BudgetWizard({ budget, onClose, onSaved }) {
  const isEditing = !!budget;
  // Review is read only now, so an existing estimate opens at the first step:
  // the steps are the editor, Review is only the summary.
  const [step, setStep] = useState(0);

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
        // item_id and provider_id now ride along on the loaded line, so an
        // edited estimate restores its catalogue selection: the picker shows the
        // right items ticked and clicking a ticked item removes its line rather
        // than adding a duplicate. Legacy rows saved before these columns existed
        // arrive as null and simply read as custom rows.
        ...l,
        _id: uid(),
        days,
        rate,
        amount: days * rate,
        provider_name: l.description || '',
        item_id: l.item_id != null ? l.item_id : null,
        provider_id: l.provider_id != null ? l.provider_id : null,
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

  // Any user edit since the wizard opened or since the last successful save. It
  // gates the close confirmation and decides whether the finalise button offers
  // to save again or simply close.
  const [dirty, setDirty] = useState(false);
  // A save or export has persisted this estimate during this session. Once true,
  // closing is a plain dismissal, never a discard, and the record is never
  // deleted on close.
  const [saved, setSaved] = useState(false);

  // When shoot days changes and lines already carry the previous count, we offer
  // to apply the new count to exactly those lines. daysBaseline is the count the
  // current lines were built against; the prompt compares against it, and both
  // applying and dismissing move it forward so the same change is never asked
  // about twice.
  const [daysBaseline, setDaysBaseline] = useState(parseInt(budget?.shoot_days) || 1);
  const [daysPrompt, setDaysPrompt] = useState(null);   // { prev, next, count } | null

  function markDirty() { setDirty(true); }

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
      if (presets.length > 0) setLogLines(presets.map(p => mkLogLine({ ...p, _preset: true })));
      setLogisticsInitialized(true);
    }

    setStep(getNextStep(step));
  }

  function goPrev() {
    setErr('');
    setStep(getPrevStep(step));
  }

  function handleProjectSelect(projectId) {
    markDirty();
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
    // Keep the day baseline aligned with a project supplied shoot day count so
    // the later change offer compares against the right value.
    if (proj.shoot_days) setDaysBaseline(parseInt(proj.shoot_days) || daysBaseline);
    if (proj.category_name) {
      setInfo(p => ({ ...p, category: proj.category_name }));
    }
  }

  // Any info-field edit marks the wizard dirty. Passed to the step editors so a
  // change on step one or in Review both flows through here.
  function touchInfo(updater) {
    markDirty();
    setInfo(updater);
  }

  // ── Shoot days ──
  // Changing shoot days must never silently rewrite line day counts: an editor
  // billed five days on a two day shoot is real data. Instead, when lines still
  // carry the previous count, we surface a one line offer to apply the new count
  // to exactly those lines. Lines deliberately set to something else are left
  // alone and are not counted in the offer.
  function daysCandidates(prev) {
    const p = parseFloat(prev);
    // Flat fee crew carry no meaningful day count (days are forced to 1 on save
    // and never priced by day), so only day-priced lines are ever offered.
    const pool = [...(isFlatFee ? [] : crewLines), ...equipLines];
    return pool.filter(l => (parseFloat(l.days) || 0) === p);
  }

  function handleShootDaysChange(raw) {
    markDirty();
    setInfo(p => ({ ...p, shoot_days: raw }));
    const next = parseInt(raw);
    // An empty or invalid entry (mid-typing) changes nothing and leaves the
    // baseline where it is.
    if (!Number.isFinite(next) || next < 1) { setDaysPrompt(null); return; }
    if (next === daysBaseline) { setDaysPrompt(null); return; }
    const count = daysCandidates(daysBaseline).length;
    if (count > 0) {
      // Lines still carry the previous count: offer to apply the new one. The
      // baseline holds at the previous value until the offer is resolved.
      setDaysPrompt({ prev: daysBaseline, next, count });
    } else {
      // Nothing to reconcile, so the new value simply becomes the baseline that
      // new lines are built against and that a later change compares to.
      setDaysBaseline(next);
      setDaysPrompt(null);
    }
  }

  function applyDaysPrompt() {
    if (!daysPrompt) return;
    markDirty();
    const { prev, next } = daysPrompt;
    if (!isFlatFee) {
      setCrewLines(cur => cur.map(l => {
        if ((parseFloat(l.days) || 0) !== prev) return l;
        return { ...l, days: next, amount: next * (parseFloat(l.rate) || 0) };
      }));
    }
    setEquipLines(cur => cur.map(l => {
      if ((parseFloat(l.days) || 0) !== prev) return l;
      return { ...l, days: next, amount: next * (parseFloat(l.rate) || 0) };
    }));
    setDaysBaseline(next);
    setDaysPrompt(null);
  }

  function dismissDaysPrompt() {
    // Move the baseline forward so this same change is never offered again; the
    // lines left on the old count are now treated as deliberately different.
    if (daysPrompt) setDaysBaseline(daysPrompt.next);
    setDaysPrompt(null);
  }

  // Re-seed logistics presets when the category changes, but only replace preset
  // rows the user has not touched. Rows the user edited or added keep their
  // _preset flag cleared and survive untouched, so switching from a non event to
  // an event category surfaces the event specific rows without destroying work.
  const prevCatRef = useRef(info.category);
  useEffect(() => {
    const prevCat = prevCatRef.current;
    prevCatRef.current = info.category;
    if (isEditing) return;              // an edited estimate keeps its saved lines, never presets
    if (!logisticsInitialized) return; // the first seed is owned by goNext
    if (prevCat === info.category) return;
    const seeds = logisticsPresets(info.category);
    setLogLines(prev => {
      const kept = prev.filter(l => !l._preset);
      return [...seeds.map(p => mkLogLine({ ...p, _preset: true })), ...kept];
    });
  }, [info.category, logisticsInitialized, isEditing]);

  // ── Crew lines ──
  const crewSelected = new Set(crewLines.filter(l => l.crew_id).map(l => String(l.crew_id)));

  function addCrewMember(member) {
    markDirty();
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
    markDirty();
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
    markDirty();
    setCrewLines(prev => prev.filter(l => l._id !== id));
  }

  // ── Equipment / Asset lines ──
  function addAssetItem(item) {
    markDirty();
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
    markDirty();
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
    markDirty();
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
    markDirty();
    setLogLines(prev => [...prev, mkLogLine()]);
  }

  function updateLogLine(id, field, value) {
    markDirty();
    // Editing a preset row clears its preset flag so a later category change
    // leaves it alone instead of replacing it.
    setLogLines(prev => prev.map(l => l._id !== id ? l : { ...l, [field]: value, _preset: false }));
  }

  function removeLogLine(id) {
    markDirty();
    setLogLines(prev => prev.filter(l => l._id !== id));
  }

  // ── Totals ──
  // A price pending line contributes nothing, mirroring how it is stored as a
  // zero on save, so no total gains a special case.
  const crewSubtotal = crewLines.reduce((s, l) => s + (l.price_pending ? 0 : (parseFloat(l.amount) || 0)), 0);
  const equipSubtotal = equipLines.reduce((s, l) => s + (l.price_pending ? 0 : (parseFloat(l.amount) || 0)), 0);
  const logSubtotal = logLines.reduce((s, l) => s + (l.price_pending ? 0 : (parseFloat(l.amount) || 0)), 0);
  const grossSubtotal = crewSubtotal + equipSubtotal + logSubtotal;
  const totalDiscount = [...crewLines, ...equipLines, ...logLines].reduce((s, l) => {
    if (l.price_pending) return s;
    const amt = parseFloat(l.amount) || 0;
    const disc = parseFloat(l.discount) || 0;
    return s + Math.min(disc, amt);
  }, 0);
  const netSubtotal = grossSubtotal - totalDiscount;
  const vatAmount = info.vat_enabled ? netSubtotal * (parseFloat(info.vat_rate) / 100) : 0;
  const grandTotal = netSubtotal + vatAmount;

  // An estimate with no lines anywhere is a header over a zero total: nothing a
  // client should ever receive. Individual empty sections stay fine; only a
  // completely empty estimate blocks Save and Export.
  const isEmpty = crewLines.length === 0 && equipLines.length === 0 && logLines.length === 0;

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
        amount: l.price_pending ? 0 : (parseFloat(l.amount) || 0),
        discount: parseFloat(l.discount) || 0,
        price_pending: l.price_pending ? 1 : 0,
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
          // Keep the catalogue link so an edited estimate can restore its picker
          // selection. Custom rows carry neither and save as null.
          item_id: l.item_id != null ? l.item_id : null,
          provider_id: l.provider_id != null ? l.provider_id : null,
          days,
          rate,
          amount: l.price_pending ? 0 : days * rate,
          discount: parseFloat(l.discount) || 0,
          price_pending: l.price_pending ? 1 : 0,
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
        amount: l.price_pending ? 0 : (parseFloat(l.amount) || 0),
        discount: parseFloat(l.discount) || 0,
        price_pending: l.price_pending ? 1 : 0,
        sort_order: i,
      })),
    ];

    await api.post(`/budgets/${budgetId}/lines/batch-replace`, { lines: allLines });
    return budgetId;
  }

  async function handleSave() {
    if (isEmpty) return;
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
    if (isEmpty) return;
    setErr('');
    setExporting(true);
    try {
      const id = await saveToDB();
      // Same helper the card export uses, so an estimate downloads under one
      // identical name whichever side names the file.
      const name = `${documentFilename('Estimate', id, info.title)}.pdf`;
      await api.download(`/budgets/${id}/pdf`, name);
      // Exporting genuinely creates the record. Rather than pretend the wizard
      // can still be cancelled away, we keep it open, mark it saved, and let the
      // user close a real, listed estimate.
      setSaved(true);
      setDirty(false);
    } catch (e) {
      setErr(e.message);
    }
    setExporting(false);
  }

  // Closing routes: the shared overlay asks first when the wizard is dirty and
  // closes a clean wizard at once (the same dirty flag drives both). Once saved,
  // closing reloads the list so the estimate shows, and the record is never
  // deleted.
  function doClose() {
    if (savedId) onSaved(savedId);
    else onClose();
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
    <Overlay
      size="full"
      title={isEditing ? 'Edit Estimate' : 'New Estimate'}
      onClose={doClose}
      width={760}
      dirty={dirty}
      trackInput={false}
      discardMessage={saved
        ? 'Changes made since the last save will be lost. The saved estimate stays in your list.'
        : 'This estimate has not been saved and will be lost.'}
      actions={<>
        {!isFirstStep && <button className="btn btn-ghost btn-sm" onClick={goPrev}>Back</button>}
        {!isLastStep ? (
          <button className="btn btn-primary btn-sm" onClick={goNext}>Next</button>
        ) : (
          <>
            {saved && !dirty && !isEmpty && (
              <span title="Saved to your estimates" style={{ display: 'inline-flex', alignItems: 'center' }}>
                <Check size={15} color="var(--cat-6, var(--accent))" />
              </span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={handleExportPdf} disabled={exporting || saving || isEmpty} title={isEmpty ? 'Add at least one line to save or export' : undefined}>
              <Download size={14} /> {exporting ? 'Exporting...' : 'Export PDF'}
            </button>
            {saved && !dirty ? (
              <button className="btn btn-primary btn-sm" onClick={doClose}>Close</button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || exporting || isEmpty} title={isEmpty ? 'Add at least one line to save or export' : undefined}>
                {saving ? 'Saving...' : 'Save Estimate'}
              </button>
            )}
          </>
        )}
      </>}
    >
      <div className="card wizard-card">

        <div className="wizard-steps">
          {STEP_LABELS.map((label, i) => {
            const isApplicable = i === 0 || i === 1 || i === 4
              || (i === 2 && hasEquipment)
              || (i === 3 && hasLogistics);
            // A skipped step is dimmed and struck through, and says why on hover
            // instead of vanishing silently or explaining itself inline.
            const skipReason = !isApplicable && info.category
              ? `Not needed for ${info.category}`
              : (!isApplicable ? 'Not needed for this category' : undefined);
            return (
              <React.Fragment key={i}>
                <div
                  className={`wizard-step-item ${i === step ? 'current' : i < step ? 'done' : ''} ${!isApplicable ? 'budget-step-skip' : ''}`}
                  title={skipReason}
                >
                  <div className="wizard-step-dot">
                    {i < step ? <Check size={10} /> : <span>{i + 1}</span>}
                    {!isApplicable && <span className="wizard-step-slash" aria-hidden="true" />}
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
              info={info} setInfo={touchInfo}
              projects={projects} grouped={grouped}
              onProjectSelect={handleProjectSelect}
              onShootDaysChange={handleShootDaysChange}
              daysPrompt={daysPrompt}
              onApplyDays={applyDaysPrompt}
              onDismissDays={dismissDaysPrompt}
            />
          )}
          {step === 1 && (
            <StepCrew
              crewMembers={crewMembers}
              lines={crewLines}
              isFlatFee={isFlatFee}
              selected={crewSelected}
              onToggle={addCrewMember}
              onUpdate={updateCrewLine}
              onRemove={removeCrewLine}
              onAddCustom={() => { markDirty(); setCrewLines(prev => [...prev, mkCrewLine({ days: info.shoot_days || 1 })]); }}
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
              onAddCustom={() => { markDirty(); setEquipLines(prev => [...prev, mkEquipLine({ days: parseInt(info.shoot_days) || 1 })]); }}
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
              info={info} setInfo={touchInfo}
              crewLines={crewLines}
              equipLines={equipLines}
              logLines={logLines}
              isFlatFee={isFlatFee} hasEquipment={hasEquipment} hasLogistics={hasLogistics}
              onJump={setStep}
              crewSubtotal={crewSubtotal}
              equipSubtotal={equipSubtotal}
              logSubtotal={logSubtotal}
              grossSubtotal={grossSubtotal}
              totalDiscount={totalDiscount}
              netSubtotal={netSubtotal}
              vatAmount={vatAmount}
              grandTotal={grandTotal}
            />
          )}
        </div>

        {err && <div className="error-msg" style={{ padding: '0 28px 4px' }}>{err}</div>}
      </div>
    </Overlay>
  );
}

/* ─── Step 1: Project Info ─── */
function StepInfo({ info, setInfo, projects, grouped, onProjectSelect, onShootDaysChange, daysPrompt, onApplyDays, onDismissDays }) {
  function f(k, v) { setInfo(p => ({ ...p, [k]: v })); }

  return (
    <div>
      <div className="form-row">
        <label className="form-label">Estimate Title *</label>
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
          <input type="number" min="1" className="input" value={info.shoot_days} onChange={e => onShootDaysChange(e.target.value)} />
        </div>
      </div>

      {daysPrompt && (
        <div
          className="card"
          style={{
            display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
            padding: '10px 14px', marginBottom: '14px',
            background: 'var(--overlay-01)', border: '1px solid var(--color-hairline)',
          }}
        >
          <span style={{ fontSize: '13px', color: 'var(--color-ink-soft)', flex: 1, minWidth: '200px' }}>
            {daysPrompt.count} line{daysPrompt.count !== 1 ? 's' : ''} still use the previous count of {daysPrompt.prev} day{daysPrompt.prev !== 1 ? 's' : ''}.
          </span>
          <button className="btn btn-primary btn-sm" onClick={onApplyDays}>Set to {daysPrompt.next}</button>
          <button className="btn btn-ghost btn-sm" onClick={onDismissDays}>Dismiss</button>
        </div>
      )}

      <div className="form-row">
        <label className="form-label">Shoot Location</label>
        <input className="input" value={info.shoot_location} onChange={e => f('shoot_location', e.target.value)} placeholder="Location" />
      </div>
    </div>
  );
}

/* ─── Step 2: Crew ─── */
function StepCrew({ crewMembers, lines, isFlatFee, selected, onToggle, onUpdate, onRemove, onAddCustom, subtotal }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const visible = query
    ? crewMembers.filter(m =>
        (m.name || '').toLowerCase().includes(query) || (m.role || '').toLowerCase().includes(query))
    : crewMembers;
  return (
    <div className="budget-split-layout">
      <div className="budget-panel-left">
        <div className="budget-panel-title">{isFlatFee ? 'Service Providers' : 'Crew Members'}</div>
        <div className="budget-picker-search">
          <Search size={14} />
          <input
            className="input"
            placeholder={isFlatFee ? 'Search providers' : 'Search name or role'}
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <div className="budget-card-grid">
          {visible.map(m => (
            <div
              key={m.id}
              className={`budget-person-card ${selected.has(String(m.id)) ? 'selected' : ''}`}
              onClick={() => onToggle(m)}
            >
              <div className="budget-person-name">{m.name}</div>
              <div className="budget-person-role">{m.role || '-'}</div>
              <div className="budget-person-rate"><Private>{isFlatFee ? `€${Number(m.day_rate || 0).toFixed(0)} flat` : `€${Number(m.day_rate || 0).toFixed(0)}/day`}</Private></div>
            </div>
          ))}
          {visible.length === 0 && (
            <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px', gridColumn: '1/-1', padding: '12px 0' }}>
              {crewMembers.length === 0 ? 'No crew members found.' : 'No matches.'}
            </div>
          )}
        </div>
      </div>

      <div className="budget-panel-divider" />

      <div className="budget-panel-right">
        <div className="budget-panel-title">{isFlatFee ? 'Services' : 'Crew Cost'}</div>

        {lines.length === 0 && (
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px', padding: '12px 0', fontStyle: 'italic' }}>
            {isFlatFee ? 'Click providers on the left to add services.' : 'Click crew members on the left to add them.'}
          </div>
        )}

        {lines.length > 0 && (
          <div className="budget-line-headers">
            <span style={{ flex: 2 }}>{isFlatFee ? 'Service' : 'Position'}</span>
            {!isFlatFee && <span style={{ width: '60px' }}>Days</span>}
            {!isFlatFee && <span style={{ width: '80px' }}>Rate/Day</span>}
            <span style={{ width: '80px', textAlign: 'right' }}>{isFlatFee ? 'Amount' : 'Total'}</span>
            <span style={{ width: '76px' }}>Disc. €</span>
            <span style={{ width: '28px' }} />
          </div>
        )}

        <div className="budget-lines-list">
          {lines.map(line => {
            const discLbl = discountLabel(line.amount, line.discount);
            return (
              <div key={line._id} className="budget-line-row" style={{ flexWrap: 'wrap' }}>
                <input
                  className="input budget-line-input"
                  style={{ flex: 2, minWidth: '100px' }}
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
                <div className="budget-line-total" style={{ width: '80px', textAlign: 'right' }}>
                  {line.price_pending ? (
                    <TbcAmount style={{ width: '80px', display: 'inline-block' }} />
                  ) : isFlatFee ? (
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
                    <span><Private>{fmt(line.amount)}</Private></span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '76px' }}>
                  {!line.price_pending && (
                    <>
                      <input
                        type="number"
                        className="input budget-line-input"
                        style={{ width: '76px' }}
                        value={line.discount || 0}
                        min="0"
                        placeholder="0"
                        onChange={e => onUpdate(line._id, 'discount', e.target.value)}
                      />
                      {discLbl && (
                        <span style={{ fontSize: '11px', color: 'var(--color-ember)', whiteSpace: 'nowrap' }}><Private>{discLbl}</Private></span>
                      )}
                    </>
                  )}
                </div>
                <TbcToggle active={!!line.price_pending} onToggle={() => onUpdate(line._id, 'price_pending', line.price_pending ? 0 : 1)} />
                <button className="btn-icon" style={{ width: '28px', height: '28px', borderRadius: '10px', flexShrink: 0 }} onClick={() => onRemove(line._id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>

        <button className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }} onClick={onAddCustom}>
          <Plus size={12} /> Add Custom Row
        </button>

        {lines.length > 0 && (
          <div className="budget-subtotal-row">
            <span>Subtotal</span>
            <span><Private>{fmt(subtotal)}</Private></span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Step 3: Assets & Rentals ─── */
function StepEquipmentAssets({ assetProviders, assetAllItems, lines, selectedKeys, expandedProviders, onToggleExpand, onAddItem, onUpdate, onRemove, onAddCustom, subtotal }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const itemsByProvider = {};
  assetAllItems.forEach(item => {
    if (!itemsByProvider[item.provider_id]) itemsByProvider[item.provider_id] = [];
    itemsByProvider[item.provider_id].push(item);
  });

  // A search matches a provider by its own name, or by any of its items. When a
  // provider matches by name every item shows; when it matches only by an item,
  // just that item shows. A live search force-expands what it found.
  const visibleProviders = assetProviders
    .map(provider => {
      const items = itemsByProvider[provider.id] || [];
      if (!query) return { provider, items, forceOpen: false };
      const provMatch = (provider.name || '').toLowerCase().includes(query);
      const matchedItems = provMatch
        ? items
        : items.filter(it =>
            (it.item_name || '').toLowerCase().includes(query) ||
            (it.category || '').toLowerCase().includes(query));
      if (!provMatch && matchedItems.length === 0) return null;
      return { provider, items: matchedItems, forceOpen: true };
    })
    .filter(Boolean);

  return (
    <div className="budget-split-layout">
      <div className="budget-panel-left">
        <div className="budget-panel-title">Asset Providers</div>

        <div className="budget-picker-search">
          <Search size={14} />
          <input
            className="input"
            placeholder="Search provider or item"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>

        {assetProviders.length === 0 && (
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px', padding: '12px 0' }}>
            No asset providers yet. Add them in the Assets page.
          </div>
        )}

        {assetProviders.length > 0 && visibleProviders.length === 0 && (
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px', padding: '12px 0' }}>No matches.</div>
        )}

        {visibleProviders.map(({ provider, items, forceOpen }) => {
          const isExpanded = forceOpen || expandedProviders.has(provider.id);
          return (
            <div key={provider.id} style={{ marginBottom: '6px', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 12px', cursor: 'pointer',
                  background: isExpanded ? 'var(--overlay-04)' : 'var(--overlay-01)',
                  userSelect: 'none',
                }}
                onClick={() => onToggleExpand(provider.id)}
              >
                {isExpanded ? <ChevronDown size={14} color="var(--color-mid-gray)" /> : <ChevronRight size={14} color="var(--color-mid-gray)" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-ink)' }}>{provider.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--color-mid-gray)', marginTop: '1px' }}>
                    {provider.type} · {items.length} item{items.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--overlay-05)' }}>
                  {items.length === 0 ? (
                    <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--color-mid-gray)' }}>No items for this provider.</div>
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
                            background: isSelected ? 'var(--overlay-04)' : 'transparent',
                            borderBottom: '1px solid var(--color-hairline)',
                          }}
                          onClick={() => onAddItem(item)}
                        >
                          <div style={{
                            width: '16px', height: '16px', borderRadius: '6px', flexShrink: 0,
                            border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--color-hairline)'}`,
                            background: isSelected ? 'var(--accent)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {isSelected && <Check size={10} color="var(--accent-contrast)" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '12px', color: 'var(--color-ink-soft)' }}>{item.item_name}</div>
                            {item.category && <div style={{ fontSize: '11px', color: 'var(--color-mid-gray)' }}>{item.category}</div>}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--color-mid-gray)', flexShrink: 0 }}>
                            <Private>€{Number(item.daily_rate || 0).toFixed(0)}/day</Private>
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
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px', padding: '12px 0', fontStyle: 'italic' }}>
            Expand providers on the left to add items, or add custom rows.
          </div>
        )}

        {lines.length > 0 && (
          <div className="budget-line-headers">
            <span style={{ flex: 2 }}>Item</span>
            <span style={{ width: '52px' }}>Days</span>
            <span style={{ width: '76px' }}>Rate/Day €</span>
            <span style={{ width: '72px', textAlign: 'right' }}>Total</span>
            <span style={{ width: '76px' }}>Disc. €</span>
            <span style={{ width: '28px' }} />
          </div>
        )}

        <div className="budget-lines-list">
          {lines.map(line => {
            const discLbl = discountLabel((parseFloat(line.days) || 0) * (parseFloat(line.rate) || 0), line.discount);
            return (
              <div key={line._id} style={{ marginBottom: '4px' }}>
                <div className="budget-line-row" style={{ flexWrap: 'wrap' }}>
                  <input
                    className="input budget-line-input"
                    style={{ flex: 2, minWidth: '100px' }}
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
                    {line.price_pending
                      ? <TbcAmount style={{ width: '72px', display: 'inline-block' }} />
                      : <Private>{fmt((parseFloat(line.days) || 0) * (parseFloat(line.rate) || 0))}</Private>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '76px' }}>
                    {!line.price_pending && (
                      <>
                        <input
                          type="number"
                          className="input budget-line-input"
                          style={{ width: '76px' }}
                          value={line.discount || 0}
                          min="0"
                          placeholder="0"
                          onChange={e => onUpdate(line._id, 'discount', e.target.value)}
                        />
                        {discLbl && (
                          <span style={{ fontSize: '11px', color: 'var(--color-ember)', whiteSpace: 'nowrap' }}><Private>{discLbl}</Private></span>
                        )}
                      </>
                    )}
                  </div>
                  <TbcToggle active={!!line.price_pending} onToggle={() => onUpdate(line._id, 'price_pending', line.price_pending ? 0 : 1)} />
                  <button className="btn-icon" style={{ width: '28px', height: '28px', borderRadius: '10px', flexShrink: 0 }} onClick={() => onRemove(line._id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
                {line.provider_name && (
                  <div style={{ fontSize: '11px', color: 'var(--color-mid-gray)', paddingLeft: '6px', marginTop: '-2px' }}>{line.provider_name}</div>
                )}
              </div>
            );
          })}
        </div>

        <button className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }} onClick={onAddCustom}>
          <Plus size={12} /> Add Custom Row
        </button>

        {lines.length > 0 && (
          <div className="budget-subtotal-row">
            <span>Subtotal</span>
            <span><Private>{fmt(subtotal)}</Private></span>
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
        <div style={{ fontSize: '12px', color: 'var(--color-mid-gray)' }}>Add transport, catering, accommodation and other on-location costs.</div>
      </div>

      {lines.length > 0 && (
        <div className="budget-line-headers">
          <span style={{ flex: 1 }}>Category</span>
          <span style={{ flex: 1 }}>Description</span>
          <span style={{ width: '90px', textAlign: 'right' }}>Amount €</span>
          <span style={{ width: '76px' }}>Disc. €</span>
          <span style={{ width: '28px' }} />
        </div>
      )}

      <div className="budget-lines-list">
        {lines.map(line => {
          const discLbl = discountLabel(line.amount, line.discount);
          return (
            <div key={line._id} className="budget-line-row" style={{ flexWrap: 'wrap' }}>
              <select
                className="select budget-line-input"
                style={{ flex: 1, minWidth: '100px' }}
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
                style={{ flex: 1, minWidth: '80px' }}
                value={line.description}
                onChange={e => onUpdate(line._id, 'description', e.target.value)}
                placeholder="Optional detail"
              />
              {line.price_pending ? (
                <div style={{ width: '90px', textAlign: 'right' }}>
                  <TbcAmount style={{ width: '90px', display: 'inline-block' }} />
                </div>
              ) : (
                <input
                  type="number"
                  className="input budget-line-input"
                  style={{ width: '90px' }}
                  value={line.amount}
                  min="0"
                  onChange={e => onUpdate(line._id, 'amount', e.target.value)}
                  placeholder="0"
                />
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '76px' }}>
                {!line.price_pending && (
                  <>
                    <input
                      type="number"
                      className="input budget-line-input"
                      style={{ width: '76px' }}
                      value={line.discount || 0}
                      min="0"
                      placeholder="0"
                      onChange={e => onUpdate(line._id, 'discount', e.target.value)}
                    />
                    {discLbl && (
                      <span style={{ fontSize: '11px', color: 'var(--color-ember)', whiteSpace: 'nowrap' }}><Private>{discLbl}</Private></span>
                    )}
                  </>
                )}
              </div>
              <TbcToggle active={!!line.price_pending} onToggle={() => onUpdate(line._id, 'price_pending', line.price_pending ? 0 : 1)} />
              <button className="btn-icon" style={{ width: '28px', height: '28px', borderRadius: '10px', flexShrink: 0 }} onClick={() => onRemove(line._id)}>
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <button className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }} onClick={onAdd}>
        <Plus size={12} /> Add Row
      </button>

      {lines.length > 0 && (
        <div className="budget-subtotal-row">
          <span>Subtotal</span>
          <span><Private>{fmt(subtotal)}</Private></span>
        </div>
      )}
    </div>
  );
}

/* ─── Step 5: Review (read only) ─── */
// Review is the summary and the finalisation surface, not a second editor. The
// line fields are shown as static rows; clicking a section header jumps back to
// the step that owns those lines, which is the one place they are edited. Only
// the VAT, provider and notes decisions, which belong to finalisation rather
// than to any single line, stay editable here.
function StepReview({
  info, setInfo,
  crewLines,
  equipLines,
  logLines,
  isFlatFee, hasEquipment, hasLogistics,
  onJump,
  crewSubtotal, equipSubtotal, logSubtotal,
  grossSubtotal, totalDiscount, netSubtotal, vatAmount, grandTotal,
}) {
  function f(k, v) { setInfo(p => ({ ...p, [k]: v })); }

  function SectionHeader({ title, step }) {
    return (
      <button type="button" className="budget-review-jump" onClick={() => onJump(step)} title="Edit this section">
        <span className="budget-review-section-title">{title}</span>
        <Pencil size={12} />
      </button>
    );
  }

  function StaticLine({ label, detail, amount, discount, pending }) {
    const discLbl = discountLabel(amount, discount);
    return (
      <div className="budget-review-line">
        <div className="brl-main">
          <span className="brl-label">{label || <span style={{ color: 'var(--color-mid-gray)' }}>Untitled</span>}</span>
          {detail && <span className="brl-detail">{detail}</span>}
        </div>
        <div className="brl-right">
          {pending
            ? <span className="brl-amount" style={{ color: 'var(--color-mid-gray)', fontStyle: 'italic' }}>TBC</span>
            : <span className="brl-amount"><Private>{fmt(amount)}</Private></span>}
          {!pending && discLbl && <span className="brl-disc"><Private>{discLbl}</Private></span>}
        </div>
      </div>
    );
  }

  function ProviderToggle() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', padding: '10px 14px', background: 'var(--overlay-01)', borderRadius: '10px', border: '1px solid var(--color-hairline)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flex: 1 }}>
          <div
            onClick={() => f('show_providers', !info.show_providers)}
            style={{
              width: '38px', height: '22px', borderRadius: '18px', flexShrink: 0,
              background: info.show_providers ? 'var(--accent)' : 'var(--surface-input-fill)',
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute', top: '3px',
              left: info.show_providers ? '19px' : '3px',
              width: '16px', height: '16px', borderRadius: '50%',
              background: 'var(--surface-card)', transition: 'left 0.2s',
              boxShadow: '0 1px 4px var(--overlay-06)',
            }} />
          </div>
          <span style={{ fontSize: '13px', color: 'var(--color-ink-soft)' }}>Show provider names on PDF</span>
        </label>
        <span style={{ fontSize: '11px', color: 'var(--color-mid-gray)' }}>{info.show_providers ? 'ON' : 'OFF'}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="card card-pad" style={{ marginBottom: '20px', background: 'var(--color-surface-alt)' }}>
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

      {/* Section 01: Crew */}
      <div className="budget-review-section">
        <SectionHeader title="01 · CREW COST" step={1} />
        {crewLines.length === 0 ? (
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px', fontStyle: 'italic', padding: '8px 0' }}>No crew lines added.</div>
        ) : (
          <>
            {crewLines.map(line => (
              <StaticLine
                key={line._id}
                label={line.position_label}
                detail={isFlatFee ? null : <>{line.days} × <Private>{fmt(line.rate)}</Private></>}
                amount={line.amount}
                discount={line.discount}
                pending={line.price_pending}
              />
            ))}
            <div className="budget-subtotal-row"><span>Section subtotal</span><span><Private>{fmt(crewSubtotal)}</Private></span></div>
          </>
        )}
      </div>

      {/* Section 02: Assets & Rentals */}
      {hasEquipment && (
        <div className="budget-review-section">
          <SectionHeader title="02 · ASSETS & RENTALS" step={2} />
          <ProviderToggle />
          {equipLines.length === 0 ? (
            <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px', fontStyle: 'italic', padding: '8px 0' }}>No equipment lines added.</div>
          ) : (
            <>
              {equipLines.map(line => {
                const amt = (parseFloat(line.days) || 0) * (parseFloat(line.rate) || 0);
                const rateDetail = <>{line.days} × <Private>{fmt(line.rate)}</Private></>;
                const detail = line.provider_name ? <>{line.provider_name} · {rateDetail}</> : rateDetail;
                return (
                  <StaticLine
                    key={line._id}
                    label={line.position_label}
                    detail={detail}
                    amount={amt}
                    discount={line.discount}
                    pending={line.price_pending}
                  />
                );
              })}
              <div className="budget-subtotal-row"><span>Section subtotal</span><span><Private>{fmt(equipSubtotal)}</Private></span></div>
            </>
          )}
        </div>
      )}

      {/* Section 03: Logistical */}
      {hasLogistics && (
        <div className="budget-review-section">
          <SectionHeader title="03 · LOGISTICAL COSTS" step={3} />
          {logLines.length === 0 ? (
            <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px', fontStyle: 'italic', padding: '8px 0' }}>No logistical lines added.</div>
          ) : (
            <>
              {logLines.map(line => (
                <StaticLine
                  key={line._id}
                  label={line.position_label}
                  detail={line.description || null}
                  amount={line.amount}
                  discount={line.discount}
                  pending={line.price_pending}
                />
              ))}
              <div className="budget-subtotal-row"><span>Section subtotal</span><span><Private>{fmt(logSubtotal)}</Private></span></div>
            </>
          )}
        </div>
      )}

      {/* Totals + VAT */}
      <div className="budget-review-section budget-totals-block">
        <div className="fin-row" style={{ paddingTop: '12px' }}>
          <span className="text-2">Subtotal</span>
          <span style={{ fontWeight: 600 }}><Private>{fmt(grossSubtotal)}</Private></span>
        </div>

        {totalDiscount > 0 && (
          <div className="fin-row" style={{ color: 'var(--color-ember)' }}>
            <span style={{ fontSize: '13px' }}>
              Discount
              {grossSubtotal > 0 && (
                <span style={{ fontSize: '11px', marginLeft: '6px', opacity: 0.8 }}>
                  (−{((totalDiscount / grossSubtotal) * 100).toFixed(1)}%)
                </span>
              )}
            </span>
            <span style={{ fontWeight: 600 }}>−<Private>{fmt(totalDiscount)}</Private></span>
          </div>
        )}

        <div className="fin-row">
          <span className="text-2">Net Subtotal</span>
          <span style={{ fontWeight: 600 }}><Private>{fmt(netSubtotal)}</Private></span>
        </div>

        <div className="fin-row" style={{ alignItems: 'flex-start' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--color-mid-gray)' }}>
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
              <span style={{ fontWeight: 600, color: 'var(--color-mid-gray)', fontSize: '13px' }}><Private>{fmt(vatAmount)}</Private></span>
            </div>
          )}
        </div>

        <div className="fin-row total" style={{ borderTop: '1px solid var(--color-hairline)', marginTop: '6px', paddingTop: '12px', fontSize: '18px' }}>
          <span>TOTAL</span>
          <span style={{ background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            <Private>{fmt(grandTotal)}</Private>
          </span>
        </div>
      </div>

      {/* Notes: the one notes field, printed on the client PDF. */}
      <div className="form-row" style={{ marginTop: '20px' }}>
        <label className="form-label">Client notes (printed on the estimate PDF, visible to the client)</label>
        <textarea className="input" rows={3} value={info.notes} onChange={e => setInfo(p => ({ ...p, notes: e.target.value }))} placeholder="Any notes the client should see on the estimate..." />
      </div>
    </div>
  );
}
