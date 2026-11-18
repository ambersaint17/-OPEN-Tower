const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const lib = require('../lib/staff');
const { ModError } = require('../modules/moderation/actions');
const actions = require('../modules/staff/actions');
const views = require('../modules/staff/views');
const { run, reply } = require('../modules/staff/command');

module.exports = {
  data: new SlashCommandBuilder().setName('induct').setDescription('Offer someone a place on a staff team')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('member').setDescription('Who you want to bring on').setRequired(true))
    .addStringOption((o) => o.setName('team').setDescription('The team they would join').setRequired(true).addChoices(...lib.TEAMS.map((t) => ({ name: t.label, value: t.key }))))
    .addStringOption((o) => o.setName('rank').setDescription('The rank to offer').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('message').setDescription('A personal line included in the offer').setMaxLength(400)),

  async execute(interaction) {
    return run(interaction, async (actor) => {
      const target = interaction.options.getMember('member');
      if (!target) throw new ModError('That person is not in the server.');
      const offer = await actions.induct({
        client: interaction.client, guild: interaction.guild, actor, target, teamKey: interaction.options.getString('team', true),
        rankKey: interaction.options.getString('rank', true), note: interaction.options.getString('message') ?? '',
      });
      return reply(interaction, views.offerSent(offer, target.id));
    });
  },

  // Only the ranks of the chosen team that this person may actually hand out.
  async autocomplete(interaction) {
    try {
      const team = lib.teamOf(interaction.options.getString('team'));
      const auth = actions.staffAuth(interaction.member);
      const typed = interaction.options.getFocused().toLowerCase();
      const max = team ? lib.maxGrant(auth, team.key) : -1;
      await interaction.respond((team?.ranks ?? []).filter((r, i) => i <= max && r.label.toLowerCase().includes(typed)).map((r) => ({ name: r.label, value: r.key })));
    } catch {
      await interaction.respond([]).catch(() => {});
    }
  },
};
