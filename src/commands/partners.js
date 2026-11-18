const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const service = require('../modules/partner/service');
const actions = require('../modules/partner/actions');
const handlers = require('../modules/partner/handlers');
const views = require('../modules/partner/views');
const sticky = require('../modules/partner/sticky');

const { ModError } = modActions;
const jumpOf = (row) => (row.channel_id && row.message_id ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.message_id}` : null);
const reply = (interaction, container) => interaction.editReply(ui.edit(container));

async function load(interaction, ctx) {
  const raw = interaction.options.getString('id', true).replace('#', '').trim();
  const row = /^\d+$/.test(raw) ? await service.get(Number(raw), ctx.guild.id) : null;
  if (!row) throw new ModError('There is no partnership with that number. Pick one from the list that appears as you type.');
  return row;
}

const subs = {
  async setup(interaction, ctx) {
    const settings = { ...(await service.getSettings(ctx.guild.id)) };
    const channel = interaction.options.getChannel('channel'); const min = interaction.options.getInteger('min_members'); const role = interaction.options.getRole('partner_role');
    if (channel) settings.channel_id = channel.id;
    if (min !== null) settings.min_members = min;
    if (role) settings.partner_role_id = role.id;
    if (channel || min !== null || role) await service.saveSettings(ctx.guild.id, settings);
    const found = await actions.resolveChannel(ctx.guild, settings).catch(() => null);
    return reply(interaction, views.setupCard(settings, found, role));
  },

  async list(interaction, ctx) { return reply(interaction, views.listCard(await service.list(ctx.guild.id, interaction.options.getString('status') ?? 'active'))); },

  async info(interaction, ctx) { const row = await load(interaction, ctx); return reply(interaction, views.infoCard(row, jumpOf(row))); },

  async end(interaction, ctx) {
    const row = await load(interaction, ctx);
    const { removed, blacklisted } = await actions.endPartnership({
      guild: ctx.guild, row, reason: interaction.options.getString('reason') ?? '', deleteAd: interaction.options.getBoolean('delete_ad') !== false,
      settings: await service.getSettings(ctx.guild.id), blacklist: interaction.options.getBoolean('blacklist') === true, by: interaction.user.id,
    });
    return reply(interaction, ui.notice('Partnership Ended', `**${row.server_name}** is no longer a partner.${removed ? ' The ad was removed.' : ' The ad was left in place.'}${blacklisted ? '\nThe server was added to the blacklist.' : ''}`, { icon: 'check' }));
  },

  async reciprocal(interaction, ctx) {
    const row = await load(interaction, ctx);
    const done = interaction.options.getBoolean('posted') !== false;
    const updated = await service.setReciprocated(row.id, done, interaction.options.getString('proof') ?? '');
    return reply(interaction, ui.notice(done ? 'Marked As Posted' : 'Marked As Not Posted', `**${updated.server_name}** ${done ? 'has posted our ad.' : 'has not posted our ad yet.'}`, { icon: 'check' }));
  },

  async sticky(interaction, ctx) {
    const settings = { ...(await service.getSettings(ctx.guild.id)) };
    const o = interaction.options;
    if (o.getBoolean('enabled') !== null) settings.sticky_enabled = o.getBoolean('enabled');
    const add = o.getChannel('add_channel'); const remove = o.getChannel('remove_channel');
    if (add) settings.sticky_channels = [...new Set([...settings.sticky_channels, add.id])];
    if (remove) settings.sticky_channels = settings.sticky_channels.filter((id) => id !== remove.id);
    if (o.getBoolean('enabled') !== null || add || remove) { await service.saveSettings(ctx.guild.id, settings); sticky.forget(ctx.guild.id); }
    if (o.getBoolean('now')) {
      for (const id of await sticky.channelIds(ctx.guild)) { const channel = await ctx.guild.channels.fetch(id).catch(() => null); if (channel) await sticky.refresh(channel); }
    }
    return reply(interaction, views.setupCard(settings, await actions.resolveChannel(ctx.guild, settings).catch(() => null), null));
  },
};

async function blacklistGroup(interaction, ctx, sub) {
  if (sub === 'list') return reply(interaction, views.blacklistList(await service.listBlacklist(ctx.guild.id)));
  const server = await actions.resolveServer(interaction.client, interaction.options.getString('server', true));
  if (sub === 'add') {
    await service.addBlacklist({ guildId: ctx.guild.id, serverId: server.id, name: server.name, reason: interaction.options.getString('reason') ?? '', addedBy: interaction.user.id });
    return reply(interaction, ui.notice('Server Blacklisted', `${server.name ? `**${server.name}** ` : ''}(${ui.fmt.code(server.id)}) can no longer be posted as a partner, whatever invite it uses.`, { icon: 'ban' }));
  }
  if (!(await service.removeBlacklist(ctx.guild.id, server.id))) throw new ModError('That server is not on the blacklist.');
  return reply(interaction, ui.notice('Removed From Blacklist', `${server.name ? `**${server.name}** ` : ''}(${ui.fmt.code(server.id)}) can be a partner again.`, { icon: 'check' }));
}

module.exports = {
  data: new SlashCommandBuilder().setName('partners').setDescription('Manage partnerships (Administrator and up)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('setup').setDescription('Choose where ads are posted, and the optional rules')
      .addChannelOption((o) => o.setName('channel').setDescription('The partnership channel').addChannelTypes(...actions.POSTABLE))
      .addIntegerOption((o) => o.setName('min_members').setDescription('Flag servers smaller than this (0 = no minimum)').setMinValue(0).setMaxValue(1_000_000))
      .addRoleOption((o) => o.setName('partner_role').setDescription('A role given to each partner\'s representative')))
    .addSubcommand((s) => s.setName('list').setDescription('Your partnerships').addStringOption((o) => o.setName('status').setDescription('Which ones').addChoices({ name: 'Active', value: 'active' }, { name: 'Ended', value: 'ended' }, { name: 'All', value: 'all' })))
    .addSubcommand((s) => s.setName('info').setDescription('Everything about one partnership').addStringOption((o) => o.setName('id').setDescription('Which partnership').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('end').setDescription('End a partnership and remove its ad')
      .addStringOption((o) => o.setName('id').setDescription('Which partnership').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('reason').setDescription('Why it ended').setMaxLength(200))
      .addBooleanOption((o) => o.setName('delete_ad').setDescription('Remove the ad from the channel (default: yes)'))
      .addBooleanOption((o) => o.setName('blacklist').setDescription('Also blacklist the server so it can never partner again')))
    .addSubcommand((s) => s.setName('reciprocal').setDescription('Record whether a partner has posted our ad')
      .addStringOption((o) => o.setName('id').setDescription('Which partnership').setRequired(true).setAutocomplete(true))
      .addBooleanOption((o) => o.setName('posted').setDescription('They posted it (default) or not'))
      .addStringOption((o) => o.setName('proof').setDescription('A link to where our ad is in their server').setMaxLength(300)))
    .addSubcommand((s) => s.setName('sticky').setDescription('The "how to mute this channel" message kept at the bottom of the partnership channel')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Turn it on or off'))
      .addChannelOption((o) => o.setName('add_channel').setDescription('Also keep it in this channel').addChannelTypes(...actions.POSTABLE))
      .addChannelOption((o) => o.setName('remove_channel').setDescription('Stop keeping it in this channel').addChannelTypes(...actions.POSTABLE))
      .addBooleanOption((o) => o.setName('now').setDescription('Post it again right now')))
    .addSubcommandGroup((g) => g.setName('blacklist').setDescription('Servers that can never be partners')
      .addSubcommand((s) => s.setName('add').setDescription('Blacklist a server').addStringOption((o) => o.setName('server').setDescription('An invite link, an invite code or the server ID').setRequired(true).setMaxLength(100)).addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(200)))
      .addSubcommand((s) => s.setName('remove').setDescription('Allow a server again').addStringOption((o) => o.setName('server').setDescription('An invite link, an invite code or the server ID').setRequired(true).setMaxLength(100)))
      .addSubcommand((s) => s.setName('list').setDescription('Every blacklisted server')))
    .addSubcommand((s) => s.setName('ourad').setDescription('Our own advertisement, to hand to partners')
      .addBooleanOption((o) => o.setName('edit').setDescription('Change it'))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    try {
      const ctx = await modActions.contextFor(interaction, 'partnerManage');
      const settings = await service.getSettings(ctx.guild.id);
      if (sub === 'ourad' && interaction.options.getBoolean('edit')) return await interaction.showModal(handlers.ourAdModal(settings.our_ad));
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (sub === 'ourad') return await reply(interaction, views.ourAd(settings.our_ad));
      if (interaction.options.getSubcommandGroup(false) === 'blacklist') return await blacklistGroup(interaction, ctx, sub);
      return await subs[sub](interaction, ctx);
    } catch (err) {
      if (!(err instanceof ModError)) throw err;
      const card = modViews.denied(err.message);
      return interaction.deferred || interaction.replied ? interaction.editReply(ui.edit(card)) : interaction.reply(ui.message(card, { ephemeral: true }));
    }
  },

  async autocomplete(interaction) {
    try {
      const typed = interaction.options.getFocused().toLowerCase();
      const rows = await service.list(interaction.guildId, 'all', 50);
      await interaction.respond(rows.filter((r) => `#${r.id} ${r.server_name}`.toLowerCase().includes(typed)).slice(0, 25).map((r) => ({ name: `#${r.id} · ${r.server_name}${r.status === 'ended' ? ' (ended)' : ''}`.slice(0, 100), value: String(r.id) })));
    } catch { await interaction.respond([]).catch(() => {}); }
  },
};
