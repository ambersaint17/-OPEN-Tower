const { SlashCommandBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const ui = require('../ui');
const { commissions: cfg } = require('../constants');
const c = require('../lib/commission');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const { levelFor, can } = require('../modules/moderation/permissions');
const ticketService = require('../modules/tickets/service');
const service = require('../modules/commission/service');
const actions = require('../modules/commission/actions');
const views = require('../modules/commission/views');

const { fmt } = ui;
const { ModError } = modActions;
const reply = (interaction, container) => interaction.editReply(ui.edit(container));
const STAFF_ONLY = new Set(['new', 'list', 'status', 'edit', 'note', 'paid', 'review', 'reviews']);
const statusChoices = c.STATUSES.map((s) => ({ name: s.label, value: s.key }));

const isManager = (member) => can(levelFor([...member.roles.cache.values()].map((r) => r.name), {
  isOwner: member.guild.ownerId === member.id, isAdmin: member.permissions.has(PermissionFlagsBits.Administrator),
}), 'commissionManage');

async function load(interaction, ctx) {
  const raw = interaction.options.getString('id', true).replace('#', '').trim();
  const row = /^\d+$/.test(raw) ? await service.get(Number(raw), ctx.guild.id) : null;
  if (!row) throw new ModError('There is no commission with that number. Pick one from the list that appears as you type, or use `/commission list`.');
  return row;
}
const when = (text) => {
  const date = c.parseWhen(text);
  if (date === undefined) throw new ModError('Deadline not understood. Use `5d`, `2w`, `36h`, a date like `2026-12-24` or `2026-12-24 18:00` (UTC), or `none`.');
  return date;
};

const subs = {
  async new(interaction, ctx) {
    const ticket = await ticketService.byChannel(interaction.channelId).catch(() => null);
    const clientId = interaction.options.getUser('client')?.id ?? ticket?.opener_id;
    if (!clientId) throw new ModError('Say who the commission is for with the `client` option, or run this inside their ticket.');
    const deadlineText = interaction.options.getString('deadline');
    const row = await actions.create(ctx.guild, interaction.user.id, {
      clientId, title: interaction.options.getString('title', true), price: interaction.options.getString('price') ?? '',
      description: interaction.options.getString('description') ?? '', status: interaction.options.getString('status') ?? 'quoted',
      deadline: deadlineText ? when(deadlineText) : null, ticketChannelId: ticket?.channel_id ?? null,
    });
    let where = null;
    if (interaction.options.getBoolean('notify') !== false) where = await actions.reachClient(interaction.client, row, views.clientCard(row, 'New Commission'));
    return reply(interaction, ui.notice('Commission Created', `${fmt.code(`#${row.id}`)} **${row.title}** for ${fmt.user(clientId)}.${where ? `\nThe client was told ${actions.whereText(where)}.` : ''}`, {
      icon: 'check', fields: [['Status', c.statusInfo(row.status).label, 'check'], ['Ticket', row.ticket_channel_id ? fmt.channel(row.ticket_channel_id) : 'Not linked (run this in a ticket to link it)', 'ticket']],
    }));
  },

  async list(interaction, ctx) {
    const status = interaction.options.getString('status') ?? 'open';
    const rows = await service.list({ guildId: ctx.guild.id, status, clientId: interaction.options.getUser('client')?.id ?? null });
    return reply(interaction, views.listCard(rows, status === 'open' ? 'Open Commissions' : status === 'all' ? 'All Commissions' : `${c.statusInfo(status).label} Commissions`));
  },

  async info(interaction, ctx) {
    const row = await load(interaction, ctx);
    const manager = isManager(interaction.member);
    if (!manager && row.client_id !== interaction.user.id) throw new ModError('You can only look at your own commissions.');
    return reply(interaction, manager ? views.staffCard(row, await service.getReview(row.id)) : views.clientCard(row, 'Your Commission'));
  },

  async status(interaction, ctx) {
    const row = await load(interaction, ctx);
    const status = interaction.options.getString('status', true);
    const result = await actions.changeStatus({
      client: interaction.client, guild: ctx.guild, row, status, staffId: interaction.user.id, note: interaction.options.getString('note') ?? '',
      notify: interaction.options.getBoolean('notify') !== false, askReview: interaction.options.getBoolean('ask_review') !== false,
    });
    const lines = [`${fmt.code(`#${row.id}`)} is now **${c.statusInfo(status).label}**.`];
    if (result.notified !== null || interaction.options.getBoolean('notify') !== false) lines.push(`The client was told ${actions.whereText(result.notified)}.`);
    if (status === 'completed') lines.push(result.review ? `A review request was sent ${actions.whereText(result.review)}.` : 'No review request was sent.');
    if (status === 'completed' && !result.row.paid) lines.push('**Not marked as paid yet.** Use `/commission paid` when it is.');
    return reply(interaction, ui.notice('Status Updated', lines.join('\n'), { icon: 'check' }));
  },

  async edit(interaction, ctx) {
    const row = await load(interaction, ctx);
    const o = interaction.options;
    const deadline = o.getString('deadline') !== null ? when(o.getString('deadline')) : undefined;
    const updated = await service.update(row.id, { title: o.getString('title'), price: o.getString('price'), description: o.getString('description'), deadline });
    return reply(interaction, views.staffCard(updated, await service.getReview(row.id)));
  },

  async note(interaction, ctx) {
    const row = await load(interaction, ctx);
    const updated = await service.addNote(row.id, interaction.user.id, interaction.options.getString('text', true));
    return reply(interaction, ui.notice('Note Saved', `Added to ${fmt.code(`#${row.id}`)}. Only staff can see notes.`, { icon: 'check', fields: [['Notes On This Commission', fmt.code(updated.notes.length), 'scroll']] }));
  },

  async paid(interaction, ctx) {
    const row = await load(interaction, ctx);
    const paid = interaction.options.getBoolean('paid') !== false;
    await service.setPaid(row.id, paid);
    return reply(interaction, ui.notice(paid ? 'Marked As Paid' : 'Marked As Not Paid', `${fmt.code(`#${row.id}`)} **${row.title}**.`, { icon: 'check' }));
  },

  async review(interaction, ctx) {
    const row = await load(interaction, ctx);
    const where = await actions.requestReview(interaction.client, ctx.guild, row);
    if (!where) throw new ModError('The review request could not be delivered: their DMs are closed and there is no ticket to post in.');
    return reply(interaction, ui.notice('Review Requested', `Sent ${actions.whereText(where)}. ${cfg.reviewChannelId ? `The review appears in <#${cfg.reviewChannelId}>` : 'The review appears in your review channel'} when they fill it in, and \`/commission reviews\` always shows it.`, { icon: 'check' }));
  },

  async reviews(interaction, ctx) {
    return reply(interaction, views.reviewsSummary(await service.recentReviews(ctx.guild.id, 10), await service.reviewStats(ctx.guild.id)));
  },

  async mine(interaction, ctx) {
    return reply(interaction, views.mineCard(await service.list({ guildId: ctx.guild.id, status: 'all', clientId: interaction.user.id, limit: 15 })));
  },
};

module.exports = {
  data: new SlashCommandBuilder().setName('commission').setDescription('Track commissions and client reviews')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('new').setDescription('Start tracking a commission (run it inside the ticket to link it)')
      .addStringOption((o) => o.setName('title').setDescription('What is being made').setRequired(true).setMaxLength(100))
      .addUserOption((o) => o.setName('client').setDescription('The client (default: the person who opened this ticket)'))
      .addStringOption((o) => o.setName('price').setDescription('For example $50 or 5,000 Robux').setMaxLength(60))
      .addStringOption((o) => o.setName('deadline').setDescription('5d, 2w, 2026-12-24 or 2026-12-24 18:00 (UTC)'))
      .addStringOption((o) => o.setName('description').setDescription('The details the client agreed to').setMaxLength(600))
      .addStringOption((o) => o.setName('status').setDescription('Where it starts (default: Quoted)').addChoices(...statusChoices))
      .addBooleanOption((o) => o.setName('notify').setDescription('Tell the client (default: yes)')))
    .addSubcommand((s) => s.setName('list').setDescription('Commissions, soonest deadline first')
      .addStringOption((o) => o.setName('status').setDescription('Which ones (default: all open)').addChoices({ name: 'All open', value: 'open' }, { name: 'Everything', value: 'all' }, ...statusChoices))
      .addUserOption((o) => o.setName('client').setDescription('Only this client')))
    .addSubcommand((s) => s.setName('info').setDescription('Everything about one commission').addStringOption((o) => o.setName('id').setDescription('Which commission').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Change the status and tell the client')
      .addStringOption((o) => o.setName('id').setDescription('Which commission').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('status').setDescription('The new status').setRequired(true).addChoices(...statusChoices))
      .addStringOption((o) => o.setName('note').setDescription('A line for the history (the client does not see it)').setMaxLength(200))
      .addBooleanOption((o) => o.setName('notify').setDescription('Tell the client (default: yes)'))
      .addBooleanOption((o) => o.setName('ask_review').setDescription('When completing: send the review request (default: yes)')))
    .addSubcommand((s) => s.setName('edit').setDescription('Change the title, price, details or deadline')
      .addStringOption((o) => o.setName('id').setDescription('Which commission').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('title').setDescription('New title').setMaxLength(100))
      .addStringOption((o) => o.setName('price').setDescription('New price').setMaxLength(60))
      .addStringOption((o) => o.setName('description').setDescription('New details').setMaxLength(600))
      .addStringOption((o) => o.setName('deadline').setDescription('New deadline, or none')))
    .addSubcommand((s) => s.setName('note').setDescription('Add a private note, never shown to the client')
      .addStringOption((o) => o.setName('id').setDescription('Which commission').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('text').setDescription('The note').setRequired(true).setMaxLength(500)))
    .addSubcommand((s) => s.setName('paid').setDescription('Mark a commission as paid')
      .addStringOption((o) => o.setName('id').setDescription('Which commission').setRequired(true).setAutocomplete(true))
      .addBooleanOption((o) => o.setName('paid').setDescription('Paid (default) or not paid')))
    .addSubcommand((s) => s.setName('review').setDescription('Ask the client for a review now')
      .addStringOption((o) => o.setName('id').setDescription('Which commission').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('reviews').setDescription('Recent reviews and your average rating'))
    .addSubcommand((s) => s.setName('mine').setDescription('Your own commissions and their status')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    try {
      const ctx = STAFF_ONLY.has(sub) ? await modActions.contextFor(interaction, 'commissionManage') : { guild: interaction.guild };
      return await subs[sub](interaction, ctx);
    } catch (err) {
      if (!(err instanceof ModError)) throw err;
      return interaction.editReply(ui.edit(modViews.denied(err.message)));
    }
  },

  // Staff see every commission. A client only sees their own.
  async autocomplete(interaction) {
    try {
      const typed = interaction.options.getFocused().toLowerCase();
      const rows = await service.list({ guildId: interaction.guildId, status: 'all', clientId: isManager(interaction.member) ? null : interaction.user.id, limit: 50 });
      await interaction.respond(rows.filter((r) => `#${r.id} ${r.title}`.toLowerCase().includes(typed)).slice(0, 25)
        .map((r) => ({ name: `#${r.id} · ${r.title} (${c.statusInfo(r.status).label})`.slice(0, 100), value: String(r.id) })));
    } catch {
      await interaction.respond([]).catch(() => {});
    }
  },
};
