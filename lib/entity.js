// The two sets of books. Gargia is the archive (no new invoices ever, Andi's
// call 23 Oct 2026); Massiv is the go-forward entity with its own business
// number, bank account and invoice series.
//
// Every record carries an `entity` column defaulting to 'gargia', which is what
// the historical rows got from the migration. New records default to Massiv.

const ENTITIES = ['gargia', 'massiv'];
const LIVE_ENTITY = 'massiv';

function normalize(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return ENTITIES.includes(s) ? s : null;
}

// Which single entity a request may read. A finance session is locked to the
// live books and can never widen it; a normal session sees everything unless it
// asks for one entity.
function readEntity(req) {
  if (req.role === 'finance') return LIVE_ENTITY;
  return normalize(req.query && req.query.entity);
}

// Which entity a record created through this request belongs to. Derived records
// should pass the source's entity as the fallback so they never cross books.
function writeEntity(req, fallback = LIVE_ENTITY) {
  if (req.role === 'finance') return LIVE_ENTITY;
  return normalize(req.body && req.body.entity) || fallback;
}

module.exports = { ENTITIES, LIVE_ENTITY, readEntity, writeEntity };
