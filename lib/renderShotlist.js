// Server-side renderer for the public shot list page (GET /s/:slug).
//
// This is NOT a pitch page and must never look like one. It is a production
// document: read one-handed, outdoors, in bright sun, by someone holding
// equipment. Light background with near-black text by default, a dark-mode
// toggle remembered on the device, large type, strong contrast, generous tap
// targets, no decorative animation, no parallax, native scroll.
//
// Fully self-contained: all CSS and JS inline, no external request except the
// shot list's own media under /s-media. Every user string goes through esc().

const { fmtTime } = require('./sunWindows');

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
  const month = MONTHS[Number(m[2]) - 1] || '';
  return `${Number(m[3])} ${month} ${m[1]}`;
}

// Plain Google Maps deep link, built from the stored coordinates. No key, no
// billing, opens navigation in whatever maps app the phone uses.
function directionsUrl(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lng)}`;
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
:root{
  --bg:#f4f4f2;--panel:#ffffff;--ink:#0b0b0c;--ink-2:#3d3d42;--ink-3:#66666e;
  --line:#d5d5d0;--line-2:#e6e6e2;--accent:#0b0b0c;--ok:#1c6b3a;--ok-bg:#e6f3ea;
  --warn:#8a4b00;--chip:#ececE7;--shadow:0 1px 0 rgba(0,0,0,0.04);
}
html[data-theme="dark"]{
  --bg:#0d0d0f;--panel:#17171a;--ink:#f4f4f2;--ink-2:#c7c7cc;--ink-3:#95959d;
  --line:#33333a;--line-2:#26262b;--accent:#f4f4f2;--ok:#5fd08a;--ok-bg:#12301f;
  --warn:#f0b06a;--chip:#26262b;--shadow:none;
}
body{background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif;
  font-size:17px;line-height:1.45;-webkit-font-smoothing:antialiased;padding-bottom:56px}
img{display:block;max-width:100%}
button{font:inherit;color:inherit;cursor:pointer}
a{color:inherit}
.wrap{max-width:820px;margin:0 auto;padding:0 14px}

/* header */
.head{background:var(--panel);border-bottom:1px solid var(--line);padding:18px 0 16px}
.head-top{display:flex;align-items:flex-start;gap:12px}
.title{font-size:26px;font-weight:800;letter-spacing:-0.02em;line-height:1.15;flex:1;min-width:0;overflow-wrap:anywhere}
.theme-btn{flex-shrink:0;background:var(--chip);border:1px solid var(--line);border-radius:12px;
  min-width:52px;min-height:44px;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chip{background:var(--chip);border-radius:10px;padding:7px 11px;font-size:14px;font-weight:600;color:var(--ink-2)}
.progress{margin-top:14px}
.progress-num{font-size:15px;font-weight:700;margin-bottom:6px}
.bar{height:10px;border-radius:6px;background:var(--line-2);overflow:hidden}
.bar-fill{height:100%;background:var(--accent);width:0%}

/* sticky current shot */
.now{position:sticky;top:0;z-index:20;background:var(--panel);border-bottom:1px solid var(--line);
  box-shadow:var(--shadow)}
.now-inner{display:flex;align-items:center;gap:10px;padding:11px 0;min-height:56px}
.now-label{font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);flex-shrink:0}
.now-text{font-size:16px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.now-time{font-size:16px;font-weight:800;flex-shrink:0;font-variant-numeric:tabular-nums}

/* shot cards */
.list{padding:14px 0 24px}
.shot{background:var(--panel);border:1px solid var(--line);border-radius:14px;margin-bottom:12px;overflow:hidden}
.shot.done{opacity:0.62}
.shot-head{display:flex;gap:12px;padding:14px 14px 10px}
.num{flex-shrink:0;min-width:44px;height:44px;border-radius:11px;background:var(--chip);
  display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;padding:0 6px}
.shot.done .num{background:var(--ok-bg);color:var(--ok)}
.shot-headline{flex:1;min-width:0}
.shot-title{font-size:20px;font-weight:750;letter-spacing:-0.01em;line-height:1.25;overflow-wrap:anywhere}
.shot-time{font-size:16px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums}
.shot-time span{font-weight:500;color:var(--ink-3)}
.tags{display:flex;flex-wrap:wrap;gap:7px;padding:0 14px 12px}
.tag{border-radius:9px;padding:6px 10px;font-size:14px;font-weight:650;background:var(--chip);color:var(--ink-2)}
.tag.hard{background:var(--accent);color:var(--bg)}
.rows{border-top:1px solid var(--line-2)}
.row{display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line-2);font-size:16px}
.row:last-child{border-bottom:none}
.row-k{flex-shrink:0;width:104px;font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-3);padding-top:2px}
.row-v{flex:1;min-width:0;overflow-wrap:anywhere}
.loc{padding:12px 14px;border-top:1px solid var(--line-2);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.loc-text{flex:1;min-width:140px}
.loc-name{font-size:16px;font-weight:700}
.loc-addr{font-size:14px;color:var(--ink-3);margin-top:2px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:48px;padding:0 16px;
  border-radius:12px;border:1px solid var(--line);background:var(--chip);font-size:15px;font-weight:700;
  text-decoration:none;flex-shrink:0}
.btn-solid{background:var(--accent);color:var(--bg);border-color:var(--accent)}
.btn-wide{width:100%;margin-top:0}
.media-wrap{padding:0 14px 14px}
.media-toggle{width:100%;min-height:48px;border-radius:12px;border:1px solid var(--line);background:var(--chip);font-size:15px;font-weight:700}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:10px}
.media img{width:100%;aspect-ratio:4 / 3;object-fit:cover;border-radius:10px;background:var(--line-2)}
.media figure{margin:0}
.media figcaption{font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-3);margin-top:4px}
.complete-wrap{padding:0 14px 14px}
.done-note{font-size:14px;color:var(--ok);font-weight:700;padding:0 14px 12px}

/* passcode sheet */
.sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:50;display:flex;align-items:flex-end;justify-content:center}
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
/* Declared last and !important on purpose: .hidden has to beat the display
   rules of everything it is applied to (.sheet-bg, .media, .done-note). */
.hidden{display:none !important}
@media (min-width:700px){
  .title{font-size:32px}
  .sheet-bg{align-items:center}
  .sheet{border-radius:16px}
}
`;

