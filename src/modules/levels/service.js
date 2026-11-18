const sql = require('../../db');

// ---------- settings ----------

async function getSettings(guildId) {
  const [row] = await sql`select * from level_settings where guild_id = ${guildId}`;
  return row ?? null;
}

const savePanel = (guildId, channelId, messageId) => sql`
  insert into level_settings (guild_id, panel_channel_id, panel_message_id) values (${guildId}, ${channelId}, ${messageId})
  on conflict (guild_id) do update set panel_channel_id = excluded.panel_channel_id,
    panel_message_id = excluded.panel_message_id, updated_at = now()`;

// ---------- members ----------

async function getMember(guildId, userId) {
  const [row] = await sql`
    select xp, streak, to_char(last_day, 'YYYY-MM-DD') as last_day, shield_used_at, colour_role_id, dm_levelups
    from member_xp where guild_id = ${guildId} and user_id = ${userId}`;
  return row ?? null;
}

// The bot holds the live numbers, so a save writes absolute values.
const saveMember = (e) => sql`
  insert into member_xp (guild_id, user_id, xp, streak, last_day, shield_used_at, colour_role_id, dm_levelups)
  values (${e.guildId}, ${e.userId}, ${Math.round(e.xp)}, ${e.streak}, ${e.lastDay}, ${e.shieldUsedAt ?? null}, ${e.colourRoleId ?? null}, ${e.dm !== false})
  on conflict (guild_id, user_id) do update set xp = excluded.xp, streak = excluded.streak, last_day = excluded.last_day,
    shield_used_at = excluded.shield_used_at, colour_role_id = excluded.colour_role_id, dm_levelups = excluded.dm_levelups, updated_at = now()`;

const setDm = (guildId, userId, on) => sql`
  insert into member_xp (guild_id, user_id, dm_levelups) values (${guildId}, ${userId}, ${on})
  on conflict (guild_id, user_id) do update set dm_levelups = excluded.dm_levelups`;

const deleteMember = (guildId, userId) => sql`delete from member_xp where guild_id = ${guildId} and user_id = ${userId}`;

async function allXp(guildId) {
  const rows = await sql`select user_id, xp from member_xp where guild_id = ${guildId}`;
  return new Map(rows.map((r) => [r.user_id, Number(r.xp)]));
}

// ---------- rules ----------

const loadRules = (guildId) => sql`select kind, target_id, mode, multiplier from xp_rules where guild_id = ${guildId}`;

// A target is either ignored or allowed, never both. Multipliers are separate.
async function setRule(guildId, kind, targetId, mode, multiplier = null) {
  if (mode === 'ignore' || mode === 'allow') {
    await sql`delete from xp_rules where guild_id = ${guildId} and target_id = ${targetId} and mode in ('ignore', 'allow')`;
  }
  await sql`
    insert into xp_rules (guild_id, kind, target_id, mode, multiplier) values (${guildId}, ${kind}, ${targetId}, ${mode}, ${multiplier})
    on conflict (guild_id, kind, target_id, mode) do update set multiplier = excluded.multiplier`;
}

const clearRule = (guildId, targetId, modes) =>
  sql`delete from xp_rules where guild_id = ${guildId} and target_id = ${targetId} and mode in ${sql(modes)}`;

// ---------- timed events ----------

async function startEvent(guildId, multiplier, endsAt, startedBy) {
  await sql`update xp_events set ends_at = now() where guild_id = ${guildId} and ends_at > now()`;
  const [row] = await sql`
    insert into xp_events (guild_id, multiplier, ends_at, started_by) values (${guildId}, ${multiplier}, ${endsAt}, ${startedBy}) returning *`;
  return row;
}

const stopEvents = (guildId) => sql`update xp_events set ends_at = now() where guild_id = ${guildId} and ends_at > now()`;

async function activeEvent(guildId) {
  const [row] = await sql`
    select multiplier, ends_at, started_by from xp_events where guild_id = ${guildId} and ends_at > now() order by ends_at desc limit 1`;
  return row ?? null;
}

// ---------- booster colour roles ----------

const getBoosterRole = async (guildId, userId) =>
  (await sql`select role_id from booster_roles where guild_id = ${guildId} and user_id = ${userId}`)[0]?.role_id ?? null;

const setBoosterRole = (guildId, userId, roleId) => sql`
  insert into booster_roles (guild_id, user_id, role_id) values (${guildId}, ${userId}, ${roleId})
  on conflict (guild_id, user_id) do update set role_id = excluded.role_id`;

const deleteBoosterRole = (guildId, userId) => sql`delete from booster_roles where guild_id = ${guildId} and user_id = ${userId}`;

module.exports = {
  getSettings, savePanel, getMember, saveMember, setDm, deleteMember, allXp, loadRules, setRule, clearRule,
  startEvent, stopEvents, activeEvent, getBoosterRole, setBoosterRole, deleteBoosterRole,
};
