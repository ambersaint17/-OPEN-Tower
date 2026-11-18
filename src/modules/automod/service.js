const sql = require('../../db');
const { automod: cfg } = require('../../constants');
const { createTtlCache } = require('../../lib/ttlcache');
const lib = require('../../lib/automod');

const settingsCache = createTtlCache(cfg.settingsCacheMs);
const wordsCache = createTtlCache(cfg.settingsCacheMs);
const keyOf = (word) => String(word).trim().toLowerCase();

// Settings with the defaults filled in. Read on every message, so they are cached briefly and cleared on every change.
async function getSettings(guildId) {
  const hit = settingsCache.get(guildId);
  if (hit) return hit;
  const [row] = await sql`select * from automod_settings where guild_id = ${guildId}`;
  const settings = {
    guildId, enabled: Boolean(row?.enabled), config: lib.mergeConfig(row?.config),
    exemptChannels: Array.isArray(row?.exempt_channels) ? row.exempt_channels : [], exemptRoles: Array.isArray(row?.exempt_roles) ? row.exempt_roles : [],
  };
  return settingsCache.set(guildId, settings);
}
async function saveSettings(guildId, s) {
  settingsCache.delete(guildId);
  await sql`
    insert into automod_settings (guild_id, enabled, config, exempt_channels, exempt_roles)
    values (${guildId}, ${s.enabled}, ${sql.json(s.config)}, ${sql.json(s.exemptChannels)}, ${sql.json(s.exemptRoles)})
    on conflict (guild_id) do update set enabled = excluded.enabled, config = excluded.config,
      exempt_channels = excluded.exempt_channels, exempt_roles = excluded.exempt_roles, updated_at = now()`;
}

async function getWords(guildId) {
  const hit = wordsCache.get(guildId);
  if (hit) return hit;
  const rows = await sql`select word from automod_words where guild_id = ${guildId} order by word_key`;
  return wordsCache.set(guildId, rows.map((r) => r.word));
}
async function addWord(guildId, word, userId) {
  wordsCache.delete(guildId);
  const rows = await sql`insert into automod_words (guild_id, word, word_key, created_by) values (${guildId}, ${word.trim()}, ${keyOf(word)}, ${userId}) on conflict do nothing returning id`;
  return rows.length > 0;
}
async function removeWord(guildId, word) {
  wordsCache.delete(guildId);
  return (await sql`delete from automod_words where guild_id = ${guildId} and word_key = ${keyOf(word)} returning id`).length > 0;
}

// How many warnings AutoMod has given lately, from the case records.
async function recentWarns(guildId, days = 7) {
  const [row] = await sql`select count(*)::int as n from mod_cases where guild_id = ${guildId} and source = 'automod' and created_at > now() - (${days} * interval '1 day')`;
  return row.n;
}

module.exports = { getSettings, saveSettings, getWords, addWord, removeWord, recentWarns, keyOf };
