const ui = require('../../ui');
const actions = require('./actions');
const views = require('./views');
const pending = require('./pending');

// Buttons on the ban confirmation: mod:ban:yes:<token> and mod:ban:no:<token>.
async function handle(interaction) {
  const [, kind, answer, token] = interaction.customId.split(':');
  if (kind !== 'ban') return;

  await interaction.deferUpdate();
  const data = pending.take(token, interaction.user.id);
  if (!data) return interaction.editReply(ui.edit(views.banExpired()));
  if (answer === 'no') return interaction.editReply(ui.edit(views.banCancelled()));

  try {
    const ctx = await actions.contextFor(interaction, 'ban');
    const user = await interaction.client.users.fetch(data.userId);
    const row = await actions.ban(ctx, user, data.reason, data.deleteSeconds);
    return interaction.editReply(ui.edit(views.done({ row, title: 'Member Banned' })));
  } catch (err) {
    if (err instanceof actions.ModError) return interaction.editReply(ui.edit(views.denied(err.message)));
    console.error('[ban confirm]', err);
    return interaction.editReply(ui.edit(views.denied('Tower hit an unexpected error. It has been logged.', 'Something Went Wrong')));
  }
}

module.exports = { handle };