function clientJs(slug, hasPasscode) {
  return `
(function(){
  var SLUG = ${JSON.stringify(String(slug))};
  var THEME_KEY = 'massiv_shotlist_theme';
  var CREW_KEY = 'massiv_shotlist_crew_' + SLUG;

  // Theme — remembered on this device only.
  function applyTheme(t){ document.documentElement.setAttribute('data-theme', t);
    var b = document.getElementById('themeBtn'); if (b) { b.textContent = t === 'dark' ? '☀' : '☾';
      b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); } }
  var saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
  applyTheme(saved === 'dark' ? 'dark' : 'light');
  var themeBtn = document.getElementById('themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', function(){
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  // Reference / scout photos open one shot at a time rather than all at once.
  document.querySelectorAll('.media-toggle').forEach(function(btn){
    btn.addEventListener('click', function(){
      var box = document.getElementById(btn.getAttribute('data-target'));
      if (!box) return;
      var open = !box.classList.contains('hidden');
      if (open) { box.classList.add('hidden'); btn.textContent = btn.getAttribute('data-open-label'); }
      else { box.classList.remove('hidden'); btn.textContent = 'Hide photos'; }
    });
  });

  function refreshProgress(){
    var all = document.querySelectorAll('.shot');
    var done = document.querySelectorAll('.shot.done');
    var num = document.getElementById('progressNum');
    if (num) num.textContent = done.length + ' of ' + all.length + ' shots complete';
    var fill = document.getElementById('progressFill');
    if (fill) fill.style.width = (all.length ? Math.round(done.length / all.length * 100) : 0) + '%';
    var nextEl = null;
    for (var i = 0; i < all.length; i++) { if (!all[i].classList.contains('done')) { nextEl = all[i]; break; } }
    var nowText = document.getElementById('nowText');
    var nowTime = document.getElementById('nowTime');
    if (nowText) nowText.textContent = nextEl ? nextEl.getAttribute('data-title') : 'All shots complete';
    if (nowTime) nowTime.textContent = nextEl ? (nextEl.getAttribute('data-time') || '') : '';
  }

  ${hasPasscode ? crewJs() : '// No passcode set on this shot list: completion is not offered at all.'}

  refreshProgress();
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
      if (btn) { btn.textContent = 'Undo complete'; btn.classList.remove('btn-solid'); }
      if (note) { note.textContent = by ? ('Completed by ' + by) : 'Completed'; note.classList.remove('hidden'); }
    } else {
      el.classList.remove('done');
      if (btn) { btn.textContent = 'Mark complete'; btn.classList.add('btn-solid'); }
      if (note) { note.classList.add('hidden'); note.textContent = ''; }
    }
    refreshProgress();
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

// shotlist: row from shotlists
// rows: scheduled + decorated rows in the ORDER THE PANEL SELECTED
// shots: shot rows keyed lookup, locations: shotlist_locations rows
// media: shot_media rows
function renderShotlist(shotlist, rows, shotsById, locationsById, mediaByShot, opts = {}) {
  const hasPasscode = !!shotlist.passcode_hash;
  const total = rows.length;
  const doneCount = rows.filter(r => {
    const s = shotsById.get(r.shot_id);
    return s && s.status === 'completed';
  }).length;

  const cards = rows.map((row, i) => {
    const shot = shotsById.get(row.shot_id) || {};
    const loc = shot.location_id != null ? locationsById.get(shot.location_id) : null;
    const media = mediaByShot.get(row.shot_id) || [];
    const isDone = shot.status === 'completed';
    const number = shot.shot_number || String(i + 1);
    const title = shot.title || 'Untitled shot';

    const detail = (label, value) => (value
      ? `<div class="row"><div class="row-k">${esc(label)}</div><div class="row-v">${esc(value)}</div></div>`
      : '');

    const dirUrl = loc ? directionsUrl(loc.lat, loc.lng) : null;
    const locBlock = loc ? `
      <div class="loc">
        <div class="loc-text">
          <div class="loc-name">${esc(loc.name)}</div>
          ${loc.address ? `<div class="loc-addr">${esc(loc.address)}</div>` : ''}
        </div>
        ${dirUrl
          ? `<a class="btn" href="${esc(dirUrl)}" target="_blank" rel="noopener noreferrer">Directions</a>`
          : ''}
      </div>` : '';

    const photos = media.map(m => {
      const src = mediaSrc(m.filename);
      if (!src) return '';
      return `<figure><img src="${src}" alt="" loading="lazy"><figcaption>${m.kind === 'scout' ? 'Scout' : 'Reference'}</figcaption></figure>`;
    }).filter(Boolean).join('');

    const openLabel = `Show ${media.length} photo${media.length === 1 ? '' : 's'}`;
    const mediaBlock = photos ? `
      <div class="media-wrap">
        <button type="button" class="media-toggle" data-target="media-${Number(row.shot_id)}" data-open-label="${esc(openLabel)}">${esc(openLabel)}</button>
        <div class="media hidden" id="media-${Number(row.shot_id)}">${photos}</div>
      </div>` : '';

    const completeBlock = hasPasscode ? `
      <div class="done-note${isDone ? '' : ' hidden'}">${isDone && shot.completed_by ? `Completed by ${esc(shot.completed_by)}` : (isDone ? 'Completed' : '')}</div>
      <div class="complete-wrap">
        <button type="button" class="btn btn-wide complete-btn${isDone ? '' : ' btn-solid'}">${isDone ? 'Undo complete' : 'Mark complete'}</button>
      </div>` : '';

    const spaceLabel = shot.space === 'interior' ? 'Interior' : 'Exterior';
    const windowTag = row.light_window_label
      ? `<span class="tag${row.light_window_hard ? ' hard' : ''}">${esc(row.light_window_label)}${row.light_window_range ? ` · ${esc(row.light_window_range)}` : ''}</span>`
      : '';

    return `
    <article class="shot${isDone ? ' done' : ''}" data-shot="${Number(row.shot_id)}" data-title="${esc(title)}" data-time="${esc(row.start_label || '')}">
      <div class="shot-head">
        <div class="num">${esc(number)}</div>
        <div class="shot-headline">
          <div class="shot-title">${esc(title)}</div>
          <div class="shot-time">${esc(row.start_label || '')}${row.duration_minutes ? ` <span>· ${Number(row.duration_minutes)} min</span>` : ''}</div>
        </div>
      </div>
      <div class="tags">
        <span class="tag">${spaceLabel}</span>
        ${windowTag}
        ${shot.shot_type ? `<span class="tag">${esc(shot.shot_type)}</span>` : ''}
      </div>
      ${shot.description || shot.talent || shot.costume || shot.props || shot.camera_notes ? `<div class="rows">
        ${detail('Description', shot.description)}
        ${detail('Talent', shot.talent)}
        ${detail('Costume', shot.costume)}
        ${detail('Props', shot.props)}
        ${detail('Camera', shot.camera_notes)}
      </div>` : ''}
      ${locBlock}
      ${mediaBlock}
      ${completeBlock}
    </article>`;
  }).join('\n');

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
<header class="head">
  <div class="wrap">
    <div class="head-top">
      <h1 class="title">${esc(shotlist.title)}</h1>
      <button class="theme-btn" id="themeBtn" type="button" aria-label="Switch theme">☾</button>
    </div>
    <div class="meta">
      ${shotlist.shoot_date ? `<span class="chip">${esc(fmtDate(shotlist.shoot_date))}</span>` : ''}
      ${shotlist.call_time ? `<span class="chip">Call ${esc(shotlist.call_time)}</span>` : ''}
      <span class="chip">${total} shot${total === 1 ? '' : 's'}</span>
      ${opts.orderLabel ? `<span class="chip">${esc(opts.orderLabel)}</span>` : ''}
    </div>
    <div class="progress">
      <div class="progress-num" id="progressNum">${doneCount} of ${total} shots complete</div>
      <div class="bar"><div class="bar-fill" id="progressFill" style="width:${total ? Math.round((doneCount / total) * 100) : 0}%"></div></div>
    </div>
  </div>
</header>

<div class="now">
  <div class="wrap now-inner">
    <span class="now-label">Current</span>
    <span class="now-text" id="nowText"></span>
    <span class="now-time" id="nowTime"></span>
  </div>
</div>

<main class="wrap list">
${cards || '<p style="padding:28px 0;color:var(--ink-3)">No shots on this list yet.</p>'}
</main>

${shotlist.notes ? `<section class="wrap"><div class="shot"><div class="rows"><div class="row"><div class="row-k">Notes</div><div class="row-v">${esc(shotlist.notes)}</div></div></div></div></section>` : ''}

${sheet}

<footer class="wrap foot">${agencyName ? esc(agencyName) : ''}</footer>
<script>${clientJs(shotlist.slug, hasPasscode)}</script>
</body>
</html>`;
}

module.exports = { renderShotlist, esc, directionsUrl, mediaSrc };
