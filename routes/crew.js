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

router.get('/', (req, res) => {
  const { search, sort, type } = req.query;
  let query = 'SELECT * FROM crew WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (name LIKE ? OR role LIKE ? OR service_type LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (type === 'individual') { query += ' AND (is_company = 0 OR is_company IS NULL)'; }
  else if (type === 'company') { query += ' AND is_company = 1'; }

  const orderMap = {
    'rate_high': 'ORDER BY day_rate DESC',
    'rate_low': 'ORDER BY day_rate ASC',
    'name': 'ORDER BY name ASC',
  };
  query += ' ' + (orderMap[sort] || 'ORDER BY name ASC');

  let crew = db.prepare(query).all(...params);

  if (sort === 'earned_high') {
    const earned = db.prepare(`
      SELECT crew_id, COALESCE(SUM(days * rate_per_day), 0) as total
      FROM crew_assignments GROUP BY crew_id
    `).all();
    const earnedMap = {};
    earned.forEach(e => { earnedMap[e.crew_id] = e.total; });
    crew = crew.sort((a, b) => (earnedMap[b.id] || 0) - (earnedMap[a.id] || 0));
  }

  res.json(crew);
});

router.post('/', (req, res) => {
  const { name, role, phone, email, location, day_rate, notes, is_company, service_type } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare(
    'INSERT INTO crew (name, role, phone, email, location, day_rate, notes, is_company, service_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, role || null, phone || null, email || null, location || null, day_rate || 0, notes || null, is_company ? 1 : 0, service_type || null);
  res.json({ id: result.lastInsertRowid });
});

router.get('/roles', (req, res) => {
  res.json(db.prepare('SELECT * FROM crew_roles ORDER BY name').all());
});

router.post('/roles', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare('INSERT OR IGNORE INTO crew_roles (name, is_default) VALUES (?, 0)').run(name);
  if (result.changes === 0) return res.status(400).json({ error: 'Role already exists' });
  res.json({ id: result.lastInsertRowid });
});

