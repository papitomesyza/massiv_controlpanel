// Light windows for shot lists.
//
// Every time in here is an absolute instant (epoch ms) computed by suncalc from
// a location's own coordinates and the shoot date, so two shots on the same day
// in different parts of the country get their own correct times. Formatting to
// a clock face happens ONLY at the edges, through Intl with an explicit IANA
// zone — the container runs UTC and raw server time must never reach a user.

const SunCalc = require('suncalc');

// Same zone the nightly backup uses for "Pristina time".
const ZONE = 'Europe/Belgrade';

// Fallback coordinates (Pristina) for a shot with no location pinned yet, so
// the panel can still show indicative windows instead of blanks.
const FALLBACK_COORDS = { lat: 42.6629, lng: 21.1655 };

const MIN = 60 * 1000;

// ── Zone-aware conversions ────────────────────────────────────────────────────

function zoneParts(utcMs, zone = ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second),
  };
}

// Offset of the zone at a given instant, in ms (positive east of UTC).
function zoneOffsetMs(utcMs, zone = ZONE) {
  const p = zoneParts(utcMs, zone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - utcMs;
}

// "2026-06-15" + "07:30" in Pristina → epoch ms. Two passes so the instant is
// still right when the naive guess lands on the other side of a DST switch.
function localToUtcMs(dateStr, timeStr, zone = ZONE) {
  const d = parseDateParts(dateStr);
  if (!d) return null;
  const t = parseTimeParts(timeStr) || { hour: 0, minute: 0 };
  const guess = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute, 0);
  let ts = guess - zoneOffsetMs(guess, zone);
  ts = guess - zoneOffsetMs(ts, zone);
  return ts;
}

function parseDateParts(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function parseTimeParts(timeStr) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || ''));
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// The one place a clock face is produced. Always Pristina, always 24h.
function fmtTime(utcMs, zone = ZONE) {
  if (utcMs == null || !Number.isFinite(utcMs)) return '';
  const p = zoneParts(utcMs, zone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function fmtRange(from, to) {
  if (from == null || to == null) return '';
  return `${fmtTime(from)} – ${fmtTime(to)}`;
}

// ── Window catalogue ──────────────────────────────────────────────────────────
// hard: short, sun-driven, the plan must land inside it.
// soft: wide, used as filler around the anchors.

const WINDOW_DEFS = {
  any_time:         { label: 'Any time',            space: 'interior', hard: false },
  window_daylight:  { label: 'Window daylight',     space: 'interior', hard: false },
  night_interior:   { label: 'Night',               space: 'interior', hard: false },
  sunrise:          { label: 'Sunrise',             space: 'exterior', hard: true },
  morning_blue:     { label: 'Morning blue hour',   space: 'exterior', hard: true },
  morning_golden:   { label: 'Morning golden hour', space: 'exterior', hard: true },
  daylight:         { label: 'Daylight',            space: 'exterior', hard: false },
  evening_golden:   { label: 'Evening golden hour', space: 'exterior', hard: true },
  evening_blue:     { label: 'Evening blue hour',   space: 'exterior', hard: true },
  sunset:           { label: 'Sunset',              space: 'exterior', hard: true },
  night:            { label: 'Night',               space: 'exterior', hard: false },
};

const INTERIOR_WINDOWS = ['any_time', 'window_daylight', 'night_interior'];
const EXTERIOR_WINDOWS = [
  'sunrise', 'morning_blue', 'morning_golden', 'daylight',
  'evening_golden', 'evening_blue', 'sunset', 'night',
];

function windowsForSpace(space) {
  return space === 'interior' ? INTERIOR_WINDOWS : EXTERIOR_WINDOWS;
}

function isHardWindow(key) {
  const def = WINDOW_DEFS[key];
  return !!(def && def.hard);
}

function windowLabel(key) {
  const def = WINDOW_DEFS[key];
  return def ? def.label : (key || '');
}

// ── Solar events ──────────────────────────────────────────────────────────────

// Every solar moment for one location on one shoot day, as epoch ms. Solar noon
// is taken at 12:00 local so suncalc resolves the events of that calendar day.
function solarEvents(dateStr, lat, lng) {
  const useLat = Number.isFinite(Number(lat)) ? Number(lat) : FALLBACK_COORDS.lat;
  const useLng = Number.isFinite(Number(lng)) ? Number(lng) : FALLBACK_COORDS.lng;
  const noonMs = localToUtcMs(dateStr, '12:00');
  if (noonMs == null) return null;

  const t = SunCalc.getTimes(new Date(noonMs), useLat, useLng);
  const ms = v => (v instanceof Date && !isNaN(v.getTime()) ? v.getTime() : null);

  const dayStart = localToUtcMs(dateStr, '00:00');
  const dayEnd = dayStart + 24 * 60 * MIN - MIN;

  return {
    lat: useLat,
    lng: useLng,
    approximate: !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)),
    dayStart,
    dayEnd,
    civilDawn: ms(t.dawn),
    sunrise: ms(t.sunrise),
    sunriseEnd: ms(t.sunriseEnd),
    goldenHourEnd: ms(t.goldenHourEnd),   // morning golden hour ends
    solarNoon: ms(t.solarNoon),
    goldenHour: ms(t.goldenHour),         // evening golden hour begins
    sunsetStart: ms(t.sunsetStart),
    sunset: ms(t.sunset),
    civilDusk: ms(t.dusk),
  };
}

