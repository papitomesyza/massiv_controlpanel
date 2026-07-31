import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, X, Trash2, GripVertical, ChevronDown, ChevronRight,
  Image as ImageIcon, Upload, Settings2, Globe, EyeOff, Copy, Check,
  Smartphone, Monitor, Type, Quote, LayoutGrid, Columns2, Grid3x3,
  ListChecks, Users, Megaphone, ImagePlus, Loader2, Sparkles, Smartphone as PhoneIcon,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from '../components/Modal';
import { api } from '../api';

const CATEGORIES = [
  'Fashion/Editorial',
  'Business Social Media',
  'TVC Photography Campaign',
  'Music Video Photography',
];

const ACCENT_PRESETS = ['#737373', '#737373', '#737373', '#171717', '#737373', '#0a0a0a', '#e7000b', '#0a0a0a'];

// The ten section types — labels, icons and default content shapes
const SECTION_TYPES = {
  hero:         { label: 'Hero',          icon: ImageIcon,  hint: 'Full-screen opener with title',
    defaults: { eyebrow: 'Photography Concept', title: 'Title', subtitle: '', image: '', overlay_strength: 45 } },
  statement:    { label: 'Statement',     icon: Quote,      hint: 'One big sentence',
    defaults: { text: '', alignment: 'center' } },
  full_image:   { label: 'Full Image',    icon: ImagePlus,  hint: 'Full-bleed image with caption',
    defaults: { image: '', caption: '' } },
  image_grid:   { label: 'Image Grid',    icon: LayoutGrid, hint: '2–8 images in columns',
    defaults: { images: [], columns: 3, gap: 'normal' } },
  split:        { label: 'Split',         icon: Columns2,   hint: 'Image beside text',
    defaults: { image: '', heading: '', body: '', image_side: 'right' } },
  moodboard:    { label: 'Moodboard',     icon: Grid3x3,    hint: 'Up to 12 reference images',
    defaults: { images: [], note: '' } },
  deliverables: { label: 'Deliverables',  icon: ListChecks, hint: 'What the client receives',
    defaults: { heading: 'Deliverables', items: [] } },
  crew:         { label: 'Crew',          icon: Users,      hint: 'The team on the project',
    defaults: { heading: 'The team', members: [] } },
  cta:          { label: 'Call to Action', icon: Megaphone, hint: 'Closing pitch + branding',
    defaults: { heading: '', body: '', show_agency_branding: true } },
  social_post:  { label: 'Social Post',    icon: PhoneIcon, hint: 'Instagram / Facebook mockup',
    defaults: { platform: 'instagram', handle: '', display_name: '', avatar: '', image: '', caption: '', likes_label: '' } },
};

function thumbFor(filename) {
  if (!filename) return null;
  return `/p-media/${filename.replace(/-web\.jpg$/, '-thumb.jpg')}`;
}

// ── Field primitives ──────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div className="form-row" style={{ marginBottom: '10px' }}>
      <label className="form-label" style={{ fontSize: '11px' }}>{label}</label>
      {children}
    </div>
  );
}

// AI polish availability is checked once on editor load and shared down the tree
const AiContext = React.createContext({ enabled: false, notifyNotConfigured: () => {} });

