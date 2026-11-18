const { MessageFlags } = require('discord.js');
const ui = require('../../ui');
const { giveaways } = require('../../constants');
const modViews = require('../moderation/views');
const { ModError } = require('../moderation/actions');
const ticketActions = require('../tickets/actions');
const ticketHandlers = require('../tickets/handlers');
const service = require('./service');
const actions = require('./actions');
const views = require('./views');

const EPHEMERAL = MessageFlags.Ephemeral;
const denied = (text, title) => ui.message(modViews.denied(text, title), { ephemeral: true });

async function enterButton(interaction, row) {
  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    const result = await actions.enter(interaction, row);
    if (result.blocked) return interaction.editReply(ui.edit(views.unmet(result.blocked)));
    const count = await service.countEntries(row.id);
    return interaction.editReply(ui.edit(views.entered(row, result.facts.level, result.facts.booster, { already: result.already, entryCount: count })));
  } catch (err) {
    if (err instanceof ModError) return interaction.editReply(ui.edit(modViews.denied(err.message)));
    throw err;
  }
}

async function leaveButton(interaction, row) {
  if (row.status !== 'active') return interaction.update(ui.edit(modViews.denied('This giveaway has already ended, so entries are locked.')));
  await service.removeEntry(row.id, interaction.user.id);
  actions.refreshCard(interaction.client, row.id).catch(() => {});
  return interaction.update(ui.edit(views.left()));
}

// Opens the normal General Support ticket form, with the subject and first line already filled in.
async function claimButton(interaction, row) {
  if (!row.winner_ids.includes(interaction.user.id)) return interaction.reply(denied('Only the winners of this giveaway can use this button.'));
  const type = giveaways.claimTicketType;
  await ticketActions.checkCanOpen(interaction.guild, interaction.member, type);
  const modal = ticketHandlers.formModal(type);
  try {
    const [subject, , details] = modal.components.map((r) => r.components[0]);
    subject.setValue(`Giveaway prize claim #${row.id}`.slice(0, 80));
    const base = details?.data?.value;
    if (base) details.setValue(base.replace(/^(What do you need help with:)/, `$1 I won "${String(row.prize).slice(0, 120)}" in giveaway #${row.id} and want to claim it.`).slice(0, 1500));
  } catch { /* the form still opens, just empty */ }
  return interaction.showModal(modal);
}

async function handle(interaction) {
  const [, action, raw] = interaction.customId.split(':');
  const row = await service.get(Number(raw), interaction.guildId);
  try {
    if (!row) return await interaction.reply(denied('That giveaway no longer exists.'));
    if (action === 'enter') return await enterButton(interaction, row);
    if (action === 'leave') return await leaveButton(interaction, row);
    if (action === 'claim') return await claimButton(interaction, row);
  } catch (err) {
    if (err instanceof ModError) {
      const payload = denied(err.message);
      return interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
    }
    throw err;
  }
  return null;
}

module.exports = { handle };