// A summary block for the panel and the public page header.
function solarSummary(dateStr, lat, lng) {
  const e = solarEvents(dateStr, lat, lng);
  if (!e) return null;
  return {
    approximate: e.approximate,
    civil_dawn: fmtTime(e.civilDawn),
    sunrise: fmtTime(e.sunrise),
    morning_golden_end: fmtTime(e.goldenHourEnd),
    solar_noon: fmtTime(e.solarNoon),
    evening_golden_start: fmtTime(e.goldenHour),
    sunset: fmtTime(e.sunset),
    civil_dusk: fmtTime(e.civilDusk),
  };
}

// The concrete [from, to] instants of one light window at one location.
// Falls back to the whole shoot day whenever an event is missing (polar edge
// cases, bad coordinates) so scheduling never gets a null boundary.
function resolveWindow(key, dateStr, lat, lng) {
  const e = solarEvents(dateStr, lat, lng);
  if (!e) return null;

  const def = WINDOW_DEFS[key] || WINDOW_DEFS.any_time;
  const whole = { from: e.dayStart, to: e.dayEnd };
  const pick = (from, to) => ({
    from: from == null ? whole.from : from,
    to: to == null ? whole.to : to,
  });

  let range;
  switch (key) {
    case 'sunrise':
      range = pick(e.sunrise == null ? null : e.sunrise - 15 * MIN,
                   e.sunrise == null ? null : Math.max(e.sunriseEnd || 0, e.sunrise + 15 * MIN));
      break;
    case 'morning_blue':
      range = pick(e.civilDawn, e.sunrise);
      break;
    case 'morning_golden':
      range = pick(e.sunrise, e.goldenHourEnd);
      break;
    case 'daylight':
      range = pick(e.goldenHourEnd, e.goldenHour);
      break;
    case 'evening_golden':
      range = pick(e.goldenHour, e.sunset);
      break;
    case 'evening_blue':
      range = pick(e.sunset, e.civilDusk);
      break;
    case 'sunset':
      range = pick(e.sunset == null ? null : Math.min(e.sunsetStart || Infinity, e.sunset - 15 * MIN),
                   e.sunset == null ? null : e.sunset + 15 * MIN);
      break;
    case 'night':
      range = pick(e.civilDusk, e.dayEnd);
      break;
    case 'night_interior':
      range = pick(e.civilDusk, e.dayEnd);
      break;
    case 'window_daylight':
      range = pick(e.sunrise, e.sunset);
      break;
    case 'any_time':
    default:
      range = whole;
      break;
  }

  if (range.to <= range.from) range = whole;

  return {
    key: WINDOW_DEFS[key] ? key : 'any_time',
    label: def.label,
    hard: !!def.hard,
    from: range.from,
    to: range.to,
    from_label: fmtTime(range.from),
    to_label: fmtTime(range.to),
    range_label: fmtRange(range.from, range.to),
    approximate: e.approximate,
  };
}

module.exports = {
  ZONE,
  MIN,
  FALLBACK_COORDS,
  WINDOW_DEFS,
  INTERIOR_WINDOWS,
  EXTERIOR_WINDOWS,
  windowsForSpace,
  isHardWindow,
  windowLabel,
  zoneOffsetMs,
  localToUtcMs,
  parseTimeParts,
  fmtTime,
  fmtRange,
  solarEvents,
  solarSummary,
  resolveWindow,
};
