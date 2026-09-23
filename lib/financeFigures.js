// The one place the money figures are computed. Every route that shows revenue,
// costs, project profit or what the agency is owed reads from here, so the
// Dashboard, the Finances page, the P&L and its PDF can never drift apart.
//
// Two computations live here:
//
//   moneyRows / monthlyFigures / projectProfitForMonth
//     Cash basis. Revenue is received client payments by payment date, expenses
//     are confirmed expenses by expense date, crew cost is recorded crew payment
//     amounts by payment date. Project profit is revenue minus both costs.
//
//   owedByProject / receivableRows / owedSummary
//     What the agency is owed, per project: agreed budget, cash received, amount
//     invoiced, unpaid invoiced balance, the part of that balance past its due
//     date, and the not yet invoiced remainder.
//
//   crewAssignmentFigures / crewOwedSummary
//     What the agency owes its crew for project work: agreed (days x rate),
//     paid (the recorded payment amount) and the unpaid remainder. The crew
//     ledger (crew_debts) is kept apart on purpose and never enters these
//     figures or the P&L.

const { db } = require('../db/database');
const { pristinaToday } = require('./pristinaDate');

const round2 = v => Math.round((Number(v) || 0) * 100) / 100;

// ─── Filters ─────────────────────────────────────────────────────────────────
// A filter narrows every figure to the projects of one client and/or one
// category (or category group). It becomes a SQL fragment against the projects
// alias `p`, so each query applies it the same way.

function readFilter(query = {}) {
  const f = {};
  if (query.client_id) f.clientId = Number(query.client_id) || null;
  if (query.category_id) f.categoryId = Number(query.category_id) || null;
  if (query.group) f.group = String(query.group);
  return f;
}

function isFiltered(f = {}) {
  return !!(f.clientId || f.categoryId || f.group);
}

function projectFilterSql(f = {}, alias = 'p') {
  let sql = '';
  const params = [];
  if (f.clientId) { sql += ` AND ${alias}.client_id = ?`; params.push(f.clientId); }
  if (f.categoryId) { sql += ` AND ${alias}.category_id = ?`; params.push(f.categoryId); }
  if (f.group) {
    sql += ` AND ${alias}.category_id IN (SELECT id FROM project_categories WHERE group_name = ?)`;
    params.push(f.group);
  }
  return { sql, params };
}

// ─── Cash basis money, by month and project ──────────────────────────────────

// Every received payment, confirmed expense and recorded crew payment between
// two months inclusive, summed per month and project. The single source of the
// monthly figures.
function moneyRows(fromYm, toYm, f = {}) {
  const pf = projectFilterSql(f);
  const range = [fromYm, toYm];

  const revenue = db.prepare(`
    SELECT strftime('%Y-%m', cp.date) AS ym, cp.project_id AS project_id, SUM(cp.amount) AS v
    FROM client_payments cp JOIN projects p ON p.id = cp.project_id
    WHERE cp.status = 'received' AND strftime('%Y-%m', cp.date) BETWEEN ? AND ?${pf.sql}
    GROUP BY ym, cp.project_id
  `).all(...range, ...pf.params);

  const expenses = db.prepare(`
    SELECT strftime('%Y-%m', e.date) AS ym, e.project_id AS project_id, SUM(e.amount) AS v
    FROM expenses e JOIN projects p ON p.id = e.project_id
    WHERE e.status = 'confirmed' AND strftime('%Y-%m', e.date) BETWEEN ? AND ?${pf.sql}
    GROUP BY ym, e.project_id
  `).all(...range, ...pf.params);

  const crew = db.prepare(`
    SELECT strftime('%Y-%m', ca.payment_date) AS ym, ca.project_id AS project_id, SUM(ca.payment_amount) AS v
    FROM crew_assignments ca JOIN projects p ON p.id = ca.project_id
    WHERE ca.paid_status IN ('paid', 'partial') AND strftime('%Y-%m', ca.payment_date) BETWEEN ? AND ?${pf.sql}
    GROUP BY ym, ca.project_id
  `).all(...range, ...pf.params);

  const map = new Map();
  const slot = (ym, pid) => {
    const k = `${ym}|${pid}`;
    if (!map.has(k)) map.set(k, { ym, project_id: pid, revenue: 0, expenses: 0, crewCosts: 0 });
    return map.get(k);
  };
  revenue.forEach(r => { slot(r.ym, r.project_id).revenue += r.v || 0; });
  expenses.forEach(r => { slot(r.ym, r.project_id).expenses += r.v || 0; });
  crew.forEach(r => { slot(r.ym, r.project_id).crewCosts += r.v || 0; });
  return [...map.values()];
}

