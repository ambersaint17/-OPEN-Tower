const path = require('node:path');
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { perks, colours } = require('../../constants');
const { normalize } = require('../moderation/permissions');
const L = require('../../lib/levels');

const roleKeys = Object.keys(perks).filter((k) => perks[k].role);
const asBits = (names) => new PermissionsBitField(names.map((n) => PermissionFlagsBits[n]));

// Perk roles are found by name (your existing ones first), never by position.
function findRole(guild, key) {
  const spec = perks[key].role;
  const wanted = new Set([spec.name, ...spec.aliases].filter(Boolean).map(normalize));
  return [...guild.roles.cache.values()].find((r) => !r.managed && wanted.has(normalize(r.name))) ?? null;
}

// New roles are tucked under the "LEVELS" divider, so they sit with your other level roles.
const levelsDivider = (guild) => [...guild.roles.cache.values()].find((r) => !r.managed && normalize(r.name) === 'levels') ?? null;

async function placeUnderDivider(guild, role) {
  const divider = levelsDivider(guild);
  if (divider) await role.setPosition(Math.max(1, divider.position - 1)).catch(() => {});
}

// The "Server Booster" role Discord makes. It is managed by Discord, so it is found by that flag as well as by its name.
const boosterRole = (guild) => guild.roles.premiumSubscriberRole
  ?? [...guild.roles.cache.values()].find((r) => r.managed && normalize(r.name) === 'serverbooster')
  ?? [...guild.roles.cache.values()].find((r) => normalize(r.name) === 'serverbooster') ?? null;

const byPosition = (guild) => [...guild.roles.cache.values()].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

// A booster's own colour has to sit above the Server Booster role. Role colours are taken from the highest role that has one,
// so below it the booster role's colour wins and theirs never shows. Without a Server Booster role it goes under the LEVELS divider as before.
async function placeAboveBooster(guild, role) {
  const anchor = boosterRole(guild);
  if (!anchor) { await placeUnderDivider(guild, role); return false; }
  for (let attempt = 0; attempt < 2; attempt++) {
    const sorted = byPosition(guild);
    const mine = sorted.findIndex((r) => r.id === role.id);
    const theirs = sorted.findIndex((r) => r.id === anchor.id);
    if (mine > theirs) return true;                                     // already above it
    // Discord moves a role to an index counted after the role itself is lifted out, so moving up means landing on the anchor's old index.
    await role.setPosition(mine < theirs ? theirs : theirs + 1, { reason: 'Tower: booster colour goes above the Server Booster role' }).catch(() => {});
  }
  return byPosition(guild).findIndex((r) => r.id === role.id) > byPosition(guild).findIndex((r) => r.id === anchor.id);
}

async function ensureRole(guild, key) {
  const existing = findRole(guild, key);
  if (existing) return existing;
  const spec = perks[key].role;
  if (!spec.create) return null; // the four starter roles are yours: Tower never invents them
  const role = await guild.roles.create({
    name: spec.name, color: spec.colour ?? null, hoist: Boolean(spec.hoist), mentionable: false,
    permissions: asBits(spec.permissions), reason: 'Tower level perk',
  });
  await placeUnderDivider(guild, role);
  // Role icons are a boost-level feature. Tower sets one on Elite as soon as the server can have it.
  if (key === 'elite' && guild.premiumTier >= 2) {
    await role.setIcon(path.join(__dirname, '..', '..', '..', 'assets', 'emojis', 'tower_crown.png')).catch(() => {});
  }
  return role;
}

// Which perk roles a member needs added or removed. Pure given the role lookup.
function plan({ level, booster, heldKeys, hasAdmin }) {
  const desired = new Set(L.desiredPerks(level, booster, perks));
  return {
    add: [...desired].filter((k) => !heldKeys.has(k)),
    remove: hasAdmin ? [] : roleKeys.filter((k) => heldKeys.has(k) && !desired.has(k)),
  };
}

const heldKeysOf = (guild, member) => new Set(roleKeys.filter((k) => {
  const role = findRole(guild, k);
  return role && member.roles.cache.has(role.id);
}));

