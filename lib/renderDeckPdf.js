// Director Treatment PDF, 16:9, drawn from the same theme the deck uses.
//
// This is the paper twin of lib/deck.js. Same page proportions (1280x720), same
// measurements: a coordinate in the slide CSS is a coordinate here, so the deck
// Andi approves on screen and the file he mails a client hold the same
// composition. PDFKit conventions as everywhere else in the panel: explicit
// layout grid, Helvetica / Helvetica-Bold only, bounded text with ellipsis.
//
// Deliberate difference: the browser can load a display font, PDFKit cannot
// without embedding a file. Display type is Helvetica-Bold, uppercased and
// tracked tight; that is the theme's look, one weight lighter than on screen.
// Alpha is flattened: PDFKit takes solid hex, so each theme carries mutedHex and
// lineHex beside its rgba CSS values.

const PDFDocument = require('pdfkit');
const { themeFor, LABELS } = require('./deck');
const { pdfImagePath } = require('./renderPresentationPdf');

const W = 1280;
const H = 720;
const M = 64;

function clean(v) {
  return String(v == null ? '' : v).replace(/[\u2013\u2014\u2015]/g, ',').replace(/,\s*,/g, ',').trim();
}

function drawImage(doc, filePath, x, y, w, h, fallbackFill) {
  if (!filePath) { doc.rect(x, y, w, h).fill(fallbackFill); return; }
  doc.save();
  try {
    doc.rect(x, y, w, h).clip();
    doc.image(filePath, x, y, { cover: [w, h], align: 'center', valign: 'center' });
  } catch (_) {
    doc.restore();
    doc.rect(x, y, w, h).fill(fallbackFill);
    return;
  }
  doc.restore();
}

function scrim(doc, theme, top, bottom) {
  const solid = theme.dark ? '#000000' : '#FFFFFF';
  const grad = doc.linearGradient(0, 0, 0, H);
  grad.stop(0, solid, top);
  grad.stop(0.45, solid, top * 0.45);
  grad.stop(1, solid, bottom);
  doc.rect(0, 0, W, H).fill(grad);
}

function type(doc, str, x, y, o) {
  const opts = o || {};
  const t = opts.upper ? clean(str).toUpperCase() : clean(str);
  doc.font(opts.font || 'Helvetica')
    .fontSize(opts.size || 16)
    .fillColor(opts.color || '#FFFFFF');
  doc.text(t, x, y, {
    width: opts.width == null ? W - M * 2 : opts.width,
    height: opts.height,
    align: opts.align || 'left',
    characterSpacing: opts.spacing || 0,
    lineGap: opts.lineGap == null ? 0 : opts.lineGap,
    ellipsis: !!opts.height,
  });
}

function slide(doc, theme) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill(theme.bg);
}

function chip(doc, theme, x, y, w, h, radius) {
  doc.save();
  doc.fillOpacity(theme.dark ? 0.46 : 0.68);
  doc.roundedRect(x, y, w, h, radius == null ? h / 2 : radius).fill(theme.dark ? '#000000' : '#FFFFFF');
  doc.restore();
}

// Label chip top left, slide number chip top right. Sits on a full image or on
// a quiet background, so every slide carries the same two anchors.
function strip(doc, theme, section, n, total) {
  const label = clean(LABELS[section.type] || section.type).toUpperCase();
  doc.font('Helvetica-Bold').fontSize(13);
  const tw = doc.widthOfString(label) + label.length * 3.9;
  chip(doc, theme, M - 14, 36, tw + 28, 40);
  type(doc, label, M, 47, { font: 'Helvetica-Bold', size: 13, color: theme.accent, spacing: 3.9, width: 600 });

  const num = String(n) + ' / ' + String(total);
  const nw = doc.fontSize(12).widthOfString(num) + num.length * 2.1;
  chip(doc, theme, W - M - nw - 78, 42, nw + 76, 28);
  type(doc, num, W - M - nw - 62, 48, { size: 12, color: theme.mutedHex, spacing: 2.1, width: nw + 20, align: 'right' });
  chip(doc, theme, W - M - 28, 42, 28, 28, 14);
  doc.save();
  doc.lineWidth(1).strokeColor(theme.lineHex);
  doc.circle(W - M - 14, 56, 14).stroke();
  doc.restore();
  type(doc, String(n), W - M - 28, 50, { size: 12, color: theme.ink, width: 28, align: 'center' });
}