// Totals for each listed month (YYYY-MM strings, in order). Months with no money
// come back as zeros so a chart or table keeps its full run of months.
function monthlyFigures(months, f = {}) {
  if (!months.length) return [];
  const sorted = [...months].sort();
  const rows = moneyRows(sorted[0], sorted[sorted.length - 1], f);
  const byMonth = new Map(months.map(m => [m, { month: m, revenue: 0, expenses: 0, crewCosts: 0 }]));
  rows.forEach(r => {
    const m = byMonth.get(r.ym);
    if (!m) return;
    m.revenue += r.revenue; m.expenses += r.expenses; m.crewCosts += r.crewCosts;
  });
  return months.map(m => {
    const x = byMonth.get(m);
    const revenue = round2(x.revenue);
    const expenses = round2(x.expenses);
    const crewCosts = round2(x.crewCosts);
    return { month: m, revenue, expenses, crewCosts, projectProfit: round2(revenue - expenses - crewCosts) };
  });
}

// One month's money split per project, for the profit detail.
function projectProfitForMonth(ym, f = {}) {
  return moneyRows(ym, ym, f).map(r => ({
    project_id: r.project_id,
    revenue: round2(r.revenue),
    expenses: round2(r.expenses),
    crewCosts: round2(r.crewCosts),
    projectProfit: round2(r.revenue - r.expenses - r.crewCosts),
  }));
}

// ─── What the agency is owed ─────────────────────────────────────────────────

