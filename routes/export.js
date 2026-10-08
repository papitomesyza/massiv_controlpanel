const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// One-call compact snapshot of the agency board, for cheap ingestion by Chief
// of Staff (Hermes). Everything a manager needs to reason about the agency in
// a single request instead of dozens. Read-only.

router.get('/', (req, res) => {
  // Allowlisted settings only (new settings stay private by default). Blobs
  // (logos, stamps: > 2KB or data: URIs) are dropped to keep the export small.
  const settings = {};
  const allowed = /^(agency_name|tagline|agency_tagline|tax_.*|invoice_billing_.*|invoice_language|profile_.*)$/;
  db.prepare('SELECT key, value FROM settings').all().forEach(r => {
    if (!allowed.test(r.key)) return;
    const v = r.value;
    if (typeof v === 'string' && (v.length > 2048 || /^\s*data:/i.test(v))) return;
    settings[r.key] = v;
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

  const out = {
    generated_at: new Date().toISOString(),
    counts: { clients: clients.length, projects: projects.length, crew: crew.length },
    settings,
    clients,
    projects,
    crew,
    finances,
  };

  // Optional heavier sections: ?include=payments,tasks,calendar,budgets,invoices
  // Slim columns only; each section is capped at ROW_CAP rows (newest first).
  const ROW_CAP = 500;
  const include = String(req.query.include || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (include.length) {
    const sections = {
      payments: () => db.prepare('SELECT id, project_id, amount, date, method, status, notes FROM client_payments ORDER BY id DESC LIMIT ?').all(ROW_CAP),
      tasks: () => ({
        project_tasks: db.prepare('SELECT id, project_id, phase_id, title, assigned_crew_id, due_date, status FROM tasks ORDER BY id DESC LIMIT ?').all(ROW_CAP),
        standalone_tasks: db.prepare('SELECT id, title, due_date, priority, done, completed_at FROM standalone_tasks ORDER BY id DESC LIMIT ?').all(ROW_CAP),
      }),
      calendar: () => db.prepare('SELECT id, project_id, title, event_type, start_date, end_date, start_time, end_time, location FROM calendar_events ORDER BY start_date DESC LIMIT ?').all(ROW_CAP),
      budgets: () => db.prepare('SELECT id, project_id, title, category, client_name, shoot_days, status, created_at FROM budgets ORDER BY id DESC LIMIT ?').all(ROW_CAP),
      invoices: () => db.prepare('SELECT id, invoice_number, project_id, client_id, client_name, issue_date, due_date, currency, total_after_discount, amount_due, status FROM invoices ORDER BY id DESC LIMIT ?').all(ROW_CAP),
    };
    out.row_cap = ROW_CAP;
    out.included = {};
    include.forEach(k => {
      if (sections[k]) {
        try { out.included[k] = sections[k](); } catch (e) { out.included[k] = { error: 'query failed' }; }
      }
    });
  }

  res.json(out);
});

module.exports = router;