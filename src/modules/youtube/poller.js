const { youtube } = require('../../constants');
const yt = require('../../lib/youtube');
const service = require('./service');
const views = require('./views');

let running = false;
const inFlight = new Set(); // guild ids being checked right now, so the timer and /youtube check never double-post

async function postEntry(client, settings, entry, isShort, { ping = true } = {}) {
  const guild = await client.guilds.fetch(settings.guild_id).catch(() => null);
  const channel = guild && (await guild.channels.fetch(settings.post_channel_id).catch(() => null));
  if (!channel?.isTextBased()) throw new Error('The post channel no longer exists, or Tower cannot see it.');
  return channel.send(views.buildPost({ entry, isShort, settings, ping }));
}

// Checks one server's channel. The first run only records existing videos, so nothing old is posted.
async function pollGuild(client, settings, opts = {}) {
  if (inFlight.has(settings.guild_id)) return { recorded: 0, posted: 0, busy: true };
  inFlight.add(settings.guild_id);
  try {
    return await checkGuild(client, settings, opts);
  } finally {
    inFlight.delete(settings.guild_id);
  }
}

async function checkGuild(client, settings, { fetchImpl, now = Date.now() } = {}) {
  const feed = await yt.fetchFeed(settings.youtube_channel_id, { fetchImpl });
  const seen = await service.seenIds(settings.guild_id, feed.entries.map((e) => e.id));

  if (!settings.primed) {
    for (const e of feed.entries) await service.markSeen(settings.guild_id, e.id, false);
    await service.setPrimed(settings.guild_id);
    return { recorded: feed.entries.length, posted: 0 };
  }

  const unseen = feed.entries.filter((e) => !seen.has(e.id));
  const fresh = unseen.filter((e) => now - e.published < youtube.maxAgeMs).sort((a, b) => a.published - b.published);
  for (const e of unseen) if (!fresh.includes(e)) await service.markSeen(settings.guild_id, e.id, false); // too old to announce

  let posted = 0;
  for (const entry of fresh) {
    const isShort = await yt.classify(entry, { fetchImpl });
    if (isShort && !settings.post_shorts) { await service.markSeen(settings.guild_id, entry.id, false); continue; }
    await postEntry(client, settings, entry, isShort);
    await service.markSeen(settings.guild_id, entry.id, true); // only after it was really posted
    posted++;
  }
  return { recorded: 0, posted };
}

async function tick(client) {
  if (running) return;
  running = true;
  try {
    for (const settings of await service.allActive()) {
      try {
        await pollGuild(client, settings);
        await service.markChecked(settings.guild_id, null);
      } catch (err) {
        console.error('[youtube]', err.message);
        await service.markChecked(settings.guild_id, String(err.message).slice(0, 300)).catch(() => {});
      }
    }
  } finally {
    running = false;
  }
}

function start(client) {
  const run = () => tick(client).catch((err) => console.error('[youtube] poller:', err.message));
  setTimeout(run, 20_000).unref();
  setInterval(run, youtube.pollMs).unref();
}

module.exports = { pollGuild, postEntry, tick, start };
