import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Plus, X, Trash2, GripVertical, ChevronDown, ChevronRight, Copy,
  Globe, EyeOff, Link2, Check, Settings2, MapPin, KeyRound, FileText, Image as ImageIcon,
  Upload, Loader2, Wand2, History, RotateCcw, Sun,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from '../components/Modal';
import LocationPicker from '../components/LocationPicker';
import OpusPolish, { useAiPolishAvailable } from '../components/OpusPolish';
import { api, fmtDate } from '../api';

const SHOT_TYPES = [
  'Wide', 'Medium', 'Close-up', 'Detail', 'Portrait', 'Group', 'Product',
  'Landscape', 'Overhead', 'Motion', 'Behind the scenes',
];

function thumbFor(m) {
  const name = m.thumb_filename || m.filename;
  return name ? `/s-media/${name}` : null;
}

// ── Small field primitives, matching the pitch builder's shapes ──────────────

function Field({ label, children, style }) {
  return (
    <div className="form-row" style={{ marginBottom: '10px', ...style }}>
      <label className="form-label" style={{ fontSize: '11px' }}>{label}</label>
      {children}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, textarea, polish, aiEnabled }) {
  const [loading, setLoading] = useState(false);
  return (
    <Field label={label}>
      {textarea ? (
        <textarea className="input" rows={3} value={value || ''} disabled={loading}
          onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input className="input" value={value || ''} disabled={loading}
          onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      )}
      {polish && (
        <OpusPolish enabled={aiEnabled} value={value} onChange={onChange} loading={loading} setLoading={setLoading} />
      )}
    </Field>
  );
}

