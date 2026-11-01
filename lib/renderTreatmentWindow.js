// The Director Treatment window: the shared working surface for a treatment.
//
// Andi works in Illustrator and Frameset, the First AD works in Canva, and
// neither one can open the other's file. This page is the surface both of them
// can actually write in: the treatment's own sections, in the browser, no
// account, no app to install. The link gets you the document, the passcode
// lets you change it, and every write is attributed to the name in the bar.
//
// A page, not an app: no framework, no build step, no external request except
// the images. Text goes into the DOM through textContent (never innerHTML), so
// a name or a caption typed by anyone cannot become markup on anyone's screen.

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hexOr(value, fallback) {
  const v = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

const LABELS = {
  hero: 'Cover', statement: 'Director’s note', full_image: 'Key frame',
  image_grid: 'Frames', split: 'Idea', moodboard: 'References',
  deliverables: 'Deliverables', crew: 'The team', cta: 'Close', social_post: 'Social',
};

// Field spec per section type: [key, label, kind, options?]. kind is one of
// text, textarea, image, images, select, check, rows. Kept beside the renderer
// so the window and the panel-side editor ask for the same things.
const SPEC = {
  hero: [['eyebrow', 'Eyebrow', 'text'], ['title', 'Title', 'text'], ['subtitle', 'Subtitle', 'text'], ['image', 'Background image', 'image']],
  statement: [['text', 'Note', 'textarea'], ['alignment', 'Alignment', 'select', ['center', 'left']]],
  full_image: [['image', 'Image', 'image'], ['caption', 'Caption', 'text']],
  image_grid: [['images', 'Images', 'images'], ['columns', 'Columns', 'select', [2, 3, 4]], ['gap', 'Gap', 'select', ['normal', 'tight']]],
  split: [['image', 'Image', 'image'], ['heading', 'Heading', 'text'], ['body', 'Body', 'textarea'], ['image_side', 'Image side', 'select', ['right', 'left']]],
  moodboard: [['images', 'References', 'images'], ['note', 'Note', 'textarea']],
  deliverables: [['heading', 'Heading', 'text'], ['items', 'Items', 'rows', [['title', 'Title'], ['detail', 'Detail']]]],
  crew: [['heading', 'Heading', 'text'], ['members', 'Team', 'rows', [['role', 'Role'], ['name', 'Name']]]],
  cta: [['heading', 'Heading', 'text'], ['body', 'Body', 'textarea'], ['show_agency_branding', 'Show the agency mark', 'check']],
  social_post: [['platform', 'Platform', 'select', ['instagram', 'facebook']], ['handle', 'Handle', 'text'], ['caption', 'Caption', 'textarea'], ['image', 'Image', 'image']],
};

const TYPE_ORDER = ['hero', 'statement', 'split', 'moodboard', 'image_grid', 'full_image', 'deliverables', 'crew', 'cta', 'social_post'];

function renderTreatmentWindow(pres, options) {
  const opts = options || {};
  const agency = opts.agency || {};
  const accent = hexOr(pres.accent_color, '#C7FF2E');
  const title = pres.title || 'Director Treatment';
  const slug = String(pres.slug || '');

  const logo = agency.logo
    ? `<img class="mark-img" src="${esc(agency.logo)}" alt="">`
    : (agency.name ? esc(agency.name) : '');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--accent:${accent};--bg:#0B0B0C;--card:#141416;--line:#2A2A2E;--ink:#F2F2F4;--soft:#9B9BA1}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
header.top{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;padding:14px 22px;background:rgba(11,11,12,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.top .name{display:flex;align-items:center;gap:10px;min-width:0}
.mark-img{height:20px;width:auto;filter:brightness(0) invert(1);opacity:.9}
.top h1{font-size:15px;font-weight:650;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lede{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--soft)}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
input,select,textarea,button{font:inherit;color:inherit}
.field{background:#1B1B1E;border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--ink);min-width:0}
.field:focus{outline:none;border-color:var(--accent)}
.field::placeholder{color:#6C6C73}
button{cursor:pointer;background:#1B1B1E;border:1px solid var(--line);border-radius:8px;padding:8px 12px;transition:border-color .15s,opacity .15s}
button:hover:not(:disabled){border-color:var(--accent)}
button:disabled{opacity:.4;cursor:not-allowed}
button.go{background:var(--accent);border-color:var(--accent);color:#0B0B0C;font-weight:650}
button.ghost{background:transparent}
.pill{font-size:11px;letter-spacing:.14em;text-transform:uppercase;padding:5px 10px;border-radius:999px;border:1px solid var(--line);color:var(--soft);white-space:nowrap}
.pill.live{border-color:var(--accent);color:var(--accent)}
.pill.dirty{border-color:#E8B44A;color:#E8B44A}
main{max-width:900px;margin:0 auto;padding:26px 22px 120px;display:flex;flex-direction:column;gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.card-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line)}
.card-head .lbl{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
.card-head .spacer{flex:1}
.card-head button{padding:5px 9px;font-size:13px;line-height:1}
.card-body{padding:16px;display:flex;flex-direction:column;gap:14px}
.row{display:flex;flex-direction:column;gap:6px}
.row label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--soft)}
textarea{min-height:96px;resize:vertical;line-height:1.5}
input[type=text],textarea{width:100%}
select{appearance:none;padding-right:26px;background-image:linear-gradient(45deg,transparent 50%,#8A8A92 50%),linear-gradient(135deg,#8A8A92 50%,transparent 50%);background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.chk{display:flex;align-items:center;gap:9px}
.chk input{width:16px;height:16px;accent-color:var(--accent)}
.thumbs{display:flex;flex-wrap:wrap;gap:10px}
.thumb{position:relative;width:132px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#1B1B1E}
.thumb img{display:block;width:100%;height:100px;object-fit:cover}
.thumb .none{height:100px;display:flex;align-items:center;justify-content:center;color:#5C5C63;font-size:11px;text-align:center;padding:8px}
.thumb .acts{display:flex;gap:1px;border-top:1px solid var(--line)}
.thumb .acts button{flex:1;border:0;border-radius:0;padding:7px 0;font-size:11px;background:#1B1B1E}
.add{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.rows{display:flex;flex-direction:column;gap:8px}
.rowitem{display:flex;gap:8px;align-items:center}
.rowitem input{flex:1;min-width:0}
.note{color:var(--soft);font-size:12.5px;max-width:62ch}
.footbar{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;gap:10px;align-items:center;justify-content:center;padding:12px 22px;background:rgba(11,11,12,.94);backdrop-filter:blur(12px);border-top:1px solid var(--line)}
.err{color:#FF7B6B;font-size:13px}
.locked{max-width:520px;margin:70px auto;padding:0 22px;text-align:center}
.locked h2{font-size:20px;margin-bottom:8px}
.locked p{color:var(--soft);margin-bottom:20px}
.locked form{display:flex;flex-direction:column;gap:10px;text-align:left}
@media(max-width:600px){header.top{padding:12px 14px}main{padding:18px 14px 130px}.footbar{padding:10px 14px}}
</style>
</head>
<body>
<header class="top">
  <div class="name">
    ${logo ? `<span class="mark">${logo}</span>` : ''}
    <div>
      <div class="lede">Director Treatment</div>
      <h1 id="title">${esc(title)}</h1>
    </div>
  </div>
  <div class="bar" id="bar">
    <span class="pill" id="statusPill">Viewing</span>
  </div>
</header>

<main id="list"></main>

<div class="footbar" id="footbar" hidden>
  <button class="go" id="saveBtn">Save changes</button>
  <span class="note" id="footNote">Everyone with the link and the passcode sees this document.</span>
</div>

<script>
(function(){
  var SLUG = ${JSON.stringify(slug)};
  var API = '/api/public/treatment/' + encodeURIComponent(SLUG);
  var LABELS = ${JSON.stringify(LABELS)};
  var SPEC = ${JSON.stringify(SPEC)};
  var TYPE_ORDER = ${JSON.stringify(TYPE_ORDER)};

  var sections = [];
  var token = null;
  var actor = null;
  var dirty = false;

  var list = document.getElementById('list');
  var bar = document.getElementById('bar');
  var footbar = document.getElementById('footbar');
  var footNote = document.getElementById('footNote');
  var statusPill = document.getElementById('statusPill');

  function mediaUrl(name){ return '/p-media/' + name; }
  function el(tag, cls, text){ var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n; }

  function markDirty(){ dirty = true; paint(); }
  function paint(){
    if (token){
      statusPill.textContent = dirty ? 'Unsaved changes' : ('Editing as ' + actor);
      statusPill.className = 'pill ' + (dirty ? 'dirty' : 'live');
      footbar.hidden = false;
    } else {
      statusPill.textContent = 'Viewing';
      statusPill.className = 'pill';
      footbar.hidden = true;
    }
  }

  // ── the passcode bar ───────────────────────────────────────────────────
  function renderLocked(){
    bar.innerHTML = '';
    var name = el('input','field'); name.type='text'; name.placeholder='Your name'; name.maxLength=60;
    var pass = el('input','field'); pass.type='password'; pass.placeholder='Passcode'; pass.autocomplete='off';
    var btn = el('button','go','Unlock editing');
    var err = el('span','err','');
    function submit(){
      err.textContent='';
      if(!name.value.trim()){ err.textContent='Name required'; return; }
      if(!pass.value){ err.textContent='Passcode required'; return; }
      btn.disabled = true;
      fetch(API + '/unlock', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name: name.value.trim(), passcode: pass.value })
      }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(res){
        btn.disabled = false;
        if(!res.ok || !res.j.token){ err.textContent = 'That passcode was not accepted.'; return; }
        token = res.j.token; actor = res.j.name || name.value.trim();
        showForm(); render(); paint();
      }).catch(function(){ btn.disabled=false; err.textContent='Could not reach the server.'; });
    }
    btn.onclick = submit;
    pass.onkeydown = function(e){ if(e.key==='Enter') submit(); };
    name.onkeydown = function(e){ if(e.key==='Enter') submit(); };
    bar.appendChild(name); bar.appendChild(pass); bar.appendChild(btn); bar.appendChild(err);
  }
  function showForm(){ bar.innerHTML=''; }

  function renderEditingBar(){
    bar.innerHTML = '';
    var done = el('button','ghost','Done editing');
    done.onclick = function(){ token=null; actor=null; dirty=false; renderLocked(); render(); paint(); };
    bar.appendChild(done);
  }

  // ── fields ─────────────────────────────────────────────────────────────
  function uploadImage(file, cb){
    var fd = new FormData();
    fd.append('token', token);
    fd.append('image', file);
    fetch(API + '/upload', { method:'POST', body: fd })
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
      .then(function(res){
        if(!res.ok || !res.j.filename){ alert('Upload failed: ' + ((res.j && res.j.error) || 'unknown')); return; }
        cb(res.j.filename);
      }).catch(function(){ alert('Upload failed.'); });
  }

  function imagePicker(c, field, multi, value, onSet){
    var wrap = el('div','thumbs');
    function drawOne(name, idx){
      var t = el('div','thumb');
      if(name) { var im = el('img'); im.src = mediaUrl(name); im.alt=''; t.appendChild(im); }
      else { t.appendChild(el('div','none','No image')); }
      if(token){
        var acts = el('div','acts');
        var file = document.createElement('input'); file.type='file'; file.accept='image/*'; file.style.display='none';
        file.onchange = function(){ if(!file.files || !file.files[0]) return;
          uploadImage(file.files[0], function(fn){ onSet(fn, idx); markDirty(); render(); }); };
        var pick = el('button', null, 'Replace');
        pick.onclick = function(){ file.click(); };
        var rm = el('button', null, 'Remove');
        rm.onclick = function(){ onSet(null, idx); markDirty(); render(); };
        acts.appendChild(pick); acts.appendChild(rm); acts.appendChild(file);
        t.appendChild(acts);
      }
      wrap.appendChild(t);
    }
    if(multi){
      (value||[]).forEach(function(n,i){ drawOne(n,i); });
      if(token){
        var file = document.createElement('input'); file.type='file'; file.accept='image/*'; file.multiple=true; file.style.display='none';
        file.onchange = function(){ var fs = Array.prototype.slice.call(file.files||[]); if(!fs.length) return;
          var i=0; (function next(){ if(i>=fs.length){ markDirty(); render(); return; }
            uploadImage(fs[i++], function(fn){ if(!value) value=[]; value.push(fn); next(); }); })(); };
        var add = el('div','thumb');
        var addBtn = el('button', null, '+ Add'); addBtn.style.width='100%';
        addBtn.onclick = function(){ file.click(); };
        add.appendChild(addBtn); add.appendChild(file);
        wrap.appendChild(add);
      }
    }
    return wrap;
  }

  function fieldNode(section, field, content){
    var key = field[0], label = field[1], kind = field[2], opts = field[3];
    var row = el('div','row');
    if(kind !== 'check') row.appendChild(el('label', null, label));
    var editable = !!token;

    if(kind === 'text' || kind === 'textarea'){
      var input = el(kind === 'textarea' ? 'textarea' : 'input','field');
      if(kind === 'text') input.type='text';
      input.value = content[key] == null ? '' : String(content[key]);
      input.readOnly = !editable;
      input.oninput = function(){ content[key] = input.value; markDirty(); };
      row.appendChild(input);
    } else if(kind === 'image'){
      row.appendChild(imagePicker(null, field, false, content[key], function(fn, idx){
        content[key] = fn || '';
      }));
    } else if(kind === 'images'){
      row.appendChild(imagePicker(null, field, true, content[key] || [], function(fn, idx){
        if(!content[key]) content[key] = [];
        if(fn === null) content[key].splice(idx,1); else content[key][idx] = fn;
      }));
    } else if(kind === 'select'){
      var sel = el('select','field');
      opts.forEach(function(o){
        var op = el('option', null, String(o)); op.value = String(o);
        if(String(content[key]) === String(o)) op.selected = true;
        sel.appendChild(op);
      });
      sel.disabled = !editable;
      sel.onchange = function(){ content[key] = sel.value; markDirty(); };
      row.appendChild(sel);
    } else if(kind === 'check'){
      var chk = el('div','chk');
      var cb = document.createElement('input'); cb.type='checkbox'; cb.checked = !!content[key]; cb.disabled = !editable;
      cb.onchange = function(){ content[key] = cb.checked; markDirty(); };
      chk.appendChild(cb); chk.appendChild(el('label', null, label));
      row.appendChild(chk);
    } else if(kind === 'rows'){
      var sub = opts; // [[key,label], ...]
      var box = el('div','rows');
      function drawRows(){
        box.innerHTML = '';
        var arr = content[key] || [];
        arr.forEach(function(item, i){
          var line = el('div','rowitem');
          sub.forEach(function(sf){
            var inp = el('input','field'); inp.type='text';
            inp.placeholder = sf[1];
            inp.value = item && item[sf[0]] != null ? String(item[sf[0]]) : '';
            inp.readOnly = !editable;
            inp.oninput = function(){ if(!content[key]) content[key]=[]; if(!content[key][i]) content[key][i]={}; content[key][i][sf[0]] = inp.value; markDirty(); };
            line.appendChild(inp);
          });
          if(editable){
            var rm = el('button','ghost','×');
            rm.onclick = function(){ content[key].splice(i,1); markDirty(); render(); };
            line.appendChild(rm);
          }
          box.appendChild(line);
        });
        if(editable){
          var add = el('button','ghost','+ Add row');
          add.onclick = function(){ if(!content[key]) content[key]=[]; content[key].push({}); markDirty(); render(); };
          box.appendChild(add);
        }
      }
      drawRows();
      row.appendChild(box);
    }
    return row;
  }

  function card(section, i){
    var c = el('div','card');
    var head = el('div','card-head');
    head.appendChild(el('span','lbl', LABELS[section.type] || section.type));
    head.appendChild(el('span','spacer'));
    if(token){
      var up = el('button','ghost','↑'); up.title='Move up';
      up.disabled = i===0;
      up.onclick = function(){ var t=sections[i-1]; sections[i-1]=sections[i]; sections[i]=t; markDirty(); render(); };
      var down = el('button','ghost','↓'); down.title='Move down';
      down.disabled = i===sections.length-1;
      down.onclick = function(){ var t=sections[i+1]; sections[i+1]=sections[i]; sections[i]=t; markDirty(); render(); };
      var del = el('button','ghost','Delete');
      del.onclick = function(){ sections.splice(i,1); markDirty(); render(); };
      head.appendChild(up); head.appendChild(down); head.appendChild(del);
    }
    c.appendChild(head);

    var body = el('div','card-body');
    var content = section.content || {};
    (SPEC[section.type] || []).forEach(function(f){ body.appendChild(fieldNode(section, f, content)); });
    c.appendChild(body);
    return c;
  }

  function render(){
    list.innerHTML = '';
    if(!sections.length){
      var empty = el('div','note','This treatment has no sections yet.');
      list.appendChild(empty);
    }
    sections.forEach(function(s,i){ list.appendChild(card(s,i)); });
    if(token){
      var add = el('div','card');
      var addHead = el('div','card-head');
      addHead.appendChild(el('span','lbl','Add a section'));
      add.appendChild(addHead);
      var addBody = el('div','card-body');
      var pick = el('select','field');
      TYPE_ORDER.forEach(function(t){ var o=el('option',null,LABELS[t]||t); o.value=t; pick.appendChild(o); });
      var btn = el('button','go','Add');
      btn.onclick = function(){ sections.push({ id:null, type: pick.value, content: {} }); markDirty(); render(); };
      addBody.appendChild(pick); addBody.appendChild(btn);
      add.appendChild(addBody);
      list.appendChild(add);
    }
    // The bar follows the token. Without one, the passcode form must survive a
    // render (adding or moving a section happens unlocked only, but a render on
    // boot used to wipe the form before anyone could type in it).
    if (token) renderEditingBar();
    else if (!bar.querySelector('input.field')) renderLocked();
    paint();
  }

  // ── save ───────────────────────────────────────────────────────────────
  document.getElementById('saveBtn').onclick = function(){
    if(!token) return;
    var btn = document.getElementById('saveBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    fetch(API + '/save', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: token, sections: sections })
    }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
    .then(function(res){
      btn.disabled = false; btn.textContent = 'Save changes';
      if(!res.ok || !res.j.ok){ footNote.textContent = 'Save failed: ' + ((res.j && res.j.error) || 'unknown'); footNote.className='err'; return; }
      sections = res.j.sections || sections;
      dirty = false;
      footNote.textContent = 'Saved. The page and the PDF now show this version.';
      footNote.className = 'note';
      render();
    }).catch(function(){
      btn.disabled = false; btn.textContent = 'Save changes';
      footNote.textContent = 'Save failed: could not reach the server.';
      footNote.className='err';
    });
  };

  window.addEventListener('beforeunload', function(e){ if(dirty){ e.preventDefault(); e.returnValue=''; } });

  // ── boot ───────────────────────────────────────────────────────────────
  fetch(API).then(function(r){ return r.json(); }).then(function(j){
    if(!j || !j.valid){
      list.innerHTML = '';
      var gone = el('div','locked');
      gone.appendChild(el('h2',null,'This link is closed'));
      gone.appendChild(el('p',null,'The treatment was unshared, or the passcode was rotated. Ask for a fresh link.'));
      list.appendChild(gone);
      return;
    }
    sections = j.sections || [];
    document.getElementById('title').textContent = j.title || 'Director Treatment';
    renderLocked();
    render();
  }).catch(function(){
    list.innerHTML = '';
    var bad = el('div','locked');
    bad.appendChild(el('h2',null,'Could not load this treatment'));
    bad.appendChild(el('p',null,'Check the connection and reload the page.'));
    list.appendChild(bad);
  });
})();
</script>
</body>
</html>`;
}

module.exports = { renderTreatmentWindow };
