const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

const FLAT_FEE_CATS = new Set([
  'Video Editing', 'Color Grading', 'VFX / Motion Graphics',
  'Podcast / Audio Production', 'Branding & Identity',
  'Graphic Design', 'Web Design', 'Social Media Content Management',
]);

function getBudgetFull(id) {
  const budget = db.prepare(`
    SELECT b.*, p.title as project_title
    FROM budgets b
    LEFT JOIN projects p ON p.id = b.project_id
    WHERE b.id = ?
  `).get(id);
  if (!budget) return null;

  const lines = db.prepare(
    'SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY section, sort_order, id'
  ).all(id);

  return { ...budget, lines };
}

// GET /api/budgets
router.get('/', (req, res) => {
  const budgets = db.prepare(`
    SELECT b.*, p.title as project_title,
      (SELECT COALESCE(SUM(bl.amount), 0) FROM budget_lines bl WHERE bl.budget_id = b.id) as subtotal,
      CASE WHEN b.vat_enabled = 1
        THEN (SELECT COALESCE(SUM(bl.amount), 0) FROM budget_lines bl WHERE bl.budget_id = b.id) * (1 + b.vat_rate / 100.0)
        ELSE (SELECT COALESCE(SUM(bl.amount), 0) FROM budget_lines bl WHERE bl.budget_id = b.id)
      END as total
    FROM budgets b
    LEFT JOIN projects p ON p.id = b.project_id
    ORDER BY b.created_at DESC
  `).all();
  res.json(budgets);
});

// GET /api/budgets/:id
router.get('/:id', (req, res) => {
  const budget = getBudgetFull(parseInt(req.params.id));
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  res.json(budget);
});

