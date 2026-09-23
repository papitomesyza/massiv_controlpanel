// Calendar dates in Pristina local time, the one clock every money default in
// the app is read against.
//
// Kosovo shares the Europe/Belgrade zone (CET/CEST), and en-CA formats as
// YYYY-MM-DD. Never UTC: before 02:00 local a UTC date still reads as
// yesterday, which drops a payment or an invoice into the wrong day, and on the
// first of a month opens every monthly figure on the previous month.

const ZONE = 'Europe/Belgrade';

function pristinaToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// YYYY-MM of today in Pristina.
function pristinaMonth() {
  return pristinaToday().slice(0, 7);
}

// YYYY of today in Pristina, as a string like every year query parameter.
function pristinaYear() {
  return pristinaToday().slice(0, 4);
}

// Shift a YYYY-MM-DD calendar date by whole days. Pure date arithmetic in UTC
// on the date itself, so no clock or zone can move it by a day.
function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// Shift a YYYY-MM month by whole months.
function addMonths(ym, months) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  return t.toISOString().slice(0, 7);
}

// The Pristina calendar date of an instant: an ISO timestamp, or a SQLite UTC
// stamp ("YYYY-MM-DD HH:MM:SS", stored without a zone). Returns null when it
// cannot be read.
function pristinaDateOf(instant) {
  if (!instant) return null;
  let str = String(instant);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str)) str = `${str.replace(' ', 'T')}Z`;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

module.exports = { pristinaToday, pristinaMonth, pristinaYear, pristinaDateOf, addDays, addMonths };
