const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

function validateMoney(val, name) {
  const n = Number(val);
  if (!Number.isFinite(n)) return `${name} must be a number`;
  if (n < 0) return `${name} must be at least 0`;
  if (n > 1000000) return `${name} must be at most 1,000,000`;
  return null;
}

router.get('/stats', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const { category_id, client_id } = req.query;

  let revFilter = '';
  let expFilter = '';
  let crewFilter = '';
  const revParams = [month];
  const expParams = [month];
  const crewParams = [month];

  if (category_id) {
    revFilter = ' AND p.category_id = ?'; revParams.push(category_id);
    expFilter = ' AND p.category_id = ?'; expParams.push(category_id);
    crewFilter = ' AND p.category_id = ?'; crewParams.push(category_id);
  }
  if (client_id) {
    revFilter += ' AND p.client_id = ?'; revParams.push(client_id);
    expFilter += ' AND p.client_id = ?'; expParams.push(client_id);
    crewFilter += ' AND p.client_id = ?'; crewParams.push(client_id);
  }

  const revenue = db.prepare(`
    SELECT COALESCE(SUM(cp.amount), 0) as total FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    WHERE cp.status='received' AND strftime('%Y-%m', cp.date) = ?${revFilter}
  `).get(...revParams).total;

  // Only confirmed expenses
  const expenses = db.prepare(`
    SELECT COALESCE(SUM(e.amount), 0) as total FROM expenses e
    JOIN projects p ON p.id = e.project_id
    WHERE e.status = 'confirmed' AND strftime('%Y-%m', e.date) = ?${expFilter}
  `).get(...expParams).total;

  // Cash-basis crew cost: sum of recorded payment amounts whose payment_date falls in the month
  const crewCosts = db.prepare(`
    SELECT COALESCE(SUM(ca.payment_amount), 0) as total
    FROM crew_assignments ca
    JOIN projects p ON p.id = ca.project_id
    WHERE ca.paid_status IN ('paid', 'partial') AND strftime('%Y-%m', ca.payment_date) = ?${crewFilter}
  `).get(...crewParams).total;

  // Pending = owed balance > 0 AND (no shoot date OR shoot passed OR completed)
  const outstanding = db.prepare(`
    SELECT COALESCE(SUM(p.agreed_budget - COALESCE(r.total, 0)), 0) as total
    FROM projects p
    LEFT JOIN (
      SELECT project_id, SUM(amount) as total FROM client_payments WHERE status='received' GROUP BY project_id
    ) r ON r.project_id = p.id
    WHERE (p.agreed_budget - COALESCE(r.total, 0)) > 0
      AND (p.shoot_date IS NULL OR p.shoot_date <= date('now') OR p.status = 'completed')
  `).get().total;

  // Upcoming = owed balance > 0 AND shoot date is in the future AND not completed
  const upcoming = db.prepare(`
    SELECT COALESCE(SUM(p.agreed_budget - COALESCE(r.total, 0)), 0) as total
    FROM projects p
    LEFT JOIN (
      SELECT project_id, SUM(amount) as total FROM client_payments WHERE status='received' GROUP BY project_id
    ) r ON r.project_id = p.id
    WHERE (p.agreed_budget - COALESCE(r.total, 0)) > 0
      AND p.shoot_date > date('now')
      AND p.status != 'completed'
  `).get().total;

  // Unpaid crew: sum of remaining-owed (days*rate - payment_amount, never below 0) for unpaid/partial
  const unpaidCrew = db.prepare(`
    SELECT COALESCE(SUM(MAX(0, ca.days * ca.rate_per_day - COALESCE(ca.payment_amount, 0))), 0) as total
    FROM crew_assignments ca WHERE ca.paid_status IN ('unpaid', 'partial')
  `).get().total;

  // Count distinct projects that completed this month
  const completedThisMonth = db.prepare(`
    SELECT COUNT(DISTINCT project_id) as v FROM project_status_history
    WHERE to_status='completed' AND strftime('%Y-%m', changed_at) = ?
  `).get(month).v;

  // Average value of completed projects only
  const avgProjectValue = db.prepare(`
    SELECT COALESCE(AVG(agreed_budget), 0) as v FROM projects WHERE agreed_budget > 0 AND status = 'completed'
  `).get().v;

  // Overdue: pending payments older than 30 days
  const overdueAmount = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM client_payments
    WHERE status='pending' AND date < date('now', '-30 days')
  `).get().total;

  res.json({
    revenue, expenses, crewCosts,
    netProfit: revenue - expenses - crewCosts,
    outstanding, upcoming, unpaidCrew, completedThisMonth, avgProjectValue, overdueAmount,
  });
});

router.get('/all-time-kpis', (req, res) => {
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM client_payments WHERE status='received'").get().v;
  const totalCompleted = db.prepare("SELECT COUNT(*) as v FROM projects WHERE status='completed'").get().v;
  // Average value of completed projects only
  const avgProjectValue = db.prepare("SELECT COALESCE(AVG(agreed_budget),0) as v FROM projects WHERE agreed_budget > 0 AND status = 'completed'").get().v;

  const bestMonthRow = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
    FROM client_payments WHERE status='received'
    GROUP BY month ORDER BY total DESC LIMIT 1
  `).get();

  const bestClientRow = db.prepare(`
    SELECT c.name, SUM(cp.amount) as total
    FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    JOIN clients c ON c.id = p.client_id
    WHERE cp.status = 'received'
    GROUP BY c.id ORDER BY total DESC LIMIT 1
  `).get();

  res.json({
    totalRevenue, totalCompleted, avgProjectValue,
    bestMonth: bestMonthRow ? { month: bestMonthRow.month, amount: bestMonthRow.total } : null,
    bestClient: bestClientRow ? { name: bestClientRow.name, amount: bestClientRow.total } : null,
  });
});

