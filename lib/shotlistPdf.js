// Shot list PDF exports — call sheet and photo board.
//
// Same PDFKit conventions the invoice export already uses: margin 0 with an
// explicit layout grid, Helvetica / Helvetica-Bold only, hex fills, manual page
// breaks, doc.pipe(res). Both exports respect the ordering the panel currently
// has selected and both carry the agency branding from settings.

const path = require('path');
const fs = require('fs');

const INK = '#111111';
const SOFT = '#555555';
const MUTED = '#888888';
const RULE = '#CCCCCC';
const HAIR = '#EEEEEE';
const BAND = '#F2F2F2';
const ZEBRA = '#FAFAFA';

function mediaDir() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'shotlist-media');
}

function safeMediaPath(filename) {
  if (!filename || typeof filename !== 'string') return null;
  if (/[/\\]/.test(filename) || filename.includes('..')) return null;
  const p = path.join(mediaDir(), filename);
  return fs.existsSync(p) ? p : null;
}

function fmtDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function logoBuffer(logoData) {
  if (!logoData) return null;
  try {
    return Buffer.from(String(logoData).replace(/^data:image\/\w+;base64,/, ''), 'base64');
  } catch (_) {
    return null;
  }
}

// Shared masthead: agency branding left, production identity right.
function drawHeader(doc, { agency, shotlist, orderLabel, subtitle }, ML, MR, PW, y) {
  const logo = logoBuffer(agency.logo);
  let leftBottom = y;
  if (logo) {
    try {
      doc.image(logo, ML, y, { fit: [120, 42] });
      leftBottom = y + 44;
    } catch (_) {
      doc.fontSize(13).font('Helvetica-Bold').fillColor(INK)
        .text(agency.name || 'PRODUCTION', ML, y + 8, { lineBreak: false });
      leftBottom = y + 26;
    }
  } else {
    doc.fontSize(13).font('Helvetica-Bold').fillColor(INK)
      .text(agency.name || 'PRODUCTION', ML, y + 8, { lineBreak: false });
    leftBottom = y + 26;
  }

  const rightW = 250;
  const rightX = PW - MR - rightW;
  let ry = y;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED)
    .text(subtitle, rightX, ry, { width: rightW, align: 'right', lineBreak: false });
  ry += 12;
  doc.fontSize(15).font('Helvetica-Bold').fillColor(INK)
    .text(shotlist.title || 'Shot list', rightX, ry, { width: rightW, align: 'right', lineBreak: false });
  ry += 20;

  const bits = [];
  if (shotlist.shoot_date) bits.push(fmtDate(shotlist.shoot_date));
  if (shotlist.call_time) bits.push(`Call ${shotlist.call_time}`);
  if (orderLabel) bits.push(orderLabel);
  if (bits.length) {
    doc.fontSize(9).font('Helvetica').fillColor(SOFT)
      .text(bits.join('   ·   '), rightX, ry, { width: rightW, align: 'right', lineBreak: false });
    ry += 13;
  }
  if (agency.name) {
    doc.fontSize(8).font('Helvetica').fillColor(MUTED)
      .text(agency.name, rightX, ry, { width: rightW, align: 'right', lineBreak: false });
    ry += 11;
  }

  return Math.max(leftBottom, ry) + 10;
}

// ── Call sheet ────────────────────────────────────────────────────────────────
// Landscape A4, one row per SCENE with its coverage stacked inside, kept to as
// few pages as possible: rows grow only as tall as their tallest wrapped cell.

