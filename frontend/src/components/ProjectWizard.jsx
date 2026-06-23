import React, { useEffect, useState, useRef } from 'react';
import { X, Plus, Check, Search, SkipForward } from 'lucide-react';
import { api } from '../api';
import { getTasksForCategory } from '../data/projectTasks';

/* ---- Nominatim Location Picker ---- */
export function LocationPicker({ value, lat, lng, onChange }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleInput(val) {
    setQuery(val);
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&limit=5`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch (_) {}
      setLoading(false);
    }, 500);
  }

  function select(item) {
    setQuery(item.display_name);
    setOpen(false);
    setResults([]);
    onChange({
      location_name: item.display_name,
      location_lat: parseFloat(item.lat),
      location_lng: parseFloat(item.lon),
    });
  }

  function clearLocation() {
    setQuery('');
    setResults([]);
    setOpen(false);
    onChange({ location_name: '', location_lat: null, location_lng: null });
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666', pointerEvents: 'none' }} />
        <input
          className="input"
          style={{ paddingLeft: '34px', paddingRight: lat ? '34px' : '12px' }}
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search location..."
        />
        {lat && (
          <button
            type="button"
            onClick={clearLocation}
            style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: '2px' }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {lat && (
        <div style={{ fontSize: '11px', color: '#4CAF50', marginTop: '4px' }}>
          ✓ Location saved ({parseFloat(lat).toFixed(4)}, {parseFloat(lng).toFixed(4)})
        </div>
      )}
      {loading && <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>Searching...</div>}
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 2000,
          background: '#242424', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}>
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => select(r)}
              style={{
                padding: '10px 14px', cursor: 'pointer', fontSize: '12px', color: '#e0e0e0',
                borderBottom: i < results.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(199,255,46,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {r.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PHASES = ['Development', 'Pre-Production', 'Production', 'Post-Production'];
const STEP_LABELS = ['Project Info', 'Development', 'Pre-Production', 'Production', 'Post-Production', 'Review'];

const FOCUS_TO_GROUP = {
  video: 'Video Production',
  photography: 'Photography',
  post: 'Post Production',
  design: 'Branding & Digital',
  animation: 'Animation & Motion',
};

function getDefaultSkippedPhases(profile) {
  if (!profile || !profile.identity) return new Set();
  if (profile.identity === 'agency') return new Set();
  const focus = Array.isArray(profile.focus) ? profile.focus : [];
  if (focus.length === 0) return new Set();
  const hasShootFocus = focus.includes('video') || focus.includes('photography');
  const hasPostFocus = focus.includes('post') || focus.includes('animation');
  if (hasPostFocus && !hasShootFocus) return new Set(['Development', 'Production']);
  return new Set();
}

function initTasksFromOptions(options) {
  return options.map(t => ({ title: t, included: true, crew_id: '' }));
}

export default function ProjectWizard({ onClose, onCreated, prefill }) {
  const [step, setStep] = useState(0);
  const [clients, setClients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [crewList, setCrewList] = useState([]);
  const [showNewClient, setShowNewClient] = useState(false);
  const [showNewCrew, setShowNewCrew] = useState(false);

  const [basicInfo, setBasicInfo] = useState({
    title: '',
    client_id: prefill?.client_id ? String(prefill.client_id) : '',
    category_id: prefill?.category_id ? String(prefill.category_id) : '',
    client_budget: '', agreed_budget: '',
    shoot_date: '', shoot_days: '1',
    shoot_start_time: '', shoot_end_time: '',
    location_name: '', location_lat: null, location_lng: null,
    notes: prefill?.note || '',
  });

  const [phaseTasks, setPhaseTasks] = useState({
    'Development': [], 'Pre-Production': [], 'Production': [], 'Post-Production': [],
  });

  // Set of phase names the user has chosen to skip
  const [skippedPhases, setSkippedPhases] = useState(new Set());
  const [profile, setProfile] = useState(null);

  // Custom task suggestions from memory, grouped by phase name
  const [customSuggestions, setCustomSuggestions] = useState({});

  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/clients'), api.get('/settings/project-categories'), api.get('/crew')])
      .then(([cl, ca, cr]) => { setClients(cl); setCategories(ca); setCrewList(cr.filter(c => !c.archived)); });
    api.get('/settings/profile').then(p => {
      setProfile(p);
      setSkippedPhases(getDefaultSkippedPhases(p));
    }).catch(() => {});
  }, []);

  // Rebuild task options whenever category or shoot_days changes
  useEffect(() => {
    if (!basicInfo.category_id) {
      setCustomSuggestions({});
      return;
    }
    const cat = categories.find(c => c.id === parseInt(basicInfo.category_id));
    if (!cat) return;
    const tasksByPhase = getTasksForCategory(cat.name, parseInt(basicInfo.shoot_days) || 1);
    setPhaseTasks({
      'Development': initTasksFromOptions(tasksByPhase['Development']),
      'Pre-Production': initTasksFromOptions(tasksByPhase['Pre-Production']),
      'Production': initTasksFromOptions(tasksByPhase['Production']),
      'Post-Production': initTasksFromOptions(tasksByPhase['Post-Production']),
    });

    // Fetch remembered custom tasks for this category
    api.get(`/projects/custom-task-suggestions?category=${encodeURIComponent(cat.name)}`)
      .then(rows => {
        const grouped = {};
        rows.forEach(r => {
          grouped[r.phase_name] = grouped[r.phase_name] || [];
          grouped[r.phase_name].push(r.task_title);
        });
        setCustomSuggestions(grouped);
      })
      .catch(() => {});
  }, [basicInfo.category_id, basicInfo.shoot_days, categories]);

  function bInfo(k, v) { setBasicInfo(p => ({ ...p, [k]: v })); }

  function toggleSkip(phase) {
    setSkippedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  }

  function toggleTask(phase, idx) {
    setPhaseTasks(prev => ({
      ...prev,
      [phase]: prev[phase].map((t, i) => i === idx ? { ...t, included: !t.included } : t),
    }));
  }

  function setTaskCrew(phase, idx, crewId) {
    setPhaseTasks(prev => ({
      ...prev,
      [phase]: prev[phase].map((t, i) => i === idx ? { ...t, crew_id: crewId } : t),
    }));
  }

  function addCustomTask(phase, title) {
    if (!title.trim()) return;
    setPhaseTasks(prev => ({
      ...prev,
      [phase]: [...prev[phase], { title: title.trim(), included: true, crew_id: '', isCustom: true }],
    }));
  }

  function removeCustomTask(phase, idx) {
    setPhaseTasks(prev => ({
      ...prev,
      [phase]: prev[phase].filter((_, i) => i !== idx),
    }));
  }

  function goNext() {
    if (step === 0 && !basicInfo.title.trim()) { setErr('Project title is required'); return; }
    setErr('');
    setStep(s => s + 1);
  }

  const activePhases = PHASES.filter(p => !skippedPhases.has(p));

  async function handleSubmit() {
    if (activePhases.length === 0) {
      setErr('At least one phase must be included');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const { id, phases } = await api.post('/projects', {
        title: basicInfo.title.trim(),
        client_id: basicInfo.client_id || null,
        category_id: basicInfo.category_id || null,
        client_budget: parseFloat(basicInfo.client_budget) || 0,
        agreed_budget: parseFloat(basicInfo.agreed_budget) || 0,
        notes: basicInfo.notes || null,
        shoot_date: basicInfo.shoot_date || null,
        shoot_days: parseInt(basicInfo.shoot_days) || 1,
        shoot_start_time: basicInfo.shoot_start_time || null,
        shoot_end_time: basicInfo.shoot_end_time || null,
        location_name: basicInfo.location_name || null,
        location_lat: basicInfo.location_lat || null,
        location_lng: basicInfo.location_lng || null,
        phases: activePhases,
      });

      const tasks = [];
      activePhases.forEach(phaseName => {
        const phase = phases.find(p => p.phase_name === phaseName);
        if (!phase) return;
        (phaseTasks[phaseName] || []).filter(t => t.included).forEach(t => {
          tasks.push({ phase_id: phase.id, title: t.title, assigned_crew_id: t.crew_id || null });
        });
      });

      if (tasks.length > 0) {
        await api.post(`/projects/${id}/tasks/batch`, { tasks });
      }

      // Save custom tasks to memory
      const cat = categories.find(c => c.id === parseInt(basicInfo.category_id));
      if (cat) {
        const customItems = [];
        activePhases.forEach(phaseName => {
          (phaseTasks[phaseName] || [])
            .filter(t => t.isCustom && t.included)
            .forEach(t => {
              customItems.push({ category_name: cat.name, phase_name: phaseName, task_title: t.title });
            });
        });
        if (customItems.length > 0) {
          await api.post('/projects/custom-task-suggestions', { items: customItems }).catch(() => {});
        }
      }

      onCreated(id);
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  }

  async function createClient(form) {
    const data = await api.post('/clients', form);
    const updated = await api.get('/clients');
    setClients(updated);
    bInfo('client_id', String(data.id));
    setShowNewClient(false);
  }

  async function createCrew(form) {
    const data = await api.post('/crew', form);
    const updated = await api.get('/crew');
    setCrewList(updated.filter(c => !c.archived));
    setShowNewCrew(false);
    return data.id;
  }

  const grouped = categories.reduce((acc, c) => {
    acc[c.group_name] = acc[c.group_name] || [];
    acc[c.group_name].push(c);
    return acc;
  }, {});

  const currentPhase = PHASES[step - 1];

  return (
    <div className="wizard-overlay">
      <div className="wizard-box">
        {/* Header */}
        <div className="wizard-header">
          <span className="wizard-title">New Project</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Step indicator */}
        <div className="wizard-steps">
          {STEP_LABELS.map((label, i) => {
            const phaseForStep = PHASES[i - 1];
            const isSkipped = phaseForStep && skippedPhases.has(phaseForStep);
            return (
              <React.Fragment key={i}>
                <div className={`wizard-step-item ${i === step ? 'current' : i < step ? 'done' : ''} ${isSkipped ? 'skipped' : ''}`}>
                  <div className="wizard-step-dot" style={isSkipped ? { background: '#333', borderColor: '#444' } : {}}>
                    {isSkipped ? <X size={10} style={{ color: '#666' }} /> : i < step ? <Check size={10} /> : <span>{i + 1}</span>}
                  </div>
                  <span className="wizard-step-label" style={isSkipped ? { color: '#555' } : {}}>{label}</span>
                </div>
                {i < STEP_LABELS.length - 1 && <div className="wizard-step-connector" />}
              </React.Fragment>
            );
          })}
        </div>

        {/* Content */}
        <div className="wizard-content">
          {step === 0 && (
            <StepBasicInfo
              form={basicInfo} setForm={bInfo}
              clients={clients} grouped={grouped}
              onAddClient={() => setShowNewClient(true)}
              profile={profile}
            />
          )}
          {step >= 1 && step <= 4 && (
            <PhaseTaskStep
              phaseName={currentPhase}
              tasks={phaseTasks[currentPhase] || []}
              onToggle={(idx) => toggleTask(currentPhase, idx)}
              onCrewChange={(idx, id) => setTaskCrew(currentPhase, idx, id)}
              onAddCustom={(title) => addCustomTask(currentPhase, title)}
              onRemoveCustom={(idx) => removeCustomTask(currentPhase, idx)}
              crewList={crewList}
              onAddCrew={() => setShowNewCrew(true)}
              skipped={skippedPhases.has(currentPhase)}
              onSkip={() => toggleSkip(currentPhase)}
              memorySuggestions={customSuggestions[currentPhase] || []}
            />
          )}
          {step === 5 && (
            <StepReview
              basicInfo={basicInfo} phaseTasks={phaseTasks}
              clients={clients} categories={categories}
              skippedPhases={skippedPhases}
            />
          )}
        </div>

        {err && <div className="error-msg" style={{ padding: '0 24px 4px' }}>{err}</div>}

        {/* Footer */}
        <div className="wizard-footer">
          <button className="btn btn-ghost" onClick={step === 0 ? onClose : () => { setErr(''); setStep(s => s - 1); }}>
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          <div style={{ flex: 1 }} />
          {step < 5 ? (
            <button className="btn btn-primary" onClick={goNext}>Next →</button>
          ) : (
            <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || activePhases.length === 0}>
              {saving ? 'Creating...' : 'Create Project'}
            </button>
          )}
        </div>
      </div>

      {showNewClient && <InlineClientModal onClose={() => setShowNewClient(false)} onSave={createClient} />}
      {showNewCrew && <InlineCrewModal onClose={() => setShowNewCrew(false)} onSave={createCrew} />}
    </div>
  );
}

/* ---- Step 1: Basic Info ---- */
function StepBasicInfo({ form, setForm, clients, grouped, onAddClient, profile }) {
  const focusGroups = (profile?.focus?.length > 0)
    ? [...new Set(profile.focus.map(f => FOCUS_TO_GROUP[f]).filter(Boolean))]
    : [];
  const otherGroups = Object.keys(grouped).filter(g => !focusGroups.includes(g));

  return (
    <div>
      <div className="form-row">
        <label className="form-label">Project Title *</label>
        <input className="input" value={form.title} onChange={e => setForm('title', e.target.value)} placeholder="Project title" autoFocus />
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Client</label>
          <select className="select" value={form.client_id} onChange={e => {
            if (e.target.value === '__add__') { setForm('client_id', form.client_id); return; }
            setForm('client_id', e.target.value);
          }}>
            <option value="">No client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
            <option value="__add__" disabled>──────────</option>
            <option value="__add__" onMouseDown={e => { e.preventDefault(); onAddClient(); }}>+ Add New Client</option>
          </select>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '6px', fontSize: '11px' }} onClick={onAddClient}>
            <Plus size={11} /> Add New Client
          </button>
        </div>
        <div className="form-row">
          <label className="form-label">Category</label>
          <select className="select" value={form.category_id} onChange={e => setForm('category_id', e.target.value)}>
            <option value="">No category</option>
            {focusGroups.length > 0 ? (
              <>
                {focusGroups.map(g => (grouped[g] || []).length > 0 && (
                  <optgroup key={g} label={g}>
                    {(grouped[g] || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
                {otherGroups.length > 0 && (
                  <optgroup label="Other">
                    {otherGroups.flatMap(g => (grouped[g] || []).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    )))}
                  </optgroup>
                )}
              </>
            ) : (
              Object.entries(grouped).map(([g, cats]) => (
                <optgroup key={g} label={g}>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
              ))
            )}
          </select>
        </div>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Client Budget (€)</label>
          <input type="number" className="input" value={form.client_budget} onChange={e => setForm('client_budget', e.target.value)} placeholder="0.00" />
        </div>
        <div className="form-row">
          <label className="form-label">Agreed Budget (€)</label>
          <input type="number" className="input" value={form.agreed_budget} onChange={e => setForm('agreed_budget', e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Shoot Date</label>
          <input type="date" className="input" value={form.shoot_date} onChange={e => setForm('shoot_date', e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Shoot Days</label>
          <input type="number" min="1" max="30" className="input" value={form.shoot_days} onChange={e => setForm('shoot_days', e.target.value)} />
        </div>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Shoot Start Time</label>
          <input type="time" className="input" value={form.shoot_start_time} onChange={e => setForm('shoot_start_time', e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Shoot End Time</label>
          <input type="time" className="input" value={form.shoot_end_time} onChange={e => setForm('shoot_end_time', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Shoot Location</label>
        <LocationPicker
          value={form.location_name}
          lat={form.location_lat}
          lng={form.location_lng}
          onChange={loc => {
            setForm('location_name', loc.location_name);
            setForm('location_lat', loc.location_lat);
            setForm('location_lng', loc.location_lng);
          }}
        />
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => setForm('notes', e.target.value)} placeholder="Project notes..." />
      </div>
    </div>
  );
}

/* ---- Phase task selection step ---- */
export function PhaseTaskStep({ phaseName, tasks, onToggle, onCrewChange, onAddCustom, onRemoveCustom, crewList, onAddCrew, skipped, onSkip, memorySuggestions }) {
  const [customInput, setCustomInput] = useState('');

  function addCustom() {
    if (!customInput.trim()) return;
    onAddCustom(customInput.trim());
    setCustomInput('');
  }

  // Memory suggestions not already in the task list
  const availableMemorySuggestions = (memorySuggestions || []).filter(
    title => !tasks.some(t => t.title === title)
  );

  if (skipped) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span className="section-title" style={{ color: '#555' }}>{phaseName} Phase</span>
          {onSkip && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={onSkip}
              style={{ fontSize: '11px', color: '#888' }}
            >
              Restore phase
            </button>
          )}
        </div>
        <div style={{
          padding: '24px', textAlign: 'center', borderRadius: '12px',
          background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)',
        }}>
          <SkipForward size={20} style={{ color: '#444', marginBottom: '8px' }} />
          <div className="text-2 text-sm">This phase will be skipped</div>
          <div className="text-xs text-2" style={{ marginTop: '4px' }}>No phase or tasks will be created for {phaseName}</div>
        </div>
      </div>
    );
  }

  const hasOptions = tasks.length > 0;

  return (
    <div>
      <div className="wizard-phase-header">
        <div>
          <span className="section-title">{phaseName} Phase</span>
          <span className="text-xs text-2" style={{ marginLeft: '10px' }}>{tasks.filter(t => t.included).length} / {tasks.length} selected</span>
        </div>
        {onSkip && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={onSkip}
            style={{ fontSize: '11px', color: '#666' }}
          >
            <SkipForward size={12} /> Skip phase
          </button>
        )}
      </div>

      {!hasOptions && (
        <div className="text-2 text-sm" style={{ padding: '16px 0', fontStyle: 'italic' }}>
          No standard tasks for this phase. Add custom tasks below.
        </div>
      )}

      <div className="task-select-grid">
        {tasks.map((task, idx) => (
          <div key={idx} className={`task-select-card ${task.included ? 'selected' : ''}`}>
            <div className="task-select-top">
              <label className="task-select-check" onClick={() => onToggle(idx)}>
                <div className={`task-card-checkbox ${task.included ? 'checked' : ''}`}>
                  {task.included && <Check size={10} color="#fff" />}
                </div>
                <span className="task-select-name">{task.title}</span>
              </label>
              {task.isCustom && (
                <button className="btn btn-danger btn-sm" style={{ padding: '2px 6px' }} onClick={() => onRemoveCustom(idx)}>
                  <X size={11} />
                </button>
              )}
            </div>
            {task.included && (
              <div className="task-select-crew">
                <select className="select" style={{ fontSize: '11px', padding: '5px 8px' }}
                  value={task.crew_id}
                  onChange={e => {
                    if (e.target.value === '__add__') { if (onAddCrew) onAddCrew(); return; }
                    onCrewChange(idx, e.target.value);
                  }}>
                  <option value="">Unassigned</option>
                  {crewList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Memory suggestions */}
      {availableMemorySuggestions.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div className="text-xs text-2" style={{ marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your tasks</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {availableMemorySuggestions.map((title, i) => (
              <button
                key={i}
                onClick={() => onAddCustom(title)}
                style={{
                  background: 'rgba(255,144,47,0.08)', border: '1px solid rgba(255,144,47,0.25)',
                  borderRadius: '50px', padding: '4px 12px', fontSize: '11px', color: '#c97b30',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                }}
              >
                <Plus size={10} /> {title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="task-custom-add">
        <input
          className="input"
          placeholder="+ Add custom task..."
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addCustom()}
          style={{ flex: 1 }}
        />
        <button className="btn btn-ghost btn-sm" onClick={addCustom}><Plus size={13} /></button>
      </div>
    </div>
  );
}

/* ---- Review step ---- */
function StepReview({ basicInfo, phaseTasks, clients, categories, skippedPhases }) {
  const client = clients.find(c => c.id === parseInt(basicInfo.client_id));
  const cat = categories.find(c => c.id === parseInt(basicInfo.category_id));
  const activePhases = PHASES.filter(p => !skippedPhases.has(p));
  const totalTasks = activePhases.reduce((s, phase) => s + (phaseTasks[phase] || []).filter(t => t.included).length, 0);

  return (
    <div>
      <div className="section-title" style={{ marginBottom: '12px' }}>Project Summary</div>
      <div className="card card-pad" style={{ marginBottom: '16px' }}>
        <div className="fin-row"><span className="text-2">Title</span><span className="text-bold">{basicInfo.title}</span></div>
        {client && <div className="fin-row"><span className="text-2">Client</span><span>{client.name}</span></div>}
        {cat && <div className="fin-row"><span className="text-2">Category</span><span>{cat.name}</span></div>}
        {basicInfo.agreed_budget && <div className="fin-row"><span className="text-2">Agreed Budget</span><span>€{parseFloat(basicInfo.agreed_budget).toFixed(2)}</span></div>}
        {basicInfo.shoot_date && <div className="fin-row"><span className="text-2">Shoot Date</span><span>{basicInfo.shoot_date}</span></div>}
        {basicInfo.location_name && <div className="fin-row"><span className="text-2">Location</span><span style={{ maxWidth: '200px', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{basicInfo.location_name}</span></div>}
        <div className="fin-row"><span className="text-2">Phases</span><span>{activePhases.length} of 4{skippedPhases.size > 0 ? ` (${[...skippedPhases].join(', ')} skipped)` : ''}</span></div>
        <div className="fin-row"><span className="text-2">Total Tasks</span><span>{totalTasks} tasks across {activePhases.filter(p => (phaseTasks[p] || []).some(t => t.included)).length} phases</span></div>
      </div>

      {activePhases.map(phase => {
        const selected = (phaseTasks[phase] || []).filter(t => t.included);
        if (selected.length === 0) return (
          <div key={phase} style={{ marginBottom: '10px' }}>
            <div className="text-xs text-2" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{phase}</div>
            <div className="text-xs text-2" style={{ fontStyle: 'italic' }}>No tasks selected</div>
          </div>
        );
        return (
          <div key={phase} style={{ marginBottom: '12px' }}>
            <div className="text-xs text-2" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{phase}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {selected.map((t, i) => (
                <span key={i} style={{ background: 'rgba(199,255,46,0.10)', border: '1px solid rgba(199,255,46,0.25)', borderRadius: '50px', padding: '3px 10px', fontSize: '11px', color: 'var(--accent)' }}>{t.title}</span>
              ))}
            </div>
          </div>
        );
      })}

      {skippedPhases.size > 0 && [...skippedPhases].map(phase => (
        <div key={phase} style={{ marginBottom: '10px', opacity: 0.4 }}>
          <div className="text-xs" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px', color: '#555' }}>{phase} — skipped</div>
        </div>
      ))}

      {activePhases.length === 0 && (
        <div className="error-msg">No phases selected — at least one phase is required.</div>
      )}
    </div>
  );
}

/* ---- Inline Client Creator ---- */
function InlineClientModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', company: '', phone: '', email: '', socials: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.name.trim()) { setErr('Name required'); return; }
    setSaving(true);
    try { await onSave(form); }
    catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="modal-title">New Client</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="form-row">
          <label className="form-label">Name *</label>
          <input className="input" value={form.name} onChange={e => f('name', e.target.value)} placeholder="Full name" autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">Company</label>
          <input className="input" value={form.company} onChange={e => f('company', e.target.value)} />
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label className="form-label">Phone</label>
            <input className="input" value={form.phone} onChange={e => f('phone', e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label">Email</label>
            <input type="email" className="input" value={form.email} onChange={e => f('email', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <label className="form-label">Social Media</label>
          <input className="input" value={form.socials} onChange={e => f('socials', e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Notes</label>
          <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} />
        </div>
        {err && <div className="error-msg">{err}</div>}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Create & Select'}</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Inline Crew Creator ---- */
export function InlineCrewModal({ onClose, onSave, roles: externalRoles }) {
  const [roles, setRoles] = useState(externalRoles || []);
  const [isCompany, setIsCompany] = useState(false);
  const [form, setForm] = useState({ name: '', role: '', phone: '', email: '', location: '', day_rate: '', notes: '', service_type: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!externalRoles) api.get('/crew/roles').then(setRoles).catch(() => {});
  }, [externalRoles]);

  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.name.trim()) { setErr('Name required'); return; }
    setSaving(true);
    try {
      await onSave({ ...form, is_company: isCompany, day_rate: parseFloat(form.day_rate) || 0 });
    } catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="modal-title">New Crew Member</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="form-row">
          <div className="toggle-group">
            <button type="button" className={`toggle-btn ${!isCompany ? 'active' : ''}`} onClick={() => setIsCompany(false)}>Individual</button>
            <button type="button" className={`toggle-btn ${isCompany ? 'active' : ''}`} onClick={() => setIsCompany(true)}>Company</button>
          </div>
        </div>
        <div className="form-row">
          <label className="form-label">{isCompany ? 'Company Name *' : 'Name *'}</label>
          <input className="input" value={form.name} onChange={e => f('name', e.target.value)} autoFocus />
        </div>
        {isCompany ? (
          <div className="form-row">
            <label className="form-label">Service Type</label>
            <input className="input" value={form.service_type} onChange={e => f('service_type', e.target.value)} placeholder="e.g. Rental House, Catering..." />
          </div>
        ) : (
          <div className="form-grid">
            <div className="form-row">
              <label className="form-label">Role</label>
              <select className="select" value={form.role} onChange={e => f('role', e.target.value)}>
                <option value="">Select role</option>
                {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">{isCompany ? 'Rate (€)' : 'Day Rate (€)'}</label>
              <input type="number" className="input" value={form.day_rate} onChange={e => f('day_rate', e.target.value)} placeholder="0.00" />
            </div>
          </div>
        )}
        {isCompany && (
          <div className="form-row">
            <label className="form-label">Rate (€)</label>
            <input type="number" className="input" value={form.day_rate} onChange={e => f('day_rate', e.target.value)} placeholder="0.00" />
          </div>
        )}
        <div className="form-grid">
          <div className="form-row">
            <label className="form-label">Phone</label>
            <input className="input" value={form.phone} onChange={e => f('phone', e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label">Email</label>
            <input type="email" className="input" value={form.email} onChange={e => f('email', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <label className="form-label">Location</label>
          <input className="input" value={form.location} onChange={e => f('location', e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Notes</label>
          <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} />
        </div>
        {err && <div className="error-msg">{err}</div>}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Create & Select'}</button>
        </div>
      </div>
    </div>
  );
}