router.get('/details/revenue', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = db.prepare(`
    SELECT cp.*, p.title as project_title, c.name as client_name
    FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE cp.status = 'received' AND strftime('%Y-%m', cp.date) = ?
    ORDER BY cp.date DESC
  `).all(month);
  res.json(rows);
});

router.get('/details/outstanding', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.title as project_title, c.name as client_name,
      p.agreed_budget,
      COALESCE(r.total, 0) as total_received,
      (p.agreed_budget - COALESCE(r.total, 0)) as outstanding
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN (
      SELECT project_id, SUM(amount) as total FROM client_payments WHERE status='received' GROUP BY project_id
    ) r ON r.project_id = p.id
    WHERE (p.agreed_budget - COALESCE(r.total, 0)) > 0
      AND (p.shoot_date IS NULL OR p.shoot_date <= date('now') OR p.status = 'completed')
    ORDER BY outstanding DESC
  `).all();
  res.json(rows);
});

router.get('/details/upcoming', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.title as project_title, c.name as client_name,
      p.agreed_budget,
      COALESCE(r.total, 0) as total_received,
      (p.agreed_budget - COALESCE(r.total, 0)) as outstanding,
      p.shoot_date
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN (
      SELECT project_id, SUM(amount) as total FROM client_payments WHERE status='received' GROUP BY project_id
    ) r ON r.project_id = p.id
    WHERE (p.agreed_budget - COALESCE(r.total, 0)) > 0
      AND p.shoot_date > date('now')
      AND p.status != 'completed'
    ORDER BY p.shoot_date ASC
  `).all();
  res.json(rows);
});

router.get('/details/unpaid-crew', (req, res) => {
  const rows = db.prepare(`
    SELECT ca.*, cr.name as crew_name, p.title as project_title, p.id as project_id,
           (ca.days * ca.rate_per_day) as total_cost,
           MAX(0, ca.days * ca.rate_per_day - COALESCE(ca.payment_amount, 0)) as remaining
    FROM crew_assignments ca
    JOIN crew cr ON cr.id = ca.crew_id
    JOIN projects p ON p.id = ca.project_id
    WHERE ca.paid_status IN ('unpaid', 'partial')
    ORDER BY cr.name
  `).all();
  res.json(rows);
});

router.get('/details/profit', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = db.prepare(`
    SELECT p.id, p.title, c.name as client_name,
      COALESCE((SELECT SUM(cp.amount) FROM client_payments cp WHERE cp.project_id=p.id AND cp.status='received' AND strftime('%Y-%m', cp.date)=?), 0) as revenue,
      COALESCE((SELECT SUM(ca.payment_amount) FROM crew_assignments ca WHERE ca.project_id=p.id AND ca.paid_status IN ('paid','partial') AND strftime('%Y-%m', ca.payment_date)=?), 0) as crew_cost,
      COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.project_id=p.id AND e.status='confirmed' AND strftime('%Y-%m', e.date)=?), 0) as expenses
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.id IN (
      SELECT DISTINCT project_id FROM client_payments WHERE status='received' AND strftime('%Y-%m', date)=?
      UNION
      SELECT DISTINCT project_id FROM crew_assignments WHERE paid_status IN ('paid','partial') AND strftime('%Y-%m', payment_date)=?
      UNION
      SELECT DISTINCT project_id FROM expenses WHERE status='confirmed' AND strftime('%Y-%m', date)=?
    )
    ORDER BY p.title
  `).all(month, month, month, month, month, month);
  res.json(rows.map(r => ({ ...r, net_profit: r.revenue - r.crew_cost - r.expenses })));
});

