const ui = require('../../ui');
const service = require('./service');
const tracker = require('./tracker');
const views = require('./views');
const { levelOf } = require('./actions');

// Watches messages inside open tickets: when the member last spoke, when staff first answered,
// and whether a pending "closing soon" notice should be cancelled.
async function onMessage(message) {
  const entry = tracker.get(message.channelId);
  if (!entry || message.author.bot) return;

  if (message.author.id === entry.openerId) {
    if (tracker.throttled(entry.id, 'opener')) await service.touchOpener(entry.id);
    if (entry.pendingClose) {
      entry.pendingClose = false;
      await service.clearInactive(entry.id);
      await message.channel.send(ui.message(views.inactiveCancelled()));
    }
    return;
  }

  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member || levelOf(message.guild, member) < entry.minLevel) return; // people added to the ticket do not count as staff
  if (tracker.throttled(entry.id, 'staff')) await service.touchStaff(entry.id, member.id);
}

module.exports = { onMessage };
