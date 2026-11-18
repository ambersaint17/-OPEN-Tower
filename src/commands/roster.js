const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const lib = require('../lib/staff');
const { ModError } = require('../modules/moderation/actions');
const actions = require('../modules/staff/actions');
const views = require('../modules/staff/views');
const { run, reply } = require('../modules/staff/command');

module.exports = {
  data: new SlashCommandBuilder().setName('roster').setDescription('Who is on each staff team, and at which rank')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('team').setDescription('Only this team').addChoices(...lib.TEAMS.map((t) => ({ name: t.label, value: t.key })))),

  async execute(interaction) {
    return run(interaction, async (actor) => {
      if (!actions.isStaffMember(actor)) throw new ModError('Only staff can see the roster.');
      const teamKey = interaction.options.getString('team');
      return reply(interaction, views.rosterCard(await actions.rosterData(interaction.guild, { teamKey, withLeadership: !teamKey })));
    });
  },
};
