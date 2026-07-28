// Shared server-side renderer for pitch presentations.
// Used by BOTH the public route (GET /p/:slug) and the builder preview
// endpoint (GET /api/pitches/:id/preview) so preview is pixel-identical.
//
// Output is a fully self-contained HTML document: all CSS and JS inline,
// zero external requests except /p-media images. Every piece of user text
// goes through esc() — no exceptions, this is a public page.

const SECTION_TYPES = [
  'hero', 'statement', 'full_image', 'image_grid', 'split',
  'moodboard', 'deliverables', 'crew', 'cta',
];

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Media filenames are generated server-side (timestamp-random-web.jpg) but a
// tampered DB row must never break out of /p-media/ — strip anything unsafe.
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

// Image tag with aspect-ratio placeholder wrapper so nothing jumps while
// lazy images load. Hero is above the fold; everything else lazy-loads.
function imgBox(filename, { ratio = '3 / 2', lazy = true, cls = '' } = {}) {
  const src = mediaSrc(filename);
  if (!src) {
    return `<div class="imgbox ph ${cls}" style="aspect-ratio:${ratio}"></div>`;
  }
  return `<div class="imgbox ${cls}" style="aspect-ratio:${ratio}">` +
    `<img src="${src}" alt=""${lazy ? ' loading="lazy"' : ''} class="settle"></div>`;
}

// ── Section renderers ─────────────────────────────────────────────────────────

function renderHero(c, { isFirst }) {
  const overlay = clampNum(c.overlay_strength, 0, 100, 45) / 100;
  const src = mediaSrc(c.image);
  return `
<section class="hero${isFirst ? ' hero-pin' : ''}">
  ${src ? `<img class="hero-img" src="${src}" alt="">` : '<div class="hero-img hero-img-ph"></div>'}
  <div class="hero-overlay" style="opacity:${overlay}"></div>
  <div class="hero-inner" data-reveal>
    ${c.eyebrow ? `<p class="eyebrow">${esc(c.eyebrow)}</p>` : ''}
    <h1 class="hero-title">${esc(c.title)}</h1>
    ${c.subtitle ? `<p class="hero-sub">${esc(c.subtitle)}</p>` : ''}
  </div>
  <div class="hero-hint" aria-hidden="true"></div>
</section>`;
}

function renderStatement(c) {
  const align = c.alignment === 'left' ? 'left' : 'center';
  return `
<section class="section statement" style="text-align:${align}">
  <p class="statement-text" data-reveal>${esc(c.text)}</p>
</section>`;
}

function renderFullImage(c) {
  return `
<section class="section full-image">
  <figure data-reveal>
    ${imgBox(c.image, { ratio: '16 / 10', cls: 'full-img' })}
    ${c.caption ? `<figcaption class="caption">${esc(c.caption)}</figcaption>` : ''}
  </figure>
</section>`;
}

function renderImageGrid(c) {
  const columns = [2, 3, 4].includes(Number(c.columns)) ? Number(c.columns) : 3;
  const gap = c.gap === 'tight' ? 'tight' : 'normal';
  let images = Array.isArray(c.images) ? c.images.slice(0, 8) : [];
  // Empty template slots — show placeholder cells so layout still reads
  if (images.length === 0) images = new Array(columns).fill('');
  const cells = images.map((img, i) =>
    `<div data-reveal style="--d:${(i * 0.07).toFixed(2)}s">${imgBox(img, { ratio: '4 / 5' })}</div>`
  ).join('\n');
  return `
<section class="section image-grid grid-cols-${columns} gap-${gap}">
  <div class="grid">${cells}</div>
</section>`;
}

function renderSplit(c) {
  const side = c.image_side === 'left' ? 'left' : 'right';
  return `
<section class="section split img-${side}">
  <div class="split-inner">
    <div class="split-text" data-reveal>
      ${c.heading ? `<h2 class="h2">${esc(c.heading)}</h2>` : ''}
      ${c.body ? `<p class="body">${esc(c.body)}</p>` : ''}
    </div>
    <div class="split-img" data-reveal style="--d:.1s">${imgBox(c.image, { ratio: '4 / 5' })}</div>
  </div>
</section>`;
}

