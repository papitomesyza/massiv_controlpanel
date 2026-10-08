const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// One-call compact snapshot of the agency board, for cheap ingestion by Chief
// of Staff (Hermes). Everything a manager needs to reason about the agency in
// a single request instead of dozens. Read-only.

router.get('/', (req, res) => {
  // All settings except anything secret-shaped.
  const settings = {};
  const secretish = /password|secret|token|backup|key/i;
  db.prepare('SELECT key, value FROM settings').all().forEach(r => {
    if (!secretish.test(r.key)) settings[r.key] = r.value;
  });

  const clients = db.prepare('SELECT id, name, company, phone, email, socials, notes, created_at FROM clients ORDER BY name').all();

  const projects = db.prepare(`
    SELECT p.id, p.title, p.client_id, c.name AS client_name, p.category_id,
           p.status, p.client_budget, p.agreed_budget, p.shoot_date, p.shoot_days,
           p.shoot_location, p.deadline, p.created_at,
           (SELECT COALESCE(SUM(amount), 0) FROM client_payments cp
              WHERE cp.project_id = p.id AND cp.status = 'received') AS total_received,
           (SELECT COALESCE(SUM(amount), 0) FROM expenses e
              WHERE e.project_id = p.id) AS total_expenses,
           (SELECT COALESCE(SUM(rate_per_day * days), 0) FROM crew_assignments ca
              WHERE ca.project_id = p.id) AS crew_cost
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    ORDER BY p.id DESC
  `).all();

  const phases = db.prepare('SELECT project_id, phase_name, order_index, status FROM project_phases ORDER BY project_id, order_index').all();
  const byProject = {};
  phases.forEach(ph => { (byProject[ph.project_id] = byProject[ph.project_id] || []).push(ph); });
  projects.forEach(p => {
    p.phases = byProject[p.id] || [];
    const open = p.phases.find(x => x.status !== 'completed');
    p.current_phase = (open || p.phases[p.phases.length - 1] || {}).phase_name || null;
  });

  const crew = db.prepare('SELECT id, name, role, day_rate, is_company, service_type FROM crew WHERE archived = 0 ORDER BY name').all();

  const finances = {};
  try {
    finances.totals = db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM client_payments WHERE status = 'received') AS received_all_time,
        (SELECT COALESCE(SUM(amount), 0) FROM expenses) AS expenses_all_time,
        (SELECT COALESCE(SUM(amount), 0) FROM crew_assignments WHERE paid_status = 'unpaid') AS crew_unpaid
    `).get();
  } catch (_) {}

  res.json({
    generated_at: new Date().toISOString(),
    counts: { clients: clients.length, projects: projects.length, crew: crew.length },
    settings,
    clients,
    projects,
    crew,
    finances,
  });
});

module.exports = router;