// Per project: agreed budget, cash received, amount invoiced, the unpaid
// invoiced balance and the part of it past due, and the not yet invoiced
// remainder. Invoices not linked to any project are returned as their own rows
// (project_id null) so the invoiced total always equals the Invoices page.
//
// Definitions, so every reader agrees:
//   invoiced          issued or paid invoices, amount_due (drafts are not bills)
//   invoicedUnpaid    sum over issued invoices of amount_due minus amount_paid,
//                     exactly the Invoices page outstanding figure
//   overdue           the part of invoicedUnpaid whose due date has passed
//   uninvoiced        agreed budget not yet covered by an invoice or by a
//                     payment taken directly on the project, never below zero
//   owed              invoicedUnpaid plus uninvoiced
function owedByProject(f = {}, today = pristinaToday()) {
  const pf = projectFilterSql(f);

  const projects = db.prepare(`
    SELECT p.id, p.title, p.status, p.shoot_date, p.client_id, p.category_id,
      COALESCE(p.agreed_budget, 0) AS agreed_budget,
      c.name AS client_name,
      COALESCE((SELECT SUM(amount) FROM client_payments WHERE project_id = p.id AND status = 'received'), 0) AS received,
      COALESCE((SELECT SUM(amount) FROM client_payments WHERE project_id = p.id AND status = 'received' AND invoice_id IS NULL), 0) AS received_direct,
      COALESCE((SELECT SUM(amount_due) FROM invoices WHERE project_id = p.id AND status IN ('issued', 'paid')), 0) AS invoiced
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE 1 = 1${pf.sql}
  `).all(...pf.params);

  // Issued invoices with a balance, for the projects in scope and, unless a
  // category narrows the view, the invoices that belong to no project.
  const invParams = [];
  let invWhere = "i.status = 'issued' AND (i.amount_due - COALESCE(i.amount_paid, 0)) > 0.005";
  if (f.categoryId || f.group) {
    invWhere += ` AND i.project_id IN (SELECT p.id FROM projects p WHERE 1 = 1${pf.sql})`;
    invParams.push(...pf.params);
  } else if (f.clientId) {
    invWhere += ` AND (i.project_id IN (SELECT p.id FROM projects p WHERE 1 = 1${pf.sql}) OR (i.project_id IS NULL AND i.client_id = ?))`;
    invParams.push(...pf.params, f.clientId);
  }
  const invoices = db.prepare(`
    SELECT i.id, i.invoice_number, i.project_id, i.client_id, i.client_name, i.due_date, i.issue_date,
      i.amount_due, COALESCE(i.amount_paid, 0) AS amount_paid
    FROM invoices i
    WHERE ${invWhere}
  `).all(...invParams).map(i => {
    const balance = round2(i.amount_due - i.amount_paid);
    return { ...i, balance, overdue: !!(i.due_date && i.due_date < today) };
  });

  const invByProject = new Map();
  invoices.forEach(i => {
    if (i.project_id == null) return;
    if (!invByProject.has(i.project_id)) invByProject.set(i.project_id, []);
    invByProject.get(i.project_id).push(i);
  });

  const rows = projects.map(p => {
    const open = invByProject.get(p.id) || [];
    const invoicedUnpaid = round2(open.reduce((s, i) => s + i.balance, 0));
    const overdue = round2(open.filter(i => i.overdue).reduce((s, i) => s + i.balance, 0));
    const uninvoiced = round2(Math.max(0, p.agreed_budget - p.invoiced - p.received_direct));
    // Money is due once the shoot has happened, when there is no shoot date, or
    // once the project is completed. A future shoot's uninvoiced balance is
    // upcoming. Anything already invoiced is due whatever the shoot date.
    const due = !p.shoot_date || p.shoot_date <= today || p.status === 'completed';
    return {
      project_id: p.id,
      project_title: p.title,
      client_id: p.client_id,
      client_name: p.client_name,
      status: p.status,
      shoot_date: p.shoot_date,
      agreed_budget: round2(p.agreed_budget),
      received: round2(p.received),
      invoiced: round2(p.invoiced),
      invoicedUnpaid,
      overdue,
      uninvoiced,
      owed: round2(invoicedUnpaid + uninvoiced),
      due,
      invoices: open,
    };
  });

  invoices.filter(i => i.project_id == null).forEach(i => {
    rows.push({
      project_id: null,
      invoice_id: i.id,
      project_title: null,
      client_id: i.client_id,
      client_name: i.client_name,
      status: null,
      shoot_date: null,
      agreed_budget: 0,
      received: round2(i.amount_paid),
      invoiced: round2(i.amount_due),
      invoicedUnpaid: i.balance,
      overdue: i.overdue ? i.balance : 0,
      uninvoiced: 0,
      owed: i.balance,
      due: true,
      invoices: [i],
    });
  });

  return rows;
}

// The owed totals every screen shows. pending and upcoming are the Dashboard
// split: invoiced money is always pending, uninvoiced money is pending once the
// project is due and upcoming before that. pending + upcoming = total, and
// total - invoicedUnpaid = uninvoiced, so the Dashboard, the receivables and
// the Invoices page reconcile by the not yet invoiced component alone.
function owedSummary(f = {}, today = pristinaToday()) {
  return summarizeOwed(owedByProject(f, today));
}