function renderMoodboard(c) {
  let images = Array.isArray(c.images) ? c.images.slice(0, 12) : [];
  if (images.length === 0) images = new Array(6).fill('');
  const cells = images.map((img, i) =>
    `<div data-reveal style="--d:${(i * 0.05).toFixed(2)}s">${imgBox(img, { ratio: '1 / 1' })}</div>`
  ).join('\n');
  return `
<section class="section moodboard">
  <div class="mood-grid">${cells}</div>
  ${c.note ? `<p class="mood-note" data-reveal>${esc(c.note)}</p>` : ''}
</section>`;
}

function renderDeliverables(c) {
  const items = Array.isArray(c.items) ? c.items : [];
  const rows = items.map((it, i) => `
    <li data-reveal style="--d:${(i * 0.08).toFixed(2)}s">
      <span class="deliv-title">${esc(it && it.title)}</span>
      ${it && it.detail ? `<span class="deliv-detail">${esc(it.detail)}</span>` : ''}
    </li>`).join('');
  return `
<section class="section deliverables">
  ${c.heading ? `<h2 class="h2" data-reveal>${esc(c.heading)}</h2>` : ''}
  <ul class="deliv-list">${rows}</ul>
</section>`;
}

function renderCrew(c) {
  const members = Array.isArray(c.members) ? c.members : [];
  const rows = members.map((m, i) => `
    <li data-reveal style="--d:${(i * 0.06).toFixed(2)}s">
      <span class="crew-role">${esc(m && m.role)}</span>
      <span class="crew-name">${esc((m && m.name) || 'TBC')}</span>
    </li>`).join('');
  return `
<section class="section crew">
  ${c.heading ? `<h2 class="h2" data-reveal>${esc(c.heading)}</h2>` : ''}
  <ul class="crew-list">${rows}</ul>
</section>`;
}

function renderCta(c, { agency }) {
  let branding = '';
  if (c.show_agency_branding && agency && (agency.name || agency.logo)) {
    branding = `
    <div class="cta-brand" data-reveal style="--d:.2s">
      ${agency.logo ? `<img class="cta-logo" src="${esc(agency.logo)}" alt="">` : ''}
      ${agency.name ? `<span class="cta-agency">${esc(agency.name)}</span>` : ''}
    </div>`;
  }
  return `
<section class="section cta">
  ${c.heading ? `<h2 class="cta-heading" data-reveal>${esc(c.heading)}</h2>` : ''}
  ${c.body ? `<p class="cta-body" data-reveal style="--d:.1s">${esc(c.body)}</p>` : ''}
  ${branding}
</section>`;
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
};

// ── Document ──────────────────────────────────────────────────────────────────

