// Smoke check for the First AD window's link enrichment: a link dropped in the
// crew window must come back with the same title/thumbnail/source the panel
// grid stores. Start a local server first, then run:
//   DATA_DIR=<scratch> HERMES_API_TOKEN=testtoken PORT=4123 node server.js
//   BASE=http://127.0.0.1:4123 TOKEN=testtoken node scripts/mood-thumb-selfcheck.js
const assert = require('assert');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const TOKEN = process.env.TOKEN || '';
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const JSON_H = { 'Content-Type': 'application/json' };

async function j(path, init) {
  const r = await fetch(BASE + path, init);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, body: t }; }
}

(async () => {
  const coll = await j('/api/collections', {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ name: 'Thumb self-check', kind: 'studio' }),
  });
  assert(coll.status === 200 && coll.body.id, 'collection create failed: ' + JSON.stringify(coll));
  const id = coll.body.id;

  const link = await j(`/api/collections/${id}/collab-link`, {
    method: 'POST', headers: AUTH, body: JSON.stringify({ passcode: 'test123' }),
  });
  assert(link.body.slug, 'collab link failed: ' + JSON.stringify(link));
  const slug = link.body.slug;

  const un = await j(`/api/public/collab/${slug}/unlock`, {
    method: 'POST', headers: JSON_H,
    body: JSON.stringify({ name: 'Tester', passcode: 'test123' }),
  });
  assert(un.body.token, 'unlock failed: ' + JSON.stringify(un));
  const crew = un.body.token;

  // The bug: a link added from the window used to store no thumbnail.
  const good = await j(`/api/public/collab/${slug}/cards`, {
    method: 'POST', headers: JSON_H,
    body: JSON.stringify({ token: crew, type: 'link', url: 'https://en.wikipedia.org/wiki/Cinematography' }),
  });
  assert(good.status === 200, 'add link failed: ' + JSON.stringify(good));
  assert(good.body.card.thumbnail_url, 'FAIL: crew link card has no thumbnail_url');

  // A private URL must still store a card, just with no picture (SSRF guard).
  const bad = await j(`/api/public/collab/${slug}/cards`, {
    method: 'POST', headers: JSON_H,
    body: JSON.stringify({ token: crew, type: 'link', url: 'http://127.0.0.1:1/' }),
  });
  assert(bad.status === 200 && bad.body.card.thumbnail_url === null, 'FAIL: private URL got a preview');

  // Editing a link to a new URL must refresh the picture.
  const edited = await j(`/api/public/collab/${slug}/cards/${good.body.card.id}`, {
    method: 'PUT', headers: JSON_H,
    body: JSON.stringify({ token: crew, url: 'https://en.wikipedia.org/wiki/Film' }),
  });
  assert(edited.status === 200 && edited.body.card.thumbnail_url, 'FAIL: edited link lost its thumbnail');

  // The panel side still behaves the same way.
  const panel = await j(`/api/collections/${id}/cards`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ type: 'link', url: 'https://en.wikipedia.org/wiki/Cinematography' }),
  });
  assert(panel.status === 200 && panel.body.thumbnail_url, 'FAIL: panel link card lost its thumbnail');

  // An Instagram link: Instagram only hands og: tags to a crawler UA, and its
  // CDN picture URL expires, so the card must carry a copy in our own store.
  const ig = await j(`/api/collections/${id}/cards`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ type: 'link', url: 'https://www.instagram.com/p/DV_hP_fDb85/' }),
  });
  assert(ig.status === 200, 'instagram add failed: ' + JSON.stringify(ig));
  assert(ig.body.source === 'instagram', 'FAIL: not detected as instagram: ' + JSON.stringify(ig.body));
  assert(/^\/collection-media\//.test(ig.body.thumbnail_url || ''),
    'FAIL: instagram link card has no stored thumbnail: ' + JSON.stringify(ig.body));

  console.log('mood-thumb self-check: ALL PASSED');
})().catch(e => { console.error('mood-thumb self-check FAILED:', e.message); process.exit(1); });
