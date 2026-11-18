const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const ui = require('../../ui');
const { partners: cfg } = require('../../constants');
const lib = require('../../lib/partner');
const modActions = require('../moderation/actions');
const modViews = require('../moderation/views');
const service = require('./service');
const actions = require('./actions');
const views = require('./views');

const { ModError } = modActions;
const denied = (text) => ui.message(modViews.denied(text), { ephemeral: true });

function adModal(token) {
  const name = new TextInputBuilder().setCustomId('name').setLabel('Server name (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)
    .setPlaceholder('Leave empty to use the name from the invite');
  const ad = new TextInputBuilder().setCustomId('ad').setLabel('Paste the whole advertisement').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(20).setMaxLength(4000)
    .setPlaceholder('Include their Discord invite link. Pings inside the ad are removed.');
  return new ModalBuilder().setCustomId(`partner:ad:${token}`).setTitle('Partner advertisement').addComponents(new ActionRowBuilder().addComponents(name), new ActionRowBuilder().addComponents(ad));
}
function ourAdModal(current) {
  const input = new TextInputBuilder().setCustomId('text').setLabel('Our advertisement').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3500);
  if (current) input.setValue(current.slice(0, 3500));
  return new ModalBuilder().setCustomId('partner:our').setTitle('Our advertisement').addComponents(new ActionRowBuilder().addComponents(input));
}

async function onAdSubmit(interaction, token) {
  const form = actions.takeForm(token);
  if (!form || form.userId !== interaction.user.id) throw new ModError('That form has expired. Run `/partner` again.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await service.getSettings(interaction.guildId);
  const prepared = await actions.prepare({
    client: interaction.client, guild: interaction.guild, settings, ad: interaction.fields.getTextInputValue('ad'), typedName: interaction.fields.getTextInputValue('name'),
    ping: form.ping, roleId: form.roleId, repId: form.repId, style: form.style, ticketChannelId: form.ticketChannelId, actorId: interaction.user.id,
    attachments: form.attachments ?? [], keepLink: Boolean(form.keepLink),
  });
  // A clean ad with a quiet ping goes straight out. Anything that needs a second look (or @everyone / @here) waits for the Post button.
  const needsLook = prepared.vetting.blocked || prepared.vetting.warned || lib.isLoudPing(prepared.ping.key);
  if (!needsLook) {
    const { row, jump, notes } = await actions.publish({ client: interaction.client, guild: interaction.guild, settings, prepared });
    return interaction.editReply(ui.edit(notes.length ? ui.notice('Ad Posted', `${notes.join(' ')}\n${jump}`, { icon: 'check' }) : views.posted(row, jump)));
  }
  const pendingToken = actions.hold(prepared, interaction.user.id);
  return interaction.editReply(ui.edit(views.preview(pendingToken, prepared)));
}

async function onPost(interaction, token) {
  const held = actions.take(token);
  if (!held || held.userId !== interaction.user.id) throw new ModError('This preview expired. Run `/partner` again.');
  await interaction.deferUpdate();
  actions.drop(token);
  const settings = await service.getSettings(interaction.guildId);
  const { row, jump, notes } = await actions.publish({ client: interaction.client, guild: interaction.guild, settings, prepared: held.prepared });
  return interaction.editReply(ui.edit(notes.length ? ui.notice('Ad Posted', `${notes.join(' ')}\n${jump}`, { icon: 'check' }) : views.posted(row, jump)));
}

// The reminder DM's button. It works in a direct message, so it checks who pressed it instead of looking at roles.
async function onReciprocal(interaction, id) {
  const row = await service.get(Number(id));
  if (!row) throw new ModError('That partnership could not be found.');
  if (interaction.user.id !== row.posted_by) throw new ModError('Only the person who posted this ad can answer.');
  await service.setReciprocated(row.id, true, '');
  return interaction.update(ui.edit(views.reciprocityDone(row)));
}

async function handle(interaction) {
  const [, action, token] = interaction.customId.split(':');
  try {
    if (interaction.isButton() && action === 'recip') return await onReciprocal(interaction, token);
    await modActions.contextFor(interaction, 'partnerManage');
    if (interaction.isModalSubmit() && action === 'ad') return await onAdSubmit(interaction, token);
    if (interaction.isModalSubmit() && action === 'our') {
      const settings = await service.getSettings(interaction.guildId);
      await service.saveSettings(interaction.guildId, { ...settings, our_ad: interaction.fields.getTextInputValue('text').trim() });
      return await interaction.reply(ui.message(views.ourAd(interaction.fields.getTextInputValue('text').trim()), { ephemeral: true }));
    }
    if (interaction.isButton() && action === 'go') return await onPost(interaction, token);
    if (interaction.isButton() && action === 'cancel') { actions.drop(token); return await interaction.update(ui.edit(ui.notice('Cancelled', 'Nothing was posted.', { icon: 'cross' }))); }
  } catch (err) {
    if (!(err instanceof ModError)) throw err;
    if (interaction.deferred || interaction.replied) return interaction.followUp(denied(err.message));
    return interaction.reply(denied(err.message));
  }
  return null;
}

module.exports = { handle, adModal, ourAdModal };
