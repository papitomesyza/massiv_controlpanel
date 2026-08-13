// Link preview covers for the public pages.
//
// WhatsApp, Slack, iMessage and the rest will not render an SVG og:image and
// will not run JavaScript, so the cover has to be a real raster image at a
// stable URL. It is drawn as an SVG and rasterised with sharp — already a
// dependency for the media thumbnails — so nothing new is added to the project.
//
// The design is deliberately the same for every page: the project name, and
// one word saying what the link is. Nothing from inside the shot list appears
// on it, because a link preview is shown in a chat list before anyone has
// opened anything, and a call time or a location has no business being there.

const sharp = require('sharp');

const W = 1200;
const H = 630;

// 1.91:1 is what the link unfurlers crop to; drawing at exactly that ratio
// means nothing important gets cut off.
const INK = '#0b0b0c';
const PAPER = '#f4f4f2';
const MUTED = '#8a8a90';

// DejaVu is present in the container; the rest are fallbacks for other hosts.
const FONT = "'DejaVu Sans','Liberation Sans','Helvetica Neue',Helvetica,Arial,sans-serif";

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// No text metrics without a font engine, so this estimates from the glyph mix:
// caps and wide letters run broader than lowercase. It only has to be close
// enough to decide where to break a line.
function estimateWidth(text, size) {
  let units = 0;
  for (const ch of String(text)) {
    if (/[A-Z0-9@#%&]/.test(ch)) units += 0.68;
    else if (/[ilj.,:;'!|]/.test(ch)) units += 0.28;
    else if (/[mwMW]/.test(ch)) units += 0.88;
    else if (ch === ' ') units += 0.30;
    else units += 0.56;
  }
  return units * size;
}

// Long project names wrap rather than overflow, and a name too long for the
// space is cut with an ellipsis instead of running off the edge.
function wrap(text, size, maxWidth, maxLines) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (estimateWidth(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);

  if (lines.length === maxLines) {
    // Anything that did not fit is represented by an ellipsis on the last line.
    const used = lines.join(' ');
    const remaining = String(text || '').trim().slice(used.length).trim();
    if (remaining) {
      let last = lines[maxLines - 1];
      while (last.length > 1 && estimateWidth(`${last}…`, size) > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

function coverSvg({ title, kind, agency }) {
  const PAD = 80;
  const maxWidth = W - PAD * 2;

  // The title takes the size that lets it fit in at most two lines.
  let size = 92;
  let lines = wrap(title, size, maxWidth, 2);
  while (size > 48 && (lines.length > 2 || lines.some(l => estimateWidth(l, size) > maxWidth))) {
    size -= 6;
    lines = wrap(title, size, maxWidth, 2);
  }
  if (!lines.length) lines = ['Untitled'];

  const lineHeight = Math.round(size * 1.18);
  const blockHeight = lines.length * lineHeight;
  // Optically centred, sitting a little above the middle with the label under it.
  const firstBaseline = Math.round((H - blockHeight) / 2) + Math.round(size * 0.82);

  const titleLines = lines.map((l, i) => (
    `<text x="${PAD}" y="${firstBaseline + i * lineHeight}" font-family="${FONT}" font-size="${size}" ` +
    `font-weight="700" fill="${PAPER}" letter-spacing="-1">${esc(l)}</text>`
  )).join('');

  const labelY = firstBaseline + blockHeight - lineHeight + Math.round(size * 0.42) + 62;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${INK}"/>
  <rect x="0" y="0" width="${W}" height="6" fill="${PAPER}"/>
  ${agency ? `<text x="${PAD}" y="96" font-family="${FONT}" font-size="24" font-weight="700" fill="${MUTED}" letter-spacing="6">${esc(String(agency).toUpperCase())}</text>` : ''}
  ${titleLines}
  <text x="${PAD}" y="${labelY}" font-family="${FONT}" font-size="34" font-weight="700" fill="${MUTED}" letter-spacing="9">${esc(String(kind).toUpperCase())}</text>
</svg>`;
}

// Rasterising costs ~30ms, and an unfurler will ask for the same cover several
// times in a row, so the last few are kept. Keyed on everything that is drawn,
// so renaming a project produces a different key rather than a stale image.
const cache = new Map();
const CACHE_MAX = 40;

async function coverPng({ title, kind, agency }) {
  const key = JSON.stringify([title || '', kind || '', agency || '']);
  if (cache.has(key)) return cache.get(key);

  const png = await sharp(Buffer.from(coverSvg({ title, kind, agency })))
    .png({ compressionLevel: 9 })
    .toBuffer();

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, png);
  return png;
}

module.exports = { coverPng, coverSvg, COVER_WIDTH: W, COVER_HEIGHT: H };
