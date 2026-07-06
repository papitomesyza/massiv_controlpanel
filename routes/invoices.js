const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  if (value === null || value === undefined || value === '') {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

function computeTotals({ lines = [], invoice_discount = 0, discount_type = 'amount', tax_enabled = 0, tax_rate = 0 }) {
  const subtotal = lines.reduce((sum, l) => {
    const qty = Number(l.qty) || 0;
    const price = Number(l.price) || 0;
    const disc = Number(l.line_discount_pct) || 0;
    return sum + qty * price * (1 - disc / 100);
  }, 0);

  const discountAmt = discount_type === 'percent'
    ? subtotal * (Number(invoice_discount) || 0) / 100
    : Number(invoice_discount) || 0;

  const total_after_discount = Math.max(0, subtotal - discountAmt);
  const tax_amount = tax_enabled ? total_after_discount * (Number(tax_rate) || 0) / 100 : 0;
  const amount_due = total_after_discount + tax_amount;

  return {
    subtotal,
    invoice_discount: discountAmt,
    total_after_discount,
    tax_amount,
    amount_due,
  };
}

function getInvoiceFull(id) {
  const inv = db.prepare(`
    SELECT i.*
    FROM invoices i
    WHERE i.id = ?
  `).get(id);
  if (!inv) return null;
  const lines = db.prepare(
    'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id'
  ).all(id);
  return { ...inv, lines };
}

function assignInvoiceNumber() {
  let nextNum = parseInt(getSetting('invoice_next_num', '34'), 10);
  if (isNaN(nextNum) || nextNum < 1) nextNum = 1;

  const yy = getSetting('invoice_year', String(new Date().getFullYear()).slice(-2));

  const invoiceNumber = `${nextNum}/${yy}`;
  setSetting('invoice_next_num', String(nextNum + 1));

  return invoiceNumber;
}

// ─── Invoice Settings ─────────────────────────────────────────────────────────

router.get('/settings', (req, res) => {
  const keys = [
    'invoice_billing_name', 'invoice_billing_address', 'invoice_billing_tel',
    'invoice_billing_nr_unik', 'invoice_billing_bank', 'invoice_billing_swift',
    'invoice_billing_bank_account', 'invoice_billing_bank_name',
    'invoice_language', 'invoice_logo', 'invoice_stamp',
    'invoice_next_num', 'invoice_year',
    'tax_rate', 'tax_label', 'tax_enabled',
  ];
  const rows = db.prepare(
    `SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`
  ).all(...keys);
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });

  const currentYY = String(new Date().getFullYear()).slice(-2);
  const storedYear = map.invoice_year || currentYY;
  const nextNum = parseInt(map.invoice_next_num || '34', 10);
  const effectiveNext = isNaN(nextNum) ? 34 : nextNum;

  // Backward compat: map old combined bank field to new split fields
  let billingBankAccount = map.invoice_billing_bank_account || '';
  let billingBankName = map.invoice_billing_bank_name || '';
  if (!billingBankAccount && !billingBankName && map.invoice_billing_bank) {
    billingBankAccount = map.invoice_billing_bank;
    if (/teb/i.test(map.invoice_billing_bank)) billingBankName = 'TEB';
  }

  res.json({
    billing_name: map.invoice_billing_name || '',
    billing_address: map.invoice_billing_address || '',
    billing_tel: map.invoice_billing_tel || '',
    billing_nr_unik: map.invoice_billing_nr_unik || '',
    billing_bank: map.invoice_billing_bank || '',
    billing_bank_account: billingBankAccount,
    billing_bank_name: billingBankName,
    billing_swift: map.invoice_billing_swift || '',
    language: map.invoice_language || 'sq',
    logo_base64: map.invoice_logo || null,
    stamp_base64: map.invoice_stamp || null,
    next_number_preview: `${effectiveNext}/${storedYear}`,
    next_num_seed: effectiveNext,
    next_year_seed: storedYear,
    tax_rate: parseFloat(map.tax_rate || '18'),
    tax_label: map.tax_label || 'Tax',
    tax_enabled: map.tax_enabled === '1',
  });
});

