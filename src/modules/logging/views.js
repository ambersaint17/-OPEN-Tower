const { card, fmt } = require('../../ui');
const { ic } = require('../../emojis');
const { colors, boost } = require('../../constants');

const tag = (user) => (user ? `${fmt.user(user.id)} (${user.tag ?? user.username})` : fmt.code('unknown'));

// Every log card ends with the same two lines: a traceable ID and the time.
function entry({ id, icon, title, description, thumbnail, accent, fields = [], blocks = [], images, file }) {
  return card({
    icon, title, description, thumbnail, accent, blocks, images, file,
    fields: [
      ...fields,
      ['Log ID', fmt.code(id), 'ticket'],
      ['Timestamp', fmt.bold(fmt.time(new Date(), 'F')), 'clock'],
    ],
  });
}

// ---------- the public booster thank-you ----------

function boostThanks({ member, guild, boosterRoleId }) {
  const roleLine = boosterRoleId ? fmt.role(boosterRoleId) : '**Server Booster**';
  return card({
    banner: 'boost',
    icon: 'gem',
    title: `Thank you for boosting, ${member.displayName}`,
    thumbnail: member.displayAvatarURL({ extension: 'png', size: 256 }),
    description:
      `${fmt.user(member.id)} just boosted **${guild.name}**. Your booster perks are unlocked, ` +
      `and the ${roleLine} role is already yours.\n\n` +
      '**Your perks**\n' +
      boost.perks.map((perk) => `${ic('check')}${perk}`).join('\n'),
    fields: [
      ['Server Boosts', fmt.code(guild.premiumSubscriptionCount ?? 0), 'heart'],
      ['Server Level', fmt.code(guild.premiumTier ?? 0), 'level_up'],
    ],
  });
}

function tierReached({ guild, tier }) {
  return card({
    banner: 'boost',
    icon: 'level_up',
    title: `${guild.name} reached Level ${tier}`,
    accent: colors.teal,
    description:
      'Thanks to our boosters, the server just unlocked a new level and new perks for everyone.\n' +
      'If you would like to help us climb to the next one, boosting is always appreciated.',
    fields: [
      ['Server Boosts', fmt.code(guild.premiumSubscriptionCount ?? 0), 'heart'],
      ['Server Level', fmt.code(tier), 'level_up'],
    ],
  });
}

module.exports = { entry, boostThanks, tierReached, tag };