router.delete('/roles/:id', (req, res) => {
  const role = db.prepare('SELECT * FROM crew_roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Not found' });
  if (role.is_default) return res.status(400).json({ error: 'Cannot delete default role' });
  db.prepare('DELETE FROM crew_roles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Debt summary — must be before /:id
router.get('/debt-summary', (req, res) => {
  const rows = db.prepare(`
    SELECT crew_id, SUM(amount) as total_unpaid
    FROM crew_debts WHERE status = 'unpaid'
    GROUP BY crew_id
  `).all();
  const map = {};
  rows.forEach(r => { map[r.crew_id] = r.total_unpaid; });
  res.json(map);
});

// Payment summary PDF — must be before /:id
router.get('/payment-summary-pdf', (req, res) => {
  const PDFDocument = require('pdfkit');

  const assignments = db.prepare(`
    SELECT ca.*, cr.name as crew_name, cr.role as crew_role, cr.is_company,
           cr.service_type, p.title as project_title,
           (ca.days * ca.rate_per_day) as total_cost
    FROM crew_assignments ca
    JOIN crew cr ON cr.id = ca.crew_id
    JOIN projects p ON p.id = ca.project_id
    ORDER BY cr.name, p.created_at
  `).all();

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="MASSIV-Crew-Payment-Summary.pdf"');
  doc.pipe(res);

  const fmtVal = v => `€${Number(v || 0).toFixed(2)}`;
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text('MASSIV TV', { align: 'center' });
  doc.fontSize(11).font('Helvetica').fillColor('#666').text('Crew Payment Summary', { align: 'center' });
  doc.fontSize(9).text(today, { align: 'center' });
  doc.moveDown(0.8);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ccc');
  doc.moveDown(0.5);

  const byCrewId = {};
  assignments.forEach(a => {
    if (!byCrewId[a.crew_id]) byCrewId[a.crew_id] = { name: a.crew_name, rows: [], subtotal: 0 };
    byCrewId[a.crew_id].rows.push(a);
    byCrewId[a.crew_id].subtotal += (a.total_cost || 0);
  });

  let grandTotal = 0;

  Object.values(byCrewId).forEach(crew => {
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text(crew.name);
    doc.moveDown(0.2);
    crew.rows.forEach(a => {
      const role = a.role_on_project || a.crew_role || '—';
      const cost = fmtVal(a.total_cost);
      const payDate = a.payment_date || '—';
      const method = a.payment_method || '—';
      doc.fontSize(8).font('Helvetica').fillColor('#444')
        .text(`  ${a.project_title}  |  ${role}  |  ${a.days}d × ${fmtVal(a.rate_per_day)} = ${cost}  |  ${a.paid_status}  |  ${payDate}  |  ${method}`);
    });
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
      .text(`  Subtotal: ${fmtVal(crew.subtotal)}`, { align: 'right' });
    grandTotal += crew.subtotal;
    doc.moveDown(0.6);
  });

  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ccc');
  doc.moveDown(0.3);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#000')
    .text(`Grand Total: ${fmtVal(grandTotal)}`, { align: 'right' });
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#999').text('built by year28', { align: 'center' });

  doc.end();
});

router.get('/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM crew WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const assignments = db.prepare(`
    SELECT ca.*, p.title as project_title, p.shoot_date, p.status as project_status,
           (ca.days * ca.rate_per_day) as total_cost
    FROM crew_assignments ca
    JOIN projects p ON p.id = ca.project_id
    WHERE ca.crew_id = ?
    ORDER BY p.created_at DESC
  `).all(req.params.id);
  res.json({ member, assignments });
});

router.put('/:id', (req, res) => {
  const { name, role, phone, email, location, day_rate, notes, is_company, service_type } = req.body;
  db.prepare(
    'UPDATE crew SET name=?, role=?, phone=?, email=?, location=?, day_rate=?, notes=?, is_company=?, service_type=? WHERE id=?'
  ).run(name, role || null, phone || null, email || null, location || null, day_rate || 0, notes || null, is_company ? 1 : 0, service_type || null, req.params.id);
  res.json({ ok: true });
});

router.put('/:id/archive', (req, res) => {
  const member = db.prepare('SELECT * FROM crew WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE crew SET archived = ? WHERE id = ?').run(member.archived ? 0 : 1, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const assignCount = db.prepare('SELECT COUNT(*) as n FROM crew_assignments WHERE crew_id = ?').get(req.params.id).n;
  const taskCount = db.prepare('SELECT COUNT(*) as n FROM tasks WHERE assigned_crew_id = ?').get(req.params.id).n;
  const total = assignCount + taskCount;
  if (total > 0) {
    return res.status(400).json({
      error: `Cannot delete: this crew member has ${assignCount > 0 ? `${assignCount} project assignment${assignCount > 1 ? 's' : ''}` : ''}${assignCount > 0 && taskCount > 0 ? ' and ' : ''}${taskCount > 0 ? `${taskCount} task assignment${taskCount > 1 ? 's' : ''}` : ''}. Archive them instead.`,
    });
  }
  db.prepare('DELETE FROM crew WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- CREW DEBTS ---
router.get('/:id/debts', (req, res) => {
  const debts = db.prepare(
    'SELECT * FROM crew_debts WHERE crew_id = ? ORDER BY date_incurred DESC, created_at DESC'
  ).all(req.params.id);
  res.json(debts);
});

router.post('/:id/debts', (req, res) => {
  const { description, amount, date_incurred, notes, status } = req.body;
  if (!description || amount === undefined) return res.status(400).json({ error: 'Description and amount required' });
  const err = validateMoney(amount, 'amount');
  if (err) return res.status(400).json({ error: err });
  const result = db.prepare(
    'INSERT INTO crew_debts (crew_id, description, amount, date_incurred, notes, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.params.id, description, amount, date_incurred || new Date().toISOString().slice(0, 10), notes || null, status || 'unpaid');
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id/debts/:debtId', (req, res) => {
  const { description, amount, date_incurred, status, payment_date, notes } = req.body;
  if (amount !== undefined) {
    const err = validateMoney(amount, 'amount');
    if (err) return res.status(400).json({ error: err });
  }
  db.prepare(
    'UPDATE crew_debts SET description=?, amount=?, date_incurred=?, status=?, payment_date=?, notes=? WHERE id=? AND crew_id=?'
  ).run(description, amount, date_incurred, status || 'unpaid', payment_date || null, notes || null, req.params.debtId, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/debts/:debtId', (req, res) => {
  db.prepare('DELETE FROM crew_debts WHERE id = ? AND crew_id = ?').run(req.params.debtId, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
