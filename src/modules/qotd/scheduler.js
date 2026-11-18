const { dueDay } = require('../../lib/qotd');
const service = require('./service');
const actions = require('./actions');

async function tick(client) {
  for (const s of await service.allActive()) {
    try {
      const day = dueDay({ hour: s.post_hour, minute: s.post_minute, offsetMin: s.utc_offset_min, lastDay: s.last_post_day }, Date.now());
      if (!day) continue;
      await service.setLastDay(s.guild_id, day); // claimed first, so a slow post can never run twice
      const guild = await client.guilds.fetch(s.guild_id).catch(() => null);
      if (guild) await actions.postNext(guild, s);
    } catch (err) {
      console.error('[qotd]', err.message);
    }
  }
}

function start(client) {
  const run = () => tick(client).catch((err) => console.error('[qotd] scheduler:', err.message));
  setTimeout(run, 30_000).unref();
  setInterval(run, 60_000).unref();
}

module.exports = { tick, start };