function buildCss(accent) {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--accent:${accent};--bg:#0C0C0C;--text:#F5F5F7;--muted:rgba(245,245,247,0.55)}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased;overflow-x:hidden}
img{display:block;max-width:100%}
.section{padding:clamp(72px,14vh,180px) clamp(20px,6vw,96px);max-width:1280px;margin:0 auto}
.imgbox{overflow:hidden;border-radius:6px;background:rgba(255,255,255,0.04);width:100%}
.imgbox img{width:100%;height:100%;object-fit:cover}
.imgbox.ph{border:1px dashed rgba(255,255,255,0.08)}
.eyebrow{font-size:clamp(11px,1.4vw,14px);letter-spacing:0.28em;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:20px}
.h2{font-size:clamp(1.6rem,4vw,3rem);font-weight:700;letter-spacing:-0.02em;line-height:1.12;margin-bottom:22px}
.body{font-size:clamp(1rem,1.6vw,1.2rem);color:var(--muted);line-height:1.7;max-width:34em}
/* hero */
.hero{position:relative;min-height:100vh;min-height:100dvh;display:flex;align-items:flex-end;overflow:hidden}
.hero-pin{position:sticky;top:0;z-index:0}
.hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-img-ph{background:radial-gradient(120% 90% at 70% 20%,rgba(255,255,255,0.07),transparent 60%),var(--bg)}
.hero-overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(12,12,12,0.55),rgba(12,12,12,0.92));pointer-events:none}
.hero-inner{position:relative;padding:clamp(28px,8vh,96px) clamp(20px,6vw,96px);max-width:1280px;width:100%;margin:0 auto}
.hero-title{font-size:clamp(2.75rem,9vw,6.75rem);font-weight:800;letter-spacing:-0.035em;line-height:0.98}
.hero-sub{margin-top:22px;font-size:clamp(1.05rem,2.2vw,1.5rem);color:rgba(245,245,247,0.75);max-width:30em}
.hero-hint{position:absolute;left:50%;bottom:22px;width:1px;height:44px;background:linear-gradient(to bottom,transparent,rgba(255,255,255,0.6))}
.content{position:relative;z-index:1;background:var(--bg)}
/* statement */
.statement-text{font-size:clamp(1.75rem,5vw,3.75rem);font-weight:700;letter-spacing:-0.025em;line-height:1.15;max-width:20em;margin:0 auto}
.statement[style*="text-align:left"] .statement-text{margin:0}
/* full image */
.full-image{padding-left:clamp(12px,3vw,48px);padding-right:clamp(12px,3vw,48px);max-width:1440px}
.caption{margin-top:14px;font-size:13px;letter-spacing:0.06em;color:var(--muted);text-transform:uppercase}
/* image grid */
.grid{display:grid}
.grid-cols-2 .grid{grid-template-columns:repeat(2,1fr)}
.grid-cols-3 .grid{grid-template-columns:repeat(3,1fr)}
.grid-cols-4 .grid{grid-template-columns:repeat(4,1fr)}
.gap-tight .grid{gap:clamp(6px,0.8vw,10px)}
.gap-normal .grid{gap:clamp(14px,2.2vw,28px)}
/* split */
.split-inner{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,5vw,72px);align-items:center}
.split.img-left .split-text{order:2}
.split.img-left .split-img{order:1}
/* moodboard */
.mood-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(8px,1vw,14px)}
.mood-note{margin-top:26px;font-size:clamp(0.95rem,1.4vw,1.1rem);color:var(--muted);max-width:36em}
/* deliverables */
.deliv-list{list-style:none;border-top:1px solid rgba(255,255,255,0.12)}
.deliv-list li{display:flex;justify-content:space-between;gap:24px;align-items:baseline;padding:clamp(18px,2.6vw,28px) 0;border-bottom:1px solid rgba(255,255,255,0.12)}
.deliv-title{font-size:clamp(1.1rem,2.4vw,1.6rem);font-weight:700;letter-spacing:-0.01em}
.deliv-detail{font-size:clamp(0.9rem,1.4vw,1.05rem);color:var(--muted);text-align:right;max-width:24em}
/* crew */
.crew-list{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:clamp(16px,2.4vw,28px)}
.crew-list li{display:flex;flex-direction:column;gap:6px;padding:18px 20px;border:1px solid rgba(255,255,255,0.1);border-radius:10px}
.crew-role{font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:var(--accent);font-weight:600}
.crew-name{font-size:1.05rem;font-weight:600}
/* cta */
.cta{text-align:center;padding-bottom:clamp(96px,18vh,220px)}
.cta-heading{font-size:clamp(2rem,6vw,4.5rem);font-weight:800;letter-spacing:-0.03em;line-height:1.05}
.cta-body{margin:24px auto 0;font-size:clamp(1rem,1.8vw,1.25rem);color:var(--muted);max-width:32em}
.cta-brand{margin-top:clamp(48px,8vh,88px);display:flex;flex-direction:column;align-items:center;gap:14px}
.cta-logo{max-height:44px;width:auto}
.cta-agency{font-size:13px;letter-spacing:0.24em;text-transform:uppercase;color:var(--muted)}
/* accent divider under h2 sections */
.deliverables .h2::after,.crew .h2::after{content:"";display:block;width:56px;height:3px;background:var(--accent);margin-top:16px;border-radius:2px}
/* motion — only when JS opts in (html.motion), never under reduced motion */
html.motion [data-reveal]{opacity:0;transform:translateY(28px);transition:opacity .8s cubic-bezier(.22,.61,.36,1),transform .8s cubic-bezier(.22,.61,.36,1);transition-delay:var(--d,0s)}
html.motion [data-reveal].in{opacity:1;transform:none}
html.motion [data-reveal] img.settle{transform:scale(1.045);transition:transform 1.3s cubic-bezier(.22,.61,.36,1);transition-delay:var(--d,0s)}
html.motion [data-reveal].in img.settle{transform:scale(1)}
@media (prefers-reduced-motion: reduce){
  html.motion [data-reveal],html.motion [data-reveal] img.settle{opacity:1 !important;transform:none !important;transition:none !important}
}
/* small screens */
@media (max-width:640px){
  .grid-cols-3 .grid,.grid-cols-4 .grid{grid-template-columns:repeat(2,1fr)}
  .mood-grid{grid-template-columns:repeat(2,1fr)}
  .split-inner{grid-template-columns:1fr}
  .split.img-left .split-text{order:1}
  .split.img-left .split-img{order:2}
  .deliv-list li{flex-direction:column;gap:6px}
  .deliv-detail{text-align:left}
}
`;
}

const MOTION_JS = `
(function(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('motion');
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('[data-reveal]').forEach(function(el){ io.observe(el); });
})();
`;

// presentation: row from presentations table
// sections: rows from presentation_sections ordered by sort_order (content = JSON string)
// opts: { origin (absolute base URL for og:image), agency: { name, logo } }
function renderPresentation(presentation, sections, opts = {}) {
  const accent = safeColor(presentation.accent_color);
  const parsed = [];
  for (const s of sections) {
    if (!RENDERERS[s.type]) {
      console.warn(`Pitch render: unknown section type "${s.type}" (section ${s.id}) — skipped`);
      continue;
    }
    try {
      const content = JSON.parse(s.content || '{}');
      if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('not an object');
      parsed.push({ type: s.type, content });
    } catch (err) {
      console.warn(`Pitch render: malformed content in section ${s.id} (${s.type}) — skipped: ${err.message}`);
    }
  }

  const firstHero = parsed.length > 0 && parsed[0].type === 'hero' ? parsed[0] : null;
  const firstStatement = parsed.find(p => p.type === 'statement');
  const ogDescription = (firstStatement && firstStatement.content.text) ||
    (firstHero && firstHero.content.subtitle) || '';
  const heroImageSrc = firstHero ? mediaSrc(firstHero.content.image) : null;
  const ogImage = heroImageSrc && opts.origin ? `${opts.origin}${heroImageSrc}` : null;

  const bodyParts = [];
  parsed.forEach((p, i) => {
    const html = RENDERERS[p.type](p.content, { isFirst: i === 0, agency: opts.agency });
    if (i === 0 && p.type === 'hero') {
      bodyParts.push(html);
      bodyParts.push('<div class="content">');
    } else {
      bodyParts.push(html);
    }
  });
  if (parsed.length > 0 && parsed[0].type === 'hero') bodyParts.push('</div>');

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
<style>${buildCss(accent)}</style>
</head>
<body>
<main>
${bodyParts.join('\n')}
</main>
<script>${MOTION_JS}</script>
</body>
</html>`;
}

module.exports = { renderPresentation, SECTION_TYPES };
