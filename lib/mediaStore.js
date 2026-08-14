// Shared image ingest for every feature that accepts uploads (pitch media,
// shotlist media). Extracted verbatim from the pitch upload endpoint so both
// features produce byte-identical output: a web copy at longest edge 2000
// quality 82, a thumb at longest edge 640 quality 78, and the original is
// discarded. Nothing here touches paths — each caller passes its own directory.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');

const IMAGE_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// multer options shared by every image upload endpoint: memory storage (the
// original is never written to disk), images only, 25MB ceiling.
function imageUploadOptions() {
  return {
    storage: require('multer').memoryStorage(),
    fileFilter: (req, file, cb) => { cb(null, IMAGE_MIME.includes(file.mimetype)); },
    limits: { fileSize: MAX_UPLOAD_BYTES },
  };
}

// Writes the two derivatives into mediaDir and returns their filenames.
// Throws on an unreadable/corrupt image — callers answer 400 with the message.
//
// An animated upload keeps its motion: the web copy becomes an animated WebP
// rather than being flattened to a still, because motion is the whole reason
// somebody attaches a GIF as reference for a shot. The THUMB is always a plain
// JPEG of the first frame — grids stay cheap, and PDFKit only embeds JPEG and
// PNG, so the exports have something they can actually draw.
async function storeImage(buffer, mediaDir) {
  if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

  const base = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const thumbName = `${base}-thumb.jpg`;

  let animated = false;
  try {
    const meta = await sharp(buffer, { animated: true, failOn: 'none' }).metadata();
    animated = Number(meta.pages) > 1;
  } catch (_) {
    // Unreadable as an animation is not fatal — fall through to the still path,
    // which throws its own error if the file is genuinely corrupt.
    animated = false;
  }

  const webName = animated ? `${base}-web.webp` : `${base}-web.jpg`;

  if (animated) {
    // No .rotate() here: it is unreliable across frames, and an animated GIF
    // carries no EXIF orientation to correct anyway.
    await sharp(buffer, { animated: true, failOn: 'none' })
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75, effort: 4 })
      .toFile(path.join(mediaDir, webName));
  } else {
    await sharp(buffer, { failOn: 'none' }).rotate()
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(mediaDir, webName));
  }

  // First frame only — sharp without { animated: true } reads page 0.
  await sharp(buffer, { failOn: 'none' }).rotate()
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(path.join(mediaDir, thumbName));

  return { filename: webName, thumb: thumbName, animated };
}

// The traversal guard used by every media-serving route: filenames are
// generated server-side, so anything containing a separator is a tampering
// attempt and gets rejected before it reaches the filesystem.
function isSafeMediaName(filename) {
  if (!filename || typeof filename !== 'string') return false;
  if (/[/\\]/.test(filename) || filename.includes('..')) return false;
  return true;
}

const MEDIA_MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// Shared handler body for the public media routes (pitch /p-media, shotlist
// /s-media): same traversal guard, same mime map, same long immutable cache.
function serveMediaFile(req, res, mediaDir) {
  const filename = req.params.filename;
  if (!isSafeMediaName(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(mediaDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

  const ext = path.extname(filename).toLowerCase();
  res.setHeader('Content-Type', MEDIA_MIME_BY_EXT[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(filePath);
}

module.exports = {
  IMAGE_MIME,
  MAX_UPLOAD_BYTES,
  imageUploadOptions,
  storeImage,
  isSafeMediaName,
  serveMediaFile,
};
