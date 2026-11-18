const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, InteractionContextType, MessageFlags,
} = require('discord.js');
const ui = require('../ui');
const { allow } = require('../lib/guard');
const { colors } = require('../constants');
const service = require('../modules/verification/service');
const views = require('../modules/verification/views');
const { postLog } = require('../lib/logging');

const data = new SlashCommandBuilder()
  .setName('verification')
  .setDescription('Manage Tower verification')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('setup').setDescription('Configure verification and post the panel')
    .addChannelOption((o) => o.setName('verify_channel').setDescription('Channel for the verification panel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption((o) => o.setName('log_channel').setDescription('Channel for verification logs').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addRoleOption((o) => o.setName('unverified_role').setDescription('Role given to new members').setRequired(true))
    .addRoleOption((o) => o.setName('verified_role').setDescription('Role given after verifying').setRequired(true)))
  .addSubcommand((s) => s.setName('panel').setDescription('Re-post or refresh the verification panel'))
  .addSubcommand((s) => s.setName('status').setDescription('Show the current verification configuration'))
  .addSubcommand((s) => s.setName('raid').setDescription('Turn raid mode on or off')
    .addStringOption((o) => o.setName('mode').setDescription('on or off').setRequired(true)
      .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
  .addSubcommand((s) => s.setName('approve').setDescription('Manually verify a member')
    .addUserOption((o) => o.setName('user').setDescription('Member to verify').setRequired(true)));

async function postPanel(guild, settings) {
  const channel = await guild.channels.fetch(settings.verify_channel_id);

  // force:true asks Discord instead of trusting the cache. Tower does not listen for message
  // deletions, so a panel you deleted by hand can still look "present" in the cache.
  let existing = null;
  if (settings.panel_message_id && settings.panel_channel_id === channel.id) {
    existing = await channel.messages
      .fetch({ message: settings.panel_message_id, force: true })
      .catch(() => null);
  }

  let sent = null;
  if (existing) {
    try {
      sent = await existing.edit(ui.edit(views.panel(interaction.guild.name)));
    } catch (err) {
      if (err.code !== 10008) throw err; // 10008 = Unknown Message: it was deleted, so post a new one
    }
  }
  if (!sent) sent = await channel.send(ui.message(views.panel(interaction.guild.name)));

  await service.savePanel(guild.id, channel.id, sent.id);
}

const reply = (interaction, container) => interaction.editReply(ui.edit(container));
const problem = (interaction, text) => reply(interaction, ui.notice('Cannot Continue', text, { accent: colors.alert }));

async function setup(interaction) {
  const { guild, options } = interaction;
  const verifyChannel = options.getChannel('verify_channel', true);
  const logChannel = options.getChannel('log_channel', true);
  const unverified = options.getRole('unverified_role', true);
  const verified = options.getRole('verified_role', true);
  const me = guild.members.me;

  const issues = [];
  if (unverified.id === verified.id) issues.push('The unverified and verified roles must be different.');
  for (const [label, role] of [['Unverified', unverified], ['Verified', verified]]) {
    if (role.id === guild.id || role.managed || !role.editable) {
      issues.push(`${label} role ${role} cannot be managed by Tower. Move Tower's role above it in Server Settings > Roles.`);
    }
  }
  for (const [label, channel] of [['Verify', verifyChannel], ['Log', logChannel]]) {
    const perms = channel.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      issues.push(`Tower cannot view and send messages in the ${label.toLowerCase()} channel ${channel}.`);
    }
  }
  if (issues.length) return problem(interaction, issues.join('\n'));

  const settings = await service.saveSettings(guild.id, {
    verifyChannelId: verifyChannel.id, logChannelId: logChannel.id,
    unverifiedRoleId: unverified.id, verifiedRoleId: verified.id,
  });
  await postPanel(guild, settings);
  return reply(interaction, views.status({ settings: await service.getSettings(guild.id), activeSessions: 0 }));
}

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await allow(interaction, 'verificationAdmin'))) return null;
  const { guild } = interaction;
  const sub = interaction.options.getSubcommand();

  try {
    if (sub === 'setup') return await setup(interaction);

    const settings = await service.getSettings(guild.id);
    if (!settings) return problem(interaction, 'Run `/verification setup` first.');

    if (sub === 'status') {
      return reply(interaction, views.status({ settings, activeSessions: await service.activeSessionCount(guild.id) }));
    }

    if (sub === 'panel') {
      await postPanel(guild, settings);
      return reply(interaction, ui.notice('Panel Updated', 'The verification panel has been posted.'));
    }

    if (sub === 'raid') {
      const on = interaction.options.getString('mode', true) === 'on';
      const flipped = await service.setRaidMode(guild.id, on);
      if (!flipped) return reply(interaction, ui.notice('No Change', `Raid mode is already ${on ? 'on' : 'off'}.`));
      const auditId = await service.logEvent({
        guildId: guild.id, userId: interaction.user.id, type: on ? 'raid_on' : 'raid_off', detail: { manual: true },
      });
      await postLog(guild, settings, views.logRaid({ on, trigger: `Manual by ${ui.fmt.user(interaction.user.id)}`, auditId }));
      return reply(interaction, ui.notice(on ? 'Raid Mode Enabled' : 'Raid Mode Disabled',
        on ? 'Verification is paused. Use `/verification approve` for members you trust.' : 'Verification has resumed.'));
    }

    if (sub === 'approve') {
      const target = interaction.options.getUser('user', true);
      if (target.bot) return problem(interaction, 'Bots cannot be verified.');
      const member = await guild.members.fetch(target.id).catch(() => null);
      if (!member) return problem(interaction, 'That user is not in this server.');
      if (member.roles.cache.has(settings.verified_role_id)) return reply(interaction, views.alreadyVerified());

      const role = await service.grantVerified(member, settings, `Tower: manually approved by ${interaction.user.tag}`);
      await service.deleteSession(guild.id, target.id);
      await service.clearState(guild.id, target.id);
      const auditId = await service.logEvent({
        guildId: guild.id, userId: target.id, type: 'approved_manual', detail: { approvedBy: interaction.user.id },
      });
      await postLog(guild, settings, views.logApproved({
        userId: target.id, avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
        approvedBy: interaction.user.id, verifiedRoleId: role.id, auditId,
      }));
      return reply(interaction, ui.notice('Member Verified', `${target} has been verified.`, {
        fields: [['Audit ID', ui.fmt.code(auditId)]],
      }));
    }
  } catch (err) {
    console.error(`[/verification ${sub}]`, err);
    return reply(interaction, ui.notice('Something Went Wrong', 'Tower hit an unexpected error. It has been logged.', { accent: colors.alert }));
  }
}

module.exports = { data, execute };
