const sql = require('../../db');
const { tickets } = require('../../constants');

const DAY = 24 * 60 * 60 * 1000;

// ---------- settings ----------

async function getSettings(guildId) {
  const [row] = await sql`select * from ticket_settings where guild_id = ${guildId}`;
  return row ?? null;
}

async function saveSettings(guildId, v) {
  const [row] = await sql`
    insert into ticket_settings
      (guild_id, panel_channel_id, category_id, handling_channel_id, logs_channel_id, admin_logs_channel_id, reviews_channel_id)
    values (${guildId}, ${v.panelChannelId}, ${v.categoryId}, ${v.handlingChannelId}, ${v.logsChannelId},
            ${v.adminLogsChannelId ?? null}, ${v.reviewsChannelId ?? null})
    on conflict (guild_id) do update set
      panel_channel_id = excluded.panel_channel_id, category_id = excluded.category_id,
      handling_channel_id = excluded.handling_channel_id, logs_channel_id = excluded.logs_channel_id,
      admin_logs_channel_id = coalesce(excluded.admin_logs_channel_id, ticket_settings.admin_logs_channel_id),
      reviews_channel_id = coalesce(excluded.reviews_channel_id, ticket_settings.reviews_channel_id),
      updated_at = now()
    returning *`;
  return row;
}

// Changes only the channels that were given. Everything else is left exactly as it was.
async function updateChannels(guildId, v) {
  const [row] = await sql`
    update ticket_settings set
      logs_channel_id       = coalesce(${v.logsChannelId ?? null}, logs_channel_id),
      admin_logs_channel_id = coalesce(${v.adminLogsChannelId ?? null}, admin_logs_channel_id),
      reviews_channel_id    = coalesce(${v.reviewsChannelId ?? null}, reviews_channel_id),
      handling_channel_id   = coalesce(${v.handlingChannelId ?? null}, handling_channel_id),
      updated_at = now()
    where guild_id = ${guildId} returning *`;
  return row ?? null;
}

async function savePanel(guildId, messageId) {
  await sql`update ticket_settings set panel_message_id = ${messageId}, updated_at = now() where guild_id = ${guildId}`;
}

// ---------- tickets ----------

async function nextNumber(guildId) {
  const [row] = await sql`
    insert into ticket_counters (guild_id, last_ticket) values (${guildId}, 1)
    on conflict (guild_id) do update set last_ticket = ticket_counters.last_ticket + 1
    returning last_ticket`;
  return row.last_ticket;
}

async function createTicket(t) {
  const [row] = await sql`
    insert into tickets (guild_id, ticket_number, type, channel_id, opener_id, opener_tag, subject, form)
    values (${t.guildId}, ${t.number}, ${t.type}, ${t.channelId}, ${t.openerId}, ${t.openerTag}, ${t.subject}, ${sql.json(t.form)})
    returning *`;
  return row;
}

const byChannel = async (channelId) => (await sql`select * from tickets where channel_id = ${channelId}`)[0] ?? null;
const byId = async (id) => (await sql`select * from tickets where id = ${id}`)[0] ?? null;
const openTickets = () => sql`select * from tickets where status = 'open'`;

async function countOpen(guildId, userId) {
  const [row] = await sql`select count(*)::int as n from tickets where guild_id = ${guildId} and opener_id = ${userId} and status = 'open'`;
  return row.n;
}

async function lastClosedAt(guildId, userId) {
  const [row] = await sql`
    select max(closed_at) as at from tickets where guild_id = ${guildId} and opener_id = ${userId} and closed_at is not null`;
  return row?.at ?? null;
}

const setMessages = (id, { openingId, handlingId }) => sql`
  update tickets set opening_message_id = coalesce(${openingId ?? null}, opening_message_id),
                     handling_message_id = coalesce(${handlingId ?? null}, handling_message_id) where id = ${id}`;

async function claim(id, userId) {
  const [row] = await sql`
    update tickets set claimed_by = ${userId}, claimed_at = now() where id = ${id} and status = 'open' and claimed_by is null returning *`;
  return row ?? null;
}

async function markClosed(id, { by, reason }) {
  const deleteAt = new Date(Date.now() + tickets.closedKeepMs);
  const [row] = await sql`
    update tickets set status = 'closed', closed_by = ${by}, closed_at = now(), close_reason = ${reason},
                       delete_at = ${deleteAt}, auto_close_at = null
    where id = ${id} and status = 'open' returning *`;
  return row ?? null;
}

async function reopen(id) {
  const [row] = await sql`
    update tickets set status = 'open', closed_by = null, closed_at = null, close_reason = null, delete_at = null,
                       inactive_hint_sent = false, last_opener_message_at = now()
    where id = ${id} and status = 'closed' returning *`;
  return row ?? null;
}

// The channel is gone: wipe the intake form so nothing personal lingers.
const markDeleted = (id) => sql`update tickets set status = 'deleted', form = '{}'::jsonb, delete_at = null where id = ${id}`;

// ---------- activity tracking ----------

const touchOpener = (id) => sql`update tickets set last_opener_message_at = now() where id = ${id}`;

