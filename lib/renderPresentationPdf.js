// Director Treatment PDF export.
//
// Same PDFKit conventions the shot list and invoice exports already use: margin
// 0 with an explicit layout grid, Helvetica / Helvetica-Bold only, hex fills,
// manual page breaks, doc.pipe(res). It is a PAGE-PER-SECTION deck: the
// published web page and this file are the same document, so a treatment Andi
// reviews on screen prints the way he saw it.
//
// Every draw is bounded (explicit widths and heights with ellipsis), so a long
// section shortens on paper instead of overflowing the page.

const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const PAGE_W = 841.89;   // A4 landscape
const PAGE_H = 595.28;
const M = 56;            // page margin
const CW = PAGE_W - M * 2;

const INK = '#111111';
const DARK = '#0E0E0E';
const SOFT = '#555555';
const MUTED = '#8A8A8A';
const RULE = '#E2E2E2';
const LIGHT = '#F6F6F4';

function mediaDir() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'presentation-media');
}

function safeMediaPath(filename) {
  if (!filename || typeof filename !== 'string') return null;
  if (/[/\\]/.test(filename) || filename.includes('..')) return null;
  const p = path.join(mediaDir(), filename);
  return fs.existsSync(p) ? p : null;
}

// PDFKit embeds JPEG and PNG only; anything else falls back to its thumbnail,
// which storeImage always writes as a JPEG.
function pdfImagePath(filename) {
  if (!filename) return null;
  if (/\.(jpe?g|png)$/i.test(filename)) {
    const full = safeMediaPath(filename);
    if (full) return full;
  }
  return safeMediaPath(String(filename).replace(/-web\.jpg$/i, '-thumb.jpg')) || safeMediaPath(filename);
}

function hexOr(value, fallback) {
  const v = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

// doc.save() with a clip must always be matched by a restore, or a failed image
// leaves the clip active and everything drawn after is cut away.
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

function text(doc, str, x, y, opts) {
  doc.text(String(str == null ? '' : str), x, y, opts);
}

function page(doc, fill) {
  doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(fill);
}

function images(sec, max) {
  return (Array.isArray(sec.images) ? sec.images : []).filter(Boolean).slice(0, max);
}

function drawHero(doc, sec, accent, agency) {
  doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(DARK);
  const bg = pdfImagePath(sec.image);
  if (bg) {
    doc.save();
    doc.fillOpacity(1);
    drawImage(doc, bg, 0, 0, PAGE_W, PAGE_H, DARK);
    doc.restore();
    doc.save();
    doc.fillOpacity(0.72);
    doc.rect(0, 0, PAGE_W, PAGE_H).fill(DARK);
    doc.restore();
    doc.fillOpacity(1);
  }
  if (sec.eyebrow) {
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(11)
      .text(String(sec.eyebrow).toUpperCase(), M, 120, { width: CW, characterSpacing: 3 });
  }
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(56)
    .text(String(sec.title || ''), M, 156, { width: CW, height: 150, ellipsis: true });
  if (sec.subtitle) {
    doc.fillColor('#D8D8D8').font('Helvetica').fontSize(15)
      .text(String(sec.subtitle), M, 330, { width: CW * 0.7, height: 60, ellipsis: true });
  }
  if (agency && agency.name) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(String(agency.name), M, PAGE_H - 56, { width: CW, characterSpacing: 2 });
  }
}

