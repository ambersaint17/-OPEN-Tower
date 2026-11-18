const {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, ChannelType,
} = require('discord.js');
const ui = require('../ui');
const { colors, tickets } = require('../constants');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const service = require('../modules/tickets/service');
const views = require('../modules/tickets/views');
const actions = require('../modules/tickets/actions');
const { parseDuration, formatDuration } = require('../modules/moderation/duration');
const { clip } = require('../lib/text');

const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Ticket tools')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('setup').setDescription('Set up tickets and post the panel (Administrator and up)')
    .addChannelOption((o) => o.setName('panel_channel').setDescription('Where the ticket menu is posted').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption((o) => o.setName('category').setDescription('The category new ticket channels are created in').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    .addChannelOption((o) => o.setName('handling_channel').setDescription('Where staff are told about new tickets').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption((o) => o.setName('logs_channel').setDescription('Transcripts of general support and report tickets').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption((o) => o.setName('admin_logs_channel').setDescription('Transcripts of services, partnership and application tickets').addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o.setName('reviews_channel').setDescription('Where ratings and feedback are posted').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) => s.setName('panel').setDescription('Re-post or refresh the ticket panel'))
  .addSubcommand((s) => s.setName('channels').setDescription('Change only the log and feedback channels (Administrator and up)')
    .addChannelOption((o) => o.setName('logs_channel').setDescription('Transcripts of general support and report tickets').addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o.setName('admin_logs_channel').setDescription('Transcripts of services, partnership and application tickets').addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o.setName('reviews_channel').setDescription('Where ratings and feedback are posted').addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o.setName('handling_channel').setDescription('Where staff are told about new tickets').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) => s.setName('add').setDescription('Add someone to this ticket')
    .addUserOption((o) => o.setName('user').setDescription('Who to add').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove someone from this ticket')
    .addUserOption((o) => o.setName('user').setDescription('Who to remove').setRequired(true)))
  .addSubcommand((s) => s.setName('close').setDescription('Close this ticket')
    .addStringOption((o) => o.setName('reason').setDescription('Why it is being closed').setMaxLength(300)))
  .addSubcommand((s) => s.setName('inactive').setDescription('Warn the member this ticket will close soon unless they reply')
    .addIntegerOption((o) => o.setName('duration').setDescription('How long they have').setRequired(true).addChoices(...tickets.inactiveChoices))
    .addStringOption((o) => o.setName('custom').setDescription('Optional exact time instead, like 30h or 4d')))
  .addSubcommand((s) => s.setName('block').setDescription('Stop a member from opening tickets')
    .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(300)))
  .addSubcommand((s) => s.setName('unblock').setDescription('Let a member open tickets again')
    .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)));

async function postPanel(guild, settings) {
  const channel = await guild.channels.fetch(settings.panel_channel_id);
  let existing = null;
  if (settings.panel_message_id) {
    existing = await channel.messages.fetch({ message: settings.panel_message_id, force: true }).catch(() => null);
  }
  let sent = null;
  if (existing) {
    try { sent = await existing.edit(ui.edit(views.panel())); } catch (err) { if (err.code !== 10008) throw err; }
  }
  if (!sent) sent = await channel.send(ui.message(views.panel()));
  await service.savePanel(guild.id, sent.id);
}

const canSend = (me, channel) => channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);

