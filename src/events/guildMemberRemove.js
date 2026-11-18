const { Events, AuditLogEvent } = require('discord.js');
const service = require('../modules/verification/service');
const { log } = require('../modules/logging/logger');
const { findAudit } = require('../modules/logging/audit');
const views = require('../modules/logging/views');
const { fmt } = require('../ui');
const { colors } = require('../constants');
const { listOrNone } = require('../lib/text');
const { recordNative } = require('../modules/moderation/native');
const levelEngine = require('../modules/levels/engine');
const boosters = require('../modules/levels/boosters');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    const guild = member.guild;
    const user = member.user;

    // Drop any live captcha. Strikes are kept on purpose.
    await service.deleteSession(guild.id, user.id).catch(() => {});
    if (user.bot) return;

    // Leaving wipes the member's XP and any personal booster colour straight away.
    await levelEngine.forget(guild.id, user.id).catch((err) => console.error('[levels] forget:', err.message));
    await boosters.onLeave(member).catch(() => {});

    const avatar = user.displayAvatarURL({ extension: 'png', size: 256 });

    // Was it a kick? (Includes Tower's own removals after failed verification.)
    const kick = await findAudit(guild, AuditLogEvent.MemberKick, { targetId: user.id });
    if (kick) {
      await recordNative(guild, { type: 'kick', user, executor: kick.executor, reason: kick.reason })
        .catch((err) => console.error('[case]', err.message));
      return log(guild, 'kick', (id) => views.entry({
        id, icon: 'leave', title: 'Member Kicked', thumbnail: avatar, accent: colors.alert,
        fields: [
          ['Member', views.tag(user), 'user'],
          ['Member ID', fmt.code(user.id), 'hash'],
          ['Reason', kick.reason ?? 'No reason given', 'flag'],
          ['Kicked By', kick.executor ? views.tag(kick.executor) : 'Unknown', 'staff'],
        ],
      }), { actorId: kick.executor?.id, targetId: user.id });
    }

    // A ban is logged by the ban event, so skip the leave log for it.
    const ban = await findAudit(guild, AuditLogEvent.MemberBanAdd, { targetId: user.id, delay: false });
    if (ban) return;

    const roles = member.partial ? [] : [...member.roles.cache.keys()].filter((r) => r !== guild.id).map(fmt.role);
    return log(guild, 'leave', (id) => views.entry({
      id, icon: 'leave', title: 'Member Left', thumbnail: avatar,
      fields: [
        ['Member', views.tag(user), 'user'],
        ['Member ID', fmt.code(user.id), 'hash'],
        ['Joined', member.joinedTimestamp ? fmt.time(member.joinedTimestamp, 'R') : fmt.code('unknown'), 'calendar'],
        ['Roles', listOrNone(roles), 'crown'],
        ['Member Count', fmt.code(guild.memberCount), 'users'],
      ],
    }), { targetId: user.id });
  },
};
