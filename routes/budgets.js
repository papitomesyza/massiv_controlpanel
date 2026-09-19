const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { documentFilename } = require('../lib/filename');

function validateLineFields({ days, rate, amount, discount }) {
  if (days !== undefined && days !== null) {
    const d = Number(days);
    if (!Number.isFinite(d) || d < 0) return 'days must be at least 0';
  }
  if (rate !== undefined && rate !== null) {
    const r = Number(rate);
    if (!Number.isFinite(r) || r < 0 || r > 1000000) return 'rate must be between 0 and 1,000,000';
  }
  if (amount !== undefined && amount !== null) {
    const a = Number(amount);
    if (!Number.isFinite(a) || a < 0 || a > 1000000) return 'amount must be between 0 and 1,000,000';
  }
  if (discount !== undefined && discount !== null) {
    const disc = Number(discount);
    if (!Number.isFinite(disc) || disc < 0 || disc > 1000000) return 'discount must be between 0 and 1,000,000';
  }
  return null;
}

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

  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const totalDiscount = lines.reduce((s, l) => {
    const amt = parseFloat(l.amount) || 0;
    const disc = parseFloat(l.discount) || 0;
    return s + Math.min(disc, amt);
  }, 0);
  const netSubtotal = subtotal - totalDiscount;
  const total = budget.vat_enabled ? netSubtotal * (1 + budget.vat_rate / 100) : netSubtotal;

  return { ...budget, lines, subtotal, total_discount: totalDiscount, net_subtotal: netSubtotal, total };
}