function callSheetPdf(res, { shotlist, rows, scenesById, shotsByScene, locationsById, agency, orderLabel }) {
  const PDFDocument = require('pdfkit');
  const safeTitle = (shotlist.title || 'shotlist').replace(/[^a-z0-9]/gi, '-').slice(0, 40);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Call-Sheet-${safeTitle}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: true });
  doc.pipe(res);

  const ML = 32, MR = 32, MT = 30, MB = 34;
  const PW = doc.page.width;   // 842
  const PH = doc.page.height;  // 595
  const CW = PW - ML - MR;

  const newPageSetup = () => doc.rect(0, 0, PW, PH).fill('#FFFFFF');
  newPageSetup();

  let y = drawHeader(doc, { agency, shotlist, orderLabel, subtitle: 'CALL SHEET' }, ML, MR, PW, MT);
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.7).stroke();
  y += 10;

  // Column grid — widths sum to CW (778)
  const widths = {
    nr: 26, time: 46, space: 34, light: 100, location: 92,
    scene: 110, shot: 130, talent: 80, costume: 80, props: 80,
  };
  const order = ['nr', 'time', 'space', 'light', 'location', 'scene', 'shot', 'talent', 'costume', 'props'];
  const labels = {
    nr: '#', time: 'TIME', space: 'I/E', light: 'LIGHT WINDOW', location: 'LOCATION',
    scene: 'SCENE', shot: 'SHOTS', talent: 'TALENT', costume: 'COSTUME', props: 'PROPS',
  };
  const C = {};
  let cx = ML;
  order.forEach(k => { C[k] = { x: cx, w: widths[k] - 6 }; cx += widths[k]; });

  const HEADER_H = 18;
  function drawTableHeader(atY) {
    doc.rect(ML, atY, CW, HEADER_H).fill(BAND);
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#444444');
    order.forEach(k => doc.text(labels[k], C[k].x, atY + 6, { width: C[k].w, lineBreak: false }));
    return atY + HEADER_H;
  }
  y = drawTableHeader(y);
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();

  const cellFont = () => doc.fontSize(7.5).font('Helvetica');

  rows.forEach((row, idx) => {
    const scene = scenesById.get(row.scene_id) || {};
    const shots = shotsByScene.get(row.scene_id) || [];
    const loc = scene.location_id != null ? locationsById.get(scene.location_id) : null;
    const lightText = row.light_window_label
      ? `${row.light_window_label}${row.light_window_range ? `\n${row.light_window_range}` : ''}`
      : '';

    // One row per scene, with its coverage stacked in the SHOTS column — the
    // shape a crew reads on set.
    const shotText = shots.length
      ? shots.map((sh, i) => `${sh.shot_number || i + 1}. ${sh.title || 'Untitled'}${sh.shot_type ? ` (${sh.shot_type})` : ''}`).join('\n')
      : '—';
    const joinUnique = key => {
      const seen = [];
      shots.forEach(sh => { const v = (sh[key] || '').trim(); if (v && !seen.includes(v)) seen.push(v); });
      return seen.join(', ');
    };

    const values = {
      nr: scene.scene_number || String(idx + 1),
      time: row.start_label || '',
      space: scene.space === 'interior' ? 'INT' : 'EXT',
      light: lightText,
      location: loc ? loc.name : '',
      scene: scene.title || '',
      shot: shotText,
      talent: joinUnique('talent'),
      costume: joinUnique('costume'),
      props: joinUnique('props'),
    };

    // Row height = the tallest wrapped cell, so nothing is clipped and short
    // rows stay short.
    cellFont();
    let rowH = 16;
    order.forEach(k => {
      const h = doc.heightOfString(String(values[k] || ''), { width: C[k].w });
      rowH = Math.max(rowH, h + 8);
    });

    if (y + rowH > PH - MB) {
      doc.addPage();
      newPageSetup();
      y = MT;
      y = drawTableHeader(y);
      doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
    }

    if (idx % 2 === 1) doc.rect(ML, y, CW, rowH).fill(ZEBRA);

    cellFont().fillColor('#333333');
    order.forEach(k => {
      if (k === 'nr' || k === 'time' || k === 'scene') doc.font('Helvetica-Bold').fillColor(INK);
      else doc.font('Helvetica').fillColor('#333333');
      doc.text(String(values[k] || ''), C[k].x, y + 4, { width: C[k].w });
    });

    y += rowH;
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(HAIR).lineWidth(0.3).stroke();
  });

  if (shotlist.notes) {
    if (y + 40 > PH - MB) { doc.addPage(); newPageSetup(); y = MT; }
    y += 10;
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(MUTED)
      .text('NOTES', ML, y, { lineBreak: false });
    y += 11;
    doc.fontSize(8).font('Helvetica').fillColor('#444444')
      .text(shotlist.notes, ML, y, { width: CW });
  }

  doc.end();
}

// ── Photo board ───────────────────────────────────────────────────────────────
// Portrait A4, one block per shot: its reference and scout images beside the
// key details, for prep and for sending ahead of the day.

