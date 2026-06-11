const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

router.get('/', (req, res) => {
  const { search, sort } = req.query;
  let query = `
    SELECT c.*,
      COUNT(DISTINCT p.id) as total_projects,
      COALESCE(SUM(CASE WHEN cp.status='received' THEN cp.amount ELSE 0 END), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN cp.status='pending' THEN cp.amount ELSE 0 END), 0) as outstanding_balance
    FROM clients c
    LEFT JOIN projects p ON p.client_id = c.id
    LEFT JOIN client_payments cp ON cp.project_id = p.id
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ' AND (c.name LIKE ? OR c.company LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' GROUP BY c.id';

  const orderMap = {
    'name': 'ORDER BY c.name ASC',
    'revenue': 'ORDER BY total_revenue DESC',
    'projects': 'ORDER BY total_projects DESC',
    'outstanding': 'ORDER BY outstanding_balance DESC',
  };
  query += ' ' + (orderMap[sort] || 'ORDER BY c.created_at DESC');

  res.json(db.prepare(query).all(...params));
});

router.post('/', (req, res) => {
  const { name, company, phone, email, socials, notes } = req.body;
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
    SELECT p.*, pc.name as category_name,
      (SELECT COALESCE(SUM(cp.amount),0) FROM client_payments cp WHERE cp.project_id=p.id AND cp.status='received') as total_received,
      (SELECT COALESCE(SUM(ca.days*ca.rate_per_day),0) FROM crew_assignments ca WHERE ca.project_id=p.id) as total_crew_cost,
      (SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE e.project_id=p.id) as total_expenses
    FROM projects p
    LEFT JOIN project_categories pc ON pc.id = p.category_id
    WHERE p.client_id = ?
    ORDER BY p.created_at DESC
  `).all(req.params.id);

  const outstandingPayments = db.prepare(`
    SELECT cp.*, p.title as project_title
    FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    WHERE p.client_id = ? AND cp.status = 'pending'
    ORDER BY cp.date ASC
  `).all(req.params.id);

  const stats = projects.reduce((acc, p) => {
    acc.totalRevenue += p.total_received;
    acc.totalProfit += (p.total_received - p.total_crew_cost - p.total_expenses);
    return acc;
  }, { totalRevenue: 0, totalProfit: 0 });

  res.json({ client, projects, outstandingPayments, stats: { ...stats, totalProjects: projects.length } });
});

router.put('/:id', (req, res) => {
  const { name, company, phone, email, socials, notes } = req.body;
  db.prepare(
    'UPDATE clients SET name=?, company=?, phone=?, email=?, socials=?, notes=? WHERE id=?'
  ).run(name, company || null, phone || null, email || null, socials || null, notes || null, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
