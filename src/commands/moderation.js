const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const { moderation } = require('../constants');
const actions = require('../modules/moderation/actions');
const service = require('../modules/moderation/service');
const pending = require('../modules/moderation/pending');
const views = require('../modules/moderation/views');

// Commands appear for members with Timeout Members. Rank rules inside Tower decide who may actually use them.
const base = (name, description) => new SlashCommandBuilder()
  .setName(name)
  .setDescription(description)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

const DELETE_CHOICES = [
  { name: 'Do not delete', value: 0 },
  { name: 'Last hour', value: 3600 },
  { name: 'Last 24 hours', value: 86400 },
  { name: 'Last 7 days', value: 604800 },
];
const deleteLabel = (seconds) => DELETE_CHOICES.find((c) => c.value === seconds)?.name ?? 'Do not delete';

// Shared wrapper: defer privately, check rank, run, and turn any failure into a clear card.
async function run(interaction, action, work) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const ctx = await actions.contextFor(interaction, action);
    return await interaction.editReply(ui.edit(await work(ctx)));
  } catch (err) {
    if (err instanceof actions.ModError) return interaction.editReply(ui.edit(views.denied(err.message)));
    if (err.code === 50013) {
      return interaction.editReply(ui.edit(views.denied('Tower is missing a permission for that action. Check Tower\'s role in Server Settings > Roles.')));
    }
    console.error(`[/${interaction.commandName}]`, err);
    return interaction.editReply(ui.edit(views.denied('Tower hit an unexpected error. It has been logged.', 'Something Went Wrong')));
  }
}

const userOption = (o, description = 'The member') => o.setName('user').setDescription(description).setRequired(true);
const reasonOption = (o, required = false) => o.setName('reason').setDescription('Why').setRequired(required).setMaxLength(moderation.reasonMax);

const commands = [];

commands.push({
  data: base('warn', 'Warn a member').addUserOption((o) => userOption(o)).addStringOption((o) => reasonOption(o)),
  execute: (i) => run(i, 'warn', async (ctx) => views.done({
    row: await actions.warn(ctx, i.options.getUser('user', true), i.options.getString('reason')), title: 'Warning Issued',
  })),
});

commands.push({
  data: base('timeout', 'Time a member out')
    .addUserOption((o) => userOption(o))
    .addStringOption((o) => o.setName('duration').setDescription('For example 30m, 2h, 1d or 1h30m').setRequired(true))
    .addStringOption((o) => reasonOption(o)),
  execute: (i) => run(i, 'timeout', async (ctx) => views.done({
    row: await actions.timeout(ctx, i.options.getUser('user', true), i.options.getString('duration', true), i.options.getString('reason')),
    title: 'Member Timed Out',
  })),
});

commands.push({
  data: base('untimeout', 'Remove a member\'s timeout').addUserOption((o) => userOption(o)).addStringOption((o) => reasonOption(o)),
  execute: (i) => run(i, 'untimeout', async (ctx) => views.done({
    row: await actions.untimeout(ctx, i.options.getUser('user', true), i.options.getString('reason')), title: 'Timeout Removed',
  })),
});

commands.push({
  data: base('kick', 'Kick a member').addUserOption((o) => userOption(o)).addStringOption((o) => reasonOption(o, true)),
  execute: (i) => run(i, 'kick', async (ctx) => views.done({
    row: await actions.kick(ctx, i.options.getUser('user', true), i.options.getString('reason', true)), title: 'Member Kicked',
  })),
});

commands.push({
  data: base('ban', 'Ban a member (asks for confirmation first)')
    .addUserOption((o) => userOption(o, 'The member or user to ban'))
    .addStringOption((o) => reasonOption(o, true))
    .addIntegerOption((o) => o.setName('delete_messages').setDescription('Also delete their recent messages').addChoices(...DELETE_CHOICES)),
  execute: (i) => run(i, 'ban', async (ctx) => {
    const user = i.options.getUser('user', true);
    const reason = await actions.validateBan(ctx, user, i.options.getString('reason', true));
    const deleteSeconds = i.options.getInteger('delete_messages') ?? 0;
    const token = pending.add({ moderatorId: ctx.moderator.id, userId: user.id, reason, deleteSeconds });
    return views.banConfirm({ user, reason, token, deleteLabel: deleteLabel(deleteSeconds) });
  }),
});

commands.push({
  data: base('unban', 'Lift a ban')
    .addStringOption((o) => o.setName('user_id').setDescription('The numeric ID of the banned user').setRequired(true))
    .addStringOption((o) => reasonOption(o)),
  execute: (i) => run(i, 'unban', async (ctx) => views.done({
    row: await actions.unban(ctx, i.options.getString('user_id', true), i.options.getString('reason')), title: 'Member Unbanned',
  })),
});

commands.push({
  data: base('note', 'Add a private staff note about a member')
    .addUserOption((o) => userOption(o))
    .addStringOption((o) => o.setName('note').setDescription('What staff should know').setRequired(true).setMaxLength(moderation.reasonMax)),
  execute: (i) => run(i, 'note', async (ctx) => views.done({
    row: await actions.note(ctx, i.options.getUser('user', true), i.options.getString('note', true)), title: 'Note Added',
  })),
});

commands.push({
  data: base('cases', 'Look up moderation cases')
    .addSubcommand((s) => s.setName('member').setDescription('A member\'s case history').addUserOption((o) => userOption(o)))
    .addSubcommand((s) => s.setName('view').setDescription('One case in full')
      .addIntegerOption((o) => o.setName('number').setDescription('The case number').setRequired(true).setMinValue(1))),
  execute: (i) => run(i, 'cases', async (ctx) => {
    if (i.options.getSubcommand() === 'view') {
      const number = i.options.getInteger('number', true);
      const row = await service.getCase(ctx.guild.id, number);
      if (!row) throw new actions.ModError(`There is no case #${number}.`);
      const user = await i.client.users.fetch(row.user_id).catch(() => null);
      return views.caseDetail(row, user?.displayAvatarURL({ extension: 'png', size: 256 }));
    }
    const user = i.options.getUser('user', true);
    const [cases, total] = await Promise.all([service.listCases(ctx.guild.id, user.id, 10), service.countCases(ctx.guild.id, user.id)]);
    return views.casesList({ user, cases, total });
  }),
});

// /case edit and /case void need different ranks, so the rank check happens per subcommand.
commands.push({
  data: base('case', 'Edit or void a case')
    .addSubcommand((s) => s.setName('edit').setDescription('Change a case\'s reason')
      .addIntegerOption((o) => o.setName('number').setDescription('The case number').setRequired(true).setMinValue(1))
      .addStringOption((o) => reasonOption(o, true)))
    .addSubcommand((s) => s.setName('void').setDescription('Cancel a mistaken case (the action itself is not undone)')
      .addIntegerOption((o) => o.setName('number').setDescription('The case number').setRequired(true).setMinValue(1))
      .addStringOption((o) => reasonOption(o, true))),
  execute: (i) => run(i, i.options.getSubcommand() === 'void' ? 'voidCase' : 'cases', async (ctx) => {
    const number = i.options.getInteger('number', true);
    const reason = i.options.getString('reason', true);
    if (i.options.getSubcommand() === 'void') return views.voided(await actions.voidCase(ctx, number, reason));
    const row = await actions.editCase(ctx, number, reason);
    return views.done({ row, title: 'Case Updated' });
  }),
});

module.exports = commands;
