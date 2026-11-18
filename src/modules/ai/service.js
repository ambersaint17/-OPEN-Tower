const sql = require('../../db');

const keyOf = (title) => String(title).trim().toLowerCase();

async function getSettings(guildId) {
  const [row] = await sql`select * from ai_settings where guild_id = ${guildId}`;
  return row ? { ...row, ticket_types: Array.isArray(row.ticket_types) ? row.ticket_types : [], backup_models: Array.isArray(row.backup_models) ? row.backup_models : [] } : null;
}
// Missing settings behave as the defaults, switched off.
const DEFAULTS = { enabled: false, model: 'haiku', model_id: '', backup_models: [], instructions: '', ticket_types: [], user_daily_limit: 20, daily_token_budget: 300000 };
const settingsOrDefault = async (guildId) => ({ guild_id: guildId, ...DEFAULTS, ...(await getSettings(guildId) ?? {}) });

async function saveSettings(guildId, s) {
  await sql`
    insert into ai_settings (guild_id, enabled, model, model_id, backup_models, instructions, ticket_types, user_daily_limit, daily_token_budget)
    values (${guildId}, ${s.enabled}, ${s.model}, ${s.model_id ?? ''}, ${sql.json(s.backup_models ?? [])}, ${s.instructions}, ${sql.json(s.ticket_types)}, ${s.user_daily_limit}, ${s.daily_token_budget})
    on conflict (guild_id) do update set enabled = excluded.enabled, model = excluded.model, model_id = excluded.model_id, backup_models = excluded.backup_models, instructions = excluded.instructions,
      ticket_types = excluded.ticket_types, user_daily_limit = excluded.user_daily_limit, daily_token_budget = excluded.daily_token_budget, updated_at = now()`;
}

// ---------- knowledge ----------
const listKnowledge = (guildId) => sql`select id, title, content, updated_at from ai_knowledge where guild_id = ${guildId} order by title_key`;
async function getKnowledge(guildId, title) {
  const [row] = await sql`select id, title, content from ai_knowledge where guild_id = ${guildId} and title_key = ${keyOf(title)}`;
  return row ?? null;
}
async function getKnowledgeById(guildId, id) {
  const [row] = await sql`select id, title, content from ai_knowledge where guild_id = ${guildId} and id = ${id}`;
  return row ?? null;
}
async function saveKnowledge(guildId, title, content, userId) {
  const clean = title.trim();
  const [row] = await sql`
    insert into ai_knowledge (guild_id, title, title_key, content, created_by) values (${guildId}, ${clean}, ${keyOf(clean)}, ${content}, ${userId})
    on conflict (guild_id, title_key) do update set title = excluded.title, content = excluded.content, updated_at = now() returning id`;
  return row.id;
}
async function updateKnowledgeById(guildId, id, title, content) {
  await sql`update ai_knowledge set title = ${title.trim()}, title_key = ${keyOf(title)}, content = ${content}, updated_at = now() where guild_id = ${guildId} and id = ${id}`;
}
async function deleteKnowledge(guildId, title) {
  return (await sql`delete from ai_knowledge where guild_id = ${guildId} and title_key = ${keyOf(title)} returning id`).length > 0;
}

// ---------- usage ----------
async function usageFor(guildId, day, userId) {
  const [mine] = await sql`select requests from ai_usage where guild_id = ${guildId} and day = ${day} and user_id = ${userId}`;
  const [all] = await sql`select coalesce(sum(tokens), 0)::int as tokens, coalesce(sum(requests), 0)::int as requests from ai_usage where guild_id = ${guildId} and day = ${day}`;
  return { userRequests: mine?.requests ?? 0, guildTokens: all.tokens, guildRequests: all.requests };
}
async function addUsage(guildId, day, userId, tokens) {
  await sql`
    insert into ai_usage (guild_id, day, user_id, requests, tokens) values (${guildId}, ${day}, ${userId}, 1, ${tokens})
    on conflict (guild_id, day, user_id) do update set requests = ai_usage.requests + 1, tokens = ai_usage.tokens + excluded.tokens`;
}

// ---------- log ----------
async function addLog(l) {
  const [row] = await sql`
    insert into ai_log (guild_id, user_id, channel_id, kind, question, answer, tokens)
    values (${l.guildId}, ${l.userId}, ${l.channelId}, ${l.kind}, ${l.question}, ${l.answer}, ${l.tokens}) returning id`;
  return Number(row.id);
}
async function rate(id, userId, rating) {
  return (await sql`update ai_log set rating = ${rating} where id = ${id} and user_id = ${userId} returning id`).length > 0;
}
const recentLog = (guildId, limit = 10) => sql`select id, user_id, kind, question, rating, created_at from ai_log where guild_id = ${guildId} and kind = 'ask' order by created_at desc limit ${limit}`;
async function ratingStats(guildId) {
  const [row] = await sql`select count(*) filter (where rating = 1)::int as up, count(*) filter (where rating = 0)::int as down from ai_log where guild_id = ${guildId}`;
  return row;
}
const pruneLog = (days) => sql`delete from ai_log where created_at < now() - (${days} * interval '1 day')`;

module.exports = {
  getSettings, settingsOrDefault, saveSettings, listKnowledge, getKnowledge, getKnowledgeById, saveKnowledge, updateKnowledgeById, deleteKnowledge,
  usageFor, addUsage, addLog, rate, recentLog, ratingStats, pruneLog,
};
