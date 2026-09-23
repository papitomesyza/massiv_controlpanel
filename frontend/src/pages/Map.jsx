import React, { useEffect, useMemo, useState, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useNavigate } from 'react-router-dom';
import { MapPin, Maximize2, Move } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import 'react-leaflet-cluster/lib/assets/MarkerCluster.css';
import 'react-leaflet-cluster/lib/assets/MarkerCluster.Default.css';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet.heat';
import { api, fmt } from '../api';
import { Private } from '../context/PrivacyContext';
import { useTheme } from '../context/ThemeContext';
import { GROUP_TINT, categoryVisual, CategoryTile } from '../lib/categoryIcons';
import { shortenAddress } from '../lib/address';

// Fix default leaflet marker icon broken in webpack/vite environments. The
// popup still uses the default pin shadow assets, so they stay registered.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// The basemap is keyless OpenStreetMap by default, read from an env var so a
// keyed provider can be swapped in later with no code change. No dark or light
// variant is baked into the URL: the dark look is produced by a CSS filter over
// the tiles when the dark theme is active (see index.css .map-dark).
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// The five category groups in a fixed order, so the group filter row never
// reshuffles. Each carries its own palette tint (see categoryIcons).
const GROUPS = Object.keys(GROUP_TINT);

// One status colour system, shared with Projects and the Dashboard. The ring
// around a pin decodes the same token the row dot does, so the two pages agree
// by eye. Completed keeps the neutral hairline treatment.
const STATUS_HUE = {
  'development':     'var(--tl-hue-development)',
  'pre-production':  'var(--tl-hue-pre-production)',
  'production':      'var(--tl-hue-production)',
  'post-production': 'var(--tl-hue-post-production)',
};
function statusRingToken(status) {
  return status === 'completed' ? 'var(--color-hairline-strong)' : (STATUS_HUE[status] || 'var(--color-hairline-strong)');
}

const STATUS_OPTIONS = ['All', 'Active', 'Completed'];

const PERSIST_KEY = 'massiv_map_view';
const DEFAULT_CENTER = [50.0, 15.0];
const DEFAULT_ZOOM = 4;

function loadPersisted() {
  try { return JSON.parse(localStorage.getItem(PERSIST_KEY)) || {}; }
  catch (_) { return {}; }
}

// Resolve a token reference like var(--cat-1) to its concrete value in the
// current theme, reading the computed style rather than trusting a literal.
// These icons are injected into Leaflet's own DOM as raw HTML, where custom
// property inheritance is fragile, so every colour is resolved here first.
function resolveVar(value) {
  const m = /var\((--[\w-]+)\)/.exec(value || '');
  if (m) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
    return v || value;
  }
  return value;
}

// Pick a glyph colour that contrasts with a resolved fill, computed from the
// fill's luminance rather than assumed, so a pale tint never gets a white glyph
// and a dark one never gets a black glyph. Same contrast rule the calendar chips
// now use.
function contrastOn(hex) {
  const h = String(hex).trim().replace('#', '');
  if (h.length !== 3 && h.length !== 6) return '#0a0a0a';
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.5 ? '#0a0a0a' : '#ffffff';
}

// Squared planar distance on lat/lng: enough to order a short list by proximity
// to the map centre without the cost of a full haversine.
function distSq(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

// ── Heat layer, weighted by value ───────────────────────────────────────────
// Each point carries a weight normalised across the visible set, so the shape
// concentrates where budget is, not merely where rows are. A project with no
// agreed budget still appears at the floor weight, so it is never invisible.
function HeatmapLayer({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const heat = L.heatLayer(points, { radius: 34, blur: 22, minOpacity: 0.25, maxZoom: 12, max: 1 });
    heat.addTo(map);
    return () => { heat.remove(); };
  }, [map, points]);
  return null;
}

// ── Map bridge ──────────────────────────────────────────────────────────────
// Hands the live Leaflet instance up to the page (for imperative pan on a row
// click and Fit All) and reports centre and zoom on every move, so the side
// list can re-sort by proximity and the view can be persisted.
function MapBridge({ onReady, onMove }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
    const report = () => onMove([map.getCenter().lat, map.getCenter().lng], map.getZoom());
    map.on('moveend', report);
    report();
    return () => { map.off('moveend', report); };
  }, [map]);
  return null;
}

