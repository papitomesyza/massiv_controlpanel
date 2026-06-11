const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

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

  const expenses = db.prepare(`
    SELECT COALESCE(SUM(e.amount), 0) as total FROM expenses e
    JOIN projects p ON p.id = e.project_id
    WHERE strftime('%Y-%m', e.date) = ?${expFilter}
  `).get(...expParams).total;

  const crewCosts = db.prepare(`
    SELECT COALESCE(SUM(ca.days * ca.rate_per_day), 0) as total
    FROM crew_assignments ca
    JOIN projects p ON p.id = ca.project_id
    WHERE strftime('%Y-%m', COALESCE(p.shoot_date, p.created_at)) = ?${crewFilter}
  `).get(...crewParams).total;

  const outstanding = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM client_payments WHERE status='pending'
  `).get().total;

  const unpaidCrew = db.prepare(`
    SELECT COALESCE(SUM(days * rate_per_day), 0) as total FROM crew_assignments WHERE paid_status='unpaid'
  `).get().total;

  const completedThisMonth = db.prepare(`
    SELECT COUNT(*) as v FROM project_status_history
    WHERE to_status='completed' AND strftime('%Y-%m', changed_at) = ?
  `).get(month).v;

  const avgProjectValue = db.prepare(`
    SELECT COALESCE(AVG(agreed_budget), 0) as v FROM projects WHERE agreed_budget > 0
  `).get().v;

  res.json({ revenue, expenses, crewCosts, netProfit: revenue - expenses - crewCosts, outstanding, unpaidCrew, completedThisMonth, avgProjectValue });
});

router.get('/all-time-kpis', (req, res) => {
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM client_payments WHERE status='received'").get().v;
  const totalCompleted = db.prepare("SELECT COUNT(*) as v FROM projects WHERE status='completed'").get().v;
  const avgProjectValue = db.prepare("SELECT COALESCE(AVG(agreed_budget),0) as v FROM projects WHERE agreed_budget > 0").get().v;

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
    totalRevenue,
    totalCompleted,
    avgProjectValue,
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
    SELECT cp.*, p.title as project_title, c.name as client_name
    FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE cp.status = 'pending'
    ORDER BY cp.date ASC
  `).all();
  res.json(rows);
});

router.get('/details/unpaid-crew', (req, res) => {
  const rows = db.prepare(`
    SELECT ca.*, cr.name as crew_name, p.title as project_title, p.id as project_id,
           (ca.days * ca.rate_per_day) as total_cost,
           (ca.days * ca.rate_per_day - COALESCE(ca.payment_amount, 0)) as remaining
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
      COALESCE((SELECT SUM(ca.days*ca.rate_per_day) FROM crew_assignments ca WHERE ca.project_id=p.id), 0) as crew_cost,
      COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.project_id=p.id), 0) as expenses
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.id IN (
      SELECT DISTINCT project_id FROM client_payments WHERE status='received' AND strftime('%Y-%m', date)=?
    )
    ORDER BY p.title
  `).all(month, month);
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
    const expenses = db.prepare(
      "SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE strftime('%Y-%m',date)=?"
    ).get(m).v;
    const crewCosts = db.prepare(`
      SELECT COALESCE(SUM(ca.days*ca.rate_per_day),0) as v
      FROM crew_assignments ca JOIN projects p ON p.id=ca.project_id
      WHERE strftime('%Y-%m', COALESCE(p.shoot_date, p.created_at))=?
    `).get(m).v;
    rows.push({ month: label, revenue, expenses, crewCosts, profit: revenue - expenses - crewCosts });
  }
  res.json(rows);
});

router.get('/categories', (req, res) => {
  const data = db.prepare(`
    SELECT pc.name, pc.group_name,
      COUNT(DISTINCT p.id) as total_projects,
      COALESCE((SELECT SUM(cp.amount) FROM client_payments cp JOIN projects p2 ON p2.id=cp.project_id WHERE p2.category_id=pc.id AND cp.status='received'),0) as total_revenue,
      COALESCE((SELECT SUM(ca.days*ca.rate_per_day) FROM crew_assignments ca JOIN projects p3 ON p3.id=ca.project_id WHERE p3.category_id=pc.id),0) as total_crew,
      COALESCE((SELECT SUM(e.amount) FROM expenses e JOIN projects p4 ON p4.id=e.project_id WHERE p4.category_id=pc.id),0) as total_expenses
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
      COALESCE((SELECT SUM(e.amount) FROM expenses e JOIN projects p4 ON p4.id=e.project_id WHERE p4.client_id=c.id),0) as total_expenses
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

router.get('/expenses', (req, res) => {
  const data = db.prepare(`
    SELECT ec.name, COALESCE(SUM(e.amount), 0) as total
    FROM expense_categories ec
    LEFT JOIN expenses e ON e.category_id = ec.id
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

module.exports = router;
