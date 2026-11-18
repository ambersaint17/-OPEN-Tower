const sql = require('../../db');
const { createTtlCache } = require('../../lib/ttlcache');

const settingsCache = createTtlCache(30_000);
async function getSettings(guildId) {
  const hit = settingsCache.get(guildId);
  if (hit) return hit;
  const [row] = await sql`select * from partner_settings where guild_id = ${guildId}`;
  return settingsCache.set(guildId, {
    guildId, channel_id: row?.channel_id ?? null, min_members: row?.min_members ?? 0, partner_role_id: row?.partner_role_id ?? null, our_ad: row?.our_ad ?? '',
    sticky_enabled: row ? row.sticky_enabled !== false : true, sticky_channels: Array.isArray(row?.sticky_channels) ? row.sticky_channels : [],
  });
}
async function saveSettings(guildId, s) {
  settingsCache.delete(guildId);
  await sql`
    insert into partner_settings (guild_id, channel_id, min_members, partner_role_id, our_ad, sticky_enabled, sticky_channels)
    values (${guildId}, ${s.channel_id}, ${s.min_members}, ${s.partner_role_id}, ${s.our_ad}, ${s.sticky_enabled !== false}, ${sql.json(s.sticky_channels ?? [])})
    on conflict (guild_id) do update set channel_id = excluded.channel_id, min_members = excluded.min_members, partner_role_id = excluded.partner_role_id,
      our_ad = excluded.our_ad, sticky_enabled = excluded.sticky_enabled, sticky_channels = excluded.sticky_channels, updated_at = now()`;
}

const shape = (r) => r && { ...r, id: Number(r.id) };
async function create(p) {
  const [row] = await sql`
    insert into partners (guild_id, server_name, invite_code, invite_guild_id, member_count, rep_user_id, posted_by, ad_text, ping, channel_id, message_id, ticket_channel_id)
    values (${p.guildId}, ${p.serverName}, ${p.inviteCode}, ${p.inviteGuildId ?? null}, ${p.memberCount ?? null}, ${p.repUserId ?? null}, ${p.postedBy}, ${p.adText}, ${p.ping},
            ${p.channelId}, ${p.messageId}, ${p.ticketChannelId ?? null}) returning *`;
  return shape(row);
}
async function get(id, guildId) { const [row] = await sql`select * from partners where id = ${id} ${guildId ? sql`and guild_id = ${guildId}` : sql``}`; return shape(row); }
async function list(guildId, status = 'active', limit = 25) {
  return (await sql`select * from partners where guild_id = ${guildId} ${status === 'all' ? sql`` : sql`and status = ${status}`} order by created_at desc limit ${limit}`).map(shape);
}
async function activeForInviteGuild(guildId, inviteGuildId) {
  if (!inviteGuildId) return null;
  const [row] = await sql`select * from partners where guild_id = ${guildId} and invite_guild_id = ${inviteGuildId} and status = 'active' limit 1`;
  return shape(row);
}
async function end(id, reason) {
  const [row] = await sql`update partners set status = 'ended', end_reason = ${reason}, ended_at = now() where id = ${id} and status = 'active' returning *`;
  return shape(row);
}
async function repHasOtherActive(guildId, repId, exceptId) {
  if (!repId) return false;
  return (await sql`select 1 from partners where guild_id = ${guildId} and rep_user_id = ${repId} and status = 'active' and id <> ${exceptId} limit 1`).length > 0;
}

// ---------- reciprocity: did they post our ad too? ----------
async function setReciprocated(id, done, proof = '') {
  const [row] = await sql`update partners set reciprocated = ${done}, reciprocated_at = ${done ? sql`now()` : null}, reciprocal_proof = ${done ? proof : ''} where id = ${id} returning *`;
  return shape(row);
}
async function dueForReciprocityReminder(firstDays, repeatDays) {
  const first = new Date(Date.now() - firstDays * 86_400_000); const again = new Date(Date.now() - repeatDays * 86_400_000);
  return (await sql`
    select * from partners where status = 'active' and reciprocated = false and created_at <= ${first}
      and (reciprocity_reminded_at is null or reciprocity_reminded_at <= ${again}) order by created_at limit 20`).map(shape);
}
const markReciprocityReminded = (id) => sql`update partners set reciprocity_reminded_at = now() where id = ${id}`;

// ---------- blacklist, by the other server's ID ----------
async function addBlacklist(b) {
  const rows = await sql`
    insert into partner_blacklist (guild_id, server_id, name, reason, added_by) values (${b.guildId}, ${b.serverId}, ${b.name ?? null}, ${b.reason ?? ''}, ${b.addedBy})
    on conflict (guild_id, server_id) do update set reason = excluded.reason, name = coalesce(excluded.name, partner_blacklist.name) returning *`;
  return rows[0];
}
async function removeBlacklist(guildId, serverId) {
  return (await sql`delete from partner_blacklist where guild_id = ${guildId} and server_id = ${serverId} returning id`).length > 0;
}
async function getBlacklisted(guildId, serverId) {
  if (!serverId) return null;
  const [row] = await sql`select * from partner_blacklist where guild_id = ${guildId} and server_id = ${serverId}`;
  return row ?? null;
}
const listBlacklist = (guildId) => sql`select * from partner_blacklist where guild_id = ${guildId} order by created_at desc limit 50`;

// ---------- the sticky message's current place ----------
async function getSticky(guildId, channelId) {
  const [row] = await sql`select message_id from partner_sticky where guild_id = ${guildId} and channel_id = ${channelId}`;
  return row?.message_id ?? null;
}
const setSticky = (guildId, channelId, messageId) => sql`
  insert into partner_sticky (guild_id, channel_id, message_id) values (${guildId}, ${channelId}, ${messageId})
  on conflict (guild_id, channel_id) do update set message_id = excluded.message_id`;
const clearSticky = (guildId, channelId) => sql`delete from partner_sticky where guild_id = ${guildId} and channel_id = ${channelId}`;

module.exports = {
  getSettings, saveSettings, create, get, list, activeForInviteGuild, end, repHasOtherActive,
  setReciprocated, dueForReciprocityReminder, markReciprocityReminded,
  addBlacklist, removeBlacklist, getBlacklisted, listBlacklist, getSticky, setSticky, clearSticky,
};
