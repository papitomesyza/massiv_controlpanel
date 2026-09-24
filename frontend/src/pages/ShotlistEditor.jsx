import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Plus, X, Trash2, GripVertical, ChevronDown, ChevronRight, Copy,
  Globe, EyeOff, Link2, Check, Settings2, MapPin, KeyRound, FileText, Image as ImageIcon,
  Loader2, Wand2, History, RotateCcw, Sun, Clapperboard, Lock, Unlock, Users, UserPlus,
  Truck, Coffee, CalendarDays, Timer, Film, AlertTriangle, Share2, ArrowRight,
  CalendarCheck, User, UserCog, Home, Trees, ExternalLink,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Overlay from '../components/Overlay';
import DateField from '../components/DateField';
import Ring from '../components/Ring';
import { IconToggles } from '../components/DbBits';
import { DialogProvider, useDialogs } from '../components/Dialogs';
import LocationPicker from '../components/LocationPicker';
import OpusPolish, { useAiPolishAvailable } from '../components/OpusPolish';
import { api, fmtDate } from '../api';
import { pristinaDateOf, pristinaTimeOf } from '../lib/pristinaDate';
import '../styles/mind.css';
import '../styles/production.css';

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

// "6h 45m": how a call sheet writes a duration.
function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

// "30 to 40", "40+", "under 12": the age a role is cast for, worded exactly as
// the crew page and the PDFs word it.
function fmtAgeRange(min, max) {
  const lo = min == null || min === '' ? null : Number(min);
  const hi = max == null || max === '' ? null : Number(max);
  if (lo == null && hi == null) return '';
  if (lo != null && hi == null) return `${lo}+`;
  if (lo == null && hi != null) return `under ${hi}`;
  if (lo === hi) return String(lo);
  return `${lo} to ${hi}`;
}

// "2:05": clip seconds as a running time.
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

// The web copy is only ever a .webp when the upload was animated; stills are
// always written as .jpg, so the flag needs no column of its own.
function isAnimated(m) {
  return /\.webp$/i.test((m && m.filename) || '');
}

function dayLabel(day) {
  if (!day) return 'Day';
  return `Day ${day.day_number || 1}`;
}

// A time range as the app shows it: the two times either side of an arrow.
// Server labels arrive as "09:00 to 11:30", the public wording.
function TimeRange({ label }) {
  const parts = String(label || '').split(' to ');
  if (parts.length !== 2) return <>{label}</>;
  return <span className="prod-range">{parts[0]}<ArrowRight size={10} />{parts[1]}</span>;
}

// A stored UTC stamp shown on the Pristina clock.
function pristinaStamp(instant) {
  const date = pristinaDateOf(instant);
  const time = pristinaTimeOf(instant);
  if (!date) return '';
  return `${fmtDate(date)} ${time || ''}`.trim();
}

// Save state as a dot: muted when saved, pulsing while saving, ember on failure.
function SaveDot({ state }) {
  const title = state === 'saving' ? 'Saving' : state === 'error' ? 'Save failed' : 'Saved';
  return (
    <span className="prod-save" title={title} aria-label={title}>
      <span className={`db-dot ${state === 'saving' ? 'saving' : state === 'error' ? '' : 'muted'}`} />
    </span>
  );
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
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }} title={hint}>
        <input className="input" type="time" style={{ flex: 1 }} value={value || ''}
          onChange={e => onChange(e.target.value || null)} />
        {value && (
          <button type="button" className="db-iconbtn" title="Unlock" aria-label="Unlock" onClick={() => onChange(null)}>
            <Unlock size={15} />
          </button>
        )}
      </div>
    </Field>
  );
}

// ── The shot list's media library ────────────────────────────────────────────
// Upload once, use anywhere. Every attach point can either upload a new file or
// pick from what is already here, so the same location photo does not get
// uploaded three times to be a scout photo, an angle and a reference.

