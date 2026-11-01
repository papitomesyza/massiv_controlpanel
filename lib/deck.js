// The Director Treatment deck.
//
// One section = one 16:9 slide, drawn in the browser from a JSON payload, the
// grid and the present view around it. Frameset-shaped, but ours: the same
// section model the panel already writes, no canvas editor to maintain.
//
// Why client-rendered: the treatment window, the public link and the panel
// preview all need the SAME slides, and the window already builds its DOM in
// the browser (it edits live). So the builders live once, in DECK_JS, inlined
// into every page that shows a deck.
//
// Canvas is a fixed 1280x720 design, scaled with a transform to whatever box
// it lands in. One set of numbers, identical on a phone, on a projector and in
// the grid thumbnails. All user text goes in through textContent, never
// innerHTML: a caption typed by anyone cannot become markup on anyone's screen.

// ── Themes: six house looks ─────────────────────────────────────────────────
// A theme is a palette plus four type knobs. The templates in
// db/treatment-templates.js each name one, and a treatment can carry its own
// accent_color on top (that always wins).

const THEMES = [
  {
    key: 'noir', label: 'Noir',
    bg: '#0A0A0B', ink: '#F4F4F6', muted: 'rgba(244,244,246,0.60)',
    card: '#17171A', line: 'rgba(255,255,255,0.14)', accent: '#C7FF2E',
    mutedHex: '#97979B', lineHex: '#2C2C2D',
    display: 'upper', weight: 900, track: '-0.025em', align: 'left', dark: true,
  },
  {
    key: 'fest', label: 'Fest',
    bg: '#160B07', ink: '#FFF4EC', muted: 'rgba(255,244,236,0.62)',
    card: '#241209', line: 'rgba(255,180,140,0.20)', accent: '#FF5A1F',
    mutedHex: '#A69B95', lineHex: '#452D22',
    display: 'upper', weight: 900, track: '-0.03em', align: 'left', dark: true,
  },
  {
    key: 'hebs', label: 'Bright',
    bg: '#F4F1EC', ink: '#14120F', muted: 'rgba(20,18,15,0.58)',
    card: '#FFFFFF', line: 'rgba(20,18,15,0.14)', accent: '#1E5BFF',
    mutedHex: '#726F6C', lineHex: '#D5D3CF',
    display: 'upper', weight: 800, track: '-0.02em', align: 'left', dark: false,
  },
  {
    key: 'reel', label: 'Reel',
    bg: '#0B0616', ink: '#F6F2FF', muted: 'rgba(246,242,255,0.60)',
    card: '#180D2B', line: 'rgba(180,140,255,0.22)', accent: '#B14BFF',
    mutedHex: '#9893A1', lineHex: '#302449',
    display: 'upper', weight: 900, track: '-0.03em', align: 'center', dark: true,
  },
  {
    key: 'bone', label: 'Bone',
    bg: '#FFFFFF', ink: '#0F0F0F', muted: 'rgba(15,15,15,0.55)',
    card: '#F4F4F2', line: 'rgba(15,15,15,0.12)', accent: '#0F0F0F',
    mutedHex: '#7B7B7B', lineHex: '#E2E2E2',
    display: 'none', weight: 700, track: '-0.015em', align: 'left', dark: false,
  },
  {
    key: 'slate', label: 'Slate',
    bg: '#101014', ink: '#EDEDF0', muted: 'rgba(237,237,240,0.55)',
    card: '#1A1A20', line: 'rgba(255,255,255,0.12)', accent: '#8A8A92',
    mutedHex: '#89898D', lineHex: '#2D2D31',
    display: 'none', weight: 700, track: '-0.015em', align: 'left', dark: true,
  },
];

const DEFAULT_THEME = 'noir';

const LABELS = {
  hero: 'Cover', statement: 'The Story', full_image: 'Key Frame',
  image_grid: 'Frames', split: 'The Idea', moodboard: 'References',
  deliverables: 'Deliverables', crew: 'The Team', cta: 'Close', social_post: 'Social',
};