// ── Stat strip ──────────────────────────────────────────────────────────────
// Three figures, no subtitles, matching the Estimates, Projects, Tasks and
// Calendar strips. It replaces the old page subtitle that counted locations.
function StatStrip({ projects }) {
  const s = useMemo(() => {
    const locations = projects.length;
    const areas = new Set(
      projects.map(p => (p.location_name && p.location_name.trim())
        ? p.location_name.trim().toLowerCase()
        : `${p.location_lat},${p.location_lng}`)
    ).size;
    const value = projects.reduce((sum, p) => sum + (Number(p.agreed_budget) || 0), 0);
    return { locations, areas, value };
  }, [projects]);

  return (
    <div className="est-pipeline">
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Locations mapped</div>
        <div className="est-pipe-value">{s.locations}</div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Areas covered</div>
        <div className="est-pipe-value">{s.areas}</div>
      </div>
      <div className="est-pipe-cell">
        <div className="est-pipe-label">Mapped value</div>
        <div className="est-pipe-value"><Private>{fmt(s.value)}</Private></div>
      </div>
    </div>
  );
}

export default function Map() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const persisted = useRef(loadPersisted()).current;

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState(persisted.statusFilter || 'All');
  const [groupFilter, setGroupFilter]   = useState(persisted.groupFilter || '');
  const [mapMode, setMapMode]           = useState(persisted.mapMode || 'pins');

  // Move mode lets a pin be dragged to correct a project's location. It is
  // transient, off on every load, so the map never opens in a data editing
  // state. On a touch device a drag cannot be told apart from a pan, so the
  // whole feature is withheld there rather than risking a silent move.
  const [moveMode, setMoveMode] = useState(false);
  const isTouch = useRef(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches
  ).current;

  // A short lived undo for the last move, and a transient inline error.
  const [undoState, setUndoState] = useState(null);   // { id, orig: {lat,lng,name} }
  const [error, setError] = useState('');
  const undoTimer = useRef(null);

  const [center, setCenter] = useState(persisted.center || DEFAULT_CENTER);
  const [zoom, setZoom]     = useState(persisted.zoom || DEFAULT_ZOOM);

  const [hoveredId, setHoveredId] = useState(null);

  // Bumped whenever the theme attribute flips, so the JS resolved icon colours
  // rebuild after the new tokens are in effect (a MutationObserver fires after
  // the attribute is set, unlike a child effect which can read stale tokens).
  const [paletteTick, setPaletteTick] = useState(0);

  const mapRef = useRef(null);
  const markerRefs = useRef({});   // project id -> Leaflet marker instance

  useEffect(() => {
    const obs = new MutationObserver(() => setPaletteTick(t => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    api.get('/projects')
      .then(p => { setProjects(p); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Persist all four view pieces so the map opens where it was left.
  useEffect(() => {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify({ statusFilter, groupFilter, mapMode, center, zoom }));
    } catch (_) { /* ignore */ }
  }, [statusFilter, groupFilter, mapMode, center, zoom]);

  const mappable = useMemo(
    () => projects.filter(p => p.location_lat != null && p.location_lng != null),
    [projects]
  );

  const filtered = useMemo(() => mappable.filter(p => {
    const statusMatch = statusFilter === 'All'
      || (statusFilter === 'Active' && p.status !== 'completed')
      || (statusFilter === 'Completed' && p.status === 'completed');
    const groupMatch = !groupFilter || p.group_name === groupFilter;
    return statusMatch && groupMatch;
  }), [mappable, statusFilter, groupFilter]);

  const positions = useMemo(
    () => filtered.map(p => [parseFloat(p.location_lat), parseFloat(p.location_lng)]),
    [filtered]
  );

  // Weight each heat point by agreed budget, normalised across the visible set.
  const heatPoints = useMemo(() => {
    const maxBudget = filtered.reduce((m, p) => Math.max(m, Number(p.agreed_budget) || 0), 0);
    return filtered.map(p => {
      const b = Number(p.agreed_budget) || 0;
      const w = maxBudget > 0 ? Math.max(0.15, b / maxBudget) : 0.5;
      return [parseFloat(p.location_lat), parseFloat(p.location_lng), w];
    });
  }, [filtered]);

  // One divIcon per project: fill is the category group tint, the glyph is its
  // category icon in a computed contrasting colour, the ring is the status hue.
  // Rebuilt when the visible set or the theme palette changes.
  const iconsById = useMemo(() => {
    const out = {};
    filtered.forEach(p => {
      const { Icon, tint } = categoryVisual(p.category_name, p.group_name);
      const fill = resolveVar(tint);
      const ring = resolveVar(statusRingToken(p.status));
      const glyph = contrastOn(fill);
      const svg = renderToStaticMarkup(<Icon size={15} strokeWidth={2.4} />);
      out[p.id] = L.divIcon({
        className: 'proj-pin',
        html: `<div class="pin-inner" style="background:${fill};border-color:${ring};color:${glyph};">${svg}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, paletteTick]);

  // Cluster icon: fill and count colour computed so they always contrast, in
  // both themes. The old icon read both from ink tokens, so a light-mode count
  // was dark text on a dark circle.
  const clusterIconFn = useMemo(() => {
    const bg = resolveVar('var(--color-ink)');
    const fg = contrastOn(bg);
    return cluster => L.divIcon({
      className: 'proj-cluster',
      html: `<div class="cluster-inner" style="background:${bg};color:${fg};">${cluster.getChildCount()}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteTick]);

  // Side list, sorted by distance from the current map centre, so it re-orders
  // as the user pans and zooms.
  const listProjects = useMemo(() => {
    return [...filtered].sort((a, b) =>
      distSq([+a.location_lat, +a.location_lng], center) -
      distSq([+b.location_lat, +b.location_lng], center)
    );
  }, [filtered, center]);

  // Reflect the hovered project onto its pin. A pin currently inside a cluster
  // has no element, so it is simply skipped.
  useEffect(() => {
    Object.entries(markerRefs.current).forEach(([id, marker]) => {
      const el = marker && marker.getElement && marker.getElement();
      if (!el) return;
      el.classList.toggle('is-hover', String(id) === String(hoveredId));
    });
  }, [hoveredId, iconsById]);

  function focusProject(p) {
    const m = mapRef.current;
    if (!m) return;
    m.setView([parseFloat(p.location_lat), parseFloat(p.location_lng)], Math.max(m.getZoom(), 14), { animate: true });
  }

  function fitAll() {
    const m = mapRef.current;
    if (!m || positions.length === 0) return;
    if (positions.length === 1) m.setView(positions[0], 12);
    else m.fitBounds(positions, { padding: [48, 48] });
  }

  // Move mode only makes sense over pins, so entering it forces pins on, and
  // leaving pins for the heat view turns it back off.
  function toggleMove() {
    setMoveMode(m => {
      const next = !m;
      if (next) setMapMode('pins');
      return next;
    });
  }
  useEffect(() => {
    if (mapMode !== 'pins' && moveMode) setMoveMode(false);
  }, [mapMode, moveMode]);

  function flashError(msg) {
    setError(msg);
    setTimeout(() => setError(''), 4000);
  }

  // Every field the project update endpoint destructures, with only the
  // coordinates and the location name changed. That endpoint owns the calendar
  // sync and the status history guard, so this never writes a second path.
  function buildProjectBody(p, lat, lng, name) {
    return {
      client_id: p.client_id ?? null,
      title: p.title,
      category_id: p.category_id ?? null,
      status: p.status,
      client_budget: p.client_budget ?? 0,
      agreed_budget: p.agreed_budget ?? 0,
      notes: p.notes ?? null,
      shoot_date: p.shoot_date ?? null,
      shoot_days: p.shoot_days ?? 1,
      shoot_location: p.shoot_location ?? null,
      location_name: name ?? null,
      location_lat: lat,
      location_lng: lng,
      shoot_start_time: p.shoot_start_time ?? null,
      shoot_end_time: p.shoot_end_time ?? null,
      deadline: p.deadline ?? null,
    };
  }

  function setProjectLocation(id, lat, lng, name) {
    setProjects(prev => prev.map(x =>
      x.id === id ? { ...x, location_lat: lat, location_lng: lng, location_name: name } : x));
  }

  function snapMarker(id, lat, lng) {
    const marker = markerRefs.current[id];
    if (marker && marker.setLatLng) marker.setLatLng([parseFloat(lat), parseFloat(lng)]);
  }

  // On drop: reverse geocode the new point, then persist coordinates and the
  // refreshed name in one PUT. Optimistic, with a rollback of the pin if either
  // request fails, and a few seconds of undo on success.
  async function handleDragEnd(p, latlng) {
    if (isTouch) return;
    const orig = { lat: p.location_lat, lng: p.location_lng, name: p.location_name };
    const newLat = latlng.lat, newLng = latlng.lng;

    setProjectLocation(p.id, newLat, newLng, p.location_name);
    try {
      let newName = orig.name;
      const rev = await api.get(`/shotlists/geocode/reverse?lat=${newLat}&lng=${newLng}`);
      if (rev && rev.display_name) newName = rev.display_name;
      await api.put(`/projects/${p.id}`, buildProjectBody(p, newLat, newLng, newName));
      setProjectLocation(p.id, newLat, newLng, newName);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoState({ id: p.id, orig });
      undoTimer.current = setTimeout(() => setUndoState(null), 7000);
    } catch (_) {
      setProjectLocation(p.id, orig.lat, orig.lng, orig.name);
      snapMarker(p.id, orig.lat, orig.lng);
      flashError('Could not move the pin. It has been put back.');
    }
  }

  // Undo restores both the coordinates and the previous location name.
  async function undoMove() {
    const u = undoState;
    if (!u) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoState(null);
    const p = projects.find(x => x.id === u.id);
    if (!p) return;
    setProjectLocation(u.id, u.orig.lat, u.orig.lng, u.orig.name);
    snapMarker(u.id, u.orig.lat, u.orig.lng);
    try {
      await api.put(`/projects/${u.id}`, buildProjectBody(p, u.orig.lat, u.orig.lng, u.orig.name));
    } catch (_) {
      flashError('Could not undo the move.');
    }
  }

  // One marker, used both inside the cluster and, in move mode, as a plain
  // draggable pin. Draggability is gated on move mode and a non touch pointer.
  function renderMarker(p) {
    return (
      <Marker
        key={p.id}
        position={[parseFloat(p.location_lat), parseFloat(p.location_lng)]}
        icon={iconsById[p.id]}
        draggable={moveMode && !isTouch}
        ref={el => { if (el) markerRefs.current[p.id] = el; else delete markerRefs.current[p.id]; }}
        eventHandlers={{
          mouseover: () => setHoveredId(p.id),
          mouseout: () => setHoveredId(null),
          dragend: e => handleDragEnd(p, e.target.getLatLng()),
        }}
      >
        <Popup>
          <div style={{ minWidth: '200px', padding: '4px 0' }}>
            <div style={{ fontWeight: 700, color: 'var(--color-ink)', marginBottom: '6px', fontSize: '14px' }}>{p.title}</div>
            {p.client_name && <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px', marginBottom: '4px' }}>{p.client_name}</div>}
            {p.location_name && (
              <div title={p.location_name} style={{ color: 'var(--color-mid-gray)', fontSize: '12px', marginBottom: '6px' }}>
                {shortenAddress(p.location_name)}
              </div>
            )}
            {(Number(p.agreed_budget) || 0) > 0 && (
              <div style={{ color: 'var(--accent)', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                <Private>{fmt(p.agreed_budget)}</Private>
              </div>
            )}
            <button
              onClick={() => navigate(`/projects/${p.id}`)}
              style={{
                background: 'var(--gradient-card)',
                color: 'var(--accent-contrast)', border: 'none', borderRadius: '10px',
                padding: '5px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
              }}
            >
              View Project
            </button>
          </div>
        </Popup>
      </Marker>
    );
  }

  return (
    <div className="map-page">
      <div className="page-header" style={{ marginBottom: '12px' }}>
        <div className="page-title">Map</div>
      </div>

      {!loading && mappable.length > 0 && <StatStrip projects={filtered} />}

      {/* Filters: status pills, group icon filters, map mode toggle. */}
      <div className="map-controls">
        <div className="map-status-pills">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: '18px', padding: '4px 14px', fontSize: '12px' }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Group filter: the five group glyphs, tinted to match the pins. */}
        <div className="est-filter-dots proj-group-dots map-group-dots">
          {GROUPS.map(g => {
            const { Icon, tint } = categoryVisual(undefined, g);
            return (
              <button
                key={g}
                className={`est-filter-dot proj-group-dot ${groupFilter === g ? 'active' : ''}`}
                style={{ '--tint': tint }}
                title={g}
                aria-label={g}
                onClick={() => setGroupFilter(cur => cur === g ? '' : g)}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>

        <div className="map-mode-toggle">
          <button
            className={`btn btn-sm ${mapMode === 'pins' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '18px', padding: '4px 14px', fontSize: '12px' }}
            onClick={() => setMapMode('pins')}
          >
            Pins
          </button>
          <button
            className={`btn btn-sm ${mapMode === 'heat' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '18px', padding: '4px 14px', fontSize: '12px' }}
            onClick={() => setMapMode('heat')}
          >
            Heatmap
          </button>
        </div>

        {/* Move mode: an icon toggle, withheld on touch where a drag reads as a
            pan. Active state shows the editing surface is live. */}
        {!isTouch && (
          <button
            className={`map-move-btn${moveMode ? ' active' : ''}`}
            onClick={toggleMove}
            title={moveMode ? 'Done moving pins' : 'Move pins to correct a location'}
            aria-label="Move pins"
            aria-pressed={moveMode}
          >
            <Move size={16} />
          </button>
        )}
      </div>

      {/* Two column split: map keeps the main area, list beside it. */}
      <div className="map-split">
        <div className={`map-container${theme === 'dark' ? ' map-dark' : ''}${moveMode ? ' is-editing' : ''}`}>
          {!loading && (
            <MapContainer
              center={center}
              zoom={zoom}
              style={{ height: '100%', width: '100%', background: 'var(--surface-input-fill)' }}
              zoomControl={true}
            >
              <MapBridge
                onReady={m => { mapRef.current = m; }}
                onMove={(c, z) => { setCenter(c); setZoom(z); }}
              />

              <TileLayer url={TILE_URL} attribution={TILE_ATTRIB} maxZoom={19} />

              {/* In move mode clustering is off so every pin, including the
                  dense Pristina group, is individually draggable. */}
              {mapMode === 'pins' && (
                moveMode
                  ? filtered.map(renderMarker)
                  : (
                    <MarkerClusterGroup
                      chunkedLoading
                      zoomToBoundsOnClick
                      showCoverageOnHover={false}
                      iconCreateFunction={clusterIconFn}
                    >
                      {filtered.map(renderMarker)}
                    </MarkerClusterGroup>
                  )
              )}

              {mapMode === 'heat' && <HeatmapLayer points={heatPoints} />}
            </MapContainer>
          )}

          {!loading && positions.length > 0 && (
            <button className="map-fit-btn" onClick={fitAll} title="Fit all" aria-label="Fit all">
              <Maximize2 size={16} />
            </button>
          )}

          {!loading && mappable.length === 0 && (
            <div className="map-empty-card">
              <MapPin size={32} style={{ color: 'var(--color-mid-gray)', marginBottom: '12px' }} />
              <div style={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: '8px' }}>No project locations yet</div>
              <div style={{ color: 'var(--color-mid-gray)', fontSize: '13px' }}>
                Add shoot locations to your projects to see them here.
              </div>
            </div>
          )}

          {error && <div className="map-toast map-toast-error">{error}</div>}

          {undoState && (
            <div className="map-toast map-undo">
              <span>Location moved</span>
              <button type="button" onClick={undoMove}>Undo</button>
            </div>
          )}
        </div>

        {/* Side list of the filtered projects, nearest to the map centre first. */}
        <aside className="map-list">
          {listProjects.length === 0 ? (
            <div className="map-list-empty">No projects match</div>
          ) : (
            listProjects.map(p => (
              <button
                key={p.id}
                type="button"
                className={`map-list-row${String(hoveredId) === String(p.id) ? ' is-hover' : ''}`}
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => focusProject(p)}
              >
                <CategoryTile categoryName={p.category_name} groupName={p.group_name} size={32} />
                <span className="map-list-identity">
                  <span className="map-list-title">{p.title}</span>
                  <span className="map-list-sub" title={p.location_name || ''}>
                    {p.client_name || ''}
                    {p.client_name && p.location_name ? ', ' : ''}
                    {shortenAddress(p.location_name) || ''}
                  </span>
                </span>
              </button>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}
