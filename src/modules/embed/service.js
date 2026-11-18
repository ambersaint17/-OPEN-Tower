const sql = require('../../db');
const embed = require('../../lib/embed');

const keyOf = (name) => String(name).trim().toLowerCase();

async function listTemplates(guildId) {
  return sql`select name, updated_at, created_by from embed_templates where guild_id = ${guildId} order by name_key`;
}
async function countTemplates(guildId) {
  const [row] = await sql`select count(*)::int as n from embed_templates where guild_id = ${guildId}`;
  return row.n;
}
async function getTemplate(guildId, name) {
  const [row] = await sql`select name, data from embed_templates where guild_id = ${guildId} and name_key = ${keyOf(name)}`;
  return row ? { name: row.name, draft: embed.sanitizeDraft(row.data) } : null;
}
async function saveTemplate(guildId, name, draft, userId) {
  const clean = name.trim();
  await sql`
    insert into embed_templates (guild_id, name, name_key, data, created_by)
    values (${guildId}, ${clean}, ${keyOf(clean)}, ${sql.json(draft)}, ${userId})
    on conflict (guild_id, name_key) do update set name = excluded.name, data = excluded.data, updated_at = now()`;
}
async function deleteTemplate(guildId, name) {
  const rows = await sql`delete from embed_templates where guild_id = ${guildId} and name_key = ${keyOf(name)} returning id`;
  return rows.length > 0;
}

async function recordPost({ guildId, channelId, messageId, via, draft, userId }) {
  await sql`
    insert into embed_posts (guild_id, channel_id, message_id, via, data, created_by)
    values (${guildId}, ${channelId}, ${messageId}, ${via}, ${sql.json(draft)}, ${userId})
    on conflict (channel_id, message_id) do update set data = excluded.data, updated_at = now()`;
  cache.delete(messageId);
}
async function updatePost(channelId, messageId, draft) {
  await sql`update embed_posts set data = ${sql.json(draft)}, updated_at = now() where channel_id = ${channelId} and message_id = ${messageId}`;
  cache.delete(messageId);
}

// Dropdown menus read their replies from the saved post. A short cache keeps busy menus off the database.
const cache = new Map(); // messageId -> { at, post }
async function postByMessage(messageId, guildId) {
  const hit = cache.get(messageId);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.post;
  const [row] = await sql`select guild_id, channel_id, message_id, via, data from embed_posts where message_id = ${messageId}`;
  const post = row && (!guildId || row.guild_id === guildId)
    ? { guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id, via: row.via, draft: embed.sanitizeDraft(row.data) }
    : null;
  cache.set(messageId, { at: Date.now(), post });
  return post;
}

module.exports = { listTemplates, countTemplates, getTemplate, saveTemplate, deleteTemplate, recordPost, updatePost, postByMessage };