function agencyLine(doc, theme, agency, align) {
  if (!agency || !agency.name) return;
  type(doc, agency.name, M, H - 62, {
    font: 'Helvetica-Bold', size: 12, color: theme.mutedHex, spacing: 3.6,
    width: W - M * 2, align: align || 'left',
  });
}

function drawHero(doc, theme, sec, ctx) {
  slide(doc, theme);
  if (sec.image) {
    drawImage(doc, pdfImagePath(sec.image), 0, 0, W, H, theme.bg);
    scrim(doc, theme, 0.38, 0.74);
  }
  const ink = theme.dark ? '#FFFFFF' : theme.ink;
  const title = clean(sec.title);
  const long = title.length > 26;
  const y = long ? 250 : 224;
  if (sec.eyebrow) {
    type(doc, sec.eyebrow, M, y - 62, { font: 'Helvetica-Bold', size: 15, color: theme.accent, spacing: 4.5, width: 900, upper: true });
  }
  type(doc, title, M, y, {
    font: 'Helvetica-Bold', size: long ? 66 : 88, color: ink,
    upper: theme.display === 'upper', spacing: -2.2, width: W - M * 2 - 60, height: 210, lineGap: -8,
  });
  if (sec.subtitle) {
    type(doc, sec.subtitle, M, y + (long ? 120 : 156), {
      size: 26, color: theme.dark ? '#FFFFFF' : theme.mutedHex, width: 820, height: 96, lineGap: 4,
    });
  }
  agencyLine(doc, theme, ctx.agency, 'left');
}

function drawStatement(doc, theme, sec, ctx) {
  slide(doc, theme);
  const centered = !(sec.alignment === 'left') && theme.align === 'center';
  const width = W - M * 2 - 200;
  const x = centered ? M + 100 : M;
  if (!centered) {
    doc.save();
    doc.lineWidth(3).strokeColor(theme.accent);
    doc.moveTo(M, 168).lineTo(M + 70, 168).stroke();
    doc.restore();
  }
  type(doc, sec.text, x, 214, {
    font: 'Helvetica-Bold', size: 50, color: theme.ink, spacing: -1.4,
    width, height: 340, align: centered ? 'center' : 'left', lineGap: 8,
  });
  strip(doc, theme, sec, ctx.n, ctx.total);
}

function drawFullImage(doc, theme, sec, ctx) {
  slide(doc, theme);
  drawImage(doc, pdfImagePath(sec.image), 0, 0, W, H, theme.card);
  if (sec.caption) {
    scrim(doc, theme, 0.05, 0.8);
    doc.save();
    doc.lineWidth(1).strokeColor('#FFFFFF');
    doc.moveTo(M, H - 78).lineTo(M + 34, H - 78).stroke();
    doc.restore();
    type(doc, sec.caption, M + 48, H - 86, {
      font: 'Helvetica-Bold', size: 13, color: '#FFFFFF', spacing: 3, width: W - M * 2 - 48, upper: true,
    });
  }
  strip(doc, theme, sec, ctx.n, ctx.total);
}

function drawGrid(doc, theme, sec, ctx) {
  slide(doc, theme);
  const cols = [2, 3, 4].indexOf(Number(sec.columns)) >= 0 ? Number(sec.columns) : 3;
  const rows = cols >= 4 ? 1 : 2;
  const gap = sec.gap === 'tight' ? 4 : 6;
  const list = (Array.isArray(sec.images) ? sec.images : []).filter(Boolean).slice(0, 8);
  const cw = (W - gap * (cols - 1)) / cols;
  const ch = (H - gap * (rows - 1)) / rows;
  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) * (cw + gap);
    const y = Math.floor(i / cols) * (ch + gap);
    drawImage(doc, pdfImagePath(list[i]), x, y, cw, ch, theme.card);
  }
  strip(doc, theme, sec, ctx.n, ctx.total);
}

