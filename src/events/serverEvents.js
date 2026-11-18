const { Events, AuditLogEvent, ChannelType } = require('discord.js');
const { log } = require('../modules/logging/logger');
const { findAudit, sleep } = require('../modules/logging/audit');
const channels = require('../modules/logging/channels');
const inviteCache = require('../modules/logging/inviteCache');
const views = require('../modules/logging/views');
const { fmt } = require('../ui');
const { colors, logging } = require('../constants');
const { clip, listOrNone } = require('../lib/text');
const { isTicketChannelName } = require('../lib/channels');
const ticketActions = require('../modules/tickets/actions');

const by = (audit) => (audit?.executor ? views.tag(audit.executor) : 'Unknown');
const kind = (channel) => ChannelType[channel.type] ?? 'Unknown';
const overwrites = (channel) =>
  JSON.stringify([...channel.permissionOverwrites.cache.values()]
    .map((o) => [o.id, o.allow.bitfield.toString(), o.deny.bitfield.toString()]).sort());

const events = [];

// ---------- channels ----------
events.push({
  name: Events.ChannelCreate,
  async execute(channel) {
    if (!channel.guild || isTicketChannelName(channel.name)) return;
    channels.refresh(channel.guild);
    const audit = await findAudit(channel.guild, AuditLogEvent.ChannelCreate, { targetId: channel.id });
    await log(channel.guild, 'server', (id) => views.entry({
      id, icon: 'plus', title: 'Channel Created', accent: colors.teal,
      fields: [
        ['Channel', fmt.channel(channel.id), 'hash'],
        ['Type', fmt.code(kind(channel)), 'info'],
        ['Category', fmt.code(channel.parent?.name ?? 'none'), 'globe'],
        ['Created By', by(audit), 'staff'],
      ],
    }), { actorId: audit?.executor?.id, targetId: channel.id });
  },
});

events.push({
  name: Events.ChannelDelete,
  async execute(channel) {
    if (!channel.guild) return;
    await ticketActions.onChannelDeleted(channel).catch(() => {});
    if (isTicketChannelName(channel.name)) return;
    channels.refresh(channel.guild);
    const audit = await findAudit(channel.guild, AuditLogEvent.ChannelDelete, { targetId: channel.id });
    await log(channel.guild, 'server', (id) => views.entry({
      id, icon: 'trash', title: 'Channel Deleted', accent: colors.alert,
      fields: [
        ['Channel', fmt.code(`#${channel.name}`), 'hash'],
        ['Type', fmt.code(kind(channel)), 'info'],
        ['Category', fmt.code(channel.parent?.name ?? 'none'), 'globe'],
        ['Deleted By', by(audit), 'staff'],
      ],
    }), { actorId: audit?.executor?.id, targetId: channel.id });
  },
});

events.push({
  name: Events.ChannelUpdate,
  async execute(before, after) {
    if (!after.guild || isTicketChannelName(after.name)) return;
    if (before.name !== after.name || before.parentId !== after.parentId) channels.refresh(after.guild);

    const changes = [];
    if (before.name !== after.name) changes.push(`Name: ${fmt.code(before.name)} to ${fmt.code(after.name)}`);
    if (before.topic !== after.topic) changes.push(`Topic: ${fmt.code(clip(before.topic ?? 'none', 80))} to ${fmt.code(clip(after.topic ?? 'none', 80))}`);
    if (before.parentId !== after.parentId) changes.push(`Category: ${fmt.code(before.parent?.name ?? 'none')} to ${fmt.code(after.parent?.name ?? 'none')}`);
    if (before.nsfw !== after.nsfw) changes.push(`Age restricted: ${fmt.code(before.nsfw)} to ${fmt.code(after.nsfw)}`);
    if (before.rateLimitPerUser !== after.rateLimitPerUser) changes.push(`Slowmode: ${fmt.code(before.rateLimitPerUser ?? 0)}s to ${fmt.code(after.rateLimitPerUser ?? 0)}s`);
    if (before.permissionOverwrites && overwrites(before) !== overwrites(after)) changes.push('Permission overwrites were changed');
    if (!changes.length) return;

    const audit = await findAudit(after.guild, AuditLogEvent.ChannelUpdate, { targetId: after.id });
    await log(after.guild, 'server', (id) => views.entry({
      id, icon: 'wrench', title: 'Channel Updated', description: changes.join('\n'),
      fields: [['Channel', fmt.channel(after.id), 'hash'], ['Changed By', by(audit), 'staff']],
    }), { actorId: audit?.executor?.id, targetId: after.id });
  },
});