function photoBoardPdf(res, { shotlist, rows, scenesById, shotsByScene, locationsById, mediaByShot, agency, orderLabel }) {
  const PDFDocument = require('pdfkit');
  const safeTitle = (shotlist.title || 'shotlist').replace(/[^a-z0-9]/gi, '-').slice(0, 40);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Photo-Board-${safeTitle}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
  doc.pipe(res);

  const ML = 42, MR = 42, MT = 40, MB = 44;
  const PW = doc.page.width;   // 595
  const PH = doc.page.height;  // 842
  const CW = PW - ML - MR;     // 511

  const newPageSetup = () => doc.rect(0, 0, PW, PH).fill('#FFFFFF');
  newPageSetup();

  let y = drawHeader(doc, { agency, shotlist, orderLabel, subtitle: 'PHOTO BOARD' }, ML, MR, PW, MT);
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.7).stroke();
  y += 14;

  const BLOCK_GAP = 16;
  const IMG_W = 150;
  const IMG_H = 112;
  const TEXT_X = ML + IMG_W + 14;
  const TEXT_W = CW - IMG_W - 14;

  // Scene heading, then one block per shot inside it.
  function drawSceneHeading(row, idx) {
    const scene = scenesById.get(row.scene_id) || {};
    const loc = scene.location_id != null ? locationsById.get(scene.location_id) : null;

    doc.fontSize(7).font('Helvetica-Bold').fillColor(MUTED)
      .text('SCENE', ML, y, { lineBreak: false });
    y += 10;
    doc.fontSize(14).font('Helvetica-Bold').fillColor(INK)
      .text(`${scene.scene_number || idx + 1}.  ${scene.title || 'Untitled scene'}`, ML, y, { width: CW });
    y = doc.y + 2;

    const bits = [
      row.start_label ? `${row.start_label}${row.duration_minutes ? `  ·  ${row.duration_minutes} min` : ''}` : '',
      scene.space === 'interior' ? 'Interior' : 'Exterior',
      row.light_window_label
        ? `${row.light_window_label}${row.light_window_range ? ` (${row.light_window_range})` : ''}` : '',
      loc ? [loc.name, loc.address].filter(Boolean).join(' — ') : '',
    ].filter(Boolean);
    doc.fontSize(8.5).font('Helvetica').fillColor(SOFT).text(bits.join('   ·   '), ML, y, { width: CW });
    y = doc.y + 3;

    if (scene.description) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#333333').text(scene.description, ML, y, { width: CW });
      y = doc.y + 3;
    }
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
    y += 10;
  }

  const blocks = [];
  rows.forEach((row, sceneIdx) => {
    blocks.push({ kind: 'scene', row, sceneIdx });
    (shotsByScene.get(row.scene_id) || []).forEach((shot, shotIdx) => {
      blocks.push({ kind: 'shot', row, shot, shotIdx });
    });
  });

  blocks.forEach(block => {
    if (block.kind === 'scene') {
      // A heading with no room left for at least one block starts the next page
      if (y + 90 > PH - MB) { doc.addPage(); newPageSetup(); y = MT; }
      drawSceneHeading(block.row, block.sceneIdx);
      return;
    }

    const { row, shot, shotIdx: idx } = block;
    const media = (mediaByShot.get(shot.id) || []).slice(0, 4);

    // Measure before drawing so a block is never split across pages.
    const detailLines = [
      ['Type', shot.shot_type || ''],
      ['Duration', shot.duration_minutes ? `${shot.duration_minutes} min` : ''],
      ['Talent', shot.talent || ''],
      ['Costume', shot.costume || ''],
      ['Props', shot.props || ''],
      ['Camera', shot.camera_notes || ''],
      ['Description', shot.description || ''],
    ].filter(([, v]) => v);

    doc.fontSize(8.5).font('Helvetica');
    let textH = 20; // title line
    detailLines.forEach(([, v]) => {
      textH += Math.max(11, doc.heightOfString(String(v), { width: TEXT_W - 62 }) + 2);
    });

    // Up to two images stack in the left column; each carries a caption line.
    const imageRows = Math.min(media.length, 2);
    const imagesH = imageRows * (IMG_H + 12);
    const blockH = Math.max(textH, imagesH, 40);

    if (y + blockH > PH - MB) {
      doc.addPage();
      newPageSetup();
      y = MT;
    }

    const blockTop = y;

    // Images column (up to two stacked; extras are listed as a count)
    let iy = blockTop;
    media.slice(0, 2).forEach(m => {
      const p = safeMediaPath(m.filename);
      if (p) {
        try {
          doc.save();
          doc.rect(ML, iy, IMG_W, IMG_H).clip();
          doc.image(p, ML, iy, { cover: [IMG_W, IMG_H], align: 'center', valign: 'center' });
          doc.restore();
        } catch (_) {
          doc.rect(ML, iy, IMG_W, IMG_H).fill(HAIR);
        }
      } else {
        doc.rect(ML, iy, IMG_W, IMG_H).fill(HAIR);
      }
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(MUTED)
        .text(m.kind === 'scout' ? 'SCOUT' : 'REFERENCE', ML, iy + IMG_H + 2, { width: IMG_W, lineBreak: false });
      iy += IMG_H + 12;
    });
    if (media.length === 0) {
      doc.rect(ML, blockTop, IMG_W, 40).fill('#FBFBFB');
      doc.fontSize(7).font('Helvetica').fillColor(MUTED)
        .text('No photos', ML, blockTop + 16, { width: IMG_W, align: 'center', lineBreak: false });
    }

    // Text column
    let ty = blockTop;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(INK)
      .text(`Shot ${shot.shot_number || idx + 1}  ·  ${shot.title || 'Untitled shot'}`, TEXT_X, ty, { width: TEXT_W });
    ty = doc.y + 4;

    detailLines.forEach(([k, v]) => {
      doc.fontSize(7).font('Helvetica-Bold').fillColor(MUTED)
        .text(k.toUpperCase(), TEXT_X, ty + 1, { width: 56, lineBreak: false });
      doc.fontSize(8.5).font('Helvetica').fillColor('#333333')
        .text(String(v), TEXT_X + 60, ty, { width: TEXT_W - 62 });
      ty = Math.max(doc.y, ty + 11) + 1;
    });

    const bottom = Math.max(ty, blockTop + (media.length ? Math.min(media.length, 2) * (IMG_H + 12) : 40));
    y = bottom + BLOCK_GAP;
    doc.moveTo(ML, y - BLOCK_GAP / 2).lineTo(PW - MR, y - BLOCK_GAP / 2)
      .strokeColor(HAIR).lineWidth(0.4).stroke();
  });

  doc.end();
}

module.exports = { callSheetPdf, photoBoardPdf };