function drawStatement(doc, sec, accent) {
  page(doc, LIGHT);
  const align = sec.alignment === 'left' ? 'left' : 'center';
  doc.fillColor(accent).font('Helvetica-Bold').fontSize(10)
    .text('DIRECTOR’S NOTE', M, 84, { width: CW, align, characterSpacing: 3 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(30)
    .text(String(sec.text || ''), M + 40, 150, { width: CW - 80, height: 300, align, ellipsis: true });
}

function drawFullImage(doc, sec, accent) {
  doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(DARK);
  drawImage(doc, pdfImagePath(sec.image), 0, 0, PAGE_W, PAGE_H, '#1A1A1A');
  if (sec.caption) {
    doc.save();
    doc.fillOpacity(0.55);
    doc.rect(0, PAGE_H - 92, PAGE_W, 92).fill(DARK);
    doc.restore();
    doc.fillOpacity(1);
    doc.fillColor('#F0F0F0').font('Helvetica').fontSize(13)
      .text(String(sec.caption), M, PAGE_H - 60, { width: CW, height: 40, ellipsis: true });
  }
}

function drawGrid(doc, sec, accent) {
  page(doc, '#FFFFFF');
  const cols = [2, 3, 4].includes(Number(sec.columns)) ? Number(sec.columns) : 3;
  const list = images(sec, 8);
  const gap = sec.gap === 'tight' ? 8 : 16;
  const cellW = (CW - gap * (cols - 1)) / cols;
  const cellH = (PAGE_H - M * 2 - gap * Math.ceil(list.length / cols)) / Math.ceil(list.length / cols);
  list.forEach((name, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    drawImage(doc, pdfImagePath(name), M + c * (cellW + gap), M + r * (cellH + gap), cellW, cellH, '#EDEDED');
  });
  if (list.length === 0) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(12).text('No images in this section.', M, PAGE_H / 2);
  }
}

function drawSplit(doc, sec, accent) {
  page(doc, LIGHT);
  const imgW = CW * 0.42;
  const gap = 40;
  const side = sec.image_side === 'left' ? 'left' : 'right';
  const imgX = side === 'left' ? M : M + CW - imgW;
  const txtX = side === 'left' ? M + imgW + gap : M;
  const txtW = CW - imgW - gap;
  drawImage(doc, pdfImagePath(sec.image), imgX, 88, imgW, PAGE_H - 176, '#E4E4E0');
  if (sec.heading) {
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(10)
      .text('SECTION', txtX, 96, { width: txtW, characterSpacing: 3 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(26)
      .text(String(sec.heading), txtX, 118, { width: txtW, height: 100, ellipsis: true });
  }
  if (sec.body) {
    doc.fillColor(SOFT).font('Helvetica').fontSize(12.5)
      .text(String(sec.body), txtX, 240, { width: txtW, height: PAGE_H - 300, ellipsis: true, lineGap: 4 });
  }
}

function drawMoodboard(doc, sec, accent) {
  page(doc, DARK);
  const list = images(sec, 6);
  doc.fillColor(accent).font('Helvetica-Bold').fontSize(10)
    .text('REFERENCES', M, 60, { width: CW, characterSpacing: 3 });
  const cols = 3;
  const gap = 10;
  const cellW = (CW - gap * (cols - 1)) / cols;
  const cellH = 150;
  list.forEach((name, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    drawImage(doc, pdfImagePath(name), M + c * (cellW + gap), 92 + r * (cellH + gap), cellW, cellH, '#222222');
  });
  if (sec.note) {
    doc.fillColor('#CFCFCF').font('Helvetica').fontSize(12)
      .text(String(sec.note), M, PAGE_H - 78, { width: CW, height: 50, ellipsis: true });
  }
}

function drawDeliverables(doc, sec, accent) {
  page(doc, '#FFFFFF');
  if (sec.heading) {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(28)
      .text(String(sec.heading), M, 72, { width: CW, height: 90, ellipsis: true });
  }
  const items = Array.isArray(sec.items) ? sec.items : [];
  let y = 180;
  items.forEach((it, i) => {
    if (y > PAGE_H - 90) return;
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(11)
      .text(String(i + 1).padStart(2, '0'), M, y, { width: 40 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(15)
      .text(String((it && it.title) || ''), M + 46, y - 2, { width: CW - 46, height: 22, ellipsis: true });
    if (it && it.detail) {
      doc.fillColor(SOFT).font('Helvetica').fontSize(11.5)
        .text(String(it.detail), M + 46, y + 20, { width: CW - 46, height: 20, ellipsis: true });
    }
    doc.moveTo(M, y + 48).lineTo(PAGE_W - M, y + 48).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 62;
  });
}

function drawCrew(doc, sec, accent) {
  page(doc, LIGHT);
  if (sec.heading) {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(28)
      .text(String(sec.heading), M, 72, { width: CW, height: 80, ellipsis: true });
  }
  const members = Array.isArray(sec.members) ? sec.members.slice(0, 12) : [];
  const cols = 2;
  const colW = (CW - 40) / cols;
  members.forEach((m, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = M + c * (colW + 40);
    const y = 190 + r * 64;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
      .text(String((m && m.role) || '').toUpperCase(), x, y, { width: colW, characterSpacing: 2 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16)
      .text(String((m && m.name) || '—'), x, y + 16, { width: colW, height: 24, ellipsis: true });
  });
}

function drawCta(doc, sec, accent, agency) {
  page(doc, DARK);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(32)
    .text(String(sec.heading || ''), M, 180, { width: CW * 0.78, height: 140, ellipsis: true });
  if (sec.body) {
    doc.fillColor('#C8C8C8').font('Helvetica').fontSize(13)
      .text(String(sec.body), M, 340, { width: CW * 0.7, height: 90, ellipsis: true });
  }
  if (sec.show_agency_branding && agency && agency.name) {
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(11)
      .text(String(agency.name).toUpperCase(), M, PAGE_H - 60, { width: CW, characterSpacing: 3 });
  }
}

function drawSocial(doc, sec, accent) {
  page(doc, LIGHT);
  const imgW = CW * 0.4;
  drawImage(doc, pdfImagePath(sec.image), M, 88, imgW, PAGE_H - 176, '#E4E4E0');
  doc.fillColor(accent).font('Helvetica-Bold').fontSize(10)
    .text('SOCIAL POST', M + imgW + 40, 96, { width: CW - imgW - 40, characterSpacing: 3 });
  if (sec.handle) {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16)
      .text(String(sec.handle), M + imgW + 40, 120, { width: CW - imgW - 40 });
  }
  if (sec.caption) {
    doc.fillColor(SOFT).font('Helvetica').fontSize(12.5)
      .text(String(sec.caption), M + imgW + 40, 152, { width: CW - imgW - 40, height: PAGE_H - 220, ellipsis: true, lineGap: 4 });
  }
}

// sections: [{ type, content }] in running order. content may be a JSON string.
function renderPresentationPdf(stream, pres, sections, options) {
  const opts = options || {};
  const accent = hexOr(pres.accent_color, '#C7FF2E');
  const agency = opts.agency || null;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    autoFirstPage: false,
    info: { Title: pres.title || 'Director Treatment', Creator: 'MASSIV Control Panel' },
  });
  doc.pipe(stream);

  const list = Array.isArray(sections) ? sections : [];
  if (list.length === 0) {
    page(doc, DARK);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(24)
      .text(String(pres.title || 'Director Treatment'), M, PAGE_H / 2 - 40, { width: CW });
  }

  for (const sec of list) {
    let content = sec && sec.content;
    if (typeof content === 'string') { try { content = JSON.parse(content); } catch (_) { content = {}; } }
    const c = content || {};
    switch (sec && sec.type) {
      case 'hero': drawHero(doc, c, accent, agency); break;
      case 'statement': drawStatement(doc, c, accent); break;
      case 'full_image': drawFullImage(doc, c, accent); break;
      case 'image_grid': drawGrid(doc, c, accent); break;
      case 'split': drawSplit(doc, c, accent); break;
      case 'moodboard': drawMoodboard(doc, c, accent); break;
      case 'deliverables': drawDeliverables(doc, c, accent); break;
      case 'crew': drawCrew(doc, c, accent); break;
      case 'cta': drawCta(doc, c, accent, agency); break;
      case 'social_post': drawSocial(doc, c, accent); break;
      default: break;
    }
  }

  doc.end();
}

module.exports = { renderPresentationPdf, pdfImagePath, safeMediaPath };
