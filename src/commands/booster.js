const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const { colors, levels } = require('../constants');
const boosters = require('../modules/levels/boosters');
const views = require('../modules/levels/views');

const data = new SlashCommandBuilder()
  .setName('booster').setDescription('Server booster perks')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('perks').setDescription('See the booster perks and where you stand'))
  .addSubcommand((s) => s.setName('colour').setDescription('Set your own name colour (boosters only)')
    .addStringOption((o) => o.setName('hex').setDescription('A colour like #ff5c8a').setRequired(true).setMinLength(6).setMaxLength(7)))
  .addSubcommand((s) => s.setName('reset').setDescription('Remove your personal name colour'));

const notBooster = () => ui.notice('Boosters Only',
  'This is a perk for server boosters. Boost the server and it unlocks straight away.', { icon: 'gem', accent: colors.alert });

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { member, guild } = interaction;
  const sub = interaction.options.getSubcommand();
  const reply = (container) => interaction.editReply(ui.edit(container));
  try {
    if (sub === 'perks') {
      if (!member.premiumSince) return reply(views.guideTopic('boosters'));
      const months = boosters.monthsBoosted(member.premiumSinceTimestamp);
      const reached = boosters.pickAnniversary(months);
      return reply(ui.notice('You Are A Booster', 'Thank you for boosting. Everything below is yours.', {
        icon: 'gem', accent: colors.teal,
        fields: [
          ['XP Multiplier', ui.fmt.code(`x${levels.booster.multiplier}`), 'zap'],
          ['Boosting For', ui.fmt.code(`${months} month${months === 1 ? '' : 's'}`), 'calendar'],
          ['Anniversary', reached ? ui.fmt.bold(boosters.anniversaryLabel(reached)) : ui.fmt.code('first one at 1 month'), 'medal'],
          ['Personal Colour', ui.fmt.code('/booster colour'), 'sparkle'],
        ],
      }));
    }
    if (!member.premiumSince) return reply(notBooster());
    if (sub === 'colour') {
      const hex = boosters.parseHex(interaction.options.getString('hex', true));
      if (hex === null) return reply(ui.notice('Not A Colour', 'Use a six-digit colour like `#ff5c8a`.', { icon: 'warning', accent: colors.alert }));
      await boosters.setPersonalColour(member, hex);
      return reply(ui.notice('Colour Set', 'Your personal colour is live. It disappears if your boost ends.', { icon: 'check', accent: colors.teal }));
    }
    const removed = await boosters.removePersonalColour(guild, member.id);
    return reply(ui.notice(removed ? 'Colour Removed' : 'Nothing To Remove', removed ? 'Your personal colour is gone.' : 'You do not have a personal colour set.', { icon: 'check' }));
  } catch (err) {
    console.error('[/booster]', err);
    return reply(ui.notice('Something Went Wrong', 'Tower hit an unexpected error. It has been logged.', { accent: colors.alert }));
  }
}

module.exports = { data, execute };