async function setup(interaction, ctx) {
  const { guild, options } = interaction;
  const panel = options.getChannel('panel_channel', true);
  const category = options.getChannel('category', true);
  const handling = options.getChannel('handling_channel', true);
  const logs = options.getChannel('logs_channel', true);
  const adminLogs = options.getChannel('admin_logs_channel');
  const reviews = options.getChannel('reviews_channel');

  const issues = [];
  for (const [name, channel] of [['panel', panel], ['staff', handling], ['logs', logs],
    ...(adminLogs ? [['admin logs', adminLogs]] : []), ...(reviews ? [['reviews', reviews]] : [])]) {
    if (!canSend(ctx.botMember, channel)) issues.push(`Tower cannot view and send messages in the ${name} channel ${channel}.`);
  }
  if (!category.permissionsFor(ctx.botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
    issues.push(`Tower needs View Channel and Manage Channels on the category **${category.name}**.`);
  }
  if (issues.length) throw new modActions.ModError(issues.join('\n'));

  const settings = await service.saveSettings(guild.id, {
    panelChannelId: panel.id, categoryId: category.id, handlingChannelId: handling.id,
    logsChannelId: logs.id, adminLogsChannelId: adminLogs?.id, reviewsChannelId: reviews?.id,
  });
  await postPanel(guild, { ...settings, panel_message_id: settings.panel_message_id });
  return ui.notice('Tickets Ready', 'The ticket panel is live.', {
    icon: 'ticket', accent: colors.teal,
    fields: [
      ['Panel', ui.fmt.channel(panel.id), 'hash'],
      ['New Tickets Go In', fmt(category.name), 'folder'],
      ['Staff Notified In', ui.fmt.channel(handling.id), 'staff'],
      ...channelFields(settings),
    ],
  });
}

// The channels that receive transcripts and reviews, as they are currently saved.
function channelFields(settings) {
  const show = (id) => (id ? ui.fmt.channel(id) : ui.fmt.code('not set'));
  return [
    ['Support And Report Transcripts', show(settings.logs_channel_id), 'scroll'],
    ['Services, Partnership And Application Transcripts', show(settings.admin_logs_channel_id), 'lock'],
    ['Ratings And Feedback', show(settings.reviews_channel_id), 'star'],
  ];
}
const fmt = (text) => ui.fmt.code(clip(text, 60));

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  const reply = (container) => interaction.editReply(ui.edit(container));
  try {
    if (sub === 'setup') return reply(await setup(interaction, await modActions.contextFor(interaction, 'ticketSetup')));
    if (sub === 'channels') {
      const ctx = await modActions.contextFor(interaction, 'ticketSetup');
      await actions.requireSettings(interaction.guild.id);
      const given = {
        logsChannelId: interaction.options.getChannel('logs_channel')?.id,
        adminLogsChannelId: interaction.options.getChannel('admin_logs_channel')?.id,
        reviewsChannelId: interaction.options.getChannel('reviews_channel')?.id,
        handlingChannelId: interaction.options.getChannel('handling_channel')?.id,
      };
      if (!Object.values(given).some(Boolean)) throw new modActions.ModError('Pick at least one channel to change.');
      for (const name of ['logs_channel', 'admin_logs_channel', 'reviews_channel', 'handling_channel']) {
        const channel = interaction.options.getChannel(name);
        if (channel && !canSend(ctx.botMember, channel)) throw new modActions.ModError(`Tower cannot view and send messages in ${channel}.`);
      }
      const settings = await service.updateChannels(interaction.guild.id, given);
      return reply(ui.notice('Channels Updated', null, { icon: 'check', accent: colors.teal, fields: channelFields(settings) }));
    }
    if (sub === 'panel') {
      await modActions.contextFor(interaction, 'ticketSetup');
      await postPanel(interaction.guild, await actions.requireSettings(interaction.guild.id));
      return reply(ui.notice('Panel Updated', 'The ticket panel has been refreshed.', { icon: 'check' }));
    }

    if (sub === 'block' || sub === 'unblock') {
      await modActions.contextFor(interaction, 'ticketBlock');
      const settings = await actions.requireSettings(interaction.guild.id);
      const user = interaction.options.getUser('user', true);
      if (user.bot || user.id === interaction.user.id) throw new modActions.ModError('Pick a different member.');
      let title;
      if (sub === 'block') {
        await service.block(interaction.guild.id, user.id, clip(interaction.options.getString('reason') ?? 'No reason given', 300), interaction.user.id);
        title = 'Member Blocked From Tickets';
      } else {
        if (!(await service.unblock(interaction.guild.id, user.id))) throw new modActions.ModError('That member is not blocked.');
        title = 'Member Unblocked From Tickets';
      }
      await actions.sendTo(interaction.guild, settings.logs_channel_id, ui.message(ui.notice(title, null, {
        icon: sub === 'block' ? 'ban' : 'check', accent: sub === 'block' ? colors.alert : colors.teal,
        fields: [['Member', ui.fmt.user(user.id), 'user'], ['By', ui.fmt.user(interaction.user.id), 'staff']],
      })));
      return reply(ui.notice(title, `${ui.fmt.user(user.id)} was ${sub === 'block' ? 'blocked' : 'unblocked'}.`, { icon: 'check' }));
    }

    // Everything below runs inside a ticket channel and needs the right rank for that ticket type.
    await modActions.contextFor(interaction, 'ticketstats');
    const ticket = await actions.ticketHere(interaction);

    if (sub === 'add') {
      await actions.addUser(interaction, ticket, interaction.options.getUser('user', true));
      return reply(ui.notice('Member Added', 'They can now see this ticket.', { icon: 'plus' }));
    }
    if (sub === 'remove') {
      await actions.removeUser(interaction, ticket, interaction.options.getUser('user', true));
      return reply(ui.notice('Member Removed', 'They can no longer see this ticket.', { icon: 'minus' }));
    }
    if (sub === 'close') {
      const result = await actions.closeTicket(interaction.guild, ticket, {
        by: interaction.user.id, reason: interaction.options.getString('reason'),
      });
      return reply(ui.notice('Ticket Closed', `The transcript was saved. ${actions.dmNote(result)}`, { icon: 'lock' }));
    }
    if (sub === 'inactive') {
      let ms = interaction.options.getInteger('duration', true);
      const custom = interaction.options.getString('custom');
      if (custom) {
        ms = parseDuration(custom);
        if (!ms) throw new modActions.ModError('Use a time like `30h` or `4d`.');
        if (ms < 3_600_000 || ms > 14 * 86_400_000) throw new modActions.ModError('Choose between 1 hour and 14 days.');
      }
      if (ticket.status !== 'open') throw new modActions.ModError('That ticket is not open.');
      const closeAt = await actions.markInactive(interaction, ticket, ms);
      return reply(ui.notice('Warning Sent', `The member has ${formatDuration(ms)} to reply. The ticket closes ${ui.fmt.time(closeAt, 'R')} otherwise.`, { icon: 'hourglass' }));
    }
  } catch (err) {
    if (err instanceof modActions.ModError) return reply(modViews.denied(err.message));
    console.error(`[/ticket ${sub}]`, err);
    return reply(modViews.denied('Tower hit an unexpected error. It has been logged.', 'Something Went Wrong'));
  }
  return undefined;
}

module.exports = { data, execute };
