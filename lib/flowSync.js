// Mirrors received client payments into Financial Flow (the personal
// finances tracker) through its /api/sync API.
//
// Disabled unless both FLOW_SYNC_URL (base URL of the Financial Flow
// deployment) and FLOW_SYNC_KEY (must match the same var on the Flow
// service) are set. Every call is fire-and-forget with a short timeout —
// a slow or unreachable Flow instance can never block or crash Massiv.
const { db } = require('../db/database');

const FLOW_URL = (process.env.FLOW_SYNC_URL || '').replace(/\/+$/, '');
const FLOW_KEY = process.env.FLOW_SYNC_KEY || '';

function enabled() {
  return Boolean(FLOW_URL && FLOW_KEY);
}

// Stable identity of a payment inside Flow, so re-syncs update in place and
// retractions can target the exact row.
function externalId(paymentId) {
  return `massiv:payment:${paymentId}`;
}

function send(method, path, body) {
  fetch(`${FLOW_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Sync-Key': FLOW_KEY },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  }).then(res => {
    if (!res.ok) console.error(`[flow-sync] ${method} ${path} -> HTTP ${res.status}`);
  }).catch(err => {
    console.error(`[flow-sync] ${method} ${path} failed: ${err.message}`);
  });
}

// Push the payment's current state to Flow: upsert while it's 'received',
// retract when it isn't (covers status flips in either direction).
function syncPayment(paymentId) {
  if (!enabled()) return;
  const row = db.prepare(`
    SELECT cp.*, p.title as project_title, c.name as client_name
    FROM client_payments cp
    JOIN projects p ON p.id = cp.project_id
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE cp.id = ?
  `).get(paymentId);

  if (!row || row.status !== 'received') {
    return removePayment(paymentId);
  }

  const description = [row.project_title, row.client_name].filter(Boolean).join(' — ');
  send('POST', '/api/sync/transactions', {
    external_id: externalId(paymentId),
    date: String(row.date).slice(0, 10),
    type: 'income',
    category: 'massiv',
    description: description || row.notes || 'Client payment',
    amount: row.amount,
  });
}

function removePayment(paymentId) {
  if (!enabled()) return;
  send('DELETE', `/api/sync/transactions/${encodeURIComponent(externalId(paymentId))}`);
}

module.exports = { syncPayment, removePayment };
