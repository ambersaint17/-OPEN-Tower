const { moderation } = require('../../constants');

const normalize = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
const RANKS = new Map(moderation.ranks.map((r) => [normalize(r.role), r.level]));

// Owner is 5, anyone with Discord's Administrator permission is at least 4,
// otherwise the highest matching staff role. 0 means "not staff".
function levelFor(roleNames, { isOwner = false, isAdmin = false } = {}) {
  if (isOwner) return 5;
  let level = isAdmin ? 4 : 0;
  for (const name of roleNames) level = Math.max(level, RANKS.get(normalize(name)) ?? 0);
  return level;
}

const can = (level, action) => level >= (moderation.actionLevel[action] ?? 99);
const maxTimeoutMs = (level) => moderation.maxTimeoutMs[Math.min(level, 5)] ?? 0;

function rankLabel(level) {
  if (level >= 5) return 'Owner';
  if (level <= 0) return 'No staff rank';
  const top = [...moderation.ranks].filter((r) => r.level <= level).sort((a, b) => b.level - a.level)[0];
  return top ? top.role : 'Staff';
}

module.exports = { levelFor, can, maxTimeoutMs, rankLabel, normalize };
