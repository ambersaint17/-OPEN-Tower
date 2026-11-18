const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const actions = require('../modules/moderation/actions');
const service = require('../modules/moderation/service');
const views = require('../modules/moderation/views');
const { levelFor, rankLabel } = require('../modules/moderation/permissions');

const data = new SlashCommandBuilder()
  .setName('modstats')
  .setDescription('Moderation statistics')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('me').setDescription('Your own warns, timeouts, kicks, bans and more'))
  .addSubcommand((s) => s.setName('member').setDescription('Another moderator\'s stats (Head Moderator and up)')
    .addUserOption((o) => o.setName('user').setDescription('The moderator').setRequired(true)))
  .addSubcommand((s) => s.setName('team').setDescription('Everyone\'s activity over the last 30 days (Head Moderator and up)'));

const levelOf = (guild, member) => levelFor([...member.roles.cache.values()].map((r) => r.name), {
  isOwner: guild.ownerId === member.id,
  isAdmin: member.permissions.has(PermissionFlagsBits.Administrator),
});

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'me') {
      const ctx = await actions.contextFor(interaction, 'modstats');
      const stats = await service.moderatorStats(ctx.guild.id, ctx.moderator.id);
      return interaction.editReply(ui.edit(views.statsCard({ user: ctx.moderator, rank: rankLabel(ctx.level), stats })));
    }
    if (sub === 'member') {
      const ctx = await actions.contextFor(interaction, 'statsOthers');
      const target = await ctx.guild.members.fetch(interaction.options.getUser('user', true).id).catch(() => null);
      if (!target) throw new actions.ModError('That user is not in this server.');
      const stats = await service.moderatorStats(ctx.guild.id, target.id);
      return interaction.editReply(ui.edit(views.statsCard({ user: target, rank: rankLabel(levelOf(ctx.guild, target)), stats })));
    }
    const ctx = await actions.contextFor(interaction, 'statsTeam');
    return interaction.editReply(ui.edit(views.teamCard(await service.teamStats(ctx.guild.id, 30))));
  } catch (err) {
    if (err instanceof actions.ModError) return interaction.editReply(ui.edit(views.denied(err.message)));
    console.error('[/modstats]', err);
    return interaction.editReply(ui.edit(views.denied('Tower hit an unexpected error. It has been logged.', 'Something Went Wrong')));
  }
}

module.exports = { data, execute };
