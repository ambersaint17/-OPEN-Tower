// 7260 -> "2h 1m", 45 -> "45s", null -> "n/a"
function formatSeconds(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return 'n/a';
  let rest = Math.round(seconds);
  const parts = [];
  for (const [label, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    const n = Math.floor(rest / size);
    if (n) { parts.push(`${n}${label}`); rest -= n * size; }
  }
  return parts.slice(0, 2).join(' ') || '0s';
}

module.exports = { formatSeconds };
