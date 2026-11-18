const sql = require('../../db');

const getSettings = async (guildId) => (await sql`select * from qotd_settings where guild_id = ${guildId}`)[0] ?? null;
const allActive = () => sql`select * from qotd_settings where channel_id is not null`;

async function saveSettings(guildId, v) {
  const [row] = await sql`
    insert into qotd_settings (guild_id, channel_id, alert_channel_id, ping_role_id, post_hour, post_minute, utc_offset_min)
    values (${guildId}, ${v.channelId}, ${v.alertChannelId ?? null}, ${v.pingRoleId ?? null}, ${v.hour}, ${v.minute}, ${v.offsetMin})
    on conflict (guild_id) do update set channel_id = excluded.channel_id,
      alert_channel_id = coalesce(excluded.alert_channel_id, qotd_settings.alert_channel_id),
      ping_role_id = coalesce(excluded.ping_role_id, qotd_settings.ping_role_id),
      post_hour = excluded.post_hour, post_minute = excluded.post_minute, utc_offset_min = excluded.utc_offset_min, updated_at = now()
    returning *`;
  return row;
}

const setLastDay = (guildId, day) => sql`update qotd_settings set last_post_day = ${day} where guild_id = ${guildId}`;
const setLastThread = (guildId, threadId) => sql`update qotd_settings set last_thread_id = ${threadId} where guild_id = ${guildId}`;

async function addQuestion(q) {
  const [row] = await sql`
    insert into qotd_questions (guild_id, question, kind, option_a, option_b, added_by, suggested_by)
    values (${q.guildId}, ${q.question}, ${q.kind}, ${q.optionA ?? null}, ${q.optionB ?? null}, ${q.addedBy}, ${q.suggestedBy ?? null})
    returning *`;
  return row;
}

const queue = (guildId, limit = 15) => sql`select * from qotd_questions where guild_id = ${guildId} and status = 'queued' order by id limit ${limit}`;
const queuedCount = async (guildId) => (await sql`select count(*)::int as n from qotd_questions where guild_id = ${guildId} and status = 'queued'`)[0].n;
const nextQuestion = async (guildId) => (await sql`select * from qotd_questions where guild_id = ${guildId} and status = 'queued' order by id limit 1`)[0] ?? null;
const nextNumber = async (guildId) => (await sql`select coalesce(max(number), 0) + 1 as n from qotd_questions where guild_id = ${guildId}`)[0].n;

async function removeQuestion(guildId, id) {
  const rows = await sql`delete from qotd_questions where guild_id = ${guildId} and id = ${id} and status = 'queued' returning id`;
  return rows.length > 0;
}

const markPosted = (id, number, messageId, threadId) => sql`
  update qotd_questions set status = 'posted', number = ${number}, message_id = ${messageId}, thread_id = ${threadId}, posted_at = now() where id = ${id}`;

// ---------- suggestions ----------
const createSuggestion = async (guildId, userId, question) =>
  (await sql`insert into qotd_suggestions (guild_id, user_id, question) values (${guildId}, ${userId}, ${question}) returning *`)[0];
const getSuggestion = async (id) => (await sql`select * from qotd_suggestions where id = ${id}`)[0] ?? null;
const setSuggestionMessage = (id, messageId) => sql`update qotd_suggestions set message_id = ${messageId} where id = ${id}`;
const pendingCount = async (guildId, userId) =>
  (await sql`select count(*)::int as n from qotd_suggestions where guild_id = ${guildId} and user_id = ${userId} and status = 'pending'`)[0].n;
const decideSuggestion = async (id, status, by) =>
  (await sql`update qotd_suggestions set status = ${status}, decided_by = ${by} where id = ${id} and status = 'pending' returning *`)[0] ?? null;

module.exports = {
  getSettings, allActive, saveSettings, setLastDay, setLastThread, addQuestion, queue, queuedCount, nextQuestion, nextNumber,
  removeQuestion, markPosted, createSuggestion, getSuggestion, setSuggestionMessage, pendingCount, decideSuggestion,
};
