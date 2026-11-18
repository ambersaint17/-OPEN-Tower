const ui = require('../../ui');
const { matchesChannelName } = require('../../lib/channels');
const views = require('./views');

const recent = new Map(); // userId -> time of the last thank-you, so two code paths never double-post

function boostChannel(guild) {
  return guild.channels.cache.find(
    (c) => c.isTextBased() && !c.isThread() && (matchesChannelName(c.name, 'server-boosts') || matchesChannelName(c.name, 'boosts')),
  ) ?? null;
}

const send = (channel, container, extra = {}) =>
  channel.send({ ...ui.message(container), ...extra });

async function announceBoost(guild, member) {
  const now = Date.now();
  if (now - (recent.get(member.id) ?? 0) < 30_000) return;
  recent.set(member.id, now);

  const channel = boostChannel(guild);
  if (!channel) return;
  const role = guild.roles.cache.find((r) => r.tags?.premiumSubscriberRole);
  try {
    await send(channel, views.boostThanks({ member, guild, boosterRoleId: role?.id }), {
      allowedMentions: { users: [member.id] },
    });
  } catch (err) {
    console.error('[boost] could not post the thank-you:', err.message);
  }
}

async function announceTier(guild, tier) {
  const channel = boostChannel(guild);
  if (!channel) return;
  try {
    await send(channel, views.tierReached({ guild, tier }), { allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[boost] could not post the level-up:', err.message);
  }
}

module.exports = { announceBoost, announceTier };