router.post('/settings', (req, res) => {
  const {
    billing_name, billing_address, billing_tel,
    billing_nr_unik, billing_bank, billing_swift,
    billing_bank_account, billing_bank_name,
    language, next_num_seed, next_year_seed, logo_base64, stamp_base64,
    tax_enabled,
  } = req.body;

  if (billing_name !== undefined) setSetting('invoice_billing_name', billing_name);
  if (billing_address !== undefined) setSetting('invoice_billing_address', billing_address);
  if (billing_tel !== undefined) setSetting('invoice_billing_tel', billing_tel);
  if (billing_nr_unik !== undefined) setSetting('invoice_billing_nr_unik', billing_nr_unik);
  if (billing_bank !== undefined) setSetting('invoice_billing_bank', billing_bank);
  if (billing_swift !== undefined) setSetting('invoice_billing_swift', billing_swift);
  if (billing_bank_account !== undefined) setSetting('invoice_billing_bank_account', billing_bank_account);
  if (billing_bank_name !== undefined) setSetting('invoice_billing_bank_name', billing_bank_name);
  if (language !== undefined) setSetting('invoice_language', language || 'sq');
  if (next_num_seed !== undefined) {
    const n = parseInt(next_num_seed, 10);
    if (Number.isFinite(n) && n >= 1) setSetting('invoice_next_num', String(n));
  }
  if (next_year_seed !== undefined) {
    const yr = String(next_year_seed).trim();
    if (yr) setSetting('invoice_year', yr);
  }
  if (logo_base64 !== undefined) setSetting('invoice_logo', logo_base64 || null);
  if (stamp_base64 !== undefined) setSetting('invoice_stamp', stamp_base64 || null);
  if (tax_enabled !== undefined) setSetting('tax_enabled', tax_enabled ? '1' : '0');

  res.json({ ok: true });
});

// ─── Services Catalogue ───────────────────────────────────────────────────────

router.get('/services', (req, res) => {
  res.json(db.prepare('SELECT * FROM invoice_services ORDER BY code, name').all());
});

router.post('/services', (req, res) => {
  const { code, name, unit, default_price } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(
    'INSERT INTO invoice_services (code, name, unit, default_price) VALUES (?, ?, ?, ?)'
  ).run(
    code ? code.trim() : null,
    name.trim(),
    (unit || 'Shërbim').trim(),
    Number(default_price) || 0
  );
  res.json({ id: result.lastInsertRowid });
});

