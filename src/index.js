const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const config = require('./config');
const sql = require('./db');
const { initCaptcha } = require('./lib/captcha');
const { startHealthServer } = require('./health');

async function main() {
  initCaptcha();               // fails fast if assets/fonts/captcha.ttf is missing
  await sql`select 1`;         // fails fast if DATABASE_URL is wrong

  // Every intent below must also be enabled in the Developer Portal (Bot > Privileged Gateway Intents)
  // where Discord marks it privileged: Server Members and Message Content.
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildWebhooks,
      GatewayIntentBits.AutoModerationExecution,
    ],
    // Lets edit and delete events arrive for messages Tower did not see being sent.
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
    // Memory diet for small free hosts. Tower keeps its own short-lived message memory (for deleted and edited
    // text), so discord.js does not need to remember messages, reactions, presences or stage instances as well.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      PresenceManager: 0,
      StageInstanceManager: 0,
      GuildStickerManager: 0,
      GuildScheduledEventManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      threads: { interval: 3600, lifetime: 4 * 3600 },
      // Users who are no longer in any shared server's member list are dropped from memory.
      users: { interval: 3600, filter: () => (user) => user.id !== client?.user?.id },
    },
  });

  const eventsDir = path.join(__dirname, 'events');
  for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
    // A file may export one event or an array of related events.
    for (const event of [].concat(require(path.join(eventsDir, file)))) {
      const run = (...args) => event.execute(...args).catch((err) => console.error(`[event ${event.name}]`, err));
      if (event.once) client.once(event.name, run);
      else client.on(event.name, run);
    }
  }

  const shutdown = async () => {
    client.destroy();
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

  startHealthServer({ getStatus: () => ({ ok: client.isReady() }) });
  await client.login(config.token);
}

main().catch((err) => {
  console.error('Tower failed to start:', err.message);
  process.exit(1);
});
