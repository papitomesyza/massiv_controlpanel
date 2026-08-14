// Shot list PDF exports — call sheet and photo board.
//
// Same PDFKit conventions the invoice export already uses: margin 0 with an
// explicit layout grid, Helvetica / Helvetica-Bold only, hex fills, manual page
// breaks, doc.pipe(res). Both exports are DAY AWARE: one section per shoot day,
// opening with that day's crew call, first shot call, wrap and total hours, and
// printing company moves and breaks inline in the running order so the paper
// matches the timeline exactly. Both respect the ordering the panel has
// selected, and both carry the agency branding from settings.

const path = require('path');
const fs = require('fs');
const { fmtDuration, fmtClip, fmtAgeRange } = require('./shotlistSchedule');

const INK = '#111111';
const SOFT = '#555555';
const MUTED = '#888888';
const RULE = '#CCCCCC';
const HAIR = '#EEEEEE';
const BAND = '#F2F2F2';
const ZEBRA = '#FAFAFA';
const MOVE_BG = '#EFEFEF';
const BREAK_BG = '#F6F2E9';

function mediaDir() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'shotlist-media');
}

function safeMediaPath(filename) {
  if (!filename || typeof filename !== 'string') return null;
  if (/[/\\]/.test(filename) || filename.includes('..')) return null;
  const p = path.join(mediaDir(), filename);
  return fs.existsSync(p) ? p : null;
}

// PDFKit embeds JPEG and PNG only. An animated upload's web copy is a WebP, so
// the paper falls back to the still thumb, which is always a JPEG.
function pdfImagePath(media) {
  if (!media) return null;
  const full = /\.(jpe?g|png)$/i.test(media.filename || '') ? safeMediaPath(media.filename) : null;
  return full || safeMediaPath(media.thumb_filename) || null;
}

