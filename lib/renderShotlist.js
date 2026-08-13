// Server-side renderer for the public crew page (GET /s/:slug).
//
// This is NOT a pitch page and must never look like one. It is a production
// document: read one-handed, outdoors, in bright sun, by someone holding
// equipment. Light background with near-black text by default, a dark-mode
// toggle remembered on the device, large type, strong contrast, generous tap
// targets, native scroll, no decorative animation. Interactive here means
// useful — day tabs, collapsible scenes, an image viewer, a clock-aware
// current-item bar, an incomplete filter — never showy.
//
// Fully self-contained: all CSS, JS and icons inline, no external request
// except the shot list's own media under /s-media. Every user string goes
// through esc().

const { fmtDuration, fmtClip, fmtAgeRange } = require('./shotlistSchedule');
const { ZONE } = require('./sunWindows');

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Media filenames are generated server-side, but a tampered row must never
// break out of /s-media/ — same guard the serving route applies.
function mediaSrc(filename) {
  if (!filename || typeof filename !== 'string') return null;
  if (/[/\\]/.test(filename) || filename.includes('..')) return null;
  return `/s-media/${encodeURIComponent(filename)}`;
}

function fmtDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return '';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`;
}

function fmtDateShort(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return '';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''}`;
}

// Plain Google Maps deep link, built from the stored coordinates. No key, no
// billing, opens navigation in whatever maps app the phone uses.
function directionsUrl(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lng)}`;
}

const LENS_LABELS = {
  ultra_wide: 'Ultra wide', wide: 'Wide', standard: 'Standard', portrait: 'Portrait',
  telephoto: 'Telephoto', macro: 'Macro', probe: 'Probe', anamorphic: 'Anamorphic',
  fisheye: 'Fisheye', tilt_shift: 'Tilt shift', zoom: 'Zoom',
};

function lensLabel(shot) {
  const base = shot.lens ? (LENS_LABELS[shot.lens] || shot.lens) : '';
  if (base && shot.lens_detail) return `${base} · ${shot.lens_detail}`;
  return base || shot.lens_detail || '';
}

// ── Icons ────────────────────────────────────────────────────────────────────
// Defined once in an inline SVG sprite and referenced by <use>. Nothing is
// loaded from anywhere: the page still makes no external request.

const ICON_PATHS = {
  interior: '<path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-7h6v7"/>',
  exterior: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sunrise: '<path d="M12 4v5M5.6 10.6 7 12M2 17h20M18.4 10.6 17 12M8 17a4 4 0 0 1 8 0"/><path d="m9 6 3-3 3 3"/>',
  sunset: '<path d="M12 9V4M5.6 10.6 7 12M2 17h20M18.4 10.6 17 12M8 17a4 4 0 0 1 8 0"/><path d="m9 6 3 3 3-3"/>',
  golden: '<circle cx="12" cy="14" r="4"/><path d="M2 20h20M12 4v3M4.5 7.5 6 9M19.5 7.5 18 9"/>',
  blue: '<path d="M3 16h18"/><circle cx="12" cy="16" r="3.5"/><path d="M6 10.5 7.5 12M18 10.5 16.5 12M12 6v2.5"/>',
  daylight: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.2 4.2 6.3 6.3M17.7 17.7l2.1 2.1M4.2 19.8 6.3 17.7M17.7 6.3l2.1-2.1"/>',
  night: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  anytime: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  lens: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/>',
  character: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/>',
  costume: '<path d="M8 3 5 5.5V10l2 1v10h10V11l2-1V5.5L16 3l-4 2.5z"/>',
  props: '<path d="M4 8h16v12H4z"/><path d="M9 8V5a3 3 0 0 1 6 0v3"/>',
  set: '<path d="M3 20V7l4-3 4 3v13"/><path d="M11 20V11l5-3 5 3v9"/><path d="M15 20v-4h2v4"/>',
  location: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  directions: '<path d="M12 2 22 12 12 22 2 12z"/><path d="M9.5 14v-2.5A2.5 2.5 0 0 1 12 9h3.5"/><path d="m13.5 7 2.5 2-2.5 2"/>',
  move: '<path d="M2 16h3l1.5-4.5A3 3 0 0 1 9.4 9.5h5.2a3 3 0 0 1 2.9 2L19 16h3"/><path d="M2 16v3h3v-3M19 16v3h3v-3"/><circle cx="7.5" cy="16" r="1.5"/><circle cx="16.5" cy="16" r="1.5"/>',
  breakfast: '<path d="M4 9h13v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h2.5a2.5 2.5 0 0 1 0 5H17"/><path d="M7 5V3M11 5V3"/>',
  lunch: '<path d="M6 3v8M6 11v10M9 3v5a3 3 0 0 1-3 3"/><path d="M16 3c-1.5 2-2 4-2 6s.7 2.5 2 2.5V21"/>',
  dinner: '<path d="M4 11a8 8 0 0 1 16 0z"/><path d="M2 15h20M6 19h12"/>',
  break: '<path d="M5 9h11v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z"/><path d="M16 10h2.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 5V3M12 5V3"/>',
  locked: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  clip: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m3 10 18 0M8 6 6 10M13 6l-2 4M18 6l-2 4"/>',
  done: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16 9.5"/>',
  pending: '<circle cx="12" cy="12" r="9"/>',
  camera: '<path d="M3 8h4l1.5-2h7L17 8h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>',
  shot: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M9 5v5M15 5v5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  crew: '<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 8.5a2.5 2.5 0 1 0 0-5"/><path d="M17 13.7c2.4.5 4 2.4 4 5.3"/>',
};

const WINDOW_ICON = {
  sunrise: 'sunrise', sunset: 'sunset',
  morning_golden: 'golden', evening_golden: 'golden',
  morning_blue: 'blue', evening_blue: 'blue',
  daylight: 'daylight', window_daylight: 'daylight',
  night: 'night', night_interior: 'night', any_time: 'anytime',
};

function iconSprite() {
  const symbols = Object.entries(ICON_PATHS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join('');
  return `<svg class="sprite" aria-hidden="true" focusable="false"><defs>${symbols}</defs></svg>`;
}

function icon(name, cls) {
  if (!ICON_PATHS[name]) return '';
  return `<svg class="ic${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

