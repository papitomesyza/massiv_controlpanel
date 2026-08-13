// Server-side renderer for the public casting page (GET /c/:slug).
//
// This is the CASTING AGENCY view and nothing else. It is deliberately not the
// crew page: no schedule, no locations, no call times, no shot breakdown, no
// completion controls — an agency has no business knowing where the unit is on
// Tuesday. What it shows is the cast grid: the part, the age it is being cast
// for, the costume brief and the wardrobe stills, at a size somebody can
// actually judge a look from.
//
// Read only by construction: the page contains no form and posts nowhere.
//
// Fully self-contained: all CSS, JS and icons inline, no external request
// except the shot list's own media under /s-media. Every user string goes
// through esc().

const { fmtAgeRange } = require('./shotlistSchedule');

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

const ICON_PATHS = {
  character: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/>',
  costume: '<path d="M8 3 5 5.5V10l2 1v10h10V11l2-1V5.5L16 3l-4 2.5z"/>',
  age: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  shot: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M9 5v5M15 5v5"/>',
  note: '<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  day: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  location: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  directions: '<path d="M12 2 22 12 12 22 2 12z"/><path d="M9.5 14v-2.5A2.5 2.5 0 0 1 12 9h3.5"/><path d="m13.5 7 2.5 2-2.5 2"/>',
};

// Nothing on this page invents a time or a place. Where the production has not
// decided yet, it says so in as many words rather than showing a blank or a
// plausible-looking default.
const UNDECIDED = 'Not decided yet';
function orUndecided(v) {
  return v == null || v === '' ? `<span class="tbd">${UNDECIDED}</span>` : esc(v);
}

function fmtDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return null;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`;
}

// Plain Google Maps deep link from the stored coordinates — no key, no billing.
function directionsUrl(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lng)}`;
}

