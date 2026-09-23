const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { pristinaToday, pristinaMonth, pristinaYear, addMonths } = require('../lib/pristinaDate');
const {
  readFilter, projectFilterSql, monthlyFigures, projectProfitForMonth, owedSummary, receivableRows,
} = require('../lib/financeFigures');

function validateMoney(val, name) {
  const n = Number(val);
  if (!Number.isFinite(n)) return `${name} must be a number`;
  if (n < 0) return `${name} must be at least 0`;
  if (n > 1000000) return `${name} must be at most 1,000,000`;
  return null;
}

// Cash basis figures for one month, every one of them narrowed by the same
// client and category filter the Overview applies. The owed figures come from
// the shared owed helper so they reconcile with the receivables and the
// Invoices page.
router.get('/stats', (req, res) => {
  const month = req.query.month || pristinaMonth();
  const f = readFilter(req.query);
  const pf = projectFilterSql(f);

  const m = monthlyFigures([month], f)[0];
  const owed = owedSummary(f);

  // Unpaid crew: remaining owed (days x rate minus what was paid, never below 0)
  const unpaidCrew = db.prepare(`
    SELECT COALESCE(SUM(MAX(0, ca.days * ca.rate_per_day - COALESCE(ca.payment_amount, 0))), 0) as total
    FROM crew_assignments ca JOIN projects p ON p.id = ca.project_id
    WHERE ca.paid_status IN ('unpaid', 'partial')${pf.sql}
  `).get(...pf.params).total;

  // Distinct projects completed in the month, the month read in Pristina time.
  // changed_at is stored in UTC, so the rows around the edges are fetched and
  // converted rather than compared as UTC strings.
  const from = `${addMonths(month, 0)}-01`;
  const to = `${addMonths(month, 1)}-01`;
  const completedRows = db.prepare(`
    SELECT h.project_id, h.changed_at FROM project_status_history h
    JOIN projects p ON p.id = h.project_id
    WHERE h.to_status = 'completed' AND h.changed_at >= date(?, '-1 day') AND h.changed_at < date(?, '+1 day')${pf.sql}
  `).all(from, to, ...pf.params);
  const completedThisMonth = new Set(
    completedRows.filter(r => pristinaMonthOf(r.changed_at) === month).map(r => r.project_id)
  ).size;

  // Average value of completed projects only
  const avgProjectValue = db.prepare(`
    SELECT COALESCE(AVG(p.agreed_budget), 0) as v FROM projects p
    WHERE p.agreed_budget > 0 AND p.status = 'completed'${pf.sql}
  `).get(...pf.params).v;

  res.json({
    revenue: m.revenue,
    expenses: m.expenses,
    crewCosts: m.crewCosts,
    netProfit: m.projectProfit,
    outstanding: owed.pending,
    outstandingInvoiced: owed.invoicedUnpaid,
    outstandingNotInvoiced: owed.uninvoicedDue,
    upcoming: owed.upcoming,
    // Additive: everything owed, pending plus upcoming, for the Projects strip.
    owedTotal: owed.total,
    unpaidCrew,
    completedThisMonth,
    avgProjectValue,
  });
});