function SelectField({ label, value, onChange, options, style }) {
  return (
    <Field label={label} style={style}>
      <select className="select" style={{ width: '100%' }} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

// ── Shot media picker (reference / scout) ────────────────────────────────────

function MediaPicker({ shot, kind, onChanged }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const items = (shot.media || []).filter(m => m.kind === kind);

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('image', file);
        const res = await api.postForm('/shotlists/upload', fd);
        await api.post(`/shotlists/${shot.shotlist_id}/shots/${shot.id}/media`, {
          kind, filename: res.filename, thumb_filename: res.thumb,
        });
      }
      await onChanged();
    } catch (err) {
      alert(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function remove(m) {
    try {
      await api.del(`/shotlists/${shot.shotlist_id}/media/${m.id}`);
      await onChanged();
    } catch (err) { alert(err.message || 'Could not remove the image'); }
  }

  return (
    <Field label={`${kind === 'scout' ? 'Scout' : 'Reference'} photos (${items.length})`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {items.map(m => (
          <div key={m.id} style={{ position: 'relative' }}>
            <img src={thumbFor(m)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border-default)' }} />
            <button
              type="button"
              onClick={() => remove(m)}
              title="Remove"
              style={{
                position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                background: 'var(--danger)', border: 'none', color: 'var(--accent-contrast)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          style={{
            width: 56, height: 56, borderRadius: 6, border: '1px dashed var(--border-default)',
            background: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {uploading ? <Loader2 size={15} className="pitch-spin" /> : <Plus size={15} />}
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple
          style={{ display: 'none' }} onChange={handleFiles} />
      </div>
    </Field>
  );
}

// ── One sortable shot ────────────────────────────────────────────────────────

function SortableShot({
  shot, index, expanded, onToggle, onChange, onDelete, onDuplicate,
  locations, windows, aiEnabled, onMediaChanged,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: shot.id });
  const windowOptions = (shot.space === 'interior' ? windows.interior : windows.exterior) || [];

  return (
    <div
      ref={setNodeRef}
      className="card"
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 999 : undefined,
        position: 'relative', padding: 0, overflow: 'visible',
      }}
      {...attributes}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', cursor: 'pointer' }}
        onClick={() => onToggle(shot.id)}>
        <span
          {...listeners}
          onClick={e => e.stopPropagation()}
          title="Drag to reorder"
          style={{ cursor: isDragging ? 'grabbing' : 'grab', color: 'var(--text-muted)', touchAction: 'none', display: 'flex', padding: '2px' }}
        >
          <GripVertical size={14} />
        </span>
        <span className="shotlist-num">{shot.shot_number || index + 1}</span>
        <span style={{ fontSize: '13px', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shot.title || 'Untitled shot'}
        </span>
        <span className="shotlist-chip">{shot.space === 'interior' ? 'INT' : 'EXT'}</span>
        {shot.light_window_label && (
          <span className={`shotlist-chip${shot.light_window_hard ? ' hard' : ''}`} title={shot.light_window_range}>
            {shot.light_window_label}
          </span>
        )}
        <button className="btn-ghost" style={{ padding: '3px 5px' }} title="Duplicate shot"
          onClick={e => { e.stopPropagation(); onDuplicate(shot); }}>
          <Copy size={12} />
        </button>
        <button className="btn-ghost" style={{ padding: '3px 5px', color: 'var(--danger)' }} title="Delete shot"
          onClick={e => { e.stopPropagation(); onDelete(shot); }}>
          <Trash2 size={12} />
        </button>
        {expanded ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
      </div>

      {expanded && (
        <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--border-subtle)' }}>
          <div className="shotlist-field-row">
            <TextField label="Shot number" value={shot.shot_number} onChange={v => onChange(shot.id, { shot_number: v })} />
            <TextField label="Title" value={shot.title} onChange={v => onChange(shot.id, { title: v })} placeholder="What is being shot" />
          </div>

          <TextField
            label="Description" value={shot.description} onChange={v => onChange(shot.id, { description: v })}
            textarea polish aiEnabled={aiEnabled} placeholder="What happens in this setup"
          />

          <div className="shotlist-field-row">
            <SelectField
              label="Shot type" value={shot.shot_type || ''} onChange={v => onChange(shot.id, { shot_type: v })}
              options={[{ value: '', label: '— none —' }, ...SHOT_TYPES.map(t => ({ value: t, label: t }))]}
            />
            <Field label="Duration (minutes)">
              <input className="input" type="number" min="5" step="5" value={shot.duration_minutes || 30}
                onChange={e => onChange(shot.id, { duration_minutes: Number(e.target.value) })} />
            </Field>
          </div>

          <div className="shotlist-field-row">
            <SelectField
              label="Space" value={shot.space || 'exterior'}
              onChange={v => onChange(shot.id, { space: v })}
              options={[{ value: 'interior', label: 'Interior' }, { value: 'exterior', label: 'Exterior' }]}
            />
            <SelectField
              label="Light window" value={shot.light_window || ''}
              onChange={v => onChange(shot.id, { light_window: v })}
              options={windowOptions.map(w => ({ value: w.key, label: `${w.label}${w.hard ? ' (hard)' : ''}` }))}
            />
          </div>
          {shot.light_window_range && (
            <p className="shotlist-window-note">
              <Sun size={11} /> {shot.light_window_label}: {shot.light_window_range}
              {shot.light_window_approximate ? ' — pin this shot’s location for exact times' : ''}
            </p>
          )}

          <SelectField
            label="Location" value={shot.location_id == null ? '' : String(shot.location_id)}
            onChange={v => onChange(shot.id, { location_id: v ? Number(v) : null })}
            options={[{ value: '', label: '— none —' }, ...locations.map(l => ({ value: String(l.id), label: l.name }))]}
          />

          <div className="shotlist-field-row">
            <TextField label="Talent" value={shot.talent} onChange={v => onChange(shot.id, { talent: v })} />
            <TextField label="Costume" value={shot.costume} onChange={v => onChange(shot.id, { costume: v })} />
          </div>
          <TextField label="Props" value={shot.props} onChange={v => onChange(shot.id, { props: v })} />
          <TextField
            label="Camera notes" value={shot.camera_notes} onChange={v => onChange(shot.id, { camera_notes: v })}
            textarea polish aiEnabled={aiEnabled}
          />

          <MediaPicker shot={shot} kind="reference" onChanged={onMediaChanged} />
          <MediaPicker shot={shot} kind="scout" onChanged={onMediaChanged} />
        </div>
      )}
    </div>
  );
}

// ── Locations panel ──────────────────────────────────────────────────────────

function LocationsPanel({ shotlistId, locations, onChanged }) {
  const [editing, setEditing] = useState(null); // location row or { new: true }

  function startNew() {
    setEditing({ name: '', address: '', lat: null, lng: null, notes: '' });
  }

  async function save() {
    if (!editing.name || !editing.name.trim()) { alert('Give the location a name'); return; }
    try {
      if (editing.id) await api.put(`/shotlists/${shotlistId}/locations/${editing.id}`, editing);
      else await api.post(`/shotlists/${shotlistId}/locations`, editing);
      setEditing(null);
      await onChanged();
    } catch (err) { alert(err.message || 'Could not save the location'); }
  }

  async function remove(loc) {
    if (!confirm(`Delete location "${loc.name}"? Shots using it keep their other details.`)) return;
    try {
      await api.del(`/shotlists/${shotlistId}/locations/${loc.id}`);
      await onChanged();
    } catch (err) { alert(err.message || 'Could not delete the location'); }
  }

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <MapPin size={14} color="var(--accent)" />
        <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', flex: 1 }}>
          Locations
        </span>
        <button className="btn btn-secondary btn-sm" onClick={startNew}><Plus size={13} /> Add</button>
      </div>

      {locations.length === 0 && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px' }}>
          No locations yet. Pin one so light windows and travel times are real.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {locations.map(l => (
          <div key={l.id} className="shotlist-loc-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>{l.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {l.address || 'No address'}
                {l.lat != null && l.lng != null ? ` · ${Number(l.lat).toFixed(4)}, ${Number(l.lng).toFixed(4)}` : ' · not pinned'}
              </div>
            </div>
            {l.lat != null && l.lng != null && (
              <a
                className="btn-ghost" style={{ padding: '4px 6px' }} title="Open directions"
                href={`https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`}
                target="_blank" rel="noreferrer"
              >
                <MapPin size={12} />
              </a>
            )}
            <button className="btn-ghost" style={{ padding: '4px 6px' }} title="Edit" onClick={() => setEditing({ ...l })}>
              <Settings2 size={12} />
            </button>
            <button className="btn-ghost" style={{ padding: '4px 6px', color: 'var(--danger)' }} title="Delete" onClick={() => remove(l)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit location' : 'Add location'} onClose={() => setEditing(null)}>
          <div className="form-row">
            <label className="form-label">Label *</label>
            <input className="input" value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Rugova Canyon" />
          </div>
          <div className="form-row">
            <label className="form-label">Address</label>
            <input className="input" value={editing.address || ''} onChange={e => setEditing({ ...editing, address: e.target.value })} />
          </div>
          <LocationPicker value={editing} onChange={setEditing} />
          <div className="form-row" style={{ marginTop: '10px' }}>
            <label className="form-label">Notes</label>
            <textarea className="input" rows={2} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save location</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Organize this ────────────────────────────────────────────────────────────

function OrganizePanel({ shotlistId, shots, plan, onPlanned, onApplied }) {
  const [startShotId, setStartShotId] = useState(shots.length ? String(shots[0].id) : '');
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (shots.length && !shots.some(s => String(s.id) === startShotId)) {
      setStartShotId(String(shots[0].id));
    }
  }, [shots.map(s => s.id).join(','), startShotId]);

  async function run() {
    setRunning(true); setError('');
    try {
      const res = await api.post(`/shotlists/${shotlistId}/organize`, { startShotId: Number(startShotId) });
      onPlanned(res);
    } catch (err) {
      setError(err.message || 'Could not organise the day');
    } finally {
      setRunning(false);
    }
  }

  async function apply() {
    if (!confirm('Apply the optimised order? It becomes your order. The optimised plan is kept too.')) return;
    setApplying(true);
    try {
      await api.post(`/shotlists/${shotlistId}/apply-plan`, {});
      await onApplied();
    } catch (err) {
      alert(err.message || 'Could not apply the plan');
    } finally {
      setApplying(false);
    }
  }

  const p = plan && plan.plan ? plan.plan : null;
  const c = plan && plan.comparison ? plan.comparison : null;

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <Wand2 size={14} color="var(--accent)" />
        <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', flex: 1 }}>
          Organize this
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="form-label" style={{ fontSize: '11px' }}>Start with</label>
          <select className="select" style={{ width: '100%' }} value={startShotId} onChange={e => setStartShotId(e.target.value)}>
            {shots.map(s => <option key={s.id} value={s.id}>{s.shot_number ? `${s.shot_number}. ` : ''}{s.title || 'Untitled shot'}</option>)}
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={run} disabled={running || shots.length === 0}>
          {running ? <Loader2 size={13} className="pitch-spin" /> : <Wand2 size={13} />}
          {running ? 'Planning…' : 'Organize this'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '8px' }}>{error}</p>}

      {p && (
        <div style={{ marginTop: '14px' }}>
          <div className="shotlist-mode-note">
            {p.distance_mode === 'google'
              ? 'Distances: Google road distances and durations'
              : 'Distances: straight-line estimate (no Google key configured)'}
          </div>

          {c && (
            <div className="shotlist-compare">
              <div>
                <span className="shotlist-compare-k">My order</span>
                <span>{c.current.travel_km} km · {c.current.travel_minutes} min travel · ends {c.current.end_label || '—'} · {c.current.warning_count} warning{c.current.warning_count === 1 ? '' : 's'}</span>
              </div>
              <div>
                <span className="shotlist-compare-k">Optimised</span>
                <span>{c.optimised.travel_km} km · {c.optimised.travel_minutes} min travel · ends {c.optimised.end_label || '—'} · {c.optimised.warning_count} warning{c.optimised.warning_count === 1 ? '' : 's'}</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {c.moved_count} shot{c.moved_count === 1 ? '' : 's'} move · fixes {c.fixes.length} conflict{c.fixes.length === 1 ? '' : 's'} · introduces {c.introduces.length}
              </div>
            </div>
          )}

          <div className="shotlist-plan">
            {p.rows.map(r => {
              const move = c && c.moves.find(m => m.shot_id === r.shot_id);
              return (
                <div key={r.shot_id} className="shotlist-plan-row">
                  <span className="shotlist-plan-time">{r.start_label}</span>
                  <span className="shotlist-plan-title">{r.title || 'Untitled shot'}</span>
                  <span className={`shotlist-chip${r.light_window_hard ? ' hard' : ''}`}>{r.light_window_label}</span>
                  {r.travel_out_minutes > 0 && (
                    <span className="shotlist-plan-travel">→ {r.travel_out_minutes} min / {r.travel_out_km} km</span>
                  )}
                  {move && move.moved && (
                    <span className="shotlist-plan-move">#{move.from_position} → #{move.to_position}</span>
                  )}
                </div>
              );
            })}
          </div>

          {p.warnings.length > 0 && (
            <ul className="shotlist-warnings">
              {p.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
            </ul>
          )}

          {c && c.fixes.length > 0 && (
            <div className="shotlist-fixes">
              Fixed by this plan:
              <ul>{c.fixes.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            </div>
          )}

          <button className="btn btn-secondary btn-sm" style={{ marginTop: '10px' }} onClick={apply} disabled={applying}>
            {applying ? 'Applying…' : 'Apply to my order'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main editor ──────────────────────────────────────────────────────────────

export default function ShotlistEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const aiEnabled = useAiPolishAvailable();

  const [shotlist, setShotlist] = useState(null);
  const [shots, setShots] = useState([]);
  const [locations, setLocations] = useState([]);
  const [activity, setActivity] = useState([]);
  const [plan, setPlan] = useState(null);
  const [windows, setWindows] = useState({ interior: [], exterior: [] });
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('saved');
  const [expandedId, setExpandedId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const [base, setBase] = useState({ base: window.location.origin, host: window.location.host, custom: false });

  const dirtyShots = useRef(new Map());
  const dirtyList = useRef(null);
  const saveTimer = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const load = useCallback(async () => {
    const data = await api.get(`/shotlists/${id}`);
    setShotlist(data.shotlist);
    setShots(data.shots);
    setLocations(data.locations);
    setActivity(data.activity || []);
    setPlan(data.plan || null);
    return data;
  }, [id]);

  useEffect(() => {
    load()
      .catch(() => navigate('/production/shotlists'))
      .finally(() => setLoading(false));
    api.get('/shotlists/light-windows').then(setWindows).catch(() => {});
    api.get('/shotlists/public-base').then(b => { if (b && b.base) setBase(b); }).catch(() => {});
    api.get('/projects').then(p => setProjects(Array.isArray(p) ? p : [])).catch(() => {});
  }, [id]);

  const flush = useCallback(async () => {
    const entries = [...dirtyShots.current.entries()];
    dirtyShots.current.clear();
    const listPatch = dirtyList.current;
    dirtyList.current = null;
    if (entries.length === 0 && !listPatch) return;
    try {
      for (const [shotId, patch] of entries) {
        await api.put(`/shotlists/${id}/shots/${shotId}`, patch);
      }
      if (listPatch) await api.put(`/shotlists/${id}`, listPatch);
      setSaveState('saved');
      // Light windows are resolved server-side, so pull the shots back after a
      // save that could have changed space, window or location — but only if
      // nothing new has been typed since, or the refetch would overwrite it.
      const data = await api.get(`/shotlists/${id}`);
      if (dirtyShots.current.size === 0 && !dirtyList.current) {
        setShots(data.shots);
        setShotlist(data.shotlist);
      }
    } catch (err) {
      setSaveState('error');
    }
  }, [id]);

  useEffect(() => () => { clearTimeout(saveTimer.current); flush(); }, [flush]);

  function queueSave() {
    setSaveState('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 800);
  }

  function handleShotChange(shotId, patch) {
    setShots(prev => prev.map(s => s.id === shotId ? { ...s, ...patch } : s));
    dirtyShots.current.set(shotId, { ...(dirtyShots.current.get(shotId) || {}), ...patch });
    queueSave();
  }

  function handleListChange(patch) {
    setShotlist(prev => ({ ...prev, ...patch }));
    dirtyList.current = { ...(dirtyList.current || {}), ...patch };
    queueSave();
  }

  async function addShot() {
    try {
      setSaveState('saving');
      await flush();
      const res = await api.post(`/shotlists/${id}/shots`, {});
      await load();
      setExpandedId(res.id);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      alert(err.message || 'Could not add the shot');
    }
  }

  async function duplicateShot(shot) {
    try {
      await flush();
      await api.post(`/shotlists/${id}/shots/${shot.id}/duplicate`, {});
      await load();
    } catch (err) { alert(err.message || 'Could not duplicate the shot'); }
  }

  async function deleteShot(shot) {
    if (!confirm(`Delete "${shot.title || 'this shot'}"? This cannot be undone.`)) return;
    try {
      dirtyShots.current.delete(shot.id);
      await api.del(`/shotlists/${id}/shots/${shot.id}`);
      await load();
    } catch (err) { alert(err.message || 'Could not delete the shot'); }
  }

  async function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIndex = shots.findIndex(s => s.id === active.id);
    const newIndex = shots.findIndex(s => s.id === over.id);
    const next = arrayMove(shots, oldIndex, newIndex);
    setShots(next);
    try {
      setSaveState('saving');
      await api.patch(`/shotlists/${id}/shots/reorder`, { shotIds: next.map(s => s.id) });
      setSaveState('saved');
    } catch (err) { setSaveState('error'); }
  }

  async function publish() {
    setWorking(true);
    try {
      await flush();
      const res = await api.post(`/shotlists/${id}/publish`, {});
      setShotlist(prev => ({ ...prev, status: 'published', slug: res.slug }));
    } catch (err) {
      alert(err.message || 'Could not publish');
    } finally { setWorking(false); }
  }

  async function unpublish() {
    if (!confirm('Unpublish this shot list? The crew link stops working until you publish again.')) return;
    setWorking(true);
    try {
      await api.post(`/shotlists/${id}/unpublish`, {});
      setShotlist(prev => ({ ...prev, status: 'draft' }));
    } catch (err) {
      alert(err.message || 'Could not unpublish');
    } finally { setWorking(false); }
  }

  async function resetStatuses() {
    if (!confirm('Reset every shot back to pending? Completion marks from the crew are cleared.')) return;
    try {
      await api.post(`/shotlists/${id}/reset-status`, {});
      await load();
    } catch (err) { alert(err.message || 'Could not reset the statuses'); }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading || !shotlist) return (
    <div className="page-header"><h1 className="page-title">Shot list</h1></div>
  );

  const isPublished = shotlist.status === 'published';
  const publicUrl = shotlist.slug ? `${base.base}/s/${shotlist.slug}` : null;
  const completed = shots.filter(s => s.status === 'completed').length;

  return (
    <div>
      <div className="pitch-editor-header">
        <button className="btn-ghost" style={{ padding: '6px 8px', flexShrink: 0 }} onClick={() => navigate('/production/shotlists')} title="Back to shot lists">
          <ArrowLeft size={16} />
        </button>
        <input
          className="pitch-title-input"
          value={shotlist.title || ''}
          onChange={e => handleListChange({ title: e.target.value })}
          placeholder="Shot list title"
        />
        <span className={`badge ${isPublished ? 'badge-active' : 'badge-pending'}`} style={{ flexShrink: 0 }}>{shotlist.status}</span>
        <span style={{ fontSize: '11px', color: saveState === 'error' ? 'var(--danger)' : 'var(--text-muted)', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)} title="Shot list settings">
          <Settings2 size={14} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowPasscode(true)} title="Crew passcode">
          <KeyRound size={14} /> {shotlist.has_passcode ? 'Passcode set' : 'Set passcode'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => api.download(`/shotlists/${id}/pdf/callsheet`, `Call-Sheet-${shotlist.title || 'shotlist'}.pdf`)} title="Download call sheet">
          <FileText size={14} /> Call sheet
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => api.download(`/shotlists/${id}/pdf/photoboard`, `Photo-Board-${shotlist.title || 'shotlist'}.pdf`)} title="Download photo board">
          <ImageIcon size={14} /> Photo board
        </button>
        {isPublished && (
          <button className="btn btn-secondary btn-sm" onClick={unpublish} disabled={working}>
            <EyeOff size={13} /> Unpublish
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={publish} disabled={working}>
          <Globe size={13} /> {isPublished ? 'Republish' : 'Publish'}
        </button>
      </div>

      {isPublished && publicUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '12px', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
          <Globe size={12} color="var(--success)" />
          <a href={publicUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)' }}>{publicUrl}</a>
          <button className="btn-ghost" style={{ padding: '3px 5px', color: copied ? 'var(--success)' : undefined }} onClick={() => copyText(publicUrl)} title="Copy crew link">
            {copied ? <Check size={12} /> : <Link2 size={12} />}
          </button>
          {!shotlist.has_passcode && (
            <span style={{ fontSize: '11px', color: 'var(--warning)' }}>
              No passcode: the crew can read the list but cannot tick shots off.
            </span>
          )}
        </div>
      )}

      {/* Which ordering the public page and the PDFs present */}
      <div className="shotlist-order-toggle">
        <span className="shotlist-order-label">Published ordering</span>
        <button
          className={`btn btn-sm ${shotlist.order_mode !== 'optimized' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => handleListChange({ order_mode: 'user' })}
        >
          My order
        </button>
        <button
          className={`btn btn-sm ${shotlist.order_mode === 'optimized' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => handleListChange({ order_mode: 'optimized' })}
        >
          Optimised order
        </button>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {shots.length} shot{shots.length === 1 ? '' : 's'}{completed ? ` · ${completed} complete` : ''}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowActivity(true)}>
          <History size={13} /> Activity
        </button>
        <button className="btn btn-ghost btn-sm" onClick={resetStatuses}>
          <RotateCcw size={13} /> Reset statuses
        </button>
      </div>

      <div className="shotlist-editor">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={shots.map(s => s.id)} strategy={verticalListSortingStrategy}>
              {shots.map((s, i) => (
                <SortableShot
                  key={s.id}
                  shot={s}
                  index={i}
                  expanded={expandedId === s.id}
                  onToggle={sid => setExpandedId(prev => prev === sid ? null : sid)}
                  onChange={handleShotChange}
                  onDelete={deleteShot}
                  onDuplicate={duplicateShot}
                  locations={locations}
                  windows={windows}
                  aiEnabled={aiEnabled}
                  onMediaChanged={load}
                />
              ))}
            </SortableContext>
          </DndContext>

          <button className="btn btn-secondary" style={{ justifyContent: 'center' }} onClick={addShot}>
            <Plus size={15} /> Add shot
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          <LocationsPanel shotlistId={id} locations={locations} onChanged={load} />
          <OrganizePanel
            shotlistId={id}
            shots={shots}
            plan={plan}
            onPlanned={res => setPlan({ plan: res.plan, comparison: res.comparison, current: res.current })}
            onApplied={async () => { await load(); }}
          />
        </div>
      </div>

      {showSettings && (
        <Modal title="Shot list settings" onClose={() => setShowSettings(false)}>
          <div className="form-row">
            <label className="form-label">Project</label>
            <select
              className="select" style={{ width: '100%' }}
              value={shotlist.project_id == null ? '' : String(shotlist.project_id)}
              onChange={e => {
                const value = e.target.value;
                const project = projects.find(p => String(p.id) === value);
                const patch = { project_id: value ? Number(value) : null };
                // Linking a project prefills the title and shoot date
                if (project) {
                  if (!shotlist.title || !shotlist.title.trim()) patch.title = project.title;
                  if (!shotlist.shoot_date && project.shoot_date) patch.shoot_date = String(project.shoot_date).slice(0, 10);
                }
                handleListChange(patch);
              }}
            >
              <option value="">— none —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">Shoot date</label>
              <input className="input" type="date" value={shotlist.shoot_date || ''} onChange={e => handleListChange({ shoot_date: e.target.value || null })} />
            </div>
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">Call time</label>
              <input className="input" type="time" value={shotlist.call_time || ''} onChange={e => handleListChange({ call_time: e.target.value || null })} />
            </div>
          </div>
          <NotesField value={shotlist.notes} onChange={v => handleListChange({ notes: v })} aiEnabled={aiEnabled} />
          <div className="modal-footer">
            <button className="btn btn-primary" onClick={() => setShowSettings(false)}>Done</button>
          </div>
        </Modal>
      )}

      {showPasscode && (
        <PasscodeModal
          shotlistId={id}
          hasPasscode={!!shotlist.has_passcode}
          onClose={() => setShowPasscode(false)}
          onSaved={has => setShotlist(prev => ({ ...prev, has_passcode: has }))}
        />
      )}

      {showActivity && (
        <Modal title="Activity" onClose={() => setShowActivity(false)}>
          {activity.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nothing recorded yet.</p>
          ) : (
            <div className="shotlist-activity">
              {activity.map(a => (
                <div key={a.id} className="shotlist-activity-row">
                  <span className="shotlist-activity-action">{a.action.replace(/_/g, ' ')}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{a.actor_name || 'Someone'}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{fmtDate(String(a.created_at || '').slice(0, 10))} {String(a.created_at || '').slice(11, 16)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={resetStatuses}>Reset all statuses</button>
            <button className="btn btn-primary" onClick={() => setShowActivity(false)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NotesField({ value, onChange, aiEnabled }) {
  const [loading, setLoading] = useState(false);
  return (
    <div className="form-row">
      <label className="form-label">Notes</label>
      <textarea className="input" rows={3} value={value || ''} disabled={loading} onChange={e => onChange(e.target.value)} />
      <OpusPolish enabled={aiEnabled} value={value} onChange={onChange} loading={loading} setLoading={setLoading} />
    </div>
  );
}

// The passcode is write-only from the panel: it is stored bcrypt-hashed and
// never comes back, so the field always starts empty.
function PasscodeModal({ shotlistId, hasPasscode, onClose, onSaved }) {
  const [passcode, setPasscode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(clear) {
    setSaving(true); setError('');
    try {
      const res = await api.put(`/shotlists/${shotlistId}/passcode`, { passcode: clear ? null : passcode });
      onSaved(!!res.has_passcode);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save the passcode');
      setSaving(false);
    }
  }

  return (
    <Modal title={hasPasscode ? 'Change crew passcode' : 'Set crew passcode'} onClose={onClose}>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Anyone with the link can read the shot list. Only someone with this passcode can tick shots off.
        With no passcode set, the completion controls are hidden entirely.
      </p>
      <div className="form-row">
        <label className="form-label">Passcode</label>
        <input
          className="input" type="text" value={passcode} autoFocus
          onChange={e => setPasscode(e.target.value)}
          placeholder={hasPasscode ? 'Enter a new passcode' : 'At least 4 characters'}
        />
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: '12px' }}>{error}</p>}
      <div className="modal-footer">
        {hasPasscode && (
          <button className="btn btn-ghost" onClick={() => save(true)} disabled={saving}>Remove passcode</button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => save(false)} disabled={saving || passcode.trim().length < 4}>
          {saving ? 'Saving…' : 'Save passcode'}
        </button>
      </div>
    </Modal>
  );
}
