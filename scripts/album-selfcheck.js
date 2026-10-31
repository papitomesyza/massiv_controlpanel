// Self-check for the album card ('one card, many images'): the media table, the
// order attachMedia hands the viewer, and the cascade that cleans up with the card.
// Runs against a throwaway DATA_DIR, never the panel's own database.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'album-check-'));

const { db, initDb } = require('../db/database');
const { attachMedia } = require('../lib/cardMedia');
const { multiImageUpload, storeImage } = require('../lib/mediaStore');

initDb();

let failed = 0;
const ok = (label, cond) => { console.log((cond ? 'pass  ' : 'FAIL  ') + label); if (!cond) failed++; };

const collId = db.prepare("INSERT INTO collections (name) VALUES ('Location scout')").run().lastInsertRowid;
const album = db.prepare("INSERT INTO collection_cards (collection_id, type, title) VALUES (?, 'album', 'Villa')").run(collId).lastInsertRowid;
const note = db.prepare("INSERT INTO collection_cards (collection_id, type, note_text) VALUES (?, 'note', 'call the owner')").run(collId).lastInsertRowid;

const ins = db.prepare('INSERT INTO collection_card_media (card_id, url, thumbnail_url, sort_order) VALUES (?, ?, ?, ?)');
ins.run(album, '/collection-media/b.jpg', '/collection-media/b-t.jpg', 1);
ins.run(album, '/collection-media/a.jpg', '/collection-media/a-t.jpg', 0);
ins.run(album, '/collection-media/c.jpg', '/collection-media/c-t.jpg', 2);
ins.run(note, '/collection-media/loose.jpg', null, 0);

const cards = attachMedia([{ id: album, type: 'album' }, { id: note, type: 'note' }]);
ok('the album card carries its 3 images', cards[0].media.length === 3);
ok('in sort_order', cards[0].media.map(m => m.url).join(',') === '/collection-media/a.jpg,/collection-media/b.jpg,/collection-media/c.jpg');
ok('a note card gets no media', !cards[1].media);
ok('no cards, no query', JSON.stringify(attachMedia([])) === '[]');

db.prepare('DELETE FROM collection_cards WHERE id = ?').run(album);
ok('deleting the card takes its images with it', db.prepare('SELECT COUNT(*) c FROM collection_card_media WHERE card_id = ?').get(album).c === 0);

// ── the First AD window ───────────────────────────────────────────────────────
const { renderMood } = require('../lib/renderMood');
const html = renderMood({ name: 'Location scout' }, [
  { id: 1, type: 'album', title: 'Villa, morning', media: [{ url: '/collection-media/a-web.jpg', thumbnail_url: '/collection-media/a-thumb.jpg' }] },
]);
ok('the window ships the viewer', html.includes('id="viewer"'));
ok('the window takes a batch at once', html.includes('id="pickImage" accept="image/*" multiple'));
try {
  new Function(html.split('<script>').pop().split('</script>')[0]);
  ok('the window script parses', true);
} catch (e) {
  ok('the window script parses: ' + e.message, false);
}

// ── the multipart contract ────────────────────────────────────────────────────
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4EIwDiqkL4KAB4dE/cf7Y2sAAAAAElFTkSuQmCC', 'base64');

(async () => {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'album-media-'));
  const express = require('express');
  const app = express();
  app.post('/upload', multiImageUpload('image', 20), async (req, res) => {
    const stored = [];
    for (const f of req.files || []) stored.push(await storeImage(f.buffer, mediaDir));
    res.json({ files: (req.files || []).length, stored });
  });
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}/upload`;
  const form = n => {
    const fd = new FormData();
    for (let i = 0; i < n; i++) fd.append('image', new Blob([PNG], { type: 'image/png' }), `shot-${i}.png`);
    return fd;
  };
  const post = fd => fetch(url, { method: 'POST', body: fd }).then(r => r.json());

  const three = await post(form(3));
  ok('three images on one field arrive together', three.files === 3);
  ok('each image is stored with a thumbnail',
    three.stored.length === 3 && three.stored.every(s => fs.existsSync(path.join(mediaDir, s.filename)) && fs.existsSync(path.join(mediaDir, s.thumb))));
  ok('a single image still works', (await post(form(1))).files === 1);
  ok('past the ceiling the batch is refused', (await post(form(21))).error === 'Too many images');

  const notAnImage = new FormData();
  notAnImage.append('image', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'notes.txt');
  ok('a non-image is refused', (await post(notAnImage)).error === 'Only jpeg, png, webp or gif images');

  srv.close();
  console.log(failed ? `\n${failed} failed` : '\nall good');
  process.exit(failed ? 1 : 0);
})();