router.put('/services/:id', (req, res) => {
  const { code, name, unit, default_price } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(
    'UPDATE invoice_services SET code=?, name=?, unit=?, default_price=? WHERE id=?'
  ).run(
    code ? code.trim() : null,
    name.trim(),
    (unit || 'Shërbim').trim(),
    Number(default_price) || 0,
    req.params.id
  );
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

router.delete('/services/:id', (req, res) => {
  const result = db.prepare('DELETE FROM invoice_services WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ─── Invoices List ────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT i.*,
      c.name as client_name_ref, c.company as client_company_ref
    FROM invoices i
    LEFT JOIN clients c ON c.id = i.client_id
    ORDER BY i.created_at DESC
  `).all();
  res.json(rows);
});

// ─── Create Invoice ───────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const {
    project_id, estimate_id, client_id,
    client_name, client_nr_unik, client_address,
    issue_date, due_date, description, notes,
    currency, language,
    invoice_discount, discount_type,
    tax_enabled, tax_rate_applied,
    lines = [],
  } = req.body;

  const taxRate = Number(tax_rate_applied) != null && !isNaN(Number(tax_rate_applied))
    ? Number(tax_rate_applied)
    : parseFloat(getSetting('tax_rate', '18'));
  const taxOn = tax_enabled ? 1 : 0;
  const discType = discount_type || 'amount';

  const totals = computeTotals({
    lines,
    invoice_discount: invoice_discount || 0,
    discount_type: discType,
    tax_enabled: taxOn,
    tax_rate: taxRate,
  });

  const today = new Date().toISOString().split('T')[0];
  const result = db.prepare(`
    INSERT INTO invoices (
      project_id, estimate_id, client_id,
      client_name, client_nr_unik, client_address,
      issue_date, due_date, description, notes,
      currency, language,
      invoice_discount, discount_type,
      subtotal, total_after_discount,
      tax_enabled, tax_rate_applied, tax_amount, amount_due,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(
    project_id || null, estimate_id || null, client_id || null,
    (client_name || '').trim(), (client_nr_unik || '').trim(), (client_address || '').trim(),
    issue_date || today, due_date || null,
    (description || '').trim(), (notes || '').trim(),
    currency || 'EUR',
    language || getSetting('invoice_language', 'sq'),
    totals.invoice_discount, discType,
    totals.subtotal, totals.total_after_discount,
    taxOn, taxRate, totals.tax_amount, totals.amount_due,
  );

  const invoiceId = result.lastInsertRowid;
  saveLines(invoiceId, lines);

  res.json({ id: invoiceId });
});

// ─── Get Invoice ──────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const inv = getInvoiceFull(parseInt(req.params.id, 10));
  if (!inv) return res.status(404).json({ error: 'Not found' });
  res.json(inv);
});

// ─── Update Invoice ───────────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const {
    project_id, client_id,
    client_name, client_nr_unik, client_address,
    issue_date, due_date, description, notes,
    currency, language,
    invoice_discount, discount_type,
    tax_enabled, tax_rate_applied,
    lines = [],
  } = req.body;

  const taxRate = tax_rate_applied != null && !isNaN(Number(tax_rate_applied))
    ? Number(tax_rate_applied)
    : parseFloat(getSetting('tax_rate', '18'));
  const taxOn = tax_enabled ? 1 : 0;
  const discType = discount_type || inv.discount_type || 'amount';

  const totals = computeTotals({
    lines,
    invoice_discount: invoice_discount !== undefined ? invoice_discount : inv.invoice_discount,
    discount_type: discType,
    tax_enabled: taxOn,
    tax_rate: taxRate,
  });

  db.prepare(`
    UPDATE invoices SET
      project_id=?, client_id=?,
      client_name=?, client_nr_unik=?, client_address=?,
      issue_date=?, due_date=?,
      description=?, notes=?,
      currency=?, language=?,
      invoice_discount=?, discount_type=?,
      subtotal=?, total_after_discount=?,
      tax_enabled=?, tax_rate_applied=?, tax_amount=?, amount_due=?
    WHERE id=?
  `).run(
    project_id !== undefined ? (project_id || null) : inv.project_id,
    client_id !== undefined ? (client_id || null) : inv.client_id,
    (client_name !== undefined ? client_name : inv.client_name || '').trim(),
    (client_nr_unik !== undefined ? client_nr_unik : inv.client_nr_unik || '').trim(),
    (client_address !== undefined ? client_address : inv.client_address || '').trim(),
    issue_date || inv.issue_date,
    due_date !== undefined ? due_date : inv.due_date,
    (description !== undefined ? description : inv.description || '').trim(),
    (notes !== undefined ? notes : inv.notes || '').trim(),
    currency || inv.currency,
    language || inv.language,
    totals.invoice_discount, discType,
    totals.subtotal, totals.total_after_discount,
    taxOn, taxRate, totals.tax_amount, totals.amount_due,
    id,
  );

  db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(id);
  saveLines(id, lines);

  // Keep tax record in sync if already issued/paid
  if (inv.status !== 'draft' && taxOn) {
    const taxRow = db.prepare('SELECT id FROM invoice_tax_records WHERE invoice_id = ?').get(id);
    if (taxRow) {
      db.prepare(
        'UPDATE invoice_tax_records SET tax_rate_applied=?, tax_amount=?, invoice_total=? WHERE invoice_id=?'
      ).run(taxRate, totals.tax_amount, totals.amount_due, id);
    }
  }

  res.json({ ok: true });
});

// ─── Delete Invoice ───────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  // Remove tax record
  db.prepare('DELETE FROM invoice_tax_records WHERE invoice_id = ?').run(inv.id);

  // Unlink any payment tied to this invoice but keep the row — received money
  // stays recorded even after the invoice is deleted.
  db.prepare('UPDATE client_payments SET invoice_id = NULL WHERE invoice_id = ?').run(inv.id);

  db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
  res.json({ ok: true });
});

// ─── Issue Invoice ────────────────────────────────────────────────────────────

router.post('/:id/issue', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  // Already issued — return existing number
  if (inv.status === 'issued' || inv.status === 'paid') {
    return res.json({ ok: true, invoice_number: inv.invoice_number });
  }

  const invoiceNumber = assignInvoiceNumber();
  db.prepare("UPDATE invoices SET status='issued', invoice_number=? WHERE id=?")
    .run(invoiceNumber, inv.id);

  // Create tax record if tax is enabled
  if (inv.tax_enabled) {
    db.prepare(`
      INSERT OR REPLACE INTO invoice_tax_records
        (invoice_id, invoice_number, invoice_total, tax_rate_applied, tax_amount, tax_status)
      VALUES (?, ?, ?, ?, ?, 'unpaid')
    `).run(inv.id, invoiceNumber, inv.amount_due, inv.tax_rate_applied, inv.tax_amount);
  }

  res.json({ ok: true, invoice_number: invoiceNumber });
});

