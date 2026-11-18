const ui = require('../../ui');
const { tickets } = require('../../constants');
const service = require('./service');
const tracker = require('./tracker');
const views = require('./views');
const actions = require('./actions');

// Re-learns which channels are open tickets after a restart.
async function loadOpen() {
  tracker.clear();
  for (const ticket of await service.openTickets()) {
    const cfg = tickets.types[ticket.type];
    if (cfg && ticket.channel_id) tracker.add(ticket, cfg.minLevel);
  }
}

async function tick(client) {
  // Tickets whose "closing soon" countdown ran out.
  for (const ticket of await service.dueAutoClose()) {
    try {
      const guild = await actions.guildFor(client, ticket.guild_id);
      if (guild) await actions.closeTicket(guild, ticket, { by: client.user.id, reason: 'Closed automatically after inactivity' });
    } catch (err) {
      console.error('[tickets] auto-close failed:', err.message);
    }
  }

  // The member has been quiet for 2 days after staff replied: nudge staff once.
  for (const ticket of await service.dueHints()) {
    try {
      await service.markHintSent(ticket.id);
      const guild = await actions.guildFor(client, ticket.guild_id);
      const settings = guild && (await service.getSettings(guild.id));
      if (guild && settings) await actions.sendTo(guild, settings.handling_channel_id, ui.message(views.inactiveHint({ ticket, guildId: guild.id })));
    } catch (err) {
      console.error('[tickets] hint failed:', err.message);
    }
  }

  // Closed tickets whose grace period is over.
  for (const ticket of await service.dueDeletes()) {
    try {
      await service.markDeleted(ticket.id);
      const guild = await actions.guildFor(client, ticket.guild_id);
      const channel = guild && (await guild.channels.fetch(ticket.channel_id).catch(() => null));
      await channel?.delete('Closed ticket expired').catch(() => {});
    } catch (err) {
      console.error('[tickets] cleanup failed:', err.message);
    }
  }
}

function start(client) {
  const run = () => tick(client).catch((err) => console.error('[tickets] scheduler:', err.message));
  run();
  setInterval(run, tickets.schedulerMs).unref();
}

module.exports = { loadOpen, start, tick };
