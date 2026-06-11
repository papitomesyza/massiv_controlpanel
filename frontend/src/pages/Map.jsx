import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
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
      background:linear-gradient(135deg,#FF902F,#723CEB);
      border:2px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.5);
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -14],
  });
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
    <div
      onClick={fitAll}
      style={{
        position: 'absolute', top: '12px', right: '12px', zIndex: 1000,
        background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.15)',
        color: '#fff', padding: '6px 14px', borderRadius: '8px',
        cursor: 'pointer', fontSize: '12px', fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}
    >
      Fit All
    </div>
  );
}

const STATUS_OPTIONS = ['All', 'Active', 'Completed'];

export default function Map() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('');
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

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: '50px', padding: '4px 14px', fontSize: '12px' }}
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
      </div>

      {/* Map */}
      <div className="map-container" style={{ flex: 1, borderRadius: '16px', overflow: 'hidden', position: 'relative' }}>
        {!loading && (
          <MapContainer
            center={defaultCenter}
            zoom={defaultZoom}
            style={{ height: '100%', width: '100%', background: '#131313' }}
            zoomControl={true}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
              subdomains="abcd"
              maxZoom={20}
            />

            {filtered.map(p => (
              <Marker
                key={p.id}
                position={[parseFloat(p.location_lat), parseFloat(p.location_lng)]}
                icon={projectIcon}
              >
                <Popup>
                  <div style={{ background: '#1e1e1e', minWidth: '200px', padding: '4px 0' }}>
                    <div style={{ fontWeight: 700, color: '#fff', marginBottom: '6px', fontSize: '14px' }}>{p.title}</div>
                    {p.client_name && <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>{p.client_name}</div>}
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
                      {p.category_name && (
                        <span style={{ background: 'rgba(114,60,235,0.2)', color: '#a78bfa', padding: '2px 8px', borderRadius: '50px', fontSize: '11px' }}>
                          {p.category_name}
                        </span>
                      )}
                      <span style={{ background: 'rgba(255,255,255,0.08)', color: '#ccc', padding: '2px 8px', borderRadius: '50px', fontSize: '11px' }}>
                        {p.status?.replace(/-/g, ' ')}
                      </span>
                    </div>
                    {p.agreed_budget > 0 && (
                      <div style={{ color: '#FF902F', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                        {fmt(p.agreed_budget)}
                      </div>
                    )}
                    <button
                      onClick={() => navigate(`/projects/${p.id}`)}
                      style={{
                        background: 'linear-gradient(135deg,#FF902F,#723CEB)',
                        color: '#fff', border: 'none', borderRadius: '8px',
                        padding: '5px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      View Project →
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}

            <FitBoundsButton positions={positions} />
          </MapContainer>
        )}

        {!loading && mappable.length === 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 1000, background: 'rgba(19,19,19,0.9)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px', padding: '32px 40px', textAlign: 'center', maxWidth: '360px',
          }}>
            <MapPin size={32} style={{ color: '#444', marginBottom: '12px' }} />
            <div style={{ color: '#fff', fontWeight: 600, marginBottom: '8px' }}>No project locations yet</div>
            <div style={{ color: '#666', fontSize: '13px' }}>
              Add shoot locations to your projects to see them here.
            </div>
          </div>
        )}
      </div>

      <footer style={{ marginTop: '12px', textAlign: 'center', fontSize: '11px', color: '#444', flexShrink: 0 }}>built by year28</footer>
    </div>
  );
}