// ─── Mark Paid ────────────────────────────────────────────────────────────────

router.post('/:id/paid', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const prevStatus = inv.status;
  db.prepare("UPDATE invoices SET status='paid' WHERE id=?").run(inv.id);

  // Create one client_payment for the linked project, only once. Linkage is by
  // invoice_id; the note text is kept only for human-readable display.
  if (inv.project_id && prevStatus !== 'paid') {
    const existing = db.prepare(
      'SELECT id FROM client_payments WHERE invoice_id = ?'
    ).get(inv.id);

    if (!existing) {
      const noteStr = `Invoice ${inv.invoice_number || inv.id} - ${(inv.client_name || '').trim()}`.trim();
      db.prepare(`
        INSERT INTO client_payments (project_id, amount, date, method, notes, status, invoice_id)
        VALUES (?, ?, ?, 'bank_transfer', ?, 'received', ?)
      `).run(
        inv.project_id,
        inv.amount_due,
        new Date().toISOString().split('T')[0],
        noteStr,
        inv.id,
      );
    }
  }

  res.json({ ok: true });
});

// ─── Mark Unpaid (revert to issued) ──────────────────────────────────────────

router.post('/:id/unpaid', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const prevStatus = inv.status;
  const targetStatus = inv.invoice_number ? 'issued' : 'draft';
  db.prepare('UPDATE invoices SET status=? WHERE id=?').run(targetStatus, inv.id);

  // Remove the payment that was created on mark-paid, matched by invoice_id only.
  // If no payment carries this invoice_id, do nothing (no note-based fallback).
  if (prevStatus === 'paid') {
    db.prepare('DELETE FROM client_payments WHERE invoice_id = ?').run(inv.id);
  }

  res.json({ ok: true });
});

// ─── Create Invoice from Estimate ─────────────────────────────────────────────

router.post('/from-estimate/:budgetId', (req, res) => {
  const budget = db.prepare(`
    SELECT b.*, p.client_id as proj_client_id, p.id as proj_id
    FROM budgets b
    LEFT JOIN projects p ON p.id = b.project_id
    WHERE b.id = ?
  `).get(req.params.budgetId);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });

  const budgetLines = db.prepare(
    'SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY section, sort_order, id'
  ).all(budget.id);

  let clientId = null;
  let clientName = budget.client_name || '';
  if (budget.proj_client_id) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(budget.proj_client_id);
    if (client) {
      clientId = client.id;
      clientName = client.company || client.name || clientName;
    }
  }

  // Map budget lines to invoice lines
  const invoiceLines = budgetLines.map((l, i) => {
    const description = [l.description, l.position_label].filter(Boolean).join(' — ') || l.section || '';
    const qty = Number(l.days) || 1;
    const price = Number(l.rate) || (qty > 0 ? Number(l.amount) / qty : Number(l.amount));
    const lineGross = qty * (price || 0);
    const cappedDiscount = Math.min(Number(l.discount) || 0, lineGross);
    const line_discount_pct = lineGross > 0 ? (cappedDiscount / lineGross) * 100 : 0;
    return {
      code: null,
      description: description.trim(),
      unit: 'Shërbim',
      qty,
      price: price || 0,
      line_discount_pct,
      sort_order: i,
    };
  });

  const today = new Date().toISOString().split('T')[0];
  const due = new Date();
  due.setDate(due.getDate() + 30);

  const taxRate = parseFloat(getSetting('tax_rate', '18'));
  const taxOn = getSetting('tax_enabled', '0') === '1' ? 1 : 0;

  const totals = computeTotals({ lines: invoiceLines, tax_enabled: taxOn, tax_rate: taxRate });

  const result = db.prepare(`
    INSERT INTO invoices (
      project_id, estimate_id, client_id,
      client_name, client_nr_unik, client_address,
      issue_date, due_date, description,
      currency, language,
      invoice_discount, discount_type,
      subtotal, total_after_discount,
      tax_enabled, tax_rate_applied, tax_amount, amount_due,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'amount', ?, ?, ?, ?, ?, ?, 'draft')
  `).run(
    budget.proj_id || null, budget.id, clientId,
    clientName, '', '',
    today, due.toISOString().split('T')[0],
    (budget.title || '').trim(),
    'EUR',
    getSetting('invoice_language', 'sq'),
    totals.subtotal, totals.total_after_discount,
    taxOn, taxRate, totals.tax_amount, totals.amount_due,
  );

  const invoiceId = result.lastInsertRowid;
  saveLines(invoiceId, invoiceLines);

  res.json({ id: invoiceId });
});

