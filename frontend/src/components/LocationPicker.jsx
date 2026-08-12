import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, Link2, MapPin, Loader2 } from 'lucide-react';
import { api } from '../api';

// Free stack only: Leaflet with OpenStreetMap tiles, Nominatim for search, and
// coordinate extraction from a pasted Google Maps URL. No Maps JavaScript API,
// no SDK key, no billing anywhere in this component.

const PIN_ICON = L.divIcon({
  className: '',
  html: `<div style="
    width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
    background:var(--color-ink);border:2px solid var(--color-surface-alt);
    box-shadow:0 2px 6px var(--overlay-07);
  "></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 18],
});

const DEFAULT_CENTER = [42.6629, 21.1655]; // Pristina

// Full Google Maps URLs carry coordinates in a handful of shapes. A shortened
// link (maps.app.goo.gl / goo.gl/maps) carries none, and resolving it would
// mean calling out to Google — so those are refused with an instruction
// instead of failing quietly.
export function parseGoogleMapsUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, reason: 'empty' };

  if (/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(text)) {
    return { ok: false, reason: 'shortlink' };
  }

  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,             // .../@42.66,21.16,15z
    /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,      // ...?q=42.66,21.16
    /[?&]query=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,  // ...?query=42.66,21.16
    /[?&]destination=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,          // place data blob
    /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/,    // bare "lat, lng"
  ];

  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { ok: true, lat, lng };
      }
    }
  }
  return { ok: false, reason: 'no_coords' };
}

function ClickCapture({ onPick }) {
  useMapEvents({
    click(e) { onPick(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

function Recenter({ position }) {
  const map = useMap();

  // The picker lives inside a modal, so Leaflet measures the container before
  // it has its final size. Without this the projection is wrong and a tap
  // returns nonsense coordinates.
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 120);
    return () => clearTimeout(t);
  }, [map]);

  useEffect(() => {
    if (position) map.setView(position, Math.max(map.getZoom(), 13));
  }, [position && position[0], position && position[1]]);
  return null;
}

// Number(null) and Number('') are both 0, so an unpinned location would read
// as a valid pin at 0,0 (and drag the map to the Atlantic). Coordinates are
// only real when they arrive as a number or a non-empty numeric string.
function coord(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function LocationPicker({ value, onChange, height = 260 }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [pasteValue, setPasteValue] = useState('');
  const [pasteMessage, setPasteMessage] = useState('');
  const debounce = useRef(null);
  const searchSeq = useRef(0);

  const lat = coord(value.lat);
  const lng = coord(value.lng);
  const hasPin = lat !== null && lng !== null;
  const position = hasPin ? [lat, lng] : null;

  // Nominatim asks for light traffic and an identifying user agent, so the
  // query is debounced here and the request itself is made by the server,
  // which can set that header.
  useEffect(() => {
    clearTimeout(debounce.current);
    const term = query.trim();
    if (term.length < 3) { setResults([]); setSearchError(''); return; }

    debounce.current = setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      const seq = ++searchSeq.current;
      try {
        const data = await api.get(`/shotlists/geocode?q=${encodeURIComponent(term)}`);
        if (seq !== searchSeq.current) return;   // a newer keystroke won
        setResults(Array.isArray(data) ? data : []);
        if (!Array.isArray(data) || data.length === 0) {
          setSearchError('Nothing found. Drop the pin on the map instead.');
        }
      } catch (err) {
        if (seq !== searchSeq.current) return;
        setResults([]);
        setSearchError('Place search is unavailable right now. Tap the map to pin the spot manually.');
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 600);

    return () => clearTimeout(debounce.current);
  }, [query]);

  function pick(lat, lng, patch = {}) {
    onChange({ ...value, lat, lng, ...patch });
  }

  function useResult(r) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    pick(lat, lng, {
      name: value.name || r.name || '',
      address: r.display_name || value.address || '',
    });
    setResults([]);
    setQuery('');
  }

  function applyPaste() {
    const parsed = parseGoogleMapsUrl(pasteValue);
    if (parsed.ok) {
      pick(parsed.lat, parsed.lng);
      setPasteMessage(`Pinned at ${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`);
      setPasteValue('');
      return;
    }
    if (parsed.reason === 'shortlink') {
      setPasteMessage('That is a shortened Google link with no coordinates in it. Open it in Google Maps, then copy the full URL from the address bar and paste that here.');
      return;
    }
    setPasteMessage('No coordinates in that link. Paste the full Google Maps URL, or tap the map to pin it.');
  }

  return (
    <div className="loc-picker">
      <div className="loc-picker-tools">
        <div className="loc-picker-field">
          <Search size={13} />
          <input
            className="input"
            placeholder="Search a place by name"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {searching && <Loader2 size={13} className="pitch-spin" />}
        </div>
        {searchError && <div className="loc-picker-msg">{searchError}</div>}
        {results.length > 0 && (
          <div className="loc-picker-results">
            {results.map(r => (
              <button type="button" key={r.id} className="loc-picker-result" onClick={() => useResult(r)}>
                <MapPin size={12} />
                <span>{r.display_name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="loc-picker-field">
          <Link2 size={13} />
          <input
            className="input"
            placeholder="Paste a full Google Maps URL"
            value={pasteValue}
            onChange={e => { setPasteValue(e.target.value); setPasteMessage(''); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyPaste(); } }}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={applyPaste} disabled={!pasteValue.trim()}>
            Use link
          </button>
        </div>
        {pasteMessage && <div className="loc-picker-msg">{pasteMessage}</div>}
      </div>

      <div className="loc-picker-map" style={{ height }}>
        <MapContainer
          center={position || DEFAULT_CENTER}
          zoom={position ? 14 : 9}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          <ClickCapture onPick={(lat, lng) => pick(lat, lng)} />
          <Recenter position={position} />
          {position && <Marker position={position} icon={PIN_ICON} />}
        </MapContainer>
      </div>

      <div className="loc-picker-coords">
        {hasPin
          ? <>Pinned at {lat.toFixed(5)}, {lng.toFixed(5)}</>
          : <>Tap the map, search a place, or paste a Google Maps link to drop the pin.</>}
        {hasPin && (
          <button type="button" className="btn-ghost" style={{ padding: '2px 6px', fontSize: '11px' }}
            onClick={() => onChange({ ...value, lat: null, lng: null })}>
            Clear pin
          </button>
        )}
      </div>
    </div>
  );
}