router.get('/chart', (req, res) => {
  const months = parseInt(req.query.months) || 6;
  const rows = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });

    const revenue = db.prepare(
      "SELECT COALESCE(SUM(amount),0) as v FROM client_payments WHERE status='received' AND strftime('%Y-%m',date)=?"
    ).get(m).v;

    // Only confirmed expenses
    const expensesAmt = db.prepare(
      "SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE status='confirmed' AND strftime('%Y-%m',date)=?"
    ).get(m).v;

    // Cash-basis crew cost: sum of payment_amount where payment_date falls in that month
    const crewCosts = db.prepare(`
      SELECT COALESCE(SUM(ca.payment_amount),0) as v
      FROM crew_assignments ca
      WHERE ca.paid_status IN ('paid', 'partial') AND strftime('%Y-%m', ca.payment_date)=?
    `).get(m).v;

    rows.push({ month: label, revenue, expenses: expensesAmt, crewCosts, profit: revenue - expensesAmt - crewCosts });
  }
  res.json(rows);
});

router.get('/categories', (req, res) => {
  const data = db.prepare(`
    SELECT pc.name, pc.group_name,
      COUNT(DISTINCT p.id) as total_projects,
      COALESCE((SELECT SUM(cp.amount) FROM client_payments cp JOIN projects p2 ON p2.id=cp.project_id WHERE p2.category_id=pc.id AND cp.status='received'),0) as total_revenue,
      COALESCE((SELECT SUM(ca.days*ca.rate_per_day) FROM crew_assignments ca JOIN projects p3 ON p3.id=ca.project_id WHERE p3.category_id=pc.id),0) as total_crew,
      COALESCE((SELECT SUM(e.amount) FROM expenses e JOIN projects p4 ON p4.id=e.project_id WHERE p4.category_id=pc.id AND e.status='confirmed'),0) as total_expenses
    FROM project_categories pc
    LEFT JOIN projects p ON p.category_id = pc.id
    GROUP BY pc.id
    HAVING COUNT(DISTINCT p.id) > 0
    ORDER BY total_revenue DESC
  `).all();

  res.json(data.map(r => ({
    ...r,
    net_profit: r.total_revenue - r.total_crew - r.total_expenses,
    margin: r.total_revenue > 0
      ? Math.round(((r.total_revenue - r.total_crew - r.total_expenses) / r.total_revenue) * 1000) / 10
      : 0,
  })));
});

router.get('/clients', (req, res) => {
  const data = db.prepare(`
    SELECT c.name, c.company,
      COUNT(DISTINCT p.id) as total_projects,
      COALESCE((SELECT SUM(cp.amount) FROM client_payments cp JOIN projects p2 ON p2.id=cp.project_id WHERE p2.client_id=c.id AND cp.status='received'),0) as total_revenue,
      COALESCE((SELECT SUM(ca.days*ca.rate_per_day) FROM crew_assignments ca JOIN projects p3 ON p3.id=ca.project_id WHERE p3.client_id=c.id),0) as total_crew,
      COALESCE((SELECT SUM(e.amount) FROM expenses e JOIN projects p4 ON p4.id=e.project_id WHERE p4.client_id=c.id AND e.status='confirmed'),0) as total_expenses
    FROM clients c
    LEFT JOIN projects p ON p.client_id = c.id
    GROUP BY c.id
    ORDER BY total_revenue DESC
  `).all();

  res.json(data.map(r => ({
    ...r,
    net_profit: r.total_revenue - r.total_crew - r.total_expenses,
    margin: r.total_revenue > 0
      ? Math.round(((r.total_revenue - r.total_crew - r.total_expenses) / r.total_revenue) * 1000) / 10
      : 0,
  })));
});

// Top expense categories — all time, confirmed only
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

router.get('/pending-payments', (req, res) => {
  const rows = db.prepare(`
    SELECT cp.*, p.title as project_title, p.id as project_id, c.name as client_name
    FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE cp.status = 'pending'
    ORDER BY cp.date ASC
  `).all();
  res.json(rows);
});

router.get('/receivables', (req, res) => {
  const rows = db.prepare(`
    SELECT cp.*, p.title as project_title, p.id as project_id, c.name as client_name,
           CAST(julianday('now') - julianday(cp.date) AS INTEGER) as days_pending
    FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE cp.status = 'pending'
    ORDER BY cp.date ASC
  `).all();
  res.json(rows);
});

