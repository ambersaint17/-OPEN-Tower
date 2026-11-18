const {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, ChannelType,
} = require('discord.js');
const ui = require('../ui');
const { allow } = require('../lib/guard');
const { colors, logTypes } = require('../constants');
const channels = require('../modules/logging/channels');
const logger = require('../modules/logging/logger');
const { messageCache } = require('../modules/logging/state');

const choices = Object.entries(logTypes).map(([value, def]) => ({ name: def.label, value }));

const data = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('Manage the Tower logs')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('status').setDescription('Show every log type and the channel it writes to'))
  .addSubcommand((s) => s.setName('toggle').setDescription('Turn one log type on or off')
    .addStringOption((o) => o.setName('type').setDescription('Which log').setRequired(true).addChoices(...choices))
    .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
  .addSubcommand((s) => s.setName('channel').setDescription('Send one log type to a specific channel (leave the channel empty to go back to automatic)')
    .addStringOption((o) => o.setName('type').setDescription('Which log').setRequired(true).addChoices(...choices))
    .addChannelOption((o) => o.setName('channel').setDescription('Where it should go')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('refresh').setDescription('Re-scan channels after renaming or creating log channels'));

const reply = (interaction, container) => interaction.editReply(ui.edit(container));

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await allow(interaction, 'logsAdmin'))) return null;
  const { guild } = interaction;
  try {
    const sub = interaction.options.getSubcommand();

    if (sub === 'toggle') {
      const type = interaction.options.getString('type', true);
      const enabled = interaction.options.getBoolean('enabled', true);
      await logger.setEnabled(guild.id, type, enabled);
      return reply(interaction, ui.notice('Log Updated', `**${logTypes[type].label}** logging is now ${enabled ? 'on' : 'off'}.`, { icon: 'check' }));
    }

    if (sub === 'channel') {
      const type = interaction.options.getString('type', true);
      const target = interaction.options.getChannel('channel');
      if (target) {
        const perms = target.permissionsFor(guild.members.me);
        if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          return reply(interaction, ui.notice('Cannot Use That Channel', `Tower cannot view and send messages in ${target}.`, { accent: colors.alert, icon: 'warning' }));
        }
      }
      await logger.setChannel(guild.id, type, target?.id ?? null);
      return reply(interaction, ui.notice('Log Channel Updated',
        target ? `**${logTypes[type].label}** now goes to ${target}.` : `**${logTypes[type].label}** is back on automatic detection.`, { icon: 'check' }));
    }

    if (sub === 'refresh') channels.refresh(guild);

    const lines = Object.entries(logTypes).map(([type, def]) => {
      const channel = channels.channelFor(guild, type);
      const state = logger.isEnabled(guild.id, type) ? 'on' : 'off';
      const custom = channels.isOverridden(guild.id, type) ? ' (custom)' : '';
      return `${ui.fmt.code(state.padEnd(3))} ${def.label}: ${channel ? ui.fmt.channel(channel.id) + custom : ui.fmt.code(`no channel named ${def.channel}`)}`;
    });
    return reply(interaction, ui.notice(sub === 'refresh' ? 'Channels Refreshed' : 'Log Status', lines.join('\n'), {
      icon: 'scroll',
      fields: [['Messages In Memory', ui.fmt.code(messageCache.size), 'hash']],
    }));
  } catch (err) {
    console.error('[/logs]', err);
    return reply(interaction, ui.notice('Something Went Wrong', 'Tower hit an unexpected error. It has been logged.', { accent: colors.alert }));
  }
}

module.exports = { data, execute };
