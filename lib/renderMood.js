// The First AD window: a project's moodboard, on the public domain, written by
// crew who hold the link and the passcode.
//
// Server-rendered, no framework, same shape as the shot list page. Everything a
// user typed is escaped on the way into the HTML, and everything drawn after a
// fetch goes in through textContent, so a card can never inject markup.
//
// The page is a view over the panel's own collection. It has no idea what a
// project, a client or a budget is: it knows one collection, its cards, and a
// passcode that mints a token scoped to that collection.

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0c0c;--panel:#141416;--panel-2:#1b1b1e;--ink:#f4f4f2;--ink-2:#b9b9c0;
  --ink-3:#7c7c85;--line:#2a2a2f;--accent:#00d341;--danger:#ff5f56;
  --radius:14px;
}
html,body{background:var(--bg);color:var(--ink)}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.45;min-height:100%}
img{display:block;max-width:100%}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
a{color:var(--ink)}
.wrap{max-width:1080px;margin:0 auto;padding:0 18px}

/* header */
.head{border-bottom:1px solid var(--line);background:linear-gradient(180deg,#101012,#0c0c0c)}
.head-inner{display:flex;align-items:flex-start;gap:14px;justify-content:space-between;padding:20px 0 18px;flex-wrap:wrap}
.brand{font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-3)}
h1{font-size:clamp(1.35rem,4vw,1.9rem);font-weight:700;letter-spacing:-.02em;margin-top:6px;line-height:1.15}
.sub{color:var(--ink-2);font-size:14px;margin-top:6px;max-width:62ch}
.who{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-2);
  border:1px solid var(--line);border-radius:999px;padding:7px 14px;background:var(--panel)}
.who b{color:var(--ink);font-weight:600}
.who button{color:var(--ink-3);text-decoration:underline;font-size:13px}

/* locked */
.lock{min-height:60vh;display:flex;align-items:center;justify-content:center;padding:40px 18px}
.card-lock{width:100%;max-width:400px;background:var(--panel);border:1px solid var(--line);
  border-radius:18px;padding:26px}
.card-lock h2{font-size:1.15rem;font-weight:650;letter-spacing:-.01em}
.card-lock p{color:var(--ink-2);font-size:14px;margin-top:8px}
.field{margin-top:16px}
.field label{display:block;font-size:12px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}
input,textarea{width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:11px;
  color:var(--ink);padding:12px 13px;font:inherit;font-size:15px}
input:focus,textarea:focus{outline:none;border-color:#4a4a52}
textarea{min-height:110px;resize:vertical}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 18px;
  border-radius:11px;border:1px solid var(--line);background:var(--panel-2);font-weight:650;font-size:15px}
.btn-solid{background:var(--accent);border-color:var(--accent);color:#04170a}
.btn-solid:disabled{opacity:.5;cursor:default}
.btn-block{width:100%;margin-top:18px}
.btn-ghost{border-color:transparent;color:var(--ink-2);padding:0 10px;min-height:40px}

/* toolbar */
.bar{position:sticky;top:0;z-index:20;background:rgba(12,12,12,.92);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--line)}
.bar-inner{display:flex;gap:10px;align-items:center;padding:12px 0;flex-wrap:wrap}
.bar-hint{color:var(--ink-3);font-size:13px;margin-left:auto}
.count{color:var(--ink-3);font-size:13px}

/* grid */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;padding:22px 0 60px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;
  display:flex;flex-direction:column}
.tile-img img{width:100%;aspect-ratio:4/3;object-fit:cover;background:#000}
.tile-body{padding:13px 14px 15px;display:flex;flex-direction:column;gap:7px;flex:1}
.tile-title{font-size:15px;font-weight:650;letter-spacing:-.01em;word-break:break-word}
.tile-note{font-size:14px;color:var(--ink-2);white-space:pre-wrap;word-break:break-word}
.tile-link{font-size:13px;color:var(--ink-3);word-break:break-all;text-decoration:none;border-bottom:1px solid var(--line)}
.tile-link:hover{color:var(--ink)}
.tile-foot{display:flex;align-items:center;gap:10px;margin-top:auto;padding-top:10px;font-size:12px;color:var(--ink-3)}
.tile-actions{display:flex;gap:4px;margin-left:auto}
.tile-actions button{font-size:12px;color:var(--ink-3);padding:4px 7px;border-radius:8px}
.tile-actions button:hover{color:var(--ink);background:var(--panel-2)}
.tile-actions .del:hover{color:var(--danger)}
.badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-3);border:1px solid var(--line);border-radius:999px;padding:2px 8px}
.empty{color:var(--ink-3);font-size:14px;padding:40px 0 60px;text-align:center}

