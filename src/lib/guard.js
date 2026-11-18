const ui = require('../ui');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');

// A runtime rank check for commands that used to rely only on Discord's default command permission.
// Server admins can change that permission under Integrations, so Tower checks the rank itself as well.
// Call it right after deferReply: `if (!(await allow(interaction, 'logsAdmin'))) return;`
async function allow(interaction, action) {
  try {
    await modActions.contextFor(interaction, action);
    return true;
  } catch (err) {
    if (!(err instanceof modActions.ModError)) throw err;
    await interaction.editReply(ui.edit(modViews.denied(err.message)));
    return false;
  }
}

module.exports = { allow };