// A UTC SQLite timestamp ("YYYY-MM-DD HH:MM:SS") to its Pristina month.
function pristinaMonthOf(utcStamp) {
  if (!utcStamp) return null;
  const d = new Date(`${String(utcStamp).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(utcStamp).slice(0, 7);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit',
  }).format(d).slice(0, 7);
}

router.get('/all-time-kpis', (req, res) => {
  const f = readFilter(req.query);
  const pf = projectFilterSql(f);

  const totalRevenue = db.prepare(`
    SELECT COALESCE(SUM(cp.amount), 0) as v FROM client_payments cp JOIN projects p ON p.id = cp.project_id
    WHERE cp.status = 'received'${pf.sql}
  `).get(...pf.params).v;
  const totalCompleted = db.prepare(`SELECT COUNT(*) as v FROM projects p WHERE p.status = 'completed'${pf.sql}`).get(...pf.params).v;
  // Average value of completed projects only
  const avgProjectValue = db.prepare(`
    SELECT COALESCE(AVG(p.agreed_budget), 0) as v FROM projects p WHERE p.agreed_budget > 0 AND p.status = 'completed'${pf.sql}
  `).get(...pf.params).v;

  const bestMonthRow = db.prepare(`
    SELECT strftime('%Y-%m', cp.date) as month, SUM(cp.amount) as total
    FROM client_payments cp JOIN projects p ON p.id = cp.project_id
    WHERE cp.status = 'received'${pf.sql}
    GROUP BY month ORDER BY total DESC LIMIT 1
  `).get(...pf.params);

  const bestClientRow = db.prepare(`
    SELECT c.name, SUM(cp.amount) as total
    FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    JOIN clients c ON c.id = p.client_id
    WHERE cp.status = 'received'${pf.sql}
    GROUP BY c.id ORDER BY total DESC LIMIT 1
  `).get(...pf.params);

  res.json({
    totalRevenue, totalCompleted, avgProjectValue,
    bestMonth: bestMonthRow ? { month: bestMonthRow.month, amount: bestMonthRow.total } : null,
    bestClient: bestClientRow ? { name: bestClientRow.name, amount: bestClientRow.total } : null,
  });
});

router.get('/details/revenue', (req, res) => {
  const month = req.query.month || pristinaMonth();
  const pf = projectFilterSql(readFilter(req.query));
  const rows = db.prepare(`
    SELECT cp.*, p.title as project_title, c.name as client_name
    FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE cp.status = 'received' AND strftime('%Y-%m', cp.date) = ?${pf.sql}
    ORDER BY cp.date DESC
  `).all(month, ...pf.params);
  res.json(rows);
});

// Owed detail rows, read from the shared owed helper. Each row carries the
// invoiced and the not yet invoiced parts by name, so the interface can show
// where the Dashboard figure and the Invoices figure differ.
function owedDetailRow(r, amount, notInvoiced) {
  return {
    id: r.project_id,
    invoice_id: r.invoice_id || null,
    project_title: r.project_title || (r.invoices[0] && r.invoices[0].invoice_number ? `Invoice ${r.invoices[0].invoice_number}` : 'Invoice'),
    client_name: r.client_name,
    agreed_budget: r.agreed_budget,
    total_received: r.received,
    invoiced_unpaid: r.invoicedUnpaid,
    not_invoiced: notInvoiced,
    overdue: r.overdue,
    outstanding: amount,
    shoot_date: r.shoot_date,
  };
}

router.get('/details/outstanding', (req, res) => {
  const { rows } = owedSummary(readFilter(req.query));
  const out = rows
    .map(r => {
      const notInvoiced = r.due ? r.uninvoiced : 0;
      return owedDetailRow(r, Math.round((r.invoicedUnpaid + notInvoiced) * 100) / 100, notInvoiced);
    })
    .filter(r => r.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
  res.json(out);
});

router.get('/details/upcoming', (req, res) => {
  const { rows } = owedSummary(readFilter(req.query));
  const out = rows
    .filter(r => !r.due && r.uninvoiced > 0)
    .map(r => owedDetailRow(r, r.uninvoiced, r.uninvoiced))
    .sort((a, b) => String(a.shoot_date).localeCompare(String(b.shoot_date)));
  res.json(out);
});

router.get('/details/unpaid-crew', (req, res) => {
  const pf = projectFilterSql(readFilter(req.query));
  const rows = db.prepare(`
    SELECT ca.*, cr.name as crew_name, p.title as project_title, p.id as project_id,
           (ca.days * ca.rate_per_day) as total_cost,
           MAX(0, ca.days * ca.rate_per_day - COALESCE(ca.payment_amount, 0)) as remaining
    FROM crew_assignments ca
    JOIN crew cr ON cr.id = ca.crew_id
    JOIN projects p ON p.id = ca.project_id
    WHERE ca.paid_status IN ('unpaid', 'partial')${pf.sql}
    ORDER BY cr.name
  `).all(...pf.params);
  res.json(rows);
});

router.get('/details/profit', (req, res) => {
  const month = req.query.month || pristinaMonth();
  const perProject = projectProfitForMonth(month, readFilter(req.query));
  const info = db.prepare(`
    SELECT p.id, p.title, c.name as client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ?
  `);
  const rows = perProject.map(r => {
    const p = info.get(r.project_id) || { id: r.project_id, title: '', client_name: null };
    return {
      id: p.id, title: p.title, client_name: p.client_name,
      revenue: r.revenue, crew_cost: r.crewCosts, expenses: r.expenses, net_profit: r.projectProfit,
    };
  }).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  res.json(rows);
});

// The last N months ending with the current Pristina month, or with the month
// given as ?end=YYYY-MM.
router.get('/chart', (req, res) => {
  const count = Math.min(Math.max(parseInt(req.query.months) || 6, 1), 36);
  const current = /^\d{4}-\d{2}$/.test(req.query.end || '') ? req.query.end : pristinaMonth();
  const months = Array.from({ length: count }, (_, i) => addMonths(current, i - (count - 1)));
  const rows = monthlyFigures(months, readFilter(req.query)).map(m => ({
    month: monthLabel(m.month, true),
    ym: m.month,
    revenue: m.revenue,
    expenses: m.expenses,
    crewCosts: m.crewCosts,
    profit: m.projectProfit,
  }));
  res.json(rows);
});

function monthLabel(ym, withYear) {
  const d = new Date(`${ym}-01T12:00:00Z`);
  return d.toLocaleString('en-GB', withYear ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { month: 'short', timeZone: 'UTC' });
}

// Margins on one basis: completed projects only, revenue as cash received and
// crew as crew payments actually made (plus confirmed expenses), so neither
// side of the subtraction counts money the other does not. total_revenue stays
// the all time cash received and drives the ranking; a row with no completed
// revenue has no margin (null), never zero percent.
function marginRows(groupCol, f) {
  const pf = projectFilterSql(f);
  const rows = db.prepare(`
    SELECT p.${groupCol} AS gid,
      COUNT(DISTINCT p.id) AS total_projects,
      SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) AS completed_projects,
      COALESCE(SUM((SELECT SUM(amount) FROM client_payments WHERE project_id = p.id AND status = 'received')), 0) AS total_revenue,
      COALESCE(SUM(CASE WHEN p.status = 'completed' THEN (SELECT SUM(amount) FROM client_payments WHERE project_id = p.id AND status = 'received') END), 0) AS completed_revenue,
      COALESCE(SUM(CASE WHEN p.status = 'completed' THEN (SELECT SUM(payment_amount) FROM crew_assignments WHERE project_id = p.id AND paid_status IN ('paid', 'partial')) END), 0) AS total_crew,
      COALESCE(SUM(CASE WHEN p.status = 'completed' THEN (SELECT SUM(amount) FROM expenses WHERE project_id = p.id AND status = 'confirmed') END), 0) AS total_expenses
    FROM projects p
    WHERE p.${groupCol} IS NOT NULL${pf.sql}
    GROUP BY p.${groupCol}
  `).all(...pf.params);
  return rows.map(r => {
    const net = r.completed_revenue - r.total_crew - r.total_expenses;
    return {
      ...r,
      net_profit: r.completed_projects > 0 ? Math.round(net * 100) / 100 : null,
      margin: r.completed_projects > 0 && r.completed_revenue > 0
        ? Math.round((net / r.completed_revenue) * 1000) / 10
        : null,
    };
  });
}

router.get('/categories', (req, res) => {
  const rows = marginRows('category_id', readFilter(req.query));
  const cat = db.prepare('SELECT id, name, group_name FROM project_categories WHERE id = ?');
  res.json(rows.map(r => {
    const c = cat.get(r.gid) || { id: r.gid, name: 'Uncategorized', group_name: null };
    const { gid, ...rest } = r;
    return { id: c.id, name: c.name, group_name: c.group_name, ...rest };
  }).sort((a, b) => b.total_revenue - a.total_revenue));
});

router.get('/clients', (req, res) => {
  const rows = marginRows('client_id', readFilter(req.query));
  const cl = db.prepare('SELECT id, name, company FROM clients WHERE id = ?');
  res.json(rows.map(r => {
    const c = cl.get(r.gid) || { id: r.gid, name: 'Unknown', company: null };
    const { gid, ...rest } = r;
    return { id: c.id, name: c.name, company: c.company, ...rest };
  }).sort((a, b) => b.total_revenue - a.total_revenue));
});

// Top expense categories, all time, confirmed only
router.get('/expenses', (req, res) => {
  const data = db.prepare(`
    SELECT ec.name, COALESCE(SUM(e.amount), 0) as total
    FROM expense_categories ec
    LEFT JOIN expenses e ON e.category_id = ec.id AND e.status = 'confirmed'
    GROUP BY ec.id
    HAVING total > 0
    ORDER BY total DESC
  `).all();
  res.json(data);
});

// GET /api/finances/pl?year=YYYY: monthly P&L and annual totals (cash basis).
// netProfit here is project profit: expenses always belong to a project, so no
// business overhead is subtracted.
router.get('/pl', (req, res) => {
  const year = req.query.year || pristinaYear();
  const monthlyData = plMonths(year).map(m => ({
    month: m.month, label: monthLabel(m.month, false),
    revenue: m.revenue, expenses: m.expenses, crewCosts: m.crewCosts, netProfit: m.projectProfit,
  }));
  const totals = monthlyData.reduce((acc, m) => ({
    revenue: acc.revenue + m.revenue,
    expenses: acc.expenses + m.expenses,
    crewCosts: acc.crewCosts + m.crewCosts,
    netProfit: acc.netProfit + m.netProfit,
  }), { revenue: 0, expenses: 0, crewCosts: 0, netProfit: 0 });
  Object.keys(totals).forEach(k => { totals[k] = Math.round(totals[k] * 100) / 100; });
  res.json({ year, months: monthlyData, totals });
});

function plMonths(year) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  return monthlyFigures(months);
}

// GET /api/finances/ar-aging: receivables from the shared owed helper. Invoiced
// balances age from their due date; the not yet invoiced remainder is its own
// bucket. Completed projects are included.
router.get('/ar-aging', (req, res) => {
  res.json(receivableRows(readFilter(req.query)));
});

// GET /api/finances/tax-records?status=unpaid&year=2026
router.get('/tax-records', (req, res) => {
  const { status, year } = req.query;
  let query = 'SELECT * FROM invoice_tax_records WHERE 1=1';
  const params = [];
  if (status) { query += ' AND tax_status = ?'; params.push(status); }
  if (year) { query += " AND strftime('%Y', created_at) = ?"; params.push(year); }
  query += ' ORDER BY created_at DESC';
  res.json(db.prepare(query).all(...params));
});

// PATCH /api/finances/tax-records/:id/paid
router.patch('/tax-records/:id/paid', (req, res) => {
  const paid_date = pristinaToday();
  const result = db.prepare("UPDATE invoice_tax_records SET tax_status='paid', paid_date=? WHERE id=?").run(paid_date, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// PATCH /api/finances/tax-records/:id/unpaid
router.patch('/tax-records/:id/unpaid', (req, res) => {
  const result = db.prepare("UPDATE invoice_tax_records SET tax_status='unpaid', paid_date=NULL WHERE id=?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// GET /api/finances/pl-pdf?year=YYYY: light themed P&L PDF export
router.get('/pl-pdf', (req, res) => {
  const PDFDocument = require('pdfkit');
  const year = req.query.year || pristinaYear();

  // The same monthly computation the P&L tab, the chart and the stats read.
  const monthlyData = plMonths(year).map(m => ({
    label: monthLabel(m.month, false),
    revenue: m.revenue, expenses: m.expenses, crewCosts: m.crewCosts, net: m.projectProfit,
  }));
  const totals = monthlyData.reduce((acc, m) => ({
    revenue: acc.revenue + m.revenue,
    expenses: acc.expenses + m.expenses,
    crewCosts: acc.crewCosts + m.crewCosts,
    net: acc.net + m.net,
  }), { revenue: 0, expenses: 0, crewCosts: 0, net: 0 });

  const agencyRow = db.prepare("SELECT value FROM settings WHERE key='agency_name'").get();
  const agencyName = agencyRow?.value || 'MASSIV TV';
  const logoRow = db.prepare("SELECT value FROM settings WHERE key='agency_logo'").get();
  const logoData = logoRow?.value || null;
  const fmtMoney = v => `€${Number(v || 0).toFixed(2)}`;

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${agencyName.replace(/[^a-z0-9]/gi, '-')}-PL-${year}.pdf"`);
  doc.pipe(res);

  const pageLeft = 50;
  const pageRight = 545;
  const W = pageRight - pageLeft;

  // Header
  let headerY = 45;
  if (logoData) {
    try {
      const imgBuf = Buffer.from(logoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      doc.image(imgBuf, pageLeft, headerY, { fit: [110, 44] });
    } catch (_) {
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text(agencyName, pageLeft, headerY + 10, { lineBreak: false });
    }
  } else {
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text(agencyName, pageLeft, headerY + 10, { lineBreak: false });
  }
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#111')
    .text(`PROFIT & LOSS ${year}`, pageLeft, headerY + 10, { align: 'right', lineBreak: false });

  doc.y = 100;
  doc.fontSize(9).font('Helvetica').fillColor('#888')
    .text(`Period: 1 Jan ${year} to 31 Dec ${year}    Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, { align: 'right' });

  doc.moveDown(0.5);
  doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).strokeColor('#cccccc').lineWidth(1).stroke();
  doc.moveDown(1);

  // P&L Statement
  const L_W = 340;
  const R_W = W - L_W;
  function statRow(label, value, opts = {}) {
    const { bold = false, indent = false, divider = false, large = false } = opts;
    if (divider) {
      doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
      doc.y += 5;
    }
    const fs = large ? 11 : 10;
    const fn = bold ? 'Helvetica-Bold' : 'Helvetica';
    const xL = indent ? pageLeft + 20 : pageLeft;
    const lw = indent ? L_W - 20 : L_W;
    const ry = doc.y;
    doc.fontSize(fs).font(fn).fillColor(bold ? '#000' : '#333').text(label, xL, ry, { width: lw, lineBreak: false });
    doc.fillColor(value < 0 ? '#cc0000' : (bold ? '#000' : '#222'))
      .text(fmtMoney(value), xL + lw, ry, { width: R_W - (indent ? 20 : 0), align: 'right', lineBreak: false });
    doc.moveDown(bold ? 0.5 : 0.4);
  }

  statRow('REVENUE', totals.revenue, { bold: true, large: true });
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#555').text('COST OF SERVICES', pageLeft);
  doc.moveDown(0.3);
  statRow('Crew Costs', totals.crewCosts, { indent: true });
  statRow('Expenses', totals.expenses, { indent: true });
  statRow('Total Cost of Services', totals.crewCosts + totals.expenses, { bold: true, divider: true });
  doc.moveDown(0.5);
  doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).strokeColor('#cccccc').lineWidth(1).stroke();
  doc.moveDown(0.5);
  // Project profit, not net profit: every expense belongs to a project, so no
  // business overhead is subtracted here.
  statRow('PROJECT PROFIT', totals.net, { bold: true, large: true });

  doc.moveDown(2);
  doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).strokeColor('#cccccc').lineWidth(1).stroke();
  doc.moveDown(0.8);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('MONTHLY BREAKDOWN');
  doc.moveDown(0.8);

  // Table header
  const colX = [pageLeft, pageLeft + 80, pageLeft + 200, pageLeft + 310, pageLeft + 410];
  const colW = [80, 120, 110, 100, 90];
  const hdrs = ['Month', 'Revenue', 'Crew Cost', 'Expenses', 'Project Profit'];
  const hY = doc.y;
  hdrs.forEach((h, i) => {
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#555')
      .text(h, colX[i], hY, { width: colW[i], align: i === 0 ? 'left' : 'right', lineBreak: false });
  });
  doc.moveDown(0.6);
  doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
  doc.y += 4;

  monthlyData.forEach(m => {
    if (m.revenue === 0 && m.expenses === 0 && m.crewCosts === 0) return;
    const ry = doc.y;
    doc.fontSize(9).font('Helvetica').fillColor('#333').text(m.label, colX[0], ry, { width: colW[0], lineBreak: false });
    doc.fillColor('#222').text(fmtMoney(m.revenue), colX[1], ry, { width: colW[1], align: 'right', lineBreak: false });
    doc.fillColor('#222').text(fmtMoney(m.crewCosts), colX[2], ry, { width: colW[2], align: 'right', lineBreak: false });
    doc.fillColor('#222').text(fmtMoney(m.expenses), colX[3], ry, { width: colW[3], align: 'right', lineBreak: false });
    doc.fillColor(m.net < 0 ? '#cc0000' : '#222').text(fmtMoney(m.net), colX[4], ry, { width: colW[4], align: 'right', lineBreak: false });
    doc.moveDown(0.5);
  });

  doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
  doc.y += 4;
  const tY = doc.y;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#000').text('TOTAL', colX[0], tY, { width: colW[0], lineBreak: false });
  doc.text(fmtMoney(totals.revenue), colX[1], tY, { width: colW[1], align: 'right', lineBreak: false });
  doc.text(fmtMoney(totals.crewCosts), colX[2], tY, { width: colW[2], align: 'right', lineBreak: false });
  doc.text(fmtMoney(totals.expenses), colX[3], tY, { width: colW[3], align: 'right', lineBreak: false });
  doc.fillColor(totals.net < 0 ? '#cc0000' : '#000')
    .text(fmtMoney(totals.net), colX[4], tY, { width: colW[4], align: 'right', lineBreak: false });

  doc.fontSize(8).font('Helvetica').fillColor('#aaa')
    .text(`${agencyName}  |  Profit & Loss  |  Cash Basis`, pageLeft, doc.page.height - 45, { align: 'center', width: W });

  doc.end();
});

module.exports = router;
