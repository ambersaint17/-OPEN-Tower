const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const ui = require('../../ui');
const c = require('../../lib/commission');
const modViews = require('../moderation/views');
const service = require('./service');
const actions = require('./actions');
const views = require('./views');

const denied = (text, title) => ui.message(modViews.denied(text, title), { ephemeral: true });
const row = (input) => new ActionRowBuilder().addComponents(input);

function reviewModal(commission) {
  const order = new TextInputBuilder().setCustomId('order').setLabel('What did you order?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(commission.title.slice(0, 100));
  const rating = new TextInputBuilder().setCustomId('rating').setLabel('Rating out of 5').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(10).setPlaceholder('1, 2, 3, 4 or 5');
  const good = new TextInputBuilder().setCustomId('good').setLabel('What went well?').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(800);
  const improve = new TextInputBuilder().setCustomId('improve').setLabel('What could be better?').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(800);
  return new ModalBuilder().setCustomId(`commission:rv:${commission.id}`).setTitle('Review your commission').addComponents(row(order), row(rating), row(good), row(improve));
}

// The "Leave A Review" button. It works in a DM, so nothing here relies on a server being attached to the interaction.
async function onReviewButton(interaction, id) {
  const commission = await service.get(id);
  if (!commission) return interaction.reply(denied('That commission could not be found.'));
  if (commission.client_id !== interaction.user.id) return interaction.reply(denied('This review is for the person who ordered.'));
  if (await service.getReview(id)) return interaction.reply(ui.message(views.alreadyReviewed(), { ephemeral: true }));
  return interaction.showModal(reviewModal(commission));
}

async function onReviewSubmit(interaction, id) {
  const commission = await service.get(id);
  if (!commission || commission.client_id !== interaction.user.id) return interaction.reply(denied('That commission could not be found.'));
  const rating = c.parseRating(interaction.fields.getTextInputValue('rating'));
  if (!rating) return interaction.reply(denied('The rating must be a number from 1 to 5. Press **Leave A Review** again and try once more.', 'Rating Not Understood'));
  const result = await actions.submitReview({
    client: interaction.client, row: commission, user: interaction.user,
    input: {
      orderText: interaction.fields.getTextInputValue('order').trim() || commission.title, rating,
      wentWell: interaction.fields.getTextInputValue('good').trim(), improve: interaction.fields.getTextInputValue('improve').trim(),
    },
  });
  return interaction.reply(ui.message(result.already ? views.alreadyReviewed() : views.thanks(), { ephemeral: true }));
}

async function handle(interaction) {
  const [, action, raw] = interaction.customId.split(':');
  const id = Number(raw);
  if (interaction.isModalSubmit() && action === 'rv') return onReviewSubmit(interaction, id);
  if (interaction.isButton() && action === 'review') return onReviewButton(interaction, id);
  return null;
}

module.exports = { handle, reviewModal };