// doc.save() with a clip must always be matched by a restore, or a failed
// image leaves the clip active and everything drawn afterwards is cut away.
function drawClippedImage(doc, filePath, x, y, w, h, fallbackFill) {
  if (!filePath) {
    doc.rect(x, y, w, h).fill(fallbackFill);
    return;
  }
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

function fmtDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function lensLabel(shot) {
  const map = {
    ultra_wide: 'Ultra wide', wide: 'Wide', standard: 'Standard', portrait: 'Portrait',
    telephoto: 'Telephoto', macro: 'Macro', probe: 'Probe', anamorphic: 'Anamorphic',
    fisheye: 'Fisheye', tilt_shift: 'Tilt shift', zoom: 'Zoom',
  };
  const base = shot.lens ? (map[shot.lens] || shot.lens) : '';
  if (base && shot.lens_detail) return `${base} · ${shot.lens_detail}`;
  return base || shot.lens_detail || '';
}

// lineBreak:false does not stop PDFKit wrapping inside a constrained width, so
// anything drawn in a fixed-width cell is trimmed to fit on one line first.
// Call it with the font and size already set.
function fitText(doc, text, width) {
  const s = String(text == null ? '' : text);
  if (!s || doc.widthOfString(s) <= width) return s;
  const ell = '…';
  let out = s;
  while (out.length > 1 && doc.widthOfString(out + ell) > width) out = out.slice(0, -1);
  return out.trimEnd() + ell;
}

function characterNames(shot, charactersByShot) {
  return (charactersByShot.get(shot.id) || [])
    .map(c => {
      if (c.performer) return `${c.name} (${c.performer})`;
      const age = fmtAgeRange(c.age_min, c.age_max);
      return age ? `${c.name} (casting ${age})` : c.name;
    })
    .join(', ');
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
function drawHeader(doc, { agency, shotlist, orderLabel, subtitle, totals }, ML, MR, PW, y) {
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

  const rightW = 260;
  const rightX = PW - MR - rightW;
  let ry = y;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED)
    .text(subtitle, rightX, ry, { width: rightW, align: 'right', lineBreak: false });
  ry += 12;
  doc.fontSize(15).font('Helvetica-Bold').fillColor(INK)
    .text(shotlist.title || 'Shot list', rightX, ry, { width: rightW, align: 'right', lineBreak: false });
  ry += 20;

  const bits = [];
  if (totals && totals.scene_count) bits.push(`${totals.scene_count} scenes · ${totals.shot_count} shots`);
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

// The band that opens every day: crew call is labelled distinctly from the
// first shot call so nobody confuses the two.
function drawDayBand(doc, { day, totals }, ML, MR, PW, y, index) {
  const CW = PW - ML - MR;
  const H = 34;
  doc.rect(ML, y, CW, H).fill(BAND);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(INK)
    .text(`DAY ${day.day_number || index + 1}`, ML + 8, y + 7, { width: 70, lineBreak: false });
  doc.fontSize(9).font('Helvetica').fillColor(SOFT)
    .text(fmtDate(day.shoot_date), ML + 78, y + 8, { width: 90, lineBreak: false });

  // Each label carries a short form: the same band is drawn on the landscape
  // call sheet and on the narrower portrait photo board, and a label that does
  // not fit its cell wraps down onto the figure underneath it.
  const cells = [
    ['CREW CALL', 'CALL', totals.crew_call || '—'],
    ['FIRST SHOT', '1ST SHOT', totals.first_shot_call || '—'],
    ['WRAP', 'WRAP', totals.wrap || '—'],
    ['ON SET', 'ON SET', fmtDuration(totals.on_set_minutes)],
    ['SHOOTING', 'SHOOT', fmtDuration(totals.shooting_minutes)],
    ['TRAVEL', 'TRAVEL', fmtDuration(totals.travel_minutes)],
    ['BREAKS', 'BREAKS', fmtDuration(totals.break_minutes)],
    ['CLIP', 'CLIP', fmtClip(totals.clip_seconds)],
  ];
  const cellW = (CW - 180) / cells.length;
  const usable = cellW - 4;
  doc.fontSize(6.5).font('Helvetica-Bold');
  cells.forEach(([label, short, value], i) => {
    const x = ML + 180 + i * cellW;
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(MUTED)
      .text(fitText(doc, doc.widthOfString(label) <= usable ? label : short, usable),
        x, y + 6, { width: usable, lineBreak: false });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(INK)
      .text(fitText(doc, value, usable), x, y + 17, { width: usable, lineBreak: false });
  });
  return y + H + 8;
}

// ── Call sheet ────────────────────────────────────────────────────────────────
// Landscape A4. One row per scene with its coverage stacked inside, and the
// company moves and breaks printed inline in the running order.

function callSheetPdf(res, { shotlist, bundle, agency, orderLabel }) {
  const PDFDocument = require('pdfkit');
  const safeTitle = (shotlist.title || 'shotlist').replace(/[^a-z0-9]/gi, '-').slice(0, 40);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Call-Sheet-${safeTitle}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: true });
  doc.pipe(res);

  const ML = 28, MR = 28, MT = 28, MB = 30;
  const PW = doc.page.width;   // 842
  const PH = doc.page.height;  // 595
  const CW = PW - ML - MR;

  const newPageSetup = () => doc.rect(0, 0, PW, PH).fill('#FFFFFF');
  newPageSetup();

  let y = drawHeader(doc, { agency, shotlist, orderLabel, subtitle: 'CALL SHEET', totals: bundle.totals }, ML, MR, PW, MT);
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.7).stroke();
  y += 10;

  // Column grid — widths sum to CW (786)
  const widths = {
    nr: 24, time: 44, space: 28, light: 88, location: 80,
    scene: 96, shot: 128, characters: 90, lens: 68, clip: 34, set: 68, props: 38,
  };
  const order = ['nr', 'time', 'space', 'light', 'location', 'scene', 'shot', 'characters', 'lens', 'clip', 'set', 'props'];
  const labels = {
    nr: '#', time: 'TIME', space: 'I/E', light: 'LIGHT WINDOW', location: 'LOCATION',
    scene: 'SCENE', shot: 'SHOTS', characters: 'CHARACTERS', lens: 'LENS', clip: 'CLIP',
    set: 'SET DESIGN', props: 'PROPS',
  };
  const C = {};
  let cx = ML;
  order.forEach(k => { C[k] = { x: cx, w: widths[k] - 5 }; cx += widths[k]; });

  const HEADER_H = 16;
  function drawTableHeader(atY) {
    doc.rect(ML, atY, CW, HEADER_H).fill(BAND);
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#444444');
    order.forEach(k => doc.text(labels[k], C[k].x, atY + 5, { width: C[k].w, lineBreak: false }));
    return atY + HEADER_H;
  }

  const cellFont = () => doc.fontSize(7).font('Helvetica');
  const needsPage = h => y + h > PH - MB;

  bundle.timelines.forEach((timeline, dayIndex) => {
    if (needsPage(80)) { doc.addPage(); newPageSetup(); y = MT; }
    y = drawDayBand(doc, { day: timeline.day, totals: timeline.totals }, ML, MR, PW, y, dayIndex);
    y = drawTableHeader(y);
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();

    let zebra = 0;
    timeline.items.forEach(item => {
      // Moves and breaks print as their own inline bands, in running order.
      if (item.kind === 'move' || item.kind === 'break') {
        const H = 15;
        if (needsPage(H)) {
          doc.addPage(); newPageSetup(); y = MT;
          y = drawTableHeader(y);
        }
        doc.rect(ML, y, CW, H).fill(item.kind === 'move' ? MOVE_BG : BREAK_BG);
        doc.fontSize(7).font('Helvetica-Bold').fillColor(INK)
          .text(item.start_label, C.time.x, y + 4, { width: C.time.w, lineBreak: false });
        const text = item.kind === 'move'
          ? `COMPANY MOVE   ${item.from_name} » ${item.to_name}   ${item.duration_minutes} min  (wrap ${item.wrap_minutes} + travel ${item.travel_minutes} + setup ${item.setup_minutes})`
            + `${item.locked ? `   [DEPARTS ${item.locked_time}]` : ''}`
          : `${String(item.break_kind || 'break').toUpperCase()}   ${item.label}   ${item.duration_minutes} min`
            + `${item.location_name ? `   at ${item.location_name}` : ''}`
            + `${item.fixed ? '   [FIXED]' : ''}`;
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#333333')
          .text(text, C.space.x, y + 4, { width: CW - (C.space.x - ML) - 4, lineBreak: false });
        y += H;
        return;
      }

      const scene = bundle.scenesById.get(item.scene_id) || {};
      const shots = bundle.shotsByScene.get(item.scene_id) || [];
      const loc = scene.location_id != null ? bundle.locationsById.get(scene.location_id) : null;

      const shotText = shots.length
        ? shots.map((sh, i) => `${sh.shot_number || i + 1}. ${sh.title || 'Untitled'}${sh.shot_type ? ` (${sh.shot_type})` : ''}${sh.locked_start_time ? ` [LOCK ${sh.locked_start_time}]` : ''}`).join('\n')
        : '—';
      const castNames = [];
      shots.forEach(sh => {
        (bundle.charactersByShot.get(sh.id) || []).forEach(c => {
          if (!castNames.includes(c.name)) castNames.push(c.name);
        });
      });
      const lensText = shots.map(sh => lensLabel(sh)).filter(Boolean);
      const uniqueLens = [...new Set(lensText)].join('\n');
      const setText = [scene.set_design, ...shots.map(sh => sh.set_design)].filter(Boolean).join(' / ');
      const propsText = [...new Set(shots.map(sh => (sh.props || '').trim()).filter(Boolean))].join(', ');

      const values = {
        nr: `${scene.scene_number || ''}`.trim(),
        time: `${item.start_label}${item.locked ? '\nLOCKED' : ''}`,
        space: scene.space === 'interior' ? 'INT' : 'EXT',
        light: item.light_window_label
          ? `${item.light_window_label}${item.light_window_range ? `\n${item.light_window_range}` : ''}` : '',
        location: loc ? loc.name : '',
        scene: scene.title || '',
        shot: shotText,
        characters: castNames.join(', '),
        lens: uniqueLens,
        clip: item.clip_seconds ? fmtClip(item.clip_seconds) : '',
        set: setText,
        props: propsText,
      };

      cellFont();
      let rowH = 15;
      order.forEach(k => {
        const h = doc.heightOfString(String(values[k] || ''), { width: C[k].w });
        rowH = Math.max(rowH, h + 7);
      });

      if (needsPage(rowH)) {
        doc.addPage(); newPageSetup(); y = MT;
        y = drawTableHeader(y);
        doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
      }

      if (zebra % 2 === 1) doc.rect(ML, y, CW, rowH).fill(ZEBRA);
      zebra++;

      order.forEach(k => {
        if (k === 'nr' || k === 'time' || k === 'scene') doc.fontSize(7).font('Helvetica-Bold').fillColor(INK);
        else doc.fontSize(7).font('Helvetica').fillColor('#333333');
        doc.text(String(values[k] || ''), C[k].x, y + 4, { width: C[k].w });
      });

      y += rowH;
      doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(HAIR).lineWidth(0.3).stroke();
    });

    y += 12;
  });

  if (shotlist.notes) {
    if (needsPage(40)) { doc.addPage(); newPageSetup(); y = MT; }
    doc.fontSize(7).font('Helvetica-Bold').fillColor(MUTED).text('NOTES', ML, y, { lineBreak: false });
    y += 11;
    doc.fontSize(8).font('Helvetica').fillColor('#444444').text(shotlist.notes, ML, y, { width: CW });
  }

  doc.end();
}