function drawMoodboard(doc, theme, sec, ctx) {
  slide(doc, theme);
  const gap = 8;
  const top = 100;
  const cw = (W - M * 2 - gap * 2) / 3;
  const ch = (H - top - M - gap * 2) / 3;
  const list = (Array.isArray(sec.images) ? sec.images : []).filter(Boolean).slice(0, 7);
  // Cell 1 is a double height lead reference, the rest fill the wall.
  const boxes = [
    [M, top, cw, ch * 2 + gap],
    [M + cw + gap, top, cw, ch],
    [M + (cw + gap) * 2, top, cw, ch],
    [M + cw + gap, top + ch + gap, cw, ch],
    [M + (cw + gap) * 2, top + ch + gap, cw, ch],
    [M, top + ch * 2 + gap * 2, cw, ch],
    [M + cw + gap, top + ch * 2 + gap * 2, cw, ch],
  ];
  boxes.forEach((b, i) => drawImage(doc, pdfImagePath(list[i]), b[0], b[1], b[2], b[3], theme.card));
  strip(doc, theme, sec, ctx.n, ctx.total);
  if (sec.note) type(doc, sec.note, M, H - 52, { size: 18, color: theme.mutedHex, width: W - M * 2, height: 30 });
}

function drawSplit(doc, theme, sec, ctx) {
  slide(doc, theme);
  const left = sec.image_side === 'left';
  const imgX = left ? 0 : W / 2;
  const txtX = left ? W / 2 + M : M;
  const txtW = W / 2 - M * 2;
  drawImage(doc, pdfImagePath(sec.image), imgX, 0, W / 2, H, theme.card);
  let y = 236;
  if (sec.heading) {
    type(doc, sec.heading, txtX, y, {
      font: 'Helvetica-Bold', size: 44, color: theme.ink, spacing: -1.3,
      width: txtW, height: 140, upper: theme.display === 'upper', lineGap: -6,
    });
    y += 152;
  }
  if (sec.body) type(doc, sec.body, txtX, y, { size: 21, color: theme.mutedHex, width: txtW, height: 240, lineGap: 5 });
  strip(doc, theme, sec, ctx.n, ctx.total);
}

function drawCards(doc, theme, sec, ctx, rowsKey, pairs) {
  slide(doc, theme);
  strip(doc, theme, sec, ctx.n, ctx.total);
  let y = 156;
  if (sec.heading) {
    type(doc, sec.heading, M, y, {
      font: 'Helvetica-Bold', size: 44, color: theme.ink, spacing: -1.3,
      width: W - M * 2, height: 84, upper: theme.display === 'upper',
    });
    y += 104;
  }
  const items = (Array.isArray(sec[rowsKey]) ? sec[rowsKey] : []).slice(0, 8);
  if (!items.length) return;
  const cols = items.length <= 2 ? 2 : (items.length === 3 ? 3 : 4);
  const gap = 14;
  const cw = (W - M * 2 - gap * (cols - 1)) / cols;
  const chh = Math.min(280, H - y - M + 20);
  items.forEach((it, i) => {
    const x = M + (i % cols) * (cw + gap);
    const yy = y + Math.floor(i / cols) * (chh + gap);
    if (yy + chh > H - M + 44) return;
    doc.save();
    doc.roundedRect(x, yy, cw, chh, 14).fill(theme.card);
    doc.lineWidth(1).strokeColor(theme.lineHex).roundedRect(x, yy, cw, chh, 14).stroke();
    doc.restore();
    let ty = yy + 24;
    pairs.forEach(p => {
      const val = clean(it && it[p.key]);
      if (!val) return;
      type(doc, val, x + 22, ty, {
        font: p.strong ? 'Helvetica-Bold' : 'Helvetica',
        size: p.size || 20,
        color: p.color === 'accent' ? theme.accent : (p.muted ? theme.mutedHex : theme.ink),
        spacing: p.spacing || 0,
        width: cw - 44, height: p.height || 80,
        upper: !!p.upper, lineGap: 2,
      });
      ty += p.height || 80;
    });
  });
}

