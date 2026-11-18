const { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const ui = require('../../ui');
const { ai, tickets } = require('../../constants');
const lib = require('../../lib/ai');
const modActions = require('../moderation/actions');
const modViews = require('../moderation/views');
const ticketActions = require('../tickets/actions');
const ticketService = require('../tickets/service');
const service = require('./service');
const aiTickets = require('./tickets');

const { ModError } = modActions;
const EPHEMERAL = MessageFlags.Ephemeral;
const denied = (text, title) => ui.message(modViews.denied(text, title), { ephemeral: true });

// ---------- the knowledge form (opened by /ai knowledge add and edit) ----------
function knowledgeModal(entry) {
  const title = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)
    .setPlaceholder('Rules, Commission prices, How to verify...');
  const content = new TextInputBuilder().setCustomId('content').setLabel('What the assistant should know').setStyle(TextInputStyle.Paragraph)
    .setRequired(true).setMaxLength(4000);
  if (entry) { title.setValue(entry.title.slice(0, 80)); content.setValue(entry.content.slice(0, 4000)); }
  return new ModalBuilder().setCustomId(entry ? `ai:kbedit:${entry.id}` : 'ai:kbadd').setTitle(entry ? 'Edit knowledge' : 'Add knowledge')
    .addComponents(new ActionRowBuilder().addComponents(title), new ActionRowBuilder().addComponents(content));
}

// Saves an entry after checking the size limits. `replacingId` is the entry being edited, if any.
async function storeKnowledge({ guildId, userId, title, content, replacingId = null }) {
  const cleanTitle = title.trim(); const cleanContent = content.trim();
  if (!cleanTitle || !cleanContent) throw new ModError('Both a title and some content are needed.');
  if (cleanContent.length > ai.entryMaxChars) throw new ModError(`One entry holds at most ${ai.entryMaxChars.toLocaleString('en-US')} characters. Split it into two.`);
  const entries = await service.listKnowledge(guildId);
  const others = entries.filter((e) => e.id !== replacingId && e.title.toLowerCase() !== cleanTitle.toLowerCase());
  if (others.length >= ai.maxEntries) throw new ModError(`The assistant can hold ${ai.maxEntries} entries. Remove one first.`);
  const total = lib.knowledgeSize(others) + cleanTitle.length + cleanContent.length + 6;
  if (total > ai.maxKnowledgeChars) throw new ModError(`That would make the knowledge ${total.toLocaleString('en-US')} characters, over the ${ai.maxKnowledgeChars.toLocaleString('en-US')} limit. Shorten or remove something.`);
  if (replacingId) await service.updateKnowledgeById(guildId, replacingId, cleanTitle, cleanContent);
  else await service.saveKnowledge(guildId, cleanTitle, cleanContent, userId);
  return { title: cleanTitle, total };
}

async function onModal(interaction) {
  await modActions.contextFor(interaction, 'aiAdmin');
  const [, kind, id] = interaction.customId.split(':');
  const { title, total } = await storeKnowledge({
    guildId: interaction.guildId, userId: interaction.user.id, title: interaction.fields.getTextInputValue('title'),
    content: interaction.fields.getTextInputValue('content'), replacingId: kind === 'kbedit' ? Number(id) : null,
  });
  return interaction.reply(ui.message(ui.notice('Knowledge Saved', `**${title}** is saved. The assistant now knows ${total.toLocaleString('en-US')} characters in total.`, { icon: 'check' }), { ephemeral: true }));
}

// ---------- buttons ----------
async function onFeedback(interaction) {
  const [, , logId, value] = interaction.customId.split(':');
  const ok = await service.rate(Number(logId), interaction.user.id, Number(value));
  return interaction.reply(ok
    ? ui.message(ui.notice('Thanks', value === '1' ? 'Glad that helped.' : 'Thanks, staff can see this and improve the answers.', { icon: 'check' }), { ephemeral: true })
    : denied('Only the person who asked can rate this answer.'));
}

async function ticketOf(interaction, channelId) {
  const ticket = await ticketService.byChannel(channelId);
  if (!ticket) throw new ModError('This ticket could not be found.');
  const member = interaction.member;
  if (member.id !== ticket.opener_id && aiTickets.staffLevel(member) === 0) throw new ModError('Only the person who opened this ticket can use this button.');
  return ticket;
}

async function onHuman(interaction, channelId) {
  const ticket = await ticketOf(interaction, channelId);
  aiTickets.silence(channelId);
  const ping = ticketActions.pingTargets(interaction.guild, tickets.types[ticket.type] ?? {});
  await interaction.channel.send({
    content: `${ping.text ? `${ping.text} ` : ''}${interaction.user} would like a person to take over this ticket.`,
    allowedMentions: { roles: ping.roles, users: [...ping.users, interaction.user.id] },
  });
  return interaction.reply(ui.message(ui.notice('Staff Called', 'I have stopped answering and asked staff to take over. They will be with you as soon as they can.', { icon: 'check' }), { ephemeral: true }));
}

async function onSolved(interaction, channelId) {
  await ticketOf(interaction, channelId);
  aiTickets.silence(channelId);
  return interaction.reply(ui.message(ui.notice('Glad That Helped', 'A staff member can close this ticket for you. If you need anything else, just write here.', { icon: 'check' }), { ephemeral: true }));
}

async function handle(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  try {
    if (interaction.isModalSubmit()) return await onModal(interaction);
    if (action === 'fb') return await onFeedback(interaction);
    if (action === 'human') return await onHuman(interaction, arg);
    if (action === 'solved') return await onSolved(interaction, arg);
  } catch (err) {
    if (err instanceof ModError) return interaction.reply(denied(err.message));
    throw err;
  }
  return null;
}

module.exports = { handle, knowledgeModal, storeKnowledge };
