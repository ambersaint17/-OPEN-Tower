const { levels } = require('../../constants');
const service = require('./service');
const perkSync = require('./perks');
const engine = require('./engine');
const { fetchAll } = require('../../lib/members');

const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;
const ANNIVERSARY_PREFIX = 'Booster | ';
const PERSONAL_PREFIX = 'Boost | ';

const monthsBoosted = (sinceMs, now = Date.now()) => Math.max(0, Math.floor((now - sinceMs) / MONTH_MS));

// The highest anniversary a booster has reached, or null before the first.
const pickAnniversary = (months) => [...levels.booster.anniversaryMonths].reverse().find((m) => months >= m) ?? null;

const anniversaryLabel = (m) => (m >= 12 ? `${Math.floor(m / 12)} Year${m >= 24 ? 's' : ''}` : `${m} Month${m === 1 ? '' : 's'}`);
const anniversaryRoleName = (m) => `${ANNIVERSARY_PREFIX}${anniversaryLabel(m)}`;

// "#ff5c8a", "ff5c8a" -> number, anything else -> null
function parseHex(input) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(input).trim());
  return m ? parseInt(m[1], 16) : null;
}

const isAnniversaryRole = (r) => r.name.startsWith(ANNIVERSARY_PREFIX);

async function ensureAnniversaryRole(guild, months) {
  const name = anniversaryRoleName(months);
  const existing = [...guild.roles.cache.values()].find((r) => r.name === name);
  if (existing) return existing;
  const role = await guild.roles.create({ name, color: 0xd660eb, mentionable: false, reason: 'Tower booster anniversary' });
  await perkSync.placeUnderDivider(guild, role);
  return role;
}

async function applyAnniversary(member, now = Date.now()) {
  const months = member.premiumSince ? pickAnniversary(monthsBoosted(member.premiumSinceTimestamp, now)) : null;
  const wanted = months ? await ensureAnniversaryRole(member.guild, months) : null;
  for (const role of [...member.roles.cache.values()].filter(isAnniversaryRole)) {
    if (!wanted || role.id !== wanted.id) await member.roles.remove(role, 'Tower booster anniversary').catch(() => {});
  }
  if (wanted && !member.roles.cache.has(wanted.id)) await member.roles.add(wanted, 'Tower booster anniversary').catch(() => {});
}

// ---------- a booster's personal colour ----------

async function setPersonalColour(member, hex) {
  const { guild } = member;
  const name = `${PERSONAL_PREFIX}${member.displayName}`.slice(0, 100);
  const roleId = await service.getBoosterRole(guild.id, member.id);
  let role = roleId ? guild.roles.cache.get(roleId) : null;
  if (role) {
    await role.edit({ name, color: hex, reason: 'Tower booster colour' });
  } else {
    role = await guild.roles.create({ name, color: hex, mentionable: false, reason: 'Tower booster colour' });
    await service.setBoosterRole(guild.id, member.id, role.id);
  }
  await perkSync.placeAboveBooster(guild, role);       // every time, so roles made before this rule get moved too
  if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Tower booster colour');
  return role;
}

async function removePersonalColour(guild, userId) {
  const roleId = await service.getBoosterRole(guild.id, userId);
  if (!roleId) return false;
  await guild.roles.cache.get(roleId)?.delete('Tower: boost ended').catch(() => {});
  await service.deleteBoosterRole(guild.id, userId);
  return true;
}

// ---------- boost starts and ends ----------

// A booster's personal colour role is kept above the Server Booster role, wherever it was before.
async function ensurePersonalPlacement(member) {
  const roleId = await service.getBoosterRole(member.guild.id, member.id);
  const role = roleId && member.guild.roles.cache.get(roleId);
  if (role) await perkSync.placeAboveBooster(member.guild, role);
}

async function whenBoosting(member) {
  const entry = await engine.peek(member.guild.id, member.id);
  await perkSync.syncMember(member, entry.level);   // the instant perks
  await applyAnniversary(member);
  await ensurePersonalPlacement(member);
}

async function whenEnded(member) {
  const entry = await engine.peek(member.guild.id, member.id);
  await removePersonalColour(member.guild, member.id);
  await applyAnniversary(member);                    // removes the anniversary role
  await perkSync.syncMember(member, entry.level, { remove: true }); // keeps only what their level earned
}

function onBoostChange(oldMember, newMember) {
  if (!oldMember.premiumSince && newMember.premiumSince) return whenBoosting(newMember);
  if (oldMember.premiumSince && !newMember.premiumSince) return whenEnded(newMember);
  return null;
}

// Catches boosts that started or ended while Tower was offline, and moves anniversaries forward.
async function sweep(guild) {
  const members = await fetchAll(guild);
  let changed = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    try {
      if (member.premiumSince) { await whenBoosting(member); changed++; }
      else if ([...member.roles.cache.values()].some(isAnniversaryRole) || await service.getBoosterRole(guild.id, member.id)) {
        await whenEnded(member); changed++;
      }
    } catch (err) {
      console.error(`[boosters] ${member.user.tag}:`, err.message);
    }
  }
  return changed;
}

const onLeave = (member) => removePersonalColour(member.guild, member.id);

module.exports = {
  monthsBoosted, pickAnniversary, anniversaryLabel, anniversaryRoleName, parseHex,
  setPersonalColour, removePersonalColour, ensurePersonalPlacement, onBoostChange, sweep, onLeave,
};