// The owed totals over a set of owedByProject rows. owedSummary and
// owedByClient both total through here, so a per client figure is computed
// with exactly the same arithmetic as owedSummary({ clientId }).
function summarizeOwed(rows) {
  const s = { invoicedUnpaid: 0, overdue: 0, uninvoiced: 0, uninvoicedDue: 0, uninvoicedUpcoming: 0 };
  rows.forEach(r => {
    s.invoicedUnpaid += r.invoicedUnpaid;
    s.overdue += r.overdue;
    s.uninvoiced += r.uninvoiced;
    if (r.due) s.uninvoicedDue += r.uninvoiced;
    else s.uninvoicedUpcoming += r.uninvoiced;
  });
  Object.keys(s).forEach(k => { s[k] = round2(s[k]); });
  return {
    ...s,
    total: round2(s.invoicedUnpaid + s.uninvoiced),
    pending: round2(s.invoicedUnpaid + s.uninvoicedDue),
    upcoming: s.uninvoicedUpcoming,
    rows,
  };
}

// owedSummary for every client in one pass: owedByProject once, rows grouped by
// client_id (a project row by its project's client, an invoice with no project
// by the invoice's client). Identical to calling owedSummary({ clientId }) per
// client, without re-running the owed queries for each one.
function owedByClient(today = pristinaToday()) {
  const groups = new Map();
  owedByProject({}, today).forEach(r => {
    if (r.client_id == null) return;
    if (!groups.has(r.client_id)) groups.set(r.client_id, []);
    groups.get(r.client_id).push(r);
  });
  const out = new Map();
  groups.forEach((rows, clientId) => out.set(clientId, summarizeOwed(rows)));
  return out;
}

// Ageing. Invoiced balances age from their invoice due date; uninvoiced
// balances are not aged against any date and sit in their own bucket.
const AGE_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];

function daysBetween(fromYmd, toYmd) {
  const a = Date.UTC(...fromYmd.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...toYmd.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0)));
  return Math.round((b - a) / 86400000);
}

