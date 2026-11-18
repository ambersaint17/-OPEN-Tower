const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const { colors } = require('../constants');
const { allow } = require('../lib/guard');
const sync = require('../modules/dividers/sync');

const { fmt } = ui;
const TITLES = { pings: 'Pings', interests: 'Interests', levels: 'Levels' };

module.exports = {
  data: new SlashCommandBuilder().setName('dividers').setDescription('Section divider roles like PINGS and INTERESTS (Administrator and up)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('status').setDescription('Which divider roles Tower found, and whether it can manage them'))
    .addSubcommand((s) => s.setName('sync').setDescription('Fix everyone now, including members who got roles before this existed')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await allow(interaction, 'dividersAdmin'))) return null;
    const { guild } = interaction;

    if (interaction.options.getSubcommand() === 'status') {
      const sections = sync.status(guild);
      const lines = sections.map((s) => `${s.roleId ? (s.tooHigh ? '⚠️' : '✅') : '❌'} **${TITLES[s.key] ?? s.key}**: ${s.roleId ? `${fmt.role(s.roleId)}${s.tooHigh ? ' (above Tower\'s role, so Tower cannot give it)' : ''}` : `no role found. Create one named ${s.names.map((n) => `\`▬▬▬ ${n.toUpperCase()} ▬▬▬\``).join(' or ')}`}`);
      return interaction.editReply(ui.edit(ui.notice('Divider Roles', `${lines.join('\n')}\n\nAnyone who holds a role from a section automatically gets its divider, and loses it when they hold none.`, {
        icon: 'settings', accent: sections.every((s) => s.roleId && !s.tooHigh) ? colors.teal : colors.cobalt,
      })));
    }

    const totals = await sync.syncGuild(guild);
    return interaction.editReply(ui.edit(ui.notice('Dividers Synced', `Checked **${totals.checked}** members and fixed **${totals.changed}**.`, {
      icon: 'check', accent: colors.teal,
      fields: [['Dividers Added', fmt.code(totals.added), 'plus'], ['Dividers Removed', fmt.code(totals.removed), 'minus'], ...(totals.failed ? [['Could Not Change', `${fmt.code(totals.failed)} members. Move Tower's role above the divider roles.`, 'warning']] : [])],
    })));
  },
};
