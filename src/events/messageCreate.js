const { Events, MessageType } = require('discord.js');
const { messageCache } = require('../modules/logging/state');
const { snapshot } = require('../modules/logging/messageCache');
const channels = require('../modules/logging/channels');
const boosts = require('../modules/logging/boosts');
const ticketActivity = require('../modules/tickets/activity');
const aiTickets = require('../modules/ai/tickets');
const { isTicketChannelName } = require('../lib/channels');
const levelEngine = require('../modules/levels/engine');
const automod = require('../modules/automod');
const partnerSticky = require('../modules/partner/sticky');

const TIER_MESSAGES = {
  [MessageType.GuildBoostTier1]: 1,
  [MessageType.GuildBoostTier2]: 2,
  [MessageType.GuildBoostTier3]: 3,
};

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild) return;

    // Discord's own "someone boosted" system messages drive the thank-you.
    if (message.type === MessageType.GuildBoost) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (member) await boosts.announceBoost(message.guild, member);
      return;
    }
    if (TIER_MESSAGES[message.type]) return boosts.announceTier(message.guild, TIER_MESSAGES[message.type]);

    // Ticket channels are private: track replies, but never keep their text in the message memory.
    if (isTicketChannelName(message.channel?.name)) {
      await ticketActivity.onMessage(message).catch((err) => console.error('[tickets] activity:', err.message));
      await aiTickets.onMessage(message).catch((err) => console.error('[ai] ticket message:', err.message));
      return;
    }

    // The partnership channel keeps its "how to mute" message at the bottom, whoever posted (Tower's own ads included).
    partnerSticky.onMessage(message).catch((err) => console.error('[partner] sticky:', err.message));

    if (message.system || message.author?.bot || message.webhookId) return;

    // AutoMod looks first. A removed message earns no XP and is not kept in the message memory.
    if (await automod.inspect(message).catch((err) => { console.error('[automod]', err.message); return false; })) return;

    // Levels: only a running total is kept, never what was said.
    await levelEngine.onMessage(message).catch((err) => console.error('[levels] xp:', err.message));

    if (channels.isLogChannel(message.guild, message.channelId)) return;
    if (!message.content && !message.attachments.size && !message.stickers.size) return;

    messageCache.set(snapshot(message));
  },
};
