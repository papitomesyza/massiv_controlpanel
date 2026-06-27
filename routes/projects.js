const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');

const PHASES = ['Development', 'Pre-Production', 'Production', 'Post-Production'];
const PRODUCTION_GROUPS = ['Video Production', 'Photography'];

function validateMoney(val, name) {
  const n = Number(val);
  if (!Number.isFinite(n)) return `${name} must be a number`;
  if (n < 0) return `${name} must be at least 0`;
  if (n > 1000000) return `${name} must be at most 1,000,000`;
  return null;
}

function validateDays(val, name) {
  const n = Number(val);
  if (!Number.isFinite(n)) return `${name} must be a number`;
  if (n < 0) return `${name} must be at least 0`;
  return null;
}

function getUploadsDir() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
}

function deleteFile(filename) {
  if (!filename) return;
  try { fs.unlink(path.join(getUploadsDir(), filename), () => {}); } catch (_) {}
}

function getProjectFull(id) {
  const project = db.prepare(`
    SELECT p.*, c.name as client_name, c.company as client_company,
           pc.name as category_name, pc.group_name as category_group
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN project_categories pc ON pc.id = p.category_id
    WHERE p.id = ?
  `).get(id);
  if (!project) return null;

  const phases = db.prepare('SELECT * FROM project_phases WHERE project_id = ? ORDER BY order_index').all(id);
  const tasks = db.prepare(`
    SELECT t.*, cr.name as crew_name
    FROM tasks t LEFT JOIN crew cr ON cr.id = t.assigned_crew_id
    WHERE t.project_id = ? ORDER BY t.is_locked DESC, t.sort_order ASC, t.created_at ASC
  `).all(id);

  const phasesWithTasks = phases.map(ph => ({ ...ph, tasks: tasks.filter(t => t.phase_id === ph.id) }));

  const revisionRounds = db.prepare('SELECT * FROM revision_rounds WHERE project_id = ? ORDER BY round_number').all(id);

  const crewAssignments = db.prepare(`
    SELECT ca.*, cr.name as crew_name, cr.role as crew_role,
           (ca.days * ca.rate_per_day) as total_cost
    FROM crew_assignments ca JOIN crew cr ON cr.id = ca.crew_id
    WHERE ca.project_id = ?
  `).all(id);

  const clientPayments = db.prepare('SELECT * FROM client_payments WHERE project_id = ? ORDER BY date').all(id);

  // Only confirmed expenses for PnL
  const expenses = db.prepare(`
    SELECT e.*, ec.name as category_name
    FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
    WHERE e.project_id = ? AND e.status = 'confirmed' ORDER BY e.date DESC, e.id DESC
  `).all(id);

  // Pending expenses for review queue
  const pendingExpenses = db.prepare(`
    SELECT e.*, ec.name as category_name
    FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
    WHERE e.project_id = ? AND e.status = 'pending' ORDER BY e.id DESC
  `).all(id);

  const statusHistory = db.prepare(
    'SELECT * FROM project_status_history WHERE project_id = ? ORDER BY changed_at DESC'
  ).all(id);

  let duplicatedFromTitle = null;
  if (project.duplicated_from) {
    const orig = db.prepare('SELECT title FROM projects WHERE id = ?').get(project.duplicated_from);
    if (orig) duplicatedFromTitle = orig.title;
  }

  const totalReceived = clientPayments.filter(p => p.status === 'received').reduce((s, p) => s + p.amount, 0);
  const totalCrewCost = crewAssignments.reduce((s, c) => s + (c.days * c.rate_per_day), 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  // Expected Profit = agreed_budget - crew - expenses
  const expectedProfit = project.agreed_budget - totalCrewCost - totalExpenses;
  // Realized Profit = received - crew - expenses
  const realizedProfit = totalReceived - totalCrewCost - totalExpenses;
  // Margin = realized / received (only when received > 0)
  const profitMargin = totalReceived > 0 ? (realizedProfit / totalReceived) * 100 : null;

  return {
    project, phases: phasesWithTasks, revisionRounds,
    crewAssignments, clientPayments, expenses, pendingExpenses, statusHistory, duplicatedFromTitle,
    pnl: {
      agreedBudget: project.agreed_budget,
      clientBudget: project.client_budget || 0,
      totalReceived, totalCrewCost,
      totalExpenses, expectedProfit, realizedProfit,
      profitMargin: profitMargin !== null ? Math.round(profitMargin * 10) / 10 : null,
    },
  };
}

function recordStatusChange(projectId, fromStatus, toStatus) {
  if (fromStatus !== toStatus) {
    db.prepare('INSERT INTO project_status_history (project_id, from_status, to_status) VALUES (?, ?, ?)')
      .run(projectId, fromStatus, toStatus);
  }
}

// List projects
router.get('/', (req, res) => {
  const { status, category_id, sort } = req.query;
  let query = `
    SELECT p.*, c.name as client_name, pc.name as category_name, pc.group_name,
      (SELECT ph.phase_name FROM project_phases ph WHERE ph.project_id=p.id AND ph.status='active' LIMIT 1) as current_phase,
      (SELECT COUNT(*) FROM project_phases ph WHERE ph.project_id=p.id AND ph.status='completed') as completed_phases,
      (SELECT COUNT(*) FROM project_phases ph WHERE ph.project_id=p.id) as total_phases,
      COALESCE(SUM(CASE WHEN cp.status='received' THEN cp.amount ELSE 0 END),0) as total_received,
      COALESCE((SELECT SUM(ca.days*ca.rate_per_day) FROM crew_assignments ca WHERE ca.project_id=p.id),0) as total_crew_cost,
      COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.project_id=p.id AND e.status='confirmed'),0) as total_expenses
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN project_categories pc ON pc.id = p.category_id
    LEFT JOIN client_payments cp ON cp.project_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (status) { query += ' AND p.status = ?'; params.push(status); }
  if (category_id) { query += ' AND p.category_id = ?'; params.push(category_id); }
  query += ' GROUP BY p.id';

  const orderMap = {
    'oldest': 'ORDER BY p.created_at ASC',
    'budget_high': 'ORDER BY p.agreed_budget DESC',
    'budget_low': 'ORDER BY p.agreed_budget ASC',
  };
  query += ' ' + (orderMap[sort] || 'ORDER BY p.created_at DESC');

  let projects = db.prepare(query).all(...params);

  if (sort === 'margin_high') {
    projects = projects.sort((a, b) => {
      const mA = a.agreed_budget > 0 ? (a.total_received - a.total_crew_cost - a.total_expenses) / a.agreed_budget : null;
      const mB = b.agreed_budget > 0 ? (b.total_received - b.total_crew_cost - b.total_expenses) / b.agreed_budget : null;
      if (mA === null && mB === null) return 0;
      if (mA === null) return 1;
      if (mB === null) return -1;
      return mB - mA;
    });
  }

  res.json(projects);
});

function syncTaskCalendarEvent(taskId) {
  db.prepare("DELETE FROM calendar_events WHERE event_type='task' AND task_id = ?").run(taskId);
  const task = db.prepare(
    'SELECT t.due_date, t.status, t.title, t.project_id, p.title AS project_title FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?'
  ).get(taskId);
  if (!task || !task.due_date || task.status === 'done') return;
  const title = task.project_title ? `${task.project_title} — ${task.title}` : task.title;
  db.prepare(
    "INSERT INTO calendar_events (project_id, task_id, title, event_type, start_date, color) VALUES (?, ?, ?, 'task', ?, '#22D3EE')"
  ).run(task.project_id, taskId, title, task.due_date);
}

function syncProjectCalendarEvents(projectId, title, deadline, shootDate, shootLocation, shootStartTime, shootEndTime) {
  db.prepare("DELETE FROM calendar_events WHERE project_id = ? AND event_type IN ('shoot', 'deadline')").run(projectId);

  const catRow = db.prepare(
    'SELECT pc.group_name FROM projects p LEFT JOIN project_categories pc ON pc.id = p.category_id WHERE p.id = ?'
  ).get(projectId);
  const groupName = catRow?.group_name || null;

  if (deadline) {
    db.prepare(
      "INSERT INTO calendar_events (project_id, title, event_type, start_date, color) VALUES (?, ?, 'deadline', ?, '#FF902F')"
    ).run(projectId, title, deadline);
  }

  if (shootDate && PRODUCTION_GROUPS.includes(groupName)) {
    db.prepare(
      "INSERT INTO calendar_events (project_id, title, event_type, start_date, location, start_time, end_time, color) VALUES (?, ?, 'shoot', ?, ?, ?, ?, '#723CEB')"
    ).run(projectId, title, shootDate, shootLocation || null, shootStartTime || null, shootEndTime || null);
  }
}

// Create project
router.post('/', (req, res) => {
  const { client_id, title, category_id, client_budget, agreed_budget, notes, shoot_date, shoot_days, shoot_location, location_name, location_lat, location_lng, shoot_start_time, shoot_end_time, deadline, phases: requestedPhases } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const errCB = validateMoney(client_budget || 0, 'client_budget');
  if (errCB) return res.status(400).json({ error: errCB });
  const errAB = validateMoney(agreed_budget || 0, 'agreed_budget');
  if (errAB) return res.status(400).json({ error: errAB });

  const phasesToCreate = Array.isArray(requestedPhases) && requestedPhases.length > 0
    ? PHASES.filter(p => requestedPhases.includes(p))
    : PHASES;
  if (phasesToCreate.length === 0) return res.status(400).json({ error: 'At least one phase required' });

  const initialStatus = phasesToCreate[0].toLowerCase().replace(/ /g, '-');

  try {
    const effectiveLocation = location_name || shoot_location || null;
    const result = db.prepare(
      'INSERT INTO projects (client_id, title, category_id, client_budget, agreed_budget, notes, shoot_date, shoot_days, shoot_location, location_name, location_lat, location_lng, shoot_start_time, shoot_end_time, deadline, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(client_id || null, title, category_id || null, client_budget || 0, agreed_budget || 0, notes || null, shoot_date || null, shoot_days || 1, effectiveLocation, location_name || null, location_lat || null, location_lng || null, shoot_start_time || null, shoot_end_time || null, deadline || null, initialStatus);

    const projectId = result.lastInsertRowid;
    const insertPhase = db.prepare('INSERT INTO project_phases (project_id, phase_name, order_index, status) VALUES (?, ?, ?, ?)');
    phasesToCreate.forEach((name, i) => insertPhase.run(projectId, name, i, i === 0 ? 'active' : 'pending'));

    syncProjectCalendarEvents(projectId, title, deadline || null, shoot_date, effectiveLocation, shoot_start_time, shoot_end_time);

    const phases = db.prepare('SELECT * FROM project_phases WHERE project_id = ? ORDER BY order_index').all(projectId);
    res.json({ id: projectId, phases });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Custom task suggestions — must come before /:id
router.get('/custom-task-suggestions', (req, res) => {
  const { category } = req.query;
  if (!category) return res.json([]);
  const rows = db.prepare(
    'SELECT phase_name, task_title FROM custom_task_suggestions WHERE category_name = ? ORDER BY phase_name, created_at DESC'
  ).all(category);
  res.json(rows);
});

router.post('/custom-task-suggestions', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.json({ ok: true });
  const insert = db.prepare(
    'INSERT OR IGNORE INTO custom_task_suggestions (category_name, phase_name, task_title) VALUES (?, ?, ?)'
  );
  const insertMany = db.transaction(list => list.forEach(item => {
    if (item.category_name && item.phase_name && item.task_title) {
      insert.run(item.category_name, item.phase_name, item.task_title);
    }
  }));
  insertMany(items);
  res.json({ ok: true });
});

// Get project full detail
router.get('/:id', (req, res) => {
  const data = getProjectFull(parseInt(req.params.id));
  if (!data) return res.status(404).json({ error: 'Project not found' });
  res.json(data);
});

// Update project
router.put('/:id', (req, res) => {
  const { client_id, title, category_id, status, client_budget, agreed_budget, notes, shoot_date, shoot_days, shoot_location, location_name, location_lat, location_lng, shoot_start_time, shoot_end_time, deadline } = req.body;

  const errCB = validateMoney(client_budget || 0, 'client_budget');
  if (errCB) return res.status(400).json({ error: errCB });
  const errAB = validateMoney(agreed_budget || 0, 'agreed_budget');
  if (errAB) return res.status(400).json({ error: errAB });

  const prev = db.prepare('SELECT status FROM projects WHERE id = ?').get(req.params.id);
  const effectiveLocation = location_name || shoot_location || null;
  db.prepare(`
    UPDATE projects SET client_id=?, title=?, category_id=?, status=?, client_budget=?,
      agreed_budget=?, notes=?, shoot_date=?, shoot_days=?, shoot_location=?,
      location_name=?, location_lat=?, location_lng=?, shoot_start_time=?, shoot_end_time=?, deadline=? WHERE id=?
  `).run(client_id || null, title, category_id || null, status, client_budget || 0, agreed_budget || 0,
    notes || null, shoot_date || null, shoot_days || 1, effectiveLocation,
    location_name || null, location_lat || null, location_lng || null,
    shoot_start_time || null, shoot_end_time || null, deadline || null, req.params.id);
  if (prev) recordStatusChange(req.params.id, prev.status, status);
  syncProjectCalendarEvents(req.params.id, title, deadline || null, shoot_date || null, effectiveLocation, shoot_start_time || null, shoot_end_time || null);
  res.json({ ok: true });
});

// Complete a phase
router.put('/:id/phases/:phaseId/complete', (req, res) => {
  const { id, phaseId } = req.params;
  const phase = db.prepare('SELECT * FROM project_phases WHERE id = ? AND project_id = ?').get(phaseId, id);
  if (!phase) return res.status(404).json({ error: 'Phase not found' });

  db.prepare("UPDATE project_phases SET status='completed', completed_at=datetime('now') WHERE id=?").run(phaseId);

  const nextPhase = db.prepare(
    'SELECT * FROM project_phases WHERE project_id = ? AND order_index = ?'
  ).get(id, phase.order_index + 1);

  const prev = db.prepare('SELECT status FROM projects WHERE id = ?').get(id);

  if (nextPhase) {
    db.prepare("UPDATE project_phases SET status='active' WHERE id=?").run(nextPhase.id);
    const newStatus = nextPhase.phase_name.toLowerCase().replace(/ /g, '-');
    db.prepare('UPDATE projects SET status=? WHERE id=?').run(newStatus, id);
    if (prev) recordStatusChange(id, prev.status, newStatus);
  } else {
    db.prepare("UPDATE projects SET status='completed' WHERE id=?").run(id);
    if (prev) recordStatusChange(id, prev.status, 'completed');
  }
  res.json({ ok: true });
});

// Reactivate a phase — keeps state consistent
router.put('/:id/phases/:phaseId/reactivate', (req, res) => {
  const { id, phaseId } = req.params;
  const phase = db.prepare('SELECT * FROM project_phases WHERE id = ? AND project_id = ?').get(phaseId, id);
  if (!phase) return res.status(404).json({ error: 'Phase not found' });

  const prev = db.prepare('SELECT status FROM projects WHERE id = ?').get(id);

  // Set all currently-active phases back to pending, then activate the target
  db.prepare("UPDATE project_phases SET status='pending' WHERE project_id=? AND status='active'").run(id);
  db.prepare("UPDATE project_phases SET status='active', completed_at=NULL WHERE id=?").run(phaseId);

  // Update project status to match reactivated phase
  const newStatus = phase.phase_name.toLowerCase().replace(/ /g, '-');
  db.prepare('UPDATE projects SET status=? WHERE id=?').run(newStatus, id);
  if (prev) recordStatusChange(id, prev.status, newStatus);

  res.json({ ok: true });
});

// Duplicate project — copies location fields
router.post('/:id/duplicate', (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });

  const original = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Project not found' });

  const existing = db.prepare('SELECT id FROM projects WHERE title = ?').get(title.trim());
  if (existing) return res.status(400).json({ error: 'A project with this title already exists' });

  const originalPhases = db.prepare('SELECT * FROM project_phases WHERE project_id = ? ORDER BY order_index').all(req.params.id);
  const initialStatus = originalPhases.length > 0
    ? originalPhases[0].phase_name.toLowerCase().replace(/ /g, '-')
    : 'development';

  const result = db.prepare(
    'INSERT INTO projects (client_id, title, category_id, client_budget, agreed_budget, notes, shoot_date, shoot_days, shoot_location, location_name, location_lat, location_lng, shoot_start_time, shoot_end_time, deadline, status, duplicated_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    original.client_id, title.trim(), original.category_id, original.client_budget,
    original.agreed_budget, original.notes, original.shoot_date, original.shoot_days,
    original.shoot_location, original.location_name, original.location_lat, original.location_lng,
    original.shoot_start_time || null, original.shoot_end_time || null, original.deadline || null,
    initialStatus, original.id
  );

  const newProjectId = result.lastInsertRowid;

  const insertPhase = db.prepare('INSERT INTO project_phases (project_id, phase_name, order_index, status) VALUES (?, ?, ?, ?)');
  const newPhaseIds = {};
  originalPhases.forEach((origPhase, i) => {
    const r = insertPhase.run(newProjectId, origPhase.phase_name, i, i === 0 ? 'active' : 'pending');
    newPhaseIds[origPhase.phase_name] = r.lastInsertRowid;
  });

  const insertTask = db.prepare('INSERT INTO tasks (phase_id, project_id, title, assigned_crew_id, due_date, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
  originalPhases.forEach(origPhase => {
    const newPhaseId = newPhaseIds[origPhase.phase_name];
    if (!newPhaseId) return;
    const tasks = db.prepare('SELECT * FROM tasks WHERE phase_id = ? AND is_locked = 0').all(origPhase.id);
    tasks.forEach(t => {
      const r = insertTask.run(newPhaseId, newProjectId, t.title, t.assigned_crew_id, t.due_date, t.notes, 'todo');
      syncTaskCalendarEvent(r.lastInsertRowid);
    });
  });

  res.json({ id: newProjectId });
});

// Delete project — also deletes linked shoot, deadline, and task calendar events
router.delete('/:id', (req, res) => {
  db.prepare("DELETE FROM calendar_events WHERE project_id = ? AND event_type IN ('shoot', 'deadline', 'task')").run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- TASKS ---
router.post('/:id/tasks', (req, res) => {
  const { phase_id, title, assigned_crew_id, due_date, notes } = req.body;
  if (!title || !phase_id) return res.status(400).json({ error: 'Title and phase_id required' });
  const maxRow = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM tasks WHERE phase_id = ?').get(phase_id);
  const result = db.prepare(
    'INSERT INTO tasks (phase_id, project_id, title, assigned_crew_id, due_date, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(phase_id, req.params.id, title, assigned_crew_id || null, due_date || null, notes || null, maxRow.m + 1);
  syncTaskCalendarEvent(result.lastInsertRowid);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id/tasks/:taskId', (req, res) => {
  const { title, assigned_crew_id, due_date, notes, status } = req.body;
  db.prepare('UPDATE tasks SET title=?, assigned_crew_id=?, due_date=?, notes=?, status=? WHERE id=? AND project_id=?')
    .run(title, assigned_crew_id || null, due_date || null, notes || null, status, req.params.taskId, req.params.id);
  syncTaskCalendarEvent(parseInt(req.params.taskId));
  res.json({ ok: true });
});

router.delete('/:id/tasks/:taskId', (req, res) => {
  const task = db.prepare('SELECT is_locked FROM tasks WHERE id = ? AND project_id = ?').get(req.params.taskId, req.params.id);
  if (task && task.is_locked) return res.status(400).json({ error: 'Cannot delete a locked task' });
  db.prepare("DELETE FROM calendar_events WHERE event_type='task' AND task_id = ?").run(req.params.taskId);
  db.prepare('DELETE FROM tasks WHERE id = ? AND project_id = ?').run(req.params.taskId, req.params.id);
  res.json({ ok: true });
});

// Batch task insert — continues sort_order from each phase's current max
router.post('/:id/tasks/batch', (req, res) => {
  const { tasks } = req.body;
  if (!Array.isArray(tasks) || tasks.length === 0) return res.json({ ok: true });

  // Determine current max sort_order per phase
  const phaseMaxes = {};
  tasks.forEach(t => {
    if (!(t.phase_id in phaseMaxes)) {
      const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM tasks WHERE phase_id = ?').get(t.phase_id);
      phaseMaxes[t.phase_id] = row.m;
    }
  });

  const phaseCounters = {};
  const insert = db.prepare('INSERT INTO tasks (phase_id, project_id, title, assigned_crew_id, sort_order) VALUES (?, ?, ?, ?, ?)');
  const insertMany = db.transaction(list => list.forEach(t => {
    if (!(t.phase_id in phaseCounters)) phaseCounters[t.phase_id] = phaseMaxes[t.phase_id];
    phaseCounters[t.phase_id]++;
    insert.run(t.phase_id, req.params.id, t.title, t.assigned_crew_id || null, phaseCounters[t.phase_id]);
  }));
  insertMany(tasks);
  res.json({ ok: true });
});

// --- REVISION ROUNDS ---
router.post('/:id/revisions', (req, res) => {
  const { date, notes } = req.body;
  if (!date) return res.status(400).json({ error: 'Date required' });
  const last = db.prepare('SELECT MAX(round_number) as max FROM revision_rounds WHERE project_id = ?').get(req.params.id);
  const round = (last.max || 0) + 1;
  const result = db.prepare('INSERT INTO revision_rounds (project_id, round_number, date, notes) VALUES (?, ?, ?, ?)')
    .run(req.params.id, round, date, notes || null);
  res.json({ id: result.lastInsertRowid, round_number: round });
});

router.delete('/:id/revisions/:revId', (req, res) => {
  db.prepare('DELETE FROM revision_rounds WHERE id = ? AND project_id = ?').run(req.params.revId, req.params.id);
  res.json({ ok: true });
});

// --- CLIENT PAYMENTS ---
router.post('/:id/payments', (req, res) => {
  const { amount, date, method, notes, status } = req.body;
  if (!amount || !date) return res.status(400).json({ error: 'Amount and date required' });
  const err = validateMoney(amount, 'amount');
  if (err) return res.status(400).json({ error: err });
  const result = db.prepare('INSERT INTO client_payments (project_id, amount, date, method, notes, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.id, amount, date, method || 'bank_transfer', notes || null, status || 'pending');
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id/payments/:payId', (req, res) => {
  const { amount, date, method, notes, status } = req.body;
  const err = validateMoney(amount, 'amount');
  if (err) return res.status(400).json({ error: err });
  db.prepare('UPDATE client_payments SET amount=?, date=?, method=?, notes=?, status=? WHERE id=? AND project_id=?')
    .run(amount, date, method, notes || null, status, req.params.payId, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/payments/:payId', (req, res) => {
  db.prepare('DELETE FROM client_payments WHERE id = ? AND project_id = ?').run(req.params.payId, req.params.id);
  res.json({ ok: true });
});

// --- CREW ASSIGNMENTS ---
router.post('/:id/crew', (req, res) => {
  const { crew_id, role_on_project, days, rate_per_day, paid_status, payment_date, payment_amount, payment_method, payment_notes } = req.body;
  if (!crew_id) return res.status(400).json({ error: 'crew_id required' });

  const errD = validateDays(days || 0, 'days');
  if (errD) return res.status(400).json({ error: errD });
  const errR = validateMoney(rate_per_day || 0, 'rate_per_day');
  if (errR) return res.status(400).json({ error: errR });
  const errP = validateMoney(payment_amount || 0, 'payment_amount');
  if (errP) return res.status(400).json({ error: errP });

  const result = db.prepare(
    'INSERT INTO crew_assignments (project_id, crew_id, role_on_project, days, rate_per_day, paid_status, payment_date, payment_amount, payment_method, payment_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.params.id, crew_id, role_on_project || null, days || 1, rate_per_day || 0, paid_status || 'unpaid', payment_date || null, payment_amount || 0, payment_method || null, payment_notes || null);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id/crew/:assignId', (req, res) => {
  const { role_on_project, days, rate_per_day, paid_status, payment_date, payment_amount, payment_method, payment_notes } = req.body;

  const errD = validateDays(days || 0, 'days');
  if (errD) return res.status(400).json({ error: errD });
  const errR = validateMoney(rate_per_day || 0, 'rate_per_day');
  if (errR) return res.status(400).json({ error: errR });
  const errP = validateMoney(payment_amount || 0, 'payment_amount');
  if (errP) return res.status(400).json({ error: errP });

  db.prepare(`
    UPDATE crew_assignments SET role_on_project=?, days=?, rate_per_day=?,
      paid_status=?, payment_date=?, payment_amount=?, payment_method=?, payment_notes=?
    WHERE id=? AND project_id=?
  `).run(role_on_project || null, days || 1, rate_per_day || 0,
    paid_status || 'unpaid', payment_date || null, payment_amount || 0,
    payment_method || null, payment_notes || null,
    req.params.assignId, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/crew/:assignId', (req, res) => {
  db.prepare('DELETE FROM crew_assignments WHERE id = ? AND project_id = ?').run(req.params.assignId, req.params.id);
  res.json({ ok: true });
});

// --- EXPENSES (admin-created: status = confirmed) ---
router.post('/:id/expenses', (req, res) => {
  const { category_id, amount, date, notes } = req.body;
  if (!amount || !date) return res.status(400).json({ error: 'Amount and date required' });
  const err = validateMoney(amount, 'amount');
  if (err) return res.status(400).json({ error: err });
  const imagePath = req.file ? req.file.filename : null;
  const result = db.prepare(
    "INSERT INTO expenses (project_id, category_id, amount, date, notes, invoice_image_path, source, status) VALUES (?, ?, ?, ?, ?, ?, 'admin', 'confirmed')"
  ).run(req.params.id, category_id || null, amount, date, notes || null, imagePath);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id/expenses/:expId', (req, res) => {
  const { category_id, amount, date, notes } = req.body;
  if (amount !== undefined) {
    const err = validateMoney(amount, 'amount');
    if (err) return res.status(400).json({ error: err });
  }
  const existing = db.prepare('SELECT invoice_image_path FROM expenses WHERE id = ? AND project_id = ?').get(req.params.expId, req.params.id);
  let imagePath = existing ? existing.invoice_image_path : null;
  if (req.file) {
    if (imagePath) deleteFile(imagePath);
    imagePath = req.file.filename;
  }
  db.prepare('UPDATE expenses SET category_id=?, amount=?, date=?, notes=?, invoice_image_path=? WHERE id=? AND project_id=?')
    .run(category_id || null, amount, date, notes || null, imagePath, req.params.expId, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/expenses/:expId', (req, res) => {
  const expense = db.prepare('SELECT invoice_image_path FROM expenses WHERE id = ? AND project_id = ?').get(req.params.expId, req.params.id);
  if (expense) deleteFile(expense.invoice_image_path);
  db.prepare('DELETE FROM expenses WHERE id = ? AND project_id = ?').run(req.params.expId, req.params.id);
  res.json({ ok: true });
});

// Approve a pending expense
router.post('/:id/expenses/:expId/approve', (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND project_id = ? AND status = ?').get(req.params.expId, req.params.id, 'pending');
  if (!expense) return res.status(404).json({ error: 'Pending expense not found' });

  let categoryId = expense.category_id;
  if (!categoryId && expense.category_text) {
    let catRow = db.prepare('SELECT id FROM expense_categories WHERE name = ?').get(expense.category_text);
    if (!catRow) {
      const r = db.prepare('INSERT INTO expense_categories (name, is_default) VALUES (?, 0)').run(expense.category_text);
      catRow = { id: r.lastInsertRowid };
    }
    categoryId = catRow.id;
  }

  db.prepare("UPDATE expenses SET status='confirmed', category_id=? WHERE id=?").run(categoryId, expense.id);
  res.json({ ok: true });
});

// Reject a pending expense — deletes it and its file
router.post('/:id/expenses/:expId/reject', (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND project_id = ? AND status = ?').get(req.params.expId, req.params.id, 'pending');
  if (!expense) return res.status(404).json({ error: 'Pending expense not found' });
  deleteFile(expense.invoice_image_path);
  db.prepare('DELETE FROM expenses WHERE id = ?').run(expense.id);
  res.json({ ok: true });
});

// --- PROJECT LOGS ---
router.get('/:id/logs', (req, res) => {
  const logs = db.prepare('SELECT * FROM project_logs WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(logs);
});

router.post('/:id/logs', (req, res) => {
  const { note } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ error: 'Note required' });
  const result = db.prepare('INSERT INTO project_logs (project_id, note) VALUES (?, ?)').run(req.params.id, note.trim());
  res.json({ id: result.lastInsertRowid });
});

router.delete('/:id/logs/:logId', (req, res) => {
  db.prepare('DELETE FROM project_logs WHERE id = ? AND project_id = ?').run(req.params.logId, req.params.id);
  res.json({ ok: true });
});

// --- EXPENSE LINKS ---
router.use('/:id/expense-link', require('./expense-links'));

// --- PDF EXPORT ---
router.get('/:id/pdf', (req, res) => {
  const PDFDocument = require('pdfkit');
  const data = getProjectFull(parseInt(req.params.id));
  if (!data) return res.status(404).json({ error: 'Project not found' });

  const { project, phases, revisionRounds, crewAssignments, clientPayments, expenses, pnl } = data;
  const fmt = v => `€${Number(v || 0).toFixed(2)}`;

  const agencyNameRow = db.prepare("SELECT value FROM settings WHERE key = 'agency_name'").get();
  const agencyName = (agencyNameRow && agencyNameRow.value) ? agencyNameRow.value : 'MASSIV TV';

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${agencyName.replace(/[^a-z0-9]/gi, '-')}-${project.title.replace(/[^a-z0-9]/gi, '-')}.pdf"`);
  doc.pipe(res);

  doc.fontSize(20).font('Helvetica-Bold').text(agencyName, { align: 'center' });
  doc.fontSize(9).font('Helvetica').fillColor('#666').text('Project Report', { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ccc');
  doc.moveDown(0.5);

  doc.fillColor('#000').fontSize(16).font('Helvetica-Bold').text(project.title);
  doc.fontSize(10).font('Helvetica').fillColor('#333');
  if (project.client_name) doc.text(`Client: ${project.client_name}${project.client_company ? ` (${project.client_company})` : ''}`);
  if (project.category_name) doc.text(`Category: ${project.category_name}`);
  doc.text(`Status: ${project.status.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`);
  if (project.shoot_date) doc.text(`Shoot Date: ${project.shoot_date}${project.shoot_days > 1 ? ` (${project.shoot_days} days)` : ''}`);
  if (project.shoot_location) doc.text(`Location: ${project.shoot_location}`);
  if (project.notes) doc.moveDown(0.3).fontSize(9).fillColor('#555').text(project.notes);
  doc.moveDown();

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('Financial Summary');
  doc.moveDown(0.3);
  const pnlRows = [
    ['Agreed Budget', fmt(pnl.agreedBudget)],
    ['Total Received', fmt(pnl.totalReceived)],
    ['Total Crew Cost', fmt(pnl.totalCrewCost)],
    ['Total Expenses', fmt(pnl.totalExpenses)],
    ['Expected Profit', fmt(pnl.expectedProfit)],
    ['Realized Profit', fmt(pnl.realizedProfit)],
    ['Profit Margin', pnl.profitMargin !== null ? `${pnl.profitMargin}%` : '—'],
  ];
  pnlRows.forEach(([label, val]) => {
    doc.fontSize(10).font('Helvetica').fillColor('#333').text(label, { continued: true, width: 250 });
    doc.fillColor('#000').text(val, { align: 'right' });
  });
  doc.moveDown();

  if (clientPayments.length > 0) {
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('Client Payments');
    doc.moveDown(0.3).fontSize(9).font('Helvetica').fillColor('#333');
    clientPayments.forEach(p => doc.text(`${p.date}  ${fmt(p.amount)}  ${p.status}  ${p.method || ''}${p.notes ? `  — ${p.notes}` : ''}`));
    doc.moveDown();
  }

  if (crewAssignments.length > 0) {
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('Crew');
    doc.moveDown(0.3).fontSize(9).font('Helvetica').fillColor('#333');
    crewAssignments.forEach(c => {
      const cost = c.days * c.rate_per_day;
      doc.text(`${c.crew_name}  |  ${c.role_on_project || c.crew_role || ''}  |  ${c.days}d × ${fmt(c.rate_per_day)} = ${fmt(cost)}  |  ${c.paid_status}`);
    });
    doc.moveDown();
  }

  if (expenses.length > 0) {
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('Expenses');
    doc.moveDown(0.3).fontSize(9).font('Helvetica').fillColor('#333');
    expenses.forEach(e => doc.text(`${e.date}  ${e.category_name || 'Uncategorized'}  ${fmt(e.amount)}${e.notes ? `  — ${e.notes}` : ''}`));
    doc.moveDown();
  }

  if (phases.length > 0) {
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('Project Phases');
    doc.moveDown(0.3);
    phases.forEach(ph => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text(`${ph.phase_name}  [${ph.status}]`);
      if (ph.tasks && ph.tasks.length > 0) {
        ph.tasks.forEach(t => {
          doc.fontSize(9).font('Helvetica').fillColor('#444')
            .text(`  • ${t.title}  [${t.status}]${t.crew_name ? ` — ${t.crew_name}` : ''}${t.due_date ? ` — due ${t.due_date}` : ''}`);
        });
      }
    });
    doc.moveDown();
  }

  if (revisionRounds.length > 0) {
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('Revision Rounds');
    doc.moveDown(0.3).fontSize(9).font('Helvetica').fillColor('#333');
    revisionRounds.forEach(r => doc.text(`Round ${r.round_number}  |  ${r.date}${r.notes ? `  — ${r.notes}` : ''}`));
    doc.moveDown();
  }

  doc.fontSize(8).fillColor('#999').text(`Generated by ${agencyName}  |  built by year28`, { align: 'center' });
  doc.end();
});

module.exports = router;
