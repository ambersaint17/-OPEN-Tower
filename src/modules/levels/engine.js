const { levels, perks } = require('../../constants');
const L = require('../../lib/levels');
const { computeDefaults, evaluate } = require('./rules');
const service = require('./service');
const perkSync = require('./perks');
const notify = require('./notify');

// Live numbers for members who are chatting. Messages never touch the database: totals are written in
// batches, and the text of messages is never stored at all.
const active = new Map();   // "guild:user" -> entry
const configs = new Map();  // guildId -> { state, at }
const events = new Map();   // guildId -> { multiplier, endsAt }
const CONFIG_TTL = 5 * 60_000;

const keyOf = (guildId, userId) => `${guildId}:${userId}`;

function blankEntry(guildId, userId, row) {
  const xp = Number(row?.xp ?? 0);
  return {
    guildId, userId, xp, level: L.levelFromXp(xp), streak: row?.streak ?? 0, lastDay: row?.last_day ?? null,
    shieldUsedAt: row?.shield_used_at ?? null, colourRoleId: row?.colour_role_id ?? null, dm: row?.dm_levelups ?? true,
    lastGainAt: 0, lastText: '', dayKey: null, dayBase: 0, dirty: false, touched: Date.now(),
  };
}

// For /level: reads the live entry if there is one, and never caches strangers.
async function peek(guildId, userId) {
  return active.get(keyOf(guildId, userId)) ?? blankEntry(guildId, userId, await service.getMember(guildId, userId));
}

async function entryFor(guildId, userId) {
  const key = keyOf(guildId, userId);
  const cached = active.get(key);
  if (cached) { cached.touched = Date.now(); return cached; }
  const entry = blankEntry(guildId, userId, await service.getMember(guildId, userId));
  return active.get(key) ?? (active.set(key, entry), entry); // another message may have loaded it meanwhile
}

// ---------- configuration ----------

function channelList(guild) {
  return [...guild.channels.cache.values()]
    .filter((c) => c.type !== 4 && c.type !== 2 && c.type !== 13) // not categories, voice or stage
    .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
}

async function buildConfig(guild) {
  const rows = await service.loadRules(guild.id);
  const state = {
    explicit: new Map(), defaults: computeDefaults(channelList(guild)), ignoredRoles: new Set(),
    channelMultipliers: new Map(), roleMultipliers: new Map(), rows,
  };
  for (const r of rows) {
    const mult = Number(r.multiplier);
    if (r.kind === 'role' && r.mode === 'ignore') state.ignoredRoles.add(r.target_id);
    else if (r.kind === 'role' && r.mode === 'multiplier') state.roleMultipliers.set(r.target_id, mult);
    else if (r.kind === 'channel' && r.mode === 'multiplier') state.channelMultipliers.set(r.target_id, mult);
    else if (r.kind === 'channel') state.explicit.set(r.target_id, r.mode);
  }
  configs.set(guild.id, { state, at: Date.now() });
  return state;
}

async function configFor(guild) {
  const c = configs.get(guild.id);
  return c && Date.now() - c.at < CONFIG_TTL ? c.state : buildConfig(guild);
}

const refreshConfig = (guild) => buildConfig(guild);

// ---------- timed events ----------

async function loadEvent(guildId) {
  const row = await service.activeEvent(guildId);
  if (row) events.set(guildId, { multiplier: Number(row.multiplier), endsAt: new Date(row.ends_at).getTime() });
  else events.delete(guildId);
}

function activeEvent(guildId, now = Date.now()) {
  const e = events.get(guildId);
  return e && e.endsAt > now ? e : null;
}

// ---------- earning XP ----------

