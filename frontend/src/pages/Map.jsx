import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import 'react-leaflet-cluster/lib/assets/MarkerCluster.css';
import 'react-leaflet-cluster/lib/assets/MarkerCluster.Default.css';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet.heat';
import { api, fmt } from '../api';

// Fix default leaflet marker icon broken in webpack/vite environments
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function createProjectIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:20px;height:20px;border-radius:50%;
      background:linear-gradient(135deg,#0a0a0a,#0a0a0a);
      border:2px solid #e5e5e5;
      box-shadow:0 2px 8px rgba(10,10,10,0.10);
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -14],
  });
}

function HeatmapLayer({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const heat = L.heatLayer(points, { radius: 35, blur: 20, maxZoom: 10, max: 1 });
    heat.addTo(map);
    return () => { heat.remove(); };
  }, [map, points]);
  return null;
}

function FitBoundsButton({ positions }) {
  const map = useMap();
  if (positions.length === 0) return null;

  function fitAll() {
    if (positions.length === 1) {
      map.setView(positions[0], 10);
    } else {
      map.fitBounds(positions, { padding: [40, 40] });
    }
  }

  return (
    <button
      onClick={fitAll}
      className="btn btn-secondary btn-sm"
      style={{
        position: 'absolute', top: '12px', right: '12px', zIndex: 1000,
        boxShadow: '0 2px 12px rgba(10,10,10,0.10)',
        borderRadius: '10px',
      }}
    >
      Fit All
    </button>
  );
}

const STATUS_OPTIONS = ['All', 'Active', 'Completed'];

export default function Map() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [mapMode, setMapMode] = useState('pins'); // 'pins' | 'heat'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/projects'), api.get('/settings/project-categories')])
      .then(([p, c]) => { setProjects(p); setCategories(c); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const mappable = projects.filter(p =>
    p.location_lat != null && p.location_lng != null
  );

  const filtered = mappable.filter(p => {
    const statusMatch = statusFilter === 'All' ||
      (statusFilter === 'Active' && p.status !== 'completed') ||
      (statusFilter === 'Completed' && p.status === 'completed');
    const catMatch = !categoryFilter || String(p.category_id) === categoryFilter;
    return statusMatch && catMatch;
  });

  const positions = filtered.map(p => [parseFloat(p.location_lat), parseFloat(p.location_lng)]);
  // Heatmap points: [lat, lng, intensity] — each project contributes equally (weight 1)
  const heatPoints = filtered.map(p => [parseFloat(p.location_lat), parseFloat(p.location_lng), 1]);
  const projectIcon = createProjectIcon();

  const defaultCenter = [50.0, 15.0];
  const defaultZoom = 4;

  const categoryGroups = categories.reduce((acc, c) => {
    acc[c.group_name] = acc[c.group_name] || [];
    acc[c.group_name].push(c);
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' }}>
      <div className="page-header" style={{ marginBottom: '16px', flexShrink: 0 }}>
        <div>
          <div className="page-title">Projects Map</div>
          <div className="page-subtitle">
            {mappable.length} project{mappable.length !== 1 ? 's' : ''} with locations
          </div>
        </div>
      </div>

      {/* Filters + map mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '6px' }}>
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
        <select
          className="select"
          style={{ fontSize: '12px', padding: '6px 12px', minWidth: '160px' }}
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
        >
          <option value="">All Categories</option>
          {Object.entries(categoryGroups).map(([g, cats]) => (
            <optgroup key={g} label={g}>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>

        {/* View toggle: Pins vs Heatmap */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
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
      </div>

      {/* Map */}
      <div className="map-container" style={{ flex: 1, borderRadius: '24px', overflow: 'hidden', position: 'relative' }}>
        {!loading && (
          <MapContainer
            center={defaultCenter}
            zoom={defaultZoom}
            style={{ height: '100%', width: '100%', background: '#f5f5f5' }}
            zoomControl={true}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
              subdomains="abcd"
              maxZoom={20}
            />

            {mapMode === 'pins' && (
              <MarkerClusterGroup
                chunkedLoading
                iconCreateFunction={cluster => L.divIcon({
                  className: '',
                  html: `<div style="
                    width:36px;height:36px;border-radius:50%;
                    background:linear-gradient(135deg,#0a0a0a,#0a0a0a);
                    border:2px solid #e5e5e5;
                    box-shadow:0 2px 8px rgba(10,10,10,0.10);
                    display:flex;align-items:center;justify-content:center;
                    color:#0a0a0a;font-size:13px;font-weight:700;
                  ">${cluster.getChildCount()}</div>`,
                  iconSize: [36, 36],
                  iconAnchor: [18, 18],
                })}
              >
                {filtered.map(p => (
                  <Marker
                    key={p.id}
                    position={[parseFloat(p.location_lat), parseFloat(p.location_lng)]}
                    icon={projectIcon}
                  >
                    <Popup>
                      <div style={{ background: '#fafafa', minWidth: '200px', padding: '4px 0' }}>
                        <div style={{ fontWeight: 700, color: '#0a0a0a', marginBottom: '6px', fontSize: '14px' }}>{p.title}</div>
                        {p.client_name && <div style={{ color: '#737373', fontSize: '12px', marginBottom: '4px' }}>{p.client_name}</div>}
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
                          {p.category_name && (
                            <span style={{ background: 'rgba(10,10,10,0.05)', color: 'var(--accent)', padding: '2px 8px', borderRadius: '18px', fontSize: '11px' }}>
                              {p.category_name}
                            </span>
                          )}
                          <span style={{ background: 'rgba(10,10,10,0.05)', color: '#171717', padding: '2px 8px', borderRadius: '18px', fontSize: '11px' }}>
                            {p.status?.replace(/-/g, ' ')}
                          </span>
                        </div>
                        {p.agreed_budget > 0 && (
                          <div style={{ color: 'var(--accent)', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                            {fmt(p.agreed_budget)}
                          </div>
                        )}
                        <button
                          onClick={() => navigate(`/projects/${p.id}`)}
                          style={{
                            background: 'var(--gradient-card)',
                            color: '#fafafa', border: 'none', borderRadius: '10px',
                            padding: '5px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                          }}
                        >
                          View Project →
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MarkerClusterGroup>
            )}

            {mapMode === 'heat' && <HeatmapLayer points={heatPoints} />}

            <FitBoundsButton positions={positions} />
          </MapContainer>
        )}

        {!loading && mappable.length === 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 1000, background: '#ffffff', border: '1px solid #e5e5e5',
            boxShadow: 'var(--shadow-overlay)',
            borderRadius: 'var(--radius-cards)', padding: '32px 40px', textAlign: 'center', maxWidth: '360px',
          }}>
            <MapPin size={32} style={{ color: '#737373', marginBottom: '12px' }} />
            <div style={{ color: '#0a0a0a', fontWeight: 600, marginBottom: '8px' }}>No project locations yet</div>
            <div style={{ color: '#737373', fontSize: '13px' }}>
              Add shoot locations to your projects to see them here.
            </div>
          </div>
        )}
      </div>

      <footer style={{ marginTop: '12px', textAlign: 'center', fontSize: '11px', color: '#737373', flexShrink: 0 }}>built by year28</footer>
    </div>
  );
}
