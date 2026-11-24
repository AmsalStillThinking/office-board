// Pure rule functions for the Office Board. No I/O. Every date decision is made in Asia/Makassar (UTC+8, no DST).
// Dates are 'YYYY-MM-DD' strings; instants are epoch milliseconds.

export const TZ_OFFSET_MS = 8 * 3600 * 1000;
const DAY = 86400000;

export const DEFAULT_SETTINGS = Object.freeze({ maxActive: 3, wiltLate: 0, rotLate: 3, hardLead: 3 });
export const AGEING_STATUSES = Object.freeze(['antri', 'jalan', 'tunggu']);
export const OPEN_STATUSES = Object.freeze(['antri', 'jalan', 'tunggu', 'bukti']);
export const SOURCES = Object.freeze(['WhatsApp', 'Lisan', 'Rapat', 'Email', 'Lainnya']);
export const TYPES = Object.freeze(['umum', 'pajak', 'keuangan', 'sdm', 'laporan', 'konten', 'administrasi']);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= lastDayOfMonth(y, mo);
}

/** Local (Asia/Makassar) calendar date of an instant. */
export function localDate(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** Days since 1970-01-01 for a date string. */
export function dayNum(s) {
  const m = DATE_RE.exec(s);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY);
}

export function dateFromNum(n) {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return dateFromNum(dayNum(s) + n);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(s) {
  return new Date(dayNum(s) * DAY).getUTCDay();
}

export function isWorkday(s) {
  return weekday(s) !== 0; // Monday to Saturday
}

// Sundays in (-inf, n]: day 3 since epoch (1970-01-04) was a Sunday.
function sundaysUpTo(n) {
  return Math.floor((n - 3) / 7);
}

/** Working days d with a < d <= b (Monday to Saturday). Negative when b < a. */
export function workdaysBetween(a, b) {
  const na = dayNum(a), nb = dayNum(b);
  if (nb < na) return -workdaysBetween(b, a);
  return (nb - na) - (sundaysUpTo(nb) - sundaysUpTo(na));
}

export function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function ymd(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** A schedule day 29-31 in a shorter month falls on the month's last day. */
export function clampedDate(y, m, d) {
  return ymd(y, m, Math.min(d, lastDayOfMonth(y, m)));
}

/**
 * Ageing (R5). Returns 'segar' | 'layu' | 'busuk', or null for cards that do not age.
 * Normal card: Segar before the due date; Layu from the due date (wiltLate working days late) until rotLate working
 * days late; Busuk from rotLate working days late. Hard card: Layu from hardLead working days before the due date;
 * Busuk from the calendar day after it.
 */
export function ageing(card, today, settings = DEFAULT_SETTINGS) {
  if (!AGEING_STATUSES.includes(card.status)) return null;
  const due = card.due;
  if (card.hard) {
    if (today > due) return 'busuk';
    if (workdaysBetween(today, due) <= settings.hardLead) return 'layu';
    return 'segar';
  }
  if (today < due) return 'segar';
  const late = workdaysBetween(due, today);
  if (late >= settings.rotLate) return 'busuk';
  if (late >= settings.wiltLate) return 'layu';
  return 'segar';
}

/** R6 + FX14: waiting on someone for more than 2 working days: in `tunggu` since waiting_since, or in `bukti`
 * (proof nobody confirms) since proof_at. */
export function isMacet(card, today) {
  const since = card.status === 'tunggu' ? card.waiting_since : card.status === 'bukti' ? card.proof_at : null;
  if (since == null) return false;
  return workdaysBetween(localDate(since), today) > 2;
}

/** R4: on time = the accepted proof's local date is on or before the due date. */
export function isOnTime(card) {
  if (card.status !== 'selesai' || card.proof_at == null) return false;
  return localDate(card.proof_at) <= card.due;
}

export function validSchedule(s) {
  if (!s || typeof s !== 'object') return false;
  const okDay = (d) => Number.isInteger(d) && d >= 1 && d <= 31;
  const okMonth = (m) => Number.isInteger(m) && m >= 1 && m <= 12;
  if (s.kind === 'monthly') return okDay(s.day);
  if (s.kind === 'quarterly') return Array.isArray(s.months) && s.months.length > 0 && s.months.length <= 12 && s.months.every(okMonth) && okDay(s.day);
  if (s.kind === 'yearly') return okMonth(s.month) && okDay(s.day);
  return false;
}

/** Candidate due dates of a schedule around `today` (previous, current and the next periods), sorted, unique. */
export function scheduleDues(schedule, today) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const out = new Set();
  if (schedule.kind === 'monthly') {
    for (let k = -1; k <= 13; k++) {
      const t = (y * 12 + (m - 1)) + k;
      out.add(clampedDate(Math.floor(t / 12), (t % 12) + 1, schedule.day));
    }
  } else if (schedule.kind === 'quarterly') {
    for (let yy = y - 1; yy <= y + 1; yy++) for (const mm of schedule.months) out.add(clampedDate(yy, mm, schedule.day));
  } else if (schedule.kind === 'yearly') {
    for (let yy = y - 1; yy <= y + 1; yy++) out.add(clampedDate(yy, schedule.month, schedule.day));
  }
  return [...out].sort();
}

/**
 * R10: the due dates whose card must exist on `today`: the card is created lead_days (calendar days) before the due
 * date. FX3: a due date whose whole window was missed (server off) is still created, as long as it is not earlier
 * than the day the routine was switched on or its date was last changed (active_since). How far back that reaches
 * follows scheduleDues: a monthly routine, the previous month; a quarterly or yearly routine, every listed date of
 * last year and this year.
 */
export function routineDuesToCreate(routine, today) {
  const lead = routine.lead_days | 0;
  const since = routine.active_since || null;
  return scheduleDues(routine.schedule, today).filter((due) => addDays(due, -lead) <= today && (today <= due || (since !== null && due >= since)));
}

export function routineKey(routineId, due) {
  return `${routineId}:${due}`;
}

export function median(nums) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function pct(num, den) {
  return den ? Math.round((num / den) * 1000) / 10 : null;
}