/* editor modal */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.66);display:none;align-items:center;justify-content:center;
  padding:20px;z-index:40}
.overlay.on{display:flex}
.modal{width:100%;max-width:440px;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:22px}
.modal h3{font-size:1.05rem;font-weight:650;letter-spacing:-.01em}
.modal-actions{display:flex;gap:10px;margin-top:20px}
.modal-actions .btn{flex:1}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#242429;border:1px solid var(--line);
  color:var(--ink);border-radius:12px;padding:11px 16px;font-size:14px;z-index:60;display:none;max-width:90vw}
.toast.on{display:block}
.foot{border-top:1px solid var(--line);color:var(--ink-3);font-size:12px;padding:18px 0 30px;text-align:center}
.hidden{display:none !important}`;

// The whole page's behaviour. Only SLUG is injected; everything else is
// assembled from the API, and every string reaches the DOM through textContent.
function clientJs(slug) {
  return `
(function(){
  var SLUG = ${JSON.stringify(String(slug))};
  var KEY = 'mood:' + SLUG;
  var API = '/api/public/collab/' + encodeURIComponent(SLUG);
  var state = { token: null, name: null, cards: [] };

  function $(id){ return document.getElementById(id); }
  function toast(msg){
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function(){ t.classList.remove('on'); }, 3200);
  }
  function save(){ try { localStorage.setItem(KEY, JSON.stringify({ token: state.token, name: state.name })); } catch(e){} }
  function load(){ try { var raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch(e){ return null; } }
  function clear(){ try { localStorage.removeItem(KEY); } catch(e){} state.token = null; state.name = null; }

  function post(path, body){
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(read);
  }
  function read(r){
    return r.json().catch(function(){ return {}; }).then(function(data){
      if (r.status === 401) { clear(); showLocked(); throw new Error('locked'); }
      if (!r.ok) throw new Error(data.error || ('http_' + r.status));
      return data;
    });
  }

  // ── render ──
  function tile(card){
    var mine = state.name && card.created_by === state.name;
    var el = document.createElement('div'); el.className = 'tile';
    el.dataset.id = card.id;

    if (card.type === 'image' && card.url) {
      var im = document.createElement('div'); im.className = 'tile-img';
      var img = document.createElement('img');
      img.src = card.url; img.alt = card.title || ''; img.loading = 'lazy';
      im.appendChild(img); el.appendChild(im);
    }

    var body = document.createElement('div'); body.className = 'tile-body';
    if (card.type === 'note') {
      var badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'Note';
      body.appendChild(badge);
    }
    if (card.title) {
      var t = document.createElement('div'); t.className = 'tile-title'; t.textContent = card.title;
      body.appendChild(t);
    }
    if (card.type === 'note' && card.note_text) {
      var n = document.createElement('div'); n.className = 'tile-note'; n.textContent = card.note_text;
      body.appendChild(n);
    }
    if (card.type === 'link' && card.url) {
      var a = document.createElement('a'); a.className = 'tile-link';
      a.href = card.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = card.url;
      body.appendChild(a);
    }

    var foot = document.createElement('div'); foot.className = 'tile-foot';
    var by = document.createElement('span');
    by.textContent = card.created_by ? ('Added by ' + card.created_by) : 'MASSIV';
    foot.appendChild(by);

    if (mine) {
      var actions = document.createElement('div'); actions.className = 'tile-actions';
      var ed = document.createElement('button'); ed.type = 'button'; ed.textContent = 'Edit';
      ed.onclick = function(){ openEditor(card); };
      var del = document.createElement('button'); del.type = 'button'; del.className = 'del'; del.textContent = 'Delete';
      del.onclick = function(){ removeCard(card); };
      actions.appendChild(ed); actions.appendChild(del);
      foot.appendChild(actions);
    }
    body.appendChild(foot);
    el.appendChild(body);
    return el;
  }

  function render(){
    var grid = $('grid'); grid.textContent = '';
    $('count').textContent = state.cards.length ? (state.cards.length + (state.cards.length === 1 ? ' card' : ' cards')) : '';
    if (!state.cards.length) {
      var e = document.createElement('div'); e.className = 'empty';
      e.textContent = 'Nothing here yet. Add the first reference.';
      grid.appendChild(e); return;
    }
    state.cards.forEach(function(c){ grid.appendChild(tile(c)); });
  }

  // ── screens ──
  function showLocked(){
    $('lock').classList.remove('hidden');
    $('board').classList.add('hidden');
    $('who').classList.add('hidden');
  }
  function showBoard(){
    $('lock').classList.add('hidden');
    $('board').classList.remove('hidden');
    $('who').classList.remove('hidden');
    $('whoName').textContent = state.name || '';
    render();
  }

  function refresh(){
    return fetch(API).then(read).then(function(data){
      if (!data.valid) throw new Error('closed');
      $('title').textContent = data.collection.name || 'Moodboard';
      $('sub').textContent = [data.project_title, data.collection.description].filter(Boolean).join(' · ');
      state.cards = data.cards || [];
      render();
    });
  }

  // ── actions ──
  function unlock(){
    var name = $('inName').value.trim();
    var passcode = $('inCode').value;
    if (!name || !passcode) { toast('Name and passcode, both.'); return; }
    var btn = $('btnUnlock'); btn.disabled = true;
    post('/unlock', { name: name, passcode: passcode })
      .then(function(d){ state.token = d.token; state.name = d.name; save(); showBoard(); return refresh(); })
      .catch(function(err){
        if (err.message !== 'locked') toast(err.message === 'http_429' ? 'Too many tries. Wait a minute.' : 'Wrong passcode, or the link is closed.');
      })
      .then(function(){ btn.disabled = false; });
  }

  function addImage(file){
    if (!file) return;
    var fd = new FormData();
    fd.append('token', state.token);
    fd.append('type', 'image');
    fd.append('title', file.name.replace(/\\.[a-z0-9]+$/i, ''));
    fd.append('image', file);
    fetch(API + '/cards', { method: 'POST', body: fd }).then(read)
      .then(function(d){ state.cards.unshift(d.card); render(); toast('Added.'); })
      .catch(function(err){ if (err.message !== 'locked') toast('Upload failed. Images only, 25MB max.'); });
  }

  function openEditor(card, kindWanted){
    $('edId').value = card ? card.id : '';
    $('edTitle').value = card ? (card.title || '') : '';
    $('edText').value = card && card.type === 'note' ? (card.note_text || '') : '';
    $('edUrl').value = card && card.type === 'link' ? (card.url || '') : '';
    $('edKind').value = card ? card.type : (kindWanted || 'note');
    var kind = $('edKind').value;
    $('fieldText').classList.toggle('hidden', kind !== 'note');
    $('fieldUrl').classList.toggle('hidden', kind !== 'link');
    $('editorTitle').textContent = card ? 'Edit' : (kind === 'link' ? 'Add a link' : 'Add a note');
    $('overlay').classList.add('on');
  }
  function closeEditor(){ $('overlay').classList.remove('on'); }

  function saveEditor(){
    var id = $('edId').value;
    var kind = $('edKind').value;
    var payload = { title: $('edTitle').value.trim() };
    if (kind === 'note') payload.note_text = $('edText').value;
    if (kind === 'link') payload.url = $('edUrl').value.trim();

    if (id) {
      payload.token = state.token;
      fetch(API + '/cards/' + encodeURIComponent(id), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      }).then(read).then(function(d){
        state.cards = state.cards.map(function(c){ return String(c.id) === String(id) ? d.card : c; });
        render(); closeEditor(); toast('Saved.');
      }).catch(function(err){ if (err.message !== 'locked') toast('Could not save.'); });
      return;
    }
    if (kind === 'note') {
      if (!payload.note_text.trim()) { toast('Write something first.'); return; }
      payload.type = 'note'; payload.token = state.token;
      post('/cards', payload).then(function(d){ state.cards.unshift(d.card); render(); closeEditor(); toast('Added.'); })
        .catch(function(err){ if (err.message !== 'locked') toast('Could not add.'); });
    } else {
      if (!/^https?:\\/\\//i.test(payload.url || '')) { toast('A full link, with https://'); return; }
      payload.type = 'link'; payload.token = state.token;
      post('/cards', payload).then(function(d){ state.cards.unshift(d.card); render(); closeEditor(); toast('Added.'); })
        .catch(function(err){ if (err.message !== 'locked') toast('Could not add.'); });
    }
  }

  function removeCard(card){
    if (!confirm('Remove this card?')) return;
    fetch(API + '/cards/' + encodeURIComponent(card.id), {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: state.token })
    }).then(read).then(function(){
      state.cards = state.cards.filter(function(c){ return String(c.id) !== String(card.id); });
      render(); toast('Removed.');
    }).catch(function(err){ if (err.message !== 'locked') toast('Could not remove.'); });
  }

  // ── wiring ──
  $('btnUnlock').onclick = unlock;
  $('inCode').addEventListener('keydown', function(e){ if (e.key === 'Enter') unlock(); });
  $('inName').addEventListener('keydown', function(e){ if (e.key === 'Enter') $('inCode').focus(); });
  $('btnLock').onclick = function(){ clear(); showLocked(); };
  $('pickImage').onchange = function(e){ addImage(e.target.files[0]); e.target.value = ''; };
  $('btnNote').onclick = function(){ openEditor(null, 'note'); };
  $('btnLink').onclick = function(){ openEditor(null, 'link'); };
  $('edSave').onclick = saveEditor;
  $('edCancel').onclick = closeEditor;
  $('overlay').addEventListener('click', function(e){ if (e.target === $('overlay')) closeEditor(); });

  var saved = load();
  if (saved && saved.token) {
    state.token = saved.token; state.name = saved.name;
    showBoard();
    refresh().catch(function(){ clear(); showLocked(); });
  } else {
    showLocked();
  }
})();`;
}

function renderMood(collection, cards, opts = {}) {
  const origin = opts.origin || '';
  const agency = opts.agency || {};
  const agencyName = agency.name || '';
  const name = collection.name || 'Moodboard';
  const ogImage = collection.slug ? `${origin}/mood/${encodeURIComponent(collection.slug)}/cover.png` : '';
  const ogUrl = collection.slug ? `${origin}/mood/${encodeURIComponent(collection.slug)}` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<!-- noindex still lets a link unfurler fetch the page and read the og: tags
     below, which is what makes a WhatsApp preview work without the board ever
     entering a search index. -->
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>${esc(name)}</title>
<meta property="og:title" content="${esc(name)}">
<meta property="og:description" content="${esc(collection.project_title ? 'Moodboard · ' + collection.project_title : 'Moodboard')}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">` : ''}
${ogUrl ? `<meta property="og:url" content="${esc(ogUrl)}">` : ''}
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<style>${CSS}</style>
</head>
<body>
<header class="head">
  <div class="wrap head-inner">
    <div>
      <div class="brand">${esc(agencyName || 'MASSIV')}</div>
      <h1 id="title">${esc(name)}</h1>
      <div class="sub" id="sub">${esc([collection.project_title, collection.description].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="who hidden" id="who">
      <span>You are <b id="whoName"></b></span>
      <button type="button" id="btnLock">Lock</button>
    </div>
  </div>
</header>

<section class="lock" id="lock">
  <div class="card-lock">
    <h2>First AD window</h2>
    <p>Drop ideas, references and notes into this board. Your name shows on everything you add, and you can edit or remove your own cards.</p>
    <div class="field">
      <label for="inName">Your name</label>
      <input id="inName" autocomplete="name" placeholder="e.g. Ardit">
    </div>
    <div class="field">
      <label for="inCode">Passcode</label>
      <input id="inCode" type="password" autocomplete="off" placeholder="From the production">
    </div>
    <button type="button" class="btn btn-solid btn-block" id="btnUnlock">Unlock the board</button>
  </div>
</section>

<div id="board" class="hidden">
  <div class="bar">
    <div class="wrap bar-inner">
      <label class="btn" for="pickImage">Upload image</label>
      <input type="file" id="pickImage" accept="image/*" class="hidden">
      <button type="button" class="btn" id="btnLink">Add link</button>
      <button type="button" class="btn" id="btnNote">Add note</button>
      <span class="count" id="count"></span>
      <span class="bar-hint">Your cards are editable by you alone</span>
    </div>
  </div>
  <div class="wrap">
    <div class="grid" id="grid"></div>
  </div>
</div>

<div class="overlay" id="overlay">
  <div class="modal">
    <h3 id="editorTitle">Add</h3>
    <input type="hidden" id="edId">
    <input type="hidden" id="edKind">
    <div class="field">
      <label for="edTitle">Title</label>
      <input id="edTitle" placeholder="Short label">
    </div>
    <div class="field" id="fieldText">
      <label for="edText">Note</label>
      <textarea id="edText" placeholder="What is this, and why does it matter?"></textarea>
    </div>
    <div class="field" id="fieldUrl">
      <label for="edUrl">Link</label>
      <input id="edUrl" inputmode="url" placeholder="https://">
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" id="edCancel">Cancel</button>
      <button type="button" class="btn btn-solid" id="edSave">Save</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>
<footer class="wrap foot">${esc(agencyName || '')}</footer>
<script>${clientJs(collection.slug)}</script>
</body>
</html>`;
}

module.exports = { renderMood, esc };
