const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { owedSummary, owedByClient, round2 } = require('../lib/financeFigures');

const cleanName = v => (typeof v === 'string' ? v.trim() : '');

// What a client owes, read from the shared owed helper with the client filter,
// so it always equals the Dashboard owed figures filtered to that client.
function clientOwed(clientId) {
  const s = owedSummary({ clientId: Number(clientId) });
  return { s, owed_total: s.total, owed_pending: s.pending, owed_upcoming: s.upcoming };
}

router.get('/', (req, res) => {
  const { search, sort } = req.query;
  let query = `
    SELECT c.*,
      (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) as total_projects,
      COALESCE((
        SELECT SUM(cp.amount) FROM client_payments cp JOIN projects p ON p.id = cp.project_id
        WHERE p.client_id = c.id AND cp.status = 'received'
      ), 0) as total_revenue
    FROM clients c
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ' AND (c.name LIKE ? OR c.company LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const orderMap = {
    'name': 'ORDER BY c.name COLLATE NOCASE ASC',
    'revenue': 'ORDER BY total_revenue DESC',
    'projects': 'ORDER BY total_projects DESC',
  };
  query += ' ' + (orderMap[sort] || 'ORDER BY c.created_at DESC, c.id DESC');

  // One owed pass for every client, grouped by client_id, instead of one
  // owedSummary call per client. Same arithmetic, same figures.
  const owed = owedByClient();
  let rows = db.prepare(query).all(...params).map(c => {
    const s = owed.get(c.id);
    return { ...c, owed_total: s ? s.total : 0, owed_pending: s ? s.pending : 0, owed_upcoming: s ? s.upcoming : 0 };
  });
  if (sort === 'outstanding') rows = rows.sort((a, b) => b.owed_total - a.owed_total);

  res.json(rows);
});

router.post('/', (req, res) => {
  const { company, phone, email, socials, notes } = req.body;
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare(
    'INSERT INTO clients (name, company, phone, email, socials, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, company || null, phone || null, email || null, socials || null, notes || null);
  res.json({ id: result.lastInsertRowid });
});

router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const projects = db.prepare(`
    SELECT p.*, pc.name as category_name, pc.group_name as category_group,
      (SELECT COALESCE(SUM(cp.amount),0) FROM client_payments cp WHERE cp.project_id=p.id AND cp.status='received') as total_received,
      (SELECT COALESCE(SUM(ca.days*ca.rate_per_day),0) FROM crew_assignments ca WHERE ca.project_id=p.id) as total_crew_cost,
      (SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE e.project_id=p.id AND e.status='confirmed') as total_expenses
    FROM projects p
    LEFT JOIN project_categories pc ON pc.id = p.category_id
    WHERE p.client_id = ?
    ORDER BY p.created_at DESC
  `).all(req.params.id);

  // Per project owed rows for this client, including invoices of this client
  // that belong to no project.
  const { s } = clientOwed(client.id);
  const owedRows = s.rows
    .filter(r => r.owed > 0)
    .map(r => ({
      project_id: r.project_id,
      invoice_id: r.invoice_id || null,
      project_title: r.project_title || (r.invoices[0] && r.invoices[0].invoice_number) || null,
      agreed_budget: r.agreed_budget,
      received: r.received,
      invoiced_unpaid: r.invoicedUnpaid,
      uninvoiced: r.uninvoiced,
      overdue: r.overdue,
      owed: r.owed,
      due: r.due,
      shoot_date: r.shoot_date,
    }))
    .sort((a, b) => b.owed - a.owed);

  const stats = projects.reduce((acc, p) => {
    acc.totalRevenue += p.total_received;
    acc.totalProfit += (p.total_received - p.total_crew_cost - p.total_expenses);
    return acc;
  }, { totalRevenue: 0, totalProfit: 0 });

  res.json({
    client,
    projects,
    owed: {
      total: s.total,
      pending: s.pending,
      upcoming: s.upcoming,
      invoicedUnpaid: s.invoicedUnpaid,
      overdue: s.overdue,
    },
    owedRows,
    stats: {
      totalRevenue: round2(stats.totalRevenue),
      totalProfit: round2(stats.totalProfit),
      totalProjects: projects.length,
    },
  });
});

router.put('/:id', (req, res) => {
  const { company, phone, email, socials, notes } = req.body;
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare(
    'UPDATE clients SET name=?, company=?, phone=?, email=?, socials=?, notes=? WHERE id=?'
  ).run(name, company || null, phone || null, email || null, socials || null, notes || null, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Client not found' });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const projectCount = db.prepare('SELECT COUNT(*) as n FROM projects WHERE client_id = ?').get(req.params.id).n;
  if (projectCount > 0) {
    return res.status(409).json({
      error: `This client has ${projectCount} project${projectCount > 1 ? 's' : ''}. Reassign or delete ${projectCount > 1 ? 'them' : 'it'} first.`,
    });
  }
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