// ---------- roles ----------
events.push({
  name: Events.GuildRoleCreate,
  async execute(role) {
    const audit = await findAudit(role.guild, AuditLogEvent.RoleCreate, { targetId: role.id });
    await log(role.guild, 'role', (id) => views.entry({
      id, icon: 'plus', title: 'Role Created', accent: colors.teal,
      fields: [['Role', fmt.role(role.id), 'crown'], ['Created By', by(audit), 'staff']],
    }), { actorId: audit?.executor?.id, targetId: role.id });
  },
});

events.push({
  name: Events.GuildRoleDelete,
  async execute(role) {
    const audit = await findAudit(role.guild, AuditLogEvent.RoleDelete, { targetId: role.id });
    await log(role.guild, 'role', (id) => views.entry({
      id, icon: 'trash', title: 'Role Deleted', accent: colors.alert,
      fields: [['Role', fmt.code(role.name), 'crown'], ['Deleted By', by(audit), 'staff']],
    }), { actorId: audit?.executor?.id, targetId: role.id });
  },
});

events.push({
  name: Events.GuildRoleUpdate,
  async execute(before, after) {
    const changes = [];
    if (before.name !== after.name) changes.push(`Name: ${fmt.code(before.name)} to ${fmt.code(after.name)}`);
    if (before.color !== after.color) changes.push(`Colour: ${fmt.code(before.hexColor)} to ${fmt.code(after.hexColor)}`);
    if (before.hoist !== after.hoist) changes.push(`Shown separately: ${fmt.code(before.hoist)} to ${fmt.code(after.hoist)}`);
    if (before.mentionable !== after.mentionable) changes.push(`Mentionable: ${fmt.code(before.mentionable)} to ${fmt.code(after.mentionable)}`);
    const gained = before.permissions.missing(after.permissions);
    const lost = after.permissions.missing(before.permissions);
    if (gained.length) changes.push(`Permissions added: ${listOrNone(gained.map(fmt.code), 12)}`);
    if (lost.length) changes.push(`Permissions removed: ${listOrNone(lost.map(fmt.code), 12)}`);
    if (!changes.length) return; // position moves alone are not worth a log

    const audit = await findAudit(after.guild, AuditLogEvent.RoleUpdate, { targetId: after.id });
    await log(after.guild, 'role', (id) => views.entry({
      id, icon: 'crown', title: 'Role Updated', description: changes.join('\n'),
      fields: [['Role', fmt.role(after.id), 'crown'], ['Changed By', by(audit), 'staff']],
    }), { actorId: audit?.executor?.id, targetId: after.id });
  },
});

// ---------- the server itself ----------
events.push({
  name: Events.GuildUpdate,
  async execute(before, after) {
    const changes = [];
    if (before.name !== after.name) changes.push(`Name: ${fmt.code(before.name)} to ${fmt.code(after.name)}`);
    if (before.icon !== after.icon) changes.push('Server icon was changed');
    if (before.banner !== after.banner) changes.push('Server banner was changed');
    if (before.description !== after.description) changes.push('Server description was changed');
    if (before.verificationLevel !== after.verificationLevel) changes.push(`Verification level: ${fmt.code(before.verificationLevel)} to ${fmt.code(after.verificationLevel)}`);
    if (before.afkChannelId !== after.afkChannelId) changes.push('AFK channel was changed');
    if (before.systemChannelId !== after.systemChannelId) changes.push('System messages channel was changed');
    if (before.vanityURLCode !== after.vanityURLCode) changes.push('Vanity invite was changed');
    if (!changes.length) return;

    const audit = await findAudit(after, AuditLogEvent.GuildUpdate, {});
    await log(after, 'server', (id) => views.entry({
      id, icon: 'globe', title: 'Server Updated', description: changes.join('\n'),
      fields: [['Changed By', by(audit), 'staff']],
    }), { actorId: audit?.executor?.id });
  },
});