// GET /api/budgets
router.get('/', (req, res) => {
  const budgets = db.prepare(`
    SELECT b.*, p.title as project_title,
      (SELECT COALESCE(SUM(bl.amount), 0) FROM budget_lines bl WHERE bl.budget_id = b.id AND bl.section = 'crew') as crew_total,
      (SELECT COALESCE(SUM(bl.amount), 0) FROM budget_lines bl WHERE bl.budget_id = b.id AND bl.section = 'equipment') as equip_total,
      (SELECT COALESCE(SUM(bl.amount), 0) FROM budget_lines bl WHERE bl.budget_id = b.id AND bl.section = 'logistical') as log_total,
      (SELECT COUNT(*) FROM budget_lines bl WHERE bl.budget_id = b.id AND bl.price_pending = 1) as pending_count,
      (SELECT COALESCE(SUM(bl.amount), 0) FROM budget_lines bl WHERE bl.budget_id = b.id) as subtotal,
      (SELECT COALESCE(SUM(MIN(bl.discount, bl.amount)), 0) FROM budget_lines bl WHERE bl.budget_id = b.id) as total_discount,
      (SELECT COALESCE(SUM(MAX(bl.amount - bl.discount, 0)), 0) FROM budget_lines bl WHERE bl.budget_id = b.id) as net_subtotal,
      CASE WHEN b.vat_enabled = 1
        THEN (SELECT COALESCE(SUM(MAX(bl.amount - bl.discount, 0)), 0) FROM budget_lines bl WHERE bl.budget_id = b.id) * (1 + b.vat_rate / 100.0)
        ELSE (SELECT COALESCE(SUM(MAX(bl.amount - bl.discount, 0)), 0) FROM budget_lines bl WHERE bl.budget_id = b.id)
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
  if (vat_rate !== undefined && vat_rate !== null) {
    const vr = Number(vat_rate);
    if (!Number.isFinite(vr) || vr < 0 || vr > 100) return res.status(400).json({ error: 'vat_rate must be between 0 and 100' });
  }

  const result = db.prepare(`
    INSERT INTO budgets (project_id, title, category, client_name, shoot_days, shoot_location, status, vat_enabled, vat_rate, notes, show_providers, sent_at, responded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    req.body.sent_at || null,
    req.body.responded_at || null,
  );

  res.json({ id: result.lastInsertRowid });
});

// PUT /api/budgets/:id
router.put('/:id', (req, res) => {
  const budget = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });

  const { title, project_id, category, client_name, shoot_days, shoot_location, status, vat_enabled, vat_rate, notes, show_providers } = req.body;
  if (vat_rate !== undefined && vat_rate !== null) {
    const vr = Number(vat_rate);
    if (!Number.isFinite(vr) || vr < 0 || vr > 100) return res.status(400).json({ error: 'vat_rate must be between 0 and 100' });
  }

  // Pipeline timestamps are owned by the status endpoint, not the editor. A
  // plain save keeps whatever the timestamps already are unless the caller
  // explicitly sends new ones, so editing an estimate never resets its age.
  const sentAt = req.body.sent_at !== undefined ? req.body.sent_at : budget.sent_at;
  const respondedAt = req.body.responded_at !== undefined ? req.body.responded_at : budget.responded_at;

  db.prepare(`
    UPDATE budgets SET
      project_id = ?, title = ?, category = ?, client_name = ?,
      shoot_days = ?, shoot_location = ?, status = ?,
      vat_enabled = ?, vat_rate = ?, notes = ?, show_providers = ?,
      sent_at = ?, responded_at = ?
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
    sentAt || null,
    respondedAt || null,
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

// POST /api/budgets/:id/status: move one estimate through the pipeline without
// resending the whole record. Moving to sent stamps sent_at and clears any old
// reply; moving to accepted or rejected stamps responded_at; moving back to
// draft clears both, so a re-drafted estimate starts clean.
const ESTIMATE_STATUSES = new Set(['draft', 'sent', 'accepted', 'rejected']);
router.post('/:id/status', (req, res) => {
  const budget = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  if (!budget) return res.status(404).json({ error: 'Estimate not found' });

  const { status } = req.body;
  if (!ESTIMATE_STATUSES.has(status)) {
    return res.status(400).json({ error: 'status must be one of draft, sent, accepted, rejected' });
  }

  let sentAt = budget.sent_at;
  let respondedAt = budget.responded_at;
  if (status === 'draft') {
    sentAt = null;
    respondedAt = null;
  } else if (status === 'sent') {
    sentAt = new Date().toISOString();
    respondedAt = null;
  } else {
    // accepted or rejected
    if (!sentAt) sentAt = new Date().toISOString();
    respondedAt = new Date().toISOString();
  }

  db.prepare('UPDATE budgets SET status = ?, sent_at = ?, responded_at = ? WHERE id = ?')
    .run(status, sentAt, respondedAt, req.params.id);

  res.json(getBudgetFull(parseInt(req.params.id)));
});

// POST /api/budgets/:id/duplicate: copy an estimate and every line. Most
// estimates are variations of a previous one, so the copy resets to draft with
// no pipeline history and the title is suffixed so the two are told apart.
router.post('/:id/duplicate', (req, res) => {
  const src = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Estimate not found' });

  const lines = db.prepare(
    'SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY section, sort_order, id'
  ).all(src.id);

  const newId = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO budgets (project_id, title, category, client_name, shoot_days, shoot_location, status, vat_enabled, vat_rate, notes, show_providers, sent_at, responded_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, NULL, NULL)
    `).run(
      src.project_id, `${src.title} (Copy)`, src.category, src.client_name,
      src.shoot_days, src.shoot_location, src.vat_enabled, src.vat_rate, src.notes, src.show_providers,
    );
    const nid = r.lastInsertRowid;
    const ins = db.prepare(`
      INSERT INTO budget_lines (budget_id, section, position_label, description, crew_id, days, rate, amount, sort_order, discount, price_pending)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    lines.forEach(l => ins.run(
      nid, l.section, l.position_label, l.description, l.crew_id,
      l.days, l.rate, l.amount, l.sort_order, l.discount, l.price_pending ? 1 : 0,
    ));
    return nid;
  })();

  res.json({ id: newId });
});

// POST /api/budgets/:id/project: turn an accepted estimate into a project,
// mirroring the create-invoice-from-estimate flow. The estimate total becomes
// the agreed budget, the category maps to the matching project category, and
// the estimate is linked to the new project.
const PROJECT_PHASES = ['Development', 'Pre-Production', 'Production', 'Post-Production'];
router.post('/:id/project', (req, res) => {
  const budget = getBudgetFull(parseInt(req.params.id));
  if (!budget) return res.status(404).json({ error: 'Estimate not found' });

  // Resolve the client: prefer the client already on a linked project, else
  // match the estimate's free-text client name against the clients table.
  let clientId = null;
  if (budget.project_id) {
    const proj = db.prepare('SELECT client_id FROM projects WHERE id = ?').get(budget.project_id);
    if (proj && proj.client_id) clientId = proj.client_id;
  }
  if (!clientId && budget.client_name) {
    const match = db.prepare('SELECT id FROM clients WHERE name = ? OR company = ? LIMIT 1')
      .get(budget.client_name, budget.client_name);
    if (match) clientId = match.id;
  }

  const cat = db.prepare('SELECT id FROM project_categories WHERE name = ? LIMIT 1').get(budget.category);
  const categoryId = cat ? cat.id : null;

  try {
    const result = db.prepare(
      'INSERT INTO projects (client_id, title, category_id, agreed_budget, notes, shoot_days, shoot_location, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      clientId, budget.title, categoryId, budget.total || 0,
      budget.notes || null, budget.shoot_days || 1, budget.shoot_location || null,
      PROJECT_PHASES[0].toLowerCase().replace(/ /g, '-'),
    );
    const projectId = result.lastInsertRowid;

    const insertPhase = db.prepare('INSERT INTO project_phases (project_id, phase_name, order_index, status) VALUES (?, ?, ?, ?)');
    PROJECT_PHASES.forEach((name, i) => insertPhase.run(projectId, name, i, i === 0 ? 'active' : 'pending'));

    // Link the estimate to the project it produced, if it was not already tied
    // to one, so the two stay connected.
    if (!budget.project_id) {
      db.prepare('UPDATE budgets SET project_id = ? WHERE id = ?').run(projectId, budget.id);
    }

    res.json({ id: projectId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/budgets/:id/lines
router.post('/:id/lines', (req, res) => {
  const budget = db.prepare('SELECT id FROM budgets WHERE id = ?').get(req.params.id);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });

  const { section, position_label, description, crew_id, days, rate, amount, sort_order, discount, price_pending } = req.body;
  if (!section) return res.status(400).json({ error: 'Section required' });
  const lineErr = validateLineFields({ days, rate, amount, discount });
  if (lineErr) return res.status(400).json({ error: lineErr });

  // A price pending line contributes nothing until it is priced, so its amount
  // is forced to zero here. This keeps every total calculation untouched.
  const pending = price_pending ? 1 : 0;
  const storedAmount = pending ? 0 : (amount || 0);

  const result = db.prepare(`
    INSERT INTO budget_lines (budget_id, section, position_label, description, crew_id, days, rate, amount, sort_order, discount, price_pending)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id, section,
    position_label || null, description || null, crew_id || null,
    days || 1, rate || 0, storedAmount, sort_order || 0,
    discount != null ? discount : 0, pending,
  );

  res.json({ id: result.lastInsertRowid });
});