// ─── Save lines helper ────────────────────────────────────────────────────────

function saveLines(invoiceId, lines) {
  const stmt = db.prepare(`
    INSERT INTO invoice_lines
      (invoice_id, line_no, code, description, unit, qty, price, line_discount_pct, amount, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  lines.forEach((l, i) => {
    const qty = Number(l.qty) || 0;
    const price = Number(l.price) || 0;
    const disc = Number(l.line_discount_pct) || 0;
    const amount = qty * price * (1 - disc / 100);
    stmt.run(
      invoiceId, i + 1,
      l.code ? String(l.code).trim() : null,
      (l.description || '').trim(),
      (l.unit || '').trim(),
      qty, price, disc, amount,
      l.sort_order !== undefined ? l.sort_order : i,
    );
  });
}

// ─── PDF Generation ───────────────────────────────────────────────────────────

const LABELS = {
  sq: {
    title: 'Faturë',
    number: 'Numri',
    date: 'Data',
    due_date: 'Afati i pagesës',
    description_label: 'Përshkrim',
    nr: 'Nr',
    code: 'Shifra',
    name: 'Emërtimi',
    unit: 'Njësia',
    qty: 'Sasia',
    price: 'Çmimi',
    discount: 'Rabat',
    amount: 'Vlera',
    notes: 'Vërejtje',
    subtotal: 'Gjithsejt',
    invoice_discount: 'Rabat-i',
    after_discount: 'Vlera përfshirë zbritjen',
    amount_due: 'Për pagesë',
    delivered_by: 'Dorezoi',
    received_by: 'Pranoi',
    client_section: 'Blerësi',
    nr_unik_label: 'Nr. Unik',
    address_label: 'Adresa',
    tel_label: 'Tel',
    bank_label: 'Banka',
    account_label: 'Llogaria',
    swift_label: 'SWIFT',
  },
  en: {
    title: 'Invoice',
    number: 'Number',
    date: 'Date',
    due_date: 'Due Date',
    description_label: 'Description',
    nr: 'No',
    code: 'Code',
    name: 'Description',
    unit: 'Unit',
    qty: 'Qty',
    price: 'Price',
    discount: 'Disc.%',
    amount: 'Amount',
    notes: 'Notes',
    subtotal: 'Subtotal',
    invoice_discount: 'Discount',
    after_discount: 'After Discount',
    amount_due: 'Amount Due',
    delivered_by: 'Delivered by',
    received_by: 'Received by',
    client_section: 'Bill To',
    nr_unik_label: 'Business No.',
    address_label: 'Address',
    tel_label: 'Tel',
    bank_label: 'Bank',
    account_label: 'Account',
    swift_label: 'SWIFT',
  },
};

router.get('/:id/pdf', (req, res) => {
  const PDFDocument = require('pdfkit');

  const inv = getInvoiceFull(parseInt(req.params.id, 10));
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const lang = inv.language || 'sq';
  const L = LABELS[lang] || LABELS.sq;

  const billingName  = getSetting('invoice_billing_name', '');
  const billingAddr  = getSetting('invoice_billing_address', '');
  const billingTel   = getSetting('invoice_billing_tel', '');
  const billingNr    = getSetting('invoice_billing_nr_unik', '');
  const billingSwift = getSetting('invoice_billing_swift', '');
  // Bank split: new keys, with fallback to old combined key
  let billingBankName    = getSetting('invoice_billing_bank_name') || '';
  let billingBankAccount = getSetting('invoice_billing_bank_account') || '';
  if (!billingBankName && !billingBankAccount) {
    const oldBank = getSetting('invoice_billing_bank', '');
    if (oldBank) {
      billingBankAccount = oldBank;
      if (/teb/i.test(oldBank)) billingBankName = 'TEB';
    }
  }
  const logoData     = getSetting('invoice_logo') || getSetting('agency_logo');
  const stampData    = getSetting('invoice_stamp');
  const taxLabel     = getSetting('tax_label', 'Tax');

  const fmtMoney = v => `€${Number(v || 0).toFixed(2)}`;
  const fmtDate = d => {
    if (!d) return '';
    const date = new Date(String(d).includes('T') ? d : d + 'T00:00:00');
    if (isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${date.getFullYear()}`;
  };

  const safeClient = (inv.client_name || 'client').replace(/[^a-z0-9]/gi, '-').slice(0, 40);
  const safeNum = (inv.invoice_number || 'draft').replace(/\//g, '-');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="Invoice-${safeNum}-${safeClient}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
  doc.pipe(res);

  // ── Layout constants ─────────────────────────────────────────────────────────
  const ML = 50, MR = 50, MT = 45;
  const PW = doc.page.width;    // 595
  const PH = doc.page.height;   // 842
  const CW = PW - ML - MR;      // 495
  const SECTION_GAP = 18;

  function newPageSetup() { doc.rect(0, 0, PW, PH).fill('#FFFFFF'); }
  newPageSetup();

  let y = MT;

  // ── HEADER ───────────────────────────────────────────────────────────────────
  // Logo (left edge at ML)
  if (logoData) {
    try {
      const buf = Buffer.from(logoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      doc.image(buf, ML, y, { fit: [140, 56] });
    } catch (_) {
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#111')
        .text(billingName || 'COMPANY', ML, y + 10, { lineBreak: false });
    }
  } else {
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#111')
      .text(billingName || 'COMPANY', ML, y + 10, { lineBreak: false });
  }

  // Company details (right-aligned, right edge at PW-MR)
  const detW = 185;
  const detX = PW - MR - detW;
  let detY = y;
  if (billingName) {
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#111')
      .text(billingName, detX, detY, { width: detW, align: 'right', lineBreak: false });
    detY += 14;
  }
  if (billingAddr) {
    doc.fontSize(8).font('Helvetica').fillColor('#444')
      .text(billingAddr, detX, detY, { width: detW, align: 'right', lineBreak: false });
    detY += 12;
  }
  const detRow = (lbl, val) => {
    if (!val) return;
    doc.fontSize(8).font('Helvetica').fillColor('#666')
      .text(`${lbl}: ${val}`, detX, detY, { width: detW, align: 'right', lineBreak: false });
    detY += 11;
  };
  detRow(L.tel_label, billingTel);
  detRow(L.nr_unik_label, billingNr);
  detRow(L.bank_label, billingBankName);
  detRow(L.account_label, billingBankAccount);
  detRow(L.swift_label, billingSwift);

  y = Math.max(y + 64, detY) + SECTION_GAP;

  // Header rule (margin-to-margin)
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#DDDDDD').lineWidth(0.7).stroke();
  y += SECTION_GAP;

  // ── FATURË / CLIENT ROW ──────────────────────────────────────────────────────
  const sectionBaseY = y;
  const rightColX = ML + CW * 0.50;
  const rightColW = PW - MR - rightColX;
  const leftColW = rightColX - ML - 12;

  // Left: Faturë title + meta rows
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#111')
    .text(L.title, ML, sectionBaseY, { lineBreak: false });
  y = sectionBaseY + 30;

  const metaLabelX = ML;
  const metaLabelW = 90;
  const metaValueX = ML + 95;
  const metaValueW = rightColX - metaValueX - 8;

  const metaRow = (lbl, val) => {
    if (!val) return;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#777')
      .text(lbl + ':', metaLabelX, y, { width: metaLabelW, lineBreak: false });
    doc.font('Helvetica').fillColor('#111')
      .text(val, metaValueX, y, { width: metaValueW, lineBreak: false });
    y += 14;
  };
  metaRow(L.number, inv.invoice_number || '—');
  metaRow(L.date, fmtDate(inv.issue_date));
  metaRow(L.due_date, fmtDate(inv.due_date));
  const leftBottom = y;

  // Right: client block (same baseline as Faturë title)
  let cy = sectionBaseY;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#999')
    .text(L.client_section.toUpperCase(), rightColX, cy, { width: rightColW, lineBreak: false });
  cy += 13;
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#111')
    .text(inv.client_name || '—', rightColX, cy, { width: rightColW, lineBreak: false });
  cy += 16;
  if (inv.client_nr_unik) {
    doc.fontSize(8.5).font('Helvetica').fillColor('#555')
      .text(`${L.nr_unik_label}: ${inv.client_nr_unik}`, rightColX, cy, { width: rightColW, lineBreak: false });
    cy += 12;
  }
  if (inv.client_address) {
    doc.fontSize(8.5).font('Helvetica').fillColor('#555')
      .text(inv.client_address, rightColX, cy, { width: rightColW });
    cy = doc.y + 4;
  }

  y = Math.max(leftBottom, cy) + SECTION_GAP;

  // Description (below client/faturë row, within margins)
  if (inv.description) {
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#EEEEEE').lineWidth(0.5).stroke();
    y += 8;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#777')
      .text(L.description_label + ': ', ML, y, { continued: true, lineBreak: false });
    doc.font('Helvetica').fillColor('#333').text(inv.description, { lineBreak: false, width: CW });
    y += 16;
  }

  // Pre-table rule (margin-to-margin)
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#CCCCCC').lineWidth(0.6).stroke();
  y += 8;

  // ── TABLE ─────────────────────────────────────────────────────────────────────
  // Columns sum to CW=495; Amt right edge = ML+415+80 = PW-MR ✓
  const C = {
    nr:    { x: ML,       w: 22  },
    code:  { x: ML + 22,  w: 46  },
    name:  { x: ML + 68,  w: 151 },
    unit:  { x: ML + 219, w: 50  },
    qty:   { x: ML + 269, w: 42  },
    price: { x: ML + 311, w: 66  },
    disc:  { x: ML + 377, w: 38  },
    amt:   { x: ML + 415, w: 80  },
  };

  const HEADER_H = 18;
  const ROW_H = 20;
  const SIG_RESERVE = 130;

  function drawTableHeader(yPos) {
    doc.rect(ML, yPos, CW, HEADER_H).fill('#F2F2F2');
    const hY = yPos + 4;
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#444');
    doc.text(L.nr,       C.nr.x,    hY, { width: C.nr.w,    lineBreak: false });
    doc.text(L.code,     C.code.x,  hY, { width: C.code.w,  lineBreak: false });
    doc.text(L.name,     C.name.x,  hY, { width: C.name.w,  lineBreak: false });
    doc.text(L.unit,     C.unit.x,  hY, { width: C.unit.w,  lineBreak: false });
    doc.text(L.qty,      C.qty.x,   hY, { width: C.qty.w,   align: 'right', lineBreak: false });
    doc.text(L.price,    C.price.x, hY, { width: C.price.w, align: 'right', lineBreak: false });
    doc.text(L.discount, C.disc.x,  hY, { width: C.disc.w,  align: 'right', lineBreak: false });
    doc.text(L.amount,   C.amt.x,   hY, { width: C.amt.w,   align: 'right', lineBreak: false });
    return yPos + HEADER_H;
  }

  y = drawTableHeader(y);
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#CCCCCC').lineWidth(0.5).stroke();

  const invoiceLines = inv.lines || [];

  invoiceLines.forEach((line, idx) => {
    if (y + ROW_H > PH - SIG_RESERVE - 40) {
      doc.addPage();
      newPageSetup();
      y = MT;
      y = drawTableHeader(y);
      doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#CCCCCC').lineWidth(0.5).stroke();
    }

    if (idx % 2 === 1) {
      doc.rect(ML, y, CW, ROW_H).fill('#FAFAFA');
    } else {
      doc.rect(ML, y, CW, ROW_H).fill('#FFFFFF');
    }

    const rY = y + 5;
    doc.fontSize(8.5).font('Helvetica').fillColor('#333');
    doc.text(String(idx + 1),               C.nr.x,    rY, { width: C.nr.w,    lineBreak: false });
    doc.text(line.code || '',               C.code.x,  rY, { width: C.code.w,  lineBreak: false });
    doc.text(line.description || '',        C.name.x,  rY, { width: C.name.w,  lineBreak: false });
    doc.text(line.unit || '',               C.unit.x,  rY, { width: C.unit.w,  lineBreak: false });
    doc.text(String(Number(line.qty || 0)), C.qty.x,   rY, { width: C.qty.w,   align: 'right', lineBreak: false });
    doc.text(fmtMoney(line.price),          C.price.x, rY, { width: C.price.w, align: 'right', lineBreak: false });
    const discTxt = (line.line_discount_pct || 0) > 0 ? `${Number(line.line_discount_pct)}%` : '';
    doc.text(discTxt,                       C.disc.x,  rY, { width: C.disc.w,  align: 'right', lineBreak: false });
    doc.font('Helvetica-Bold').text(fmtMoney(line.amount), C.amt.x, rY, { width: C.amt.w, align: 'right', lineBreak: false });

    y += ROW_H;
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#EEEEEE').lineWidth(0.3).stroke();
  });

  // Closing table border
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor('#CCCCCC').lineWidth(0.6).stroke();
  y += SECTION_GAP;

  // ── TOTALS + NOTES ────────────────────────────────────────────────────────────
  const notesH = inv.notes ? Math.min(60, inv.notes.length * 0.6 + 28) : 0;
  const taxRows = (inv.tax_enabled && (inv.tax_amount || 0) > 0) ? 1 : 0;
  const discRows = (inv.invoice_discount || 0) > 0 ? 2 : 0;
  const totalsH = (3 + taxRows + discRows) * 14 + 36;
  const sigH = 90;
  const neededH = Math.max(notesH, totalsH) + sigH + 20;

  if (y + neededH > PH - 30) {
    doc.addPage();
    newPageSetup();
    y = MT;
  }

  // Totals block: label right-aligned, value right-aligned; right edge at PW-MR = Vlera column
  const totValueW = C.amt.w;        // 80 — same width as table Amt column
  const totValX   = C.amt.x;        // ML+415 — same x as table Amt column
  const totLabelW = 140;
  const totLabelX = totValX - totLabelW;   // ML+275

  let totY = y;

  const totRow = (label, value, bold = false, large = false, color = '#333') => {
    const fs = large ? 11 : 9;
    const fn = (bold || large) ? 'Helvetica-Bold' : 'Helvetica';
    doc.fontSize(fs).font('Helvetica-Bold').fillColor('#666')
      .text(label, totLabelX, totY, { width: totLabelW, align: 'right', lineBreak: false });
    doc.font(fn).fillColor(color)
      .text(value, totValX, totY, { width: totValueW, align: 'right', lineBreak: false });
    totY += large ? 18 : 14;
  };

  totRow(L.subtotal, fmtMoney(inv.subtotal));
  if ((inv.invoice_discount || 0) > 0) {
    totRow(L.invoice_discount, `- ${fmtMoney(inv.invoice_discount)}`);
    totRow(L.after_discount, fmtMoney(inv.total_after_discount), true);
  }
  if (inv.tax_enabled && (inv.tax_amount || 0) > 0) {
    totRow(`${taxLabel} ${inv.tax_rate_applied}%`, fmtMoney(inv.tax_amount));
  }

  // Thin rule above Për pagesë, spanning label+value columns
  doc.moveTo(totLabelX, totY).lineTo(PW - MR, totY).strokeColor('#AAAAAA').lineWidth(0.7).stroke();
  totY += 7;
  totRow(L.amount_due, fmtMoney(inv.amount_due), true, true, '#111');

  // Notes (left side, same y baseline as totals)
  let notesEndY = y;
  if (inv.notes) {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#666')
      .text(L.notes + ':', ML, y, { lineBreak: false });
    notesEndY = y + 14;
    doc.fontSize(8.5).font('Helvetica').fillColor('#444')
      .text(inv.notes, ML, notesEndY, { width: totLabelX - ML - 16 });
    notesEndY = doc.y + 4;
  }

  // ── SIGNATURE LINES ───────────────────────────────────────────────────────────
  // Both lines at identical Y, mirrored: left=ML..ML+SIG_W, right=(PW-MR-SIG_W)..PW-MR
  const SIG_W    = 160;
  const leftSigX = ML;
  const rightSigX = PW - MR - SIG_W;

  const sigBaseY = Math.max(totY, notesEndY) + SECTION_GAP;
  const sigLineY = sigBaseY + 38;

  // Stamp image centered over left signature line
  if (stampData) {
    try {
      const stampBuf = Buffer.from(stampData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const SW = 130, SH = 68;
      const stampX = leftSigX + (SIG_W - SW) / 2;
      const stampY = sigLineY - SH - 2;
      doc.image(stampBuf, stampX, stampY, { fit: [SW, SH] });
    } catch (_) {}
  }

  // Left line + label
  doc.moveTo(leftSigX, sigLineY).lineTo(leftSigX + SIG_W, sigLineY)
    .strokeColor('#888888').lineWidth(0.7).stroke();
  doc.fontSize(8).font('Helvetica').fillColor('#666')
    .text(L.delivered_by, leftSigX, sigLineY + 5, { width: SIG_W, align: 'center', lineBreak: false });

  // Right line + label (mirrored)
  doc.moveTo(rightSigX, sigLineY).lineTo(rightSigX + SIG_W, sigLineY)
    .strokeColor('#888888').lineWidth(0.7).stroke();
  doc.fontSize(8).font('Helvetica').fillColor('#666')
    .text(L.received_by, rightSigX, sigLineY + 5, { width: SIG_W, align: 'center', lineBreak: false });

  doc.end();
});

module.exports = router;
