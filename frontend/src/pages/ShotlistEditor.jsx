import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Plus, X, Trash2, GripVertical, ChevronDown, ChevronRight, Copy,
  Globe, EyeOff, Link2, Check, Settings2, MapPin, KeyRound, FileText, Image as ImageIcon,
  Loader2, Wand2, History, RotateCcw, Sun, Clapperboard, Lock, Unlock, Users, UserPlus,
  Truck, Coffee, CalendarDays, Timer, Film, AlertTriangle, Share2,
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
  'Landscape', 'Overhead', 'Drone', 'Motion', 'Behind the scenes',
];

const LENSES = [
  ['ultra_wide', 'Ultra wide'], ['wide', 'Wide'], ['standard', 'Standard'],
  ['portrait', 'Portrait'], ['telephoto', 'Telephoto'], ['macro', 'Macro'],
  ['probe', 'Probe'], ['anamorphic', 'Anamorphic'], ['fisheye', 'Fisheye'],
  ['tilt_shift', 'Tilt shift'], ['zoom', 'Zoom'],
];

const BREAK_KINDS = [
  ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['break', 'Break'],
];

const CHARACTER_KINDS = [['principal', 'Principal'], ['extra', 'Extra']];

// "6h 45m" — how a call sheet writes a duration.
function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

// "30–40", "40+", "under 12" — the age a role is cast for, worded exactly as
// the crew page and the PDFs word it.
function fmtAgeRange(min, max) {
  const lo = min == null || min === '' ? null : Number(min);
  const hi = max == null || max === '' ? null : Number(max);
  if (lo == null && hi == null) return '';
  if (lo != null && hi == null) return `${lo}+`;
  if (lo == null && hi != null) return `under ${hi}`;
  if (lo === hi) return String(lo);
  return `${lo}–${hi}`;
}

// "2:05" — clip seconds as a running time.
function fmtClip(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m ? `${m}:${String(rest).padStart(2, '0')}` : `${rest}s`;
}

function thumbFor(m) {
  const name = m.thumb_filename || m.filename;
  return name ? `/shotlist-media/${name}` : null;
}

// The web copy is only ever a .webp when the upload was animated — stills are
// always written as .jpg — so the flag needs no column of its own.
function isAnimated(m) {
  return /\.webp$/i.test((m && m.filename) || '');
}