// PUT /api/budgets/:id/lines/:lineId
router.put('/:id/lines/:lineId', (req, res) => {
  const line = db.prepare('SELECT id FROM budget_lines WHERE id = ? AND budget_id = ?').get(req.params.lineId, req.params.id);
  if (!line) return res.status(404).json({ error: 'Line not found' });

  const { section, position_label, description, crew_id, days, rate, amount, sort_order, discount, price_pending } = req.body;
  const lineErr2 = validateLineFields({ days, rate, amount, discount });
  if (lineErr2) return res.status(400).json({ error: lineErr2 });

  const pending = price_pending ? 1 : 0;
  const storedAmount = pending ? 0 : (amount || 0);

  db.prepare(`
    UPDATE budget_lines SET
      section = ?, position_label = ?, description = ?, crew_id = ?,
      days = ?, rate = ?, amount = ?, sort_order = ?, discount = ?, price_pending = ?
    WHERE id = ?
  `).run(
    section, position_label || null, description || null, crew_id || null,
    days || 1, rate || 0, storedAmount, sort_order || 0,
    discount != null ? discount : 0, pending,
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
    INSERT INTO budget_lines (budget_id, section, position_label, description, crew_id, days, rate, amount, sort_order, discount, price_pending)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const l of lines) {
    const err = validateLineFields({ days: l.days, rate: l.rate, amount: l.amount, discount: l.discount });
    if (err) return res.status(400).json({ error: err });
  }

  db.transaction(() => {
    deleteLines.run(req.params.id);
    lines.forEach((l, i) => {
      // Forcing a price pending line to zero keeps it out of every total while
      // still recording that the line exists and is yet to be priced.
      const pending = l.price_pending ? 1 : 0;
      const storedAmount = pending ? 0 : (l.amount || 0);
      insertLine.run(
        req.params.id, l.section,
        l.position_label || null, l.description || null, l.crew_id || null,
        l.days || 1, l.rate || 0, storedAmount, l.sort_order != null ? l.sort_order : i,
        l.discount != null ? l.discount : 0, pending,
      );
    });
  })();

  res.json({ ok: true });
});


