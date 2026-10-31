// Album cards (one card, many images: a location scout) keep their images in
// collection_card_media. Every read path that hands cards to a client attaches
// them here, so the panel, the share link, the Collections page and the First AD
// window all draw the same single card with its assets inside.

const { db } = require('../db/database');

function attachMedia(cards) {
  const albums = (cards || []).filter(c => c.type === 'album');
  if (!albums.length) return cards;

  const rows = db.prepare(
    `SELECT * FROM collection_card_media WHERE card_id IN (${albums.map(() => '?').join(',')})
     ORDER BY sort_order ASC, id ASC`
  ).all(...albums.map(c => c.id));

  const byCard = new Map();
  rows.forEach(r => {
    if (!byCard.has(r.card_id)) byCard.set(r.card_id, []);
    byCard.get(r.card_id).push(r);
  });
  albums.forEach(c => { c.media = byCard.get(c.id) || []; });
  return cards;
}

module.exports = { attachMedia };
