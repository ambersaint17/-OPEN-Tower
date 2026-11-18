const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const { giveaways } = require('../constants');
const L = require('../lib/levels');
const g = require('../lib/giveaway');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const service = require('../modules/giveaway/service');
const actions = require('../modules/giveaway/actions');
const views = require('../modules/giveaway/views');

const { fmt } = ui;
const { ModError } = modActions;
const reply = (interaction, container) => interaction.editReply(ui.edit(container));

async function load(interaction, guildId) {
  const raw = interaction.options.getString('giveaway', true).replace('#', '').trim();
  const row = /^\d+$/.test(raw) ? await service.get(Number(raw), guildId) : null;
  if (!row) throw new ModError('There is no giveaway with that number. Pick one from the list that appears as you type, or use `/giveaway list`.');
  return row;
}

const subs = {
  async start(interaction, ctx) {
    const ms = g.parseDuration(interaction.options.getString('duration', true));
    if (!ms) throw new ModError('Duration not understood. Use things like `30m`, `2h`, `3d`, `1w` or `1d12h`.');
    if (ms < giveaways.minDurationMs || ms > giveaways.maxDurationMs) throw new ModError('A giveaway must run between 1 minute and 30 days.');
    const role = interaction.options.getRole('required_role');
    if (role && role.id === ctx.guild.id) throw new ModError('@everyone cannot be a requirement. Leave the role empty instead.');
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const row = await actions.start(ctx.guild, interaction.user, {
      channel: await ctx.guild.channels.fetch(channel.id).catch(() => null),
      prize: interaction.options.getString('prize', true),
      description: interaction.options.getString('description') ?? '',
      winnerNote: interaction.options.getString('winner_note') ?? '',
      winners: interaction.options.getInteger('winners') ?? 1,
      endsAt: Date.now() + ms,
      pingRoleId: interaction.options.getRole('ping_role')?.id,
      claimHours: interaction.options.getInteger('claim_hours') ?? giveaways.defaultClaimHours,
      requirements: {
        minXp: interaction.options.getInteger('required_xp') ?? undefined, minLevel: interaction.options.getInteger('required_level') ?? undefined,
        roleId: role?.id, booster: interaction.options.getBoolean('booster_only') ?? undefined, minDays: interaction.options.getInteger('min_days') ?? undefined,
      },
    });
    return reply(interaction, ui.notice('Giveaway Started', `**${row.prize}** is live in <#${row.channel_id}>.`, {
      icon: 'gift', fields: [['Ends', fmt.time(row.ends_at, 'R'), 'calendar'], ['Giveaway ID', fmt.code(`#${row.id}`), 'hash'], ['Jump', views.jump(row), 'link']],
    }));
  },

  async end(interaction, ctx) {
    const row = await load(interaction, ctx.guild.id);
    if (row.status !== 'active') throw new ModError('That giveaway is not running.');
    const done = await actions.finish(interaction.client, row.id);
    return reply(interaction, ui.notice('Giveaway Ended', `**${row.prize}** has been drawn.${done?.winner_ids?.length ? `\nWinners: ${done.winner_ids.map(fmt.user).join(' ')}` : '\nNobody was eligible to win.'}`, { icon: 'trophy' }));
  },

  async reroll(interaction, ctx) {
    const row = await load(interaction, ctx.guild.id);
    const replace = interaction.options.getUser('replace')?.id ?? null;
    const fresh = await actions.reroll(interaction.client, ctx.guild, row, { count: interaction.options.getInteger('count') ?? 1, replace });
    return reply(interaction, ui.notice('Rerolled', `New winner${fresh.length === 1 ? '' : 's'} for **${row.prize}**: ${fresh.map(fmt.user).join(' ')}`, { icon: 'trophy' }));
  },

  async cancel(interaction, ctx) {
    const row = await load(interaction, ctx.guild.id);
    await actions.cancel(interaction.client, row);
    return reply(interaction, ui.notice('Giveaway Cancelled', `**${row.prize}** was cancelled.`, { icon: 'cross' }));
  },

  async list(interaction, ctx) {
    return reply(interaction, views.list(await service.listRecent(ctx.guild.id, 15)));
  },

  async verify(interaction, ctx) {
    const row = await load(interaction, ctx.guild.id);
    const member = interaction.options.getMember('member');
    if (!member) throw new ModError('That person is not in the server.');
    const facts = await actions.factsFor(member);
    return reply(interaction, views.verifyCard(row, member, g.evaluate(row.requirements, facts), {
      entries: L.giveawayEntries(facts.level, facts.booster), entered: await service.hasEntry(row.id, member.id), isWinner: row.winner_ids.includes(member.id),
    }));
  },
};

