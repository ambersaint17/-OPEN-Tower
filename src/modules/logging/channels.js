const { ChannelType } = require('discord.js');
const { logTypes, logging } = require('../../constants');
const { matchesChannelName } = require('../../lib/channels');

// Several channels can match one name (a server can have two "mod-logs"). The right one lives in
// the category that holds the most other log channels, whatever that category is called.
// Ties fall back to a category with "log" in its name, then to the first match.
function pickLogChannel(candidates, parentScores = new Map()) {
  if (!candidates.length) return null;
  const scoreOf = (c) => parentScores.get(c.parentId) ?? 0;
  const best = Math.max(...candidates.map(scoreOf));
  const top = candidates.filter((c) => scoreOf(c) === best);
  return top.find((c) => /log/i.test(c.parentName ?? '')) ?? top[0];
}

const cache = new Map();     // guildId -> { at, byType: Map(type -> channelId), ids: Set(channelId) }
const overrides = new Map(); // guildId -> Map(type -> channelId), set with /logs channel

function build(guild) {
  const textChannels = [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId ?? null, parentName: c.parent?.name ?? null }));

  // How many different log types have a channel in each category.
  const matches = new Map();
  const parentScores = new Map();
  for (const [type, def] of Object.entries(logTypes)) {
    const found = textChannels.filter((c) => matchesChannelName(c.name, def.channel));
    matches.set(type, found);
    for (const parentId of new Set(found.map((c) => c.parentId))) {
      parentScores.set(parentId, (parentScores.get(parentId) ?? 0) + 1);
    }
  }

  const custom = overrides.get(guild.id) ?? new Map();
  const byType = new Map();
  for (const type of Object.keys(logTypes)) {
    const overrideId = custom.get(type);
    if (overrideId && guild.channels.cache.has(overrideId)) {
      byType.set(type, overrideId);
      continue;
    }
    const pick = pickLogChannel(matches.get(type), parentScores);
    if (pick) byType.set(type, pick.id);
  }

  const entry = { at: Date.now(), byType, ids: new Set(byType.values()) };
  cache.set(guild.id, entry);
  return entry;
}

function entryFor(guild) {
  const existing = cache.get(guild.id);
  if (existing && Date.now() - existing.at < logging.channelRefreshMs) return existing;
  return build(guild);
}

const refresh = (guild) => build(guild);

function channelFor(guild, type) {
  const id = entryFor(guild).byType.get(type);
  return id ? guild.channels.cache.get(id) ?? null : null;
}

// Used to keep Tower from logging its own log channels (no feedback loops).
const isLogChannel = (guild, channelId) => entryFor(guild).ids.has(channelId);

function setOverride(guildId, type, channelId) {
  if (!overrides.has(guildId)) overrides.set(guildId, new Map());
  if (channelId) overrides.get(guildId).set(type, channelId);
  else overrides.get(guildId).delete(type);
  cache.delete(guildId); // rebuild on next use
}

const isOverridden = (guildId, type) => overrides.get(guildId)?.has(type) ?? false;
const clearOverrides = () => { overrides.clear(); cache.clear(); };

module.exports = { pickLogChannel, refresh, channelFor, isLogChannel, setOverride, isOverridden, clearOverrides };
