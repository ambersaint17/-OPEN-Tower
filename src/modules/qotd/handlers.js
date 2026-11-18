const ui = require('../../ui');
const { colors, qotd } = require('../../constants');
const modViews = require('../moderation/views');
const service = require('./service');
const views = require('./views');
const actions = require('./actions');

// Approve / Reject buttons on a member's question suggestion.
async function handle(interaction) {
  const [, action, idText] = interaction.customId.split(':');
  try {
    if (!actions.canManage(interaction.guild, interaction.member)) {
      return interaction.reply(ui.message(modViews.denied('Only the Community Engagement Team can decide on suggestions.'), { ephemeral: true }));
    }
    const status = action === 'approve' ? 'approved' : 'rejected';
    const row = await service.decideSuggestion(Number(idText), status, interaction.user.id);
    if (!row) return interaction.reply(ui.message(modViews.denied('Someone already decided on that one.'), { ephemeral: true }));
    if (status === 'approved') {
      await service.addQuestion({ guildId: row.guild_id, question: row.question, kind: 'open', addedBy: interaction.user.id, suggestedBy: row.user_id });
    }
    return interaction.update(ui.edit(views.suggestionCard({ id: row.id, userId: row.user_id, question: row.question, status, decidedBy: interaction.user.id })));
  } catch (err) {
    console.error('[qotd]', err);
    return interaction.reply(ui.message(ui.notice('Something Went Wrong', 'Tower hit an unexpected error. It has been logged.', { accent: colors.alert }), { ephemeral: true })).catch(() => {});
  }
}

module.exports = { handle, maxLength: qotd.maxLength };
