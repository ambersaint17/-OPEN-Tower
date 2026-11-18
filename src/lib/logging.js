const { message } = require('../ui');

// Posts a card to the configured log channel. Never throws: a broken log channel
// must not break verification itself.
async function postLog(guild, settings, container) {
  if (!settings?.log_channel_id) return;
  try {
    const channel = await guild.channels.fetch(settings.log_channel_id);
    if (!channel?.isTextBased()) return;
    await channel.send({ ...message(container), allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[log] could not post to the log channel:', err.message);
  }
}

module.exports = { postLog };
