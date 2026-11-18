const { qotd } = require('../constants');
const { clip } = require('./text');
const { normalize } = require('../modules/moderation/permissions');

const MANAGERS = new Set(qotd.managerRoles.map(normalize));

// "+05:30", "-4", "5:30" -> minutes from UTC, or null
function parseOffset(text) {
  const m = /^([+-])?(\d{1,2})(?::?(\d{2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const value = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  return Math.abs(value) <= 14 * 60 ? value : null;
}

function localParts(nowMs, offsetMin) {
  const d = new Date(nowMs + offsetMin * 60_000);
  return { day: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

// Returns today's date (in the server's chosen timezone) when the question is due and not yet posted.
function dueDay({ hour, minute, offsetMin, lastDay }, nowMs) {
  const { day, minutes } = localParts(nowMs, offsetMin);
  return minutes >= hour * 60 + minute && lastDay !== day ? day : null;
}

const threadName = (number, question) => clip(`QOTD #${number} | ${question}`, 100);

// Community Engagement Team roles, plus Administrator and up (level 4).
const isManager = (roleNames, level) => level >= 4 || roleNames.some((n) => MANAGERS.has(normalize(n)));

module.exports = { parseOffset, localParts, dueDay, threadName, isManager };
