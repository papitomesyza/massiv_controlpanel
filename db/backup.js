// Automated nightly off-site backup.
//
// Copies the live SQLite database to a temp file using better-sqlite3's built-in
// backup API (the WAL-safe way), gzips it, and uploads it to a private GitHub
// repository via the Contents API. Scheduling is a plain interval timer: a check
// runs on boot and then hourly. The feature is fully dormant unless both
// BACKUP_GITHUB_TOKEN and BACKUP_GITHUB_REPO are configured, and it never throws
// — every network/API failure is caught and logged.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { db } = require('./database');

const TOKEN = process.env.BACKUP_GITHUB_TOKEN;
const REPO = process.env.BACKUP_GITHUB_REPO; // "owner/repo"
const BRANCH = process.env.BACKUP_BRANCH || 'main';

const RETENTION = 14;                         // keep newest N backup files
const CHECK_INTERVAL_MS = 60 * 60 * 1000;     // hourly re-check
const BACKUP_ZONE = 'Europe/Belgrade';        // IANA zone for Pristina time

function log(msg) { console.log(`[backup] ${msg}`); }

function getSetting(key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (_) { return null; }
}

function setSetting(key, value) {
  try {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  } catch (_) {}
}

function lastSuccessMs() {
  const v = getSetting('backup_last_success');
  if (!v) return null;
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}

function hourInZone(zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const h = parseInt((parts.find(p => p.type === 'hour') || {}).value, 10);
  return isNaN(h) ? 0 : (h % 24);
}

// Decide whether a backup should run right now.
function shouldBackup() {
  const last = lastSuccessMs();
  if (last === null) return true;               // never backed up
  const ageHours = (Date.now() - last) / 3600000;
  if (ageHours >= 24) return true;              // stale beyond a full day
  if (hourInZone(BACKUP_ZONE) >= 3 && ageHours > 20) return true; // past 03:00 local, >20h old
  return false;
}

// ── GitHub Contents API helpers ───────────────────────────────────────────────

function ghApi(method, urlPath, body) {
  return fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'massiv-backup',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function uploadToGitHub(fileName, buffer) {
  const [owner, repo] = REPO.split('/');
  const apiPath = `/repos/${owner}/${repo}/contents/${encodeURIComponent(fileName)}`;

  // If a file with this name already exists (same-day re-run), we need its sha.
  let sha;
  const getRes = await ghApi('GET', `${apiPath}?ref=${encodeURIComponent(BRANCH)}`);
  if (getRes.ok) {
    const existing = await getRes.json().catch(() => null);
    if (existing && existing.sha) sha = existing.sha;
  }

  const putRes = await ghApi('PUT', apiPath, {
    message: `Automated backup ${fileName}`,
    content: buffer.toString('base64'),
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '');
    throw new Error(`GitHub upload ${putRes.status}: ${text.slice(0, 200)}`);
  }
}

async function pruneOldBackups() {
  try {
    const [owner, repo] = REPO.split('/');
    const res = await ghApi('GET', `/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(BRANCH)}`);
    if (!res.ok) return;
    const files = await res.json().catch(() => []);
    if (!Array.isArray(files)) return;

    const backups = files
      .filter(f => f.type === 'file' && /^massiv-backup-.*\.db\.gz$/.test(f.name))
      .sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first (YYYY-MM-DD sorts chronologically)

    for (const f of backups.slice(RETENTION)) {
      const delRes = await ghApi('DELETE', `/repos/${owner}/${repo}/contents/${encodeURIComponent(f.name)}`, {
        message: `Prune old backup ${f.name}`,
        sha: f.sha,
        branch: BRANCH,
      });
      if (delRes.ok) log(`pruned old backup: ${f.name}`);
    }
  } catch (e) {
    log(`prune failed: ${e.message}`);
  }
}

// ── Backup procedure ──────────────────────────────────────────────────────────

async function runBackup() {
  const tmpPath = path.join(os.tmpdir(), `massiv-backup-${Date.now()}.db`);
  try {
    await db.backup(tmpPath); // WAL-safe consistent snapshot
    const gz = zlib.gzipSync(fs.readFileSync(tmpPath));
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `massiv-backup-${date}.db.gz`;

    await uploadToGitHub(fileName, gz);
    setSetting('backup_last_success', new Date().toISOString());
    log(`backup uploaded: ${fileName} (${gz.length} bytes)`);

    await pruneOldBackups();
  } catch (e) {
    log(`backup failed: ${e.message}`);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

function start() {
  if (!TOKEN || !REPO) {
    log('Off-site backups disabled (set BACKUP_GITHUB_TOKEN and BACKUP_GITHUB_REPO to enable)');
    return;
  }
  log(`Off-site backups enabled → ${REPO} (branch ${BRANCH})`);

  const tick = () => {
    try {
      if (shouldBackup()) runBackup();
    } catch (e) {
      log(`tick error: ${e.message}`);
    }
  };

  tick();                                 // check on boot
  setInterval(tick, CHECK_INTERVAL_MS);   // and hourly thereafter
}

module.exports = { start };