function dayLabel(day) {
  if (!day) return 'Day';
  return `Day ${day.day_number || 1}`;
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

function TextField({ label, value, onChange, placeholder, textarea, rows, polish, aiEnabled }) {
  const [loading, setLoading] = useState(false);
  return (
    <Field label={label}>
      {textarea ? (
        <textarea className="input" rows={rows || 3} value={value || ''} disabled={loading}
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

// A locked time is the same control everywhere it appears: set it to pin the
// start, clear it to hand the minute back to the scheduler.
function LockField({ label, value, onChange, hint }) {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input className="input" type="time" style={{ flex: 1 }} value={value || ''}
          onChange={e => onChange(e.target.value || null)} />
        {value && (
          <button type="button" className="btn btn-ghost btn-sm" title="Unlock" onClick={() => onChange(null)}>
            <Unlock size={13} />
          </button>
        )}
      </div>
      {hint && <p className="shotlist-hint">{hint}</p>}
    </Field>
  );
}

// ── Shot media picker (reference / scout) ────────────────────────────────────

function MediaPicker({ shotlistId, shot, kind, onChanged }) {
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
        await api.post(`/shotlists/${shotlistId}/shots/${shot.id}/media`, {
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
      await api.del(`/shotlists/${shotlistId}/media/${m.id}`);
      await onChanged();
    } catch (err) { alert(err.message || 'Could not remove the image'); }
  }

  return (
    <Field label={`${kind === 'scout' ? 'Scout' : 'Reference'} photos (${items.length})`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {items.map(m => (
          <div key={m.id} style={{ position: 'relative' }}>
            <img src={thumbFor(m)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border-default)' }} />
            {isAnimated(m) && (
              <span title="Animated — plays full size" style={{
                position: 'absolute', bottom: 2, left: 2, fontSize: '8px', fontWeight: 800,
                letterSpacing: '0.06em', padding: '1px 3px', borderRadius: 3,
                background: 'rgba(0,0,0,0.72)', color: '#fff',
              }}>GIF</span>
            )}
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
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
          style={{ display: 'none' }} onChange={handleFiles} />
      </div>
    </Field>
  );
}

// ── Who is in this shot ──────────────────────────────────────────────────────
// The cast is defined once for the shot list; a shot picks from it. Tapping a
// name toggles it, so nobody types a name twice.

function CharacterPicker({ characters, selected, onChange, onAddExtra }) {
  const [adding, setAdding] = useState(false);
  const chosen = new Set(selected || []);

  function toggle(cid) {
    const next = new Set(chosen);
    if (next.has(cid)) next.delete(cid); else next.add(cid);
    onChange([...next]);
  }

  async function addExtra() {
    setAdding(true);
    try {
      const created = await onAddExtra();
      // A freshly created extra is almost always meant for the shot you are on.
      if (created && created.id) onChange([...(selected || []), created.id]);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Field label={`In this shot (${chosen.size})`}>
      <div className="shotlist-char-picker">
        {characters.length === 0 && (
          <span className="shotlist-hint" style={{ margin: 0 }}>
            No cast yet — add characters in the panel on the right, or start with an extra.
          </span>
        )}
        {characters.map(c => (
          <button
            key={c.id}
            type="button"
            className={`shotlist-char-chip${chosen.has(c.id) ? ' on' : ''}`}
            onClick={() => toggle(c.id)}
            title={[c.name, fmtAgeRange(c.age_min, c.age_max) && `age ${fmtAgeRange(c.age_min, c.age_max)}`, c.performer]
              .filter(Boolean).join(' — ')}
          >
            {c.photo_thumb_filename || c.photo_filename ? (
              <img src={`/shotlist-media/${c.photo_thumb_filename || c.photo_filename}`} alt="" />
            ) : (
              <Users size={10} />
            )}
            {c.name}
          </button>
        ))}
        <button type="button" className="shotlist-char-chip add" onClick={addExtra} disabled={adding}>
          {adding ? <Loader2 size={10} className="pitch-spin" /> : <UserPlus size={10} />} Extra
        </button>
      </div>
    </Field>
  );
}

// ── One shot, inside its scene ───────────────────────────────────────────────

function SortableShot({
  shotlistId, shot, index, expanded, onToggle, onChange, onDelete, onDuplicate,
  scenes, characters, aiEnabled, onMediaChanged, onCharactersChange, onAddExtra,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `shot-${shot.id}` });

  return (
    <div
      ref={setNodeRef}
      className="shotlist-shot"
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 999 : undefined, position: 'relative',
      }}
      {...attributes}
    >
      <div className="shotlist-shot-head" onClick={() => onToggle(shot.id)}>
        <span
          {...listeners}
          onClick={e => e.stopPropagation()}
          title="Drag to reorder within the scene"
          style={{ cursor: isDragging ? 'grabbing' : 'grab', color: 'var(--text-muted)', touchAction: 'none', display: 'flex', padding: '2px' }}
        >
          <GripVertical size={13} />
        </span>
        <span className="shotlist-num">{shot.shot_number || index + 1}</span>
        <span style={{ fontSize: '13px', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shot.title || 'Untitled shot'}
        </span>
        {shot.locked_start_time && (
          <span className="shotlist-chip hard" title={`Locked to ${shot.locked_start_time}`}>
            <Lock size={9} /> {shot.locked_start_time}
          </span>
        )}
        {shot.shot_type && <span className="shotlist-chip">{shot.shot_type}</span>}
        <span className="shotlist-chip" title="Time to capture on the day">{shot.duration_minutes || 30}m</span>
        {shot.clip_length_seconds ? (
          <span className="shotlist-chip" title="Length of the clip in the edit">{fmtClip(shot.clip_length_seconds)}</span>
        ) : null}
        {(shot.characters || []).length > 0 && (
          <span className="shotlist-chip" title={(shot.characters || []).map(c => c.name).join(', ')}>
            <Users size={9} /> {(shot.characters || []).length}
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
        {expanded ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
      </div>

      {expanded && (
        <div className="shotlist-shot-body">
          <div className="shotlist-field-row">
            <TextField label="Shot number" value={shot.shot_number} onChange={v => onChange(shot.id, { shot_number: v })} />
            <TextField label="Title" value={shot.title} onChange={v => onChange(shot.id, { title: v })} placeholder="e.g. Drone city view" />
          </div>

          <TextField
            label="Description" value={shot.description} onChange={v => onChange(shot.id, { description: v })}
            textarea polish aiEnabled={aiEnabled} placeholder="What happens in this shot"
          />

          <div className="shotlist-field-row">
            <SelectField
              label="Shot type" value={shot.shot_type || ''} onChange={v => onChange(shot.id, { shot_type: v })}
              options={[{ value: '', label: '— none —' }, ...SHOT_TYPES.map(t => ({ value: t, label: t }))]}
            />
            {/* The two durations are different things and are labelled so they
                can never be confused: one is time on the day, one is screen time. */}
            <Field label="Capture time on the day (minutes)">
              <input className="input" type="number" min="5" step="5" value={shot.duration_minutes || 30}
                onChange={e => onChange(shot.id, { duration_minutes: Number(e.target.value) })} />
            </Field>
          </div>

          <div className="shotlist-field-row">
            <Field label="Clip length in the edit (seconds)">
              <input className="input" type="number" min="0" step="1" placeholder="e.g. 12"
                value={shot.clip_length_seconds == null ? '' : shot.clip_length_seconds}
                onChange={e => onChange(shot.id, {
                  clip_length_seconds: e.target.value === '' ? null : Number(e.target.value),
                })} />
            </Field>
            <LockField
              label="Locked start time"
              value={shot.locked_start_time}
              onChange={v => onChange(shot.id, { locked_start_time: v })}
              hint="A locked shot pins its scene to this minute, ahead of the light."
            />
          </div>

          <div className="shotlist-field-row">
            <SelectField
              label="Lens" value={shot.lens || ''} onChange={v => onChange(shot.id, { lens: v || null })}
              options={[{ value: '', label: '— none —' }, ...LENSES.map(([value, label]) => ({ value, label }))]}
            />
            <TextField label="Focal length or lens name" value={shot.lens_detail}
              onChange={v => onChange(shot.id, { lens_detail: v })} placeholder="e.g. 35mm or Zeiss Supreme" />
          </div>

          <CharacterPicker
            characters={characters}
            selected={(shot.characters || []).map(c => c.id)}
            onChange={ids => onCharactersChange(shot, ids)}
            onAddExtra={onAddExtra}
          />

          <TextField label="Costume" value={shot.costume} onChange={v => onChange(shot.id, { costume: v })} />
          <TextField label="Props" value={shot.props} onChange={v => onChange(shot.id, { props: v })} />
          <TextField
            label="Set design for this shot (deviation from the scene)" value={shot.set_design}
            onChange={v => onChange(shot.id, { set_design: v })} textarea rows={2}
          />
          <TextField
            label="Camera notes" value={shot.camera_notes} onChange={v => onChange(shot.id, { camera_notes: v })}
            textarea polish aiEnabled={aiEnabled}
          />

          {scenes.length > 1 && (
            <SelectField
              label="Move to scene" value={String(shot.scene_id)}
              onChange={v => onChange(shot.id, { scene_id: Number(v) })}
              options={scenes.map(sc => ({ value: String(sc.id), label: `${sc.scene_number ? `${sc.scene_number}. ` : ''}${sc.title || 'Untitled scene'}` }))}
            />
          )}

          <MediaPicker shotlistId={shotlistId} shot={shot} kind="reference" onChanged={onMediaChanged} />
          <MediaPicker shotlistId={shotlistId} shot={shot} kind="scout" onChanged={onMediaChanged} />
        </div>
      )}
    </div>
  );
}

// ── One scene, with its shots inside ─────────────────────────────────────────

function SortableScene({
  shotlistId, scene, index, expanded, onToggle, onChange, onDelete, onDuplicate,
  locations, windows, scenes, days, characters, shotlist, aiEnabled, onReload,
  expandedShotId, onToggleShot, onShotChange, onShotDelete, onShotDuplicate, onAddShot, onShotsReorder,
  onShotCharactersChange, onAddExtra,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `scene-${scene.id}` });
  const windowOptions = (scene.space === 'interior' ? windows.interior : windows.exterior) || [];
  const shots = scene.shots || [];

  const shotSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function handleShotDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const ids = shots.map(s => `shot-${s.id}`);
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onShotsReorder(scene, arrayMove(shots, oldIndex, newIndex));
  }

  // A shot lock pins the scene too, so the scene head shows either one.
  const lockedShot = shots.find(s => s.locked_start_time);
  const lockTime = scene.locked_start_time || (lockedShot ? lockedShot.locked_start_time : null);

  return (
    <div
      ref={setNodeRef}
      className="card shotlist-scene"
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 999 : undefined,
        position: 'relative', padding: 0, overflow: 'visible',
      }}
      {...attributes}
    >
      <div className="shotlist-scene-head" onClick={() => onToggle(scene.id)}>
        <span
          {...listeners}
          onClick={e => e.stopPropagation()}
          title="Drag to reorder scenes"
          style={{ cursor: isDragging ? 'grabbing' : 'grab', color: 'var(--text-muted)', touchAction: 'none', display: 'flex', padding: '2px' }}
        >
          <GripVertical size={15} />
        </span>
        <span className="shotlist-scene-num">{scene.scene_number || index + 1}</span>
        <span className="shotlist-scene-title">{scene.title || 'Untitled scene'}</span>
        <span className="shotlist-chip">{scene.space === 'interior' ? 'INT' : 'EXT'}</span>
        {lockTime && (
          <span className="shotlist-chip hard" title={scene.locked_start_time ? `Scene locked to ${lockTime}` : `A shot in this scene is locked to ${lockTime}`}>
            <Lock size={9} /> {lockTime}
          </span>
        )}
        {scene.light_window_label && (
          <span className={`shotlist-chip${scene.light_window_hard ? ' hard' : ''}`} title={scene.light_window_range}>
            {scene.light_window_label}
          </span>
        )}
        <span className="shotlist-chip">{shots.length} shot{shots.length === 1 ? '' : 's'}</span>
        <span className="shotlist-chip" title="Capture time on the day">{fmtDuration(scene.duration_minutes)}</span>
        {scene.clip_seconds ? (
          <span className="shotlist-chip" title="Clip length in the edit">
            <Film size={9} /> {fmtClip(scene.clip_seconds)}
          </span>
        ) : null}
        <button className="btn-ghost" style={{ padding: '3px 5px' }} title="Duplicate scene with its shots"
          onClick={e => { e.stopPropagation(); onDuplicate(scene); }}>
          <Copy size={13} />
        </button>
        <button className="btn-ghost" style={{ padding: '3px 5px', color: 'var(--danger)' }} title="Delete scene"
          onClick={e => { e.stopPropagation(); onDelete(scene); }}>
          <Trash2 size={13} />
        </button>
        {expanded ? <ChevronDown size={15} color="var(--text-muted)" /> : <ChevronRight size={15} color="var(--text-muted)" />}
      </div>

      {expanded && (
        <div className="shotlist-scene-body">
          <div className="shotlist-field-row">
            <TextField label="Scene number" value={scene.scene_number} onChange={v => onChange(scene.id, { scene_number: v })} />
            <TextField label="Scene title" value={scene.title} onChange={v => onChange(scene.id, { title: v })} placeholder="e.g. The Eagle" />
          </div>

          <TextField
            label="Scene description" value={scene.description} onChange={v => onChange(scene.id, { description: v })}
            textarea rows={4} polish aiEnabled={aiEnabled}
            placeholder="The screenplay for this scene: what happens, who is in it, how it plays"
          />

          <SelectField
            label="Location" value={scene.location_id == null ? '' : String(scene.location_id)}
            onChange={v => onChange(scene.id, { location_id: v ? Number(v) : null })}
            options={[{ value: '', label: '— none —' }, ...locations.map(l => ({ value: String(l.id), label: l.name }))]}
          />

          <div className="shotlist-field-row">
            <SelectField
              label="Space" value={scene.space || 'exterior'}
              onChange={v => onChange(scene.id, { space: v })}
              options={[{ value: 'interior', label: 'Interior' }, { value: 'exterior', label: 'Exterior' }]}
            />
            <SelectField
              label="Light window" value={scene.light_window || ''}
              onChange={v => onChange(scene.id, { light_window: v })}
              options={windowOptions.map(w => ({ value: w.key, label: `${w.label}${w.hard ? ' (hard)' : ''}` }))}
            />
          </div>
          {scene.light_window_range && (
            <p className="shotlist-window-note">
              <Sun size={11} /> {scene.light_window_label}: {scene.light_window_range}
              {scene.light_window_approximate ? ' — pin this scene’s location for exact times' : ''}
            </p>
          )}

          <div className="shotlist-field-row">
            {days.length > 1 ? (
              <SelectField
                label="Shoot day" value={scene.day_id == null ? '' : String(scene.day_id)}
                onChange={v => onChange(scene.id, { day_id: v ? Number(v) : null })}
                options={days.map(d => ({
                  value: String(d.id),
                  label: `${dayLabel(d)}${d.shoot_date ? ` · ${fmtDate(d.shoot_date)}` : ''}`,
                }))}
              />
            ) : <div style={{ flex: 1 }} />}
            <LockField
              label="Locked start time"
              value={scene.locked_start_time}
              onChange={v => onChange(scene.id, { locked_start_time: v })}
              hint="Immovable. It outranks the light window and the optimiser."
            />
          </div>

          {/* Set design lives on the scene: that is the room, the dressing, the
              world. A shot only records where it deviates. */}
          <TextField
            label="Set design for this scene" value={scene.set_design}
            onChange={v => onChange(scene.id, { set_design: v })} textarea rows={3} polish aiEnabled={aiEnabled}
            placeholder="How the space is dressed for this scene"
          />

          {/* Company move into this scene — defaults come from the shot list. */}
          <div className="shotlist-move-fields">
            <div className="shotlist-move-title">
              <Truck size={12} /> Company move into this scene
            </div>
            <div className="shotlist-field-row">
              <Field label="Wrap out (minutes)">
                <input
                  className="input" type="number" min="0" step="5"
                  placeholder={`Default ${shotlist.move_wrap_minutes ?? 20}`}
                  value={scene.move_wrap_minutes == null ? '' : scene.move_wrap_minutes}
                  onChange={e => onChange(scene.id, {
                    move_wrap_minutes: e.target.value === '' ? null : Number(e.target.value),
                  })}
                />
              </Field>
              <Field label="Set up on arrival (minutes)">
                <input
                  className="input" type="number" min="0" step="5"
                  placeholder={`Default ${shotlist.move_setup_minutes ?? 25}`}
                  value={scene.move_setup_minutes == null ? '' : scene.move_setup_minutes}
                  onChange={e => onChange(scene.id, {
                    move_setup_minutes: e.target.value === '' ? null : Number(e.target.value),
                  })}
                />
              </Field>
            </div>
            <LockField
              label="Depart at"
              value={scene.move_locked_start_time}
              onChange={v => onChange(scene.id, { move_locked_start_time: v })}
              hint="When the unit actually travels. Leave empty and it leaves as soon as the previous scene ends — set it when that scene did not need the whole crew, like a dawn drone shot."
            />
            <p className="shotlist-hint">
              An override sticks until you clear it. Empty means the shot list defaults; travel time is added on top.
            </p>
          </div>

          <TextField label="Scene notes" value={scene.notes} onChange={v => onChange(scene.id, { notes: v })} textarea rows={2} />

          {/* Coverage */}
          <div className="shotlist-shots-header">
            <span>Shots</span>
            <button className="btn btn-secondary btn-sm" onClick={() => onAddShot(scene)}>
              <Plus size={13} /> Add shot
            </button>
          </div>

          {shots.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px' }}>
              No shots yet. Add the coverage for this scene.
            </p>
          ) : (
            <DndContext sensors={shotSensors} collisionDetection={closestCenter} onDragEnd={handleShotDragEnd}>
              <SortableContext items={shots.map(s => `shot-${s.id}`)} strategy={verticalListSortingStrategy}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {shots.map((shot, i) => (
                    <SortableShot
                      key={shot.id}
                      shotlistId={shotlistId}
                      shot={shot}
                      index={i}
                      expanded={expandedShotId === shot.id}
                      onToggle={onToggleShot}
                      onChange={onShotChange}
                      onDelete={onShotDelete}
                      onDuplicate={onShotDuplicate}
                      scenes={scenes}
                      characters={characters}
                      aiEnabled={aiEnabled}
                      onMediaChanged={onReload}
                      onCharactersChange={onShotCharactersChange}
                      onAddExtra={onAddExtra}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shoot days ───────────────────────────────────────────────────────────────

function DayTabs({ days, activeDayId, counts, onSelect, onAdd, onEdit }) {
  return (
    <div className="shotlist-day-tabs">
      {days.map(d => (
        <button
          key={d.id}
          className={`shotlist-day-tab${d.id === activeDayId ? ' on' : ''}`}
          onClick={() => onSelect(d.id)}
        >
          <CalendarDays size={12} />
          <span className="shotlist-day-tab-name">{dayLabel(d)}</span>
          <span className="shotlist-day-tab-date">{d.shoot_date ? fmtDate(d.shoot_date) : 'No date'}</span>
          <span className="shotlist-chip">{counts.get(d.id) || 0}</span>
          {d.id === activeDayId && (
            <span
              className="shotlist-day-tab-edit" title="Day settings"
              onClick={e => { e.stopPropagation(); onEdit(d); }}
            >
              <Settings2 size={11} />
            </span>
          )}
        </button>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={onAdd} title="Add a shoot day">
        <Plus size={13} /> Day
      </button>
    </div>
  );
}

function DayModal({ shotlistId, day, sceneCount, canDelete, onClose, onSaved }) {
  const [draft, setDraft] = useState({ ...day });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    try {
      await api.put(`/shotlists/${shotlistId}/days/${day.id}`, {
        day_number: draft.day_number,
        shoot_date: draft.shoot_date || null,
        crew_call: draft.crew_call || null,
        crew_call_offset_minutes: draft.crew_call_offset_minutes,
        notes: draft.notes || '',
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save the day');
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${dayLabel(day)}?`)) return;
    setSaving(true); setError('');
    try {
      await api.del(`/shotlists/${shotlistId}/days/${day.id}`);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not delete the day');
      setSaving(false);
    }
  }

  return (
    <Modal title={`${dayLabel(day)} settings`} onClose={onClose}>
      <div style={{ display: 'flex', gap: '10px' }}>
        <div className="form-row" style={{ width: 90 }}>
          <label className="form-label">Day number</label>
          <input className="input" type="number" min="1" value={draft.day_number || 1}
            onChange={e => setDraft({ ...draft, day_number: Number(e.target.value) })} />
        </div>
        <div className="form-row" style={{ flex: 1 }}>
          <label className="form-label">Shoot date</label>
          <input className="input" type="date" value={draft.shoot_date || ''}
            onChange={e => setDraft({ ...draft, shoot_date: e.target.value || null })} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <div className="form-row" style={{ flex: 1 }}>
          <label className="form-label">Earliest start</label>
          <input className="input" type="time" value={draft.crew_call || ''}
            onChange={e => setDraft({ ...draft, crew_call: e.target.value || null })} />
          <p className="shotlist-hint">
            When the day may begin. Crew call is derived from the first shot, not from this.
          </p>
        </div>
        <div className="form-row" style={{ width: 150 }}>
          <label className="form-label">Crew call offset (min)</label>
          <input className="input" type="number" min="0" step="5" value={draft.crew_call_offset_minutes ?? 30}
            onChange={e => setDraft({ ...draft, crew_call_offset_minutes: Number(e.target.value) })} />
          <p className="shotlist-hint">Crew call sits this far before the first shot.</p>
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Day notes</label>
        <textarea className="input" rows={2} value={draft.notes || ''}
          onChange={e => setDraft({ ...draft, notes: e.target.value })} />
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: '12px' }}>{error}</p>}
      <div className="modal-footer">
        {canDelete && (
          <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={remove}
            disabled={saving} title={sceneCount ? 'Move this day’s scenes elsewhere first' : 'Delete this day'}>
            <Trash2 size={13} /> Delete day
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save day'}
        </button>
      </div>
    </Modal>
  );
}

// The shape of the day in numbers — the same figures the crew page and the
// call sheet print.
function DayTotals({ day, totals, warnings }) {
  const cells = [
    ['Crew call', totals.crew_call || '—', 'strong'],
    ['First shot', totals.first_shot_call || '—'],
    ['Wrap', totals.wrap || '—'],
    ['On set', fmtDuration(totals.on_set_minutes)],
    ['Shooting', fmtDuration(totals.shooting_minutes)],
    ['Travel', `${fmtDuration(totals.travel_minutes)}${totals.travel_km ? ` · ${totals.travel_km} km` : ''}`],
    ['Breaks', fmtDuration(totals.break_minutes)],
    ['Clip', fmtClip(totals.clip_seconds)],
  ];
  return (
    <div className="card shotlist-day-totals">
      <div className="shotlist-day-totals-head">
        <CalendarDays size={13} color="var(--accent)" />
        <span>{dayLabel(day)}{day && day.shoot_date ? ` · ${fmtDate(day.shoot_date)}` : ''}</span>
        {totals.locked_count > 0 && (
          <span className="shotlist-chip hard"><Lock size={9} /> {totals.locked_count} locked</span>
        )}
        {totals.move_count > 0 && (
          <span className="shotlist-chip"><Truck size={9} /> {totals.move_count} move{totals.move_count === 1 ? '' : 's'}</span>
        )}
      </div>
      <div className="shotlist-day-totals-grid">
        {cells.map(([k, v, strong]) => (
          <div key={k} className={`shotlist-total${strong ? ' strong' : ''}`}>
            <span className="shotlist-total-k">{k}</span>
            <span className="shotlist-total-v">{v}</span>
          </div>
        ))}
      </div>
      {warnings.length > 0 && (
        <ul className="shotlist-warnings">
          {warnings.map((w, i) => (
            <li key={i}><AlertTriangle size={11} /> {w.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The day as it actually runs: scenes, the company moves between them and the
// breaks, on one clock.
function TimelinePreview({ timeline }) {
  const items = (timeline && timeline.items) || [];
  if (!items.length) return null;
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head">
        <Timer size={14} color="var(--accent)" />
        <span>Day timeline</span>
      </div>
      <div className="shotlist-timeline">
        {items.map((it, i) => {
          if (it.kind === 'move') {
            return (
              <div key={`m${i}`} className="shotlist-tl-row move">
                <span className="shotlist-tl-time">{it.start_label}</span>
                <Truck size={12} />
                <span className="shotlist-tl-title">
                  Company move{it.to_name ? ` to ${it.to_name}` : ''}
                </span>
                {it.locked && (
                  <span className="shotlist-chip hard"><Lock size={9} /> departs {it.locked_time}</span>
                )}
                <span className="shotlist-tl-note">
                  wrap {it.wrap_minutes}m + travel {it.travel_minutes}m + set up {it.setup_minutes}m = {fmtDuration(it.duration_minutes)}
                  {it.overridden ? ' (override)' : ''}
                  {it.hold_minutes > 0 ? ` · unit holds ${fmtDuration(it.hold_minutes)} first` : ''}
                </span>
              </div>
            );
          }
          if (it.kind === 'break') {
            return (
              <div key={`b${i}`} className="shotlist-tl-row break">
                <span className="shotlist-tl-time">{it.start_label}</span>
                <Coffee size={12} />
                <span className="shotlist-tl-title">{it.label}</span>
                {it.fixed && <span className="shotlist-chip hard"><Lock size={9} /> fixed</span>}
                {/* The side only means something where a move exists. */}
                {it.placement_applies && (
                  <span className="shotlist-chip">
                    {it.placement === 'before_move' ? 'before the move' : 'after the move'}
                  </span>
                )}
                {it.end_of_day && <span className="shotlist-chip">end of day</span>}
                <span className="shotlist-tl-note">
                  {it.location_name ? `${it.location_name} · ` : ''}{fmtDuration(it.duration_minutes)}
                </span>
              </div>
            );
          }
          return (
            <div key={`s${i}`} className="shotlist-tl-row scene">
              <span className="shotlist-tl-time">{it.start_label}</span>
              <span className="shotlist-scene-num">{it.scene_number}</span>
              <span className="shotlist-tl-title">{it.title || 'Untitled scene'}</span>
              {it.locked && <span className="shotlist-chip hard"><Lock size={9} /> {it.locked_time}</span>}
              {it.light_window_label && (
                <span className={`shotlist-chip${it.light_window_hard ? ' hard' : ''}`}>{it.light_window_label}</span>
              )}
              <span className="shotlist-tl-note">
                {it.shot_count} shot{it.shot_count === 1 ? '' : 's'} · {fmtDuration(it.duration_minutes)} · ends {it.end_label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Meals and breaks ─────────────────────────────────────────────────────────

function BreaksPanel({ shotlistId, dayId, breaks, scenes, timeline, onChanged }) {
  const [busy, setBusy] = useState(false);

  // Which scenes are arrived at by a company move — the only ones where the
  // side of the break means anything.
  const movesByScene = new Map(
    ((timeline && timeline.items) || []).filter(i => i.kind === 'move').map(i => [i.scene_id, i])
  );
  const moveSceneIds = new Set(movesByScene.keys());
  // A break at or past the end of the list is an end-of-day break, and stays
  // there when scenes are added later.
  const END_OF_DAY = 999;
  const sceneAt = order => (order >= scenes.length ? null : scenes[order]);
  const hasMove = order => {
    const sc = sceneAt(order);
    return !!(sc && moveSceneIds.has(sc.id));
  };

  async function add(sortOrder) {
    setBusy(true);
    try {
      await api.post(`/shotlists/${shotlistId}/breaks`, {
        day_id: dayId,
        kind: sortOrder === END_OF_DAY ? 'dinner' : 'lunch',
        duration_minutes: 45,
        sort_order: sortOrder,
      });
      await onChanged();
    } catch (err) { alert(err.message || 'Could not add the break'); }
    finally { setBusy(false); }
  }

  async function patch(b, body) {
    try {
      await api.put(`/shotlists/${shotlistId}/breaks/${b.id}`, body);
      await onChanged();
    } catch (err) { alert(err.message || 'Could not save the break'); }
  }

  async function remove(b) {
    if (!confirm(`Remove "${b.label}"?`)) return;
    try {
      await api.del(`/shotlists/${shotlistId}/breaks/${b.id}`);
      await onChanged();
    } catch (err) { alert(err.message || 'Could not remove the break'); }
  }

  const positions = [
    ...scenes.map((s, i) => ({
      value: String(i),
      label: `At ${s.scene_number ? `${s.scene_number}. ` : ''}${s.title || 'scene'}`,
    })),
    { value: String(END_OF_DAY), label: 'End of the day' },
  ];

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head">
        <Coffee size={14} color="var(--accent)" />
        <span>Meals and breaks</span>
        <button className="btn btn-ghost btn-sm" onClick={() => add(END_OF_DAY)} disabled={busy || !dayId}
          title="A wrap meal or a dinner after the last scene">
          <Plus size={13} /> End of day
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => add(Math.ceil(scenes.length / 2))}
          disabled={busy || !dayId}>
          <Plus size={13} /> Add
        </button>
      </div>

      {breaks.length === 0 && (
        <p className="shotlist-hint" style={{ marginTop: 0 }}>
          Nothing scheduled. A day over six hours from crew call is flagged until it has a meal.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {breaks.map(b => (
          <div key={b.id} className="shotlist-break-row">
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select className="select" style={{ width: 110 }} value={b.kind}
                onChange={e => patch(b, { kind: e.target.value })}>
                {BREAK_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input className="input" style={{ flex: 1, minWidth: 0 }} value={b.label || ''}
                onChange={e => patch(b, { label: e.target.value })} placeholder="Label" />
              <button className="btn-ghost" style={{ padding: '4px 6px', color: 'var(--danger)' }}
                title="Remove" onClick={() => remove(b)}>
                <Trash2 size={12} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input className="input" type="time" style={{ width: 108 }} value={b.start_time || ''}
                title="A fixed time is immovable; empty lets the break float in the running order"
                onChange={e => patch(b, { start_time: e.target.value || null })} />
              {b.start_time ? (
                <button className="btn btn-ghost btn-sm" title="Let this break float again"
                  onClick={() => patch(b, { start_time: null })}>
                  <Unlock size={12} />
                </button>
              ) : (
                <span className="shotlist-chip">floats</span>
              )}
              <input className="input" type="number" min="5" step="5" style={{ width: 72 }}
                value={b.duration_minutes || 30} title="Minutes"
                onChange={e => patch(b, { duration_minutes: Number(e.target.value) })} />
              <select className="select" style={{ flex: 1, minWidth: 0 }}
                value={String((b.sort_order || 0) >= scenes.length ? END_OF_DAY : b.sort_order || 0)}
                onChange={e => patch(b, { sort_order: Number(e.target.value) })}>
                {positions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            {/* Which side of the company move the crew eats on. Only a scene
                arrived at by a move has two sides to choose between. */}
            {hasMove(b.sort_order || 0) ? (
              <select className="select" style={{ width: '100%' }}
                value={b.placement === 'before_move' ? 'before_move' : 'after_move'}
                onChange={e => patch(b, { placement: e.target.value })}>
                <option value="after_move">
                  After the move — eaten at {movesByScene.get(sceneAt(b.sort_order || 0)?.id)?.to_name || 'the new location'}
                </option>
                <option value="before_move">
                  Before the move — eaten where the crew already is
                </option>
              </select>
            ) : (
              <p className="shotlist-hint" style={{ marginTop: 0 }}>
                {(b.sort_order || 0) >= scenes.length
                  ? 'Eaten where the day finishes.'
                  : 'No company move here, so there is no side to choose — it sits before the scene.'}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Wardrobe ─────────────────────────────────────────────────────────────────
// A part usually has more than one look, so this is a list of photos, each
// nameable for continuity. It only appears once the character exists, because
// the photos hang off the character id.

function WardrobePicker({ shotlistId, character, onChanged }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const items = character.wardrobe || [];

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
        await api.post(`/shotlists/${shotlistId}/characters/${character.id}/media`, {
          filename: res.filename, thumb_filename: res.thumb,
        });
      }
      await onChanged();
    } catch (err) {
      alert(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function rename(m, label) {
    try {
      await api.put(`/shotlists/${shotlistId}/character-media/${m.id}`, { label });
      await onChanged();
    } catch (err) { alert(err.message || 'Could not rename the look'); }
  }

  async function remove(m) {
    try {
      await api.del(`/shotlists/${shotlistId}/character-media/${m.id}`);
      await onChanged();
    } catch (err) { alert(err.message || 'Could not remove the photo'); }
  }

  return (
    <div className="form-row">
      <label className="form-label">Wardrobe ({items.length})</label>
      <div className="shotlist-wardrobe">
        {items.map(m => (
          <div key={m.id} className="shotlist-wardrobe-item">
            <div style={{ position: 'relative' }}>
              <img src={`/shotlist-media/${m.thumb_filename || m.filename}`} alt="" />
              <button
                type="button" title="Remove this look" onClick={() => remove(m)}
                className="shotlist-wardrobe-x"
              >
                <X size={10} />
              </button>
            </div>
            <input
              className="input" defaultValue={m.label || ''} placeholder="Name this look"
              onBlur={e => { if ((e.target.value || '') !== (m.label || '')) rename(m, e.target.value); }}
            />
          </div>
        ))}
        <button
          type="button" className="shotlist-wardrobe-add"
          onClick={() => inputRef.current?.click()} disabled={uploading}
        >
          {uploading ? <Loader2 size={15} className="pitch-spin" /> : <Plus size={15} />}
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple
          style={{ display: 'none' }} onChange={handleFiles} />
      </div>
      <p className="shotlist-hint">
        Fittings and continuity stills. They travel with the part into every scene it appears in.
      </p>
    </div>
  );
}

// ── Characters ───────────────────────────────────────────────────────────────

// The casting agency's link. A separate publication from the crew link — an
// agency gets the cast grid and nothing else — and it can be rotated to cut
// off a link that has travelled further than intended.
function CastingShare({ shotlistId, shotlist, base, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const shared = shotlist.casting_status === 'published';
  const url = shotlist.casting_slug ? `${base.base}/c/${shotlist.casting_slug}` : null;

  async function act(path, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    try {
      await api.post(`/shotlists/${shotlistId}/casting/${path}`, {});
      await onChanged();
    } catch (err) {
      alert(err.message || 'Could not update the casting link');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="shotlist-casting-share">
      <div className="shotlist-casting-head">
        <Share2 size={12} />
        <span>Casting link</span>
        {shared && <span className="shotlist-chip">shared</span>}
      </div>

      {shared && url ? (
        <>
          <div className="shotlist-casting-url">
            <a href={url} target="_blank" rel="noreferrer">{url}</a>
            <button className="btn-ghost" style={{ padding: '3px 5px', color: copied ? 'var(--success)' : undefined }}
              onClick={copy} title={`Copy the casting link (${base.host})`}>
              {copied ? <Check size={12} /> : <Link2 size={12} />}
            </button>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{base.host}</span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => act('unpublish', 'Stop sharing the casting? The agency link stops working.')}>
              <EyeOff size={12} /> Stop sharing
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => act('rotate', 'Make a new casting link? The old one stops working immediately.')}>
              <RotateCcw size={12} /> New link
            </button>
          </div>
          <p className="shotlist-hint">
            Cast, age ranges, costume notes and wardrobe only — no schedule, no locations, no call times. Read only.
          </p>
        </>
      ) : (
        <>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act('publish')}>
            <Share2 size={12} /> Share with a casting agency
          </button>
          <p className="shotlist-hint">
            A view-only grid of the cast on your public domain. It shows nothing else from the shot list.
          </p>
        </>
      )}
    </div>
  );
}

// One cast row, draggable by its handle. The handle is its own control so a
// tap on the row's buttons never starts a drag.
function SortableCharacter({ character: c, onEdit, onDuplicate, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `char-${c.id}` });

  return (
    <div
      ref={setNodeRef}
      className="shotlist-loc-row"
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 999 : undefined, position: 'relative',
      }}
      {...attributes}
    >
      <span
        {...listeners}
        title="Drag to reorder the cast"
        style={{
          cursor: isDragging ? 'grabbing' : 'grab', color: 'var(--text-muted)',
          touchAction: 'none', display: 'flex', padding: '2px', flexShrink: 0,
        }}
      >
        <GripVertical size={13} />
      </span>
      {c.photo_thumb_filename || c.photo_filename ? (
        <img src={`/shotlist-media/${c.photo_thumb_filename || c.photo_filename}`} alt=""
          style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: '50%', border: '1px solid var(--border-default)' }} />
      ) : (
        <span className="shotlist-char-avatar"><Users size={13} /></span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600 }}>{c.name}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {c.kind === 'extra' ? 'Extra' : 'Principal'}
          {fmtAgeRange(c.age_min, c.age_max) ? ` · age ${fmtAgeRange(c.age_min, c.age_max)}` : ''}
          {c.performer ? ` · ${c.performer}` : ''}
          {(c.wardrobe || []).length ? ` · ${c.wardrobe.length} look${c.wardrobe.length === 1 ? '' : 's'}` : ''}
        </div>
      </div>
      <button className="btn-ghost" style={{ padding: '4px 6px' }} title="Edit" onClick={() => onEdit(c)}>
        <Settings2 size={12} />
      </button>
      <button className="btn-ghost" style={{ padding: '4px 6px' }}
        title="Duplicate this part with its brief and wardrobe" onClick={() => onDuplicate(c)}>
        <Copy size={12} />
      </button>
      <button className="btn-ghost" style={{ padding: '4px 6px', color: 'var(--danger)' }} title="Delete" onClick={() => onDelete(c)}>
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function CharactersPanel({ shotlistId, shotlist, base, characters, onChanged, onAddExtra, onReload }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  // The cast is dragged locally for an immediate result and resynced whenever
  // the server sends a fresh list.
  const [list, setList] = useState(characters);
  useEffect(() => { setList(characters); }, [characters]);

  const castSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // Wardrobe is saved the moment it is uploaded, so the open modal takes the
  // fresh list back from the server — but only that field, or it would discard
  // whatever is half-typed in the others.
  useEffect(() => {
    if (!editing || !editing.id) return;
    const fresh = characters.find(c => c.id === editing.id);
    if (!fresh) return;
    setEditing(prev => (prev && prev.id === fresh.id ? { ...prev, wardrobe: fresh.wardrobe } : prev));
  }, [characters]);

  async function save() {
    if (!editing.name || !editing.name.trim()) { alert('Give the character a name'); return; }
    try {
      const body = {
        name: editing.name, performer: editing.performer, kind: editing.kind,
        costume: editing.costume, notes: editing.notes,
        photo_filename: editing.photo_filename || null,
        photo_thumb_filename: editing.photo_thumb_filename || null,
        age_min: editing.age_min === '' ? null : editing.age_min,
        age_max: editing.age_max === '' ? null : editing.age_max,
      };
      if (editing.id) await api.put(`/shotlists/${shotlistId}/characters/${editing.id}`, body);
      else await api.post(`/shotlists/${shotlistId}/characters`, body);
      setEditing(null);
      await onChanged();
    } catch (err) { alert(err.message || 'Could not save the character'); }
  }

  async function remove(c) {
    if (!confirm(`Delete "${c.name}"? They are removed from every shot they were in.`)) return;
    try {
      await api.del(`/shotlists/${shotlistId}/characters/${c.id}`);
      await onChanged();
    } catch (err) { alert(err.message || 'Could not delete the character'); }
  }

  async function uploadPhoto(e) {
    const file = (e.target.files || [])[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await api.postForm('/shotlists/upload', fd);
      setEditing(prev => ({ ...prev, photo_filename: res.filename, photo_thumb_filename: res.thumb }));
    } catch (err) { alert(err.message || 'Upload failed'); }
    finally { setUploading(false); }
  }

  async function addExtra() {
    setBusy(true);
    try { await onAddExtra(); } finally { setBusy(false); }
  }

  async function duplicate(c) {
    try {
      await api.post(`/shotlists/${shotlistId}/characters/${c.id}/duplicate`, {});
      await onChanged();
    } catch (err) { alert(err.message || 'Could not duplicate the character'); }
  }

  async function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const ids = list.map(c => `char-${c.id}`);
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    // Move it locally first so the drag lands where it was dropped, then let
    // the server confirm; a failure puts the list back rather than leaving the
    // panel showing an order that was never saved.
    const next = arrayMove(list, oldIndex, newIndex);
    setList(next);
    try {
      await api.patch(`/shotlists/${shotlistId}/characters/reorder`, { characterIds: next.map(c => c.id) });
      await onChanged();
    } catch (err) {
      setList(characters);
      alert(err.message || 'Could not reorder the cast');
    }
  }

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head">
        <Users size={14} color="var(--accent)" />
        <span>Cast</span>
        <button className="btn btn-ghost btn-sm" onClick={addExtra} disabled={busy} title="Add the next numbered extra">
          <UserPlus size={13} /> Extra
        </button>
        <button className="btn btn-secondary btn-sm"
          onClick={() => setEditing({ name: '', performer: '', kind: 'principal', costume: '', notes: '' })}>
          <Plus size={13} /> Add
        </button>
      </div>

      {characters.length === 0 && (
        <p className="shotlist-hint" style={{ marginTop: 0 }}>
          No cast yet. Add them once here and pick them on each shot.
        </p>
      )}

      <DndContext sensors={castSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={list.map(c => `char-${c.id}`)} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {list.map(c => (
              <SortableCharacter
                key={c.id}
                character={c}
                onEdit={ch => setEditing({ ...ch })}
                onDuplicate={duplicate}
                onDelete={remove}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {list.length > 1 && (
        <p className="shotlist-hint" style={{ marginTop: 0 }}>
          Drag to reorder — this is the order the shot picker, the casting page and the photo board use.
        </p>
      )}

      <CastingShare shotlistId={shotlistId} shotlist={shotlist} base={base} onChanged={onReload} />

      {editing && (
        <Modal title={editing.id ? 'Edit character' : 'Add character'} onClose={() => setEditing(null)}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">Character *</label>
              <input className="input" value={editing.name || ''} autoFocus
                onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. The Falconer" />
            </div>
            <div className="form-row" style={{ width: 130 }}>
              <label className="form-label">Kind</label>
              <select className="select" style={{ width: '100%' }} value={editing.kind || 'principal'}
                onChange={e => setEditing({ ...editing, kind: e.target.value })}>
                {CHARACTER_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Performer</label>
            <input className="input" value={editing.performer || ''}
              onChange={e => setEditing({ ...editing, performer: e.target.value })} placeholder="Who plays them" />
          </div>
          {/* The age the ROLE is cast for, which is not the performer's own
              age. Either end can stand alone. */}
          <div className="form-row">
            <label className="form-label">Age range for casting</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                className="input" type="number" min="0" max="120" style={{ flex: 1 }} placeholder="From"
                value={editing.age_min == null ? '' : editing.age_min}
                onChange={e => setEditing({ ...editing, age_min: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>to</span>
              <input
                className="input" type="number" min="0" max="120" style={{ flex: 1 }} placeholder="To"
                value={editing.age_max == null ? '' : editing.age_max}
                onChange={e => setEditing({ ...editing, age_max: e.target.value === '' ? null : Number(e.target.value) })}
              />
              {(editing.age_min != null || editing.age_max != null) && (
                <button className="btn btn-ghost btn-sm" title="Clear the age range"
                  onClick={() => setEditing({ ...editing, age_min: null, age_max: null })}>
                  <X size={13} />
                </button>
              )}
            </div>
            <p className="shotlist-hint">
              {fmtAgeRange(editing.age_min, editing.age_max)
                ? `Casting for ${fmtAgeRange(editing.age_min, editing.age_max)}. `
                : ''}
              Leave one end empty for an open range — "40 to blank" reads as 40+.
            </p>
          </div>
          <div className="form-row">
            <label className="form-label">Costume</label>
            <input className="input" value={editing.costume || ''}
              onChange={e => setEditing({ ...editing, costume: e.target.value })} />
          </div>
          <div className="form-row">
            <label className="form-label">Casting photo</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {editing.photo_thumb_filename || editing.photo_filename ? (
                <img src={`/shotlist-media/${editing.photo_thumb_filename || editing.photo_filename}`} alt=""
                  style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border-default)' }} />
              ) : null}
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 size={13} className="pitch-spin" /> : <ImageIcon size={13} />}
                {editing.photo_filename ? 'Replace' : 'Upload'}
              </button>
              {editing.photo_filename && (
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setEditing({ ...editing, photo_filename: null, photo_thumb_filename: null })}>
                  Remove
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }} onChange={uploadPhoto} />
            </div>
          </div>
          {/* Wardrobe photos hang off the character id, so a brand new part is
              saved first and then dressed. */}
          {editing.id ? (
            <WardrobePicker shotlistId={shotlistId} character={editing} onChanged={onChanged} />
          ) : (
            <div className="form-row">
              <label className="form-label">Wardrobe</label>
              <p className="shotlist-hint" style={{ marginTop: 0 }}>
                Save this character first, then reopen it to attach wardrobe photos.
              </p>
            </div>
          )}
          <div className="form-row">
            <label className="form-label">Notes</label>
            <textarea className="input" rows={2} value={editing.notes || ''}
              onChange={e => setEditing({ ...editing, notes: e.target.value })} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save character</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Locations panel ──────────────────────────────────────────────────────────

function LocationsPanel({ shotlistId, locations, onChanged }) {
  const [editing, setEditing] = useState(null);

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
    if (!confirm(`Delete location "${loc.name}"? Scenes using it keep their other details.`)) return;
    try {
      await api.del(`/shotlists/${shotlistId}/locations/${loc.id}`);
      await onChanged();
    } catch (err) { alert(err.message || 'Could not delete the location'); }
  }

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head">
        <MapPin size={14} color="var(--accent)" />
        <span>Locations</span>
        <button className="btn btn-secondary btn-sm" onClick={startNew}><Plus size={13} /> Add</button>
      </div>

      {locations.length === 0 && (
        <p className="shotlist-hint" style={{ marginTop: 0 }}>
          No locations yet. Pin one so scene light windows and travel times are real.
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
// One day at a time: a day is the unit that gets scheduled.

function OrganizePanel({ shotlistId, day, scenes, plan, onPlanned, onApplied }) {
  const [startSceneId, setStartSceneId] = useState(scenes.length ? String(scenes[0].id) : '');
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (scenes.length && !scenes.some(s => String(s.id) === startSceneId)) {
      setStartSceneId(String(scenes[0].id));
    }
  }, [scenes.map(s => s.id).join(','), startSceneId]);

  async function run() {
    setRunning(true); setError('');
    try {
      const res = await api.post(`/shotlists/${shotlistId}/organize`, {
        dayId: day ? day.id : null,
        startSceneId: Number(startSceneId),
      });
      onPlanned(res);
    } catch (err) {
      setError(err.message || 'Could not organise the day');
    } finally {
      setRunning(false);
    }
  }

  async function apply() {
    if (!confirm(`Apply the optimised scene order for ${dayLabel(day)}? It becomes your order. The optimised plan is kept too.`)) return;
    setApplying(true);
    try {
      await api.post(`/shotlists/${shotlistId}/apply-plan`, { dayId: day ? day.id : null });
      await onApplied();
    } catch (err) {
      alert(err.message || 'Could not apply the plan');
    } finally {
      setApplying(false);
    }
  }

  const p = plan && plan.plan ? plan.plan : null;
  const c = plan && plan.comparison ? plan.comparison : null;
  const rows = p ? p.items.filter(i => i.kind === 'scene') : [];

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head">
        <Wand2 size={14} color="var(--accent)" />
        <span>Organize {dayLabel(day)}</span>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="form-label" style={{ fontSize: '11px' }}>Start with scene</label>
          <select className="select" style={{ width: '100%' }} value={startSceneId} onChange={e => setStartSceneId(e.target.value)}>
            {scenes.map(s => (
              <option key={s.id} value={s.id}>
                {s.scene_number ? `${s.scene_number}. ` : ''}{s.title || 'Untitled scene'}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={run} disabled={running || scenes.length === 0}>
          {running ? <Loader2 size={13} className="pitch-spin" /> : <Wand2 size={13} />}
          {running ? 'Planning…' : 'Organize this'}
        </button>
      </div>

      <p className="shotlist-hint">
        Locked times and fixed breaks first, then the light, then travel — and scenes at the same
        location are kept together even when a detour would be shorter.
      </p>

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
                <span>
                  {c.current.move_count} move{c.current.move_count === 1 ? '' : 's'} · {c.current.travel_km} km ·
                  {' '}{c.current.travel_minutes} min travel · call {c.current.crew_call || '—'} · ends {c.current.end_label || '—'} ·
                  {' '}{c.current.warning_count} warning{c.current.warning_count === 1 ? '' : 's'}
                </span>
              </div>
              <div>
                <span className="shotlist-compare-k">Optimised</span>
                <span>
                  {c.optimised.move_count} move{c.optimised.move_count === 1 ? '' : 's'} · {c.optimised.travel_km} km ·
                  {' '}{c.optimised.travel_minutes} min travel · call {c.optimised.crew_call || '—'} · ends {c.optimised.end_label || '—'} ·
                  {' '}{c.optimised.warning_count} warning{c.optimised.warning_count === 1 ? '' : 's'}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {c.moved_count} scene{c.moved_count === 1 ? '' : 's'} move ·
                {' '}{c.moves_saved > 0 ? `${c.moves_saved} fewer company move${c.moves_saved === 1 ? '' : 's'}` : 'same number of company moves'} ·
                {' '}{c.move_minutes_saved > 0 ? `${fmtDuration(c.move_minutes_saved)} of travel saved` : 'no travel saved'} ·
                {' '}fixes {c.fixes.length} · introduces {c.introduces.length}
              </div>
            </div>
          )}

          <div className="shotlist-plan">
            {rows.map((r, i) => {
              const move = c && c.moves.find(m => m.scene_id === r.scene_id);
              return (
                <div key={`${r.scene_id}-${i}`} className="shotlist-plan-row">
                  <span className="shotlist-plan-time">{r.start_label}</span>
                  <span className="shotlist-plan-title">{r.title || 'Untitled scene'}</span>
                  {r.locked && <span className="shotlist-chip hard"><Lock size={9} /> {r.locked_time}</span>}
                  <span className="shotlist-chip">{r.shot_count} shot{r.shot_count === 1 ? '' : 's'}</span>
                  {r.light_window_label && (
                    <span className={`shotlist-chip${r.light_window_hard ? ' hard' : ''}`}>{r.light_window_label}</span>
                  )}
                  {move && move.moved && (
                    <span className="shotlist-plan-move">#{move.from_position} → #{move.to_position}</span>
                  )}
                </div>
              );
            })}
          </div>

          {c && c.unsatisfied.length > 0 && (
            <div className="shotlist-fixes" style={{ borderColor: 'var(--danger)' }}>
              Could not be honoured:
              <ul>{c.unsatisfied.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            </div>
          )}

          {p.warnings.length > 0 && (
            <ul className="shotlist-warnings">
              {p.warnings.map((w, i) => <li key={i}><AlertTriangle size={11} /> {w.message}</li>)}
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
  const [days, setDays] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [breaks, setBreaks] = useState([]);
  const [timelines, setTimelines] = useState([]);
  const [totals, setTotals] = useState(null);
  const [shotCount, setShotCount] = useState(0);
  const [locations, setLocations] = useState([]);
  const [activity, setActivity] = useState([]);
  const [plan, setPlan] = useState(null);
  const [windows, setWindows] = useState({ interior: [], exterior: [] });
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('saved');
  const [activeDayId, setActiveDayId] = useState(null);
  const [editingDay, setEditingDay] = useState(null);
  const [expandedSceneId, setExpandedSceneId] = useState(null);
  const [expandedShotId, setExpandedShotId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const [base, setBase] = useState({ base: window.location.origin, host: window.location.host, custom: false });

  const dirtyScenes = useRef(new Map());
  const dirtyShots = useRef(new Map());
  const dirtyList = useRef(null);
  const saveTimer = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function applyData(data) {
    setShotlist(data.shotlist);
    setDays(data.days || []);
    setScenes(data.scenes || []);
    setCharacters(data.characters || []);
    setBreaks(data.breaks || []);
    setTimelines(data.timelines || []);
    setTotals(data.totals || null);
    setShotCount(data.shot_count || 0);
    setLocations(data.locations || []);
    setActivity(data.activity || []);
    setPlan(data.plan || null);
    // Stay on the day you were on; fall back to the first one.
    setActiveDayId(prev => {
      const list = data.days || [];
      if (prev && list.some(d => d.id === prev)) return prev;
      return list.length ? list[0].id : null;
    });
  }

  const load = useCallback(async () => {
    const data = await api.get(`/shotlists/${id}`);
    applyData(data);
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
    const sceneEntries = [...dirtyScenes.current.entries()];
    dirtyScenes.current.clear();
    const shotEntries = [...dirtyShots.current.entries()];
    dirtyShots.current.clear();
    const listPatch = dirtyList.current;
    dirtyList.current = null;
    if (!sceneEntries.length && !shotEntries.length && !listPatch) return;
    try {
      for (const [sceneId, patch] of sceneEntries) {
        await api.put(`/shotlists/${id}/scenes/${sceneId}`, patch);
      }
      for (const [shotId, patch] of shotEntries) {
        await api.put(`/shotlists/${id}/shots/${shotId}`, patch);
      }
      if (listPatch) await api.put(`/shotlists/${id}`, listPatch);
      setSaveState('saved');
      // Light windows, timelines and totals are all resolved server-side, so
      // pull everything back after a save — but only if nothing new has been
      // typed since, or the refetch would overwrite it.
      const data = await api.get(`/shotlists/${id}`);
      if (dirtyScenes.current.size === 0 && dirtyShots.current.size === 0 && !dirtyList.current) {
        applyData(data);
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

  function handleSceneChange(sceneId, patch) {
    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, ...patch } : s));
    dirtyScenes.current.set(sceneId, { ...(dirtyScenes.current.get(sceneId) || {}), ...patch });
    // Moving a scene to another day restructures the tabs, so save it now.
    if (patch.day_id !== undefined) {
      clearTimeout(saveTimer.current);
      setSaveState('saving');
      flush().catch(() => {});
      return;
    }
    queueSave();
  }

  function handleShotChange(shotId, patch) {
    setScenes(prev => prev.map(scene => ({
      ...scene,
      shots: (scene.shots || []).map(s => s.id === shotId ? { ...s, ...patch } : s),
    })));
    dirtyShots.current.set(shotId, { ...(dirtyShots.current.get(shotId) || {}), ...patch });
    // Moving a shot between scenes restructures the stack, so save it now.
    if (patch.scene_id !== undefined) {
      clearTimeout(saveTimer.current);
      setSaveState('saving');
      flush().then(load).catch(() => {});
      return;
    }
    queueSave();
  }

  function handleListChange(patch) {
    setShotlist(prev => ({ ...prev, ...patch }));
    dirtyList.current = { ...(dirtyList.current || {}), ...patch };
    queueSave();
  }

  // The cast of one shot is stored as links, not as a column, so it saves
  // straight away rather than riding along with the debounced patches.
  async function handleShotCharacters(shot, characterIds) {
    const picked = characterIds
      .map(cid => characters.find(c => c.id === cid))
      .filter(Boolean);
    setScenes(prev => prev.map(scene => ({
      ...scene,
      shots: (scene.shots || []).map(s => s.id === shot.id ? { ...s, characters: picked } : s),
    })));
    try {
      setSaveState('saving');
      await api.put(`/shotlists/${id}/shots/${shot.id}/characters`, { characterIds });
      setSaveState('saved');
    } catch (err) { setSaveState('error'); }
  }

  async function addExtra() {
    try {
      const res = await api.post(`/shotlists/${id}/characters/extra`, {});
      const data = await api.get(`/shotlists/${id}`);
      applyData(data);
      return res;
    } catch (err) {
      alert(err.message || 'Could not add the extra');
      return null;
    }
  }

  async function addDay() {
    try {
      const res = await api.post(`/shotlists/${id}/days`, {});
      await load();
      setActiveDayId(res.id);
    } catch (err) { alert(err.message || 'Could not add the day'); }
  }

  async function addScene() {
    try {
      setSaveState('saving');
      await flush();
      const res = await api.post(`/shotlists/${id}/scenes`, { day_id: activeDayId });
      await load();
      setExpandedSceneId(res.id);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      alert(err.message || 'Could not add the scene');
    }
  }

  async function duplicateScene(scene) {
    try {
      await flush();
      await api.post(`/shotlists/${id}/scenes/${scene.id}/duplicate`, {});
      await load();
    } catch (err) { alert(err.message || 'Could not duplicate the scene'); }
  }

  async function deleteScene(scene) {
    const count = (scene.shots || []).length;
    if (!confirm(`Delete "${scene.title || 'this scene'}"${count ? ` and its ${count} shot${count === 1 ? '' : 's'}` : ''}? This cannot be undone.`)) return;
    try {
      dirtyScenes.current.delete(scene.id);
      await api.del(`/shotlists/${id}/scenes/${scene.id}`);
      await load();
    } catch (err) { alert(err.message || 'Could not delete the scene'); }
  }

  async function addShot(scene) {
    try {
      setSaveState('saving');
      await flush();
      const res = await api.post(`/shotlists/${id}/scenes/${scene.id}/shots`, {});
      await load();
      setExpandedShotId(res.id);
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

  // Scenes are dragged within a day, but sort_order is global — so the reorder
  // call carries every scene, with only this day's positions rewritten.
  async function handleSceneDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const dayScenes = scenes.filter(s => s.day_id === activeDayId);
    const ids = dayScenes.map(s => `scene-${s.id}`);
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextDayScenes = arrayMove(dayScenes, oldIndex, newIndex);

    let cursor = 0;
    const next = scenes.map(s => (s.day_id === activeDayId ? nextDayScenes[cursor++] : s));
    setScenes(next);
    try {
      setSaveState('saving');
      await api.patch(`/shotlists/${id}/scenes/reorder`, { sceneIds: next.map(s => s.id) });
      await load();
      setSaveState('saved');
    } catch (err) { setSaveState('error'); }
  }

  async function handleShotsReorder(scene, nextShots) {
    setScenes(prev => prev.map(s => s.id === scene.id ? { ...s, shots: nextShots } : s));
    try {
      setSaveState('saving');
      await api.patch(`/shotlists/${id}/scenes/${scene.id}/shots/reorder`, { shotIds: nextShots.map(s => s.id) });
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

  const sceneCounts = useMemo(() => {
    const map = new Map();
    scenes.forEach(s => map.set(s.day_id, (map.get(s.day_id) || 0) + 1));
    return map;
  }, [scenes]);

  if (loading || !shotlist) return (
    <div className="page-header"><h1 className="page-title">Shot list</h1></div>
  );

  const isPublished = shotlist.status === 'published';
  const publicUrl = shotlist.slug ? `${base.base}/shotlist/${shotlist.slug}` : null;
  const completed = scenes.reduce((n, s) => n + (s.shots || []).filter(sh => sh.status === 'completed').length, 0);

  const activeDay = days.find(d => d.id === activeDayId) || null;
  const dayScenes = scenes.filter(s => s.day_id === activeDayId);
  const dayBreaks = breaks.filter(b => b.day_id === activeDayId);
  const dayTimeline = timelines.find(t => t.day_id === activeDayId) || null;
  const dayPlan = plan && plan.days && activeDayId != null ? plan.days[activeDayId] : null;

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
          <button className="btn-ghost" style={{ padding: '3px 5px', color: copied ? 'var(--success)' : undefined }} onClick={() => copyText(publicUrl)} title={`Copy crew link (${base.host})`}>
            {copied ? <Check size={12} /> : <Link2 size={12} />}
          </button>
          {/* Which domain a copied link points at, the same way the pitch
              share control shows it. */}
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{base.host}</span>
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
          {days.length} day{days.length === 1 ? '' : 's'} · {scenes.length} scene{scenes.length === 1 ? '' : 's'} · {shotCount} shot{shotCount === 1 ? '' : 's'}
          {totals ? ` · ${fmtDuration(totals.on_set_minutes)} on set · ${fmtClip(totals.clip_seconds)} of clips` : ''}
          {completed ? ` · ${completed} complete` : ''}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowActivity(true)}>
          <History size={13} /> Activity
        </button>
        <button className="btn btn-ghost btn-sm" onClick={resetStatuses}>
          <RotateCcw size={13} /> Reset statuses
        </button>
      </div>

      <DayTabs
        days={days}
        activeDayId={activeDayId}
        counts={sceneCounts}
        onSelect={setActiveDayId}
        onAdd={addDay}
        onEdit={setEditingDay}
      />

      <div className="shotlist-editor">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          {dayTimeline && (
            <DayTotals day={activeDay} totals={dayTimeline.totals} warnings={dayTimeline.warnings || []} />
          )}

          {dayScenes.length === 0 && (
            <div className="card" style={{ padding: '32px 20px', textAlign: 'center' }}>
              <Clapperboard size={28} color="var(--text-muted)" style={{ margin: '0 auto 10px', display: 'block' }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>
                Nothing on {dayLabel(activeDay)} yet. Start with a scene: set where it happens and in what
                light, then add the shots inside it.
              </p>
            </div>
          )}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSceneDragEnd}>
            <SortableContext items={dayScenes.map(s => `scene-${s.id}`)} strategy={verticalListSortingStrategy}>
              {dayScenes.map((scene, i) => (
                <SortableScene
                  key={scene.id}
                  shotlistId={id}
                  scene={scene}
                  index={i}
                  expanded={expandedSceneId === scene.id}
                  onToggle={sid => setExpandedSceneId(prev => prev === sid ? null : sid)}
                  onChange={handleSceneChange}
                  onDelete={deleteScene}
                  onDuplicate={duplicateScene}
                  locations={locations}
                  windows={windows}
                  scenes={scenes}
                  days={days}
                  characters={characters}
                  shotlist={shotlist}
                  aiEnabled={aiEnabled}
                  onReload={load}
                  expandedShotId={expandedShotId}
                  onToggleShot={sid => setExpandedShotId(prev => prev === sid ? null : sid)}
                  onShotChange={handleShotChange}
                  onShotDelete={deleteShot}
                  onShotDuplicate={duplicateShot}
                  onAddShot={addShot}
                  onShotsReorder={handleShotsReorder}
                  onShotCharactersChange={handleShotCharacters}
                  onAddExtra={addExtra}
                />
              ))}
            </SortableContext>
          </DndContext>

          <button className="btn btn-secondary" style={{ justifyContent: 'center' }} onClick={addScene}>
            <Plus size={15} /> Add scene to {dayLabel(activeDay)}
          </button>

          <TimelinePreview timeline={dayTimeline} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          <LocationsPanel shotlistId={id} locations={locations} onChanged={load} />
          <CharactersPanel
            shotlistId={id}
            shotlist={shotlist}
            base={base}
            characters={characters}
            onChanged={load}
            onAddExtra={addExtra}
            onReload={load}
          />
          <BreaksPanel
            shotlistId={id}
            dayId={activeDayId}
            breaks={dayBreaks}
            scenes={dayScenes}
            timeline={dayTimeline}
            onChanged={load}
          />
          <OrganizePanel
            shotlistId={id}
            day={activeDay}
            scenes={dayScenes}
            plan={dayPlan}
            onPlanned={res => setPlan(prev => ({
              ...(prev || {}),
              days: {
                ...((prev && prev.days) || {}),
                [res.day_id]: { plan: res.plan, comparison: res.comparison, current: res.current },
              },
            }))}
            onApplied={async () => { await load(); }}
          />
        </div>
      </div>

      {editingDay && (
        <DayModal
          shotlistId={id}
          day={editingDay}
          sceneCount={sceneCounts.get(editingDay.id) || 0}
          canDelete={days.length > 1 && !(sceneCounts.get(editingDay.id) || 0)}
          onClose={() => setEditingDay(null)}
          onSaved={load}
        />
      )}

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
          <p className="shotlist-hint" style={{ marginTop: 0 }}>
            Each shoot day carries its own date and times — these two stay for anything made before days existed.
          </p>

          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">Default wrap out (minutes)</label>
              <input className="input" type="number" min="0" step="5" value={shotlist.move_wrap_minutes ?? 20}
                onChange={e => handleListChange({ move_wrap_minutes: Number(e.target.value) })} />
            </div>
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">Default set up (minutes)</label>
              <input className="input" type="number" min="0" step="5" value={shotlist.move_setup_minutes ?? 25}
                onChange={e => handleListChange({ move_setup_minutes: Number(e.target.value) })} />
            </div>
          </div>
          <p className="shotlist-hint" style={{ marginTop: 0 }}>
            Every company move is wrap out + travel + set up. A scene can override both.
          </p>

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