const pick = (o) => o.setName('giveaway').setDescription('Which giveaway').setRequired(true).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder().setName('giveaway').setDescription('Run giveaways (Administrator and up; staff can verify winners)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('start').setDescription('Start a giveaway')
      .addStringOption((o) => o.setName('prize').setDescription('What is being given away').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('duration').setDescription('How long: 30m, 2h, 3d, 1w or 1d12h').setRequired(true))
      .addIntegerOption((o) => o.setName('winners').setDescription('How many winners (default 1)').setMinValue(1).setMaxValue(giveaways.maxWinners))
      .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(...actions.POSTABLE))
      .addStringOption((o) => o.setName('description').setDescription('Extra text on the giveaway card').setMaxLength(1000))
      .addRoleOption((o) => o.setName('ping_role').setDescription('A role to ping with the giveaway'))
      .addIntegerOption((o) => o.setName('required_xp').setDescription('Requirement: at least this much XP').setMinValue(1))
      .addIntegerOption((o) => o.setName('required_level').setDescription('Requirement: at least this level').setMinValue(1).setMaxValue(L.MAX_LEVEL))
      .addRoleOption((o) => o.setName('required_role').setDescription('Requirement: must have this role'))
      .addBooleanOption((o) => o.setName('booster_only').setDescription('Requirement: server boosters only'))
      .addIntegerOption((o) => o.setName('min_days').setDescription('Requirement: in the server for this many days').setMinValue(1).setMaxValue(3650))
      .addStringOption((o) => o.setName('winner_note').setDescription('Extra line in the winner message').setMaxLength(500))
      .addIntegerOption((o) => o.setName('claim_hours').setDescription('Hours winners have to claim (default 48)').setMinValue(1).setMaxValue(720)))
    .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now and draw the winners').addStringOption(pick))
    .addSubcommand((s) => s.setName('reroll').setDescription('Draw new winners for an ended giveaway').addStringOption(pick)
      .addIntegerOption((o) => o.setName('count').setDescription('How many new winners (default 1)').setMinValue(1).setMaxValue(giveaways.maxWinners))
      .addUserOption((o) => o.setName('replace').setDescription('A winner who did not claim, to replace')))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a running giveaway').addStringOption(pick))
    .addSubcommand((s) => s.setName('list').setDescription('Recent and running giveaways'))
    .addSubcommand((s) => s.setName('verify').setDescription('Check whether a member meets a giveaway\'s requirements').addStringOption(pick)
      .addUserOption((o) => o.setName('member').setDescription('The member to check').setRequired(true))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const sub = interaction.options.getSubcommand();
      const ctx = await modActions.contextFor(interaction, sub === 'verify' ? 'giveawayVerify' : 'giveawayManage');
      return await subs[sub](interaction, ctx);
    } catch (err) {
      if (err instanceof ModError) return interaction.editReply(ui.edit(modViews.denied(err.message)));
      throw err;
    }
  },

  async autocomplete(interaction) {
    try {
      const typed = interaction.options.getFocused().toLowerCase();
      const rows = await service.listRecent(interaction.guildId, 25);
      await interaction.respond(rows.filter((r) => `#${r.id} ${r.prize}`.toLowerCase().includes(typed)).slice(0, 25)
        .map((r) => ({ name: `#${r.id} · ${r.prize} (${r.status})`.slice(0, 100), value: String(r.id) })));
    } catch {
      await interaction.respond([]).catch(() => {});
    }
  },
};
