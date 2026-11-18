const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
const DISCORD_MAX_TIMEOUT_MS = 28 * 86_400_000;

// "30m", "2h", "1d12h", "1w" -> milliseconds. Returns null for anything else.
function parseDuration(input) {
  const text = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!text || !/^(\d+[smhdw])+$/.test(text)) return null;
  let total = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+)([smhdw])/g)) total += Number(amount) * UNITS[unit];
  return total > 0 ? total : null;
}

// 5400000 -> "1h 30m"
function formatDuration(ms) {
  const parts = [];
  let rest = Math.round(ms / 1000);
  for (const [label, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    const n = Math.floor(rest / size);
    if (n) { parts.push(`${n}${label}`); rest -= n * size; }
  }
  return parts.slice(0, 3).join(' ') || '0s';
}

module.exports = { parseDuration, formatDuration, DISCORD_MAX_TIMEOUT_MS };