// Gives a member the roles their level and boost status earn. Adds only, unless remove is set.
async function syncMember(member, level, { remove = false } = {}) {
  const { guild } = member;
  const booster = Boolean(member.premiumSince);
  const p = plan({
    level, booster, heldKeys: heldKeysOf(guild, member),
    hasAdmin: member.permissions.has(PermissionFlagsBits.Administrator),
  });
  const result = { added: [], removed: [], missing: [] };

  for (const key of p.add) {
    const role = await ensureRole(guild, key).catch((err) => { console.error('[perks] could not create role:', err.message); return null; });
    if (!role || !role.editable) { result.missing.push(perks[key].name); continue; }
    await member.roles.add(role, 'Tower: level perk').then(() => result.added.push(perks[key].name)).catch((err) => {
      console.error(`[perks] could not add ${perks[key].name}:`, err.message);
      result.missing.push(perks[key].name);
    });
  }
  if (remove) {
    for (const key of p.remove) {
      const role = findRole(guild, key);
      if (role?.editable) {
        await member.roles.remove(role, 'Tower: level perk no longer earned').then(() => result.removed.push(perks[key].name)).catch(() => {});
      }
    }
  }
  return result;
}

// What a sync would change for everyone, without changing anything. levelOf(userId) gives their level.
function previewGuild(guild, members, levelOf, { removeExtra = false } = {}) {
  const out = { members: 0, add: 0, remove: 0, rolesToCreate: [], sample: [] };
  for (const key of roleKeys) {
    if (perks[key].role.create && !findRole(guild, key)) out.rolesToCreate.push(perks[key].role.name);
  }
  for (const member of members) {
    if (member.user.bot) continue;
    const p = plan({
      level: levelOf(member.id), booster: Boolean(member.premiumSince), heldKeys: heldKeysOf(guild, member),
      hasAdmin: member.permissions.has(PermissionFlagsBits.Administrator),
    });
    if (!removeExtra) p.remove = [];
    if (!p.add.length && !p.remove.length) continue;
    out.members++; out.add += p.add.length; out.remove += p.remove.length;
    if (out.sample.length < 8) out.sample.push({ id: member.id, add: p.add.map((k) => perks[k].name), remove: p.remove.map((k) => perks[k].name) });
  }
  return out;
}

// ---------- permission audit ----------
// Perks only mean something if @everyone does NOT already have the permission they grant.
// everyone and role are Sets of permission names. Pure, so it is tested.
function auditPerk(key, everyone, role) {
  const needed = perks[key].role.permissions;
  const issues = [];
  const leaked = needed.filter((p) => everyone.has(p));
  if (leaked.length) issues.push({ type: 'everyone', perms: leaked });
  if (role) {
    const lacking = needed.filter((p) => !role.has(p));
    if (lacking.length) issues.push({ type: 'role', perms: lacking });
  }
  return issues;
}

const permNames = (bits) => new Set(Object.keys(PermissionFlagsBits).filter((n) => bits.has(PermissionFlagsBits[n])));

function auditGuild(guild) {
  const everyone = permNames(guild.roles.everyone.permissions);
  return roleKeys.filter((k) => perks[k].role.permissions.length).map((key) => {
    const role = findRole(guild, key);
    return { key, name: perks[key].name, role, issues: auditPerk(key, everyone, role ? permNames(role.permissions) : null) };
  });
}

async function fixRolePermissions(role, key) {
  await role.setPermissions(role.permissions.add(asBits(perks[key].role.permissions)), 'Tower: perk permissions');
}

// ---------- name colours ----------

const colourRoleName = (c) => `Colour | ${c.label}`;
const isColourRole = (r) => r.name.startsWith('Colour | ');

async function ensureColourRole(guild, key) {
  const c = colours.find((x) => x.key === key);
  const existing = [...guild.roles.cache.values()].find((r) => r.name === colourRoleName(c));
  if (existing) return existing;
  const role = await guild.roles.create({ name: colourRoleName(c), color: c.hex, mentionable: false, reason: 'Tower name colour' });
  await placeUnderDivider(guild, role);
  return role;
}

// Gives exactly one colour role (or none) and returns the role id that was set.
async function setColour(member, key) {
  const guild = member.guild;
  const current = [...member.roles.cache.values()].filter(isColourRole);
  const role = key ? await ensureColourRole(guild, key) : null;
  for (const r of current) if (!role || r.id !== role.id) await member.roles.remove(r, 'Tower name colour').catch(() => {});
  if (role && !member.roles.cache.has(role.id)) await member.roles.add(role, 'Tower name colour');
  return role?.id ?? null;
}

module.exports = {
  roleKeys, findRole, ensureRole, plan, syncMember, previewGuild, auditPerk, auditGuild, fixRolePermissions,
  setColour, colourRoleName, isColourRole, placeUnderDivider, placeAboveBooster, boosterRole,
};
