const { Events, AuditLogEvent } = require('discord.js');
const service = require('../modules/verification/service');
const raidGuard = require('../modules/verification/raidGuard');
const { log } = require('../modules/logging/logger');
const { findAudit } = require('../modules/logging/audit');
const inviteCache = require('../modules/logging/inviteCache');
const views = require('../modules/logging/views');
const { assessAccount } = require('../lib/risk');
const { fmt } = require('../ui');
const { colors, tiers } = require('../constants');

const avatar = (user) => user.displayAvatarURL({ extension: 'png', size: 256 });

async function logBot(member) {
  const audit = await findAudit(member.guild, AuditLogEvent.BotAdd, { targetId: member.id });
  await log(member.guild, 'bot', (id) => views.entry({
    id, icon: 'cpu', title: 'Bot Added', thumbnail: avatar(member.user),
    fields: [
      ['Bot', views.tag(member.user), 'cpu'],
      ['Bot ID', fmt.code(member.id), 'hash'],
      ['Added By', audit?.executor ? views.tag(audit.executor) : 'Unknown', 'staff'],
    ],
  }), { actorId: audit?.executor?.id, targetId: member.id });
}

async function logJoin(member) {
  const risk = assessAccount(member.user);
  const invite = await inviteCache.findUsed(member.guild);
  await log(member.guild, 'join', (id) => views.entry({
    id,
    icon: 'join',
    title: 'Member Joined',
    thumbnail: avatar(member.user),
    accent: risk.tier === 3 ? colors.alert : colors.teal,
    fields: [
      ['Member', views.tag(member.user), 'user'],
      ['Member ID', fmt.code(member.id), 'hash'],
      ['Account Created', fmt.time(member.user.createdTimestamp, 'R'), 'calendar'],
      ['Risk Tier', fmt.bold(tiers[risk.tier].label), 'shield'],
      ['Invite', invite ? `${fmt.code(invite.code)}${invite.inviterId ? ` by ${fmt.user(invite.inviterId)}` : ''}` : fmt.code('unknown'), 'link'],
      ['Member Count', fmt.code(member.guild.memberCount), 'users'],
    ],
  }), { targetId: member.id, detail: { risk: risk.tier, invite: invite?.code ?? null } });
}

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return logBot(member);

    // Verification comes first and must never wait on logging.
    const settings = await service.getSettings(member.guild.id);
    if (settings?.verification_enabled && settings.unverified_role_id) {
      await member.roles.add(settings.unverified_role_id, 'Tower: new member awaiting verification')
        .catch((err) => console.error('[join] could not add the unverified role:', err.message));
      await raidGuard.onJoin(member.guild, settings).catch((err) => console.error('[raid]', err.message));
    }

    await logJoin(member).catch((err) => console.error('[join-log]', err.message));
  },
};