function hexOr(value, fallback) {
  const v = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

function themeFor(name, accent) {
  const base = THEMES.find(t => t.key === name) || THEMES.find(t => t.key === DEFAULT_THEME);
  return Object.assign({}, base, { accent: hexOr(accent, base.accent) });
}

function themeVars(theme) {
  return [
    `--bg:${theme.bg}`, `--ink:${theme.ink}`, `--mut:${theme.muted}`,
    `--accent:${theme.accent}`, `--card:${theme.card}`, `--line:${theme.line}`,
  ].join(';');
}

// ── Page CSS ────────────────────────────────────────────────────────────────
// Slide type sizes are absolute px on the 1280x720 canvas; the canvas itself is
// scaled, so a thumbnail and a projector show the same composition.

function deckCss() {
  return `
.deck{position:relative}
.deck,.deck *{box-sizing:border-box}
.sl{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif}
.stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.cv{position:relative;flex:0 0 auto;width:1280px;height:720px;transform-origin:center center;overflow:hidden;background:var(--bg)}
.cv *{margin:0;padding:0}
.cv img{display:block}
/* slide chrome */
.strip{position:absolute;top:44px;left:64px;right:64px;display:flex;align-items:center;justify-content:space-between;z-index:5}
.strip .lab{font-size:13px;font-weight:700;letter-spacing:.30em;text-transform:uppercase;color:var(--accent);background:rgba(0,0,0,.42);padding:8px 14px;border-radius:999px;backdrop-filter:blur(6px)}
.lite .strip .lab{background:rgba(255,255,255,.66)}
.idx{display:flex;align-items:center;gap:10px;font-size:12px;letter-spacing:.18em;color:var(--mut)}
.idx .circ{width:28px;height:28px;border:1px solid var(--line);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--ink);background:rgba(0,0,0,.42)}
.lite .idx .circ{background:rgba(255,255,255,.66)}
.mark{position:absolute;top:44px;left:64px;right:64px;display:flex;justify-content:center;z-index:6}
.mark img{height:26px;width:auto;filter:brightness(0) invert(1);opacity:.75}
.mark span{font-size:12px;font-weight:700;letter-spacing:.34em;text-transform:uppercase;color:rgba(255,255,255,.8)}
/* bleed + pad */
.bleed{position:absolute;inset:0;z-index:0;overflow:hidden}
.bleed img{width:100%;height:100%;object-fit:cover}
.bleed .ov{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.15) 45%,rgba(0,0,0,.72))}
.pad{position:absolute;inset:0;z-index:3;padding:118px 64px 64px;display:flex;flex-direction:column}
.pad.mid{justify-content:center}
.pad.bot{justify-content:flex-end}
.pad.left{align-items:flex-start;text-align:left}
.pad.ctr{align-items:center;text-align:center}
.ph{position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(127,127,127,.10) 0 14px,rgba(127,127,127,.04) 14px 28px)}
.phl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;letter-spacing:.28em;text-transform:uppercase;color:var(--mut);z-index:1}
/* type */
.eyebrow{font-size:15px;font-weight:700;letter-spacing:.30em;text-transform:uppercase;color:var(--accent);margin-bottom:26px}
.t-hero{font-size:88px;font-weight:900;line-height:.92;letter-spacing:-.028em;text-transform:uppercase}
.t-hero.lc{text-transform:none}
.t-hero.sm{font-size:66px}
.sub{margin-top:26px;font-size:26px;font-weight:400;line-height:1.35;color:rgba(255,255,255,.78);max-width:30ch}
.sub.onlight{color:var(--mut)}
.quote{font-size:54px;font-weight:800;line-height:1.08;letter-spacing:-.022em;max-width:24ch}
.h2{font-size:46px;font-weight:900;line-height:1.02;letter-spacing:-.024em;text-transform:uppercase}
.h2.lc{text-transform:none}
.body{margin-top:22px;font-size:21px;line-height:1.5;color:var(--mut);max-width:40ch}
.cap{position:absolute;left:64px;right:64px;bottom:64px;z-index:4;display:flex;align-items:center;gap:14px;font-size:12px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.86)}
.cap .rule{width:34px;height:1px;background:currentColor;opacity:.6}
/* colour themes on light backgrounds keep black scrims off the text */
.lite .bleed .ov{background:linear-gradient(180deg,rgba(255,255,255,.30),rgba(255,255,255,.10) 40%,rgba(255,255,255,.78))}
.lite .t-hero,.lite .quote,.lite .sub{color:var(--ink)}
.lite .cap{color:var(--ink)}
/* split: half image, half type */
.half{position:absolute;inset:0;z-index:2;display:grid;grid-template-columns:1fr 1fr}
.half .sideimg{position:relative;overflow:hidden}
.half .sideimg img{width:100%;height:100%;object-fit:cover}
.half .sidetext{padding:118px 64px 64px;display:flex;flex-direction:column;justify-content:center}
.half.rev .sideimg{order:2}
.half.rev .sidetext{order:1}
/* grids */
.gridfill{position:absolute;inset:0;z-index:2;display:grid;gap:6px}
.g2{grid-template-columns:repeat(2,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g4{grid-template-columns:repeat(4,1fr)}
.gap-tight{gap:4px}
.cell{position:relative;overflow:hidden;background:rgba(127,127,127,.07)}
.cell img{width:100%;height:100%;object-fit:cover}
/* moodboard: image wall with a note over it */
.mood{position:absolute;inset:0;z-index:2;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr;gap:8px;padding:100px 64px 64px}
.mood .cell:nth-child(1){grid-row:span 2}
.moodnote{position:absolute;left:64px;right:64px;bottom:28px;z-index:4;font-size:19px;color:var(--mut)}
/* cards (deliverables, crew) */
.cards{position:absolute;inset:118px 64px 64px;z-index:3;display:flex;flex-direction:column}
.cards .row{display:grid;gap:14px;margin-top:34px}
.cards .row.c3{grid-template-columns:repeat(3,1fr)}
.cards .row.c4{grid-template-columns:repeat(4,1fr)}
.cards .row.c2{grid-template-columns:repeat(2,1fr)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
.card .ct{font-size:24px;font-weight:800;letter-spacing:-.015em;line-height:1.15}
.card .cd{margin-top:10px;font-size:16px;line-height:1.45;color:var(--mut)}
.card .role{font-size:12px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--accent)}
.card .nm{margin-top:12px;font-size:24px;font-weight:800;letter-spacing:-.015em}
/* cta */
.ctagrad{background:linear-gradient(112deg,var(--ink) 28%,var(--accent));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.brandline{margin-top:44px;display:flex;flex-direction:column;align-items:center;gap:14px}
.brandline img{max-height:40px;width:auto}
.brandline .nm2{font-size:12px;font-weight:700;letter-spacing:.30em;text-transform:uppercase;color:var(--mut)}
/* social mockup */
.social{position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center}
.phone{width:392px;background:var(--card);border:1px solid var(--line);border-radius:24px;overflow:hidden}
.phone .ph-head{display:flex;align-items:center;gap:10px;padding:14px 16px}
.avatar{width:34px;height:34px;border-radius:50%;background:rgba(127,127,127,.3);overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover}
.phone .who{font-size:15px;font-weight:700}
.phone .pic{position:relative;aspect-ratio:4/5;background:rgba(127,127,127,.08)}
.phone .pic img{width:100%;height:100%;object-fit:cover}
.phone .acts{display:flex;gap:18px;padding:14px 16px 6px;color:var(--mut);font-size:13px;letter-spacing:.02em}
.phone .capc{padding:6px 16px 18px;font-size:15px;line-height:1.4}
/* views */
.deck.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;padding:22px;max-width:1400px;margin:0 auto}
.deck.grid .sl{border:1px solid var(--line);border-radius:12px;cursor:pointer;transition:border-color .15s,transform .15s}
.deck.grid .sl:hover{border-color:var(--accent);transform:translateY(-2px)}
.deck.present{position:fixed;inset:0;z-index:80;background:#050505;padding:0;max-width:none;display:block}
.deck.present .sl{display:none;position:absolute;inset:0;width:100%;height:100%;aspect-ratio:auto;border:0;border-radius:0}
.deck.present .sl.on{display:block}
.pnav{position:fixed;left:0;right:0;bottom:18px;z-index:90;display:flex;gap:10px;justify-content:center;align-items:center;opacity:.25;transition:opacity .2s}
.pnav:hover{opacity:1}
.pnav button{width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.5);color:#fff;font-size:15px;cursor:pointer}
.pnav .cnt{color:#fff;font-size:12px;letter-spacing:.2em;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif}
@media(max-width:700px){
  .deck.grid{grid-template-columns:1fr;padding:14px;gap:14px}
}
`;
}

// ── Browser builders ────────────────────────────────────────────────────────

function deckJs() {
  return `
(function(){
  var LABELS = ${JSON.stringify(LABELS)};

  function el(tag, cls){ var n=document.createElement(tag); if(cls) n.className=cls; return n; }
  function txt(tag, cls, s){ var n=el(tag,cls); n.textContent = (s==null?'':String(s)); return n; }
  function media(name){ return (name && typeof name === 'string' && name.indexOf('/')<0 && name.indexOf('..')<0) ? '/p-media/' + encodeURIComponent(name) : null; }
  function textOf(v){ var s = (v==null?'':String(v)); return s.replace(/[\\u2013\\u2014\\u2015]/g,',').replace(/,\\s*,/g,',').trim(); }

  // Image cell: real picture, or the dashed frame that only ever shows in a
  // preview or in the First AD window. Never on a client link.
  function cell(name, phLabel, ctx){
    var box = el('div','cell');
    var src = media(name);
    if(src){ var im = el('img'); im.src = src; im.alt=''; im.loading='lazy'; box.appendChild(im); }
    else if(ctx && ctx.preview){ box.appendChild(el('div','ph')); if(phLabel) box.appendChild(txt('div','phl',phLabel)); }
    else { box.appendChild(el('div','ph')); }
    return box;
  }

  function bleed(name, ctx, c){
    var wrap = el('div','bleed');
    var src = media(name);
    if(src){ var im = el('img'); im.src = src; im.alt=''; wrap.appendChild(im); }
    else { wrap.appendChild(el('div','ph')); if(ctx && ctx.preview) wrap.appendChild(txt('div','phl','background')); }
    wrap.appendChild(el('div','ov'));
    return wrap;
  }

  // The uppercase/lowercase switch a theme asks for.
  function disp(theme, cls){ return theme.display === 'upper' ? cls : cls + ' lc'; }

  function strip(section, ctx){
    var s = el('div','strip');
    s.appendChild(txt('span','lab', LABELS[section.type] || section.type));
    var idx = el('div','idx');
    idx.appendChild(txt('span','circ', String(ctx.n)));
    idx.appendChild(txt('span', null, String(ctx.n) + ' / ' + String(ctx.total)));
    s.appendChild(idx);
    return s;
  }

  function marketing(ctx){
    var ag = ctx.agency || {};
    if(!ag.logo && !ag.name) return null;
    var m = el('div','mark');
    if(ag.logo){ var im = el('img'); im.src = ag.logo; im.alt=''; m.appendChild(im); }
    else m.appendChild(txt('span', null, ag.name));
    return m;
  }

  var BUILD = {
    hero: function(c, theme, ctx){
      var pad = el('div','pad mid ' + (theme.align === 'center' ? 'ctr' : 'left'));
      if(c.eyebrow) pad.appendChild(txt('div','eyebrow', textOf(c.eyebrow)));
      var h = txt('h1', disp(theme,'t-hero') + (textOf(c.title).length > 26 ? ' sm' : ''), textOf(c.title));
      pad.appendChild(h);
      if(c.subtitle){
        var sub = txt('div', theme.dark ? 'sub' : 'sub onlight', textOf(c.subtitle));
        if(theme.align === 'center') sub.style.marginLeft = 'auto', sub.style.marginRight = 'auto';
        pad.appendChild(sub);
      }
      return pad;
    },
    statement: function(c, theme, ctx){
      var pad = el('div','pad mid ' + (c.alignment === 'left' || theme.align !== 'center' ? 'left' : 'ctr'));
      pad.appendChild(txt('div','quote', textOf(c.text)));
      return pad;
    },
    full_image: function(c, theme, ctx){
      var pad = el('div','pad bot left');
      if(c.caption) pad.appendChild(txt('div','cap', textOf(c.caption)));
      return pad;
    },
    image_grid: function(c, theme, ctx){
      var cols = [2,3,4].indexOf(Number(c.columns)) >= 0 ? Number(c.columns) : 3;
      var n = cols * (cols >= 4 ? 1 : 2);
      var imgs = Array.isArray(c.images) ? c.images.slice(0, 8) : [];
      var g = el('div','gridfill g' + cols + (c.gap === 'tight' ? ' gap-tight' : ''));
      for(var i=0;i<Math.max(n, imgs.length || n);i++) g.appendChild(cell(imgs[i], 'frame', ctx));
      return g;
    },
    moodboard: function(c, theme, ctx){
      var imgs = Array.isArray(c.images) ? c.images.slice(0, 7) : [];
      var holder = el('div');
      var g = el('div','mood');
      for(var i=0;i<Math.max(7, imgs.length || 7);i++) g.appendChild(cell(imgs[i], 'ref', ctx));
      holder.appendChild(g);
      if(c.note) holder.appendChild(txt('div','moodnote', textOf(c.note)));
      return holder;
    },
    split: function(c, theme, ctx){
      var half = el('div','half' + (c.image_side === 'left' ? ' rev' : ''));
      var left = el('div','sideimg');
      left.appendChild(cell(c.image, 'image', ctx));
      var right = el('div','sidetext');
      if(c.heading) right.appendChild(txt('div', disp(theme,'h2'), textOf(c.heading)));
      if(c.body) right.appendChild(txt('div','body', textOf(c.body)));
      half.appendChild(left); half.appendChild(right);
      return half;
    },
    deliverables: function(c, theme, ctx){
      var items = Array.isArray(c.items) ? c.items.slice(0, 8) : [];
      var wrap = el('div','cards');
      if(c.heading) wrap.appendChild(txt('div', disp(theme,'h2'), textOf(c.heading)));
      var row = el('div','row c' + (items.length <= 2 ? 2 : (items.length === 3 ? 3 : 4)));
      items.forEach(function(it){
        var card = el('div','card');
        card.appendChild(txt('div','ct', textOf(it && it.title)));
        if(it && it.detail) card.appendChild(txt('div','cd', textOf(it.detail)));
        row.appendChild(card);
      });
      wrap.appendChild(row);
      return wrap;
    },
    crew: function(c, theme, ctx){
      var members = Array.isArray(c.members) ? c.members.slice(0, 8) : [];
      var wrap = el('div','cards');
      if(c.heading) wrap.appendChild(txt('div', disp(theme,'h2'), textOf(c.heading)));
      var row = el('div','row c' + (members.length <= 2 ? 2 : (members.length === 3 ? 3 : 4)));
      members.forEach(function(m){
        var card = el('div','card');
        card.appendChild(txt('div','role', textOf(m && m.role)));
        card.appendChild(txt('div','nm', textOf((m && m.name) || 'TBC')));
        row.appendChild(card);
      });
      wrap.appendChild(row);
      return wrap;
    },
    cta: function(c, theme, ctx){
      var pad = el('div','pad mid ' + (theme.align === 'center' ? 'ctr' : 'left'));
      if(c.heading){
        var h = txt('h2','h2 ctagrad', textOf(c.heading));
        h.style.fontSize = '68px';
        pad.appendChild(h);
      }
      if(c.body){
        var b = txt('div','body', textOf(c.body));
        b.style.maxWidth = '34ch';
        pad.appendChild(b);
      }
      if(c.show_agency_branding && ctx.agency && (ctx.agency.name || ctx.agency.logo)){
        var line = el('div','brandline');
        if(ctx.agency.logo){ var im = el('img'); im.src = ctx.agency.logo; im.alt=''; line.appendChild(im); }
        if(ctx.agency.name) line.appendChild(txt('div','nm2', ctx.agency.name));
        pad.appendChild(line);
      }
      return pad;
    },
    social_post: function(c, theme, ctx){
      var wrap = el('div','social');
      var phone = el('div','phone');
      var head = el('div','ph-head');
      var av = el('div','avatar');
      var avSrc = media(c.avatar);
      var avImg;
      if(avSrc){ avImg = el('img'); avImg.src = avSrc; avImg.alt=''; av.appendChild(avImg); }
      head.appendChild(av);
      head.appendChild(txt('div','who', (c.platform === 'facebook' ? (c.display_name || c.handle) : c.handle) || '@'));
      phone.appendChild(head);
      var pic = el('div','pic');
      var psrc = media(c.image);
      if(psrc){ var pim = el('img'); pim.src = psrc; pim.alt=''; pic.appendChild(pim); }
      else pic.appendChild(el('div','ph'));
      phone.appendChild(pic);
      var acts = txt('div','acts', c.platform === 'facebook' ? 'Like    Comment    Share' : 'Like    Comment    Share    Save');
      phone.appendChild(acts);
      if(c.caption) phone.appendChild(txt('div','capc', textOf(c.caption)));
      wrap.appendChild(phone);
      return wrap;
    },
  };

  // One section -> one slide.
  function buildSlide(section, ctx){
    var theme = ctx.theme;
    var c = (section && section.content) || {};
    var type = (section && section.type) || 'statement';
    var sl = el('div','sl' + (theme.dark ? '' : ' lite'));
    if(ctx.editable && section && section.id) sl.setAttribute('data-sec', String(section.id));
    else if(ctx.secIds && section && section.id) sl.setAttribute('data-sec', String(section.id));

    var stage = el('div','stage');
    var cv = el('div','cv');

    if(type === 'hero' || type === 'full_image' || type === 'split' || type === 'image_grid' || type === 'moodboard' || type === 'social_post'){
      // the builders above place their own imagery
    }
    if(type === 'hero') cv.appendChild(bleed(c.image, ctx));
    if(type !== 'hero') cv.appendChild(strip(section, ctx));
    if(type === 'hero' || type === 'cta'){ var m = marketing(ctx); if(m) cv.appendChild(m); }

    var inner = BUILD[type] ? BUILD[type](c, theme, ctx) : null;
    if(inner) cv.appendChild(inner);

    // full_image owns the bleed itself: it is the picture, edge to edge
    if(type === 'full_image'){
      var bl = el('div','bleed');
      var src = media(c.image);
      if(src){ var im2 = el('img'); im2.src = src; im2.alt=''; im2.loading='lazy'; bl.appendChild(im2); }
      else { bl.appendChild(el('div','ph')); if(ctx.preview) bl.appendChild(txt('div','phl','key frame')); }
      bl.appendChild(el('div','ov'));
      cv.insertBefore(bl, cv.firstChild);
    }
    stage.appendChild(cv);
    sl.appendChild(stage);
    return sl;
  }

  function fit(root){
    var scope = root || document;
    var slides = scope.querySelectorAll('.sl');
    for(var i=0;i<slides.length;i++){
      var sl = slides[i];
      var cv = sl.querySelector('.cv');
      if(!cv) continue;
      var w = sl.clientWidth || 0, h = sl.clientHeight || 0;
      if(!w || !h) continue;
      cv.style.transform = 'scale(' + Math.min(w/1280, h/720).toFixed(4) + ')';
    }
  }

  // Grid + present controller. cfg: { sections, theme, agency, preview, ids }
  function mount(cfg){
    var deck = document.getElementById('deck');
    if(!deck) return;
    var ctx = { theme: cfg.theme, agency: cfg.agency || {}, preview: !!cfg.preview, secIds: !!cfg.ids };
    var total = cfg.sections.length;
    deck.innerHTML = '';
    cfg.sections.forEach(function(s, i){
      ctx.n = i + 1; ctx.total = total;
      deck.appendChild(buildSlide(s, ctx));
    });
    deck.classList.remove('present');
    deck.classList.add('grid');
    fit(deck);

    var active = 0;
    var nav = null;

    function slides(){ return Array.prototype.slice.call(deck.querySelectorAll('.sl')); }
    function show(i){
      var all = slides();
      if(!all.length) return;
      active = Math.max(0, Math.min(all.length - 1, i));
      all.forEach(function(s, k){ s.classList.toggle('on', k === active); });
      var cnt = nav && nav.querySelector('.cnt');
      if(cnt) cnt.textContent = (active + 1) + ' / ' + all.length;
      fit(deck);
    }
    function present(on){
      if(on){
        if(!nav){
          nav = el('div','pnav');
          var prev = el('button', null, '\\u2039'); var next = el('button', null, '\\u203a');
          prev.onclick = function(e){ e.stopPropagation(); show(active - 1); };
          next.onclick = function(e){ e.stopPropagation(); show(active + 1); };
          nav.appendChild(prev);
          nav.appendChild(txt('span','cnt',''));
          nav.appendChild(next);
          document.body.appendChild(nav);
        }
        nav.style.display = 'flex';
        deck.classList.remove('grid');
        deck.classList.add('present');
        document.documentElement.style.overflow = 'hidden';
        show(active);
      } else {
        if(nav) nav.style.display = 'none';
        deck.classList.remove('present');
        deck.classList.add('grid');
        document.documentElement.style.overflow = '';
        fit(deck);
      }
      var bt = document.getElementById('presentBtn');
      if(bt) bt.textContent = on ? 'Grid' : 'Present';
    }
    deck.addEventListener('click', function(e){
      if(!deck.classList.contains('grid')) return;
      var sl = e.target.closest ? e.target.closest('.sl') : null;
      if(!sl) return;
      active = slides().indexOf(sl);
      present(true);
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape') return present(false);
      if(!deck.classList.contains('present')) return;
      if(e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); show(active + 1); }
      if(e.key === 'ArrowLeft') { e.preventDefault(); show(active - 1); }
    });
    var bt = document.getElementById('presentBtn');
    if(bt) bt.onclick = function(){ present(!deck.classList.contains('present')); };
    var sx = null;
    deck.addEventListener('touchstart', function(e){ sx = e.touches[0].clientX; }, {passive:true});
    deck.addEventListener('touchend', function(e){
      if(sx === null || !deck.classList.contains('present')) return;
      var dx = e.changedTouches[0].clientX - sx;
      if(Math.abs(dx) > 45) show(active + (dx < 0 ? 1 : -1));
      sx = null;
    }, {passive:true});

    window.addEventListener('resize', function(){ fit(deck); });
    return { fit: function(){ fit(deck); }, present: present };
  }

  window.Deck = { mount: mount, buildSlide: buildSlide, fit: fit, labels: LABELS };
})();
`;
}

function safeJson(value) {
  return JSON.stringify(value == null ? null : value).replace(/</g, '\\u003c');
}

function parseSections(sections) {
  const out = [];
  for (const s of sections || []) {
    try {
      const content = typeof s.content === 'string' ? JSON.parse(s.content || '{}') : (s.content || {});
      if (!content || typeof content !== 'object' || Array.isArray(content)) continue;
      out.push({ id: s.id, type: s.type, content });
    } catch (_) { /* a malformed row is skipped, not rendered as junk */ }
  }
  return out;
}

// ── Full deck page (public link + panel preview) ────────────────────────────
// opts: { theme, accent, agency, isPreview, origin }

function renderDeckPage(presentation, sections, opts = {}) {
  const theme = themeFor(opts.theme || presentation.theme, opts.accent || presentation.accent_color);
  const payload = parseSections(sections);
  const title = presentation.title || 'Director Treatment';
  const agency = opts.agency || {};
  const client = {
    sections: payload,
    theme: theme,
    agency: { name: agency.name || null, logo: agency.logo || null },
    preview: !!opts.isPreview,
    ids: !!opts.isPreview,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escAttr(title)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{background:${theme.bg}}
body{color:${theme.ink};font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
header.deckbar{position:sticky;top:0;z-index:70;display:flex;align-items:center;gap:14px;padding:14px 22px;background:${theme.bg};border-bottom:1px solid ${theme.line}}
.deckbar .lede{font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:${theme.accent}}
.deckbar h1{font-size:16px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.deckbar .sp{flex:1}
.deckbar button{font:inherit;font-size:13px;color:${theme.ink};background:transparent;border:1px solid ${theme.line};border-radius:999px;padding:8px 16px;cursor:pointer}
.deckbar button:hover{border-color:${theme.accent};color:${theme.accent}}
.deck-root{${themeVars(theme)}}
${deckCss()}
</style>
</head>
<body>
<header class="deckbar">
  <div>
    <div class="lede">Director Treatment</div>
    <h1>${escAttr(title)}</h1>
  </div>
  <span class="sp"></span>
  <button id="presentBtn" type="button">Present</button>
</header>
<div class="deck-root"><div class="deck grid" id="deck"></div></div>
<script>${deckJs()}</script>
<script>
(function(){
  var cfg = ${safeJson(client)};
  var deck = window.Deck.mount(cfg);
  var host = document.querySelector('.deck-root');
  host.style.setProperty('--bg', cfg.theme.bg);
  host.style.setProperty('--ink', cfg.theme.ink);
  host.style.setProperty('--mut', cfg.theme.muted);
  host.style.setProperty('--accent', cfg.theme.accent);
  host.style.setProperty('--card', cfg.theme.card);
  host.style.setProperty('--line', cfg.theme.line);
  deck.fit();
  window.addEventListener('load', function(){ deck.fit(); });
})();
</script>
</body>
</html>`;
}

function escAttr(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { THEMES, LABELS, themeFor, themeVars, deckCss, deckJs, renderDeckPage, parseSections, DEFAULT_THEME };