function ageBucket(daysOverdue) {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

function receivableRows(f = {}, today = pristinaToday()) {
  const summary = owedSummary(f, today);
  const rows = [];
  summary.rows.forEach(p => {
    p.invoices.forEach(i => {
      const daysOverdue = i.due_date ? daysBetween(i.due_date, today) : 0;
      rows.push({
        source: 'invoice',
        invoice_id: i.id,
        invoice_number: i.invoice_number,
        project_id: p.project_id,
        project_title: p.project_title,
        client_name: p.client_name || i.client_name || null,
        project_status: p.status,
        amount: i.balance,
        due_date: i.due_date,
        days_overdue: Math.max(0, daysOverdue),
        bucket: ageBucket(daysOverdue),
      });
    });
    if (p.uninvoiced > 0) {
      rows.push({
        source: 'uninvoiced',
        invoice_id: null,
        invoice_number: null,
        project_id: p.project_id,
        project_title: p.project_title,
        client_name: p.client_name,
        project_status: p.status,
        amount: p.uninvoiced,
        due_date: null,
        days_overdue: null,
        bucket: 'uninvoiced',
      });
    }
  });

  const buckets = Object.fromEntries([...AGE_BUCKETS, 'uninvoiced'].map(k => [k, 0]));
  rows.forEach(r => { buckets[r.bucket] = round2(buckets[r.bucket] + r.amount); });
  rows.sort((a, b) => (b.days_overdue ?? -1) - (a.days_overdue ?? -1) || b.amount - a.amount);

  return {
    rows,
    buckets,
    total: summary.total,
    invoiced: summary.invoicedUnpaid,
    uninvoiced: summary.uninvoiced,
    overdue: summary.overdue,
  };
}

// ─── What the agency owes its crew ───────────────────────────────────────────

// One row per crew assignment in scope, narrowed by the project filter and,
// optionally, by crew member. agreed is days x rate_per_day, paid is the
// recorded payment_amount, and remaining is agreed minus paid, never below 0,
// for assignments still unpaid or partial. A paid assignment has no remainder.
function crewAssignmentFigures(f = {}, opts = {}) {
  const pf = projectFilterSql(f);
  let where = `1 = 1${pf.sql}`;
  const params = [...pf.params];
  if (opts.crewId) { where += ' AND ca.crew_id = ?'; params.push(Number(opts.crewId)); }
  if (opts.unpaidOnly) where += " AND ca.paid_status IN ('unpaid', 'partial')";
  return db.prepare(`
    SELECT ca.*, cr.name AS crew_name, cr.role AS crew_role, cr.is_company, cr.service_type,
      p.id AS project_id, p.title AS project_title, p.status AS project_status, p.shoot_date,
      (ca.days * ca.rate_per_day) AS agreed,
      COALESCE(ca.payment_amount, 0) AS paid,
      CASE WHEN ca.paid_status IN ('unpaid', 'partial')
        THEN MAX(0, ca.days * ca.rate_per_day - COALESCE(ca.payment_amount, 0)) ELSE 0 END AS remaining
    FROM crew_assignments ca
    JOIN crew cr ON cr.id = ca.crew_id
    JOIN projects p ON p.id = ca.project_id
    WHERE ${where}
    ORDER BY cr.name, p.created_at
  `).all(...params).map(r => {
    const agreed = round2(r.agreed);
    const remaining = round2(r.remaining);
    return {
      ...r,
      agreed,
      // paid stays the recorded payment_amount: the cash P&L books crew cost
      // from it, so it is never inflated here.
      paid: round2(r.paid),
      remaining,
      // settled is what no longer needs paying, so agreed = settled + remaining
      // always holds, even for a row marked paid with no amount recorded.
      settled: round2(agreed - remaining),
      // Marked paid, but no payment amount was ever recorded.
      unrecorded: r.paid_status === 'paid' && !(Number(r.payment_amount) > 0),
      total_cost: agreed,
    };
  });
}

// Totals over crewAssignmentFigures. remaining is the Dashboard unpaid crew
// figure when no crew member is named.
function crewOwedSummary(f = {}, opts = {}) {
  const rows = crewAssignmentFigures(f, opts);
  const t = rows.reduce((a, r) => {
    a.agreed += r.agreed; a.paid += r.paid; a.remaining += r.remaining; a.settled += r.settled;
    return a;
  }, { agreed: 0, paid: 0, remaining: 0, settled: 0 });
  return {
    agreed: round2(t.agreed), paid: round2(t.paid), remaining: round2(t.remaining), settled: round2(t.settled), rows,
  };
}

// What is owed to each crew member: unpaid project assignments plus the unpaid
// ledger, keyed by crew id. The Crew cards and CrewDetail both read this, so the
// card figure and the detail figure are one number. The ledger stays out of the
// P&L and the Dashboard.
function crewOwedByMember() {
  const map = {};
  const slot = id => (map[id] = map[id] || { owed_assignments: 0, owed_ledger: 0, owed_total: 0 });
  crewAssignmentFigures().forEach(r => {
    const m = slot(r.crew_id);
    m.owed_assignments = round2(m.owed_assignments + r.remaining);
  });
  db.prepare(`
    SELECT crew_id, SUM(amount) AS total_unpaid FROM crew_debts WHERE status = 'unpaid' GROUP BY crew_id
  `).all().forEach(r => { slot(r.crew_id).owed_ledger = round2(r.total_unpaid); });
  Object.values(map).forEach(m => { m.owed_total = round2(m.owed_assignments + m.owed_ledger); });
  return map;
}

// Money validation shared by every route that stores a rate or an amount.
function validateMoney(val, name) {
  const n = Number(val);
  if (!Number.isFinite(n)) return `${name} must be a number`;
  if (n < 0) return `${name} must be at least 0`;
  if (n > 1000000) return `${name} must be at most 1,000,000`;
  return null;
}

module.exports = {
  round2,
  crewAssignmentFigures,
  crewOwedSummary,
  validateMoney,
  readFilter,
  isFiltered,
  projectFilterSql,
  moneyRows,
  monthlyFigures,
  projectProfitForMonth,
  owedByProject,
  owedSummary,
  owedByClient,
  crewOwedByMember,
  receivableRows,
  AGE_BUCKETS,
};