async function touchStaff(id, userId) {
  await sql`update tickets set last_staff_message_at = now() where id = ${id}`;
  await sql`update tickets set first_response_by = ${userId}, first_response_at = now() where id = ${id} and first_response_at is null`;
}

const setInactive = (id, closeAt, byId) => sql`update tickets set auto_close_at = ${closeAt}, auto_close_by = ${byId}, inactive_hint_sent = true where id = ${id}`;
const clearInactive = (id) => sql`update tickets set auto_close_at = null, auto_close_by = null, inactive_hint_sent = false where id = ${id}`;
const markHintSent = (id) => sql`update tickets set inactive_hint_sent = true where id = ${id}`;

// ---------- scheduler queries ----------

const dueAutoClose = () => sql`select * from tickets where status = 'open' and auto_close_at is not null and auto_close_at <= ${new Date()} limit 20`;
const dueDeletes = () => sql`select * from tickets where status = 'closed' and delete_at is not null and delete_at <= ${new Date()} limit 20`;

// Waiting on the member: staff spoke last, and that was long enough ago.
const dueHints = () => sql`
  select * from tickets
  where status = 'open' and inactive_hint_sent = false and auto_close_at is null
    and last_staff_message_at is not null
    and last_staff_message_at > last_opener_message_at
    and last_staff_message_at <= ${new Date(Date.now() - tickets.inactiveHintMs)}
  limit 20`;

// ---------- blocks ----------

const getBlock = async (guildId, userId) =>
  (await sql`select * from ticket_blocks where guild_id = ${guildId} and user_id = ${userId}`)[0] ?? null;

const block = (guildId, userId, reason, by) => sql`
  insert into ticket_blocks (guild_id, user_id, reason, blocked_by) values (${guildId}, ${userId}, ${reason}, ${by})
  on conflict (guild_id, user_id) do update set reason = excluded.reason, blocked_by = excluded.blocked_by, created_at = now()`;

async function unblock(guildId, userId) {
  const rows = await sql`delete from ticket_blocks where guild_id = ${guildId} and user_id = ${userId} returning user_id`;
  return rows.length > 0;
}

// ---------- reviews ----------

async function saveReview(ticket, rating) {
  const [row] = await sql`
    insert into ticket_reviews (ticket_id, guild_id, opener_id, rating) values (${ticket.id}, ${ticket.guild_id}, ${ticket.opener_id}, ${rating})
    on conflict (ticket_id) do update set rating = excluded.rating, updated_at = now() returning *`;
  return row;
}
const getReview = async (ticketId) => (await sql`select * from ticket_reviews where ticket_id = ${ticketId}`)[0] ?? null;
const setReviewMessage = (ticketId, messageId) => sql`update ticket_reviews set review_message_id = ${messageId} where ticket_id = ${ticketId}`;

// ---------- statistics ----------

async function staffStats(guildId, userId) {
  const d30 = new Date(Date.now() - 30 * DAY);
  const [row] = await sql`
    select
      count(*) filter (where claimed_by = ${userId})::int as claimed_all,
      count(*) filter (where claimed_by = ${userId} and created_at >= ${d30})::int as claimed_30,
      count(*) filter (where closed_by = ${userId})::int as closed_all,
      count(*) filter (where closed_by = ${userId} and closed_at >= ${d30})::int as closed_30,
      (avg(extract(epoch from (first_response_at - created_at))) filter (where first_response_by = ${userId}))::float as resp_all,
      (avg(extract(epoch from (first_response_at - created_at))) filter (where first_response_by = ${userId} and created_at >= ${d30}))::float as resp_30,
      count(*) filter (where status = 'open' and claimed_by = ${userId})::int as open_now
    from tickets where guild_id = ${guildId}`;
  const [rating] = await sql`
    select (avg(r.rating))::float as avg_rating, count(*)::int as n
    from ticket_reviews r join tickets t on t.id = r.ticket_id
    where t.guild_id = ${guildId} and coalesce(t.claimed_by, t.first_response_by) = ${userId}`;
  return { ...row, avg_rating: rating.avg_rating, ratings: rating.n };
}

async function teamStats(guildId) {
  const d30 = new Date(Date.now() - 30 * DAY);
  return sql`
    select coalesce(t.claimed_by, t.first_response_by) as staff_id,
           count(*)::int as handled,
           (avg(extract(epoch from (t.first_response_at - t.created_at))) filter (where t.first_response_at is not null))::float as resp,
           (avg(r.rating))::float as rating
    from tickets t left join ticket_reviews r on r.ticket_id = t.id
    where t.guild_id = ${guildId} and t.created_at >= ${d30} and coalesce(t.claimed_by, t.first_response_by) is not null
    group by coalesce(t.claimed_by, t.first_response_by)
    order by count(*) desc limit 15`;
}

module.exports = {
  getSettings, saveSettings, updateChannels, savePanel, nextNumber, createTicket, byChannel, byId, openTickets, countOpen, lastClosedAt,
  setMessages, claim, markClosed, reopen, markDeleted, touchOpener, touchStaff, setInactive, clearInactive, markHintSent,
  dueAutoClose, dueDeletes, dueHints, getBlock, block, unblock, saveReview, getReview, setReviewMessage, staffStats, teamStats,
};