// Wardrobe for everyone in a scene, grouped by character. This is continuity
// reference: on the day it answers "which coat, which shirt" without a phone
// call. Every photo opens in the same full-screen viewer as the shot media.
function wardrobeStrip(cast) {
  const dressed = (cast || []).filter(c => (c.wardrobe || []).length);
  if (!dressed.length) return '';

  const groups = dressed.map(c => {
    const looks = c.wardrobe.map(w => {
      const full = mediaSrc(w.filename);
      const thumb = mediaSrc(w.thumb_filename || w.filename);
      if (!full) return '';
      return `<figure><button type="button" data-full="${full}"><img src="${thumb}" alt="" loading="lazy"></button>` +
        `${w.label ? `<figcaption>${esc(w.label)}</figcaption>` : ''}</figure>`;
    }).filter(Boolean).join('');
    if (!looks) return '';
    return `<div class="wardrobe-group">
      <div class="wardrobe-who">${icon('costume')} ${esc(c.name)}${c.performer ? ` · ${esc(c.performer)}` : ''}</div>
      <div class="wardrobe-looks media">${looks}</div>
    </div>`;
  }).filter(Boolean).join('');

  if (!groups) return '';
  return `<div class="wardrobe"><div class="wardrobe-k">${icon('costume')}Wardrobe</div>${groups}</div>`;
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
:root{
  --bg:#f4f4f2;--panel:#ffffff;--ink:#0b0b0c;--ink-2:#3d3d42;--ink-3:#66666e;
  --line:#d5d5d0;--line-2:#e6e6e2;--accent:#0b0b0c;--ok:#1c6b3a;--ok-bg:#e6f3ea;
  --warn:#8a4b00;--chip:#ececE7;--move:#e9e9f2;--meal:#f6f0e4;--shadow:0 1px 0 rgba(0,0,0,0.04);
}
html[data-theme="dark"]{
  --bg:#0d0d0f;--panel:#17171a;--ink:#f4f4f2;--ink-2:#c7c7cc;--ink-3:#95959d;
  --line:#33333a;--line-2:#26262b;--accent:#f4f4f2;--ok:#5fd08a;--ok-bg:#12301f;
  --warn:#f0b06a;--chip:#26262b;--move:#232334;--meal:#2b2618;--shadow:none;
}
body{background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif;
  font-size:17px;line-height:1.45;-webkit-font-smoothing:antialiased;padding-bottom:64px}
img{display:block;max-width:100%}
button{font:inherit;color:inherit;cursor:pointer}
a{color:inherit}
.wrap{max-width:820px;margin:0 auto;padding:0 14px}
.sprite{position:absolute;width:0;height:0;overflow:hidden}
.ic{width:1.05em;height:1.05em;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.7;
  stroke-linecap:round;stroke-linejoin:round;vertical-align:-0.15em}

/* header */
.head{background:var(--panel);border-bottom:1px solid var(--line);padding:18px 0 14px}
.head-top{display:flex;align-items:flex-start;gap:12px}
.title{font-size:26px;font-weight:800;letter-spacing:-0.02em;line-height:1.15;flex:1;min-width:0;overflow-wrap:anywhere}
.theme-btn{flex-shrink:0;background:var(--chip);border:1px solid var(--line);border-radius:12px;
  min-width:52px;min-height:44px;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chip{display:inline-flex;align-items:center;gap:6px;background:var(--chip);border-radius:10px;
  padding:7px 11px;font-size:14px;font-weight:600;color:var(--ink-2)}

/* day tabs */
.days{display:flex;gap:8px;overflow-x:auto;padding:12px 0 2px;-webkit-overflow-scrolling:touch}
.day-tab{flex-shrink:0;min-height:56px;padding:8px 14px;border-radius:12px;border:1px solid var(--line);
  background:var(--chip);text-align:left;display:flex;flex-direction:column;gap:2px}
.day-tab[aria-selected="true"]{background:var(--accent);color:var(--bg);border-color:var(--accent)}
.day-tab b{font-size:15px;font-weight:800}
.day-tab span{font-size:13px;opacity:.75}

/* day header */
.dayhead{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin:14px 0}
.callrow{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.call{background:var(--chip);border-radius:11px;padding:10px 12px}
.call-k{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800;letter-spacing:0.08em;
  text-transform:uppercase;color:var(--ink-3)}
.call-v{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px}
.call.crew{background:var(--accent);color:var(--bg)}
.call.crew .call-k{color:var(--bg);opacity:.85}
.dayfacts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.progress{margin-top:12px}
.progress-num{font-size:15px;font-weight:700;margin-bottom:6px}
.bar{height:10px;border-radius:6px;background:var(--line-2);overflow:hidden}
.bar-fill{height:100%;background:var(--accent);width:0%}
.filter-row{display:flex;gap:8px;margin-top:12px}
.filter-btn{flex:1;min-height:48px;border-radius:12px;border:1px solid var(--line);background:var(--chip);
  font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px}
.filter-btn[aria-pressed="true"]{background:var(--accent);color:var(--bg);border-color:var(--accent)}

/* sticky current item */
.now{position:sticky;top:0;z-index:20;background:var(--panel);border-bottom:1px solid var(--line);box-shadow:var(--shadow)}
.now-inner{display:flex;align-items:center;gap:10px;padding:10px 0;min-height:58px}
.now-label{font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);flex-shrink:0}
.now-text{font-size:16px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.now-time{font-size:16px;font-weight:800;flex-shrink:0;font-variant-numeric:tabular-nums}
.now-jump{flex-shrink:0;min-height:42px;padding:0 14px;border-radius:11px;border:1px solid var(--line);
  background:var(--chip);font-size:14px;font-weight:700}

/* scenes */
.list{padding:8px 0 24px}
.scene{background:var(--panel);border:1px solid var(--line);border-radius:16px;margin-bottom:14px;overflow:hidden}
.scene.done{opacity:.72}
.scene-head{display:flex;gap:12px;padding:14px;width:100%;background:none;border:0;text-align:left;align-items:flex-start;color:inherit}
.scene-num{flex-shrink:0;min-width:48px;height:48px;border-radius:12px;background:var(--accent);color:var(--bg);
  display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:800;
  font-variant-numeric:tabular-nums;padding:0 8px}
.scene-headline{flex:1;min-width:0}
.scene-label{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:0.14em;
  text-transform:uppercase;color:var(--ink-3)}
.scene-title{font-size:23px;font-weight:800;letter-spacing:-0.02em;line-height:1.2;margin-top:1px;overflow-wrap:anywhere}
.scene-time{font-size:16px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums;
  display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.scene-time span{font-weight:500;color:var(--ink-3)}
.chev{flex-shrink:0;align-self:center;font-size:22px;color:var(--ink-3)}
.tags{display:flex;flex-wrap:wrap;gap:7px;padding:0 14px 14px}
.tag{display:inline-flex;align-items:center;gap:6px;border-radius:9px;padding:6px 10px;font-size:14px;
  font-weight:650;background:var(--chip);color:var(--ink-2)}
.tag.hard{background:var(--accent);color:var(--bg)}
.tag.lock{background:var(--accent);color:var(--bg)}
.rows{border-top:1px solid var(--line-2)}
.row{display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line-2);font-size:16px}
.row:last-child{border-bottom:none}
.row-k{flex-shrink:0;width:112px;font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;
  color:var(--ink-3);padding-top:2px;display:flex;align-items:flex-start;gap:6px}
.row-v{flex:1;min-width:0;overflow-wrap:anywhere}
.loc{padding:12px 14px;border-top:1px solid var(--line-2);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.loc-text{flex:1;min-width:140px}
.loc-name{font-size:16px;font-weight:700;display:flex;align-items:center;gap:7px}
.loc-addr{font-size:14px;color:var(--ink-3);margin-top:2px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:48px;padding:0 16px;
  border-radius:12px;border:1px solid var(--line);background:var(--chip);font-size:15px;font-weight:700;
  text-decoration:none;flex-shrink:0}
.btn-solid{background:var(--accent);color:var(--bg);border-color:var(--accent)}
.btn-wide{width:100%}
.scene-shots{padding:12px 10px 14px;display:flex;flex-direction:column;gap:10px}
.scene-empty{padding:12px 14px 16px;font-size:15px;color:var(--ink-3)}

/* shots */
.shot{background:var(--bg);border:1px solid var(--line-2);border-radius:12px;overflow:hidden}
.shot.done{opacity:.62}
.shot.hidden-filter{display:none}
.shot-head{display:flex;gap:11px;padding:12px 12px 8px}
.num{flex-shrink:0;min-width:40px;height:40px;border-radius:10px;background:var(--chip);
  display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;
  font-variant-numeric:tabular-nums;padding:0 6px}
.shot.done .num{background:var(--ok-bg);color:var(--ok)}
.shot-headline{flex:1;min-width:0}
.shot-title{font-size:18px;font-weight:750;letter-spacing:-0.01em;line-height:1.25;overflow-wrap:anywhere}
.shot-time{font-size:15px;font-weight:700;margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.shot-time span{font-weight:500;color:var(--ink-3);display:inline-flex;align-items:center;gap:5px}
.shot .tags,.shot .rows .row{padding-left:12px;padding-right:12px}
.shot .media-wrap,.shot .complete-wrap,.shot .done-note{padding-left:12px;padding-right:12px}
.media-wrap{padding:0 14px 14px}
.media-toggle{width:100%;min-height:48px;border-radius:12px;border:1px solid var(--line);background:var(--chip);
  font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:10px}
.media img{width:100%;aspect-ratio:4 / 3;object-fit:cover;border-radius:10px;background:var(--line-2)}
.media figure{margin:0}
.media button{display:block;width:100%;padding:0;border:0;background:none}
.media figcaption{font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-3);margin-top:4px}
/* wardrobe — continuity reference, portrait crops so a full look reads */
.wardrobe{padding:10px 14px 4px;border-top:1px solid var(--line-2)}
.wardrobe-k{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;
  letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px}
.wardrobe-group{margin-bottom:10px}
.wardrobe-who{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:700;color:var(--ink-2)}
.wardrobe-looks{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));margin-top:6px}
.wardrobe-looks img{aspect-ratio:3 / 4}
.wardrobe-looks figcaption{text-transform:none;letter-spacing:0;font-weight:600;font-size:12px}
.complete-wrap{padding:0 14px 14px}
.done-note{font-size:14px;color:var(--ok);font-weight:700;padding:0 14px 12px;display:flex;align-items:center;gap:6px}

/* company moves and breaks */
.block{border-radius:14px;padding:13px 14px;margin-bottom:14px;border:1px solid var(--line)}
.block.move{background:var(--move)}
.block.meal{background:var(--meal)}
.block-head{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:800}
.block-time{margin-left:auto;font-variant-numeric:tabular-nums;font-size:16px;font-weight:800}
.block-sub{font-size:15px;color:var(--ink-2);margin-top:5px}
.block-parts{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}
.part{display:inline-flex;align-items:center;gap:5px;background:rgba(127,127,127,0.16);border-radius:9px;
  padding:5px 9px;font-size:13.5px;font-weight:650}
.block .btn{margin-top:10px}

/* image viewer */
.viewer{position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:60;display:flex;align-items:center;
  justify-content:center;padding:16px}
.viewer img{max-width:100%;max-height:82vh;border-radius:8px}
.viewer-close{position:absolute;top:14px;right:14px;min-width:52px;min-height:52px;border-radius:14px;
  border:1px solid rgba(255,255,255,0.35);background:rgba(0,0,0,0.5);color:#fff;font-size:22px;font-weight:700}

/* passcode sheet */
.sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:70;display:flex;align-items:flex-end;justify-content:center}
.sheet{background:var(--panel);width:100%;max-width:520px;border-radius:16px 16px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}
.sheet h2{font-size:19px;font-weight:800;margin-bottom:4px}
.sheet p{font-size:14px;color:var(--ink-3);margin-bottom:14px}
.field{margin-bottom:12px}
.field label{display:block;font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}
.field input{width:100%;min-height:50px;border-radius:12px;border:1px solid var(--line);background:var(--bg);
  color:var(--ink);padding:0 14px;font-size:17px}
.sheet-err{color:#b3261e;font-size:14px;font-weight:650;margin-bottom:10px}
html[data-theme="dark"] .sheet-err{color:#ff8a80}
.sheet-actions{display:flex;gap:10px}
.sheet-actions .btn{flex:1}
.foot{text-align:center;font-size:13px;color:var(--ink-3);padding:24px 0 8px}
@media (min-width:700px){
  .title{font-size:32px}
  .scene-title{font-size:27px}
  .callrow{grid-template-columns:repeat(4,1fr)}
}
/* Declared last and !important on purpose: .hidden has to beat the display
   rules of everything it is applied to. */
.hidden{display:none !important}
`;

// ── Client behaviour ─────────────────────────────────────────────────────────
// Interactive, not showy: day tabs, collapsible scenes, an image viewer, a
// clock-aware current-item bar and a filter for what is still left.

function clientJs(slug, hasPasscode, zone) {
  return `
(function(){
  var SLUG = ${JSON.stringify(String(slug))};
  var ZONE = ${JSON.stringify(String(zone))};
  var THEME_KEY = 'massiv_shotlist_theme';
  var CREW_KEY = 'massiv_shotlist_crew_' + SLUG;
  var DAY_KEY = 'massiv_shotlist_day_' + SLUG;

  // Theme — remembered on this device only.
  function applyTheme(t){ document.documentElement.setAttribute('data-theme', t);
    var b = document.getElementById('themeBtn'); if (b) { b.textContent = t === 'dark' ? '☀' : '☾';
      b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); } }
  var savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
  applyTheme(savedTheme === 'dark' ? 'dark' : 'light');
  var themeBtn = document.getElementById('themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', function(){
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  // ── Day tabs ──
  var panels = [].slice.call(document.querySelectorAll('.day-panel'));
  var tabs = [].slice.call(document.querySelectorAll('.day-tab'));
  var currentDay = null;
  function showDay(id){
    currentDay = id;
    panels.forEach(function(p){ p.classList.toggle('hidden', p.getAttribute('data-day') !== id); });
    tabs.forEach(function(t){ t.setAttribute('aria-selected', String(t.getAttribute('data-day') === id)); });
    try { localStorage.setItem(DAY_KEY, id); } catch (e) {}
    refreshProgress();
    refreshNow();
  }
  tabs.forEach(function(t){ t.addEventListener('click', function(){ showDay(t.getAttribute('data-day')); }); });
  if (panels.length) {
    var wanted = null;
    try { wanted = localStorage.getItem(DAY_KEY); } catch (e) {}
    var exists = panels.some(function(p){ return p.getAttribute('data-day') === wanted; });
    showDay(exists ? wanted : panels[0].getAttribute('data-day'));
  }

  // ── Scenes expand to reveal their shots ──
  document.querySelectorAll('.scene-head').forEach(function(head){
    head.addEventListener('click', function(){
      var body = document.getElementById(head.getAttribute('aria-controls'));
      if (!body) return;
      var open = !body.classList.contains('hidden');
      body.classList.toggle('hidden', open);
      head.setAttribute('aria-expanded', String(!open));
      var chev = head.querySelector('.chev');
      if (chev) chev.textContent = open ? '\\u203A' : '\\u2304';
    });
  });

  // Photos open one shot at a time.
  document.querySelectorAll('.media-toggle').forEach(function(btn){
    btn.addEventListener('click', function(){
      var box = document.getElementById(btn.getAttribute('data-target'));
      if (!box) return;
      var open = !box.classList.contains('hidden');
      box.classList.toggle('hidden', open);
      var label = btn.querySelector('.label');
      if (label) label.textContent = open ? btn.getAttribute('data-open-label') : 'Hide photos';
    });
  });

  // ── Full screen image viewer ──
  var viewer = document.getElementById('viewer');
  var viewerImg = document.getElementById('viewerImg');
  function openViewer(src){
    if (!viewer || !viewerImg || !src) return;
    viewerImg.src = src;
    viewer.classList.remove('hidden');
  }
  function closeViewer(){ if (viewer) { viewer.classList.add('hidden'); viewerImg.removeAttribute('src'); } }
  // Any photo carrying data-full opens in the viewer — shot media and wardrobe
  // stills alike.
  document.querySelectorAll('[data-full]').forEach(function(b){
    b.addEventListener('click', function(){ openViewer(b.getAttribute('data-full')); });
  });
  if (viewer) {
    viewer.addEventListener('click', function(e){ if (e.target === viewer) closeViewer(); });
    var vc = document.getElementById('viewerClose');
    if (vc) vc.addEventListener('click', closeViewer);
  }
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeViewer(); });

  function dayPanel(){ return document.querySelector('.day-panel[data-day="' + currentDay + '"]'); }

  // ── Progress, per day ──
  function refreshProgress(){
    var panel = dayPanel();
    if (!panel) return;
    var all = panel.querySelectorAll('.shot');
    var done = panel.querySelectorAll('.shot.done');
    var num = panel.querySelector('.progress-num');
    if (num) num.textContent = done.length + ' of ' + all.length + ' shots complete';
    var fill = panel.querySelector('.bar-fill');
    if (fill) fill.style.width = (all.length ? Math.round(done.length / all.length * 100) : 0) + '%';
    panel.querySelectorAll('.scene').forEach(function(sc){
      var shots = sc.querySelectorAll('.shot');
      var d = sc.querySelectorAll('.shot.done');
      sc.classList.toggle('done', shots.length > 0 && shots.length === d.length);
    });
  }

  // ── The sticky bar tracks the actual clock ──
  // The page is written in the production's local time, so read the clock in
  // that zone rather than in whatever zone the phone is set to.
  function minutesNow(){
    try {
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date());
      var h = 0, m = 0;
      parts.forEach(function(p){ if (p.type === 'hour') h = Number(p.value); if (p.type === 'minute') m = Number(p.value); });
      return h * 60 + m;
    } catch (e) {
      var d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    }
  }
  var nowTarget = null;
  function refreshNow(){
    var panel = dayPanel();
    var nowText = document.getElementById('nowText');
    var nowTime = document.getElementById('nowTime');
    var jump = document.getElementById('nowJump');
    var label = document.getElementById('nowLabel');
    if (!panel || !nowText) return;
    var items = [].slice.call(panel.querySelectorAll('[data-start-min]'));
    var mins = minutesNow();
    var chosen = null;
    for (var i = 0; i < items.length; i++) {
      var start = Number(items[i].getAttribute('data-start-min'));
      var end = Number(items[i].getAttribute('data-end-min'));
      if (!isNaN(start) && !isNaN(end) && mins >= start && mins < end) { chosen = { el: items[i], label: 'Now' }; break; }
    }
    if (!chosen) {
      for (var j = 0; j < items.length; j++) {
        var s2 = Number(items[j].getAttribute('data-start-min'));
        if (!isNaN(s2) && s2 >= mins) { chosen = { el: items[j], label: 'Next' }; break; }
      }
    }
    // Outside the day's hours, point at the first thing still not done.
    if (!chosen) {
      var pending = panel.querySelector('.shot:not(.done)');
      var host = pending ? pending.closest('[data-start-min]') : null;
      if (host) chosen = { el: host, label: 'Next' };
    }
    if (!chosen) {
      nowTarget = null;
      nowText.textContent = 'Day complete';
      if (nowTime) nowTime.textContent = '';
      if (jump) jump.classList.add('hidden');
      if (label) label.textContent = 'Day';
      return;
    }
    nowTarget = chosen.el;
    nowText.textContent = chosen.el.getAttribute('data-title') || '';
    if (nowTime) nowTime.textContent = chosen.el.getAttribute('data-time') || '';
    if (label) label.textContent = chosen.label;
    if (jump) jump.classList.remove('hidden');
  }
  var jumpBtn = document.getElementById('nowJump');
  if (jumpBtn) jumpBtn.addEventListener('click', function(){
    if (!nowTarget) return;
    var head = nowTarget.querySelector('.scene-head');
    var body = nowTarget.querySelector('.scene-body');
    if (head && body && body.classList.contains('hidden')) head.click();
    nowTarget.scrollIntoView({ block: 'start' });
  });
  setInterval(refreshNow, 60000);

  // ── Show only what is left, for late in a day ──
  document.querySelectorAll('.filter-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var on = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!on));
      var panel = btn.closest('.day-panel');
      if (!panel) return;
      panel.querySelectorAll('.shot').forEach(function(s){
        s.classList.toggle('hidden-filter', !on && s.classList.contains('done'));
      });
      panel.querySelectorAll('.scene').forEach(function(sc){
        var shots = sc.querySelectorAll('.shot').length;
        var visible = sc.querySelectorAll('.shot:not(.hidden-filter)').length;
        sc.classList.toggle('hidden', !on && shots > 0 && visible === 0);
      });
    });
  });

  ${hasPasscode ? crewJs() : '// No passcode set on this shot list: completion is not offered at all.'}

  refreshProgress();
  refreshNow();
})();
`;
}

// Crew completion behaviour is emitted ONLY when the shot list has a passcode.
// With no passcode there are no completion controls and no code to drive them.
function crewJs() {
  return `
  var pendingShot = null;

  function crew(){
    try { var raw = localStorage.getItem(CREW_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function setCrew(v){ try { localStorage.setItem(CREW_KEY, JSON.stringify(v)); } catch (e) {} }
  function clearCrew(){ try { localStorage.removeItem(CREW_KEY); } catch (e) {} }

  function setShotState(el, done, by){
    var btn = el.querySelector('.complete-btn');
    var note = el.querySelector('.done-note');
    if (done) {
      el.classList.add('done');
      if (btn) { btn.querySelector('.label').textContent = 'Undo complete'; btn.classList.remove('btn-solid'); }
      if (note) { note.querySelector('.label').textContent = by ? ('Completed by ' + by) : 'Completed'; note.classList.remove('hidden'); }
    } else {
      el.classList.remove('done');
      if (btn) { btn.querySelector('.label').textContent = 'Mark complete'; btn.classList.add('btn-solid'); }
      if (note) { note.classList.add('hidden'); }
    }
    refreshProgress();
    refreshNow();
  }

  function openSheet(){
    var sheet = document.getElementById('sheet');
    if (!sheet) return;
    sheet.classList.remove('hidden');
    var err = document.getElementById('sheetErr'); if (err) err.textContent = '';
    var nameInput = document.getElementById('crewName');
    var existing = crew();
    if (nameInput && existing && existing.name) nameInput.value = existing.name;
    var pass = document.getElementById('crewPass'); if (pass) { pass.value = ''; pass.focus(); }
  }
  function closeSheet(){
    var sheet = document.getElementById('sheet');
    if (sheet) sheet.classList.add('hidden');
    pendingShot = null;
  }

  function post(url, body){
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(data){
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function toggleShot(el){
    var saved = crew();
    if (!saved || !saved.token) { pendingShot = el; openSheet(); return; }
    var shotId = el.getAttribute('data-shot');
    var wantDone = !el.classList.contains('done');
    var btn = el.querySelector('.complete-btn');
    if (btn) btn.disabled = true;
    post('/api/public/shotlist/' + encodeURIComponent(SLUG) + '/shots/' + encodeURIComponent(shotId) + '/complete',
      { token: saved.token, completed: wantDone })
      .then(function(r){
        if (r.ok) { setShotState(el, !!r.data.completed, r.data.completed_by || saved.name); return; }
        if (r.status === 401) { clearCrew(); pendingShot = el; openSheet(); return; }
        alert((r.data && r.data.error) || 'Could not update this shot.');
      })
      .catch(function(){ alert('Network problem. Try again.'); })
      .finally(function(){ if (btn) btn.disabled = false; });
  }

  document.querySelectorAll('.complete-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ toggleShot(btn.closest('.shot')); });
  });

  var form = document.getElementById('sheetForm');
  if (form) form.addEventListener('submit', function(e){
    e.preventDefault();
    var name = (document.getElementById('crewName').value || '').trim();
    var passcode = document.getElementById('crewPass').value || '';
    var err = document.getElementById('sheetErr');
    if (!name) { err.textContent = 'Your name is required.'; return; }
    var submit = document.getElementById('sheetSubmit');
    submit.disabled = true;
    post('/api/public/shotlist/' + encodeURIComponent(SLUG) + '/unlock', { name: name, passcode: passcode })
      .then(function(r){
        if (r.ok && r.data && r.data.token) {
          setCrew({ token: r.data.token, name: r.data.name || name });
          var target = pendingShot;
          closeSheet();
          if (target) toggleShot(target);
          return;
        }
        if (r.status === 429) { err.textContent = 'Too many attempts. Wait a minute and try again.'; return; }
        err.textContent = 'That passcode is not right.';
      })
      .catch(function(){ err.textContent = 'Network problem. Try again.'; })
      .finally(function(){ submit.disabled = false; });
  });

  var cancel = document.getElementById('sheetCancel');
  if (cancel) cancel.addEventListener('click', closeSheet);
`;
}

// ── Document assembly ────────────────────────────────────────────────────────

// Minutes since midnight, so the sticky bar can compare against the clock.
function minuteOf(label) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(label || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : '';
}

// shotlist: row from shotlists
// bundle: what lib/shotlistStore.loadBundle returns — days, timelines, scenes,
//         shots, characters, locations and media
function renderShotlist(shotlist, bundle, opts = {}) {
  const hasPasscode = !!shotlist.passcode_hash;
  const { timelines, scenesById, shotsByScene, locationsById, charactersByShot, media } = bundle;

  const detail = (label, value, iconName) => (value
    ? `<div class="row"><div class="row-k">${iconName ? icon(iconName) : ''}${esc(label)}</div><div class="row-v">${esc(value)}</div></div>`
    : '');

  const dayPanels = timelines.map((timeline, dayIndex) => {
    const t = timeline.totals;
    const dayId = timeline.day.id == null ? `d${dayIndex}` : String(timeline.day.id);

    const blocks = timeline.items.map(item => {
      // ── Company move ──
      if (item.kind === 'move') {
        const dir = directionsUrl(item.to_lat, item.to_lng);
        return `
        <section class="block move" data-start-min="${minuteOf(item.start_label)}" data-end-min="${minuteOf(item.end_label)}"
          data-title="Company move to ${esc(item.to_name)}" data-time="${esc(item.start_label)}">
          <div class="block-head">${icon('move')} Company move <span class="block-time">${esc(item.start_label)}</span></div>
          <div class="block-sub">${esc(item.from_name)} → ${esc(item.to_name)} · ${esc(fmtDuration(item.duration_minutes))} in total</div>
          <div class="block-parts">
            <span class="part">Wrap ${Number(item.wrap_minutes)} min</span>
            <span class="part">${icon('move')} Travel ${Number(item.travel_minutes)} min${item.travel_km ? ` · ${Number(item.travel_km)} km` : ''}</span>
            <span class="part">Setup ${Number(item.setup_minutes)} min</span>
          </div>
          ${dir ? `<a class="btn" href="${esc(dir)}" target="_blank" rel="noopener noreferrer">${icon('directions')} Directions</a>` : ''}
        </section>`;
      }

      // ── Meal or break ──
      if (item.kind === 'break') {
        return `
        <section class="block meal" data-start-min="${minuteOf(item.start_label)}" data-end-min="${minuteOf(item.end_label)}"
          data-title="${esc(item.label)}" data-time="${esc(item.start_label)}">
          <div class="block-head">${icon(item.break_kind)} ${esc(item.label)}
            <span class="block-time">${esc(item.start_label)}</span></div>
          <div class="block-sub">${esc(fmtDuration(item.duration_minutes))}</div>
          ${item.fixed ? `<div class="block-parts"><span class="part">${icon('locked')} Fixed time</span></div>` : ''}
          ${item.notes ? `<div class="block-sub">${esc(item.notes)}</div>` : ''}
        </section>`;
      }

      // ── Scene ──
      const scene = scenesById.get(item.scene_id) || {};
      const shots = shotsByScene.get(item.scene_id) || [];
      const loc = scene.location_id != null ? locationsById.get(scene.location_id) : null;
      const dir = loc ? directionsUrl(loc.lat, loc.lng) : null;
      const winIcon = WINDOW_ICON[scene.light_window] || 'daylight';
      const spaceIcon = scene.space === 'interior' ? 'interior' : 'exterior';
      const bodyId = `scene-body-${Number(item.scene_id)}`;

      const cast = [];
      shots.forEach(sh => {
        (charactersByShot.get(sh.id) || []).forEach(c => { if (!cast.some(x => x.id === c.id)) cast.push(c); });
      });
      // Once somebody is cast, their name is what the crew needs. Until then
      // the age the role is being cast for is the useful thing to show, so an
      // uncast part reads "The Child (casting 8–12)".
      const castLabel = c => {
        if (c.performer) return `${c.name} (${c.performer})`;
        const age = fmtAgeRange(c.age_min, c.age_max);
        return age ? `${c.name} (casting ${age})` : c.name;
      };

      const shotCards = shots.map((shot, shotIdx) => {
        const shotMedia = media.get(shot.id) || [];
        const isDone = shot.status === 'completed';
        const characters = (charactersByShot.get(shot.id) || []).map(castLabel).join(', ');

        const photos = shotMedia.map(m => {
          const full = mediaSrc(m.filename);
          const thumb = mediaSrc(m.thumb_filename || m.filename);
          if (!full) return '';
          return `<figure><button type="button" data-full="${full}"><img src="${thumb}" alt="" loading="lazy"></button>` +
            `<figcaption>${m.kind === 'scout' ? 'Scout' : 'Reference'}</figcaption></figure>`;
        }).filter(Boolean).join('');

        const openLabel = `Show ${shotMedia.length} photo${shotMedia.length === 1 ? '' : 's'}`;
        const mediaBlock = photos ? `
          <div class="media-wrap">
            <button type="button" class="media-toggle" data-target="media-${Number(shot.id)}" data-open-label="${esc(openLabel)}">
              ${icon('shot')}<span class="label">${esc(openLabel)}</span>
            </button>
            <div class="media hidden" id="media-${Number(shot.id)}">${photos}</div>
          </div>` : '';

        const completeBlock = hasPasscode ? `
          <div class="done-note${isDone ? '' : ' hidden'}">${icon('done')}<span class="label">${isDone && shot.completed_by ? `Completed by ${esc(shot.completed_by)}` : 'Completed'}</span></div>
          <div class="complete-wrap">
            <button type="button" class="btn btn-wide complete-btn${isDone ? '' : ' btn-solid'}">
              ${icon('done')}<span class="label">${isDone ? 'Undo complete' : 'Mark complete'}</span>
            </button>
          </div>` : '';

        const lens = lensLabel(shot);
        const hasRows = shot.description || characters || shot.costume || shot.props
          || shot.set_design || scene.set_design || lens || shot.camera_notes;

        return `
        <article class="shot${isDone ? ' done' : ''}" data-shot="${Number(shot.id)}">
          <div class="shot-head">
            <div class="num">${esc(shot.shot_number || String(shotIdx + 1))}</div>
            <div class="shot-headline">
              <div class="shot-title">${esc(shot.title || 'Untitled shot')}</div>
              <div class="shot-time">
                ${shot.locked_start_time ? `<span class="tag lock">${icon('locked')} ${esc(shot.locked_start_time)}</span>` : ''}
                ${shot.shot_type ? esc(shot.shot_type) : ''}
                ${shot.duration_minutes ? `<span>${icon('clock')} ${Number(shot.duration_minutes)} min to capture</span>` : ''}
                ${shot.clip_length_seconds ? `<span>${icon('clip')} ${esc(fmtClip(shot.clip_length_seconds))} in the edit</span>` : ''}
              </div>
            </div>
          </div>
          ${hasRows ? `<div class="rows">
            ${detail('Description', shot.description)}
            ${detail('Lens', lens, 'lens')}
            ${detail('Characters', characters, 'character')}
            ${detail('Costume', shot.costume, 'costume')}
            ${detail('Props', shot.props, 'props')}
            ${detail('Set design', scene.set_design, 'set')}
            ${detail('Set note', shot.set_design, 'set')}
            ${detail('Camera', shot.camera_notes, 'camera')}
          </div>` : ''}
          ${mediaBlock}
          ${completeBlock}
        </article>`;
      }).join('\n');

      return `
      <section class="scene" data-scene="${Number(item.scene_id)}"
        data-start-min="${minuteOf(item.start_label)}" data-end-min="${minuteOf(item.end_label)}"
        data-title="${esc(scene.title || 'Scene')}" data-time="${esc(item.start_label || '')}">
        <button type="button" class="scene-head" aria-expanded="false" aria-controls="${bodyId}">
          <span class="scene-num">${esc(item.scene_number || '')}</span>
          <span class="scene-headline">
            <span class="scene-label">${icon('shot')} Scene</span>
            <span class="scene-title">${esc(scene.title || 'Untitled scene')}</span>
            <span class="scene-time">
              ${esc(item.start_label || '')}
              ${item.locked ? `<span class="tag lock">${icon('locked')} Locked</span>` : ''}
              <span>· ${esc(fmtDuration(item.duration_minutes))} · ${shots.length} shot${shots.length === 1 ? '' : 's'}${item.clip_seconds ? ` · ${esc(fmtClip(item.clip_seconds))} of clips` : ''}</span>
            </span>
          </span>
          <span class="chev">›</span>
        </button>
        <div class="tags">
          <span class="tag">${icon(spaceIcon)} ${scene.space === 'interior' ? 'Interior' : 'Exterior'}</span>
          ${item.light_window_label
    ? `<span class="tag${item.light_window_hard ? ' hard' : ''}">${icon(winIcon)} ${esc(item.light_window_label)}${item.light_window_range ? ` · ${esc(item.light_window_range)}` : ''}</span>`
    : ''}
          ${loc ? `<span class="tag">${icon('location')} ${esc(loc.name)}</span>` : ''}
          ${cast.length ? `<span class="tag">${icon('character')} ${cast.length} character${cast.length === 1 ? '' : 's'}</span>` : ''}
        </div>
        <div class="scene-body hidden" id="${bodyId}">
          ${scene.description || scene.set_design || cast.length ? `<div class="rows">
            ${detail('Scene', scene.description)}
            ${detail('Set design', scene.set_design, 'set')}
            ${detail('Characters', cast.map(castLabel).join(', '), 'character')}
          </div>` : ''}
          ${wardrobeStrip(cast)}
          ${loc ? `
          <div class="loc">
            <div class="loc-text">
              <div class="loc-name">${icon('location')} ${esc(loc.name)}</div>
              ${loc.address ? `<div class="loc-addr">${esc(loc.address)}</div>` : ''}
            </div>
            ${dir ? `<a class="btn" href="${esc(dir)}" target="_blank" rel="noopener noreferrer">${icon('directions')} Directions</a>` : ''}
          </div>` : ''}
          ${shots.length ? `<div class="scene-shots">${shotCards}</div>` : '<p class="scene-empty">No shots in this scene yet.</p>'}
        </div>
      </section>`;
    }).join('\n');

    const sceneItems = timeline.items.filter(i => i.kind === 'scene');
    const totalShots = sceneItems.reduce((n, i) => n + (i.shot_count || 0), 0);
    const doneShots = sceneItems.reduce(
      (n, i) => n + (shotsByScene.get(i.scene_id) || []).filter(s => s.status === 'completed').length, 0);

    return `
    <section class="day-panel${dayIndex === 0 ? '' : ' hidden'}" data-day="${esc(dayId)}">
      <div class="wrap">
        <div class="dayhead">
          <div class="callrow">
            <div class="call crew">
              <div class="call-k">${icon('crew')} Crew call</div>
              <div class="call-v">${esc(t.crew_call || '—')}</div>
            </div>
            <div class="call">
              <div class="call-k">${icon('shot')} First shot call</div>
              <div class="call-v">${esc(t.first_shot_call || '—')}</div>
            </div>
            <div class="call">
              <div class="call-k">${icon('clock')} Est. wrap</div>
              <div class="call-v">${esc(t.wrap || '—')}</div>
            </div>
            <div class="call">
              <div class="call-k">${icon('clock')} On set</div>
              <div class="call-v">${esc(fmtDuration(t.on_set_minutes))}</div>
            </div>
          </div>
          <div class="dayfacts">
            <span class="chip">${icon('shot')} Shooting ${esc(fmtDuration(t.shooting_minutes))}</span>
            <span class="chip">${icon('move')} Travel ${esc(fmtDuration(t.travel_minutes))}</span>
            <span class="chip">${icon('break')} Breaks ${esc(fmtDuration(t.break_minutes))}</span>
            <span class="chip">${icon('clip')} ${esc(fmtClip(t.clip_seconds))} of clips</span>
          </div>
          <div class="progress">
            <div class="progress-num">${doneShots} of ${totalShots} shots complete</div>
            <div class="bar"><div class="bar-fill" style="width:${totalShots ? Math.round((doneShots / totalShots) * 100) : 0}%"></div></div>
          </div>
          ${totalShots ? `<div class="filter-row">
            <button type="button" class="filter-btn" aria-pressed="false">${icon('pending')} Show only what is left</button>
          </div>` : ''}
        </div>
      </div>
      <main class="wrap list">
        ${blocks || '<p class="scene-empty">Nothing scheduled on this day yet.</p>'}
      </main>
    </section>`;
  }).join('\n');

  const tabs = timelines.length > 1 ? `
  <div class="wrap">
    <div class="days" role="tablist">
      ${timelines.map((timeline, i) => {
    const dayId = timeline.day.id == null ? `d${i}` : String(timeline.day.id);
    return `<button type="button" class="day-tab" role="tab" data-day="${esc(dayId)}" aria-selected="${i === 0}">
          <b>Day ${esc(String(timeline.day.day_number || i + 1))}</b>
          <span>${esc(fmtDateShort(timeline.day.shoot_date))} · ${esc(fmtDuration(timeline.totals.on_set_minutes))} on set</span>
        </button>`;
  }).join('')}
    </div>
  </div>` : '';

  const sheet = hasPasscode ? `
  <div class="sheet-bg hidden" id="sheet">
    <div class="sheet">
      <h2>Unlock this shot list</h2>
      <p>Enter the production passcode and your name to mark shots complete.</p>
      <form id="sheetForm">
        <div class="field">
          <label for="crewName">Your name</label>
          <input id="crewName" name="name" autocomplete="name" required>
        </div>
        <div class="field">
          <label for="crewPass">Passcode</label>
          <input id="crewPass" name="passcode" type="password" autocomplete="off" inputmode="text">
        </div>
        <div class="sheet-err" id="sheetErr"></div>
        <div class="sheet-actions">
          <button type="button" class="btn" id="sheetCancel">Cancel</button>
          <button type="submit" class="btn btn-solid" id="sheetSubmit">Unlock</button>
        </div>
      </form>
    </div>
  </div>` : '';

  const agencyName = opts.agency && opts.agency.name ? opts.agency.name : '';
  const first = timelines[0];
  const headDate = first && first.day && first.day.shoot_date ? fmtDate(first.day.shoot_date) : '';

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${esc(shotlist.title)}</title>
<style>${CSS}</style>
</head>
<body>
${iconSprite()}
<header class="head">
  <div class="wrap">
    <div class="head-top">
      <h1 class="title">${esc(shotlist.title)}</h1>
      <button class="theme-btn" id="themeBtn" type="button" aria-label="Switch theme">☾</button>
    </div>
    <div class="meta">
      ${headDate ? `<span class="chip">${icon('clock')} ${esc(headDate)}${timelines.length > 1 ? ` + ${timelines.length - 1} more day${timelines.length > 2 ? 's' : ''}` : ''}</span>` : ''}
      <span class="chip">${icon('shot')} ${Number(bundle.totals.scene_count)} scenes · ${Number(bundle.totals.shot_count)} shots</span>
      <span class="chip">${icon('clip')} ${esc(fmtClip(bundle.totals.clip_seconds))} of clips</span>
      ${opts.orderLabel ? `<span class="chip">${esc(opts.orderLabel)}</span>` : ''}
    </div>
  </div>
  ${tabs}
</header>

<div class="now">
  <div class="wrap now-inner">
    <span class="now-label" id="nowLabel">Now</span>
    <span class="now-text" id="nowText"></span>
    <span class="now-time" id="nowTime"></span>
    <button type="button" class="now-jump hidden" id="nowJump">Go</button>
  </div>
</div>

${dayPanels}

${shotlist.notes ? `<section class="wrap"><div class="scene"><div class="rows"><div class="row"><div class="row-k">Notes</div><div class="row-v">${esc(shotlist.notes)}</div></div></div></div></section>` : ''}

<div class="viewer hidden" id="viewer">
  <button type="button" class="viewer-close" id="viewerClose" aria-label="Close">✕</button>
  <img id="viewerImg" alt="">
</div>

${sheet}

<footer class="wrap foot">${agencyName ? esc(agencyName) : ''}</footer>
<script>${clientJs(shotlist.slug, hasPasscode, ZONE)}</script>
</body>
</html>`;
}

module.exports = { renderShotlist, esc, directionsUrl, mediaSrc };
