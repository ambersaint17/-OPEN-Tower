const { dividers: cfg, perks } = require('../../constants');
const { norm, nameMatches, plan } = require('../../lib/dividers');
const { fetchAll } = require('../../lib/members');

const perkNames = Object.values(perks).filter((p) => p.role).flatMap((p) => [p.role.name, ...(p.role.aliases ?? [])]).filter(Boolean);

// The sections, as the planner wants them.
const groups = cfg.groups.map((g) => ({
  key: g.key, dividerNames: g.dividerNames,
  matches: g.levelPerkRoles
    ? (role) => perkNames.some((n) => norm(role.name) === norm(n)) || role.name.startsWith('Colour | ')
    : (role) => nameMatches(role.name, g.roles),
}));

const rolesOf = (guild) => [...guild.roles.cache.values()].map((r) => ({ id: r.id, name: r.name, managed: r.managed }));

// Makes one member's divider roles match the roles they hold. Returns how many roles were added and removed.
async function syncMember(member) {
  if (member.user.bot) return { added: 0, removed: 0 };
  const { add, remove } = plan({ guildRoles: rolesOf(member.guild), memberRoleIds: new Set(member.roles.cache.keys()), groups });
  try {
    if (add.length) await member.roles.add(add, 'Tower: section divider');
    if (remove.length) await member.roles.remove(remove, 'Tower: section divider');
  } catch (err) {
    warn(member.guild.id, err.message);
    return { added: 0, removed: 0, failed: true };
  }
  return { added: add.length, removed: remove.length };
}

// One warning per server every ten minutes, so a role-order problem does not flood the console.
const warned = new Map();
function warn(guildId, message) {
  if (Date.now() - (warned.get(guildId) ?? 0) < 10 * 60_000) return;
  warned.set(guildId, Date.now());
  console.warn(`[dividers] could not change a divider role: ${message}. Tower's role must sit above the divider roles.`);
}

// A burst of changes (onboarding gives several roles at once) is handled once, shortly after the last one.
const timers = new Map();
function schedule(member) {
  if (!member || member.user?.bot) return;
  const key = `${member.guild.id}:${member.id}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    const fresh = member.guild.members.cache.get(member.id) ?? member;
    syncMember(fresh).catch((err) => console.error('[dividers]', err.message));
  }, cfg.syncDelayMs).unref());
}

// Everyone, one at a time, pausing between changes so Discord's rate limits are respected.
async function syncGuild(guild, { pauseMs = 350 } = {}) {
  const members = await fetchAll(guild, { fresh: true });
  const totals = { checked: 0, changed: 0, added: 0, removed: 0, failed: 0 };
  for (const member of members.values()) {
    if (member.user.bot) continue;
    totals.checked++;
    const result = await syncMember(member);
    if (result.failed) totals.failed++;
    if (result.added || result.removed) {
      totals.changed++; totals.added += result.added; totals.removed += result.removed;
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
  return totals;
}

// For /dividers status: each section with its divider role, and whether Tower can actually move it.
function status(guild) {
  const all = rolesOf(guild);
  const top = guild.members.me?.roles.highest.position ?? 0;
  return groups.map((g) => {
    const wanted = new Set(g.dividerNames.map(norm));
    const found = all.find((r) => !r.managed && wanted.has(norm(r.name)));
    const role = found && guild.roles.cache.get(found.id);
    return { key: g.key, roleId: found?.id ?? null, tooHigh: Boolean(role && role.position >= top), names: g.dividerNames };
  });
}

module.exports = { syncMember, syncGuild, schedule, status, groups };
