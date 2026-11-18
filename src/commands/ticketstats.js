const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const service = require('../modules/tickets/service');
const views = require('../modules/tickets/views');

const data = new SlashCommandBuilder()
  .setName('ticketstats')
  .setDescription('Ticket statistics')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('me').setDescription('Your tickets claimed and closed, response time and rating'))
  .addSubcommand((s) => s.setName('member').setDescription('Another staff member\'s ticket stats (Head Moderator and up)')
    .addUserOption((o) => o.setName('user').setDescription('The staff member').setRequired(true)))
  .addSubcommand((s) => s.setName('team').setDescription('Everyone\'s ticket activity over the last 30 days (Head Moderator and up)'));

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  const reply = (container) => interaction.editReply(ui.edit(container));
  try {
    if (sub === 'me') {
      const ctx = await modActions.contextFor(interaction, 'ticketstats');
      return reply(views.statsCard({ user: ctx.moderator, stats: await service.staffStats(ctx.guild.id, ctx.moderator.id) }));
    }
    if (sub === 'member') {
      const ctx = await modActions.contextFor(interaction, 'ticketStatsOthers');
      const target = await ctx.guild.members.fetch(interaction.options.getUser('user', true).id).catch(() => null);
      if (!target) throw new modActions.ModError('That user is not in this server.');
      return reply(views.statsCard({ user: target, stats: await service.staffStats(ctx.guild.id, target.id) }));
    }
    const ctx = await modActions.contextFor(interaction, 'ticketStatsTeam');
    const rows = await service.teamStats(ctx.guild.id);
    const names = new Map();
    for (const row of rows) {
      const m = await ctx.guild.members.fetch(row.staff_id).catch(() => null);
      names.set(row.staff_id, m?.displayName ?? row.staff_id);
    }
    return reply(views.teamCard(rows, names));
  } catch (err) {
    if (err instanceof modActions.ModError) return reply(modViews.denied(err.message));
    console.error('[/ticketstats]', err);
    return reply(modViews.denied('Tower hit an unexpected error. It has been logged.', 'Something Went Wrong'));
  }
}

module.exports = { data, execute };
