const sql = require('../../db');
const { commissions: cfg } = require('../../constants');
const c = require('../../lib/commission');

async function create(x) {
  const history = [{ at: new Date().toISOString(), by: x.createdBy, status: x.status, note: 'Created' }];
  const [row] = await sql`
    insert into commissions (guild_id, client_id, title, description, price, status, deadline, ticket_channel_id, created_by, history)
    values (${x.guildId}, ${x.clientId}, ${x.title}, ${x.description}, ${x.price}, ${x.status}, ${x.deadline ?? null}, ${x.ticketChannelId ?? null}, ${x.createdBy}, ${sql.json(history)})
    returning *`;
  return c.shape(row);
}
async function get(id, guildId) {
  const [row] = await sql`select * from commissions where id = ${id} ${guildId ? sql`and guild_id = ${guildId}` : sql``}`;
  return c.shape(row);
}
async function countOpen(guildId) {
  const [row] = await sql`select count(*)::int as n from commissions where guild_id = ${guildId} and closed_at is null`;
  return row.n;
}

// Open ones first (soonest deadline first), then the most recent closed ones.
async function list({ guildId, status = 'open', clientId = null, limit = 25 }) {
  const rows = await sql`
    select * from commissions where guild_id = ${guildId}
      ${clientId ? sql`and client_id = ${clientId}` : sql``}
      ${status === 'open' ? sql`and closed_at is null` : status === 'all' ? sql`` : sql`and status = ${status}`}
    order by (closed_at is not null), deadline nulls last, created_at desc limit ${limit}`;
  return rows.map(c.shape);
}

async function update(id, fields) {
  const [row] = await sql`
    update commissions set
      title = coalesce(${fields.title ?? null}, title), price = coalesce(${fields.price ?? null}, price),
      description = coalesce(${fields.description ?? null}, description),
      deadline = ${fields.deadline === undefined ? sql`deadline` : fields.deadline},
      last_reminded_at = ${fields.deadline === undefined ? sql`last_reminded_at` : null},
      updated_at = now()
    where id = ${id} returning *`;
  return c.shape(row);
}

async function setStatus(id, status, by, note) {
  const current = await get(id);
  const history = c.pushLog(current.history, { at: new Date().toISOString(), by, status, note: note || '' }, cfg.maxHistory);
  const [row] = await sql`
    update commissions set status = ${status}, history = ${sql.json(history)}, updated_at = now(),
      closed_at = ${c.isClosed(status) ? sql`coalesce(closed_at, now())` : null}
    where id = ${id} returning *`;
  return c.shape(row);
}
async function addNote(id, by, text) {
  const current = await get(id);
  const notes = c.pushLog(current.notes, { at: new Date().toISOString(), by, text }, cfg.maxNotes);
  const [row] = await sql`update commissions set notes = ${sql.json(notes)}, updated_at = now() where id = ${id} returning *`;
  return c.shape(row);
}
async function setPaid(id, paid) {
  const [row] = await sql`update commissions set paid = ${paid}, paid_at = ${paid ? sql`now()` : null}, updated_at = now() where id = ${id} returning *`;
  return c.shape(row);
}
const markReviewRequested = (id) => sql`update commissions set review_requested_at = now() where id = ${id}`;

// ---------- deadline reminders ----------
async function dueForReminder(now = Date.now()) {
  const soon = new Date(now + cfg.reminderLeadMs); const again = new Date(now - cfg.reminderEveryMs);
  return (await sql`
    select * from commissions where closed_at is null and deadline is not null and deadline <= ${soon}
      and (last_reminded_at is null or last_reminded_at <= ${again}) order by deadline limit 25`).map(c.shape);
}
const markReminded = (id) => sql`update commissions set last_reminded_at = now() where id = ${id}`;

// ---------- reviews ----------
async function getReview(commissionId) {
  const [row] = await sql`select * from commission_reviews where commission_id = ${commissionId}`;
  return row ?? null;
}
async function saveReview(r) {
  const rows = await sql`
    insert into commission_reviews (commission_id, guild_id, client_id, order_text, rating, went_well, improve)
    values (${r.commissionId}, ${r.guildId}, ${r.clientId}, ${r.orderText}, ${r.rating}, ${r.wentWell}, ${r.improve})
    on conflict (commission_id) do nothing returning *`;
  return rows[0] ?? null;               // null means this commission was already reviewed
}
const setReviewMessage = (commissionId, messageId) => sql`update commission_reviews set posted_message_id = ${messageId} where commission_id = ${commissionId}`;
const recentReviews = (guildId, limit = 10) => sql`
  select r.*, c.title from commission_reviews r join commissions c on c.id = r.commission_id where r.guild_id = ${guildId} order by r.created_at desc limit ${limit}`;
async function reviewStats(guildId) {
  const [row] = await sql`select count(*)::int as n, coalesce(round(avg(rating)::numeric, 2), 0)::float as average from commission_reviews where guild_id = ${guildId}`;
  return row;
}

module.exports = {
  create, get, countOpen, list, update, setStatus, addNote, setPaid, markReviewRequested, dueForReminder, markReminded,
  getReview, saveReview, setReviewMessage, recentReviews, reviewStats,
};