function iconSprite() {
  const symbols = Object.entries(ICON_PATHS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join('');
  return `<svg class="sprite" aria-hidden="true" focusable="false"><defs>${symbols}</defs></svg>`;
}

function icon(name) {
  if (!ICON_PATHS[name]) return '';
  return `<svg class="ic" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
:root{
  --bg:#f4f4f2;--panel:#ffffff;--ink:#0b0b0c;--ink-2:#3d3d42;--ink-3:#66666e;
  --line:#d5d5d0;--line-2:#e6e6e2;--accent:#0b0b0c;--chip:#ececE7;
}
html[data-theme="dark"]{
  --bg:#0d0d0f;--panel:#17171a;--ink:#f4f4f2;--ink-2:#c7c7cc;--ink-3:#95959d;
  --line:#33333a;--line-2:#26262b;--accent:#f4f4f2;--chip:#26262b;
}
body{background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif;
  font-size:16px;line-height:1.45;-webkit-font-smoothing:antialiased;padding-bottom:56px}
img{display:block;max-width:100%}
button{font:inherit;color:inherit;cursor:pointer}
.wrap{max-width:1080px;margin:0 auto;padding:0 16px}
.sprite{position:absolute;width:0;height:0;overflow:hidden}
.ic{width:1.05em;height:1.05em;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.7;
  stroke-linecap:round;stroke-linejoin:round;vertical-align:-0.15em}

.head{background:var(--panel);border-bottom:1px solid var(--line);padding:20px 0 16px}
.head-top{display:flex;align-items:flex-start;gap:12px}
.kicker{font-size:12px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-3)}
.title{font-size:28px;font-weight:800;letter-spacing:-0.02em;line-height:1.15;flex:1;min-width:0;
  overflow-wrap:anywhere;margin-top:4px}
.theme-btn{flex-shrink:0;background:var(--chip);border:1px solid var(--line);border-radius:12px;
  min-width:52px;min-height:44px;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.chip{display:inline-flex;align-items:center;gap:6px;background:var(--chip);border-radius:10px;
  padding:7px 11px;font-size:14px;font-weight:600;color:var(--ink-2)}
.brief{margin-top:14px;font-size:15px;color:var(--ink-2);max-width:62ch;white-space:pre-wrap;overflow-wrap:anywhere}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;margin:20px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;
  display:flex;flex-direction:column}
.card-photo{width:100%;aspect-ratio:3 / 4;background:var(--line-2);position:relative}
.card-photo img{width:100%;height:100%;object-fit:cover}
.card-photo button{display:block;width:100%;height:100%;padding:0;border:0;background:none}
.card-photo .empty{width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  color:var(--ink-3);font-size:13px;font-weight:600}
.card-body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:8px}
.card-name{font-size:19px;font-weight:800;letter-spacing:-0.01em;overflow-wrap:anywhere}
.card-kind{font-size:12px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-3)}
.card-rows{display:flex;flex-direction:column;gap:6px}
.row{display:flex;gap:8px;font-size:14px}
.row-k{display:flex;align-items:center;gap:5px;flex-shrink:0;min-width:74px;font-size:12px;font-weight:800;
  letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-3);padding-top:2px}
/* break-word, not anywhere: a long unbroken string still wraps, but ordinary
   words are not split down the middle in a narrow column */
.row-v{flex:1;min-width:0;color:var(--ink-2);overflow-wrap:break-word;white-space:pre-wrap}
.age{background:var(--accent);color:var(--bg);border-radius:9px;padding:5px 9px;font-size:14px;
  font-weight:800;display:inline-flex;align-items:center;gap:5px;align-self:flex-start}

.looks{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px}
.looks figure{margin:0}
.looks button{display:block;width:100%;padding:0;border:0;background:none}
.looks img{width:100%;aspect-ratio:3 / 4;object-fit:cover;border-radius:9px;background:var(--line-2)}
.looks figcaption{font-size:11px;font-weight:600;color:var(--ink-3);margin-top:3px;overflow-wrap:anywhere}
.looks-k{font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-3);
  display:flex;align-items:center;gap:5px}

/* anything the production has not settled yet */
.tbd{color:var(--ink-3);font-style:italic}

/* the shoot at a glance */
.overview{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;margin:20px 0}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.days{border-collapse:collapse;width:100%;font-size:14px;min-width:520px}
.days th{text-align:left;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;
  color:var(--ink-3);padding:0 10px 6px 0;white-space:nowrap}
.days td{padding:7px 10px 7px 0;border-top:1px solid var(--line-2);vertical-align:top}
.places{display:flex;flex-wrap:wrap;gap:8px}
.place{display:inline-flex;align-items:center;gap:6px;background:var(--chip);border-radius:10px;
  padding:7px 11px;font-size:14px;font-weight:600;color:var(--ink-2);text-decoration:none}

/* one part's own booking */
.sched{border-top:1px solid var(--line-2);padding-top:10px;margin-top:2px}
.sched-k{font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-3);
  display:flex;align-items:center;gap:5px;margin-bottom:8px}
.sched-day{margin-bottom:12px}
.sched-day:last-child{margin-bottom:0}
.sched-date{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:700;margin-bottom:7px}
.calls{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.call{background:var(--chip);border-radius:10px;padding:7px 9px}
.call.you{background:var(--accent);color:var(--bg)}
.call-k{font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;opacity:.75}
.call-v{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:1px}
.call-note{font-size:11px;color:var(--ink-3);margin:5px 0 7px}
.scenes{list-style:none;margin:8px 0 0;padding:0}
.scenes li{display:flex;gap:8px;font-size:13px;padding:5px 0;border-top:1px solid var(--line-2)}
.sc-time{flex-shrink:0;font-weight:700;font-variant-numeric:tabular-nums;min-width:42px}
.sc-name{flex:1;min-width:0;overflow-wrap:break-word}
.sc-loc{flex-shrink:0;color:var(--ink-3);max-width:40%;overflow-wrap:break-word;text-align:right}

.empty-state{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:40px 20px;
  text-align:center;color:var(--ink-3);margin:20px 0}
.foot{padding:22px 0;color:var(--ink-3);font-size:13px;text-align:center}

.viewer{position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:60;display:flex;align-items:center;
  justify-content:center;padding:16px}
.viewer img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px}
.viewer-close{position:absolute;top:14px;right:14px;min-width:48px;min-height:48px;border-radius:50%;
  border:0;background:rgba(255,255,255,0.14);color:#fff;font-size:20px}

@media (max-width:520px){
  .grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
  .card-name{font-size:17px}
  /* two narrow columns leave no room for a label beside its value */
  .row{flex-direction:column;gap:1px}
  .row-k{min-width:0;padding-top:0}
  .calls{grid-template-columns:1fr 1fr}
  .call.you{grid-column:1 / -1}
  .scenes li{flex-wrap:wrap}
  .sc-loc{max-width:100%;text-align:left;width:100%;padding-left:50px}
}

/* declared last so nothing can out-specify it */
.hidden{display:none !important}
`;

const JS = `
(function(){
  // Theme choice is remembered on the device, same as the crew page.
  var KEY='massiv-casting-theme';
  var root=document.documentElement;
  try{ var saved=localStorage.getItem(KEY); if(saved) root.setAttribute('data-theme',saved); }catch(e){}
  var tb=document.getElementById('themeBtn');
  if(tb){ tb.addEventListener('click',function(){
    var next=root.getAttribute('data-theme')==='dark'?'light':'dark';
    root.setAttribute('data-theme',next);
    try{ localStorage.setItem(KEY,next); }catch(e){}
    tb.textContent=next==='dark'?'\\u2600':'\\u263E';
  }); }

  var viewer=document.getElementById('viewer');
  var viewerImg=document.getElementById('viewerImg');
  function openViewer(src){ if(!viewer||!viewerImg||!src) return; viewerImg.src=src; viewer.classList.remove('hidden'); }
  function closeViewer(){ if(viewer){ viewer.classList.add('hidden'); viewerImg.removeAttribute('src'); } }
  document.querySelectorAll('[data-full]').forEach(function(b){
    b.addEventListener('click',function(){ openViewer(b.getAttribute('data-full')); });
  });
  if(viewer){
    viewer.addEventListener('click',function(e){ if(e.target===viewer) closeViewer(); });
    var vc=document.getElementById('viewerClose');
    if(vc) vc.addEventListener('click',closeViewer);
  }
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeViewer(); });
})();
`;

// When and where one part is needed. A part that is in no shot yet has nothing
// to say, and says exactly that rather than being left blank.
function scheduleBlock(days) {
  if (!days || !days.length) {
    return `<div class="sched">
      <div class="sched-k">${icon('clock')}Schedule</div>
      <p class="tbd">${UNDECIDED} — this part is not in any shot yet.</p>
    </div>`;
  }

  const blocks = days.map(d => {
    const date = fmtDate(d.shoot_date);
    const places = d.locations.length
      ? d.locations.map(l => {
        const dir = directionsUrl(l.lat, l.lng);
        const label = l.address ? `${l.name} — ${l.address}` : l.name;
        return dir
          ? `<a class="place" href="${esc(dir)}" target="_blank" rel="noopener noreferrer">${icon('location')}${esc(label)}${icon('directions')}</a>`
          : `<span class="place">${icon('location')}${esc(label)}</span>`;
      }).join('')
      : `<span class="place tbd">${icon('location')}${UNDECIDED}</span>`;

    const scenes = d.scenes.map(sc => `<li>
      <span class="sc-time">${esc(sc.start_label)}</span>
      <span class="sc-name">${sc.scene_number ? `${esc(sc.scene_number)}. ` : ''}${orUndecided(sc.title)}</span>
      <span class="sc-loc">${orUndecided(sc.location_name)}</span>
    </li>`).join('');

    return `<div class="sched-day">
      <div class="sched-date">${icon('day')} Day ${d.day_number}${date ? ` · ${esc(date)}` : ` · <span class="tbd">${UNDECIDED}</span>`}</div>
      <div class="calls">
        <div class="call you"><div class="call-k">Your call</div><div class="call-v">${esc(d.call)}</div></div>
        <div class="call"><div class="call-k">First shot</div><div class="call-v">${esc(d.first_shot)}</div></div>
        <div class="call"><div class="call-k">Done by</div><div class="call-v">${esc(d.finish)}</div></div>
      </div>
      <p class="call-note">Call is ${d.call_offset_minutes} minutes before your first shot.</p>
      <div class="places">${places}</div>
      ${scenes ? `<ul class="scenes">${scenes}</ul>` : ''}
    </div>`;
  }).join('');

  return `<div class="sched"><div class="sched-k">${icon('clock')}Schedule</div>${blocks}</div>`;
}

// The shoot at a glance: the days, the unit's call and wrap, and where each day
// happens. An undated day or an unplaced one is named as undecided rather than
// left out, so an agency can see what is still open.
function overviewBlock(days, locations) {
  if (!days.length && !locations.length) return '';

  const dayRows = days.map(d => {
    const date = fmtDate(d.shoot_date);
    const places = d.locations.length
      ? d.locations.map(n => esc(n)).join(', ')
      : `<span class="tbd">${UNDECIDED}</span>`;
    return `<tr>
      <td><b>Day ${d.day_number}</b></td>
      <td>${date ? esc(date) : `<span class="tbd">${UNDECIDED}</span>`}</td>
      <td>${d.crew_call ? esc(d.crew_call) : `<span class="tbd">${UNDECIDED}</span>`}</td>
      <td>${d.wrap ? esc(d.wrap) : `<span class="tbd">${UNDECIDED}</span>`}</td>
      <td>${places}</td>
    </tr>`;
  }).join('');

  const placeList = locations.map(l => {
    const dir = directionsUrl(l.lat, l.lng);
    const label = l.address ? `${l.name} — ${l.address}` : l.name;
    return dir
      ? `<a class="place" href="${esc(dir)}" target="_blank" rel="noopener noreferrer">${icon('location')}${esc(label)}${icon('directions')}</a>`
      : `<span class="place">${icon('location')}${esc(label)}</span>`;
  }).join('');

  return `<section class="overview">
    <h2 class="kicker">Schedule</h2>
    ${dayRows ? `<div class="table-wrap"><table class="days">
      <thead><tr><th>Day</th><th>Date</th><th>Unit call</th><th>Wrap</th><th>Where</th></tr></thead>
      <tbody>${dayRows}</tbody>
    </table></div>` : `<p class="tbd">${UNDECIDED} — no shoot days have been set.</p>`}
    <h2 class="kicker" style="margin-top:18px">Locations</h2>
    ${placeList ? `<div class="places">${placeList}</div>` : `<p class="tbd">${UNDECIDED} — no locations have been set.</p>`}
  </section>`;
}

// characters carry .wardrobe; shotCounts maps character id → how many shots
// the part appears in; schedule maps character id → the days that part is
// needed, with its own call time, locations and scenes.
function renderCasting(shotlist, characters, opts = {}) {
  const agencyName = opts.agency && opts.agency.name ? opts.agency.name : '';
  const shotCounts = opts.shotCounts || new Map();
  const schedule = opts.schedule || new Map();

  const principals = characters.filter(c => c.kind !== 'extra');
  const extras = characters.filter(c => c.kind === 'extra');

  const card = c => {
    const age = fmtAgeRange(c.age_min, c.age_max);
    const shots = shotCounts.get(c.id) || 0;

    // Only the casting photo leads the card. A wardrobe still must never stand
    // in for it: on this page the lead image reads as the person being put
    // forward for the part, and a costume reference is not that. No photo says
    // no photo — the wardrobe still appears below, where it is labelled.
    const photo = mediaSrc(c.photo_filename);
    const photoThumb = mediaSrc(c.photo_thumb_filename || c.photo_filename);

    const looks = (c.wardrobe || []).map(w => {
      const full = mediaSrc(w.filename);
      const thumb = mediaSrc(w.thumb_filename || w.filename);
      if (!full) return '';
      return `<figure><button type="button" data-full="${full}"><img src="${thumb}" alt="" loading="lazy"></button>` +
        `${w.label ? `<figcaption>${esc(w.label)}</figcaption>` : ''}</figure>`;
    }).filter(Boolean).join('');

    return `<article class="card">
      <div class="card-photo">${photo
    ? `<button type="button" data-full="${photo}"><img src="${photoThumb}" alt="" loading="lazy"></button>`
    : '<div class="empty">No photo</div>'}</div>
      <div class="card-body">
        <div>
          <div class="card-kind">${c.kind === 'extra' ? 'Extra' : 'Principal'}</div>
          <div class="card-name">${esc(c.name)}</div>
        </div>
        ${age ? `<div class="age">${icon('age')} Casting ${esc(age)}</div>` : ''}
        <div class="card-rows">
          ${c.performer ? `<div class="row"><div class="row-k">${icon('character')}Cast</div><div class="row-v">${esc(c.performer)}</div></div>` : ''}
          ${c.costume ? `<div class="row"><div class="row-k">${icon('costume')}Costume</div><div class="row-v">${esc(c.costume)}</div></div>` : ''}
          ${c.notes ? `<div class="row"><div class="row-k">${icon('note')}Notes</div><div class="row-v">${esc(c.notes)}</div></div>` : ''}
          ${shots ? `<div class="row"><div class="row-k">${icon('shot')}Shots</div><div class="row-v">${shots} shot${shots === 1 ? '' : 's'}</div></div>` : ''}
        </div>
        ${looks ? `<div class="looks-k">${icon('costume')}Wardrobe</div><div class="looks">${looks}</div>` : ''}
        ${scheduleBlock(schedule.get(c.id))}
      </div>
    </article>`;
  };

  const section = (label, list) => (list.length
    ? `<h2 class="kicker" style="margin-top:22px">${esc(label)}</h2><div class="grid">${list.map(card).join('')}</div>`
    : '');

  const total = characters.length;
  // Counted separately and named for what each one is — a casting photo and a
  // wardrobe still are not interchangeable, and a chip that merged them would
  // read as more parts having a face than actually do.
  const withPhotos = characters.filter(c => c.photo_filename).length;
  const withWardrobe = characters.filter(c => (c.wardrobe || []).length).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(shotlist.title || 'Casting')}${agencyName ? ` · ${esc(agencyName)}` : ''}</title>
<style>${CSS}</style>
</head>
<body>
${iconSprite()}

<header class="head">
  <div class="wrap">
    <div class="head-top">
      <div style="flex:1;min-width:0">
        <div class="kicker">Casting${agencyName ? ` · ${esc(agencyName)}` : ''}</div>
        <h1 class="title">${esc(shotlist.title || 'Casting')}</h1>
      </div>
      <button type="button" class="theme-btn" id="themeBtn" aria-label="Switch theme">&#9790;</button>
    </div>
    <div class="meta">
      <span class="chip">${icon('character')} ${total} part${total === 1 ? '' : 's'}</span>
      ${principals.length ? `<span class="chip">${principals.length} principal${principals.length === 1 ? '' : 's'}</span>` : ''}
      ${extras.length ? `<span class="chip">${extras.length} extra${extras.length === 1 ? '' : 's'}</span>` : ''}
      ${withPhotos ? `<span class="chip">${withPhotos} with a casting photo</span>` : ''}
      ${withWardrobe ? `<span class="chip">${withWardrobe} with wardrobe</span>` : ''}
    </div>
    ${shotlist.casting_brief ? `<p class="brief">${esc(shotlist.casting_brief)}</p>` : ''}
  </div>
</header>

<main class="wrap">
  ${overviewBlock(opts.days || [], opts.locations || [])}
  ${total === 0 ? '<div class="empty-state">No parts have been added yet.</div>' : ''}
  ${section('Principals', principals)}
  ${section('Extras', extras)}
</main>

<div class="viewer hidden" id="viewer">
  <button type="button" class="viewer-close" id="viewerClose" aria-label="Close">&#10005;</button>
  <img id="viewerImg" alt="">
</div>

<footer class="wrap foot">${agencyName ? esc(agencyName) : ''}</footer>

<script>${JS}</script>
</body>
</html>`;
}

module.exports = { renderCasting };
