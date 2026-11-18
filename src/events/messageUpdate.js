const { Events } = require('discord.js');
const { messageCache } = require('../modules/logging/state');
const { snapshot } = require('../modules/logging/messageCache');
const channels = require('../modules/logging/channels');
const { isTicketChannelName } = require('../lib/channels');
const { log } = require('../modules/logging/logger');
const views = require('../modules/logging/views');
const { fmt } = require('../ui');
const { quote } = require('../lib/text');
const automod = require('../modules/automod');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild) return;
    if (isTicketChannelName(newMessage.channel?.name)) return;
    if (newMessage.partial) newMessage = await newMessage.fetch().catch(() => null);
    if (!newMessage || newMessage.author?.bot || newMessage.webhookId || newMessage.system) return;
    if (channels.isLogChannel(newMessage.guild, newMessage.channelId)) return;
    // Editing a message into something forbidden does not get around the rules.
    if (await automod.inspect(newMessage, { edited: true }).catch((err) => { console.error('[automod]', err.message); return false; })) return;

    const cached = messageCache.get(newMessage.id);
    const before = cached?.content ?? (oldMessage.partial ? null : oldMessage.content);
    const after = newMessage.content ?? '';
    messageCache.set(snapshot(newMessage)); // keep the memory current for the next edit or delete

    if (before !== null && before === after) return; // embed unfurls and pins are not edits

    await log(newMessage.guild, 'messageEdit', (id) => views.entry({
      id,
      icon: 'edit',
      title: 'Message Edited',
      thumbnail: newMessage.author.displayAvatarURL({ extension: 'png', size: 256 }),
      blocks: [
        `**Before**\n${before === null ? '*Unavailable. Tower had not seen the original.*' : quote(before || '*empty*', 900)}`,
        `**After**\n${quote(after || '*empty*', 900)}`,
      ],
      fields: [
        ['Author', views.tag(newMessage.author), 'user'],
        ['Author ID', fmt.code(newMessage.author.id), 'hash'],
        ['Channel', fmt.channel(newMessage.channelId), 'chat'],
        ['Message', `[Jump to message](${newMessage.url})`, 'link'],
      ],
    }), { actorId: newMessage.author.id, targetId: newMessage.id, detail: { channelId: newMessage.channelId } });
  },
};
