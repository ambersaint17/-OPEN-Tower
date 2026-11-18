const { Events, ActivityType } = require('discord.js');
const config = require('../config');
const sql = require('../db');
const service = require('../modules/verification/service');
const channels = require('../modules/logging/channels');
const inviteCache = require('../modules/logging/inviteCache');
const logger = require('../modules/logging/logger');
const { messageCache } = require('../modules/logging/state');
const emojis = require('../emojis');
const registry = require('../commands');
const ticketScheduler = require('../modules/tickets/scheduler');
const levelEngine = require('../modules/levels/engine');
const youtubePoller = require('../modules/youtube/poller');
const qotdScheduler = require('../modules/qotd/scheduler');
const giveawayScheduler = require('../modules/giveaway/scheduler');
const aiService = require('../modules/ai/service');
const captchaPool = require('../modules/verification/pool');
const commissionScheduler = require('../modules/commission/scheduler');
const staffActions = require('../modules/staff/actions');
const partnerActions = require('../modules/partner/actions');
const { ai: aiConfig } = require('../constants');
const boosters = require('../modules/levels/boosters');
const { fetchAll } = require('../lib/members');
const { verification } = require('../constants');

// Registers slash commands every time Tower starts, so no console is needed on the host.
// With GUILD_ID set they appear in your server immediately.
async function registerCommands(client) {
  const body = registry.json();
  await client.application.commands.set(body, config.guildId ?? undefined);
  console.log(`Registered ${body.length} command(s) ${config.guildId ? `to guild ${config.guildId}` : 'globally'}.`);
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Tower online as ${client.user.tag}`);

    // Emojis first, so every message Tower sends can use them.
    await emojis.syncApplicationEmojis(client).catch((err) => console.error('[emoji] sync failed:', err.message));
    await registerCommands(client).catch((err) => console.error('[commands] registration failed:', err.message));

    // The line shown in Tower's profile bubble.
    client.user.setPresence({
      status: 'online',
      activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: 'Above the noise.' }],
    });

    // Logging: switches, log channels, invite counters, and the housekeeping timers.
    await logger.loadSettings().catch((err) => console.error('[logging] could not load settings:', err.message));
    for (const guild of client.guilds.cache.values()) {
      channels.refresh(guild);
      await inviteCache.snapshot(guild);
    }
    // Levels: load settings, remove XP of anyone who left while Tower was offline, then start saving in batches.
    levelEngine.start(client);
    for (const guild of client.guilds.cache.values()) {
      try {
        await fetchAll(guild);
        const removed = await levelEngine.cleanupMissing(guild);
        if (removed) console.log(`[levels] ${guild.name}: removed XP of ${removed} member(s) who left while offline`);
        await levelEngine.loadEvent(guild.id);
        await levelEngine.configFor(guild);
        boosters.sweep(guild).catch((err) => console.error('[boosters] sweep:', err.message));
      } catch (err) {
        console.error('[levels] startup:', err.message);
      }
    }
    setInterval(() => client.guilds.cache.forEach((g) => boosters.sweep(g).catch(() => {})), 6 * 60 * 60 * 1000).unref();

    youtubePoller.start(client);
    qotdScheduler.start(client);
    giveawayScheduler.start(client);
    commissionScheduler.start(client);
    staffActions.startScheduler(client);
    partnerActions.startScheduler(client);
    // Draw a few captchas ahead of time, and keep one database connection awake so the first button press is as fast as the next.
    captchaPool.pool.refill();
    setInterval(() => Promise.resolve(sql`select 1`).catch(() => {}), 25_000).unref();
    // Questions from /ask are only kept for a while.
    const pruneAi = () => aiService.pruneLog(aiConfig.logRetentionDays).catch((err) => console.error('[ai] prune:', err.message));
    setTimeout(pruneAi, 60_000).unref();
    setInterval(pruneAi, 6 * 60 * 60 * 1000).unref();

    await ticketScheduler.loadOpen().catch((err) => console.error('[tickets] could not load open tickets:', err.message));
    ticketScheduler.start(client);
    setInterval(() => messageCache.prune(), 5 * 60 * 1000).unref();
    setInterval(() => logger.pruneEvents().catch((err) => console.error('[logging] prune failed:', err.message)), 6 * 60 * 60 * 1000).unref();

    const rows = await sql`select * from guild_settings where verification_enabled = true`;
    for (const settings of rows) {
      const guild = client.guilds.cache.get(settings.guild_id);
      if (!guild) continue;
      const fixed = await service.sweepGuild(guild, settings).catch((err) => {
        console.error('[sweep]', err.message);
        return 0;
      });
      if (fixed) console.log(`[sweep] ${guild.name}: gave the unverified role to ${fixed} member(s) who joined while offline`);
    }

    setInterval(() => service.cleanupStale().catch((err) => console.error('[cleanup]', err.message)),
      verification.staleSessionCleanupMs).unref();
  },
};
