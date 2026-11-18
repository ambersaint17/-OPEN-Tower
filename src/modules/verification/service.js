const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');
const sql = require('../../db');
const config = require('../../config');
const { tiers, verification } = require('../../constants');
const { generateCode, hashCode, matches } = require('../../lib/codes');
const { renderCaptcha } = require('../../lib/captcha');
const { assessAccount } = require('../../lib/risk');
const { createTtlCache } = require('../../lib/ttlcache');
const { pool } = require('./pool');
const { fetchAll } = require('../../lib/members');

// ---------- settings ----------

// Settings are read on every button press and almost never change, so they are cached briefly.
// Every function in this file that writes them clears the cache first.
const settingsCache = createTtlCache(30_000);
async function getSettings(guildId) {
  const hit = settingsCache.get(guildId);
  if (hit !== undefined) return hit;
  const [row] = await sql`select * from guild_settings where guild_id = ${guildId}`;
  return settingsCache.set(guildId, row ?? null);
}

async function saveSettings(guildId, v) {
  settingsCache.delete(guildId);
  const [row] = await sql`
    insert into guild_settings
      (guild_id, verification_enabled, verify_channel_id, log_channel_id, unverified_role_id, verified_role_id, enabled_at)
    values
      (${guildId}, true, ${v.verifyChannelId}, ${v.logChannelId}, ${v.unverifiedRoleId}, ${v.verifiedRoleId}, ${new Date()})
    on conflict (guild_id) do update set
      verification_enabled = true,
      verify_channel_id    = excluded.verify_channel_id,
      log_channel_id       = excluded.log_channel_id,
      unverified_role_id   = excluded.unverified_role_id,
      verified_role_id     = excluded.verified_role_id,
      enabled_at           = coalesce(guild_settings.enabled_at, excluded.enabled_at),
      updated_at           = now()
    returning *`;
  return row;
}

async function savePanel(guildId, channelId, messageId) {
  settingsCache.delete(guildId);
  await sql`update guild_settings set panel_channel_id = ${channelId}, panel_message_id = ${messageId}, updated_at = now()
            where guild_id = ${guildId}`;
}

// Returns true only for the call that actually flipped the switch, so two
// simultaneous triggers cannot both announce the same raid.
async function setRaidMode(guildId, on) {
  settingsCache.delete(guildId);
  const rows = await sql`
    update guild_settings
    set raid_mode = ${on}, raid_started_at = ${on ? new Date() : null}, updated_at = now()
    where guild_id = ${guildId} and raid_mode = ${!on}
    returning guild_id`;
  return rows.length > 0;
}

// ---------- strikes and cooldowns ----------

async function getState(guildId, userId) {
  const [row] = await sql`
    select strikes, locked_until, updated_at from verification_state
    where guild_id = ${guildId} and user_id = ${userId}`;
  if (!row) return { strikes: 0, lockedUntil: null };
  const stale = Date.now() - row.updated_at.getTime() > verification.strikeResetMs;
  return { strikes: stale ? 0 : row.strikes, lockedUntil: row.locked_until };
}

async function registerStrike(guildId, userId, cooldownMs) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + cooldownMs);
  const staleCutoff = new Date(now.getTime() - verification.strikeResetMs);
  const [row] = await sql`
    insert into verification_state (guild_id, user_id, strikes, locked_until, updated_at)
    values (${guildId}, ${userId}, 1, ${lockedUntil}, ${now})
    on conflict (guild_id, user_id) do update set
      strikes      = case when verification_state.updated_at < ${staleCutoff} then 1 else verification_state.strikes + 1 end,
      locked_until = ${lockedUntil},
      updated_at   = ${now}
    returning strikes, locked_until`;
  return { strikes: row.strikes, lockedUntil: row.locked_until };
}

async function clearState(guildId, userId) {
  await sql`delete from verification_state where guild_id = ${guildId} and user_id = ${userId}`;
}

// ---------- challenges ----------