// ---------- invites ----------
events.push({
  name: Events.InviteCreate,
  async execute(invite) {
    const guild = invite.channel?.guild;
    if (!guild) return;
    inviteCache.onCreate({ ...invite, guild, code: invite.code, uses: invite.uses, inviter: invite.inviter });
    await log(guild, 'invite', (id) => views.entry({
      id, icon: 'link', title: 'Invite Created', accent: colors.teal,
      fields: [
        ['Code', fmt.code(invite.code), 'hash'],
        ['Channel', fmt.channel(invite.channel.id), 'chat'],
        ['Created By', invite.inviter ? views.tag(invite.inviter) : 'Unknown', 'staff'],
        ['Max Uses', fmt.code(invite.maxUses || 'unlimited'), 'users'],
        ['Expires', invite.expiresTimestamp ? fmt.time(invite.expiresTimestamp, 'R') : fmt.code('never'), 'hourglass'],
      ],
    }), { actorId: invite.inviter?.id, targetId: invite.code });
  },
});

events.push({
  name: Events.InviteDelete,
  async execute(invite) {
    const guild = invite.channel?.guild;
    if (!guild) return;
    inviteCache.onDelete({ guild, code: invite.code });
    await log(guild, 'invite', (id) => views.entry({
      id, icon: 'trash', title: 'Invite Deleted', accent: colors.alert,
      fields: [['Code', fmt.code(invite.code), 'hash'], ['Channel', fmt.channel(invite.channel.id), 'chat']],
    }), { targetId: invite.code });
  },
});

// ---------- webhooks ----------
events.push({
  name: Events.WebhooksUpdate,
  async execute(channel) {
    const guild = channel.guild;
    if (!guild) return;
    await sleep(logging.auditDelayMs);
    let audit = null;
    let action = 'updated';
    for (const [type, label] of [
      [AuditLogEvent.WebhookCreate, 'created'],
      [AuditLogEvent.WebhookUpdate, 'updated'],
      [AuditLogEvent.WebhookDelete, 'deleted'],
    ]) {
      audit = await findAudit(guild, type, { delay: false });
      if (audit) { action = label; break; }
    }
    await log(guild, 'webhook', (id) => views.entry({
      id, icon: 'code', title: `Webhook ${action[0].toUpperCase()}${action.slice(1)}`,
      fields: [['Channel', fmt.channel(channel.id), 'chat'], ['By', by(audit), 'staff']],
    }), { actorId: audit?.executor?.id, targetId: channel.id, detail: { action } });
  },
});

// ---------- AutoMod ----------
events.push({
  name: Events.AutoModerationActionExecution,
  async execute(execution) {
    const guild = execution.guild;
    const ruleName = execution.autoModerationRule?.name ?? `Rule ${execution.ruleId}`;
    await log(guild, 'automod', (id) => views.entry({
      id, icon: 'zap', title: 'AutoMod Triggered', accent: colors.alert,
      description: execution.content ? `${fmt.bold('Flagged content')}\n> ${clip(execution.content, 500).replace(/\n/g, '\n> ')}` : undefined,
      fields: [
        ['Member', fmt.user(execution.userId), 'user'],
        ['Member ID', fmt.code(execution.userId), 'hash'],
        ['Rule', fmt.code(ruleName), 'shield'],
        ['Channel', execution.channelId ? fmt.channel(execution.channelId) : fmt.code('unknown'), 'chat'],
        ['Matched', fmt.code(clip(execution.matchedKeyword ?? execution.matchedContent ?? 'n/a', 60)), 'flag'],
      ],
    }), { targetId: execution.userId, detail: { ruleId: execution.ruleId, channelId: execution.channelId } });
  },
});

module.exports = events;
