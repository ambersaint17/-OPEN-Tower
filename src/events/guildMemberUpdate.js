const { Events, AuditLogEvent } = require('discord.js');
const { log } = require('../modules/logging/logger');
const { findAudit } = require('../modules/logging/audit');
const boosts = require('../modules/logging/boosts');
const views = require('../modules/logging/views');
const { fmt } = require('../ui');
const { diffLists, listOrNone } = require('../lib/text');
const { recordNative } = require('../modules/moderation/native');
const boosters = require('../modules/levels/boosters');
const dividers = require('../modules/dividers/sync');

const executorOf = (entry) => (entry?.executor ? views.tag(entry.executor) : 'Unknown');
const avatar = (user) => user.displayAvatarURL({ extension: 'png', size: 256 });

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    // Section divider roles follow the roles a member holds (onboarding, perks, anything). Runs even without an old copy to compare.
    if (oldMember.partial || oldMember.roles.cache.size !== newMember.roles.cache.size || [...newMember.roles.cache.keys()].some((id) => !oldMember.roles.cache.has(id))) dividers.schedule(newMember);
    if (oldMember.partial) return; // nothing to compare against
    const guild = newMember.guild;
    const user = newMember.user;
    const base = [['Member', views.tag(user), 'user'], ['Member ID', fmt.code(user.id), 'hash']];

    // Booster perks switch on or off with the boost.
    await Promise.resolve(boosters.onBoostChange(oldMember, newMember)).catch((err) => console.error('[boosters]', err.message));

    // Boosts: the thank-you, or a quiet staff note when a boost ends.
    if (!oldMember.premiumSince && newMember.premiumSince) await boosts.announceBoost(guild, newMember);
    if (oldMember.premiumSince && !newMember.premiumSince) {
      await log(guild, 'memberUpdate', (id) => views.entry({
        id, icon: 'heart', title: 'Boost Ended', thumbnail: avatar(user), fields: base,
      }), { targetId: user.id });
    }

    // Nickname.
    if (oldMember.nickname !== newMember.nickname) {
      const audit = await findAudit(guild, AuditLogEvent.MemberUpdate, { targetId: user.id });
      await log(guild, 'memberUpdate', (id) => views.entry({
        id, icon: 'edit', title: 'Nickname Changed', thumbnail: avatar(user),
        fields: [
          ...base,
          ['Before', fmt.code(oldMember.nickname ?? 'none'), 'minus'],
          ['After', fmt.code(newMember.nickname ?? 'none'), 'plus'],
          ['Changed By', executorOf(audit), 'staff'],
        ],
      }), { actorId: audit?.executor?.id, targetId: user.id });
    }

    // Roles.
    const ids = (m) => [...m.roles.cache.keys()].filter((r) => r !== guild.id);
    const { added, removed } = diffLists(ids(oldMember), ids(newMember));
    if (added.length || removed.length) {
      const audit = await findAudit(guild, AuditLogEvent.MemberRoleUpdate, { targetId: user.id });
      await log(guild, 'role', (id) => views.entry({
        id, icon: 'crown', title: 'Member Roles Changed', thumbnail: avatar(user),
        fields: [
          ...base,
          ...(added.length ? [['Added', listOrNone(added.map(fmt.role)), 'plus']] : []),
          ...(removed.length ? [['Removed', listOrNone(removed.map(fmt.role)), 'minus']] : []),
          ['Changed By', executorOf(audit), 'staff'],
        ],
      }), { actorId: audit?.executor?.id, targetId: user.id, detail: { added, removed } });
    }

    // Timeouts.
    const was = oldMember.communicationDisabledUntilTimestamp;
    const now = newMember.communicationDisabledUntilTimestamp;
    if (was !== now && (now > Date.now() || was > Date.now())) {
      const audit = await findAudit(guild, AuditLogEvent.MemberUpdate, { targetId: user.id, delay: false });
      const applied = now && now > Date.now();
      await log(guild, 'mod', (id) => views.entry({
        id, icon: 'lock', title: applied ? 'Member Timed Out' : 'Timeout Removed', thumbnail: avatar(user),
        accent: applied ? require('../constants').colors.alert : undefined,
        fields: [
          ...base,
          ...(applied ? [['Until', fmt.time(now, 'R'), 'hourglass']] : []),
          ['Reason', audit?.reason ?? 'No reason given', 'flag'],
          ['By', executorOf(audit), 'staff'],
        ],
      }), { actorId: audit?.executor?.id, targetId: user.id, detail: { until: now } });
      if (applied) {
        await recordNative(guild, {
          type: 'timeout', user, executor: audit?.executor, reason: audit?.reason,
          durationMs: now - Date.now(), expiresAt: new Date(now),
        }).catch((err) => console.error('[case]', err.message));
      }
    }
  },
};
