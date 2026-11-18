// Pure logic for giveaways: durations, requirements, entry weights and picking winners. No Discord calls in here.
const L = require('./levels');

const DAY = 24 * 60 * 60 * 1000;
const UNIT_MS = { w: 7 * DAY, d: DAY, h: 60 * 60 * 1000, m: 60 * 1000 };
const nf = (n) => Number(n).toLocaleString('en-US');

// "90m", "2h", "3d", "1w", "1d12h" -> milliseconds, or null when it cannot be read.
function parseDuration(text) {
  const t = String(text ?? '').toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[wdhm])+$/.test(t)) return null;
  let total = 0;
  for (const [, n, unit] of t.matchAll(/(\d+)([wdhm])/g)) total += Number(n) * UNIT_MS[unit];
  return total > 0 ? total : null;
}

const posInt = (v, max) => (Number.isInteger(v) && v >= 1 ? Math.min(v, max) : undefined);

// Only requirements that are actually set are kept.
function cleanRequirements(raw = {}) {
  const out = {};
  const xp = posInt(raw.minXp, 100_000_000); if (xp) out.minXp = xp;
  const level = posInt(raw.minLevel, L.MAX_LEVEL); if (level) out.minLevel = level;
  if (/^\d{17,20}$/.test(String(raw.roleId ?? ''))) out.roleId = String(raw.roleId);
  if (raw.booster === true) out.booster = true;
  const days = posInt(raw.minDays, 3650); if (days) out.minDays = days;
  return out;
}
const hasRequirements = (req) => Object.keys(cleanRequirements(req)).length > 0;

// facts: { xp, level, roleIds (array or Set), booster, joinedAt (ms), now }
function evaluate(requirements, facts) {
  const req = cleanRequirements(requirements);
  const roles = facts.roleIds instanceof Set ? facts.roleIds : new Set(facts.roleIds ?? []);
  const now = facts.now ?? Date.now();
  const checks = [];
  if (req.minXp) checks.push({ key: 'xp', need: `${nf(req.minXp)} XP`, have: `${nf(facts.xp ?? 0)} XP`, ok: (facts.xp ?? 0) >= req.minXp });
  if (req.minLevel) checks.push({ key: 'level', need: `Level ${req.minLevel}`, have: `Level ${facts.level ?? 0}`, ok: (facts.level ?? 0) >= req.minLevel });
  if (req.roleId) checks.push({ key: 'role', need: 'the required role', have: roles.has(req.roleId) ? 'has it' : 'does not have it', ok: roles.has(req.roleId), roleId: req.roleId });
  if (req.booster) checks.push({ key: 'booster', need: 'Server Booster', have: facts.booster ? 'boosting' : 'not boosting', ok: Boolean(facts.booster) });
  if (req.minDays) {
    const days = facts.joinedAt ? Math.max(0, Math.floor((now - facts.joinedAt) / DAY)) : 0;
    checks.push({ key: 'days', need: `${req.minDays} ${req.minDays === 1 ? 'day' : 'days'} in the server`, have: `${days} ${days === 1 ? 'day' : 'days'}`, ok: days >= req.minDays });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

// Human-readable requirement lines for the giveaway card. roleText turns a role ID into a mention or a name.
function requirementLines(requirements, roleText = (id) => `<@&${id}>`) {
  const req = cleanRequirements(requirements);
  const lines = [];
  if (req.minXp) lines.push(`At least **${nf(req.minXp)} XP**`);
  if (req.minLevel) lines.push(`**Level ${req.minLevel}** or higher`);
  if (req.roleId) lines.push(`The ${roleText(req.roleId)} role`);
  if (req.booster) lines.push('**Server Booster** only');
  if (req.minDays) lines.push(`In the server for **${req.minDays}+ ${req.minDays === 1 ? 'day' : 'days'}**`);
  return lines;
}

// How many entries a member gets, and why. The numbers come from the level and booster perks.
function entryBreakdown(level, booster) {
  const parts = ['1 base entry'];
  if (level >= L.perkLevel('giveaway')) parts.push(`+1 Giveaway Bonus (level ${L.perkLevel('giveaway')})`);
  if (level >= L.perkLevel('elite')) parts.push(`+1 Elite (level ${L.perkLevel('elite')})`);
  if (booster) parts.push('x2 Server Booster');
  return { total: L.giveawayEntries(level, booster), parts };
}

// Picks distinct winners; a member with more entries is proportionally more likely.
function pickWinners(pool, count, rng = Math.random) {
  const left = pool.filter((p) => p.weight > 0).map((p) => ({ ...p }));
  const winners = [];
  while (winners.length < count && left.length) {
    const total = left.reduce((sum, p) => sum + p.weight, 0);
    let roll = rng() * total; let index = left.length - 1;
    for (let i = 0; i < left.length; i++) { roll -= left[i].weight; if (roll < 0) { index = i; break; } }
    winners.push(left[index].id);
    left.splice(index, 1);
  }
  return winners;
}

module.exports = { parseDuration, cleanRequirements, hasRequirements, evaluate, requirementLines, entryBreakdown, pickWinners, DAY };
