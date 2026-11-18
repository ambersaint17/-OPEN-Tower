const {
  ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const ui = require('../../ui');
const { tickets } = require('../../constants');
const modViews = require('../moderation/views');
const service = require('./service');
const views = require('./views');
const actions = require('./actions');
const { formFor } = require('./forms');
const { clip } = require('../../lib/text');

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

function formModal(typeKey) {
  const cfg = tickets.types[typeKey];
  const modal = new ModalBuilder().setCustomId(`ticket:modal:${typeKey}`).setTitle(cfg.label);
  for (const f of formFor(typeKey)) {
    const input = new TextInputBuilder()
      .setCustomId(f.id).setLabel(f.label).setRequired(true)
      .setStyle(f.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setMinLength(f.min).setMaxLength(f.max);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    if (f.template) input.setValue(f.template);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

// Anything that goes wrong becomes a clear, private message.
async function fail(interaction, err) {
  const text = err instanceof actions.ModError ? err.message : null;
  if (!text) console.error('[tickets]', err);
  const card = modViews.denied(text ?? 'Tower hit an unexpected error. It has been logged.', text ? 'Cannot Continue' : 'Something Went Wrong');
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(ui.edit(card));
    else await interaction.reply(ui.message(card, { ephemeral: true }));
  } catch { /* the interaction expired */ }
}

// ---------- opening ----------

async function onSelect(interaction) {
  const typeKey = interaction.values[0];
  try {
    await actions.checkCanOpen(interaction.guild, interaction.member, typeKey);
  } catch (err) {
    return fail(interaction, err);
  }
  await interaction.showModal(formModal(typeKey));
  // Put the menu back to "Choose..." so the same option can be picked again next time.
  await interaction.message.edit({ components: [views.panel()], flags: ui.V2 }).catch(() => {});
}

async function onFormSubmit(interaction, typeKey) {
  await interaction.deferReply(EPHEMERAL);
  try {
    const values = Object.fromEntries(formFor(typeKey).map((f) => [f.id, interaction.fields.getTextInputValue(f.id)]));
    const { channel } = await actions.openTicket(interaction, typeKey, values);
    await interaction.editReply(ui.edit(ui.notice('Ticket Opened', `Your private channel is ready: ${channel}\nStaff have been notified.`, {
      icon: 'check', accent: require('../../constants').colors.teal,
    })));
  } catch (err) {
    await fail(interaction, err);
  }
}

// ---------- staff buttons ----------

async function loadTicket(id) {
  const ticket = await service.byId(id);
  if (!ticket) throw new actions.ModError('That ticket no longer exists.');
  return ticket;
}

async function onClaim(interaction, id) {
  await interaction.deferReply(EPHEMERAL);
  try {
    await actions.claim(interaction.guild, interaction.member, await loadTicket(id));
    await interaction.editReply(ui.edit(ui.notice('Ticket Claimed', 'It is yours. The ticket now shows you as the handler.', { icon: 'check' })));
  } catch (err) { await fail(interaction, err); }
}

// Only staff can close. Everyone else gets a polite no.
async function onCloseButton(interaction, id) {
  try {
    const ticket = await loadTicket(id);
    if (!actions.canHandle(interaction.guild, interaction.member, ticket)) {
      throw new actions.ModError('Only staff can close tickets. If you are finished, just let them know here.');
    }
    if (ticket.status !== 'open') throw new actions.ModError('That ticket is already closed.');
  } catch (err) { return fail(interaction, err); }
  const reason = new TextInputBuilder().setCustomId('reason').setLabel('Why is this ticket being closed?')
    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300);
  return interaction.showModal(new ModalBuilder().setCustomId(`ticket:closemodal:${id}`).setTitle('Close Ticket')
    .addComponents(new ActionRowBuilder().addComponents(reason)));
}

async function onCloseSubmit(interaction, id) {
  await interaction.deferReply(EPHEMERAL);
  try {
    const ticket = await loadTicket(id);
    if (!actions.canHandle(interaction.guild, interaction.member, ticket)) throw new actions.ModError('Only staff can close tickets.');
    const result = await actions.closeTicket(interaction.guild, ticket, {
      by: interaction.user.id, reason: interaction.fields.getTextInputValue('reason'),
    });
    await interaction.editReply(ui.edit(ui.notice('Ticket Closed', `The transcript was saved. ${actions.dmNote(result)}`, { icon: 'lock' })));
  } catch (err) { await fail(interaction, err); }
}

async function onReopen(interaction, id) {
  await interaction.deferReply(EPHEMERAL);
  try {
    const row = await actions.reopen(interaction.guild, interaction.member, await loadTicket(id));
    await interaction.message.edit({ ...ui.edit(views.reopenedCard(interaction.user.id)), allowedMentions: { parse: [] } }).catch(() => {});
    await actions.refreshCards(interaction.guild, row);
    await interaction.editReply(ui.edit(ui.notice('Ticket Reopened', 'The member can write in the channel again.', { icon: 'unlock' })));
  } catch (err) { await fail(interaction, err); }
}

async function onDelete(interaction, id) {
  await interaction.deferReply(EPHEMERAL);
  try {
    const ticket = await loadTicket(id);
    if (!actions.canHandle(interaction.guild, interaction.member, ticket)) throw new actions.ModError('Only staff can delete tickets.');
    await interaction.editReply(ui.edit(ui.notice('Deleting', 'This channel is being deleted.', { icon: 'trash' })));
    await actions.deleteNow(interaction.guild, interaction.member, ticket);
  } catch (err) { await fail(interaction, err); }
}

// ---------- reviews, in the opener's DMs ----------

// A card message must be edited with a card, and a plain-text fallback message with plain text.
const thanks = (interaction, args) =>
  interaction.message?.flags?.has(MessageFlags.IsComponentsV2) ? ui.edit(views.dmThanks(args)) : views.dmThanksPlain(args);

async function onRate(interaction, id, rating) {
  try {
    const ticket = await loadTicket(id);
    if (interaction.user.id !== ticket.opener_id) throw new actions.ModError('Only the person who opened the ticket can review it.');
    const existing = await service.getReview(ticket.id);
    if (existing) return interaction.update(thanks(interaction, { rating: existing.rating, askFeedback: false, ticketId: ticket.id }));
    await service.saveReview(ticket, rating);
    const guild = await actions.guildFor(interaction.client, ticket.guild_id);
    if (guild) await actions.postReview(guild, ticket, rating).catch((err) => console.error('[review]', err.message));
    return interaction.update(thanks(interaction, { rating, askFeedback: true, ticketId: ticket.id }));
  } catch (err) { return fail(interaction, err); }
}

async function onFeedbackButton(interaction, id) {
  const make = (customId, label) => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500));
  return interaction.showModal(new ModalBuilder().setCustomId(`ticket:feedbackmodal:${id}`).setTitle('Your Feedback')
    .addComponents(make('well', 'What went well?'), make('wrong', 'What could be better?')));
}