// GET /api/finances/pl?year=YYYY — monthly P&L breakdown + annual totals (cash basis)
router.get('/pl', (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const monthlyData = months.map(ym => {
    const label = new Date(`${ym}-01T00:00:00`).toLocaleString('default', { month: 'short' });
    const revenue = db.prepare(
      "SELECT COALESCE(SUM(amount),0) as v FROM client_payments WHERE status='received' AND strftime('%Y-%m',date)=?"
    ).get(ym).v;
    const expenses = db.prepare(
      "SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE status='confirmed' AND strftime('%Y-%m',date)=?"
    ).get(ym).v;
    const crewCosts = db.prepare(
      "SELECT COALESCE(SUM(payment_amount),0) as v FROM crew_assignments WHERE paid_status IN ('paid','partial') AND strftime('%Y-%m',payment_date)=?"
    ).get(ym).v;
    return { month: ym, label, revenue, expenses, crewCosts, netProfit: revenue - expenses - crewCosts };
  });
  const totals = monthlyData.reduce((acc, m) => ({
    revenue: acc.revenue + m.revenue,
    expenses: acc.expenses + m.expenses,
    crewCosts: acc.crewCosts + m.crewCosts,
    netProfit: acc.netProfit + m.netProfit,
  }), { revenue: 0, expenses: 0, crewCosts: 0, netProfit: 0 });
  res.json({ year, months: monthlyData, totals });
});

// GET /api/finances/ar-aging — A/R aging combining pending payments + implied project balances
router.get('/ar-aging', (req, res) => {
  const pendingRows = db.prepare(`
    SELECT 'payment' as source, cp.id, cp.project_id,
      p.title as project_title, c.name as client_name,
      cp.amount, cp.date as aged_from, cp.method, cp.notes,
      CAST(julianday('now') - julianday(cp.date) AS INTEGER) as days_aged
    FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE cp.status = 'pending' AND cp.amount > 0
    ORDER BY cp.date ASC
  `).all();

  // Projects with implied balance not covered by any pending payment row
  const balanceRows = db.prepare(`
    SELECT * FROM (
      SELECT 'balance' as source, p.id, p.id as project_id,
        p.title as project_title, c.name as client_name,
        (p.agreed_budget
          - COALESCE((SELECT SUM(amount) FROM client_payments WHERE project_id=p.id AND status='received'), 0)
          - COALESCE((SELECT SUM(amount) FROM client_payments WHERE project_id=p.id AND status='pending'), 0)
        ) as amount,
        p.created_at as aged_from,
        CAST(julianday('now') - julianday(p.created_at) AS INTEGER) as days_aged
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.status != 'completed'
    ) WHERE amount > 0
    ORDER BY aged_from ASC
  `).all();

  const buckets = { current: 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const allRows = [...pendingRows, ...balanceRows].map(r => {
    const bucket = r.days_aged <= 30 ? 'current' : r.days_aged <= 60 ? '31-60' : r.days_aged <= 90 ? '61-90' : '90+';
    buckets[bucket] += r.amount;
    return { ...r, bucket };
  });
  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  res.json({ rows: allRows, buckets, total });
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
  const paid_date = new Date().toISOString().split('T')[0];
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

// GET /api/finances/pl-pdf?year=YYYY — light-themed P&L PDF export
router.get('/pl-pdf', (req, res) => {
  const PDFDocument = require('pdfkit');
  const year = req.query.year || String(new Date().getFullYear());

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const monthlyData = months.map(ym => {
    const label = new Date(`${ym}-01T00:00:00`).toLocaleString('default', { month: 'short' });
    const revenue = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM client_payments WHERE status='received' AND strftime('%Y-%m',date)=?").get(ym).v;
    const expenses = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE status='confirmed' AND strftime('%Y-%m',date)=?").get(ym).v;
    const crewCosts = db.prepare("SELECT COALESCE(SUM(payment_amount),0) as v FROM crew_assignments WHERE paid_status IN ('paid','partial') AND strftime('%Y-%m',payment_date)=?").get(ym).v;
    return { label, revenue, expenses, crewCosts, net: revenue - expenses - crewCosts };
  });
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
    .text(`PROFIT & LOSS — ${year}`, pageLeft, headerY + 10, { align: 'right', lineBreak: false });

  doc.y = 100;
  doc.fontSize(9).font('Helvetica').fillColor('#888')
    .text(`Period: 1 Jan ${year} — 31 Dec ${year}    Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, { align: 'right' });

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
  doc.moveDown(0.3);
  statRow('GROSS PROFIT', totals.revenue - totals.crewCosts - totals.expenses, { bold: true, large: true, divider: true });
  doc.moveDown(0.5);
  doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).strokeColor('#cccccc').lineWidth(1).stroke();
  doc.moveDown(0.5);
  statRow('NET PROFIT', totals.net, { bold: true, large: true });

  doc.moveDown(2);
  doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).strokeColor('#cccccc').lineWidth(1).stroke();
  doc.moveDown(0.8);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('MONTHLY BREAKDOWN');
  doc.moveDown(0.8);

  // Table header
  const colX = [pageLeft, pageLeft + 80, pageLeft + 200, pageLeft + 310, pageLeft + 410];
  const colW = [80, 120, 110, 100, 90];
  const hdrs = ['Month', 'Revenue', 'Crew Cost', 'Expenses', 'Net Profit'];
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
