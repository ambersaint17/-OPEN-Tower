// Plain-text table for the moderator stats card. Pure, so it is easy to test.
const TYPES = [
  ['warn', 'Warns'],
  ['timeout', 'Timeouts'],
  ['kick', 'Kicks'],
  ['ban', 'Bans'],
  ['unban', 'Unbans'],
  ['untimeout', 'Untimeouts'],
  ['note', 'Notes'],
];

const num = (v) => String(v ?? 0);

// rows: [{ type, d7, d30, total }]
function statsTable(rows) {
  const by = new Map(rows.map((r) => [r.type, r]));
  const lines = [`${'Action'.padEnd(11)}${'7d'.padStart(5)}${'30d'.padStart(6)}${'All'.padStart(6)}`];
  for (const [type, label] of TYPES) {
    const r = by.get(type) ?? {};
    lines.push(`${label.padEnd(11)}${num(r.d7).padStart(5)}${num(r.d30).padStart(6)}${num(r.total).padStart(6)}`);
  }
  return lines.join('\n');
}

function totals(rows) {
  return rows.reduce((acc, r) => ({
    d7: acc.d7 + (r.d7 ?? 0), d30: acc.d30 + (r.d30 ?? 0), total: acc.total + (r.total ?? 0),
  }), { d7: 0, d30: 0, total: 0 });
}

// The action a moderator uses most, or null.
function topAction(rows) {
  const best = [...rows].sort((a, b) => b.total - a.total)[0];
  if (!best || !best.total) return null;
  return TYPES.find(([type]) => type === best.type)?.[1] ?? best.type;
}

// Team view: one line per moderator.
function teamTable(rows) {
  const lines = [`${'Moderator'.padEnd(18)}${'Warn'.padStart(5)}${'TO'.padStart(4)}${'Kick'.padStart(5)}${'Ban'.padStart(4)}${'Total'.padStart(6)}`];
  for (const r of rows) {
    lines.push(`${String(r.tag).slice(0, 17).padEnd(18)}${num(r.warns).padStart(5)}${num(r.timeouts).padStart(4)}${num(r.kicks).padStart(5)}${num(r.bans).padStart(4)}${num(r.total).padStart(6)}`);
  }
  return lines.join('\n');
}

module.exports = { TYPES, statsTable, totals, topAction, teamTable };