const CLEAN = /<a?:\w+:\d+>|<[@#&!]+\d+>|https?:\/\/\S+/g;

function contextOf(message) {
  const ch = message.channel;
  const isThread = typeof ch.isThread === 'function' && ch.isThread();
  const ids = isThread ? [ch.id, ch.parentId, ch.parent?.parentId] : [ch.id, ch.parentId];
  return { ids: ids.filter(Boolean), roleIds: message.member ? [...message.member.roles.cache.keys()] : [] };
}

// Everything that multiplies a message's XP, and what each part is.
function multipliers({ verdict, event, booster, streak }) {
  return {
    channelOrRole: verdict.multiplier,
    booster: booster ? levels.booster.multiplier : 1,
    event: event?.multiplier ?? 1,
    streak: 1 + L.streakBonus(streak),
  };
}

async function onMessage(message, now = Date.now()) {
  const { guild, member, author } = message;
  if (!guild || author.bot || message.system || message.webhookId) return;
  const text = message.content.replace(CLEAN, '').trim();
  if (text.length < levels.xp.minLength) return;

  const verdict = evaluate(contextOf(message), await configFor(guild));
  if (verdict.ignored) return;

  const entry = await entryFor(guild.id, author.id);
  if (now - entry.lastGainAt < levels.xp.cooldownMs) return;
  const normalised = text.toLowerCase().replace(/\s+/g, ' ');
  if (normalised === entry.lastText && now - entry.lastGainAt < 5 * 60_000) return; // repeats earn nothing

  const today = L.dayKey(now);
  if (entry.dayKey !== today) { entry.dayKey = today; entry.dayBase = 0; }
  const step = L.streakStep(entry, today, now, entry.level >= L.perkLevel('shield'));
  entry.streak = step.streak; entry.lastDay = today; entry.shieldUsedAt = step.shieldUsedAt;

  // The daily soft cap applies to the base XP, so boosts and events still feel like boosts.
  const base = L.applySoftCap(entry.dayBase, L.rollXp());
  entry.dayBase += base;
  const m = multipliers({ verdict, event: activeEvent(guild.id, now), booster: Boolean(member?.premiumSince), streak: entry.streak });
  entry.xp += Math.max(1, Math.round(base * m.channelOrRole * m.booster * m.event * m.streak));
  entry.lastGainAt = now; entry.lastText = normalised; entry.dirty = true; entry.touched = now;

  const level = L.levelFromXp(entry.xp);
  if (level > entry.level) {
    const from = entry.level;
    entry.level = level;
    if (member) {
      perkSync.syncMember(member, level).catch((err) => console.error('[levels] perk sync failed:', err.message));
      notify.levelUp(member, from, level, entry).catch(() => {});
    }
  }
}

// Bonus XP from something other than chatting, such as answering the question of the day.
async function awardBonus(guild, userId, amount) {
  const entry = await entryFor(guild.id, userId);
  entry.xp += amount; entry.dirty = true;
  const level = L.levelFromXp(entry.xp);
  if (level > entry.level) {
    entry.level = level;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await perkSync.syncMember(member, level).catch(() => {});
  }
  return entry;
}

// Staff change a member's XP directly. Roles are corrected both ways afterwards.
async function setXp(guild, userId, xp) {
  const entry = await entryFor(guild.id, userId);
  entry.xp = Math.max(0, Math.round(xp));
  entry.level = L.levelFromXp(entry.xp);
  entry.dirty = true;
  await flush();
  const member = await guild.members.fetch(userId).catch(() => null);
  const sync = member ? await perkSync.syncMember(member, entry.level, { remove: true }) : null;
  return { entry, sync };
}

// Adding or removing whole levels moves a member to the start of the new level.
const shiftLevels = (guild, userId, delta, current) =>
  setXp(guild, userId, L.xpForLevel(Math.max(0, Math.min(L.MAX_LEVEL, current.level + delta))));

async function setDm(guildId, userId, on) {
  await service.setDm(guildId, userId, on);
  const live = active.get(keyOf(guildId, userId));
  if (live) live.dm = on;
}

async function setColourRole(guildId, userId, roleId) {
  const entry = await entryFor(guildId, userId);
  entry.colourRoleId = roleId; entry.dirty = true;
}

// ---------- saving, leaving, housekeeping ----------

async function flush(now = Date.now()) {
  const dirty = [...active.values()].filter((e) => e.dirty);
  for (let i = 0; i < dirty.length; i += 20) {
    await Promise.all(dirty.slice(i, i + 20).map(async (e) => {
      e.dirty = false; // anything earned during the write marks it dirty again
      try { await service.saveMember(e); } catch (err) { e.dirty = true; console.error('[levels] save failed:', err.message); }
    }));
  }
  for (const [key, e] of active) if (!e.dirty && now - e.touched > levels.idleMs) active.delete(key);
  return dirty.length;
}

// Leaving removes all XP straight away.
async function forget(guildId, userId) {
  active.delete(keyOf(guildId, userId));
  await service.deleteMember(guildId, userId);
}

// If Tower was offline when someone left, their XP is removed now.
async function cleanupMissing(guild) {
  const known = await service.allXp(guild.id);
  let removed = 0;
  for (const userId of known.keys()) {
    if (!guild.members.cache.has(userId)) { await forget(guild.id, userId); removed++; }
  }
  return removed;
}

function start(client) {
  setInterval(() => flush().catch((err) => console.error('[levels] flush failed:', err.message)), levels.flushMs).unref();
  const stop = async () => { await flush(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

module.exports = {
  peek, entryFor, onMessage, awardBonus, setXp, shiftLevels, setDm, setColourRole, flush, forget, cleanupMissing, start,
  configFor, refreshConfig, loadEvent, activeEvent, multipliers,
  _active: active,
};