// "Fix with Opus" — proposes a corrected version in an inline card. Never
// auto-replaces: the writer chooses Use or Discard, and the field is locked
// while a request is in flight so nothing is overwritten underneath it.
function PolishControl({ value, onChange, loading, setLoading }) {
  const { enabled, notifyNotConfigured } = React.useContext(AiContext);
  const [variants, setVariants] = useState(null);
  const [error, setError] = useState('');

  if (!enabled) return null;
  const text = (value || '').trim();

  async function run() {
    if (loading || !text) return;
    setLoading(true);
    setVariants(null);
    setError('');
    try {
      const res = await api.post('/pitches/ai-polish', { text });
      const list = Array.isArray(res.variants) ? res.variants.filter(Boolean) : [];
      if (list.length === 0) setError('Opus returned nothing usable. Try again.');
      else setVariants(list);
    } catch (err) {
      const msg = err && err.message;
      if (msg === 'not_configured') notifyNotConfigured();
      else if (msg === 'polish_failed') setError('Could not reach Opus. Try again.');
      else setError(msg || 'Polish failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: '5px' }}>
      <button
        type="button"
        className="btn-ghost"
        onClick={run}
        disabled={loading || !text}
        style={{ padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px', opacity: text ? 1 : 0.45 }}
        title="Fix grammar and clarity with Opus"
      >
        {loading ? <Loader2 size={11} className="pitch-spin" /> : <Sparkles size={11} />}
        {loading ? 'Writing options…' : 'Fix with Opus'}
      </button>
      {error && <div style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '5px' }}>{error}</div>}
      {variants && (
        <div className="pitch-polish-card">
          <div className="pitch-polish-label">
            {variants.length === 1 ? 'Option' : `${variants.length} options`}
          </div>
          {variants.map((v, i) => (
            <div key={i} className="pitch-variant">
              <div className="pitch-variant-num">{i + 1}</div>
              <div className="pitch-polish-text pitch-variant-text">{v}</div>
              <button
                type="button"
                className="btn btn-primary btn-sm pitch-variant-use"
                onClick={() => { onChange(v); setVariants(null); }}
              >
                Use
              </button>
            </div>
          ))}
          <div style={{ marginTop: '10px' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVariants(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, textarea, polish = true }) {
  const [loading, setLoading] = useState(false);
  return (
    <Field label={label}>
      {textarea ? (
        <textarea className="input" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} disabled={loading} />
      ) : (
        <input className="input" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={loading} />
      )}
      {polish && <PolishControl value={value} onChange={onChange} loading={loading} setLoading={setLoading} />}
    </Field>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <select className="select" value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  return api.postForm('/pitches/upload', fd);
}

function ImageField({ label, value, onChange }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadImage(file);
      onChange(res.filename);
    } catch (err) { alert(err.message || 'Upload failed'); }
    setUploading(false);
  }

  return (
    <Field label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {value ? (
          <img src={thumbFor(value)} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border-default)' }} />
        ) : (
          <div style={{ width: 64, height: 48, borderRadius: 6, border: '1px dashed var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ImageIcon size={16} color="var(--text-muted)" />
          </div>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 size={13} className="pitch-spin" /> : <Upload size={13} />}
          {value ? 'Replace' : 'Upload'}
        </button>
        {value && (
          <button type="button" className="btn-ghost" style={{ padding: '4px 6px', color: 'var(--danger)' }} title="Remove image" onClick={() => onChange('')}>
            <X size={13} />
          </button>
        )}
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleFile} />
      </div>
    </Field>
  );
}

function ImageListField({ label, values, onChange, max }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const images = Array.isArray(values) ? values : [];

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    const next = [...images];
    for (const file of files) {
      if (next.length >= max) break;
      try {
        const res = await uploadImage(file);
        next.push(res.filename);
      } catch (err) { alert(err.message || 'Upload failed'); break; }
    }
    onChange(next);
    setUploading(false);
  }

  function removeAt(i) {
    onChange(images.filter((_, idx) => idx !== i));
  }

  return (
    <Field label={`${label} (${images.length}/${max})`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {images.map((img, i) => (
          <div key={`${img}-${i}`} style={{ position: 'relative' }}>
            <img src={thumbFor(img)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border-default)' }} />
            <button
              type="button"
              onClick={() => removeAt(i)}
              title="Remove"
              style={{
                position: 'absolute', top: -6, right: -6, width: 18, height: 18,
                borderRadius: '50%', background: 'var(--danger)', border: 'none',
                color: '#0a0a0a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            >
              <X size={10} />
            </button>
          </div>
        ))}
        {images.length < max && (
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
        )}
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={handleFiles} />
      </div>
    </Field>
  );
}

// One row of a RowListField. Prose fields (marked polish on the field spec)
// carry their own Fix with Opus control; proper-noun fields like a crew
// member's name do not — there is nothing to correct there.
function RowEditor({ row, fields, onFieldChange, onRemove }) {
  const [loadingKey, setLoadingKey] = useState(null);
  const polishField = fields.find(f => f.polish);

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        {fields.map(f => (
          <input
            key={f.key}
            className="input"
            style={{ flex: f.flex || 1, fontSize: '12px', padding: '7px 10px' }}
            value={row[f.key] || ''}
            placeholder={f.placeholder}
            disabled={loadingKey === f.key}
            onChange={e => onFieldChange(f.key, e.target.value)}
          />
        ))}
        <button type="button" className="btn-ghost" style={{ padding: '4px 6px', color: 'var(--danger)', flexShrink: 0 }} onClick={onRemove}>
          <X size={13} />
        </button>
      </div>
      {polishField && (
        <PolishControl
          value={row[polishField.key]}
          onChange={v => onFieldChange(polishField.key, v)}
          loading={loadingKey === polishField.key}
          setLoading={on => setLoadingKey(on ? polishField.key : null)}
        />
      )}
    </div>
  );
}

function RowListField({ label, rows, onChange, fields, addLabel }) {
  const list = Array.isArray(rows) ? rows : [];

  function updateRow(i, key, value) {
    onChange(list.map((r, idx) => idx === i ? { ...r, [key]: value } : r));
  }
  function removeRow(i) {
    onChange(list.filter((_, idx) => idx !== i));
  }
  function addRow() {
    const empty = {};
    fields.forEach(f => { empty[f.key] = ''; });
    onChange([...list, empty]);
  }

  return (
    <Field label={label}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {list.map((row, i) => (
          <RowEditor
            key={i}
            row={row}
            fields={fields}
            onFieldChange={(key, value) => updateRow(i, key, value)}
            onRemove={() => removeRow(i)}
          />
        ))}
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addRow}>
          <Plus size={13} /> {addLabel}
        </button>
      </div>
    </Field>
  );
}

// ── Per-type section editors ──────────────────────────────────────────────────

function SectionFields({ type, content, onChange }) {
  const set = (key, value) => onChange({ ...content, [key]: value });

  switch (type) {
    case 'hero':
      return (
        <>
          <TextField label="Eyebrow" value={content.eyebrow} onChange={v => set('eyebrow', v)} placeholder="Photography Concept" />
          <TextField label="Title" value={content.title} onChange={v => set('title', v)} placeholder="[PROJECT]" />
          <TextField label="Subtitle" value={content.subtitle} onChange={v => set('subtitle', v)} placeholder="An editorial story for [CLIENT]" />
          <ImageField label="Background image" value={content.image} onChange={v => set('image', v)} />
          <Field label={`Overlay strength — ${content.overlay_strength ?? 45}`}>
            <input
              type="range" min="0" max="100" value={content.overlay_strength ?? 45}
              onChange={e => set('overlay_strength', Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </Field>
        </>
      );
    case 'statement':
      return (
        <>
          <TextField label="Text" value={content.text} onChange={v => set('text', v)} textarea placeholder="One big sentence." />
          <SelectField label="Alignment" value={content.alignment || 'center'} onChange={v => set('alignment', v)}
            options={[{ value: 'center', label: 'Center' }, { value: 'left', label: 'Left' }]} />
        </>
      );
    case 'full_image':
      return (
        <>
          <ImageField label="Image" value={content.image} onChange={v => set('image', v)} />
          <TextField label="Caption" value={content.caption} onChange={v => set('caption', v)} placeholder="Optional caption" />
        </>
      );
    case 'image_grid':
      return (
        <>
          <ImageListField label="Images" values={content.images} onChange={v => set('images', v)} max={8} />
          <SelectField label="Columns" value={String(content.columns || 3)} onChange={v => set('columns', Number(v))}
            options={[{ value: '2', label: '2 columns' }, { value: '3', label: '3 columns' }, { value: '4', label: '4 columns' }]} />
          <SelectField label="Gap" value={content.gap || 'normal'} onChange={v => set('gap', v)}
            options={[{ value: 'tight', label: 'Tight' }, { value: 'normal', label: 'Normal' }]} />
        </>
      );
    case 'split':
      return (
        <>
          <ImageField label="Image" value={content.image} onChange={v => set('image', v)} />
          <TextField label="Heading" value={content.heading} onChange={v => set('heading', v)} />
          <TextField label="Body" value={content.body} onChange={v => set('body', v)} textarea />
          <SelectField label="Image side" value={content.image_side || 'right'} onChange={v => set('image_side', v)}
            options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
        </>
      );
    case 'moodboard':
      return (
        <>
          <ImageListField label="Images" values={content.images} onChange={v => set('images', v)} max={12} />
          <TextField label="Note" value={content.note} onChange={v => set('note', v)} placeholder="What these references mean" />
        </>
      );
    case 'deliverables':
      return (
        <>
          <TextField label="Heading" value={content.heading} onChange={v => set('heading', v)} />
          <RowListField
            label="Items" rows={content.items} onChange={v => set('items', v)} addLabel="Add item"
            fields={[
              { key: 'title', placeholder: 'e.g. 12 hero images', flex: 1 },
              { key: 'detail', placeholder: 'Detail', flex: 1.4, polish: true },
            ]}
          />
        </>
      );
    case 'crew':
      return (
        <>
          <TextField label="Heading" value={content.heading} onChange={v => set('heading', v)} />
          <RowListField
            label="Members" rows={content.members} onChange={v => set('members', v)} addLabel="Add member"
            fields={[
              { key: 'role', placeholder: 'Role', flex: 1 },
              { key: 'name', placeholder: 'Name', flex: 1 },
            ]}
          />
        </>
      );
    case 'cta':
      return (
        <>
          <TextField label="Heading" value={content.heading} onChange={v => set('heading', v)} />
          <TextField label="Body" value={content.body} onChange={v => set('body', v)} textarea />
          <Field label="Agency branding">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!content.show_agency_branding}
                onChange={e => set('show_agency_branding', e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
              />
              Show agency name + logo
            </label>
          </Field>
        </>
      );
    case 'social_post':
      return (
        <>
          <SelectField label="Platform" value={content.platform === 'facebook' ? 'facebook' : 'instagram'} onChange={v => set('platform', v)}
            options={[{ value: 'instagram', label: 'Instagram' }, { value: 'facebook', label: 'Facebook' }]} />
          <TextField label="Handle" value={content.handle} onChange={v => set('handle', v)} placeholder="@client" polish={false} />
          {content.platform === 'facebook' && (
            <TextField label="Display name" value={content.display_name} onChange={v => set('display_name', v)} placeholder="Client Name" polish={false} />
          )}
          <ImageField label="Avatar" value={content.avatar} onChange={v => set('avatar', v)} />
          <ImageField label="Post image" value={content.image} onChange={v => set('image', v)} />
          <TextField label="Caption" value={content.caption} onChange={v => set('caption', v)} textarea placeholder="The caption under the post" />
          <TextField label="Likes label" value={content.likes_label} onChange={v => set('likes_label', v)} placeholder="e.g. 2,481 likes" polish={false} />
        </>
      );
    default:
      return null;
  }
}

// ── Sortable section card ─────────────────────────────────────────────────────

function SortableSectionCard({ section, expanded, onToggle, onChange, onDelete }) {
  const meta = SECTION_TYPES[section.type] || { label: section.type, icon: Type };
  const Icon = meta.icon;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });

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
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', cursor: 'pointer' }}
        onClick={() => onToggle(section.id)}
      >
        <span
          {...listeners}
          onClick={e => e.stopPropagation()}
          title="Drag to reorder"
          style={{ cursor: isDragging ? 'grabbing' : 'grab', color: 'var(--text-muted)', touchAction: 'none', display: 'flex', padding: '2px' }}
        >
          <GripVertical size={14} />
        </span>
        <Icon size={14} color="var(--accent)" />
        <span style={{ fontSize: '13px', fontWeight: 600, flex: 1 }}>{meta.label}</span>
        <button
          className="btn-ghost"
          style={{ padding: '3px 5px', color: 'var(--danger)' }}
          title="Delete section"
          onClick={e => { e.stopPropagation(); onDelete(section); }}
        >
          <Trash2 size={12} />
        </button>
        {expanded ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
      </div>
      {expanded && (
        <div style={{ padding: '4px 14px 14px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ paddingTop: '10px' }}>
            <SectionFields type={section.type} content={section.content} onChange={c => onChange(section.id, c)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

export default function PitchEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pres, setPres] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('saved'); // saved | saving | error
  const [previewKey, setPreviewKey] = useState(0);
  const [phoneView, setPhoneView] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState(null); // set after a publish to show the link modal
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [toast, setToast] = useState('');
  // The client-facing base for public links (a configured pitch domain when
  // there is one), so what gets copied is never the panel's own origin.
  const [pitchBase, setPitchBase] = useState({
    base: window.location.origin, host: window.location.host, custom: false,
  });

  const dirtySections = useRef(new Map());
  const dirtyPres = useRef(null);
  const saveTimer = useRef(null);
  const previewTimer = useRef(null);
  const previewRef = useRef(null);
  const previewScroll = useRef(0);
  const expandedRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  useEffect(() => {
    api.get(`/pitches/${id}`)
      .then(data => {
        const { sections: secs, ...rest } = data;
        setPres(rest);
        setSections(secs);
      })
      .catch(() => navigate('/pitches'))
      .finally(() => setLoading(false));
  }, [id]);

  // Checked once per editor load — when the server has no key the feature hides entirely
  useEffect(() => {
    api.get('/pitches/ai-status')
      .then(s => setAiEnabled(!!s.enabled))
      .catch(() => setAiEnabled(false));
  }, []);

  useEffect(() => {
    api.get('/pitches/public-base')
      .then(b => { if (b && b.base) setPitchBase(b); })
      .catch(() => {});
  }, []);

  // One toast at a time; a second trigger just restarts the timer
  const notifyNotConfigured = useCallback(() => {
    setAiEnabled(false);
    setToast('Add ANTHROPIC_API_KEY on the server to enable Opus polish.');
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Mirrored into a ref so the iframe load handler can read it without
  // being rebound on every expand/collapse.
  useEffect(() => { expandedRef.current = expandedId; }, [expandedId]);

  // Refreshing the preview must not throw the reader back to the top of the
  // deck. Record where the preview is looking, then restore it on load —
  // preferring the section currently open in the editor.
  const bumpPreview = useCallback(() => {
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      try {
        const win = previewRef.current && previewRef.current.contentWindow;
        previewScroll.current = win ? win.scrollY || 0 : 0;
      } catch (_) { previewScroll.current = 0; }
      setPreviewKey(k => k + 1);
    }, 400);
  }, []);

  function handlePreviewLoad() {
    const win = previewRef.current && previewRef.current.contentWindow;
    if (!win) return;
    try {
      const target = expandedRef.current
        ? win.document.querySelector(`[data-sec="${expandedRef.current}"]`)
        : null;
      if (target) target.scrollIntoView({ block: 'start' });
      else if (previewScroll.current) win.scrollTo(0, previewScroll.current);
    } catch (_) {
      // Cross-origin or not-yet-parsed document: leave the preview where it is
    }
  }

  const flush = useCallback(async () => {
    const entries = [...dirtySections.current.entries()];
    dirtySections.current.clear();
    const presPatch = dirtyPres.current;
    dirtyPres.current = null;
    if (entries.length === 0 && !presPatch) return;
    try {
      for (const [sid, content] of entries) {
        await api.put(`/pitches/${id}/sections/${sid}`, { content });
      }
      if (presPatch) await api.put(`/pitches/${id}`, presPatch);
      setSaveState('saved');
      bumpPreview();
    } catch (err) {
      setSaveState('error');
    }
  }, [id, bumpPreview]);

  // Flush pending edits when leaving the page
  useEffect(() => () => { clearTimeout(saveTimer.current); flush(); }, [flush]);

  function queueSave() {
    setSaveState('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 800);
  }

  function handleSectionChange(sectionId, content) {
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, content } : s));
    dirtySections.current.set(sectionId, content);
    queueSave();
  }

  function handlePresChange(patch) {
    setPres(prev => ({ ...prev, ...patch }));
    dirtyPres.current = { ...(dirtyPres.current || {}), ...patch };
    queueSave();
  }

  async function handleAddSection(type) {
    setShowAddPicker(false);
    const content = { ...SECTION_TYPES[type].defaults };
    try {
      setSaveState('saving');
      const res = await api.post(`/pitches/${id}/sections`, { type, content });
      setSections(prev => [...prev, { id: res.id, type, content, sort_order: prev.length }]);
      setExpandedId(res.id);
      setSaveState('saved');
      bumpPreview();
    } catch (err) {
      setSaveState('error');
      alert(err.message || 'Failed to add section');
    }
  }

  async function handleDeleteSection(section) {
    const meta = SECTION_TYPES[section.type];
    if (!confirm(`Delete this ${meta ? meta.label : section.type} section?`)) return;
    try {
      setSaveState('saving');
      await api.del(`/pitches/${id}/sections/${section.id}`);
      dirtySections.current.delete(section.id);
      setSections(prev => prev.filter(s => s.id !== section.id));
      setSaveState('saved');
      bumpPreview();
    } catch (err) {
      setSaveState('error');
      alert(err.message || 'Failed to delete section');
    }
  }

  async function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIndex = sections.findIndex(s => s.id === active.id);
    const newIndex = sections.findIndex(s => s.id === over.id);
    const newList = arrayMove(sections, oldIndex, newIndex);
    setSections(newList);
    try {
      setSaveState('saving');
      await api.patch(`/pitches/${id}/sections/reorder`, { sectionIds: newList.map(s => s.id) });
      setSaveState('saved');
      bumpPreview();
    } catch (err) {
      setSaveState('error');
    }
  }

  async function handlePublish() {
    setWorking(true);
    try {
      await flush();
      const res = await api.post(`/pitches/${id}/publish`, {});
      setPres(prev => ({ ...prev, status: 'published', slug: res.slug }));
      setPublishedSlug(res.slug);
    } catch (err) {
      alert(err.message || 'Failed to publish');
    } finally {
      setWorking(false);
    }
  }

  async function handleUnpublish() {
    if (!confirm('Unpublish this pitch? The public link will stop working until you publish again.')) return;
    setWorking(true);
    try {
      await api.post(`/pitches/${id}/unpublish`, {});
      setPres(prev => ({ ...prev, status: 'draft' }));
    } catch (err) {
      alert(err.message || 'Failed to unpublish');
    } finally {
      setWorking(false);
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

  if (loading || !pres) return (
    <div className="page-header">
      <h1 className="page-title">Pitch Editor</h1>
    </div>
  );

  const token = localStorage.getItem('massiv_auth');
  const previewSrc = `/api/pitches/${id}/preview?token=${encodeURIComponent(token || '')}&r=${previewKey}`;
  const isPublished = pres.status === 'published';
  const publicUrl = pres.slug ? `${pitchBase.base}/p/${pres.slug}` : null;

  return (
    <AiContext.Provider value={{ enabled: aiEnabled, notifyNotConfigured }}>
    <div>
      {toast && <div className="pitch-toast">{toast}</div>}
      {/* Header */}
      <div className="pitch-editor-header">
        <button className="btn-ghost" style={{ padding: '6px 8px', flexShrink: 0 }} onClick={() => navigate('/pitches')} title="Back to pitches">
          <ArrowLeft size={16} />
        </button>
        <input
          className="pitch-title-input"
          value={pres.title}
          onChange={e => handlePresChange({ title: e.target.value })}
          placeholder="Pitch title"
        />
        <span className={`badge ${isPublished ? 'badge-active' : 'badge-pending'}`} style={{ flexShrink: 0 }}>
          {pres.status}
        </span>
        <span style={{ fontSize: '11px', color: saveState === 'error' ? 'var(--danger)' : 'var(--text-muted)', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
        </span>
        <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => setShowSettings(true)} title="Pitch settings">
          <Settings2 size={14} />
        </button>
        {isPublished ? (
          <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={handleUnpublish} disabled={working}>
            <EyeOff size={13} /> Unpublish
          </button>
        ) : null}
        <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={handlePublish} disabled={working}>
          <Globe size={13} /> {isPublished ? 'Republish' : 'Publish'}
        </button>
      </div>

      {isPublished && publicUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <Globe size={12} color="var(--success)" />
          <a href={publicUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)' }}>{publicUrl}</a>
          <button className="btn-ghost" style={{ padding: '3px 5px', color: copied ? 'var(--success)' : undefined }} onClick={() => copyText(publicUrl)} title={`Copy link (${pitchBase.host})`}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{pitchBase.host}</span>
        </div>
      )}

      <div className="pitch-editor">
        {/* Left — section stack */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
              {sections.map(s => (
                <SortableSectionCard
                  key={s.id}
                  section={s}
                  expanded={expandedId === s.id}
                  onToggle={sid => setExpandedId(prev => prev === sid ? null : sid)}
                  onChange={handleSectionChange}
                  onDelete={handleDeleteSection}
                />
              ))}
            </SortableContext>
          </DndContext>

          {showAddPicker ? (
            <div className="card" style={{ padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Add section</span>
                <button className="btn-ghost" style={{ padding: '3px 5px' }} onClick={() => setShowAddPicker(false)}><X size={14} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}>
                {Object.entries(SECTION_TYPES).map(([type, meta]) => {
                  const Icon = meta.icon;
                  return (
                    <button
                      key={type}
                      className="pitch-add-tile"
                      onClick={() => handleAddSection(type)}
                    >
                      <Icon size={15} color="var(--accent)" />
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>{meta.label}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{meta.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <button className="btn btn-secondary" style={{ justifyContent: 'center' }} onClick={() => setShowAddPicker(true)}>
              <Plus size={15} /> Add section
            </button>
          )}
        </div>

        {/* Right — live preview */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px', marginBottom: '8px' }}>
            <button
              className={`btn-ghost btn-sm ${!phoneView ? '' : ''}`}
              style={{ padding: '5px 8px', color: !phoneView ? 'var(--accent)' : 'var(--text-muted)' }}
              onClick={() => setPhoneView(false)}
              title="Full width preview"
            >
              <Monitor size={15} />
            </button>
            <button
              className="btn-ghost btn-sm"
              style={{ padding: '5px 8px', color: phoneView ? 'var(--accent)' : 'var(--text-muted)' }}
              onClick={() => setPhoneView(true)}
              title="Phone preview (390px)"
            >
              <Smartphone size={15} />
            </button>
          </div>
          <div className={`pitch-preview-wrap${phoneView ? ' phone' : ''}`}>
            {/* No key: changing src navigates the same element, so the
                iframe keeps its scroll position instead of remounting. */}
            <iframe ref={previewRef} src={previewSrc} title="Pitch preview" onLoad={handlePreviewLoad} />
          </div>
        </div>
      </div>

      {/* Settings drawer */}
      {showSettings && (
        <Modal title="Pitch Settings" onClose={() => setShowSettings(false)}>
          <div className="form-row">
            <label className="form-label">Category</label>
            <select className="select" style={{ width: '100%' }} value={pres.category || ''} onChange={e => handlePresChange({ category: e.target.value || null })}>
              <option value="">— none —</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">Accent color</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(pres.accent_color || '') ? pres.accent_color : '#737373'}
                onChange={e => handlePresChange({ accent_color: e.target.value })}
                style={{ width: 40, height: 32, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
              />
              {ACCENT_PRESETS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handlePresChange({ accent_color: c })}
                  title={c}
                  style={{
                    width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                    border: pres.accent_color === c ? '2px solid #0a0a0a' : '2px solid transparent',
                  }}
                />
              ))}
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Public link slug</label>
            <SlugEditor pres={pres} onSaved={slug => setPres(prev => ({ ...prev, slug }))} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-primary" onClick={() => setShowSettings(false)}>Done</button>
          </div>
        </Modal>
      )}

      {/* Publish success modal */}
      {publishedSlug && (
        <Modal title="Published" onClose={() => setPublishedSlug(null)}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Your pitch is live. Share this link with the client:
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              className="input"
              readOnly
              value={`${pitchBase.base}/p/${publishedSlug}`}
              style={{ flex: 1, fontSize: '12px' }}
              onFocus={e => e.target.select()}
            />
            <button className="btn btn-primary" style={{ flexShrink: 0, minWidth: 84 }} onClick={() => copyText(`${pitchBase.base}/p/${publishedSlug}`)}>
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
            </button>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '8px 0 0' }}>
            Served from {pitchBase.host}
          </p>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setPublishedSlug(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
    </AiContext.Provider>
  );
}

// Slug is deliberately NOT autosaved — it changes a public URL, so it has an
// explicit save button and a warning while published.
function SlugEditor({ pres, onSaved }) {
  const [value, setValue] = useState(pres.slug || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const changed = value !== (pres.slug || '');

  async function save() {
    setSaving(true); setError('');
    try {
      const res = await api.put(`/pitches/${pres.id}`, { slug: value || null });
      onSaved(res.slug);
      setValue(res.slug || '');
    } catch (err) {
      setError(err.message || 'Failed to save slug');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>/p/</span>
        <input
          className="input"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={pres.slug ? '' : 'generated on publish'}
          style={{ flex: 1, fontSize: '12px' }}
        />
        <button className="btn btn-secondary btn-sm" onClick={save} disabled={saving || !changed}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {pres.status === 'published' && changed && (
        <p style={{ fontSize: '11px', color: 'var(--warning)', marginTop: '6px' }}>
          Warning: changing the slug of a published pitch kills the old link — anyone holding the current URL will get a 404.
        </p>
      )}
      {error && <p style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '6px' }}>{error}</p>}
    </div>
  );
}
