// Calendar dates in Pristina local time for the browser bundle. The server's
// lib/pristinaDate.js is the source of truth; this is its client twin, the same
// way lib/filename.js mirrors the server helper, because the Vite bundle cannot
// import server modules. Keep the two identical.
//
// Kosovo shares the Europe/Belgrade zone (CET/CEST), and en-CA formats as
// YYYY-MM-DD. Never UTC: before 02:00 local a UTC date still reads as
// yesterday, and on the first of a month opens on the previous month.

const ZONE = 'Europe/Belgrade';

export function pristinaToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function pristinaMonth() {
  return pristinaToday().slice(0, 7);
}

export function pristinaYear() {
  return pristinaToday().slice(0, 4);
}

export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const pad = n => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addMonths(ym, months) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  return t.toISOString().slice(0, 7);
}

// The Pristina calendar date of an instant: an ISO timestamp, or a SQLite UTC
// stamp ("YYYY-MM-DD HH:MM:SS", stored without a zone). Returns null when it
// cannot be read.
export function pristinaDateOf(instant) {
  if (!instant) return null;
  let str = String(instant);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str)) str = `${str.replace(' ', 'T')}Z`;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// The Pristina wall clock time of an instant, as HH:MM, read the same way as
// pristinaDateOf. Stored stamps stay UTC; only what is shown is converted.
export function pristinaTimeOf(instant) {
  if (!instant) return null;
  let str = String(instant);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str)) str = `${str.replace(' ', 'T')}Z`;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
}
