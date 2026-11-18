const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const handlers = require('../modules/help/handlers');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('See the commands you can use')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(ui.edit(await handlers.render(interaction)));
  },
};