async function onFeedbackSubmit(interaction, id) {
  await interaction.deferUpdate();
  try {
    const ticket = await loadTicket(id);
    if (interaction.user.id !== ticket.opener_id) throw new actions.ModError('Only the person who opened the ticket can review it.');
    const review = await service.getReview(ticket.id);
    if (!review) throw new actions.ModError('Please give a rating first.');
    const wentWell = clip(interaction.fields.getTextInputValue('well').trim(), 500);
    const wentWrong = clip(interaction.fields.getTextInputValue('wrong').trim(), 500);
    const guild = await actions.guildFor(interaction.client, ticket.guild_id);
    if (guild && (wentWell || wentWrong)) {
      await actions.postReview(guild, ticket, review.rating, { wentWell, wentWrong }).catch((err) => console.error('[review]', err.message));
    }
    await interaction.editReply(thanks(interaction, { rating: review.rating, askFeedback: false, ticketId: ticket.id }));
  } catch (err) { await fail(interaction, err); }
}

// ---------- router ----------

async function handle(interaction) {
  const [, action, a, b] = interaction.customId.split(':');
  if (interaction.isStringSelectMenu()) return action === 'open' ? onSelect(interaction) : undefined;
  if (interaction.isModalSubmit()) {
    if (action === 'modal') return onFormSubmit(interaction, a);
    if (action === 'closemodal') return onCloseSubmit(interaction, Number(a));
    if (action === 'feedbackmodal') return onFeedbackSubmit(interaction, Number(a));
    return undefined;
  }
  if (interaction.isButton()) {
    if (action === 'claim') return onClaim(interaction, Number(a));
    if (action === 'close') return onCloseButton(interaction, Number(a));
    if (action === 'reopen') return onReopen(interaction, Number(a));
    if (action === 'delete') return onDelete(interaction, Number(a));
    if (action === 'rate') return onRate(interaction, Number(a), Number(b));
    if (action === 'feedback') return onFeedbackButton(interaction, Number(a));
  }
  return undefined;
}

module.exports = { handle, formModal };
