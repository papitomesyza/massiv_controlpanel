// Pitch domain routing (Phase 2) — one server, two faces.
//
// The same service answers on the panel domain and on a custom public pitch
// domain; what it serves depends entirely on the Host header. Everything here
// is dormant unless PUBLIC_PITCH_DOMAIN is set, in which case:
//
//   • on the pitch domain ONLY these paths exist: /, /p/:slug, /p-media/:file,
//     /favicon.ico, /robots.txt. Everything else — /api, /login, every SPA
//     route, every built asset — gets a minimal, byte-identical 404 that
//     reveals nothing and links nowhere.
//   • on the panel domain /p/ and /p-media/ 301 to the pitch domain so links
//     already in a client's hands keep working.
//
// The guard is registered BEFORE the API routers, the static middleware and
// the SPA catch-all, so no panel asset can ever be reached on the pitch host.

const { db } = require('../db/database');

// Accepts a bare hostname. Tolerates a pasted protocol, path or port rather
// than silently disabling the feature over a stray character.
function normalizeDomain(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // protocol
    .replace(/\/.*$/, '')                   // path / trailing slash
    .replace(/:\d+$/, '');                  // port
  return host || null;
}

const PITCH_DOMAIN = normalizeDomain(process.env.PUBLIC_PITCH_DOMAIN);

function pitchDomain() {
  return PITCH_DOMAIN;
}

// Express already strips the port and honours X-Forwarded-Host under the
// trust-proxy setting; the fallbacks are for direct/odd requests.
function requestHost(req) {
  const host = (req.hostname || req.get('host') || '').toLowerCase();
  return host.replace(/:\d+$/, '');
}

function isPitchHost(req) {
  return !!PITCH_DOMAIN && requestHost(req) === PITCH_DOMAIN;
}

function isWwwPitchHost(req) {
  return !!PITCH_DOMAIN && requestHost(req) === `www.${PITCH_DOMAIN}`;
}

function getAgency() {
  try {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('agency_name', 'agency_logo')").all();
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });
    return { name: map.agency_name || null, logo: map.agency_logo || null };
  } catch (_) {
    // A settings read must never turn a 404 page into a 500
    return { name: null, logo: null };
  }
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Same visual language as the presentations: black canvas, SF stack, centered.
const SHELL_CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:#000;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;padding:32px;-webkit-font-smoothing:antialiased}
img{display:block;max-width:100%}`;

// The 404 is identical for a draft slug, an unknown slug, a template slug and a
// completely unrelated path, so nothing about the panel or its content can be
// enumerated from the outside.
function notFoundHtml(agency) {
  const name = agency && agency.name ? agency.name : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(name)}</title>
<style>${SHELL_CSS}
.mark{font-size:12px;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;color:rgba(245,245,247,0.5)}</style>
</head>
<body>
${name ? `<div class="mark">${esc(name)}</div>` : '<div></div>'}
</body>
</html>`;
}

// Root of the pitch domain: branding only. Never lists or links to a pitch.
function landingHtml(agency) {
  const name = agency && agency.name ? agency.name : '';
  const logo = agency && agency.logo ? agency.logo : '';
  const mark = logo
    ? `<img class="logo" src="${esc(logo)}" alt="${esc(name)}">`
    : (name ? `<h1 class="name">${esc(name)}</h1>` : '<div></div>');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(name)}</title>
<style>${SHELL_CSS}
.logo{max-width:min(280px,60vw);height:auto;filter:brightness(0) invert(1);opacity:.9}
.name{font-size:clamp(1.8rem,6vw,3.4rem);font-weight:700;letter-spacing:-0.02em;line-height:1.05}</style>
</head>
<body>
${mark}
</body>
</html>`;
}

// Casting links are shared with named agencies, not published to the world, so
// they stay out of the index — the page also carries a noindex meta tag.
const ROBOTS_TXT = [
  'User-agent: *',
  'Allow: /p/',
  'Allow: /p-media/',
  'Disallow: /c/',
  'Disallow: /',
  '',
].join('\n');

function sendPitch404(req, res) {
  res.status(404);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.send(notFoundHtml(getAgency()));
}

// Absolute origin for og:image and canonical URLs. On the pitch domain it is
// always that domain, so a pitch opened there can never advertise the panel
// host (or a proxy's internal host, when the proxy rewrites Host and passes
// the real one along in X-Forwarded-Host). Everywhere else: unchanged, the
// incoming Host header.
function requestOrigin(req) {
  if (isPitchHost(req)) return `https://${PITCH_DOMAIN}`;
  return `${req.protocol}://${req.get('host')}`;
}

