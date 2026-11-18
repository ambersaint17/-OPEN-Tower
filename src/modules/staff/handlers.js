const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const ui = require('../../ui');
const modViews = require('../moderation/views');
const { ModError } = require('../moderation/actions');
const actions = require('./actions');

const denied = (text) => ui.message(modViews.denied(text), { ephemeral: true });

// Accepting or declining both open a short form, where the note is optional.
function noteModal(kind, offerId) {
  const accept = kind === 'accept';
  const input = new TextInputBuilder().setCustomId('note').setLabel(accept ? 'A note for the team (optional)' : 'Anything you would like to say? (optional)')
    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)
    .setPlaceholder(accept ? 'Your availability, questions, anything you want us to know...' : 'Why it is not for you right now, or nothing at all.');
  return new ModalBuilder().setCustomId(`staff:${accept ? 'ma' : 'md'}:${offerId}`).setTitle(accept ? 'Accept the offer' : 'Decline the offer').addComponents(new ActionRowBuilder().addComponents(input));
}

async function handle(interaction) {
  const [, action, raw] = interaction.customId.split(':');
  const offerId = Number(raw);
  try {
    if (interaction.isButton() && (action === 'accept' || action === 'decline')) return await interaction.showModal(noteModal(action, offerId));
    if (interaction.isModalSubmit() && (action === 'ma' || action === 'md')) {
      await interaction.deferUpdate();                           // role changes can take a moment, so acknowledge straight away
      const { card } = await actions.respond({ client: interaction.client, user: interaction.user, offerId, accept: action === 'ma', note: (interaction.fields.getTextInputValue('note') ?? '').trim() });
      return await interaction.editReply(ui.edit(card));
    }
  } catch (err) {
    if (!(err instanceof ModError)) throw err;
    if (interaction.deferred || interaction.replied) return interaction.followUp(denied(err.message));
    return interaction.reply(denied(err.message));
  }
  return null;
}

module.exports = { handle, noteModal };