// POST /api/budgets
router.post('/', (req, res) => {
  const { title, project_id, category, client_name, shoot_days, shoot_location, status, vat_enabled, vat_rate, notes, show_providers } = req.body;
  if (!title || !category) return res.status(400).json({ error: 'Title and category required' });

  const result = db.prepare(`
    INSERT INTO budgets (project_id, title, category, client_name, shoot_days, shoot_location, status, vat_enabled, vat_rate, notes, show_providers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project_id || null,
    title,
    category,
    client_name || null,
    shoot_days || 1,
    shoot_location || null,
    status || 'draft',
    vat_enabled ? 1 : 0,
    vat_rate != null ? vat_rate : 18,
    notes || null,
    show_providers ? 1 : 0,
  );

  res.json({ id: result.lastInsertRowid });
});

// PUT /api/budgets/:id
router.put('/:id', (req, res) => {
  const budget = db.prepare('SELECT id FROM budgets WHERE id = ?').get(req.params.id);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });

  const { title, project_id, category, client_name, shoot_days, shoot_location, status, vat_enabled, vat_rate, notes, show_providers } = req.body;

  db.prepare(`
    UPDATE budgets SET
      project_id = ?, title = ?, category = ?, client_name = ?,
      shoot_days = ?, shoot_location = ?, status = ?,
      vat_enabled = ?, vat_rate = ?, notes = ?, show_providers = ?
    WHERE id = ?
  `).run(
    project_id || null,
    title,
    category,
    client_name || null,
    shoot_days || 1,
    shoot_location || null,
    status || 'draft',
    vat_enabled ? 1 : 0,
    vat_rate != null ? vat_rate : 18,
    notes || null,
    show_providers ? 1 : 0,
    req.params.id,
  );

  res.json({ ok: true });
});

// DELETE /api/budgets/:id
router.delete('/:id', (req, res) => {
  const budget = db.prepare('SELECT id FROM budgets WHERE id = ?').get(req.params.id);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  db.prepare('DELETE FROM budgets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/budgets/:id/lines
router.post('/:id/lines', (req, res) => {
  const budget = db.prepare('SELECT id FROM budgets WHERE id = ?').get(req.params.id);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });

  const { section, position_label, description, crew_id, days, rate, amount, sort_order } = req.body;
  if (!section) return res.status(400).json({ error: 'Section required' });

  const result = db.prepare(`
    INSERT INTO budget_lines (budget_id, section, position_label, description, crew_id, days, rate, amount, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id, section,
    position_label || null, description || null, crew_id || null,
    days || 1, rate || 0, amount || 0, sort_order || 0,
  );

  res.json({ id: result.lastInsertRowid });
});

// PUT /api/budgets/:id/lines/:lineId
router.put('/:id/lines/:lineId', (req, res) => {
  const line = db.prepare('SELECT id FROM budget_lines WHERE id = ? AND budget_id = ?').get(req.params.lineId, req.params.id);
  if (!line) return res.status(404).json({ error: 'Line not found' });

  const { section, position_label, description, crew_id, days, rate, amount, sort_order } = req.body;

  db.prepare(`
    UPDATE budget_lines SET
      section = ?, position_label = ?, description = ?, crew_id = ?,
      days = ?, rate = ?, amount = ?, sort_order = ?
    WHERE id = ?
  `).run(
    section, position_label || null, description || null, crew_id || null,
    days || 1, rate || 0, amount || 0, sort_order || 0,
    req.params.lineId,
  );

  res.json({ ok: true });
});

// DELETE /api/budgets/:id/lines/:lineId
router.delete('/:id/lines/:lineId', (req, res) => {
  const line = db.prepare('SELECT id FROM budget_lines WHERE id = ? AND budget_id = ?').get(req.params.lineId, req.params.id);
  if (!line) return res.status(404).json({ error: 'Line not found' });
  db.prepare('DELETE FROM budget_lines WHERE id = ?').run(req.params.lineId);
  res.json({ ok: true });
});

// GET /api/budgets/:id/lines/batch-replace  (POST — replace all lines at once)
router.post('/:id/lines/batch-replace', (req, res) => {
  const budget = db.prepare('SELECT id FROM budgets WHERE id = ?').get(req.params.id);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });

  const { lines } = req.body;
  if (!Array.isArray(lines)) return res.status(400).json({ error: 'lines array required' });

  const deleteLines = db.prepare('DELETE FROM budget_lines WHERE budget_id = ?');
  const insertLine = db.prepare(`
    INSERT INTO budget_lines (budget_id, section, position_label, description, crew_id, days, rate, amount, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    deleteLines.run(req.params.id);
    lines.forEach((l, i) => {
      insertLine.run(
        req.params.id, l.section,
        l.position_label || null, l.description || null, l.crew_id || null,
        l.days || 1, l.rate || 0, l.amount || 0, l.sort_order != null ? l.sort_order : i,
      );
    });
  })();

  res.json({ ok: true });
});

// GET /api/budgets/:id/pdf
router.get('/:id/pdf', (req, res) => {
  const PDFDocument = require('pdfkit');

  const budget = getBudgetFull(parseInt(req.params.id));
  if (!budget) return res.status(404).json({ error: 'Budget not found' });

  const logoSetting = db.prepare("SELECT value FROM settings WHERE key = 'agency_logo'").get();
  const logoData = logoSetting && logoSetting.value ? logoSetting.value : null;
  const agencyNameRow = db.prepare("SELECT value FROM settings WHERE key = 'agency_name'").get();
  const agencyName = (agencyNameRow && agencyNameRow.value) ? agencyNameRow.value : 'MASSIV TV';

  const crewLines  = budget.lines.filter(l => l.section === 'crew');
  const equipLines = budget.lines.filter(l => l.section === 'equipment');
  const logLines   = budget.lines.filter(l => l.section === 'logistical');

  const activeSections = [
    { title: 'CREW COST',           num: '01', lines: crewLines,  isLog: false },
    { title: 'EQUIPMENT & RENTALS', num: '02', lines: equipLines, isLog: false },
    { title: 'LOGISTICAL COSTS',    num: '03', lines: logLines,   isLog: true  },
  ].filter(s => s.lines.length > 0);

  const HEADER_H     = 120;
  const INFO_H       = 90;
  const SEC_HEADER_H = 24;
  const TBL_HDR_H    = 20;
  const ROW_H        = 22;
  const SUB_ROW_H    = 22;
  const SEC_GAP      = 20;
  const totalsH      = budget.vat_enabled ? 100 : 68;
  const notesH       = budget.notes ? 46 : 0;

  const sectionsH = activeSections.reduce(
    (s, sec) => s + SEC_GAP + SEC_HEADER_H + TBL_HDR_H + sec.lines.length * ROW_H + SUB_ROW_H, 0
  );
  const totalContentH = HEADER_H + INFO_H + sectionsH +
    SEC_GAP + totalsH + (notesH ? SEC_GAP + notesH : 0) + 38;

  const PAGE_W = 595;
  const PAGE_H = 841;
  const scale  = totalContentH > PAGE_H ? PAGE_H / totalContentH : 1;
  const VW     = PAGE_W / scale;
  const VH     = PAGE_H / scale;

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const safeTitle = (budget.title || 'budget').replace(/[^a-z0-9]/gi, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Investment-Estimation-${safeTitle}.pdf"`);
  doc.pipe(res);

  const fmt = v => `€${Number(v || 0).toFixed(2)}`;

  function gradHex(t) {
    const r = Math.round(255 + (114 - 255) * t);
    const g = Math.round(144 + (60  - 144) * t);
    const b = Math.round(47  + (235 - 47 ) * t);
    return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
  }

  // Full-page background (physical coords, before transform)
  doc.rect(0, 0, PAGE_W, PAGE_H).fill('#131313');

  // Scale transform so all content fits one page
  doc.save();
  doc.transform(scale, 0, 0, scale, 0, 0);

  let y = 0;

  // Gradient accent bar
  const STEPS = 24;
  for (let i = 0; i < STEPS; i++) {
    doc.rect(i * (VW / STEPS), 0, VW / STEPS + 1, 4).fill(gradHex(i / (STEPS - 1)));
  }
  y = 4;

  // Header block
  doc.rect(0, y, VW, HEADER_H - 4).fill('#1e1e1e');

  if (logoData) {
    try {
      const imgBuf = Buffer.from(logoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      doc.image(imgBuf, 40, y + 28, { fit: [160, 52] });
    } catch (_) {
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text(agencyName, 40, y + 44, { lineBreak: false });
    }
  } else {
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text(agencyName, 40, y + 44, { lineBreak: false });
  }

  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#FFFFFF')
     .text('INVESTMENT ESTIMATION', 0, y + 30, { width: VW - 40, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#888888')
     .text(dateStr, 0, y + 62, { width: VW - 40, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#888888')
     .text(`Ref: #${String(budget.id).padStart(4, '0')}`, 0, y + 76, { width: VW - 40, align: 'right', lineBreak: false });

  y = HEADER_H;
  doc.moveTo(0, y).lineTo(VW, y).strokeColor('#2d2d2d').lineWidth(1).stroke();

  // Project info block
  doc.rect(0, y, VW, INFO_H).fill('#1a1a1a');

  const infoTop = y + 14;
  const halfW   = Math.floor(VW / 2) - 50;

  function drawInfo(label, val, x, iy) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#888888').text(label, x, iy, { lineBreak: false });
    doc.font('Helvetica').fontSize(9.5).fillColor('#FFFFFF').text(String(val || '—'), x, iy + 10, { width: halfW, lineBreak: false });
  }

  [['PROJECT', budget.title], ['CATEGORY', budget.category], ['CLIENT', budget.client_name || '—']]
    .forEach(([l, v], i) => drawInfo(l, v, 40, infoTop + i * 25));
  [['LOCATION', budget.shoot_location || '—'], ['SHOOT DAYS', String(budget.shoot_days || '—')], ['DATE', dateStr]]
    .forEach(([l, v], i) => drawInfo(l, v, Math.floor(VW / 2), infoTop + i * 25));

  y += INFO_H;
  doc.moveTo(0, y).lineTo(VW, y).strokeColor('#2d2d2d').lineWidth(0.5).stroke();

  // Sections
  let grandSubtotal = 0;

  activeSections.forEach(sec => {
    const secTotal = sec.lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    grandSubtotal += secTotal;
    y += SEC_GAP;

    doc.rect(0, y, VW, SEC_HEADER_H).fill('#242424');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF')
       .text(`SECTION ${sec.num} — ${sec.title}`, 40, y + 8, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF')
       .text(fmt(secTotal), 0, y + 8, { width: VW - 40, align: 'right', lineBreak: false });
    y += SEC_HEADER_H;

    doc.rect(0, y, VW, TBL_HDR_H).fill('#2a1f3d');
    if (sec.isLog) {
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#888888')
         .text('CATEGORY', 44, y + 7, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#888888')
         .text('DESCRIPTION', 44 + VW * 0.32, y + 7, { lineBreak: false });
    } else {
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#888888')
         .text('POSITION / SERVICE', 44, y + 7, { lineBreak: false });
    }
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#888888')
       .text('AMOUNT', 0, y + 7, { width: VW - 40, align: 'right', lineBreak: false });
    y += TBL_HDR_H;

    sec.lines.forEach((line, i) => {
      doc.rect(0, y, VW, ROW_H).fill(i % 2 === 0 ? '#1e1e1e' : '#242424');
      if (sec.isLog) {
        doc.font('Helvetica').fontSize(8).fillColor('#FFFFFF')
           .text(line.position_label || '', 44, y + 7, { width: VW * 0.28, lineBreak: false });
        doc.font('Helvetica').fontSize(8).fillColor('#CCCCCC')
           .text(line.description || '', 44 + VW * 0.32, y + 7, { width: VW * 0.38, lineBreak: false });
      } else {
        const showProvider = budget.show_providers && line.description;
        const label = showProvider
          ? `${line.position_label || ''} — ${line.description}`
          : (line.position_label || '');
        doc.font('Helvetica').fontSize(8).fillColor('#FFFFFF')
           .text(label, 44, y + 7, { width: VW * 0.60, lineBreak: false });
      }
      doc.font('Helvetica').fontSize(8).fillColor('#FFFFFF')
         .text(fmt(line.amount), 0, y + 7, { width: VW - 40, align: 'right', lineBreak: false });
      y += ROW_H;
    });

    doc.rect(0, y, VW, SUB_ROW_H).fill('#1a1a1a');
    doc.moveTo(0, y).lineTo(VW, y).strokeColor('#333333').lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor('#888888')
       .text('Subtotal', 40, y + 7, { lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor('#888888')
       .text(fmt(secTotal), 0, y + 7, { width: VW - 40, align: 'right', lineBreak: false });
    y += SUB_ROW_H;
  });

  // Totals block
  y += SEC_GAP;
  const vatAmount  = budget.vat_enabled ? grandSubtotal * (budget.vat_rate / 100) : 0;
  const totalFinal = grandSubtotal + vatAmount;

  doc.rect(0, y, VW, totalsH).fill('#1e1e1e');
  doc.rect(0, y, 3, totalsH).fill('#723CEB');

  let ty = y + 16;
  doc.font('Helvetica').fontSize(10).fillColor('#888888')
     .text('SUBTOTAL', 40, ty, { lineBreak: false });
  doc.font('Helvetica').fontSize(10).fillColor('#888888')
     .text(fmt(grandSubtotal), 0, ty, { width: VW - 40, align: 'right', lineBreak: false });
  ty += 20;

  if (budget.vat_enabled) {
    doc.font('Helvetica').fontSize(10).fillColor('#888888')
       .text(`VAT ${budget.vat_rate}%`, 40, ty, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor('#888888')
       .text(fmt(vatAmount), 0, ty, { width: VW - 40, align: 'right', lineBreak: false });
    ty += 16;
  }

  doc.moveTo(40, ty + 2).lineTo(VW - 40, ty + 2).strokeColor('#333333').lineWidth(0.5).stroke();
  ty += 10;

  if (budget.vat_enabled) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF')
       .text('TOTAL', 40, ty, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF')
       .text(fmt(grandSubtotal), 0, ty, { width: VW - 40, align: 'right', lineBreak: false });
    ty += 18;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#FF902F')
       .text('TOTAL INC. VAT', 40, ty, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#FF902F')
       .text(fmt(totalFinal), 0, ty, { width: VW - 40, align: 'right', lineBreak: false });
  } else {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF')
       .text('TOTAL', 40, ty, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF')
       .text(fmt(totalFinal), 0, ty, { width: VW - 40, align: 'right', lineBreak: false });
  }
  y += totalsH;

  // Notes
  if (budget.notes) {
    y += SEC_GAP;
    doc.rect(0, y, VW, notesH).fill('#1a1a1a');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#888888')
       .text('NOTES', 40, y + 10, { lineBreak: false });
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#888888')
       .text(budget.notes, 40, y + 22, { width: VW - 80, lineBreak: false });
    y += notesH;
  }

  // Footer
  const footerY = VH - 26;
  doc.moveTo(0, footerY).lineTo(VW, footerY).strokeColor('#333333').lineWidth(0.5).stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888')
     .text(agencyName, 40, footerY + 7, { lineBreak: false });
  doc.font('Helvetica').fontSize(7).fillColor('#555555')
     .text('This document is confidential and intended for the named client only.', 0, footerY + 8, { width: VW, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(7).fillColor('#555555')
     .text('built by year28', 0, footerY + 7, { width: VW - 40, align: 'right', lineBreak: false });

  doc.restore();
  doc.end();
});

module.exports = router;