// ── Photo board ───────────────────────────────────────────────────────────────
// Portrait A4, same day and scene structure: a day band, a scene heading, then
// a block per shot with its images, and character photos where present.

function photoBoardPdf(res, { shotlist, bundle, agency, orderLabel }) {
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

  let y = drawHeader(doc, { agency, shotlist, orderLabel, subtitle: 'PHOTO BOARD', totals: bundle.totals }, ML, MR, PW, MT);
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.7).stroke();
  y += 12;

  const IMG_W = 150;
  const IMG_H = 112;
  const TEXT_X = ML + IMG_W + 14;
  const TEXT_W = CW - IMG_W - 14;
  const needsPage = h => y + h > PH - MB;

  bundle.timelines.forEach((timeline, dayIndex) => {
    if (needsPage(120)) { doc.addPage(); newPageSetup(); y = MT; }
    y = drawDayBand(doc, { day: timeline.day, totals: timeline.totals }, ML, MR, PW, y, dayIndex);

    timeline.items.forEach(item => {
      if (item.kind === 'move' || item.kind === 'break') {
        if (needsPage(26)) { doc.addPage(); newPageSetup(); y = MT; }
        doc.rect(ML, y, CW, 18).fill(item.kind === 'move' ? MOVE_BG : BREAK_BG);
        const text = item.kind === 'move'
          ? `${item.start_label}   COMPANY MOVE   ${item.from_name} » ${item.to_name}   ${item.duration_minutes} min (wrap ${item.wrap_minutes} + travel ${item.travel_minutes} + setup ${item.setup_minutes})`
            + `${item.locked ? `   [DEPARTS ${item.locked_time}]` : ''}`
          : `${item.start_label}   ${item.label.toUpperCase()}   ${item.duration_minutes} min`
            + `${item.location_name ? `   at ${item.location_name}` : ''}`
            + `${item.fixed ? '   [FIXED]' : ''}`;
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#333333')
          .text(text, ML + 8, y + 5, { width: CW - 16, lineBreak: false });
        y += 26;
        return;
      }

      const scene = bundle.scenesById.get(item.scene_id) || {};
      const shots = bundle.shotsByScene.get(item.scene_id) || [];
      const loc = scene.location_id != null ? bundle.locationsById.get(scene.location_id) : null;

      // Scene heading
      if (needsPage(90)) { doc.addPage(); newPageSetup(); y = MT; }
      doc.fontSize(7).font('Helvetica-Bold').fillColor(MUTED)
        .text(item.locked ? `SCENE · LOCKED ${item.locked_time}` : 'SCENE', ML, y, { lineBreak: false });
      y += 10;
      doc.fontSize(14).font('Helvetica-Bold').fillColor(INK)
        .text(`${scene.scene_number || ''}.  ${scene.title || 'Untitled scene'}`, ML, y, { width: CW });
      y = doc.y + 2;

      const bits = [
        item.start_label ? `${item.start_label}${item.duration_minutes ? `  ·  ${item.duration_minutes} min` : ''}` : '',
        scene.space === 'interior' ? 'Interior' : 'Exterior',
        item.light_window_label
          ? `${item.light_window_label}${item.light_window_range ? ` (${item.light_window_range})` : ''}` : '',
        loc ? [loc.name, loc.address].filter(Boolean).join(' — ') : '',
        item.clip_seconds ? `Clip ${fmtClip(item.clip_seconds)}` : '',
      ].filter(Boolean);
      doc.fontSize(8.5).font('Helvetica').fillColor(SOFT).text(bits.join('   ·   '), ML, y, { width: CW });
      y = doc.y + 3;

      if (scene.set_design) {
        doc.fontSize(8.5).font('Helvetica').fillColor('#333333')
          .text(`Set: ${scene.set_design}`, ML, y, { width: CW });
        y = doc.y + 2;
      }
      if (scene.description) {
        doc.fontSize(8.5).font('Helvetica').fillColor('#333333').text(scene.description, ML, y, { width: CW });
        y = doc.y + 3;
      }

      // Characters in the scene, with their photos where present
      const cast = [];
      shots.forEach(sh => {
        (bundle.charactersByShot.get(sh.id) || []).forEach(c => {
          if (!cast.some(x => x.id === c.id)) cast.push(c);
        });
      });
      if (cast.length) {
        if (needsPage(60)) { doc.addPage(); newPageSetup(); y = MT; }
        doc.fontSize(7).font('Helvetica-Bold').fillColor(MUTED).text('CHARACTERS', ML, y, { lineBreak: false });
        y += 10;
        let cx2 = ML;
        const CH_W = 62;
        const CH_H = 46;
        cast.forEach(c => {
          if (cx2 + CH_W > PW - MR) { cx2 = ML; y += CH_H + 22; }
          drawClippedImage(doc, pdfImagePath({ filename: c.photo_thumb_filename || c.photo_filename, thumb_filename: c.photo_thumb_filename }),
            cx2, y, CH_W, CH_H, '#FBFBFB');
          doc.fontSize(7).font('Helvetica-Bold').fillColor(INK)
            .text(fitText(doc, c.name, CH_W), cx2, y + CH_H + 2, { width: CH_W, lineBreak: false });
          // The performer once cast; until then the age the part is cast for,
          // which is what this sheet gets used for in pre-production.
          const age = fmtAgeRange(c.age_min, c.age_max);
          const sub = c.performer || (age ? `Casting ${age}` : '');
          if (sub) {
            doc.fontSize(6.5).font('Helvetica').fillColor(MUTED)
              .text(fitText(doc, sub, CH_W), cx2, y + CH_H + 11, { width: CH_W, lineBreak: false });
          }
          cx2 += CH_W + 8;
        });
        y += CH_H + 24;

        // Wardrobe under the cast strip: one row per dressed part, so the
        // board doubles as the continuity reference.
        const W_W = 46;
        const W_H = 60;
        cast.filter(c => (c.wardrobe || []).length).forEach(c => {
          if (needsPage(W_H + 30)) { doc.addPage(); newPageSetup(); y = MT; }
          doc.fontSize(6.5).font('Helvetica-Bold').fillColor(MUTED)
            .text(fitText(doc, `WARDROBE — ${String(c.name || '').toUpperCase()}`, PW - ML - MR),
              ML, y, { width: PW - ML - MR, lineBreak: false });
          y += 9;
          let wx = ML;
          c.wardrobe.forEach(w => {
            if (wx + W_W > PW - MR) { wx = ML; y += W_H + 14; }
            drawClippedImage(doc, pdfImagePath({ filename: w.thumb_filename || w.filename, thumb_filename: w.thumb_filename }),
              wx, y, W_W, W_H, '#FBFBFB');
            if (w.label) {
              doc.fontSize(6).font('Helvetica').fillColor(MUTED)
                .text(fitText(doc, w.label, W_W), wx, y + W_H + 2, { width: W_W, lineBreak: false });
            }
            wx += W_W + 6;
          });
          y += W_H + 16;
        });
      }

      doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
      y += 10;

      // A block per shot
      shots.forEach((shot, idx) => {
        const media = (bundle.media.get(shot.id) || []).slice(0, 2);
        const detailLines = [
          ['Type', shot.shot_type || ''],
          ['Capture', shot.duration_minutes ? `${shot.duration_minutes} min on the day` : ''],
          ['Clip', shot.clip_length_seconds ? `${fmtClip(shot.clip_length_seconds)} in the edit` : ''],
          ['Lens', lensLabel(shot)],
          ['Characters', characterNames(shot, bundle.charactersByShot)],
          ['Costume', shot.costume || ''],
          ['Props', shot.props || ''],
          ['Set', shot.set_design || ''],
          ['Camera', shot.camera_notes || ''],
          ['Description', shot.description || ''],
        ].filter(([, v]) => v);

        doc.fontSize(8.5).font('Helvetica');
        let textH = 20;
        detailLines.forEach(([, v]) => {
          textH += Math.max(11, doc.heightOfString(String(v), { width: TEXT_W - 62 }) + 2);
        });
        const imagesH = Math.min(media.length, 2) * (IMG_H + 12);
        const blockH = Math.max(textH, imagesH, 40);

        if (needsPage(blockH)) { doc.addPage(); newPageSetup(); y = MT; }
        const blockTop = y;

        let iy = blockTop;
        media.forEach(m => {
          drawClippedImage(doc, pdfImagePath(m), ML, iy, IMG_W, IMG_H, HAIR);
          doc.fontSize(6.5).font('Helvetica-Bold').fillColor(MUTED)
            .text(m.kind === 'scout' ? 'SCOUT' : 'REFERENCE', ML, iy + IMG_H + 2, { width: IMG_W, lineBreak: false });
          iy += IMG_H + 12;
        });
        if (media.length === 0) {
          doc.rect(ML, blockTop, IMG_W, 40).fill('#FBFBFB');
          doc.fontSize(7).font('Helvetica').fillColor(MUTED)
            .text('No photos', ML, blockTop + 16, { width: IMG_W, align: 'center', lineBreak: false });
        }

        let ty = blockTop;
        doc.fontSize(11).font('Helvetica-Bold').fillColor(INK)
          .text(`Shot ${shot.shot_number || idx + 1}  ·  ${shot.title || 'Untitled shot'}${shot.locked_start_time ? `  · LOCKED ${shot.locked_start_time}` : ''}`,
            TEXT_X, ty, { width: TEXT_W });
        ty = doc.y + 4;

        detailLines.forEach(([k, v]) => {
          doc.fontSize(7).font('Helvetica-Bold').fillColor(MUTED)
            .text(k.toUpperCase(), TEXT_X, ty + 1, { width: 56, lineBreak: false });
          doc.fontSize(8.5).font('Helvetica').fillColor('#333333')
            .text(String(v), TEXT_X + 60, ty, { width: TEXT_W - 62 });
          ty = Math.max(doc.y, ty + 11) + 1;
        });

        y = Math.max(ty, blockTop + (media.length ? media.length * (IMG_H + 12) : 40)) + 14;
        doc.moveTo(ML, y - 7).lineTo(PW - MR, y - 7).strokeColor(HAIR).lineWidth(0.4).stroke();
      });

      y += 6;
    });
  });

  doc.end();
}

module.exports = { callSheetPdf, photoBoardPdf };
