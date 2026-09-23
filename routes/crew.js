const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { crewAssignmentFigures, crewOwedSummary, crewOwedByMember, validateMoney, round2 } = require('../lib/financeFigures');
const { pristinaToday } = require('../lib/pristinaDate');

const cleanName = v => (typeof v === 'string' ? v.trim() : '');

// Unpaid crew ledger totals per crew member. The ledger is money owed outside
// project assignments and stays out of the P&L and the Dashboard.
function ledgerUnpaidMap() {
  const map = {};
  db.prepare(`
    SELECT crew_id, SUM(amount) as total_unpaid
    FROM crew_debts WHERE status = 'unpaid'
    GROUP BY crew_id
  `).all().forEach(r => { map[r.crew_id] = round2(r.total_unpaid); });
  return map;
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
    'name': 'ORDER BY name COLLATE NOCASE ASC',
  };
  query += ' ' + (orderMap[sort] || 'ORDER BY name COLLATE NOCASE ASC');

  // Owed to each member: unpaid project assignments plus the unpaid ledger,
  // from the same shared helper CrewDetail reads.
  const owed = crewOwedByMember();
  const none = { owed_assignments: 0, owed_ledger: 0, owed_total: 0 };
  let crew = db.prepare(query).all(...params).map(c => ({ ...c, ...(owed[c.id] || none) }));

  if (sort === 'owed') crew = crew.sort((a, b) => b.owed_total - a.owed_total);

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
  const { role, phone, email, location, day_rate, notes, is_company, service_type } = req.body;
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const rateErr = validateMoney(day_rate || 0, 'day_rate');
  if (rateErr) return res.status(400).json({ error: rateErr });
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

// Ledger summary, must be before /:id
router.get('/debt-summary', (req, res) => {
  res.json(ledgerUnpaidMap());
});

// Payment summary PDF, must be before /:id
router.get('/payment-summary-pdf', (req, res) => {
  const PDFDocument = require('pdfkit');

  const assignments = crewAssignmentFigures();

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="MASSIV-Crew-Payment-Summary.pdf"');
  doc.pipe(res);

  const fmtVal = v => `€${Number(v || 0).toFixed(2)}`;
  // The document date is today in Pristina, formatted from the calendar date
  // itself so no clock zone can move it.
  const [ty, tm, td] = pristinaToday().split('-').map(Number);
  const today = new Date(Date.UTC(ty, tm - 1, td))
    .toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });

  doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text('MASSIV TV', { align: 'center' });
  doc.fontSize(11).font('Helvetica').fillColor('#666').text('Crew Payment Summary', { align: 'center' });
  doc.fontSize(9).text(today, { align: 'center' });
  doc.moveDown(0.8);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ccc');
  doc.moveDown(0.5);

  const byCrewId = {};
  assignments.forEach(a => {
    if (!byCrewId[a.crew_id]) byCrewId[a.crew_id] = { name: a.crew_name, rows: [], agreed: 0, paid: 0, remaining: 0 };
    const c = byCrewId[a.crew_id];
    c.rows.push(a);
    c.agreed += a.agreed; c.paid += a.paid; c.remaining += a.remaining;
  });

  const grand = { agreed: 0, paid: 0, remaining: 0 };
  const totalsLine = t => `Agreed ${fmtVal(t.agreed)}   Paid ${fmtVal(t.paid)}   Remaining ${fmtVal(t.remaining)}`;

  Object.values(byCrewId).forEach(crew => {
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text(crew.name);
    doc.moveDown(0.2);
    crew.rows.forEach(a => {
      // Empty values stay empty: a part with nothing to say is left out.
      const parts = [
        a.project_title,
        a.role_on_project || a.crew_role || '',
        `${a.days}d x ${fmtVal(a.rate_per_day)}`,
        `agreed ${fmtVal(a.agreed)}`,
        a.unrecorded ? 'paid, no amount recorded' : `paid ${fmtVal(a.paid)}`,
        `remaining ${fmtVal(a.remaining)}`,
        a.unrecorded ? '' : (a.paid_status || ''),
        a.payment_date || '',
        a.payment_method || '',
      ].filter(Boolean);
      doc.fontSize(8).font('Helvetica').fillColor('#444').text(`  ${parts.join('  |  ')}`);
    });
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
      .text(`  ${totalsLine(crew)}`, { align: 'right' });
    grand.agreed += crew.agreed; grand.paid += crew.paid; grand.remaining += crew.remaining;
    doc.moveDown(0.6);
  });

  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ccc');
  doc.moveDown(0.3);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
    .text(`Total   ${totalsLine(grand)}`, { align: 'right' });
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#999').text('built by year28', { align: 'center' });

  doc.end();
});

