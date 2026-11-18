const { Events, AuditLogEvent } = require('discord.js');
const { log } = require('../modules/logging/logger');
const { findAudit } = require('../modules/logging/audit');
const views = require('../modules/logging/views');
const { fmt } = require('../ui');
const { colors } = require('../constants');
const { recordNative } = require('../modules/moderation/native');

function build(type, title, icon, accent) {
  return async (ban) => {
    if (ban.partial) ban = await ban.fetch().catch(() => ban);
    const audit = await findAudit(ban.guild, type, { targetId: ban.user.id });
    const logType = type === AuditLogEvent.MemberBanAdd ? 'ban' : 'unban';
    await log(ban.guild, logType, (id) => views.entry({
      id, icon, title, accent,
      thumbnail: ban.user.displayAvatarURL({ extension: 'png', size: 256 }),
      fields: [
        ['Member', views.tag(ban.user), 'user'],
        ['Member ID', fmt.code(ban.user.id), 'hash'],
        ['Reason', ban.reason ?? audit?.reason ?? 'No reason given', 'flag'],
        ['By', audit?.executor ? views.tag(audit.executor) : 'Unknown', 'staff'],
      ],
    }), { actorId: audit?.executor?.id, targetId: ban.user.id });

    // Bans done through Discord's own menu also become cases.
    await recordNative(ban.guild, {
      type: logType, user: ban.user, executor: audit?.executor, reason: ban.reason ?? audit?.reason,
    }).catch((err) => console.error('[case]', err.message));
  };
}

const banAdd = build(AuditLogEvent.MemberBanAdd, 'Member Banned', 'ban', colors.alert);
const banRemove = build(AuditLogEvent.MemberBanRemove, 'Member Unbanned', 'check', colors.teal);

module.exports = [
  { name: Events.GuildBanAdd, execute: banAdd },
  { name: Events.GuildBanRemove, execute: banRemove },
];
