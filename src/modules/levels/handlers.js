const ui = require('../../ui');
const { colors } = require('../../constants');
const L = require('../../lib/levels');
const engine = require('./engine');
const perkSync = require('./perks');
const views = require('./views');

const canUseColours = async (guildId, member) =>
  Boolean(member.premiumSince) || (await engine.peek(guildId, member.id)).level >= L.perkLevel('colours');

const lockedCard = () => ui.notice('Not Unlocked Yet',
  `Name colours unlock at level ${L.perkLevel('colours')}, or straight away for server boosters. Keep chatting.`, { icon: 'lock', accent: colors.alert });

// The guide panel's select menu: show the chosen topic privately.
async function onGuide(interaction) {
  await interaction.reply(ui.message(views.guideTopic(interaction.values[0]), { ephemeral: true }));
  // Put the menu back to its placeholder so the same topic can be picked again.
  await interaction.message.edit({ components: [views.guidePanel()], flags: ui.V2 }).catch(() => {});
}

async function onColour(interaction) {
  const { guild, member } = interaction;
  if (!(await canUseColours(guild.id, member))) return interaction.update(ui.edit(lockedCard()));
  const key = interaction.values[0] === 'none' ? null : interaction.values[0];
  const roleId = await perkSync.setColour(member, key);
  await engine.setColourRole(guild.id, member.id, roleId);
  return interaction.update(ui.edit(ui.notice(key ? 'Colour Set' : 'Colour Removed',
    key ? 'Your name colour has been updated.' : 'Your name is back to the default colour.', { icon: 'check', accent: colors.teal })));
}

// The "Stop These Messages" button in a level-up DM. The server id is in the button, because DMs have no server.
async function onDm(interaction) {
  const [, , guildId, mode] = interaction.customId.split(':');
  const on = mode === 'on';
  await engine.setDm(guildId, interaction.user.id, on);
  return interaction.update(ui.edit(views.dmChanged({ on, guildId })));
}

async function handle(interaction) {
  const action = interaction.customId.split(':')[1];
  try {
    if (interaction.isButton() && action === 'dm') return await onDm(interaction);
    if (interaction.isStringSelectMenu() && action === 'guide') return await onGuide(interaction);
    if (interaction.isStringSelectMenu() && action === 'colour') return await onColour(interaction);
  } catch (err) {
    console.error('[levels]', err);
    const card = ui.notice('Something Went Wrong', 'Tower hit an unexpected error. It has been logged.', { accent: colors.alert });
    if (interaction.deferred || interaction.replied) await interaction.editReply(ui.edit(card)).catch(() => {});
    else await interaction.reply(ui.message(card, { ephemeral: true })).catch(() => {});
  }
  return undefined;
}

module.exports = { handle, canUseColours };
