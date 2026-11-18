const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const ui = require('../ui');
const lib = require('../lib/staff');
const { ModError } = require('../modules/moderation/actions');
const actions = require('../modules/staff/actions');
const service = require('../modules/staff/service');
const views = require('../modules/staff/views');
const { run, reply } = require('../modules/staff/command');

module.exports = {
  data: new SlashCommandBuilder().setName('offers').setDescription('Staff offers waiting for an answer')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('list').setDescription('Every offer that has not been answered yet'))
    .addSubcommand((s) => s.setName('cancel').setDescription('Withdraw an offer')
      .addIntegerOption((o) => o.setName('offer').setDescription('The offer number').setRequired(true).setMinValue(1))),

  async execute(interaction) {
    return run(interaction, async (actor) => {
      if (!actions.staffAuth(actor)) throw new ModError('Only team heads, administrators and the owner can see or withdraw offers.');
      if (interaction.options.getSubcommand() === 'list') return reply(interaction, views.offersList(await service.listPending(interaction.guildId)));
      const offer = await actions.cancelOffer({ client: interaction.client, guild: interaction.guild, actor, offerId: interaction.options.getInteger('offer', true) });
      return reply(interaction, ui.notice('Offer Withdrawn', `The offer to ${ui.fmt.user(offer.user_id)} for **${views.rankLabel(offer.team, offer.rank_key)}** was withdrawn, and they were told.`, { icon: 'check' }));
    });
  },
};
