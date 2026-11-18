const { Events } = require('discord.js');
const ui = require('../ui');
const { colors } = require('../constants');
const { commands } = require('../commands');
const verificationHandlers = require('../modules/verification/handlers');
const moderationHandlers = require('../modules/moderation/handlers');
const ticketHandlers = require('../modules/tickets/handlers');
const levelHandlers = require('../modules/levels/handlers');
const qotdHandlers = require('../modules/qotd/handlers');
const embedHandlers = require('../modules/embed/handlers');
const giveawayHandlers = require('../modules/giveaway/handlers');
const helpHandlers = require('../modules/help/handlers');
const aiHandlers = require('../modules/ai/handlers');
const commissionHandlers = require('../modules/commission/handlers');
const staffHandlers = require('../modules/staff/handlers');
const partnerHandlers = require('../modules/partner/handlers');

async function safeReply(interaction) {
  const payload = ui.notice('Something Went Wrong', 'Tower hit an unexpected error. It has been logged.', { accent: colors.alert });
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(ui.edit(payload));
    else await interaction.reply(ui.message(payload, { ephemeral: true }));
  } catch {
    // The interaction token may already be invalid. Nothing more to do.
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      if (interaction.isAutocomplete()) {
        const command = commands.get(interaction.commandName);
        if (command?.autocomplete) await command.autocomplete(interaction);
        return;
      }
      if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isModalSubmit())
        && interaction.customId.startsWith('embed:')) {
        return await embedHandlers.handle(interaction);
      }
      if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('partner:')) return await partnerHandlers.handle(interaction);
      if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('staff:')) return await staffHandlers.handle(interaction);
      if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('commission:')) return await commissionHandlers.handle(interaction);
      if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('ai:')) return await aiHandlers.handle(interaction);
      if (interaction.isStringSelectMenu() && interaction.customId === 'help:view') return await helpHandlers.handle(interaction);
      if (interaction.isButton() && interaction.customId.startsWith('giveaway:')) return await giveawayHandlers.handle(interaction);
      if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (command) return await command.execute(interaction);
        return;
      }
      if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('verify:')) {
        return await verificationHandlers.handle(interaction);
      }
      if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
        && interaction.customId.startsWith('ticket:')) {
        return await ticketHandlers.handle(interaction);
      }
      if (interaction.isButton() && interaction.customId.startsWith('qotd:')) return await qotdHandlers.handle(interaction);
      if ((interaction.isStringSelectMenu() || interaction.isButton()) && interaction.customId.startsWith('level:')) {
        return await levelHandlers.handle(interaction);
      }
      if (interaction.isButton() && interaction.customId.startsWith('mod:')) {
        return await moderationHandlers.handle(interaction);
      }
    } catch (err) {
      console.error('[interaction]', err);
      await safeReply(interaction);
    }
  },
};
