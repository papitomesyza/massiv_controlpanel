// Shared server-side renderer for pitch presentations (V2 — Apple presentation grade).
// Used by BOTH the public route (GET /p/:slug) and the builder preview endpoint
// (GET /api/pitches/:id/preview) so preview is pixel-identical. The preview
// endpoint passes { isPreview: true }; the public route never does — empty image
// slots render placeholders ONLY in preview and render nothing on the public page.
//
// Output is a fully self-contained HTML document: all CSS and JS inline, zero
// external requests except /p-media images. Every piece of user text goes
// through esc() — no exceptions, this is a public page. Anything not escaped is
// whitelist- or numeric-gated.

const SECTION_TYPES = [
  'hero', 'statement', 'full_image', 'image_grid', 'split',
  'moodboard', 'deliverables', 'crew', 'cta', 'social_post',
];

const TONES = ['dark', 'ink', 'light', 'white'];

// Scene palette. light:false scenes may carry ambient orbs.
const SCENES = {
  dark:  { bg: '#000000', text: '#f5f5f7', dark: true },
  ink:   { bg: '#0a0a0a', text: '#f5f5f7', dark: true },
  light: { bg: '#f5f5f7', text: '#1d1d1f', dark: false },
  white: { bg: '#ffffff', text: '#1d1d1f', dark: false },
};

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Media filenames are generated server-side but a tampered DB row must never
// break out of /p-media/ — strip anything unsafe.
function mediaSrc(filename) {
  if (!filename || typeof filename !== 'string') return null;
  if (/[/\\]/.test(filename) || filename.includes('..')) return null;
  return `/p-media/${encodeURIComponent(filename)}`;
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function safeColor(c) {
  return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : '#723CEB';
}

// ── Scene resolution ──────────────────────────────────────────────────────────
// Auto: image-led sections resolve dark; text/data sections alternate
// light/white in order of appearance; cta resolves ink. Explicit theme wins.
// Then a dedupe pass: adjacent identical tones flip the second within its pair
// so no two neighbors merge into one flat band.

const IMAGE_LED = new Set(['hero', 'full_image', 'image_grid', 'moodboard', 'split', 'social_post']);
const TONE_PAIR = { dark: 'ink', ink: 'dark', light: 'white', white: 'light' };

function resolveScenes(entries) {
  let textFlip = 0;
  const tones = entries.map(({ type, content }) => {
    if (TONES.includes(content.theme)) return content.theme;
    if (type === 'cta') return 'ink';
    if (IMAGE_LED.has(type)) return 'dark';
    return (textFlip++ % 2 === 0) ? 'light' : 'white';
  });
  for (let i = 1; i < tones.length; i++) {
    if (tones[i] === tones[i - 1]) tones[i] = TONE_PAIR[tones[i]];
  }
  return tones;
}

// A section that would render nothing on the public route is dropped BEFORE
// scene resolution so the alternation stays clean.
function isRenderable(type, c, isPreview) {
  if (isPreview) return true;
  const liveImages = arr => (Array.isArray(arr) ? arr.filter(i => mediaSrc(i)).length : 0);
  if (type === 'full_image') return !!mediaSrc(c.image);
  if (type === 'social_post') return !!mediaSrc(c.image);
  if (type === 'image_grid') return liveImages(c.images) > 0;
  if (type === 'moodboard') return liveImages(c.images) > 0;
  return true;
}

// Image with aspect-ratio placeholder so lazy loading never causes jumps.
// Empty slots: dashed placeholder in preview, nothing on the public page.
function imgBox(filename, { ratio = '3 / 2', lazy = true, radius = 16, isPreview = false } = {}) {
  const src = mediaSrc(filename);
  if (!src) {
    if (!isPreview) return '';
    return `<div class="imgbox ph" style="aspect-ratio:${ratio};border-radius:${radius}px"></div>`;
  }
  return `<div class="imgbox" style="aspect-ratio:${ratio};border-radius:${radius}px">` +
    `<img src="${src}" alt=""${lazy ? ' loading="lazy"' : ''}></div>`;
}

// ── Inline SVG glyphs (no external assets, no brand marks) ───────────────────

const SVG = {
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.9-10-9.6C.5 8 2.6 4.5 6.2 4.5c2.1 0 3.9 1.2 4.8 2.9.9-1.7 2.7-2.9 4.8-2.9 3.6 0 5.7 3.5 4.2 6.9C19.5 16.1 12 21 12 21z"/></svg>',
  comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.5 0-2.9-.3-4.1-1L3 20l1.3-4.2A8.1 8.1 0 0 1 3.5 11.5 8.4 8.4 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 3 9.2 12.8M22 3l-7.5 18-3.3-8.2L3 9.5 22 3z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21V3z"/></svg>',
  thumb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9M7 11l4-7.5a2 2 0 0 1 2 2V9h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7M7 11H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3"/></svg>',
  fbShare: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5v4C6 10 4 15 3 19c2.5-3 5.5-4.5 10-4.5V19l8-7-8-7z"/></svg>',
  burstHeart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.9-10-9.6C.5 8 2.6 4.5 6.2 4.5c2.1 0 3.9 1.2 4.8 2.9.9-1.7 2.7-2.9 4.8-2.9 3.6 0 5.7 3.5 4.2 6.9C19.5 16.1 12 21 12 21z"/></svg>',
};

// ── Section renderers ─────────────────────────────────────────────────────────
// Each receives (content, ctx) where ctx = { scene, accent, isPreview, agency, isFirst }.

function renderHero(c, ctx) {
  const src = mediaSrc(c.image);
  const ov = clampNum(c.overlay_strength, 0, 100, 45) / 100;
  const bg = src
    ? `<img class="hero-img" src="${src}" alt="">` +
      `<div class="hero-overlay" style="--ov1:${(ov * 0.6).toFixed(3)};--ov2:${ov.toFixed(3)}"></div>`
    : '<div class="hero-glow"></div>';

  // Agency watermark, from the same settings the CTA opts into. The logo is a
  // stored data URI, so this adds no external request.
  const ag = ctx.agency || {};
  let mark = '';
  if (ag.logo) mark = `<img class="hero-mark-logo" src="${esc(ag.logo)}" alt="">`;
  else if (ag.name) mark = `<span class="hero-mark-name">${esc(ag.name)}</span>`;

  return `
  ${bg}
  ${mark ? `<div class="hero-mark" aria-hidden="true">${mark}</div>` : ''}
  <div class="hero-inner" data-reveal>
    ${c.eyebrow ? `<p class="hero-eyebrow" style="color:${ctx.accent}">${esc(c.eyebrow)}</p>` : ''}
    <h1 class="hero-title">${esc(c.title)}</h1>
    ${c.subtitle ? `<p class="hero-sub">${esc(c.subtitle)}</p>` : ''}
  </div>
  <div class="hero-cue" aria-hidden="true"></div>`;
}

function renderStatement(c) {
  const align = c.alignment === 'left' ? 'left' : 'center';
  return `
  <div class="statement ${align === 'left' ? 'st-left' : 'st-center'}">
    <p class="statement-text" data-reveal>${esc(c.text)}</p>
  </div>`;
}

function renderFullImage(c, ctx) {
  const box = imgBox(c.image, { ratio: '16 / 9', radius: 0, isPreview: ctx.isPreview });
  if (!box) return '';
  return `
  <figure data-reveal class="full-figure">
    <div class="fullbleed">${box}</div>
    ${c.caption ? `<figcaption class="fullcap">${esc(c.caption)}</figcaption>` : ''}
  </figure>`;
}

function renderImageGrid(c, ctx) {
  const columns = [2, 3, 4].includes(Number(c.columns)) ? Number(c.columns) : 3;
  const gap = c.gap === 'tight' ? 'tight' : 'normal';
  let images = Array.isArray(c.images) ? c.images.slice(0, 8) : [];
  if (!ctx.isPreview) images = images.filter(i => mediaSrc(i));
  else if (images.length === 0) images = new Array(columns).fill('');
  const cells = images
    .map((img, i) => {
      const box = imgBox(img, { ratio: '4 / 5', radius: 16, isPreview: ctx.isPreview });
      return box ? `<div data-reveal style="--d:${(i * 0.07).toFixed(2)}s">${box}</div>` : '';
    })
    .filter(Boolean)
    .join('');
  return `<div class="grid cols-${columns} gap-${gap}">${cells}</div>`;
}

function renderSplit(c, ctx) {
  const side = c.image_side === 'left' ? 'left' : 'right';
  const box = imgBox(c.image, { ratio: '4 / 5', radius: 18, isPreview: ctx.isPreview });
  const text = `
    <div class="split-text" data-reveal>
      ${c.heading ? `<h2 class="h2">${esc(c.heading)}</h2>` : ''}
      ${c.body ? `<p class="body">${esc(c.body)}</p>` : ''}
    </div>`;
  if (!box) {
    // Image-less split degrades to a single clean text column on the public page
    return `<div class="split-solo">${text}</div>`;
  }
  return `
  <div class="split-inner img-${side}">
    ${text}
    <div class="split-img" data-reveal style="--d:.1s">${box}</div>
  </div>`;
}

function renderMoodboard(c, ctx) {
  let images = Array.isArray(c.images) ? c.images.slice(0, 12) : [];
  if (!ctx.isPreview) images = images.filter(i => mediaSrc(i));
  else if (images.length === 0) images = new Array(6).fill('');
  const cells = images
    .map((img, i) => {
      const box = imgBox(img, { ratio: '1 / 1', radius: 14, isPreview: ctx.isPreview });
      return box ? `<div data-reveal style="--d:${(i * 0.05).toFixed(2)}s">${box}</div>` : '';
    })
    .filter(Boolean)
    .join('');
  return `
  <div class="mood-grid">${cells}</div>
  ${c.note ? `<p class="mood-note" data-reveal>${esc(c.note)}</p>` : ''}`;
}

function renderDeliverables(c) {
  const items = Array.isArray(c.items) ? c.items : [];
  const cards = items.map((it, i) => `
    <div class="dcard" data-reveal style="--d:${(i * 0.08).toFixed(2)}s">
      <div class="dcard-title">${esc(it && it.title)}</div>
      ${it && it.detail ? `<div class="dcard-detail">${esc(it.detail)}</div>` : ''}
    </div>`).join('');
  return `
  ${c.heading ? `<h2 class="h2" data-reveal>${esc(c.heading)}</h2>` : ''}
  <div class="card-grid">${cards}</div>`;
}

function renderCrew(c) {
  const members = Array.isArray(c.members) ? c.members : [];
  const cards = members.map((m, i) => `
    <div class="dcard" data-reveal style="--d:${(i * 0.06).toFixed(2)}s">
      <span class="pill">${esc(m && m.role)}</span>
      <div class="crew-name">${esc((m && m.name) || 'TBC')}</div>
    </div>`).join('');
  return `
  ${c.heading ? `<h2 class="h2" data-reveal>${esc(c.heading)}</h2>` : ''}
  <div class="card-grid crew-grid">${cards}</div>`;
}

function renderCta(c, ctx) {
  let branding = '';
  if (c.show_agency_branding && ctx.agency && (ctx.agency.name || ctx.agency.logo)) {
    branding = `
    <div class="cta-brand" data-reveal style="--d:.2s">
      ${ctx.agency.logo ? `<img class="cta-logo" src="${esc(ctx.agency.logo)}" alt="">` : ''}
      ${ctx.agency.name ? `<span class="cta-agency">${esc(ctx.agency.name)}</span>` : ''}
    </div>`;
  }
  const grad = `background:linear-gradient(115deg,${ctx.scene.text} 30%,${ctx.accent});-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent`;
  return `
  <div class="cta">
    ${c.heading ? `<h2 class="cta-heading" data-reveal style="${grad}">${esc(c.heading)}</h2>` : ''}
    ${c.body ? `<p class="cta-body" data-reveal style="--d:.1s">${esc(c.body)}</p>` : ''}
    ${branding}
  </div>`;
}

function renderSocialPost(c, ctx) {
  const media = imgBox(c.image, { ratio: '4 / 5', radius: 0, isPreview: ctx.isPreview });
  if (!media) return '';
  const isFb = c.platform === 'facebook';
  const handle = esc(c.handle);
  const displayName = esc(c.display_name);
  const avatarSrc = mediaSrc(c.avatar);
  const avatar = avatarSrc
    ? `<img class="sp-ava" src="${avatarSrc}" alt="" loading="lazy">`
    : `<div class="sp-ava sp-ava-ph">${esc(String(c.handle || '?').replace('@', '').charAt(0).toUpperCase())}</div>`;

  const header = isFb
    ? `<div class="sp-names"><span class="sp-handle">${displayName || handle}</span><span class="sp-subname">${handle}</span></div>`
    : `<div class="sp-names"><span class="sp-handle">${handle}</span></div>`;

  const actions = isFb
    ? `<div class="sp-fb-actions">
        <span class="sp-fb-act sp-heart">${SVG.thumb}<span>Like</span></span>
        <span class="sp-fb-act">${SVG.comment}<span>Comment</span></span>
        <span class="sp-fb-act">${SVG.fbShare}<span>Share</span></span>
      </div>`
    : `<div class="sp-actions">
        <span class="sp-heart">${SVG.heart}</span>
        <span>${SVG.comment}</span>
        <span>${SVG.share}</span>
        <span class="sp-bookmark">${SVG.bookmark}</span>
      </div>`;

  return `
  <div class="sp-card${isFb ? ' sp-fb' : ''}" data-reveal>
    <div class="sp-head">${avatar}${header}<span class="sp-dots">${SVG.dots}</span></div>
    <div class="sp-media">
      ${media}
      <div class="sp-burst">${SVG.burstHeart}</div>
    </div>
    ${actions}
    ${c.likes_label ? `<div class="sp-likes">${esc(c.likes_label)}</div>` : ''}
    ${c.caption ? `<div class="sp-caption"><span class="sp-handle">${handle}</span>${esc(c.caption)}</div>` : ''}
  </div>`;
}

const RENDERERS = {
  hero: renderHero,
  statement: renderStatement,
  full_image: renderFullImage,
  image_grid: renderImageGrid,
  split: renderSplit,
  moodboard: renderMoodboard,
  deliverables: renderDeliverables,
  crew: renderCrew,
  cta: renderCta,
  social_post: renderSocialPost,
};

// Sections that render edge-to-edge (no .sec horizontal padding / max-width)
const FULL_BLEED = new Set(['full_image']);

// ── Document CSS ─────────────────────────────────────────────────────────────
// Type system: weights 700 (hero + CTA headlines), 600 (headings, data
// emphasis), 400 (body), 300 (large subheads) — nothing else. Tracking scales
// with size, never positive above caption sizes. Body 17px/1.47, left-aligned.

function buildCss() {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:#000;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:17px;font-weight:400;line-height:1.47;letter-spacing:-0.003em;text-align:left;-webkit-font-smoothing:antialiased;overflow-x:hidden}
img{display:block;max-width:100%}
/* scenes */
.scene{position:relative;overflow:hidden}
.s-dark{background:#000000;color:#f5f5f7;--mut:rgba(245,245,247,0.58);--card:#1d1d1f;--pill:rgba(245,245,247,0.08);--grad-lo:rgba(245,245,247,0.6)}
.s-ink{background:#0a0a0a;color:#f5f5f7;--mut:rgba(245,245,247,0.58);--card:#1d1d1f;--pill:rgba(245,245,247,0.08);--grad-lo:rgba(245,245,247,0.6)}
.s-light{background:#f5f5f7;color:#1d1d1f;--mut:rgba(29,29,31,0.56);--card:#ffffff;--pill:rgba(29,29,31,0.06);--grad-lo:rgba(29,29,31,0.55)}
.s-white{background:#ffffff;color:#1d1d1f;--mut:rgba(29,29,31,0.56);--card:#f5f5f7;--pill:rgba(29,29,31,0.06);--grad-lo:rgba(29,29,31,0.55)}
.sec{position:relative;z-index:1;max-width:1140px;margin:0 auto;padding:clamp(84px,15vh,190px) clamp(22px,6vw,88px)}
.sec-bleed{max-width:none;padding:clamp(44px,9vh,120px) 0}
.content{position:relative;z-index:1}
/* type */
.h2{font-size:clamp(1.7rem,3.6vw,2.65rem);font-weight:600;letter-spacing:-0.016em;line-height:1.12;margin-bottom:26px}
.body{font-size:17px;color:var(--mut);line-height:1.6;max-width:34em}
.lead{font-size:clamp(20px,2vw,24px);font-weight:300;letter-spacing:-0.008em}
/* hero */
.hero{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;text-align:center}
.hero-pin{position:sticky;top:0;z-index:0}
.hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.hero-overlay{position:absolute;inset:0;z-index:1;background:radial-gradient(ellipse 95% 70% at 50% 62%,rgba(0,0,0,var(--ov1,0.3)),transparent 78%),linear-gradient(to bottom,rgba(0,0,0,calc(var(--ov2,0.45)*0.5)),rgba(0,0,0,var(--ov2,0.45)) 90%)}
.hero-glow{position:absolute;inset:0;z-index:0;background:radial-gradient(ellipse 72% 52% at 50% 38%,rgba(255,255,255,0.07),transparent 66%),#000}
.hero-inner{position:relative;z-index:2;padding:28px;max-width:1080px}
.hero-eyebrow{font-size:13px;font-weight:600;letter-spacing:0.26em;text-transform:uppercase;margin-bottom:26px}
.hero-title{font-size:clamp(2.9rem,8.5vw,7rem);font-weight:700;letter-spacing:-0.022em;line-height:1.0;color:#f5f5f7}
.hero-sub{margin:22px auto 0;font-size:clamp(1.1rem,2.1vw,1.5rem);font-weight:300;letter-spacing:-0.008em;color:rgba(245,245,247,0.74);max-width:34em}
.hero-cue{position:absolute;bottom:26px;left:50%;width:1px;height:46px;z-index:2;background:linear-gradient(to bottom,transparent,rgba(255,255,255,0.65))}
.hero-mark{position:absolute;top:clamp(20px,3.4vh,38px);left:0;right:0;z-index:3;display:flex;justify-content:center;pointer-events:none;opacity:.6}
.hero-mark-logo{height:clamp(18px,2.4vh,26px);width:auto;filter:brightness(0) invert(1)}
.hero-mark-name{font-size:11px;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;color:rgba(245,245,247,0.85)}
/* statement — display element with gradient fill */
.statement{padding:clamp(6px,1vh,20px) 0}
.st-center{text-align:center}
.st-center .statement-text{margin:0 auto}
.st-left{text-align:left}
.statement-text{font-size:clamp(1.8rem,4.8vw,3.5rem);font-weight:600;letter-spacing:-0.018em;line-height:1.14;max-width:21em;background:linear-gradient(180deg,currentColor,var(--grad-lo));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
/* images */
.imgbox{overflow:hidden;background:rgba(127,127,127,0.08);width:100%}
.imgbox img{width:100%;height:100%;object-fit:cover}
.imgbox.ph{border:1.5px dashed var(--mut);background:none}
.fullbleed{width:100%}
.fullbleed .imgbox{border-radius:0}
.fullcap{max-width:1140px;margin:16px auto 0;padding:0 clamp(22px,6vw,88px);font-size:13px;letter-spacing:0.05em;text-transform:uppercase;color:var(--mut)}
/* grid */
.grid{display:grid}
.cols-2{grid-template-columns:repeat(2,1fr)}
.cols-3{grid-template-columns:repeat(3,1fr)}
.cols-4{grid-template-columns:repeat(4,1fr)}
.gap-tight{column-gap:8px;row-gap:11px}
.gap-normal{column-gap:clamp(14px,1.8vw,20px);row-gap:clamp(18px,2.4vw,28px)}
/* split */
.split-inner{display:grid;grid-template-columns:1fr 1fr;gap:clamp(30px,5vw,76px);align-items:center}
.split-inner.img-left .split-text{order:2}
.split-inner.img-left .split-img{order:1}
.split-solo{max-width:640px}
/* moodboard */
.mood-grid{display:grid;grid-template-columns:repeat(3,1fr);column-gap:10px;row-gap:14px}
.mood-note{margin-top:28px;font-size:clamp(20px,2vw,23px);font-weight:300;letter-spacing:-0.008em;color:var(--mut);max-width:34em}
/* cards — borderless, no shadows */
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:clamp(14px,2vw,22px)}
.dcard{background:var(--card);border-radius:20px;padding:clamp(22px,3vw,32px)}
.dcard-title{font-size:19px;font-weight:600;letter-spacing:-0.01em;line-height:1.3}
.dcard-detail{margin-top:8px;color:var(--mut);font-size:15px;line-height:1.5}
.pill{display:inline-block;padding:4px 12px;border-radius:999px;background:var(--pill);font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--mut)}
.crew-name{margin-top:12px;font-size:18px;font-weight:600;letter-spacing:-0.01em}
/* cta */
.cta{text-align:center;padding:clamp(8px,2vh,30px) 0}
.cta-heading{font-size:clamp(2rem,5.6vw,4.4rem);font-weight:700;letter-spacing:-0.022em;line-height:1.04}
.cta-body{margin:24px auto 0;font-size:clamp(20px,2vw,23px);font-weight:300;letter-spacing:-0.008em;color:var(--mut);max-width:30em}
.cta-brand{margin-top:clamp(48px,8vh,88px);display:flex;flex-direction:column;align-items:center;gap:14px}
.cta-logo{max-height:42px;width:auto}
.cta-agency{font-size:12px;font-weight:600;letter-spacing:0.24em;text-transform:uppercase;color:var(--mut)}
/* social post — pixel-faithful dark-mode mockup */
.sp-card{width:min(430px,88vw);margin:0 auto;background:#1d1d1f;border-radius:22px;overflow:hidden;color:#f5f5f7;text-align:left}
.sp-head{display:flex;align-items:center;gap:10px;padding:12px 14px}
.sp-ava{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#3a3a3c;flex-shrink:0}
.sp-ava-ph{display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:rgba(245,245,247,0.7)}
.sp-names{display:flex;flex-direction:column;line-height:1.25;min-width:0}
.sp-handle{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-subname{font-size:12px;color:rgba(245,245,247,0.55)}
.sp-dots{margin-left:auto;flex-shrink:0}
.sp-dots svg{width:22px;height:22px}
.sp-media{position:relative;background:#0a0a0a;cursor:pointer;-webkit-user-select:none;user-select:none}
.sp-media .imgbox{border-radius:0 !important}
.sp-actions{display:flex;gap:16px;align-items:center;padding:12px 14px 4px}
.sp-actions svg,.sp-fb-act svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linejoin:round;stroke-linecap:round}
.sp-actions .sp-heart svg{transition:fill .2s,stroke .2s}
.sp-bookmark{margin-left:auto}
.sp-card.liked .sp-heart svg{fill:#ff3040;stroke:#ff3040}
.sp-fb-actions{display:flex;padding:8px 6px}
.sp-fb-act{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:8px 0;font-size:13px;font-weight:600;color:rgba(245,245,247,0.62)}
.sp-fb-act svg{width:20px;height:20px}
.sp-likes{padding:8px 14px 0;font-size:14px;font-weight:600}
.sp-caption{padding:6px 14px 16px;font-size:14px;line-height:1.42;color:rgba(245,245,247,0.92)}
.sp-caption .sp-handle{margin-right:6px}
.sp-burst{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2}
.sp-burst svg{width:96px;height:96px;fill:#fff;stroke:none;opacity:0;transform:scale(0.4)}
.sp-burst.go svg{animation:spBurst .8s cubic-bezier(.17,.89,.32,1.28)}
@keyframes spBurst{0%{opacity:0;transform:scale(.4)}22%{opacity:.95;transform:scale(1.14)}55%{opacity:.95;transform:scale(1)}100%{opacity:0;transform:scale(1.18)}}
/* ambient orbs — dark/ink scenes only, motion only */
.orb{display:none;position:absolute;width:44vw;max-width:540px;aspect-ratio:1;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0}
.orb-a{top:-12%;left:-8%;background:radial-gradient(circle,rgba(255,255,255,0.05),transparent 62%)}
.orb-b{bottom:-14%;right:-6%;background:radial-gradient(circle,rgba(255,255,255,0.04),transparent 62%)}
html.motion .orb{display:block;animation:orbDrift 26s ease-in-out infinite alternate}
html.motion .orb-b{animation-delay:-13s}
@keyframes orbDrift{from{transform:translate3d(0,0,0)}to{transform:translate3d(6vw,4vh,0)}}
/* motion — opt-in via html.motion; default (no JS / reduced) is fully visible */
html.motion [data-reveal]{opacity:0;transform:translateY(24px);filter:blur(10px);transition:opacity .9s cubic-bezier(.22,.61,.36,1),transform .9s cubic-bezier(.22,.61,.36,1),filter .9s cubic-bezier(.22,.61,.36,1);transition-delay:var(--d,0s)}
html.motion [data-reveal].in{opacity:1;transform:none;filter:none}
html.motion [data-reveal] .imgbox img{transform:scale(1.05);transition:transform 1.35s cubic-bezier(.22,.61,.36,1);transition-delay:var(--d,0s)}
html.motion [data-reveal].in .imgbox img{transform:scale(1)}
html.motion .hero-img{transform:scale(1.08);will-change:transform}
html.motion .hero-pin{will-change:opacity}
html.motion .hero-cue{animation:cuePulse 2.3s ease-in-out infinite}
@keyframes cuePulse{0%,100%{opacity:.35;transform:scaleY(.65);transform-origin:top}50%{opacity:1;transform:scaleY(1)}}
/* reduced motion — belt and suspenders on top of the JS early-return */
@media (prefers-reduced-motion: reduce){
  html.motion [data-reveal],html.motion [data-reveal] .imgbox img{opacity:1 !important;transform:none !important;filter:none !important;transition:none !important}
  html.motion .orb{display:none !important;animation:none !important}
  html.motion .hero-cue{animation:none !important}
  html.motion .hero-img{transform:none !important}
  .sp-burst{display:none !important}
}
/* small screens */
@media (max-width:640px){
  .cols-3,.cols-4{grid-template-columns:repeat(2,1fr)}
  .mood-grid{grid-template-columns:repeat(2,1fr)}
  .split-inner{grid-template-columns:1fr;gap:26px}
  .split-inner.img-left .split-text{order:1}
  .split-inner.img-left .split-img{order:2}
}
`;
}

// ── Client JS ────────────────────────────────────────────────────────────────
// One IntersectionObserver for reveals, one passive scroll listener + rAF for
// hero parallax/fade, double-tap heart for social posts. All motion is gated
// behind the html.motion class, which is never added under reduced motion.

const CLIENT_JS = `
(function(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Social post double-tap: heart always fills; burst is motion-only.
  document.querySelectorAll('.sp-card').forEach(function(card){
    var media = card.querySelector('.sp-media');
    if (!media) return;
    var burst = card.querySelector('.sp-burst');
    var like = function(){
      card.classList.add('liked');
      if (!reduce && burst) { burst.classList.remove('go'); void burst.offsetWidth; burst.classList.add('go'); }
    };
    media.addEventListener('dblclick', like);
    var lastTap = 0;
    media.addEventListener('touchend', function(){
      var now = Date.now();
      if (now - lastTap < 300) like();
      lastTap = now;
    }, { passive: true });
  });

  if (reduce || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('motion');

  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('[data-reveal]').forEach(function(el){ io.observe(el); });

  // Hero parallax (~quarter scroll speed) + fade as the first section slides over.
  var hero = document.querySelector('.hero-pin');
  if (hero) {
    var heroImg = hero.querySelector('.hero-img');
    var ticking = false;
    var update = function(){
      ticking = false;
      var y = window.scrollY || window.pageYOffset || 0;
      var h = hero.offsetHeight || 1;
      if (y > h + 60) return;
      if (heroImg) heroImg.style.transform = 'translate3d(0,' + (y * 0.24).toFixed(1) + 'px,0) scale(1.08)';
      hero.style.opacity = Math.max(0, 1 - y / (h * 0.9)).toFixed(3);
    };
    window.addEventListener('scroll', function(){
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }
})();
`;

// ── Document assembly ─────────────────────────────────────────────────────────

// presentation: row from presentations table
// sections: rows from presentation_sections ordered by sort_order (content = JSON string)
// opts: { origin (absolute base URL for og:image), agency: { name, logo }, isPreview }
function renderPresentation(presentation, sections, opts = {}) {
  const accent = safeColor(presentation.accent_color);
  const isPreview = !!opts.isPreview;

  const parsed = [];
  for (const s of sections) {
    if (!RENDERERS[s.type]) {
      console.warn(`Pitch render: unknown section type "${s.type}" (section ${s.id}) — skipped`);
      continue;
    }
    try {
      const content = JSON.parse(s.content || '{}');
      if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('not an object');
      if (!isRenderable(s.type, content, isPreview)) continue;
      parsed.push({ id: s.id, type: s.type, content });
    } catch (err) {
      console.warn(`Pitch render: malformed content in section ${s.id} (${s.type}) — skipped: ${err.message}`);
    }
  }

  const tones = resolveScenes(parsed);

  const firstHero = parsed.length > 0 && parsed[0].type === 'hero' ? parsed[0] : null;
  const firstStatement = parsed.find(p => p.type === 'statement');
  const ogDescription = (firstStatement && firstStatement.content.text) ||
    (firstHero && firstHero.content.subtitle) || '';
  const heroImageSrc = firstHero ? mediaSrc(firstHero.content.image) : null;
  const ogImage = heroImageSrc && opts.origin ? `${opts.origin}${heroImageSrc}` : null;

  // Ambient orbs: at most two per page, on dark/ink scenes whose content
  // doesn't bury them under imagery — reserved for the CTA plus one more.
  const ORB_OK = new Set(['statement', 'deliverables', 'crew', 'split', 'cta']);
  let orbBudget = 1; // one non-cta orb; cta always gets one when dark/ink

  const bodyParts = [];
  parsed.forEach((p, i) => {
    const tone = tones[i];
    const scene = SCENES[tone];
    const ctx = { scene, accent, isPreview, agency: opts.agency, isFirst: i === 0 };
    const inner = RENDERERS[p.type](p.content, ctx);
    if (!inner) return;

    // Preview-only anchor so the builder can scroll to the section being
    // edited. Numeric id, emitted through the same gating as everything else,
    // and never present in public HTML.
    const anchor = isPreview && Number.isFinite(Number(p.id)) ? ` data-sec="${Number(p.id)}"` : '';

    if (p.type === 'hero') {
      const pin = i === 0 ? ' hero-pin' : '';
      bodyParts.push(`<section class="scene s-${tone} hero${pin}"${anchor}>${inner}</section>`);
      if (i === 0) bodyParts.push('<div class="content">');
      return;
    }

    let orb = '';
    if (scene.dark && ORB_OK.has(p.type)) {
      if (p.type === 'cta') {
        orb = '<div class="orb orb-b" aria-hidden="true"></div>';
      } else if (orbBudget > 0) {
        orbBudget--;
        orb = '<div class="orb orb-a" aria-hidden="true"></div>';
      }
    }
    const secClass = FULL_BLEED.has(p.type) ? 'sec sec-bleed' : 'sec';
    bodyParts.push(`<section class="scene s-${tone}"${anchor}>${orb}<div class="${secClass}">${inner}</div></section>`);
  });
  if (firstHero) bodyParts.push('</div>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(presentation.title)}</title>
<meta property="og:title" content="${esc(presentation.title)}">
${ogDescription ? `<meta property="og:description" content="${esc(ogDescription)}">` : ''}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta property="og:type" content="website">
<style>${buildCss()}</style>
</head>
<body>
<main>
${bodyParts.join('\n')}
</main>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

module.exports = { renderPresentation, SECTION_TYPES };