// The base URL pitch links should be built from: the configured pitch domain
// over https when set, otherwise whatever origin the panel is being used on.
function publicPitchBase(req) {
  if (PITCH_DOMAIN) {
    return { base: `https://${PITCH_DOMAIN}`, host: PITCH_DOMAIN, custom: true };
  }
  const host = req.get('host') || '';
  return { base: `${req.protocol}://${host}`, host, custom: false };
}

// Paths that exist at all on the pitch domain. Anything else is a 404.
const PITCH_SLUG_PATH = /^\/p\/[^/]+\/?$/;
const PITCH_MEDIA_PATH = /^\/p-media\/[^/]+$/;

// Public shot lists live at /s/:slug with media at /s-media. The custom-domain
// work for them is deferred, so they are panel-domain only for now. Allowing
// them on the pitch host later is this one line: set it to true.
const SHOTLISTS_ON_PITCH_DOMAIN = false;
const SHOTLIST_SLUG_PATH = /^\/s\/[^/]+\/?$/;
const SHOTLIST_MEDIA_PATH = /^\/s-media\/[^/]+$/;

function isShotlistPath(p) {
  return SHOTLIST_SLUG_PATH.test(p) || SHOTLIST_MEDIA_PATH.test(p);
}

// The casting grid IS served on the public domain: it goes to a casting agency
// outside the production, so it should arrive on the agency-facing host rather
// than the panel's. It needs /s-media too, since the cast photos and wardrobe
// stills live in the shot list media store — that store is already public on
// the panel domain, so this exposes nothing new.
const CASTING_SLUG_PATH = /^\/c\/[^/]+\/?$/;

function isCastingPath(p) {
  return CASTING_SLUG_PATH.test(p) || SHOTLIST_MEDIA_PATH.test(p);
}

function pitchDomainGuard(req, res, next) {
  try {
    if (!PITCH_DOMAIN) return next();

    // Keep links canonical: www form 301s to the apex, path preserved.
    if (isWwwPitchHost(req)) {
      return res.redirect(301, `https://${PITCH_DOMAIN}${req.originalUrl}`);
    }

    if (!isPitchHost(req)) {
      // Panel domain: old public links follow the move to the pitch domain.
      // /api (including the builder's preview endpoint) is untouched.
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (PITCH_SLUG_PATH.test(req.path) || PITCH_MEDIA_PATH.test(req.path)
          || CASTING_SLUG_PATH.test(req.path)) {
          return res.redirect(301, `https://${PITCH_DOMAIN}${req.originalUrl}`);
        }
      }
      return next();
    }

    // ── On the pitch domain from here down ──
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendPitch404(req, res);

    if (req.path === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return res.send(landingHtml(getAgency()));
    }

    if (req.path === '/robots.txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(ROBOTS_TXT);
    }

    // Permitted, but never served from the panel's build output — a browser
    // asking for a favicon gets nothing rather than the panel's icon.
    if (req.path === '/favicon.ico') return res.status(204).end();

    if (PITCH_SLUG_PATH.test(req.path) || PITCH_MEDIA_PATH.test(req.path)) return next();
    if (isCastingPath(req.path)) return next();
    if (SHOTLISTS_ON_PITCH_DOMAIN && isShotlistPath(req.path)) return next();

    return sendPitch404(req, res);
  } catch (err) {
    // No global error handler in this app — a guard failure must still be a
    // closed door, never a fall-through to the panel.
    console.error('Pitch domain guard failed:', err && err.message ? err.message : err);
    if (PITCH_DOMAIN && isPitchHost(req)) return sendPitch404(req, res);
    return next();
  }
}

function logBootStatus() {
  if (PITCH_DOMAIN) {
    console.log(`Pitch domain routing: ENABLED for ${PITCH_DOMAIN} (public pitches served on that host only)`);
  } else {
    console.log('Pitch domain routing: disabled (PUBLIC_PITCH_DOMAIN not set)');
  }
}

module.exports = {
  pitchDomain,
  isPitchHost,
  requestOrigin,
  pitchDomainGuard,
  sendPitch404,
  publicPitchBase,
  logBootStatus,
};