// Creates a captcha session, or replaces the code of a live one. A live session
// keeps its remaining attempts, so pressing Verify again never resets the limit.
async function issueChallenge(guild, user, { refresh = false } = {}) {
  const risk = assessAccount(user);
  const tier = tiers[risk.tier];
  const ready = pool.take(risk.tier);                       // drawn ahead of time, when there is one
  const code = ready?.code ?? generateCode(tier.length);
  const png = ready?.image ?? renderCaptcha(code, risk.tier);
  const codeHash = hashCode(config.captchaSecret, guild.id, user.id, code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + tier.ttlMs);
  const bump = refresh ? 1 : 0;

  const [session] = await sql`
    insert into verification_sessions (guild_id, user_id, code_hash, tier, attempts_left, refreshes, expires_at)
    values (${guild.id}, ${user.id}, ${codeHash}, ${risk.tier}, ${tier.attempts}, 0, ${expiresAt})
    on conflict (guild_id, user_id) do update set
      id            = gen_random_uuid(),
      code_hash     = excluded.code_hash,
      tier          = excluded.tier,
      expires_at    = excluded.expires_at,
      attempts_left = case when verification_sessions.expires_at > ${now}
                           then verification_sessions.attempts_left else excluded.attempts_left end,
      refreshes     = case when verification_sessions.expires_at > ${now}
                           then verification_sessions.refreshes + ${bump}::int else 0 end
    returning *`;

  return { session, risk, png, filename: `captcha-${crypto.randomBytes(4).toString('hex')}.jpg` };
}

async function getSession(sessionId, userId) {
  const [row] = await sql`select * from verification_sessions where id = ${sessionId} and user_id = ${userId}`;
  return row ?? null;
}

// Atomically spends one attempt. Returns null if the session is gone, expired or out of attempts.
async function consumeAttempt(sessionId, userId) {
  const [row] = await sql`
    update verification_sessions set attempts_left = attempts_left - 1
    where id = ${sessionId} and user_id = ${userId} and expires_at > ${new Date()} and attempts_left > 0
    returning *`;
  return row ?? null;
}

function codeMatches(guildId, userId, input, session) {
  return matches(config.captchaSecret, guildId, userId, input, session.code_hash);
}

async function deleteSession(guildId, userId) {
  await sql`delete from verification_sessions where guild_id = ${guildId} and user_id = ${userId}`;
}

async function activeSessionCount(guildId) {
  const [row] = await sql`
    select count(*)::int as n from verification_sessions where guild_id = ${guildId} and expires_at > ${new Date()}`;
  return row.n;
}

async function cleanupStale() {
  await sql`delete from verification_sessions where expires_at < ${new Date(Date.now() - 60 * 60 * 1000)}`;
}

// ---------- audit trail ----------

async function logEvent({ guildId, userId = null, type, tier = null, attempts = null, detail = {} }) {
  const [row] = await sql`
    insert into verification_events (guild_id, user_id, type, tier, attempts, detail)
    values (${guildId}, ${userId}, ${type}, ${tier}, ${attempts}, ${sql.json(detail)})
    returning id`;
  const prefix = type === 'completed' ? 'VER' : 'AUD';
  return `${prefix}-${String(row.id).padStart(6, '0')}`;
}

// ---------- roles ----------

async function grantVerified(member, settings, reason = 'Tower: verification completed') {
  const guild = member.guild;
  const verifiedRole = await guild.roles.fetch(settings.verified_role_id);
  if (!verifiedRole) throw new Error('The verified role no longer exists. Run /verification setup again.');
  await member.roles.add(verifiedRole, reason);
  // Taking Unverified away happens in the background: the member already has what they came for.
  if (settings.unverified_role_id) member.roles.remove(settings.unverified_role_id, reason).catch(() => {});
  return verifiedRole;
}

// Catches members who joined while Tower was offline: anyone who joined after
// verification was enabled and has neither role gets the unverified role.
async function sweepGuild(guild, settings) {
  if (!settings.enabled_at || !settings.unverified_role_id) return 0;
  const since = new Date(settings.enabled_at).getTime();
  const members = await fetchAll(guild);
  let fixed = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    if (!member.joinedTimestamp || member.joinedTimestamp < since) continue;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) continue;
    if (member.roles.cache.has(settings.verified_role_id) || member.roles.cache.has(settings.unverified_role_id)) continue;
    await member.roles.add(settings.unverified_role_id, 'Tower: missed join while offline').catch(() => {});
    fixed++;
  }
  return fixed;
}

module.exports = {
  getSettings, saveSettings, savePanel, setRaidMode,
  getState, registerStrike, clearState,
  issueChallenge, getSession, consumeAttempt, codeMatches, deleteSession, activeSessionCount, cleanupStale,
  logEvent, grantVerified, sweepGuild,
};