router.get('/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM crew WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  // Agreed, paid and remaining per assignment from the shared crew owed helper.
  const summary = crewOwedSummary({}, { crewId: member.id });
  const assignments = [...summary.rows].reverse();
  // owed is the same record the Crew card reads, so the two always agree.
  const owed = crewOwedByMember()[member.id] || { owed_assignments: 0, owed_ledger: 0, owed_total: 0 };
  res.json({
    member,
    assignments,
    totals: { agreed: summary.agreed, paid: summary.paid, remaining: summary.remaining, settled: summary.settled },
    owed,
  });
});

router.put('/:id', (req, res) => {
  const { role, phone, email, location, day_rate, notes, is_company, service_type } = req.body;
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const rateErr = validateMoney(day_rate || 0, 'day_rate');
  if (rateErr) return res.status(400).json({ error: rateErr });
  const result = db.prepare(
    'UPDATE crew SET name=?, role=?, phone=?, email=?, location=?, day_rate=?, notes=?, is_company=?, service_type=? WHERE id=?'
  ).run(name, role || null, phone || null, email || null, location || null, day_rate || 0, notes || null, is_company ? 1 : 0, service_type || null, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
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
  // Unpaid ledger entries would be removed with the member, so they block too.
  const ledgerCount = db.prepare("SELECT COUNT(*) as n FROM crew_debts WHERE crew_id = ? AND status = 'unpaid'").get(req.params.id).n;
  const reasons = [];
  if (assignCount > 0) reasons.push(`${assignCount} project assignment${assignCount > 1 ? 's' : ''}`);
  if (taskCount > 0) reasons.push(`${taskCount} task assignment${taskCount > 1 ? 's' : ''}`);
  if (ledgerCount > 0) reasons.push(`${ledgerCount} unpaid ledger entr${ledgerCount > 1 ? 'ies' : 'y'}`);
  if (reasons.length > 0) {
    return res.status(409).json({
      error: `This crew member has ${reasons.join(' and ')}. Keep them archived instead.`,
    });
  }
  db.prepare('DELETE FROM crew WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Crew ledger (crew_debts): money owed to a crew member outside project
// assignments. Kept out of the P&L and the Dashboard.
router.get('/:id/debts', (req, res) => {
  const debts = db.prepare(
    'SELECT * FROM crew_debts WHERE crew_id = ? ORDER BY date_incurred DESC, created_at DESC'
  ).all(req.params.id);
  res.json(debts);
});

router.post('/:id/debts', (req, res) => {
  const { description, amount, date_incurred, notes, status } = req.body;
  const desc = typeof description === 'string' ? description.trim() : '';
  if (!desc || amount === undefined || amount === '') return res.status(400).json({ error: 'Description and amount required' });
  const err = validateMoney(amount, 'amount');
  if (err) return res.status(400).json({ error: err });
  const result = db.prepare(
    'INSERT INTO crew_debts (crew_id, description, amount, date_incurred, notes, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.params.id, desc, Number(amount), date_incurred || pristinaToday(), notes || null, status === 'paid' ? 'paid' : 'unpaid');
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id/debts/:debtId', (req, res) => {
  const { description, amount, date_incurred, status, payment_date, notes } = req.body;
  const desc = typeof description === 'string' ? description.trim() : '';
  if (!desc || amount === undefined || amount === '') return res.status(400).json({ error: 'Description and amount required' });
  const err = validateMoney(amount, 'amount');
  if (err) return res.status(400).json({ error: err });
  const paid = status === 'paid';
  const result = db.prepare(
    'UPDATE crew_debts SET description=?, amount=?, date_incurred=?, status=?, payment_date=?, notes=? WHERE id=? AND crew_id=?'
  ).run(desc, Number(amount), date_incurred || pristinaToday(), paid ? 'paid' : 'unpaid',
    paid ? (payment_date || pristinaToday()) : null, notes || null, req.params.debtId, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

router.delete('/:id/debts/:debtId', (req, res) => {
  db.prepare('DELETE FROM crew_debts WHERE id = ? AND crew_id = ?').run(req.params.debtId, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