function drawCta(doc, theme, sec, ctx) {
  slide(doc, theme);
  const centered = theme.align === 'center';
  type(doc, sec.heading, M, 216, {
    font: 'Helvetica-Bold', size: 68, color: theme.accent, spacing: -2,
    width: W - M * 2, height: 180, align: centered ? 'center' : 'left',
    upper: theme.display === 'upper', lineGap: -6,
  });
  if (sec.body) {
    type(doc, sec.body, centered ? M + 200 : M, 412, {
      size: 21, color: theme.mutedHex, width: centered ? W - M * 2 - 400 : 700,
      height: 130, align: centered ? 'center' : 'left', lineGap: 5,
    });
  }
  if (sec.show_agency_branding) agencyLine(doc, theme, ctx.agency, centered ? 'center' : 'left');
  strip(doc, theme, sec, ctx.n, ctx.total);
}

function drawSocial(doc, theme, sec, ctx) {
  slide(doc, theme);
  const pw = 392;
  const px = (W - pw) / 2;
  const py = 96;
  doc.save();
  doc.roundedRect(px, py, pw, H - py - 60, 24).fill(theme.card);
  doc.lineWidth(1).strokeColor(theme.lineHex).roundedRect(px, py, pw, H - py - 60, 24).stroke();
  doc.restore();
  drawImage(doc, pdfImagePath(sec.image), px, py + 62, pw, 400, theme.bg);
  type(doc, sec.handle || '@', px + 16, py + 24, { font: 'Helvetica-Bold', size: 15, color: theme.ink, width: pw - 32, height: 24 });
  type(doc, sec.caption, px + 16, py + 476, { size: 15, color: theme.ink, width: pw - 32, height: 92, lineGap: 3 });
  strip(doc, theme, sec, ctx.n, ctx.total);
}

const DRAW = {
  hero: drawHero,
  statement: drawStatement,
  full_image: drawFullImage,
  image_grid: drawGrid,
  moodboard: drawMoodboard,
  split: drawSplit,
  deliverables: (doc, theme, sec, ctx) => drawCards(doc, theme, sec, ctx, 'items', [
    { key: 'title', size: 20, strong: true, height: 70 },
    { key: 'detail', size: 15, muted: true, height: 120 },
  ]),
  crew: (doc, theme, sec, ctx) => drawCards(doc, theme, sec, ctx, 'members', [
    { key: 'role', size: 12, color: 'accent', spacing: 3, upper: true, height: 30 },
    { key: 'name', size: 22, strong: true, height: 70 },
  ]),
  cta: drawCta,
  social_post: drawSocial,
};

// Renders the deck into an open PDFDocument stream. Same call shape as
// renderPresentationPdf, so the route picks one or the other by kind.
function renderDeckPdf(stream, pres, sections, options) {
  const opts = options || {};
  const theme = themeFor(pres.theme, pres.accent_color);
  const doc = new PDFDocument({
    size: [W, H],
    margin: 0,
    autoFirstPage: false,
    info: { Title: pres.title || 'Director Treatment', Creator: 'MASSIV Control Panel' },
  });
  doc.pipe(stream);

  const list = Array.isArray(sections) ? sections.map(s => {
    let content = s.content;
    if (typeof content === 'string') { try { content = JSON.parse(content || '{}'); } catch (_) { content = {}; } }
    return { type: s.type, content: content && typeof content === 'object' ? content : {} };
  }) : [];

  if (!list.length) {
    slide(doc, theme);
    type(doc, pres.title || 'Director Treatment', M, 300, { font: 'Helvetica-Bold', size: 56, color: theme.ink, width: W - M * 2, height: 160 });
  }
  const ctx = { agency: opts.agency || null, n: 1, total: list.length || 1 };
  list.forEach((s, i) => {
    ctx.n = i + 1; ctx.total = list.length;
    (DRAW[s.type] || drawStatement)(doc, theme, s.content, ctx);
  });

  doc.end();
}

module.exports = { renderDeckPdf };
