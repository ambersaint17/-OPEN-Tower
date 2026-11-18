const { partners: cfg } = require('../../constants');
const { matchesChannelName } = require('../../lib/channels');
const { createTtlCache } = require('../../lib/ttlcache');
const service = require('./service');
const views = require('./views');

// A message at the bottom of the partnership channel: how to mute it. Whenever something new is posted there,
// the old one is replaced so it is always the last message. Sent first, deleted after, so there is never a gap.
const timers = new Map();
const current = new Map();           // "guild:channel" -> the sticky message's ID
const busy = new Set();
const idsCache = createTtlCache(60_000);
let warnedAt = 0;

// The channels that carry the sticky message: the partnership channel, plus any added with /partners sticky.
async function channelIds(guild) {
  const hit = idsCache.get(guild.id);
  if (hit) return hit;
  const settings = await service.getSettings(guild.id);
  const ids = new Set();
  if (settings.sticky_enabled) {
    const main = settings.channel_id ?? [...guild.channels.cache.values()].find((c) => cfg.channelNames.some((n) => matchesChannelName(c.name, n)))?.id;
    if (main) ids.add(main);
    for (const id of settings.sticky_channels) ids.add(id);
  }
  return idsCache.set(guild.id, ids);
}
const forget = (guildId) => idsCache.delete(guildId);

async function refresh(channel) {
  const key = `${channel.guild.id}:${channel.id}`;
  if (busy.has(key)) { schedule(channel); return; }
  busy.add(key);
  try {
    const oldId = current.get(key) ?? await service.getSticky(channel.guild.id, channel.id).catch(() => null);
    const sent = await channel.send(views.stickyPayload(channel.id));
    current.set(key, sent.id);
    await service.setSticky(channel.guild.id, channel.id, sent.id).catch(() => {});
    if (oldId && oldId !== sent.id) await channel.messages.delete(oldId).catch(() => {});
  } catch (err) {
    if (Date.now() - warnedAt > 10 * 60_000) { warnedAt = Date.now(); console.warn(`[partner] could not post the mute guide in #${channel.name}: ${err.message}`); }
  } finally { busy.delete(key); }
}

function schedule(channel) {
  const key = `${channel.guild.id}:${channel.id}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); refresh(channel).catch(() => {}); }, cfg.sticky.debounceMs).unref());
}

// Called for every message. Cheap for channels that have no sticky message.
async function onMessage(message) {
  if (!message.guild || message.system) return;
  if (current.get(`${message.guild.id}:${message.channelId}`) === message.id) return;       // that is the sticky message itself
  if (!(await channelIds(message.guild)).has(message.channelId)) return;
  schedule(message.channel);
}

module.exports = { onMessage, refresh, schedule, forget, channelIds, current };
