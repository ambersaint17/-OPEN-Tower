const crypto = require('node:crypto');
const { moderation } = require('../../constants');

// Bans wait here for a confirmation button press. Memory only: a restart simply cancels them.
const pending = new Map();

function add(data, clock = Date.now) {
  const token = crypto.randomBytes(6).toString('hex');
  pending.set(token, { ...data, expiresAt: clock() + moderation.banConfirmMs });
  return token;
}

// Returns the pending action only for the moderator who started it, and only once.
function take(token, moderatorId, clock = Date.now) {
  const entry = pending.get(token);
  if (!entry || entry.moderatorId !== moderatorId) return null;
  pending.delete(token);
  return entry.expiresAt < clock() ? null : entry;
}

function drop(token) {
  pending.delete(token);
}

module.exports = { add, take, drop, _size: () => pending.size, _clear: () => pending.clear() };
