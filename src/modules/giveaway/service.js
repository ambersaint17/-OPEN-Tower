const sql = require('../../db');

const shape = (row) => row && { ...row, id: Number(row.id), winner_ids: Array.isArray(row.winner_ids) ? row.winner_ids : [], requirements: row.requirements ?? {} };

async function create(g) {
  const [row] = await sql`
    insert into giveaways (guild_id, channel_id, host_id, prize, description, winner_note, winners, ends_at, requirements, ping_role_id, claim_hours)
    values (${g.guildId}, ${g.channelId}, ${g.hostId}, ${g.prize}, ${g.description}, ${g.winnerNote}, ${g.winners}, ${new Date(g.endsAt)},
            ${sql.json(g.requirements)}, ${g.pingRoleId ?? null}, ${g.claimHours})
    returning *`;
  return shape(row);
}
const setMessage = (id, messageId) => sql`update giveaways set message_id = ${messageId} where id = ${id}`;
const setWinnerMessage = (id, messageId) => sql`update giveaways set winner_message_id = ${messageId} where id = ${id}`;
const setWinners = (id, ids) => sql`update giveaways set winner_ids = ${sql.json(ids)} where id = ${id}`;

async function get(id, guildId) {
  const [row] = await sql`select * from giveaways where id = ${id} ${guildId ? sql`and guild_id = ${guildId}` : sql``}`;
  return shape(row);
}
async function listActive(guildId) {
  return (await sql`select * from giveaways where guild_id = ${guildId} and status = 'active' order by ends_at`).map(shape);
}
async function listRecent(guildId, limit = 25) {
  return (await sql`select * from giveaways where guild_id = ${guildId} order by created_at desc limit ${limit}`).map(shape);
}
async function countActive(guildId) {
  const [row] = await sql`select count(*)::int as n from giveaways where guild_id = ${guildId} and status = 'active'`;
  return row.n;
}
async function due() {
  return (await sql`select id from giveaways where status = 'active' and ends_at <= now() order by ends_at limit 20`).map((r) => Number(r.id));
}
// Only one caller can win this race, so a giveaway can never be drawn twice.
async function claimEnd(id) {
  const [row] = await sql`update giveaways set status = 'ended', ended_at = now() where id = ${id} and status = 'active' returning *`;
  return shape(row);
}
async function cancel(id) {
  const [row] = await sql`update giveaways set status = 'cancelled', ended_at = now() where id = ${id} and status = 'active' returning *`;
  return shape(row);
}

async function addEntry(id, userId) {
  const rows = await sql`insert into giveaway_entries (giveaway_id, user_id) values (${id}, ${userId}) on conflict do nothing returning user_id`;
  return rows.length > 0;
}
async function removeEntry(id, userId) {
  const rows = await sql`delete from giveaway_entries where giveaway_id = ${id} and user_id = ${userId} returning user_id`;
  return rows.length > 0;
}
async function hasEntry(id, userId) {
  const rows = await sql`select 1 from giveaway_entries where giveaway_id = ${id} and user_id = ${userId}`;
  return rows.length > 0;
}
async function countEntries(id) {
  const [row] = await sql`select count(*)::int as n from giveaway_entries where giveaway_id = ${id}`;
  return row.n;
}
async function entryIds(id) {
  return (await sql`select user_id from giveaway_entries where giveaway_id = ${id}`).map((r) => r.user_id);
}

module.exports = {
  create, setMessage, setWinnerMessage, setWinners, get, listActive, listRecent, countActive, due, claimEnd, cancel,
  addEntry, removeEntry, hasEntry, countEntries, entryIds,
};
