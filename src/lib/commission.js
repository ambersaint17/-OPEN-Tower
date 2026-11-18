// Pure logic for commissions: statuses, dates, ratings. No Discord or database calls in here.
const { parseDuration } = require('./giveaway');

// The order a commission normally moves through. Any status can be set at any time.
const STATUSES = [
  { key: 'quoted', label: 'Quoted', client: 'A quote was sent. Waiting for your answer.' },
  { key: 'accepted', label: 'Accepted', client: 'The quote is accepted. Work will start soon.' },
  { key: 'in_progress', label: 'In Progress', client: 'Work has started.' },
  { key: 'review', label: 'In Review', client: 'A preview is ready for your feedback.' },
  { key: 'delivered', label: 'Delivered', client: 'The finished work has been delivered.' },
  { key: 'completed', label: 'Completed', client: 'All done. Thank you for your order!' },
  { key: 'on_hold', label: 'On Hold', client: 'This is paused for now. You will be told when it continues.' },
  { key: 'cancelled', label: 'Cancelled', client: 'This commission was cancelled.' },
];
const CLOSED = new Set(['completed', 'cancelled']);

const statusInfo = (key) => STATUSES.find((s) => s.key === key) ?? { key, label: String(key), client: '' };
const isClosed = (key) => CLOSED.has(key);

// "none", "5d", "2w", "36h", "2026-12-24" or "2026-12-24 18:00" (UTC).
// A Date, null (no deadline), or undefined when it cannot be read.
function parseWhen(text, now = Date.now()) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return undefined;
  if (['none', 'off', 'clear', 'remove'].includes(t)) return null;
  const ms = parseDuration(t);
  if (ms) return new Date(now + ms);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{2}):(\d{2}))?$/.exec(t);
  if (!m) return undefined;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), h === undefined ? 23 : Number(h), mi === undefined ? 59 : Number(mi)));
  const valid = date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d);
  return valid && !Number.isNaN(date.getTime()) ? date : undefined;
}

// "in 2 days", "in 5 hours", "overdue by 1 day": for messages that cannot use Discord's live timestamps.
function relativeText(deadline, now = Date.now()) {
  const diff = new Date(deadline).getTime() - now;
  const abs = Math.abs(diff);
  const unit = abs >= 86_400_000 ? [Math.round(abs / 86_400_000), 'day'] : abs >= 3_600_000 ? [Math.round(abs / 3_600_000), 'hour'] : [Math.max(1, Math.round(abs / 60_000)), 'minute'];
  const text = `${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'}`;
  return diff >= 0 ? `in ${text}` : `overdue by ${text}`;
}

// A rating typed as "4", "4/5", "4 stars" or "★★★★". Null when it is not 1 to 5.
function parseRating(text) {
  const t = String(text ?? '').trim();
  const stars = (t.match(/★/g) ?? []).length;
  if (stars && /^[★☆\s]+$/.test(t)) return stars >= 1 && stars <= 5 ? stars : null;
  const m = /^(\d)(?:\s*\/\s*5|\s*stars?)?$/i.exec(t);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 5 ? n : null;
}
const stars = (rating) => '★'.repeat(rating) + '☆'.repeat(5 - rating);

// Adds to a list that keeps only the newest `max` entries.
const pushLog = (list, entry, max) => [...(Array.isArray(list) ? list : []), entry].slice(-max);

const shape = (row) => row && {
  ...row, id: Number(row.id), notes: Array.isArray(row.notes) ? row.notes : [], history: Array.isArray(row.history) ? row.history : [],
};

module.exports = { STATUSES, statusInfo, isClosed, parseWhen, relativeText, parseRating, stars, pushLog, shape };
