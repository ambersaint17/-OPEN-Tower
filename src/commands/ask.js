const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const { ai } = require('../constants');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const aiActions = require('../modules/ai/actions');
const claude = require('../modules/ai/claude');
const views = require('../modules/ai/views');
const giveawayActions = require('../modules/giveaway/actions');

module.exports = {
  data: new SlashCommandBuilder().setName('ask').setDescription('Ask the server assistant a question')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('question').setDescription('What would you like to know?').setRequired(true).setMaxLength(ai.askMaxChars))
    .addBooleanOption((o) => o.setName('private').setDescription('Only you see the answer (default: yes). Choose no to answer in public.')),

  async execute(interaction) {
    const isPublic = interaction.options.getBoolean('private') === false;
    await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
    const question = interaction.options.getString('question', true);
    try {
      const { guild, member } = interaction;
      const result = await aiActions.ask({ guild, member, channelId: interaction.channelId, question });
      const ticketChannel = giveawayActions.ticketChannelId(guild);
      const payload = ui.edit(views.answerCard({
        answer: result.text, question, isPublic, logId: result.logId,
        ticketUrl: ticketChannel ? `https://discord.com/channels/${guild.id}/${ticketChannel}` : null,
      }));
      return await interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
    } catch (err) {
      if (!(err instanceof modActions.ModError || err instanceof claude.AiError)) throw err;
      const card = ui.edit(modViews.denied(err.message));
      // A refusal is only for the person who asked, even when they asked in public.
      if (isPublic) {
        await interaction.deleteReply().catch(() => {});
        return interaction.followUp({ ...card, flags: card.flags | MessageFlags.Ephemeral, attachments: undefined });
      }
      return interaction.editReply(card);
    }
  },
};
