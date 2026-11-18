const sql = require('../../db');
const ui = require('../../ui');
const { logging } = require('../../constants');
const channels = require('./channels');

const disabled = new Map(); // guildId -> Set(type)

async function loadSettings() {
  const rows = await sql`select guild_id, log_type, enabled, channel_id from log_settings`;
  disabled.clear();
  channels.clearOverrides();
  for (const row of rows) {
    if (!row.enabled) {
      if (!disabled.has(row.guild_id)) disabled.set(row.guild_id, new Set());
      disabled.get(row.guild_id).add(row.log_type);
    }
    if (row.channel_id) channels.setOverride(row.guild_id, row.log_type, row.channel_id);
  }
}

const isEnabled = (guildId, type) => !disabled.get(guildId)?.has(type);

async function setEnabled(guildId, type, enabled) {
  await sql`
    insert into log_settings (guild_id, log_type, enabled) values (${guildId}, ${type}, ${enabled})
    on conflict (guild_id, log_type) do update set enabled = excluded.enabled, updated_at = now()`;
  if (!disabled.has(guildId)) disabled.set(guildId, new Set());
  if (enabled) disabled.get(guildId).delete(type);
  else disabled.get(guildId).add(type);
}

// Pins a log type to a specific channel. Pass null to go back to automatic detection.
async function setChannel(guildId, type, channelId) {
  await sql`
    insert into log_settings (guild_id, log_type, channel_id) values (${guildId}, ${type}, ${channelId})
    on conflict (guild_id, log_type) do update set channel_id = excluded.channel_id, updated_at = now()`;
  channels.setOverride(guildId, type, channelId);
}

async function recordEvent(guildId, type, actorId, targetId, detail) {
  const [row] = await sql`
    insert into log_events (guild_id, type, actor_id, target_id, detail)
    values (${guildId}, ${type}, ${actorId ?? null}, ${targetId ?? null}, ${sql.json(detail ?? {})})
    returning id`;
  return `LOG-${String(row.id).padStart(6, '0')}`;
}

// Records a metadata row (never message text), builds the card and posts it.
// build(logId) must return a container. Never throws: logging must not break the bot.
async function log(guild, type, build, { actorId, targetId, detail, files } = {}) {
  try {
    if (!isEnabled(guild.id, type)) return null;
    const channel = channels.channelFor(guild, type);
    if (!channel) return null;
    const logId = await recordEvent(guild.id, type, actorId, targetId, detail);
    return await channel.send({
      ...ui.message(build(logId), { files }),
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error(`[log:${type}]`, err.message);
    return null;
  }
}

async function pruneEvents() {
  const cutoff = new Date(Date.now() - logging.eventRetentionDays * 24 * 60 * 60 * 1000);
  await sql`delete from log_events where created_at < ${cutoff}`;
}

module.exports = { loadSettings, isEnabled, setEnabled, setChannel, log, pruneEvents };
