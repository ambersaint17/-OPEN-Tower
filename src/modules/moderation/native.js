const service = require('./service');
const actions = require('./actions');

// Actions taken through Discord's own moderation menu also become cases, so the history stays complete
// and those moderators' stats count. Actions Tower performed itself already have a case, and their
// audit entry names Tower (a bot), so they are skipped here.
// Limit: a member banned or kicked this way cannot be notified, because by the time Tower sees it
// they have already left. Use /ban and /kick when the member should receive a notice.
async function recordNative(guild, { type, user, executor, reason, durationMs = null, expiresAt = null }) {
  if (!executor || executor.bot) return null;
  let row = await service.createCase({
    guildId: guild.id, type, user, moderator: executor, reason: reason ?? 'No reason given',
    durationMs, expiresAt, source: 'discord',
  });
  if (type === 'timeout') {
    const status = await actions.sendDm(user, { row, guild });
    await service.setDmStatus(row.id, status);
    row = { ...row, dm_status: status };
  }
  await actions.postCase(guild, row, user);
  return row;
}

module.exports = { recordNative };
