const { MessageFlags } = require('discord.js');
const ui = require('../../ui');
const modViews = require('../moderation/views');
const { ModError } = require('../moderation/actions');

// The same shell for every staff command: answer privately, and turn a ModError into a clear message.
async function run(interaction, fn) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    return await fn(interaction.member);
  } catch (err) {
    if (!(err instanceof ModError)) throw err;
    return interaction.editReply(ui.edit(modViews.denied(err.message)));
  }
}
const reply = (interaction, container) => interaction.editReply(ui.edit(container));

module.exports = { run, reply };