// GET /api/budgets/:id/pdf
//
// The estimate PDF shares the invoice's visual language: a white page, the same
// typeface and grey values, the same rule weights and spacing rhythm. It is
// drawn in real A4 coordinates with no canvas transform. When the content is
// taller than one page, every layout constant, coordinate and font size is
// multiplied by a single scale factor so it still fits, down to a legibility
// floor. Below that floor the document paginates instead of shrinking further.
router.get('/:id/pdf', (req, res) => {
  const PDFDocument = require('pdfkit');

  const budget = getBudgetFull(parseInt(req.params.id));
  if (!budget) return res.status(404).json({ error: 'Budget not found' });

  // How long the estimate stands, counted from the estimate date. Named once so
  // a future change to the validity window is a single edit.
  const VALIDITY_DAYS = 30;
  // An estimate is squeezed onto one page only while it stays legible. Below
  // this scale text drops under roughly 6pt, so past it the document paginates
  // rather than sending the client a page they cannot read.
  const LEGIBILITY_FLOOR = 0.75;

  const getSetting = (key, fallback = null) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row && row.value != null ? row.value : fallback;
  };

  // Company identity is pulled from the same settings the invoice uses, so the
  // two documents read as one company. Payment fields (bank, account, SWIFT)
  // are deliberately not read here: an estimate carries no payment furniture.
  const companyName = getSetting('invoice_billing_name')
    || getSetting('agency_name') || 'MASSIV TV';
  const companyAddr = getSetting('invoice_billing_address', '');
  const companyTel  = getSetting('invoice_billing_tel', '');
  const companyNr   = getSetting('invoice_billing_nr_unik', '');
  const logoData    = getSetting('invoice_logo') || getSetting('agency_logo');

  const crewLines  = budget.lines.filter(l => l.section === 'crew');
  const equipLines = budget.lines.filter(l => l.section === 'equipment');
  const logLines   = budget.lines.filter(l => l.section === 'logistical');

  const activeSections = [
    { title: 'CREW COST',           num: '01', lines: crewLines,  isLog: false },
    { title: 'EQUIPMENT & RENTALS', num: '02', lines: equipLines, isLog: false },
    { title: 'LOGISTICAL COSTS',    num: '03', lines: logLines,   isLog: true  },
  ].filter(s => s.lines.length > 0);

  // ── Money and dates ──────────────────────────────────────────────────────
  const fmtMoney = v => `€${Number(v || 0).toFixed(2)}`;
  const fmtDate = d => {
    if (!d) return '';
    const date = new Date(String(d).includes('T') ? d : d + 'T00:00:00');
    if (isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${date.getFullYear()}`;
  };

  const estimateDate = budget.created_at
    ? new Date(String(budget.created_at).includes('T') ? budget.created_at : budget.created_at.replace(' ', 'T'))
    : new Date();
  const baseDate = isNaN(estimateDate.getTime()) ? new Date() : estimateDate;
  const validUntil = new Date(baseDate.getTime());
  validUntil.setDate(validUntil.getDate() + VALIDITY_DAYS);

  const refStr        = `#${String(budget.id).padStart(4, '0')}`;
  const totalDiscount = budget.total_discount || 0;
  const hasDiscount   = totalDiscount > 0;
  const vatOn         = !!budget.vat_enabled;

  // ── Page geometry (real A4 coordinates) ──────────────────────────────────
  const ML = 50, MR = 50, MT = 45, MB = 40;
  const PW = 595, PH = 842, CW = PW - ML - MR;   // 495
  const usableH = PH - MT - MB;
  // Right hand identity column (the PREPARED FOR block). Its width is fixed
  // page geometry: it does not scale with the font, so a value wraps inside it
  // rather than running into the section table. Declared here so the same width
  // drives both the content height measurement and the drawing.
  const rightColX = ML + CW * 0.52;
  const rightColW = PW - MR - rightColX;

  // ── Base metrics at scale 1. Every value below is multiplied by the scale
  //    factor S at draw time, so nothing is ever drawn past the page height.
  //    Blocks whose height depends on how a value wraps (the PREPARED FOR
  //    block, the notes) are not listed here as fixed constants: their height
  //    is measured with doc.heightOfString so a wrapped value is accounted for
  //    rather than assumed to be a single line. ──
  const B = {
    headerH:   66,   // logo / company identity block
    ruleGap:   14,
    titleH:    28,   // ESTIMATE title
    metaRow:   14,   // ref / date / validity rows
    secGap:    16,
    secTitleH: 18,
    tblHdrH:   16,
    rowH:      19,
    subRowH:   18,
    totalRow:  14,
    totalGap:  8,
    totalBigH: 20,
    notesHead: 14,
    sigH:      64,
    fieldGap:   4,   // vertical gap between stacked, flowing fields
  };

  // ── Document ──────────────────────────────────────────────────────────────
  // The document is created before the scale is chosen so its own text
  // measurement (doc.heightOfString) can drive the one page decision. Nothing
  // is drawn until the scale is known.
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, bufferPages: true });

  const INK = '#111111', INK_SOFT = '#333333', GREY = '#666666', MUTED = '#999999';
  const HAIR = '#EEEEEE', RULE = '#CCCCCC', BAR = '#F2F2F2', ZEBRA = '#FAFAFA';

  // Measure the height a value actually occupies when wrapped inside a fixed
  // width column, at a given scale, capped to maxLines lines. The same routine
  // both chooses the page scale (measured at scale 1, an upper bound on the
  // final height) and advances the cursor while drawing (measured at the chosen
  // scale). Because a smaller font wraps to no more lines than a larger one, a
  // scale 1 measurement never under counts the scaled draw, so the one page
  // guarantee holds even when several values wrap.
  function measureText(text, size, width, { font = 'Helvetica', maxLines = 0, lineGap = 0, scale = 1 } = {}) {
    doc.font(font).fontSize(size * scale);
    const natural = doc.heightOfString(text == null ? '' : String(text), { width, lineGap, lineBreak: true });
    if (maxLines > 0) {
      const maxH = maxLines * doc.currentLineHeight(true) + lineGap * (maxLines - 1);
      return Math.min(natural, maxH);
    }
    return natural;
  }

  // Height of a stack of flowing fields: each field's measured height plus a
  // fixed gap after it. Used to reserve room for the PREPARED FOR block.
  function stackHeight(fields, width, scale) {
    return fields.reduce(
      (h, f) => h + measureText(f.text, f.size, width, { font: f.font, maxLines: f.maxLines, scale }) + B.fieldGap * scale,
      0,
    );
  }

  // Client facing location. A full Google formatted address, for example
  // "Pristina, Municipality of Pristina, District of Prishtina, 10000, Kosovo",
  // is machine formatting a client does not need to read. For the PDF only,
  // when it has more than two comma separated parts keep just the first and the
  // last ("Pristina, Kosovo"); two parts or fewer print unchanged. The full
  // address is left untouched everywhere else in the app.
  function shortenLocation(addr) {
    const parts = String(addr || '').split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length > 2) return `${parts[0]}, ${parts[parts.length - 1]}`;
    return addr;
  }

  // The PREPARED FOR block as an ordered list of flowing fields, so a long
  // value pushes the ones below it down instead of overlapping them. Wrapping
  // values are capped at two lines.
  const projRows = [
    ['CATEGORY', budget.category || '-'],
    ['CLIENT', budget.client_name || '-'],
    ['LOCATION', shortenLocation(budget.shoot_location) || '-'],
    ['SHOOT DAYS', String(budget.shoot_days || '-')],
  ];
  const preparedFields = [
    { text: 'PREPARED FOR', size: 8, font: 'Helvetica-Bold', color: MUTED, maxLines: 1 },
    { text: budget.title || '-', size: 12, font: 'Helvetica-Bold', color: INK, maxLines: 2 },
    ...projRows.map(([lbl, val]) => ({
      text: `${lbl}: ${val}`, size: 8.5, font: 'Helvetica', color: INK_SOFT, maxLines: 2,
    })),
  ];

  // ── Measure total content height at scale 1 to choose the scale factor ──
  // The identity row height is the taller of the two columns, both measured so
  // a wrapped title, client name or location is counted, not assumed. The left
  // column's meta rows (ref, date, validity) are single line, so their height
  // does not depend on the exact column width.
  const leftColH = measureText('ESTIMATE', 22, CW, { font: 'Helvetica-Bold', maxLines: 1, scale: 1 }) + B.fieldGap
    + 3 * (measureText('Ag', 9, rightColW, { maxLines: 1, scale: 1 }) + B.fieldGap);
  const rightColH = stackHeight(preparedFields, rightColW, 1);
  const identityH = Math.max(leftColH, rightColH);

  const sectionsH = activeSections.reduce(
    (s, sec) => s + B.secGap + B.secTitleH + B.tblHdrH + sec.lines.length * B.rowH + B.subRowH, 0
  );

  // Totals rows are single line (money never wraps), but they flow like every
  // other block: each row advances by its measured height plus a gap, so the
  // reservation is measured the same way rather than assumed from a constant.
  const totalsMoneyRows = 1 + (hasDiscount ? 2 : 0) + (vatOn ? 1 : 0);
  const totalMoneyRowH = measureText('Ag', 9, 150, { maxLines: 1, scale: 1 }) + B.fieldGap;
  const totalBigRowH   = measureText('Ag', 12, 150, { maxLines: 1, scale: 1 }) + B.fieldGap;
  const totalsH = totalsMoneyRows * totalMoneyRowH + B.totalGap + totalBigRowH;

  const notesText = (budget.notes || '').trim();
  const notesH = notesText
    ? B.notesHead + measureText(notesText, 8.5, CW, { font: 'Helvetica-Oblique', lineGap: 1, scale: 1 })
    : 0;

  const contentH = B.headerH + B.ruleGap + identityH + B.secGap + sectionsH
    + B.secGap + totalsH
    + (notesText ? B.secGap + notesH : 0)
    + B.secGap + B.sigH;

  // A 2pt slack keeps the single page path from spilling on rounding.
  const rawScale = (usableH - 2) / contentH;
  const paginate = rawScale < LEGIBILITY_FLOOR;
  const S = paginate ? LEGIBILITY_FLOOR : Math.min(1, rawScale);

  // Scaled metrics used from here on.
  const m = {};
  Object.keys(B).forEach(k => { m[k] = B[k] * S; });

  const downloadName = documentFilename('Estimate', budget.id, budget.title);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}.pdf"`);
  doc.pipe(res);

  // Text helper: font sizes are given in base points and scaled by S here.
  function txt(text, x, y, size, opts = {}, font = 'Helvetica', color = INK_SOFT) {
    doc.font(font).fontSize(size * S).fillColor(color)
       .text(text == null ? '' : String(text), x, y, { lineBreak: false, ...opts });
  }

  // Draw one flowing field: wrap it inside its column, cap it at maxLines with
  // an ellipsis beyond that, and return the height it occupied (at scale S) so
  // the caller can advance the cursor by the real height and never overlap the
  // field below. Measured with the same font, size and width used to draw it.
  function drawFlow(field, x, yPos, width, extraOpts = {}) {
    const { text, size, font, color, maxLines = 0, lineGap = 0 } = field;
    const h = measureText(text, size, width, { font, maxLines, lineGap, scale: S });
    const opts = { width, lineGap, lineBreak: true, ...extraOpts };
    if (maxLines > 0) { opts.height = maxLines * doc.currentLineHeight(true) + lineGap * (maxLines - 1); opts.ellipsis = true; }
    doc.font(font).fontSize(size * S).fillColor(color)
       .text(text == null ? '' : String(text), x, yPos, opts);
    return h;
  }

  function newPageSetup() { doc.rect(0, 0, PW, PH).fill('#FFFFFF'); }
  newPageSetup();

  let y = MT;

  // ── HEADER: logo left, company identity right ───────────────────────────────
  if (logoData) {
    try {
      const buf = Buffer.from(String(logoData).replace(/^data:image\/\w+;base64,/, ''), 'base64');
      doc.image(buf, ML, y, { fit: [140 * S, 56 * S] });
    } catch (_) {
      txt(companyName, ML, y + 10 * S, 14, {}, 'Helvetica-Bold', INK);
    }
  } else {
    txt(companyName, ML, y + 10 * S, 14, {}, 'Helvetica-Bold', INK);
  }

  const detW = 200 * S;
  const detX = PW - MR - detW;
  let detY = y;
  txt(companyName, detX, detY, 10, { width: detW, align: 'right' }, 'Helvetica-Bold', INK);
  detY += 14 * S;
  if (companyAddr) { txt(companyAddr, detX, detY, 8, { width: detW, align: 'right' }, 'Helvetica', GREY); detY += 12 * S; }
  const detRow = (lbl, val) => {
    if (!val) return;
    txt(`${lbl}: ${val}`, detX, detY, 8, { width: detW, align: 'right' }, 'Helvetica', GREY);
    detY += 11 * S;
  };
  detRow('Tel', companyTel);
  detRow('Business No.', companyNr);

  y = Math.max(y + m.headerH, detY) + m.ruleGap * 0.5;
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#DDDDDD').lineWidth(0.7).stroke();
  y += m.ruleGap * 0.5;

  // ── IDENTITY ROW: ESTIMATE + meta (left), project block (right) ─────────────
  // Both columns flow: every field advances the cursor by the height it really
  // occupies plus a fixed gap, so a value that wraps pushes the fields below it
  // down instead of being drawn on top of them.
  const baseY = y;

  // Left: ESTIMATE title + ref / date / validity
  let ly = baseY + drawFlow(
    { text: 'ESTIMATE', size: 22, font: 'Helvetica-Bold', color: INK, maxLines: 1 }, ML, baseY, CW,
  ) + m.fieldGap;
  const metaLabelW = 74 * S;
  const metaValX = ML + 78 * S;
  const metaValW = rightColX - metaValX - 8 * S;
  const metaRow = (lbl, val) => {
    const hL = drawFlow({ text: lbl, size: 9, font: 'Helvetica-Bold', color: GREY, maxLines: 1 }, ML, ly, metaLabelW);
    const hV = drawFlow({ text: val, size: 9, font: 'Helvetica', color: INK, maxLines: 1 }, metaValX, ly, metaValW);
    ly += Math.max(hL, hV) + m.fieldGap;
  };
  metaRow('Ref', refStr);
  metaRow('Date', fmtDate(baseDate.toISOString()));
  metaRow('Valid until', `${fmtDate(validUntil.toISOString())} (${VALIDITY_DAYS} days)`);

  // Right: PREPARED FOR identity block, flowing
  let ry = baseY;
  preparedFields.forEach(f => { ry += drawFlow(f, rightColX, ry, rightColW) + m.fieldGap; });

  y = Math.max(ly, ry) + m.secGap;

  // ── Section column geometry ─────────────────────────────────────────────────
  const amtW = 92 * S;
  const amtX = PW - MR - amtW;              // right-aligned amount column
  const labelX = ML + 4 * S;
  const catW = CW * 0.30;                   // logistics: category column
  const descX = ML + 4 * S + catW + 8 * S; // logistics: description column
  const descW = amtX - descX - 8 * S;
  const posW = amtX - labelX - 8 * S;       // crew / equipment: single wide label

  function drawColumnHeader(sec, yPos, continued) {
    // Section title line (plain, bold), with an optional continued marker.
    const titleTxt = `SECTION ${sec.num}  ·  ${sec.title}${continued ? '  (continued)' : ''}`;
    txt(titleTxt, ML, yPos, 9, {}, 'Helvetica-Bold', INK);
    let yy = yPos + m.secTitleH;
    // Column header bar, mirroring the invoice table header.
    doc.rect(ML, yy, CW, m.tblHdrH).fill(BAR);
    const hY = yy + 4 * S;
    if (sec.isLog) {
      txt('CATEGORY', labelX, hY, 7.5, { width: catW }, 'Helvetica-Bold', GREY);
      txt('DESCRIPTION', descX, hY, 7.5, { width: descW }, 'Helvetica-Bold', GREY);
    } else {
      txt('POSITION / SERVICE', labelX, hY, 7.5, { width: posW }, 'Helvetica-Bold', GREY);
    }
    txt('AMOUNT', amtX, hY, 7.5, { width: amtW, align: 'right' }, 'Helvetica-Bold', GREY);
    return yy + m.tblHdrH;
  }

  function pageBreak() {
    doc.addPage();
    newPageSetup();
    return MT;
  }

  // ── SECTIONS ────────────────────────────────────────────────────────────────
  activeSections.forEach(sec => {
    const secTotal = sec.lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);

    // Never leave a section title stranded: it needs room for its header plus at
    // least two rows, or it starts on the next page.
    if (y + m.secTitleH + m.tblHdrH + 2 * m.rowH > PH - MB) y = pageBreak();

    y = drawColumnHeader(sec, y, false);

    sec.lines.forEach((line, i) => {
      if (y + m.rowH > PH - MB) {
        y = pageBreak();
        y = drawColumnHeader(sec, y, true);
      }

      if (i % 2 === 1) doc.rect(ML, y, CW, m.rowH).fill(ZEBRA);
      const rY = y + 5 * S;

      if (sec.isLog) {
        txt(line.position_label || '', labelX, rY, 8.5, { width: catW }, 'Helvetica', INK_SOFT);
        txt(line.description || '', descX, rY, 8.5, { width: descW }, 'Helvetica', GREY);
      } else {
        const showProvider = budget.show_providers && line.description;
        const label = showProvider
          ? `${line.position_label || ''}  ·  ${line.description}`
          : (line.position_label || '');
        txt(label, labelX, rY, 8.5, { width: posW }, 'Helvetica', INK_SOFT);
      }

      if (line.price_pending) {
        // A line whose price is not settled prints TBC, not a zero that would
        // read as free, in the same muted grey used for secondary text.
        txt('TBC', amtX, rY, 8.5, { width: amtW, align: 'right' }, 'Helvetica', MUTED);
      } else {
        const lineDisc = Math.min(parseFloat(line.discount) || 0, parseFloat(line.amount) || 0);
        if (lineDisc > 0) {
          txt(fmtMoney(line.amount), amtX, y + 3 * S, 8.5, { width: amtW, align: 'right' }, 'Helvetica-Bold', INK);
          txt(`-${fmtMoney(lineDisc)}`, amtX, y + 12 * S, 7, { width: amtW, align: 'right' }, 'Helvetica', GREY);
        } else {
          txt(fmtMoney(line.amount), amtX, rY, 8.5, { width: amtW, align: 'right' }, 'Helvetica-Bold', INK);
        }
      }

      y += m.rowH;
      doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(HAIR).lineWidth(0.3).stroke();
    });

    // Section subtotal row.
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.6).stroke();
    const subY = y + 5 * S;
    txt('Subtotal', labelX, subY, 8.5, {}, 'Helvetica', GREY);
    txt(fmtMoney(secTotal), amtX, subY, 8.5, { width: amtW, align: 'right' }, 'Helvetica-Bold', INK);
    y += m.subRowH + m.secGap;
  });

  // ── TOTALS (never split across pages) ───────────────────────────────────────
  const grossSubtotal = activeSections.reduce(
    (s, sec) => s + sec.lines.reduce((ss, l) => ss + (parseFloat(l.amount) || 0), 0), 0
  );
  const netSubtotal = grossSubtotal - totalDiscount;
  const vatAmount   = vatOn ? netSubtotal * (budget.vat_rate / 100) : 0;
  const grandTotal  = netSubtotal + vatAmount;

  if (y + totalsH > PH - MB) y = pageBreak();

  const totValW = amtW, totValX = amtX;
  const totLabelW = 150 * S, totLabelX = totValX - totLabelW;
  let ty = y;
  // Flowing totals rows: advance by the measured height of the taller of the
  // label and value plus a gap. Both are drawn right aligned inside their own
  // fixed width column, so neither can run into the other.
  const totRow = (label, value, opts = {}) => {
    const { big = false, color = INK_SOFT } = opts;
    const fs = big ? 12 : 9;
    const valFont = big ? 'Helvetica-Bold' : 'Helvetica';
    const hL = drawFlow({ text: label, size: fs, font: 'Helvetica-Bold', color: GREY, maxLines: 1 }, totLabelX, ty, totLabelW, { align: 'right' });
    const hV = drawFlow({ text: value, size: fs, font: valFont, color, maxLines: 1 }, totValX, ty, totValW, { align: 'right' });
    ty += Math.max(hL, hV) + m.fieldGap;
  };

  totRow('Subtotal', fmtMoney(grossSubtotal));
  if (hasDiscount) {
    totRow('Discount', `-${fmtMoney(totalDiscount)}`);
    totRow('Net subtotal', fmtMoney(netSubtotal), { color: INK });
  }
  if (vatOn) totRow(`VAT ${budget.vat_rate}%`, fmtMoney(vatAmount));

  doc.moveTo(totLabelX, ty + 2 * S).lineTo(PW - MR, ty + 2 * S).strokeColor('#AAAAAA').lineWidth(0.7).stroke();
  ty += m.totalGap;
  totRow(vatOn ? 'TOTAL INC. VAT' : 'TOTAL', fmtMoney(grandTotal), { big: true, color: INK });
  y = ty + m.secGap;

  // ── NOTES ────────────────────────────────────────────────────────────────
  if (notesText) {
    const blockH = notesH;
    if (y + blockH > PH - MB) y = pageBreak();
    txt('NOTES', ML, y, 8, {}, 'Helvetica-Bold', MUTED);
    // The notes flow: doc.y after the wrapped paragraph is the real bottom, so
    // whatever follows sits below it. lineGap is scaled with S so the drawn
    // height stays within the height reserved for it at scale 1.
    doc.font('Helvetica-Oblique').fontSize(8.5 * S).fillColor(GREY)
       .text(notesText, ML, y + m.notesHead, { width: CW, lineGap: 1 * S });
    y = doc.y + m.secGap;
  }

  // ── APPROVAL: client signature and date ─────────────────────────────────────
  if (y + m.sigH > PH - MB) y = pageBreak();
  txt('To approve this estimate, please sign and date below.', ML, y, 8.5, { width: CW }, 'Helvetica', GREY);
  const sigY = y + 40 * S;
  const sigW = 200 * S, dateW = 150 * S;
  const dateX = PW - MR - dateW;
  doc.moveTo(ML, sigY).lineTo(ML + sigW, sigY).strokeColor('#888888').lineWidth(0.7).stroke();
  txt('Client signature', ML, sigY + 5 * S, 8, { width: sigW }, 'Helvetica', GREY);
  doc.moveTo(dateX, sigY).lineTo(dateX + dateW, sigY).strokeColor('#888888').lineWidth(0.7).stroke();
  txt('Date', dateX, sigY + 5 * S, 8, { width: dateW }, 'Helvetica', GREY);

  // ── PAGE NUMBERS (only when the document runs to more than one page) ─────────
  const range = doc.bufferedPageRange();
  if (range.count > 1) {
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(7).fillColor(MUTED)
         .text(`Page ${i + 1} of ${range.count}`, ML, PH - 24, { width: CW, align: 'center', lineBreak: false });
    }
  }

  doc.end();
});

module.exports = router;
