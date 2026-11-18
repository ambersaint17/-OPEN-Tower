const sql = require('../../db');
const { staff } = require('../../constants');

const DAY = 24 * 60 * 60 * 1000;

async function createOffer(o) {
  const [row] = await sql`
    insert into staff_offers (guild_id, user_id, team, rank_key, offered_by, note, expires_at)
    values (${o.guildId}, ${o.userId}, ${o.team}, ${o.rankKey}, ${o.offeredBy}, ${o.note}, ${new Date(Date.now() + staff.offerDays * DAY)})
    returning *`;
  return row;
}
const setOfferMessage = (id, channelId, messageId) => sql`update staff_offers set dm_channel_id = ${channelId}, dm_message_id = ${messageId} where id = ${id}`;
async function getOffer(id) { const [row] = await sql`select * from staff_offers where id = ${id}`; return row ?? null; }
async function pendingFor(guildId, userId) {
  const [row] = await sql`select * from staff_offers where guild_id = ${guildId} and user_id = ${userId} and status = 'pending' and expires_at > now()`;
  return row ?? null;
}
const listPending = (guildId) => sql`select * from staff_offers where guild_id = ${guildId} and status = 'pending' and expires_at > now() order by created_at`;

// Only one caller can move an offer out of "pending", so a double click can never apply it twice.
async function settle(id, status, responseNote = '') {
  const [row] = await sql`update staff_offers set status = ${status}, response_note = ${responseNote}, responded_at = now() where id = ${id} and status = 'pending' returning *`;
  return row ?? null;
}
const setStatus = (id, status) => sql`update staff_offers set status = ${status}, responded_at = coalesce(responded_at, now()) where id = ${id}`;
async function expireDue() {
  return sql`update staff_offers set status = 'expired', responded_at = now() where status = 'pending' and expires_at <= now() returning *`;
}

const addHistory = (h) => sql`
  insert into staff_history (guild_id, user_id, action, team, from_rank, to_rank, by_user, reason)
  values (${h.guildId}, ${h.userId}, ${h.action}, ${h.team}, ${h.fromRank ?? null}, ${h.toRank ?? null}, ${h.by}, ${h.reason ?? ''})`;

// When each person was last inducted, for the roster.
async function inductedSince(guildId, userIds) {
  if (!userIds.length) return new Map();
  const rows = await sql`
    select distinct on (user_id) user_id, created_at from staff_history
    where guild_id = ${guildId} and action = 'induct' and user_id in ${sql(userIds)} order by user_id, created_at desc`;
  return new Map(rows.map((r) => [r.user_id, r.created_at]));
}

module.exports = { createOffer, setOfferMessage, getOffer, pendingFor, listPending, settle, setStatus, expireDue, addHistory, inductedSince };