function LibraryModal({ shotlistId, library, onClose, onPick }) {
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function toggle(m) {
    setChosen(prev => (prev.some(x => x.id === m.id)
      ? prev.filter(x => x.id !== m.id)
      : [...prev, m]));
  }

  async function use() {
    if (!chosen.length) return;
    setBusy(true);
    setError('');
    try {
      await onPick(chosen);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not use those');
      setBusy(false);
    }
  }

  return (
    <Overlay
      title={<ImageIcon size={16} />}
      label="Library"
      onClose={onClose}
      dirty={chosen.length > 0}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={use} disabled={busy || !chosen.length} title="Use" aria-label="Use">
          {busy ? <Loader2 size={15} className="pitch-spin" /> : <Check size={15} />}
          {chosen.length ? ` ${chosen.length}` : ''}
        </button>
      </>}
    >
      {library.length === 0 ? (
        <div className="db-empty"><ImageIcon size={24} /></div>
      ) : (
        <>
          <div className="shotlist-library-grid">
            {library.map(m => {
              const on = chosen.some(x => x.id === m.id);
              return (
                <button
                  key={m.id} type="button"
                  className={`shotlist-library-item${on ? ' on' : ''}`}
                  onClick={() => toggle(m)}
                  title={m.label || ''}
                >
                  <img src={`/shotlist-media/${m.thumb_filename || m.filename}`} alt="" />
                  {isAnimated(m) && <span className="shotlist-library-gif">GIF</span>}
                  {on && <span className="shotlist-library-tick"><Check size={12} /></span>}
                  {m.label && <span className="shotlist-library-label">{m.label}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      {error && <p className="prod-error">{error}</p>}
    </Overlay>
  );
}

// The panel: everything uploaded to this shot list, with where it is used.
function LibraryPanel({ shotlistId, library, onChanged }) {
  const { notify, ask } = useDialogs();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

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
        await api.post(`/shotlists/${shotlistId}/library`, {
          filename: res.filename, thumb_filename: res.thumb,
        });
      }
      await onChanged();
    } catch (err) {
      notify('Upload failed', err.message || 'The image could not be uploaded.');
    } finally {
      setUploading(false);
    }
  }

  async function rename(m, label) {
    try {
      await api.put(`/shotlists/${shotlistId}/library/${m.id}`, { label });
      await onChanged();
    } catch (err) { notify('Not renamed', err.message || 'Could not rename it.'); }
  }

  async function remove(m) {
    try {
      await api.del(`/shotlists/${shotlistId}/library/${m.id}`);
      await onChanged();
    } catch (err) {
      // Used somewhere: say where, and offer to take it out everywhere.
      if (/used in/.test(err.message || '')) {
        const ok = await ask({
          title: 'Delete it everywhere it is used?',
          message: err.message,
          confirmLabel: 'Delete',
          tone: 'danger',
        });
        if (!ok) return;
        try {
          await api.del(`/shotlists/${shotlistId}/library/${m.id}?detach=1`);
          await onChanged();
        } catch (e2) { notify('Not removed', e2.message || 'Could not remove it.'); }
      } else {
        notify('Not removed', err.message || 'Could not remove it.');
      }
    }
  }

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head" title="Library">
        <ImageIcon size={14} color="var(--accent)" />
        <span className="db-count"><span className="db-dot" />{library.length}</span>
        <button className="db-iconbtn" onClick={() => inputRef.current?.click()} disabled={uploading} title="Upload" aria-label="Upload">
          {uploading ? <Loader2 size={15} className="pitch-spin" /> : <Plus size={15} />}
        </button>
      </div>

      <div className="shotlist-library-grid">
        {library.map(m => (
          <div key={m.id} className="shotlist-library-row">
            <div style={{ position: 'relative' }}>
              <img src={`/shotlist-media/${m.thumb_filename || m.filename}`} alt="" />
              {isAnimated(m) && <span className="shotlist-library-gif">GIF</span>}
              <button type="button" className="shotlist-library-x" title="Remove from the library"
                onClick={() => remove(m)}>
                <X size={10} />
              </button>
            </div>
            <input className="input" defaultValue={m.label || ''}
              onBlur={e => { if ((e.target.value || '') !== (m.label || '')) rename(m, e.target.value); }} />
            <span className="shotlist-library-used" title={m.used_count ? `Used ${m.used_count}` : 'Unused'}>
              {m.used_count ? <span className="db-count"><span className="db-dot" />{m.used_count}</span> : <span className="db-dot muted" />}
            </span>
          </div>
        ))}
      </div>

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
        style={{ display: 'none' }} onChange={handleFiles} />
    </div>
  );
}

// ── Shot media picker (reference / angle) ────────────────────────────────────

function MediaPicker({ shotlistId, shot, kind, library, onChanged }) {
  const { notify } = useDialogs();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const items = (shot.media || []).filter(m => m.kind === kind);

  async function attach(list) {
    for (const m of list) {
      await api.post(`/shotlists/${shotlistId}/shots/${shot.id}/media`, {
        kind, filename: m.filename, thumb_filename: m.thumb_filename,
      });
    }
    await onChanged();
  }

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
      notify('Upload failed', err.message || 'The image could not be uploaded.');
    } finally {
      setUploading(false);
    }
  }

  async function remove(m) {
    try {
      await api.del(`/shotlists/${shotlistId}/media/${m.id}`);
      await onChanged();
    } catch (err) { notify('Not removed', err.message || 'Could not remove the image.'); }
  }

  return (
    <Field label={<>{kind === 'angle' ? 'Angles' : 'References'} <span className="db-count"><span className="db-dot" />{items.length}</span></>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {items.map(m => (
          <div key={m.id} style={{ position: 'relative' }}>
            <img src={thumbFor(m)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border-default)' }} />
            {isAnimated(m) && (
              <span title="Animated, plays full size" style={{
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
        <button
          type="button"
          onClick={() => setPicking(true)}
          title="Choose from the shot list library"
          style={{
            width: 56, height: 56, borderRadius: 6, border: '1px dashed var(--border-default)',
            background: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <ImageIcon size={15} />
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
          style={{ display: 'none' }} onChange={handleFiles} />
      </div>
      {picking && (
        <LibraryModal shotlistId={shotlistId} library={library || []}
          onClose={() => setPicking(false)} onPick={attach} />
      )}
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
    <Field label={<>Cast <span className="db-count"><span className="db-dot" />{chosen.size}</span></>}>
      <div className="shotlist-char-picker">
        {characters.map(c => (
          <button
            key={c.id}
            type="button"
            className={`shotlist-char-chip${chosen.has(c.id) ? ' on' : ''}`}
            onClick={() => toggle(c.id)}
            title={[c.name, fmtAgeRange(c.age_min, c.age_max) && `age ${fmtAgeRange(c.age_min, c.age_max)}`, c.performer]
              .filter(Boolean).join(' · ')}
          >
            {c.photo_thumb_filename || c.photo_filename ? (
              <img src={`/shotlist-media/${c.photo_thumb_filename || c.photo_filename}`} alt="" />
            ) : (
              <Users size={10} />
            )}
            {c.name}
          </button>
        ))}
        <button type="button" className="shotlist-char-chip add" onClick={addExtra} disabled={adding} title="Add an extra" aria-label="Add an extra">
          {adding ? <Loader2 size={10} className="pitch-spin" /> : <UserPlus size={10} />}
        </button>
      </div>
    </Field>
  );
}

// ── Scout photos, on the scene ───────────────────────────────────────────────
// The recce brings back the place, not a framing: the room, the approach, where
// the power is. That is true of every shot taken there, so it lives on the
// scene. Each photo can be named, which is what makes it useful on the day.

function ScoutPicker({ shotlistId, scene, library, onChanged }) {
  const { notify } = useDialogs();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const items = scene.scout_photos || [];

  async function attach(list) {
    for (const m of list) {
      await api.post(`/shotlists/${shotlistId}/scenes/${scene.id}/media`, {
        filename: m.filename, thumb_filename: m.thumb_filename, label: m.label || null,
      });
    }
    await onChanged();
  }

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
        await api.post(`/shotlists/${shotlistId}/scenes/${scene.id}/media`, {
          filename: res.filename, thumb_filename: res.thumb,
        });
      }
      await onChanged();
    } catch (err) {
      notify('Upload failed', err.message || 'The image could not be uploaded.');
    } finally {
      setUploading(false);
    }
  }

  async function rename(m, label) {
    try {
      await api.put(`/shotlists/${shotlistId}/scene-media/${m.id}`, { label });
      await onChanged();
    } catch (err) { notify('Not renamed', err.message || 'Could not rename the photo.'); }
  }

  async function remove(m) {
    try {
      await api.del(`/shotlists/${shotlistId}/scene-media/${m.id}`);
      await onChanged();
    } catch (err) { notify('Not removed', err.message || 'Could not remove the photo.'); }
  }

  return (
    <Field label={<>Scout <span className="db-count"><span className="db-dot" />{items.length}</span></>}>
      <div className="shotlist-wardrobe">
        {items.map(m => (
          <div key={m.id} className="shotlist-wardrobe-item shotlist-scout-item">
            <div style={{ position: 'relative' }}>
              <img src={`/shotlist-media/${m.thumb_filename || m.filename}`} alt="" />
              {isAnimated(m) && (
                <span title="Animated" style={{
                  position: 'absolute', bottom: 2, left: 2, fontSize: '8px', fontWeight: 800,
                  padding: '1px 3px', borderRadius: 3, background: 'rgba(0,0,0,0.72)', color: '#fff',
                }}>GIF</span>
              )}
              <button type="button" title="Remove this photo" onClick={() => remove(m)}
                className="shotlist-wardrobe-x">
                <X size={10} />
              </button>
            </div>
            <input
              className="input" defaultValue={m.label || ''}
              onBlur={e => { if ((e.target.value || '') !== (m.label || '')) rename(m, e.target.value); }}
            />
          </div>
        ))}
        <button type="button" className="shotlist-wardrobe-add shotlist-scout-add"
          onClick={() => inputRef.current?.click()} disabled={uploading} title="Upload">
          {uploading ? <Loader2 size={15} className="pitch-spin" /> : <Plus size={15} />}
        </button>
        <button type="button" className="shotlist-wardrobe-add shotlist-scout-add"
          onClick={() => setPicking(true)} title="Choose from the shot list library">
          <ImageIcon size={15} />
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
          style={{ display: 'none' }} onChange={handleFiles} />
      </div>
      {picking && (
        <LibraryModal shotlistId={shotlistId} library={library || []}
          onClose={() => setPicking(false)} onPick={attach} />
      )}
    </Field>
  );
}

// ── One shot, inside its scene ───────────────────────────────────────────────

function SortableShot({
  shotlistId, shot, index, expanded, onToggle, onChange, onDelete, onDuplicate,
  scenes, characters, library, aiEnabled, onMediaChanged, onCharactersChange, onAddExtra,
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
          {shot.title || ''}
        </span>
        {shot.locked_start_time && (
          <span className="shotlist-chip hard" title={`Locked to ${shot.locked_start_time}`}>
            <Lock size={9} /> {shot.locked_start_time}
          </span>
        )}
        {shot.shot_type && <span className="shotlist-chip">{shot.shot_type}</span>}
        <span className="shotlist-chip" title="Capture time">{shot.duration_minutes || 30}m</span>
        {shot.clip_length_seconds ? (
          <span className="shotlist-chip" title="Clip length"><Film size={9} /> {fmtClip(shot.clip_length_seconds)}</span>
        ) : null}
        {(shot.characters || []).length > 0 && (
          <span className="shotlist-chip" title={(shot.characters || []).map(c => c.name).join(', ')}>
            <Users size={9} /> {(shot.characters || []).length}
          </span>
        )}
        <button className="db-iconbtn sm" title="Duplicate shot" aria-label="Duplicate shot"
          onClick={e => { e.stopPropagation(); onDuplicate(shot); }}>
          <Copy size={12} />
        </button>
        <button className="db-iconbtn sm danger" title="Delete shot" aria-label="Delete shot"
          onClick={e => { e.stopPropagation(); onDelete(shot); }}>
          <Trash2 size={12} />
        </button>
        {expanded ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
      </div>

      {expanded && (
        <div className="shotlist-shot-body">
          <div className="shotlist-field-row">
            <TextField label="Shot number" value={shot.shot_number} onChange={v => onChange(shot.id, { shot_number: v })} />
            <TextField label="Title" value={shot.title} onChange={v => onChange(shot.id, { title: v })} />
          </div>

          <TextField
            label="Description" value={shot.description} onChange={v => onChange(shot.id, { description: v })}
            textarea polish aiEnabled={aiEnabled}
          />

          <div className="shotlist-field-row">
            <SelectField
              label="Shot type" value={shot.shot_type || ''} onChange={v => onChange(shot.id, { shot_type: v })}
              options={[{ value: '', label: '' }, ...SHOT_TYPES.map(t => ({ value: t, label: t }))]}
            />
            {/* The two durations are different things and are labelled so they
                can never be confused: one is time on the day, one is screen time. */}
            <Field label="Capture (min)">
              <input className="input" type="number" min="5" step="5" value={shot.duration_minutes || 30}
                onChange={e => onChange(shot.id, { duration_minutes: Number(e.target.value) })} />
            </Field>
          </div>

          <div className="shotlist-field-row">
            <Field label="Clip (sec)">
              <input className="input" type="number" min="0" step="1"
                value={shot.clip_length_seconds == null ? '' : shot.clip_length_seconds}
                onChange={e => onChange(shot.id, {
                  clip_length_seconds: e.target.value === '' ? null : Number(e.target.value),
                })} />
            </Field>
            <LockField
              label={<Lock size={11} />}
              value={shot.locked_start_time}
              onChange={v => onChange(shot.id, { locked_start_time: v })}
              hint="A locked shot pins its scene to this minute, ahead of the light."
            />
          </div>

          <div className="shotlist-field-row">
            <SelectField
              label="Lens" value={shot.lens || ''} onChange={v => onChange(shot.id, { lens: v || null })}
              options={[{ value: '', label: '' }, ...LENSES.map(([value, label]) => ({ value, label }))]}
            />
            <TextField label="Focal length" value={shot.lens_detail}
              onChange={v => onChange(shot.id, { lens_detail: v })} />
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
            label="Set design" value={shot.set_design}
            onChange={v => onChange(shot.id, { set_design: v })} textarea rows={2}
          />
          <TextField
            label="Camera notes" value={shot.camera_notes} onChange={v => onChange(shot.id, { camera_notes: v })}
            textarea polish aiEnabled={aiEnabled}
          />

          {scenes.length > 1 && (
            <SelectField
              label={<Clapperboard size={11} />} value={String(shot.scene_id)}
              onChange={v => onChange(shot.id, { scene_id: Number(v) })}
              options={scenes.map(sc => ({ value: String(sc.id), label: `${sc.scene_number ? `${sc.scene_number}. ` : ''}${sc.title || ''}` }))}
            />
          )}

          <MediaPicker shotlistId={shotlistId} shot={shot} kind="reference" library={library} onChanged={onMediaChanged} />
          <MediaPicker shotlistId={shotlistId} shot={shot} kind="angle" library={library} onChanged={onMediaChanged} />
        </div>
      )}
    </div>
  );
}

// ── One scene, with its shots inside ─────────────────────────────────────────

function SortableScene({
  shotlistId, scene, index, expanded, onToggle, onChange, onDelete, onDuplicate,
  locations, windows, scenes, days, characters, library, shotlist, aiEnabled, onReload,
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
        <span className="shotlist-scene-title">{scene.title || ''}</span>
        <span className="shotlist-chip" title={scene.space === 'interior' ? 'Interior' : 'Exterior'}>
          {scene.space === 'interior' ? <Home size={9} /> : <Trees size={9} />}
        </span>
        {lockTime && (
          <span className="shotlist-chip hard" title={scene.locked_start_time ? `Scene locked to ${lockTime}` : `A shot in this scene is locked to ${lockTime}`}>
            <Lock size={9} /> {lockTime}
          </span>
        )}
        {scene.light_window_label && (
          <span className={`shotlist-chip${scene.light_window_hard ? ' hard' : ''}`} title={`${scene.light_window_label} ${scene.light_window_range || ''}`.trim()}>
            <Sun size={9} />
          </span>
        )}
        <span className="shotlist-chip" title="Shots"><Film size={9} /> {shots.length}</span>
        {(scene.scout_photos || []).length > 0 && (
          <span className="shotlist-chip" title="Scout photos">
            <ImageIcon size={9} /> {scene.scout_photos.length}
          </span>
        )}
        <span className="shotlist-chip" title="Capture time"><Timer size={9} /> {fmtDuration(scene.duration_minutes)}</span>
        {scene.clip_seconds ? (
          <span className="shotlist-chip" title="Clip length">
            <Film size={9} /> {fmtClip(scene.clip_seconds)}
          </span>
        ) : null}
        <button className="db-iconbtn sm" title="Duplicate scene with its shots" aria-label="Duplicate scene"
          onClick={e => { e.stopPropagation(); onDuplicate(scene); }}>
          <Copy size={13} />
        </button>
        <button className="db-iconbtn sm danger" title="Delete scene" aria-label="Delete scene"
          onClick={e => { e.stopPropagation(); onDelete(scene); }}>
          <Trash2 size={13} />
        </button>
        {expanded ? <ChevronDown size={15} color="var(--text-muted)" /> : <ChevronRight size={15} color="var(--text-muted)" />}
      </div>

      {expanded && (
        <div className="shotlist-scene-body">
          <div className="shotlist-field-row">
            <TextField label="Number" value={scene.scene_number} onChange={v => onChange(scene.id, { scene_number: v })} />
            <TextField label="Title" value={scene.title} onChange={v => onChange(scene.id, { title: v })} />
          </div>

          <TextField
            label="Description" value={scene.description} onChange={v => onChange(scene.id, { description: v })}
            textarea rows={4} polish aiEnabled={aiEnabled}
          />

          <SelectField
            label="Location" value={scene.location_id == null ? '' : String(scene.location_id)}
            onChange={v => onChange(scene.id, { location_id: v ? Number(v) : null })}
            options={[{ value: '', label: '' }, ...locations.map(l => ({ value: String(l.id), label: l.name }))]}
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
            <p className="shotlist-window-note" title={scene.light_window_approximate ? 'Approximate until the location is pinned' : undefined}>
              <Sun size={11} /> <TimeRange label={scene.light_window_range} />
              {scene.light_window_approximate && <span className="db-dot muted" />}
            </p>
          )}

          <div className="shotlist-field-row">
            {days.length > 1 ? (
              <SelectField
                label={<CalendarDays size={11} />} value={scene.day_id == null ? '' : String(scene.day_id)}
                onChange={v => onChange(scene.id, { day_id: v ? Number(v) : null })}
                options={days.map(d => ({
                  value: String(d.id),
                  label: `${dayLabel(d)}${d.shoot_date ? ` · ${fmtDate(d.shoot_date)}` : ''}`,
                }))}
              />
            ) : <div style={{ flex: 1 }} />}
            <LockField
              label={<Lock size={11} />}
              value={scene.locked_start_time}
              onChange={v => onChange(scene.id, { locked_start_time: v })}
              hint="Immovable. It outranks the light window and the optimiser."
            />
          </div>

          {/* Set design lives on the scene: that is the room, the dressing, the
              world. A shot only records where it deviates. */}
          <TextField
            label="Set design" value={scene.set_design}
            onChange={v => onChange(scene.id, { set_design: v })} textarea rows={3} polish aiEnabled={aiEnabled}
          />

          {/* Company move into this scene; empty fields take the shot list defaults. */}
          <div className="shotlist-move-fields">
            <div className="shotlist-move-title" title="Company move into this scene">
              <Truck size={12} />
            </div>
            <div className="shotlist-field-row">
              <Field label="Wrap out (min)">
                <input
                  className="input" type="number" min="0" step="5"
                  placeholder={String(shotlist.move_wrap_minutes ?? 20)}
                  value={scene.move_wrap_minutes == null ? '' : scene.move_wrap_minutes}
                  onChange={e => onChange(scene.id, {
                    move_wrap_minutes: e.target.value === '' ? null : Number(e.target.value),
                  })}
                />
              </Field>
              <Field label="Set up (min)">
                <input
                  className="input" type="number" min="0" step="5"
                  placeholder={String(shotlist.move_setup_minutes ?? 25)}
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
              hint="When the unit actually travels. Empty leaves as soon as the previous scene ends."
            />
          </div>

          <TextField label="Notes" value={scene.notes} onChange={v => onChange(scene.id, { notes: v })} textarea rows={2} />

          <ScoutPicker shotlistId={shotlistId} scene={scene} library={library} onChanged={onReload} />

          {/* Coverage */}
          <div className="shotlist-shots-header">
            <span title="Shots"><Film size={13} /></span>
            <button className="db-iconbtn" onClick={() => onAddShot(scene)} title="Add shot" aria-label="Add shot">
              <Plus size={15} />
            </button>
          </div>

          {shots.length === 0 ? null : (
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
                      library={library}
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

function DayTabs({ days, activeDayId, counts, onSelect, onAdd, onEdit, drift }) {
  return (
    <div className="shotlist-day-tabs">
      {days.map((d, i) => (
        <button
          key={d.id}
          className={`shotlist-day-tab${d.id === activeDayId ? ' on' : ''}`}
          onClick={() => onSelect(d.id)}
        >
          <CalendarDays size={12} />
          <span className="shotlist-day-tab-name">{dayLabel(d)}</span>
          {d.shoot_date && <span className="shotlist-day-tab-date">{fmtDate(d.shoot_date)}</span>}
          {i === 0 && drift}
          <span className="shotlist-chip" title="Scenes">{counts.get(d.id) || 0}</span>
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
      <button className="db-iconbtn" onClick={onAdd} title="Add a shoot day" aria-label="Add a shoot day">
        <Plus size={15} />
      </button>
    </div>
  );
}

function DayModal({ shotlistId, day, sceneCount, canDelete, onClose, onSaved }) {
  const { ask } = useDialogs();
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
    const ok = await ask({ title: `Delete ${dayLabel(day)}?`, confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
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
    <Overlay
      title={dayLabel(day)}
      onClose={onClose}
      footer={<>
        {canDelete && (
          <button className="db-iconbtn lg danger" style={{ marginRight: 'auto' }} onClick={remove}
            disabled={saving} title="Delete this day" aria-label="Delete this day">
            <Trash2 size={16} />
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </>}
    >
      <div style={{ display: 'flex', gap: '10px' }}>
        <div className="form-row" style={{ width: 90 }}>
          <label className="form-label">Day</label>
          <input className="input" type="number" min="1" value={draft.day_number || 1}
            onChange={e => setDraft({ ...draft, day_number: Number(e.target.value) })} />
        </div>
        <div className="form-row" style={{ flex: 1 }}>
          <label className="form-label">Shoot date</label>
          <DateField value={draft.shoot_date || ''}
            onChange={v => setDraft({ ...draft, shoot_date: v || null })} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <div className="form-row" style={{ flex: 1 }}>
          <label className="form-label" title="When the day may begin. Crew call is derived from the first shot.">Earliest start</label>
          <input className="input" type="time" value={draft.crew_call || ''}
            onChange={e => setDraft({ ...draft, crew_call: e.target.value || null })} />
        </div>
        <div className="form-row" style={{ width: 150 }}>
          <label className="form-label" title="Crew call sits this far before the first shot.">Call offset (min)</label>
          <input className="input" type="number" min="0" step="5" value={draft.crew_call_offset_minutes ?? 30}
            onChange={e => setDraft({ ...draft, crew_call_offset_minutes: Number(e.target.value) })} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" rows={2} value={draft.notes || ''}
          onChange={e => setDraft({ ...draft, notes: e.target.value })} />
      </div>
      {error && <p className="prod-error">{error}</p>}
    </Overlay>
  );
}

// The shape of the day in numbers: the same figures the crew page and the
// call sheet print.
function DayTotals({ day, totals, warnings }) {
  const cells = [
    ['Crew call', totals.crew_call || '', 'strong'],
    ['First shot', totals.first_shot_call || ''],
    ['Wrap', totals.wrap || ''],
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
          <span className="shotlist-chip hard" title="Locked"><Lock size={9} /> {totals.locked_count}</span>
        )}
        {totals.move_count > 0 && (
          <span className="shotlist-chip" title="Company moves"><Truck size={9} /> {totals.move_count}</span>
        )}
      </div>
      <div className="shotlist-day-totals-grid">
        {cells.map(([k, v, strong]) => (
          <div key={k} className={`shotlist-total${strong ? ' strong' : ''}`}>
            <span className="shotlist-total-k">{k}</span>
            <span className="shotlist-total-v">{v || <span className="db-dot muted" />}</span>
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
// A company move is generated between two scenes rather than stored as a row,
// but it is still an event you should be able to click and set, so the
// timeline row opens an editor for it. Everything it holds is editable: when
// the unit leaves, how long the wrap, the travel and the set up take.
function MoveModal({ shotlistId, move, onClose, onSaved }) {
  const [draft, setDraft] = useState({
    move_wrap_minutes: move.wrap_minutes,
    move_travel_minutes: move.travel_overridden ? move.travel_minutes : null,
    move_setup_minutes: move.setup_minutes,
    move_locked_start_time: move.locked_time || null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const travelShown = draft.move_travel_minutes == null
    ? (move.travel_computed_minutes ?? move.travel_minutes)
    : draft.move_travel_minutes;
  const total = (Number(draft.move_wrap_minutes) || 0)
    + (Number(travelShown) || 0)
    + (Number(draft.move_setup_minutes) || 0);

  async function save() {
    setSaving(true); setError('');
    try {
      await api.put(`/shotlists/${shotlistId}/scenes/${move.scene_id}`, draft);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save the company move');
      setSaving(false);
    }
  }

  return (
    <Overlay
      title={<span className="prod-range"><Truck size={15} /> {move.from_name || ''}<ArrowRight size={13} />{move.to_name || ''}</span>}
      label="Company move"
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </>}
    >
      {move.travel_km ? <p className="prod-date" style={{ marginTop: 0 }}>{move.travel_km} km</p> : null}

      <div style={{ display: 'flex', gap: '10px' }}>
        <div className="form-row" style={{ flex: 1 }}>
          <label className="form-label">Wrap out (min)</label>
          <input className="input" type="number" min="0" step="5" value={draft.move_wrap_minutes ?? ''}
            onChange={e => setDraft({ ...draft, move_wrap_minutes: e.target.value === '' ? null : Number(e.target.value) })} />
        </div>
        <div className="form-row" style={{ flex: 1 }}>
          <label className="form-label" title={`Distance estimate ${move.travel_computed_minutes ?? move.travel_minutes} min`}>
            Travel (min) {draft.move_travel_minutes != null && <span className="db-dot" title="Set by hand" />}
          </label>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input className="input" type="number" min="0" step="5" value={travelShown ?? ''}
              onChange={e => setDraft({ ...draft, move_travel_minutes: e.target.value === '' ? null : Number(e.target.value) })} />
            {draft.move_travel_minutes != null && (
              <button type="button" className="db-iconbtn" title="Use the estimate" aria-label="Use the estimate"
                onClick={() => setDraft({ ...draft, move_travel_minutes: null })}>
                <RotateCcw size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="form-row" style={{ flex: 1 }}>
          <label className="form-label">Set up (min)</label>
          <input className="input" type="number" min="0" step="5" value={draft.move_setup_minutes ?? ''}
            onChange={e => setDraft({ ...draft, move_setup_minutes: e.target.value === '' ? null : Number(e.target.value) })} />
        </div>
      </div>

      <div className="form-row">
        <label className="form-label" title="Empty leaves the moment the previous scene ends.">Depart at</label>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input className="input" type="time" style={{ flex: 1 }} value={draft.move_locked_start_time || ''}
            onChange={e => setDraft({ ...draft, move_locked_start_time: e.target.value || null })} />
          {draft.move_locked_start_time && (
            <button type="button" className="db-iconbtn" title="Leave as soon as the previous scene ends" aria-label="Unlock"
              onClick={() => setDraft({ ...draft, move_locked_start_time: null })}>
              <Unlock size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="shotlist-move-total" title="Total on the day">
        <Timer size={13} />
        <b>{fmtDuration(total)}</b>
      </div>

      {error && <p className="prod-error">{error}</p>}
    </Overlay>
  );
}

function TimelinePreview({ shotlistId, timeline, onChanged }) {
  const items = (timeline && timeline.items) || [];
  const [editingMove, setEditingMove] = useState(null);
  if (!items.length) return null;
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head" title="Day timeline">
        <Timer size={14} color="var(--accent)" />
      </div>
      <div className="shotlist-timeline">
        {items.map((it, i) => {
          if (it.kind === 'move') {
            return (
              <div key={`m${i}`} className="shotlist-tl-row move clickable"
                role="button" tabIndex={0}
                title="Set this company move"
                onClick={() => setEditingMove(it)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingMove(it); } }}>
                <span className="shotlist-tl-time">{it.start_label}</span>
                <Truck size={12} />
                <span className="shotlist-tl-title">{it.to_name || ''}</span>
                {it.locked && (
                  <span className="shotlist-chip hard" title="Departs"><Lock size={9} /> {it.locked_time}</span>
                )}
                {(it.overridden || it.travel_overridden) && <span className="db-dot" title="Set by hand" />}
                <span className="shotlist-tl-note"
                  title={`Wrap ${it.wrap_minutes}m, travel ${it.travel_minutes}m, set up ${it.setup_minutes}m${it.hold_minutes > 0 ? `, hold ${fmtDuration(it.hold_minutes)}` : ''}`}>
                  {fmtDuration(it.duration_minutes)}
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
                {it.fixed && <span className="shotlist-chip hard" title="Fixed"><Lock size={9} /></span>}
                {/* The side only means something where a move exists. */}
                {it.placement_applies && (
                  <span className="shotlist-chip" title={it.placement === 'before_move' ? 'Before the move' : 'After the move'}>
                    {it.placement === 'before_move' ? <><Truck size={9} /><ArrowRight size={9} /></> : <><ArrowRight size={9} /><Truck size={9} /></>}
                  </span>
                )}
                {it.end_of_day && <span className="shotlist-chip" title="End of day"><CalendarDays size={9} /></span>}
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
              <span className="shotlist-tl-title">{it.title || ''}</span>
              {it.locked && <span className="shotlist-chip hard"><Lock size={9} /> {it.locked_time}</span>}
              {it.light_window_label && (
                <span className={`shotlist-chip${it.light_window_hard ? ' hard' : ''}`} title={it.light_window_label}><Sun size={9} /></span>
              )}
              <span className="shotlist-tl-note">
                <span title="Shots"><Film size={9} /> {it.shot_count}</span> · {fmtDuration(it.duration_minutes)} · <TimeRange label={`${it.start_label} to ${it.end_label}`} />
              </span>
            </div>
          );
        })}
      </div>

      {editingMove && (
        <MoveModal
          shotlistId={shotlistId}
          move={editingMove}
          onClose={() => setEditingMove(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

// ── Meals and breaks ─────────────────────────────────────────────────────────

function BreaksPanel({ shotlistId, dayId, breaks, scenes, timeline, onChanged }) {
  const { notify, ask } = useDialogs();
  const [busy, setBusy] = useState(false);

  // Which scenes are arrived at by a company move: the only ones where the
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
    } catch (err) { notify('Break not added', err.message || 'Could not add the break.'); }
    finally { setBusy(false); }
  }

  async function patch(b, body) {
    try {
      await api.put(`/shotlists/${shotlistId}/breaks/${b.id}`, body);
      await onChanged();
    } catch (err) { notify('Break not saved', err.message || 'Could not save the break.'); }
  }

  async function remove(b) {
    const ok = await ask({ title: `Remove "${b.label}"?`, confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    try {
      await api.del(`/shotlists/${shotlistId}/breaks/${b.id}`);
      await onChanged();
    } catch (err) { notify('Break not removed', err.message || 'Could not remove the break.'); }
  }

  const positions = [
    ...scenes.map((s, i) => ({
      value: String(i),
      label: `${s.scene_number ? `${s.scene_number}. ` : ''}${s.title || ''}`,
    })),
    { value: String(END_OF_DAY), label: 'End of day' },
  ];

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head" title="Meals and breaks">
        <Coffee size={14} color="var(--accent)" />
        <span className="db-count"><span className="db-dot" />{breaks.length}</span>
        <button className="db-iconbtn" onClick={() => add(END_OF_DAY)} disabled={busy || !dayId}
          title="End of day meal" aria-label="End of day meal">
          <CalendarDays size={15} />
        </button>
        <button className="db-iconbtn" onClick={() => add(Math.ceil(scenes.length / 2))}
          disabled={busy || !dayId} title="Add a break" aria-label="Add a break">
          <Plus size={15} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {breaks.map(b => (
          <div key={b.id} className="shotlist-break-row">
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select className="select" style={{ width: 110 }} value={b.kind}
                onChange={e => patch(b, { kind: e.target.value })}>
                {BREAK_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input className="input" style={{ flex: 1, minWidth: 0 }} value={b.label || ''}
                onChange={e => patch(b, { label: e.target.value })} />
              <button className="db-iconbtn danger" title="Remove" aria-label="Remove" onClick={() => remove(b)}>
                <Trash2 size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input className="input" type="time" style={{ width: 108 }} value={b.start_time || ''}
                title="A fixed time is immovable; empty lets the break float in the running order"
                onChange={e => patch(b, { start_time: e.target.value || null })} />
              {b.start_time ? (
                <button className="db-iconbtn" title="Let this break float again" aria-label="Unlock"
                  onClick={() => patch(b, { start_time: null })}>
                  <Unlock size={14} />
                </button>
              ) : (
                <span className="db-dot muted" title="Floats" />
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
                  After the move, at {movesByScene.get(sceneAt(b.sort_order || 0)?.id)?.to_name || 'the new location'}
                </option>
                <option value="before_move">
                  Before the move
                </option>
              </select>
            ) : null}
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

function WardrobePicker({ shotlistId, character, library, onChanged }) {
  const { notify } = useDialogs();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const items = character.wardrobe || [];

  async function attach(list) {
    for (const m of list) {
      await api.post(`/shotlists/${shotlistId}/characters/${character.id}/media`, {
        filename: m.filename, thumb_filename: m.thumb_filename, label: m.label || null,
      });
    }
    await onChanged();
  }

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
      notify('Upload failed', err.message || 'The image could not be uploaded.');
    } finally {
      setUploading(false);
    }
  }

  async function rename(m, label) {
    try {
      await api.put(`/shotlists/${shotlistId}/character-media/${m.id}`, { label });
      await onChanged();
    } catch (err) { notify('Not renamed', err.message || 'Could not rename the look.'); }
  }

  async function remove(m) {
    try {
      await api.del(`/shotlists/${shotlistId}/character-media/${m.id}`);
      await onChanged();
    } catch (err) { notify('Not removed', err.message || 'Could not remove the photo.'); }
  }

  return (
    <div className="form-row">
      <label className="form-label">Wardrobe <span className="db-count"><span className="db-dot" />{items.length}</span></label>
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
              className="input" defaultValue={m.label || ''}
              onBlur={e => { if ((e.target.value || '') !== (m.label || '')) rename(m, e.target.value); }}
            />
          </div>
        ))}
        <button
          type="button" className="shotlist-wardrobe-add"
          onClick={() => inputRef.current?.click()} disabled={uploading} title="Upload"
        >
          {uploading ? <Loader2 size={15} className="pitch-spin" /> : <Plus size={15} />}
        </button>
        <button type="button" className="shotlist-wardrobe-add"
          onClick={() => setPicking(true)} title="Choose from the shot list library">
          <ImageIcon size={15} />
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
          style={{ display: 'none' }} onChange={handleFiles} />
      </div>
      {picking && (
        <LibraryModal shotlistId={shotlistId} library={library || []}
          onClose={() => setPicking(false)} onPick={attach} />
      )}
    </div>
  );
}

// ── Characters ───────────────────────────────────────────────────────────────

// The casting agency's link. A separate publication from the crew link (an
// agency gets the cast grid and nothing else), and it can be rotated to cut
// off a link that has travelled further than intended.
function CastingShare({ shotlistId, shotlist, base, onChanged }) {
  const { notify, ask } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const shared = shotlist.casting_status === 'published';
  const url = shotlist.casting_slug ? `${base.base}/c/${shotlist.casting_slug}` : null;

  async function act(path, question) {
    if (question && !(await ask(question))) return;
    setBusy(true);
    try {
      await api.post(`/shotlists/${shotlistId}/casting/${path}`, {});
      await onChanged();
    } catch (err) {
      notify('Casting link not updated', err.message || 'Could not update the casting link.');
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
      <div className="shotlist-casting-head" title="Casting link">
        <Share2 size={12} />
        {shared && <span className="db-dot ink" title="Shared" />}
        {shared && url ? (
          <span style={{ display: 'inline-flex', gap: '2px', marginLeft: 'auto' }}>
            <button className="db-iconbtn" onClick={copy} title={`Copy the casting link (${base.host})`} aria-label="Copy the casting link">
              {copied ? <Check size={14} /> : <Link2 size={14} />}
            </button>
            <a className="db-iconbtn" href={url} target="_blank" rel="noreferrer" title="Open" aria-label="Open">
              <ExternalLink size={14} />
            </a>
            <button className="db-iconbtn" disabled={busy} title="New link" aria-label="New link"
              onClick={() => act('rotate', { title: 'Make a new casting link?', message: 'The old one stops working immediately.', confirmLabel: 'New link', tone: 'danger' })}>
              <RotateCcw size={14} />
            </button>
            <button className="db-iconbtn danger" disabled={busy} title="Stop sharing" aria-label="Stop sharing"
              onClick={() => act('unpublish', { title: 'Stop sharing the casting?', message: 'The agency link stops working.', confirmLabel: 'Stop sharing', tone: 'danger' })}>
              <EyeOff size={14} />
            </button>
          </span>
        ) : (
          <button className="db-iconbtn" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => act('publish')}
            title="Share with a casting agency" aria-label="Share with a casting agency">
            <Globe size={14} />
          </button>
        )}
      </div>
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
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span title={c.kind === 'extra' ? 'Extra' : 'Principal'}>{c.kind === 'extra' ? <User size={10} /> : <UserCog size={10} />}</span>
          {fmtAgeRange(c.age_min, c.age_max) && <span title="Casting age">{fmtAgeRange(c.age_min, c.age_max)}</span>}
          {c.performer && <span>{c.performer}</span>}
        </div>
      </div>
      <button className="db-iconbtn sm" title="Edit" aria-label="Edit" onClick={() => onEdit(c)}>
        <Settings2 size={12} />
      </button>
      <button className="db-iconbtn sm"
        title="Duplicate this part with its brief and wardrobe" aria-label="Duplicate" onClick={() => onDuplicate(c)}>
        <Copy size={12} />
      </button>
      <button className="db-iconbtn sm danger" title="Delete" aria-label="Delete" onClick={() => onDelete(c)}>
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function CharactersPanel({ shotlistId, shotlist, base, characters, library, onChanged, onAddExtra, onReload }) {
  const { notify, ask } = useDialogs();
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState('');
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
  // fresh list back from the server, but only that field, or it would discard
  // whatever is half typed in the others.
  useEffect(() => {
    if (!editing || !editing.id) return;
    const fresh = characters.find(c => c.id === editing.id);
    if (!fresh) return;
    setEditing(prev => (prev && prev.id === fresh.id ? { ...prev, wardrobe: fresh.wardrobe } : prev));
  }, [characters]);

  function openEditor(value) {
    setEditError('');
    setEditing(value);
  }

  async function save() {
    if (!editing.name || !editing.name.trim()) { setEditError('Give the character a name'); return; }
    setEditError('');
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
    } catch (err) { setEditError(err.message || 'Could not save the character'); }
  }

  async function remove(c) {
    const ok = await ask({
      title: `Delete "${c.name}"?`,
      message: 'They are removed from every shot they were in.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/shotlists/${shotlistId}/characters/${c.id}`);
      await onChanged();
    } catch (err) { notify('Not deleted', err.message || 'Could not delete the character.'); }
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
    } catch (err) { setEditError(err.message || 'Upload failed'); }
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
    } catch (err) { notify('Not duplicated', err.message || 'Could not duplicate the character.'); }
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
      notify('Order not saved', err.message || 'The new order could not be saved.');
    }
  }

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head" title="Cast">
        <Users size={14} color="var(--accent)" />
        <span className="db-count"><span className="db-dot" />{characters.length}</span>
        <button className="db-iconbtn" onClick={addExtra} disabled={busy} title="Add the next numbered extra" aria-label="Add an extra">
          <UserPlus size={15} />
        </button>
        <button className="db-iconbtn" title="Add character" aria-label="Add character"
          onClick={() => openEditor({ name: '', performer: '', kind: 'principal', costume: '', notes: '' })}>
          <Plus size={15} />
        </button>
      </div>

      <DndContext sensors={castSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={list.map(c => `char-${c.id}`)} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {list.map(c => (
              <SortableCharacter
                key={c.id}
                character={c}
                onEdit={ch => openEditor({ ...ch })}
                onDuplicate={duplicate}
                onDelete={remove}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <CastingShare shotlistId={shotlistId} shotlist={shotlist} base={base} onChanged={onReload} />

      {editing && (
        <Overlay
          title={editing.id ? editing.name || 'Character' : 'Character'}
          onClose={() => setEditing(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
          </>}
        >
          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">Character</label>
              <input className="input" value={editing.name || ''} autoFocus
                onChange={e => setEditing({ ...editing, name: e.target.value })} />
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
              onChange={e => setEditing({ ...editing, performer: e.target.value })} />
          </div>
          {/* The age the ROLE is cast for, which is not the performer's own
              age. Either end can stand alone. */}
          <div className="form-row">
            <label className="form-label" title="The age the role is cast for. Either end can stand alone.">Casting age</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                className="input" type="number" min="0" max="120" style={{ flex: 1 }} placeholder="From"
                value={editing.age_min == null ? '' : editing.age_min}
                onChange={e => setEditing({ ...editing, age_min: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <ArrowRight size={13} color="var(--text-muted)" />
              <input
                className="input" type="number" min="0" max="120" style={{ flex: 1 }} placeholder="To"
                value={editing.age_max == null ? '' : editing.age_max}
                onChange={e => setEditing({ ...editing, age_max: e.target.value === '' ? null : Number(e.target.value) })}
              />
              {(editing.age_min != null || editing.age_max != null) && (
                <button className="db-iconbtn" title="Clear the age range" aria-label="Clear the age range"
                  onClick={() => setEditing({ ...editing, age_min: null, age_max: null })}>
                  <X size={15} />
                </button>
              )}
            </div>
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
              <button className="db-iconbtn" onClick={() => fileRef.current?.click()} disabled={uploading}
                title={editing.photo_filename ? 'Replace' : 'Upload'} aria-label={editing.photo_filename ? 'Replace' : 'Upload'}>
                {uploading ? <Loader2 size={15} className="pitch-spin" /> : <ImageIcon size={15} />}
              </button>
              {editing.photo_filename && (
                <button className="db-iconbtn danger" title="Remove" aria-label="Remove"
                  onClick={() => setEditing({ ...editing, photo_filename: null, photo_thumb_filename: null })}>
                  <X size={15} />
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }} onChange={uploadPhoto} />
            </div>
          </div>
          {/* Wardrobe photos hang off the character id, so a brand new part is
              saved first and then dressed. */}
          {editing.id ? (
            <WardrobePicker shotlistId={shotlistId} character={editing} library={library} onChanged={onChanged} />
          ) : (
            <div className="form-row">
              <label className="form-label" title="Save this character first, then reopen it to attach wardrobe photos.">
                Wardrobe <span className="db-dot muted" />
              </label>
            </div>
          )}
          <div className="form-row">
            <label className="form-label">Notes</label>
            <textarea className="input" rows={2} value={editing.notes || ''}
              onChange={e => setEditing({ ...editing, notes: e.target.value })} />
          </div>
          {editError && <p className="prod-error">{editError}</p>}
        </Overlay>
      )}
    </div>
  );
}

// ── Locations panel ──────────────────────────────────────────────────────────

function LocationsPanel({ shotlistId, locations, onChanged }) {
  const { notify, ask } = useDialogs();
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState('');

  function startNew() {
    setEditError('');
    setEditing({ name: '', address: '', lat: null, lng: null, notes: '' });
  }

  async function save() {
    if (!editing.name || !editing.name.trim()) { setEditError('Give the location a name'); return; }
    setEditError('');
    try {
      if (editing.id) await api.put(`/shotlists/${shotlistId}/locations/${editing.id}`, editing);
      else await api.post(`/shotlists/${shotlistId}/locations`, editing);
      setEditing(null);
      await onChanged();
    } catch (err) { setEditError(err.message || 'Could not save the location'); }
  }

  async function remove(loc) {
    const ok = await ask({
      title: `Delete location "${loc.name}"?`,
      message: 'Scenes using it keep their other details.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/shotlists/${shotlistId}/locations/${loc.id}`);
      await onChanged();
    } catch (err) { notify('Not deleted', err.message || 'Could not delete the location.'); }
  }

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head" title="Locations">
        <MapPin size={14} color="var(--accent)" />
        <span className="db-count"><span className="db-dot" />{locations.length}</span>
        <button className="db-iconbtn" onClick={startNew} title="Add location" aria-label="Add location"><Plus size={15} /></button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {locations.map(l => (
          <div key={l.id} className="shotlist-loc-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>{l.name}</div>
              {l.address && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{l.address}</div>}
            </div>
            {l.lat != null && l.lng != null ? (
              <a
                className="db-iconbtn sm" title="Open directions" aria-label="Open directions"
                href={`https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`}
                target="_blank" rel="noreferrer"
              >
                <MapPin size={12} />
              </a>
            ) : (
              <span className="db-dot" title="Not pinned" />
            )}
            <button className="db-iconbtn sm" title="Edit" aria-label="Edit" onClick={() => { setEditError(''); setEditing({ ...l }); }}>
              <Settings2 size={12} />
            </button>
            <button className="db-iconbtn sm danger" title="Delete" aria-label="Delete" onClick={() => remove(l)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <Overlay
          title={editing.id ? editing.name || 'Location' : 'Location'}
          onClose={() => setEditing(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
          </>}
        >
          <div className="form-row">
            <label className="form-label">Label</label>
            <input className="input" value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
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
          {editError && <p className="prod-error">{editError}</p>}
        </Overlay>
      )}
    </div>
  );
}

// ── Organize this ────────────────────────────────────────────────────────────
// One day at a time: a day is the unit that gets scheduled.

function OrganizePanel({ shotlistId, day, scenes, plan, onPlanned, onApplied }) {
  const { notify, ask } = useDialogs();
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
    const ok = await ask({
      title: `Apply the optimised order for ${dayLabel(day)}?`,
      message: 'It becomes your order. The optimised plan is kept too.',
      confirmLabel: 'Apply',
    });
    if (!ok) return;
    setApplying(true);
    try {
      await api.post(`/shotlists/${shotlistId}/apply-plan`, { dayId: day ? day.id : null });
      await onApplied();
    } catch (err) {
      notify('Plan not applied', err.message || 'Could not apply the plan.');
    } finally {
      setApplying(false);
    }
  }

  const p = plan && plan.plan ? plan.plan : null;
  const c = plan && plan.comparison ? plan.comparison : null;
  const rows = p ? p.items.filter(i => i.kind === 'scene') : [];

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="shotlist-panel-head" title={`Organize ${dayLabel(day)}`}>
        <Wand2 size={14} color="var(--accent)" />
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}
        title="Locked times and fixed breaks first, then the light, then travel. Scenes at one location stay together.">
        <div style={{ flex: 1, minWidth: 160 }}>
          <select className="select" style={{ width: '100%' }} value={startSceneId} onChange={e => setStartSceneId(e.target.value)}
            aria-label="Start with scene" title="Start with scene">
            {scenes.map(s => (
              <option key={s.id} value={s.id}>
                {s.scene_number ? `${s.scene_number}. ` : ''}{s.title || ''}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={run} disabled={running || scenes.length === 0} title="Organize this" aria-label="Organize this">
          {running ? <Loader2 size={15} className="pitch-spin" /> : <Wand2 size={15} />}
        </button>
      </div>

      {error && <p className="prod-error">{error}</p>}

      {p && (
        <div style={{ marginTop: '14px' }}>
          <div className="shotlist-mode-note" title={p.distance_mode === 'google' ? 'Google road distances' : 'Straight line estimate'}>
            <MapPin size={11} /> {p.distance_mode === 'google' ? 'Google' : <span className="db-dot muted" />}
          </div>

          {c && (
            <div className="shotlist-compare">
              {[['current', User, 'My order'], ['optimised', Wand2, 'Optimised']].map(([k, Icon, title]) => (
                <div key={k} title={title}>
                  <span className="shotlist-compare-k"><Icon size={12} /></span>
                  <span>
                    <span title="Company moves"><Truck size={10} /> {c[k].move_count}</span> · {c[k].travel_km} km · {c[k].travel_minutes} min
                    {c[k].crew_call ? <> · <TimeRange label={`${c[k].crew_call} to ${c[k].end_label || ''}`} /></> : null}
                    {c[k].warning_count ? <> · <span title="Warnings"><AlertTriangle size={10} /> {c[k].warning_count}</span></> : null}
                  </span>
                </div>
              ))}
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}
                title={`${c.moved_count} scenes move, ${c.moves_saved} fewer company moves, fixes ${c.fixes.length}, introduces ${c.introduces.length}`}>
                <Clapperboard size={10} /> {c.moved_count}
                {c.move_minutes_saved > 0 ? <> · <Truck size={10} /> {fmtDuration(c.move_minutes_saved)}</> : null}
              </div>
            </div>
          )}

          <div className="shotlist-plan">
            {rows.map((r, i) => {
              const move = c && c.moves.find(m => m.scene_id === r.scene_id);
              return (
                <div key={`${r.scene_id}-${i}`} className="shotlist-plan-row">
                  <span className="shotlist-plan-time">{r.start_label}</span>
                  <span className="shotlist-plan-title">{r.title || ''}</span>
                  {r.locked && <span className="shotlist-chip hard"><Lock size={9} /> {r.locked_time}</span>}
                  <span className="shotlist-chip" title="Shots"><Film size={9} /> {r.shot_count}</span>
                  {r.light_window_label && (
                    <span className={`shotlist-chip${r.light_window_hard ? ' hard' : ''}`} title={r.light_window_label}><Sun size={9} /></span>
                  )}
                  {move && move.moved && (
                    <span className="shotlist-plan-move">#{move.from_position} → #{move.to_position}</span>
                  )}
                </div>
              );
            })}
          </div>

          {c && c.unsatisfied.length > 0 && (
            <div className="shotlist-fixes" style={{ borderColor: 'var(--danger)' }} title="Could not be honoured">
              <AlertTriangle size={12} />
              <ul>{c.unsatisfied.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            </div>
          )}

          {p.warnings.length > 0 && (
            <ul className="shotlist-warnings">
              {p.warnings.map((w, i) => <li key={i}><AlertTriangle size={11} /> {w.message}</li>)}
            </ul>
          )}

          {c && c.fixes.length > 0 && (
            <div className="shotlist-fixes" title="Fixed by this plan">
              <Check size={12} />
              <ul>{c.fixes.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            </div>
          )}

          <button className="btn btn-secondary" style={{ marginTop: '10px' }} onClick={apply} disabled={applying}
            title="Apply to my order" aria-label="Apply to my order">
            {applying ? <Loader2 size={15} className="pitch-spin" /> : <Check size={15} />}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main editor ──────────────────────────────────────────────────────────────

const ORDER_TOGGLES = [
  { key: 'user', Icon: User, title: 'My order' },
  { key: 'optimized', Icon: Wand2, title: 'Optimised order' },
];

export default function ShotlistEditor() {
  return (
    <DialogProvider>
      <ShotlistEditorPage />
    </DialogProvider>
  );
}

function ShotlistEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const aiEnabled = useAiPolishAvailable();
  const { notify, ask } = useDialogs();

  const [shotlist, setShotlist] = useState(null);
  const [project, setProject] = useState(null);
  const [days, setDays] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [breaks, setBreaks] = useState([]);
  const [library, setLibrary] = useState([]);
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
    setProject(data.project || null);
    setDays(data.days || []);
    setScenes(data.scenes || []);
    setCharacters(data.characters || []);
    setBreaks(data.breaks || []);
    setLibrary(data.library || []);
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
    api.get('/shotlists/light-windows').then(setWindows)
      .catch(err => notify('Light windows not loaded', err.message || 'The light windows could not be loaded.'));
    api.get('/shotlists/public-base').then(b => { if (b && b.base) setBase(b); })
      .catch(() => { /* the current origin stays */ });
    api.get('/projects').then(p => setProjects(Array.isArray(p) ? p : []))
      .catch(err => notify('Projects not loaded', err.message || 'The projects could not be loaded.'));
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
      // Light windows, timelines and totals are all resolved server side, so
      // pull everything back after a save, but only if nothing new has been
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
      flush();
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
      flush().then(load)
        .catch(err => notify('Shot list not reloaded', err.message || 'The shot list could not be reloaded.'));
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
      notify('Extra not added', err.message || 'Could not add the extra.');
      return null;
    }
  }

  async function addDay() {
    try {
      const res = await api.post(`/shotlists/${id}/days`, {});
      await load();
      setActiveDayId(res.id);
    } catch (err) { notify('Day not added', err.message || 'Could not add the day.'); }
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
      notify('Scene not added', err.message || 'Could not add the scene.');
    }
  }

  async function duplicateScene(scene) {
    try {
      await flush();
      await api.post(`/shotlists/${id}/scenes/${scene.id}/duplicate`, {});
      await load();
    } catch (err) { notify('Scene not duplicated', err.message || 'Could not duplicate the scene.'); }
  }

  async function deleteScene(scene) {
    const count = (scene.shots || []).length;
    const ok = await ask({
      title: `Delete "${scene.title || 'this scene'}"${count ? ` and its ${count} shot${count === 1 ? '' : 's'}` : ''}?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      dirtyScenes.current.delete(scene.id);
      await api.del(`/shotlists/${id}/scenes/${scene.id}`);
      await load();
    } catch (err) { notify('Scene not deleted', err.message || 'Could not delete the scene.'); }
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
      notify('Shot not added', err.message || 'Could not add the shot.');
    }
  }

  async function duplicateShot(shot) {
    try {
      await flush();
      await api.post(`/shotlists/${id}/shots/${shot.id}/duplicate`, {});
      await load();
    } catch (err) { notify('Shot not duplicated', err.message || 'Could not duplicate the shot.'); }
  }

  async function deleteShot(shot) {
    const ok = await ask({
      title: `Delete "${shot.title || 'this shot'}"?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      dirtyShots.current.delete(shot.id);
      await api.del(`/shotlists/${id}/shots/${shot.id}`);
      await load();
    } catch (err) { notify('Shot not deleted', err.message || 'Could not delete the shot.'); }
  }

  // Scenes are dragged within a day, but sort_order is global, so the reorder
  // call carries every scene, with only this day's positions rewritten. The new
  // order shows at once; when the server refuses it the previous order comes
  // back and a notice says so.
  async function handleSceneDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const previous = scenes;
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
    } catch (err) {
      setScenes(previous);
      setSaveState('saved');
      notify('Order not saved', err.message || 'The new order could not be saved.');
    }
  }

  async function handleShotsReorder(scene, nextShots) {
    const previous = scene.shots || [];
    setScenes(prev => prev.map(s => s.id === scene.id ? { ...s, shots: nextShots } : s));
    try {
      setSaveState('saving');
      await api.patch(`/shotlists/${id}/scenes/${scene.id}/shots/reorder`, { shotIds: nextShots.map(s => s.id) });
      setSaveState('saved');
    } catch (err) {
      setScenes(prev => prev.map(s => s.id === scene.id ? { ...s, shots: previous } : s));
      setSaveState('saved');
      notify('Order not saved', err.message || 'The new order could not be saved.');
    }
  }

  async function publish() {
    setWorking(true);
    try {
      await flush();
      const res = await api.post(`/shotlists/${id}/publish`, {});
      setShotlist(prev => ({ ...prev, status: 'published', slug: res.slug }));
    } catch (err) {
      notify('Not published', err.message || 'The shot list could not be published.');
    } finally { setWorking(false); }
  }

  async function unpublish() {
    const ok = await ask({
      title: 'Unpublish this shot list?',
      message: 'The crew link stops working until you publish again.',
      confirmLabel: 'Unpublish',
      tone: 'danger',
    });
    if (!ok) return;
    setWorking(true);
    try {
      await api.post(`/shotlists/${id}/unpublish`, {});
      setShotlist(prev => ({ ...prev, status: 'draft' }));
    } catch (err) {
      notify('Not unpublished', err.message || 'The shot list could not be unpublished.');
    } finally { setWorking(false); }
  }

  async function resetStatuses() {
    const ok = await ask({
      title: 'Reset every shot back to pending?',
      message: 'Completion marks from the crew are cleared.',
      confirmLabel: 'Reset',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.post(`/shotlists/${id}/reset-status`, {});
      await load();
    } catch (err) { notify('Statuses not reset', err.message || 'Could not reset the statuses.'); }
  }

  async function downloadPdf(kind, filename) {
    try {
      await api.download(`/shotlists/${id}/pdf/${kind}`, filename);
    } catch (err) {
      notify('PDF not created', err.message || 'The PDF could not be created.');
    }
  }

  // Day 1 back onto the project's shoot date. A single day list also takes the
  // date on the list itself, the same pair the project date change moves.
  async function followProject() {
    const first = days[0];
    if (!first || !project || !project.shoot_date) return;
    const date = String(project.shoot_date).slice(0, 10);
    try {
      await api.put(`/shotlists/${id}/days/${first.id}`, { shoot_date: date });
      if (days.length === 1 && shotlist.shoot_date !== date) {
        await flush();
        await api.put(`/shotlists/${id}`, { shoot_date: date });
      }
      await load();
    } catch (err) {
      notify('Date not changed', err.message || 'Day 1 could not be moved to the project date.');
    }
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

  // A linked list whose first day no longer reads the project's shoot date.
  const projectDate = project && project.shoot_date ? String(project.shoot_date).slice(0, 10) : null;
  const firstDate = days.length ? days[0].shoot_date : shotlist.shoot_date;
  const drifted = !!(shotlist.project_id && projectDate && String(firstDate || '').slice(0, 10) !== projectDate);
  const driftMark = drifted ? (
    <span className="prod-drift" onClick={e => e.stopPropagation()}>
      <span className="db-dot" title={`Project ${fmtDate(projectDate)}`} />
      <span
        role="button" tabIndex={0} className="db-iconbtn sm"
        title={`Set Day 1 to ${fmtDate(projectDate)}`} aria-label="Set Day 1 to the project date"
        onClick={followProject}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); followProject(); } }}
      >
        <CalendarCheck size={12} />
      </span>
    </span>
  ) : null;

  return (
    <div>
      <div className="pitch-editor-header">
        <button className="db-iconbtn lg" style={{ flexShrink: 0 }} onClick={() => navigate('/production/shotlists')} title="Shot lists" aria-label="Shot lists">
          <ArrowLeft size={16} />
        </button>
        <input
          className="pitch-title-input"
          value={shotlist.title || ''}
          onChange={e => handleListChange({ title: e.target.value })}
          placeholder="Shot list title"
        />
        {isPublished && <span className="db-dot ink" title="Published" />}
        <SaveDot state={saveState} />
        <button className="db-iconbtn lg" onClick={() => setShowSettings(true)} title="Shot list settings" aria-label="Shot list settings">
          <Settings2 size={16} />
        </button>
        <button className="db-iconbtn lg" onClick={() => setShowPasscode(true)} title={shotlist.has_passcode ? 'Crew passcode' : 'Set crew passcode'} aria-label="Crew passcode"
          style={{ position: 'relative' }}>
          <KeyRound size={16} />
          {shotlist.passcode_weak ? (
            <span className="db-dot" title="Shorter than 6 characters: change it" style={{ position: 'absolute', top: 5, right: 5 }} />
          ) : !shotlist.has_passcode ? (
            <span className="db-dot muted" style={{ position: 'absolute', top: 5, right: 5 }} />
          ) : null}
        </button>
        <button className="db-iconbtn lg" onClick={() => downloadPdf('callsheet', `Call-Sheet-${shotlist.title || 'shotlist'}.pdf`)} title="Call sheet" aria-label="Call sheet">
          <FileText size={16} />
        </button>
        <button className="db-iconbtn lg" onClick={() => downloadPdf('photoboard', `Photo-Board-${shotlist.title || 'shotlist'}.pdf`)} title="Photo board" aria-label="Photo board">
          <ImageIcon size={16} />
        </button>
        {isPublished && (
          <button className="db-iconbtn lg" onClick={unpublish} disabled={working} title="Unpublish" aria-label="Unpublish">
            <EyeOff size={16} />
          </button>
        )}
        <button className="btn btn-primary" onClick={publish} disabled={working} title={isPublished ? 'Republish' : 'Publish'} aria-label={isPublished ? 'Republish' : 'Publish'}>
          <Globe size={16} />
        </button>
      </div>

      {isPublished && publicUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', fontSize: '12px', color: 'var(--text-secondary)', minWidth: 0 }}>
          <a href={publicUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{publicUrl}</a>
          <button className="db-iconbtn sm" onClick={() => copyText(publicUrl)} title={`Copy crew link (${base.host})`} aria-label="Copy crew link">
            {copied ? <Check size={12} /> : <Link2 size={12} />}
          </button>
          {!shotlist.has_passcode && (
            <span className="db-dot" title="No passcode: the crew can read the list but cannot tick shots off or write set design" />
          )}
        </div>
      )}

      {/* Which ordering the public page and the PDFs present */}
      <div className="shotlist-order-toggle">
        <IconToggles
          options={ORDER_TOGGLES}
          value={shotlist.order_mode === 'optimized' ? 'optimized' : 'user'}
          onChange={v => handleListChange({ order_mode: v })}
          label="Published ordering"
        />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
          {totals ? <span title="On set"><Timer size={11} /> {fmtDuration(totals.on_set_minutes)}</span> : null}
          <Ring value={completed} max={shotCount} size={26} title={`${completed} / ${shotCount}`} />
        </span>
        <button className="db-iconbtn" onClick={() => setShowActivity(true)} title="Activity" aria-label="Activity">
          <History size={15} />
        </button>
        <button className="db-iconbtn" onClick={resetStatuses} title="Reset statuses" aria-label="Reset statuses">
          <RotateCcw size={15} />
        </button>
      </div>

      <DayTabs
        days={days}
        activeDayId={activeDayId}
        counts={sceneCounts}
        onSelect={setActiveDayId}
        onAdd={addDay}
        onEdit={setEditingDay}
        drift={driftMark}
      />

      <div className="shotlist-editor">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          {dayTimeline && (
            <DayTotals day={activeDay} totals={dayTimeline.totals} warnings={dayTimeline.warnings || []} />
          )}

          {dayScenes.length === 0 && (
            <div className="card db-empty"><Clapperboard size={28} /></div>
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
                  library={library}
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

          <button className="btn btn-secondary" style={{ justifyContent: 'center' }} onClick={addScene}
            title={`Add scene to ${dayLabel(activeDay)}`} aria-label="Add scene">
            <Plus size={15} /> <Clapperboard size={15} />
          </button>

          <TimelinePreview shotlistId={id} timeline={dayTimeline} onChanged={load} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          <LocationsPanel shotlistId={id} locations={locations} onChanged={load} />
          <LibraryPanel shotlistId={id} library={library} onChanged={load} />
          <CharactersPanel
            shotlistId={id}
            shotlist={shotlist}
            base={base}
            characters={characters}
            library={library}
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
        <Overlay
          title="Shot list settings"
          onClose={() => setShowSettings(false)}
          footer={<button className="btn btn-primary" onClick={() => setShowSettings(false)}>Done</button>}
        >
          <div className="form-row">
            <label className="form-label">Project</label>
            <select
              className="select" style={{ width: '100%' }}
              value={shotlist.project_id == null ? '' : String(shotlist.project_id)}
              onChange={e => {
                const value = e.target.value;
                const linked = projects.find(p => String(p.id) === value);
                const patch = { project_id: value ? Number(value) : null };
                // Linking a project prefills the title and shoot date
                if (linked) {
                  if (!shotlist.title || !shotlist.title.trim()) patch.title = linked.title;
                  if (!shotlist.shoot_date && linked.shoot_date) patch.shoot_date = String(linked.shoot_date).slice(0, 10);
                }
                setProject(linked ? { id: linked.id, title: linked.title, shoot_date: linked.shoot_date } : null);
                handleListChange(patch);
              }}
            >
              <option value="" />
              {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}
            title="Each shoot day carries its own date and times. These two stay for lists made before days existed.">
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">Shoot date</label>
              <DateField value={shotlist.shoot_date || ''} onChange={v => handleListChange({ shoot_date: v || null })} />
            </div>
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">Call time</label>
              <input className="input" type="time" value={shotlist.call_time || ''} onChange={e => handleListChange({ call_time: e.target.value || null })} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}
            title="Every company move is wrap out, travel and set up. A scene can override both.">
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">Wrap out (min)</label>
              <input className="input" type="number" min="0" step="5" value={shotlist.move_wrap_minutes ?? 20}
                onChange={e => handleListChange({ move_wrap_minutes: Number(e.target.value) })} />
            </div>
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">Set up (min)</label>
              <input className="input" type="number" min="0" step="5" value={shotlist.move_setup_minutes ?? 25}
                onChange={e => handleListChange({ move_setup_minutes: Number(e.target.value) })} />
            </div>
          </div>

          <NotesField value={shotlist.notes} onChange={v => handleListChange({ notes: v })} aiEnabled={aiEnabled} />
        </Overlay>
      )}

      {showPasscode && (
        <PasscodeModal
          shotlistId={id}
          hasPasscode={!!shotlist.has_passcode}
          weak={!!shotlist.passcode_weak}
          onClose={() => setShowPasscode(false)}
          onSaved={has => setShotlist(prev => ({ ...prev, has_passcode: has, passcode_weak: false }))}
        />
      )}

      {showActivity && (
        <Overlay
          title={<History size={16} />}
          label="Activity"
          onClose={() => setShowActivity(false)}
          footer={<>
            <button className="db-iconbtn lg" style={{ marginRight: 'auto' }} onClick={resetStatuses} title="Reset all statuses" aria-label="Reset all statuses">
              <RotateCcw size={16} />
            </button>
            <button className="btn btn-primary" onClick={() => setShowActivity(false)}>Close</button>
          </>}
        >
          {activity.length === 0 ? (
            <div className="db-empty"><History size={24} /></div>
          ) : (
            <div className="shotlist-activity">
              {activity.map(a => (
                <div key={a.id} className="shotlist-activity-row">
                  <span className="shotlist-activity-action">{a.action.replace(/_/g, ' ')}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{a.actor_name || ''}</span>
                  <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{pristinaStamp(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Overlay>
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

// The passcode is write only from the panel: it is stored bcrypt hashed and
// never comes back, so the field always starts empty. New and changed
// passcodes need 6 characters; a shorter one set before the rule keeps
// working and is marked with an ember dot until it is changed.
const PASSCODE_MIN = 6;

function PasscodeModal({ shotlistId, hasPasscode, weak, onClose, onSaved }) {
  const [passcode, setPasscode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tooShort = passcode.length > 0 && passcode.length < PASSCODE_MIN;

  async function save(clear) {
    if (!clear && passcode.length < PASSCODE_MIN) { setError(`At least ${PASSCODE_MIN} characters`); return; }
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
    <Overlay
      title={<KeyRound size={16} />}
      label="Crew passcode"
      onClose={onClose}
      footer={<>
        {hasPasscode && (
          <button className="db-iconbtn lg danger" style={{ marginRight: 'auto' }} onClick={() => save(true)} disabled={saving}
            title="Remove passcode" aria-label="Remove passcode">
            <Trash2 size={16} />
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => save(false)} disabled={saving || passcode.length < PASSCODE_MIN}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </>}
    >
      <div className="form-row"
        title="Anyone with the link can read the list. The passcode lets the crew tick shots off and write set design. Changing it signs every device out.">
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          Passcode
          {weak && <span className="db-dot" title="The current passcode is shorter than 6 characters" />}
        </label>
        <input
          className="input" type="text" value={passcode} autoFocus
          onChange={e => { setPasscode(e.target.value); setError(''); }}
          aria-invalid={tooShort || undefined}
        />
        <span className="db-count" style={{ marginTop: '6px' }} title={`At least ${PASSCODE_MIN} characters`}>
          <span className={`db-dot ${passcode.length >= PASSCODE_MIN ? 'ink' : 'muted'}`} />{passcode.length} / {PASSCODE_MIN}
        </span>
      </div>
      {error && <p className="prod-error">{error}</p>}
    </Overlay>
  );
}
