const { TextDisplayBuilder } = require('discord.js');
const ui = require('../../ui');
const { commissions: cfg } = require('../../constants');
const c = require('../../lib/commission');
const { ModError } = require('../moderation/actions');
const logger = require('../logging/logger');
const { matchesChannelName } = require('../../lib/channels');
const service = require('./service');
const views = require('./views');

const { fmt } = ui;

// A card with the client pinged above it (a components message cannot carry normal text).
function withPing(card, userId) {
  const payload = ui.message(card);
  payload.components.unshift(new TextDisplayBuilder().setContent(`<@${userId}>`));
  payload.allowedMentions = { parse: [], users: [userId] };
  return payload;
}

// Sends the client something: into their ticket when the commission has one, otherwise by direct message.
// Returns where it went: 'ticket', 'dm' or null.
async function reachClient(client, row, card, { preferDm = false } = {}) {
  const ticket = row.ticket_channel_id && !preferDm ? await client.channels.fetch(row.ticket_channel_id).catch(() => null) : null;
  if (ticket?.send) {
    const sent = await ticket.send(withPing(card, row.client_id)).catch(() => null);
    if (sent) return 'ticket';
  }
  const user = await client.users.fetch(row.client_id).catch(() => null);
  if (user && await user.send(ui.message(card)).then(() => true, () => false)) return 'dm';
  return null;
}
const whereText = (where) => (where === 'ticket' ? 'in their ticket' : where === 'dm' ? 'by direct message' : 'nowhere: their DMs are closed and there is no ticket');

async function create(guild, staffId, x) {
  if (await service.countOpen(guild.id) >= cfg.maxOpen) throw new ModError(`There are already ${cfg.maxOpen} open commissions. Complete or cancel some first.`);
  return service.create({ guildId: guild.id, createdBy: staffId, ...x });
}

// Changes the status, tells the client, and asks for a review when it is complete.
async function changeStatus({ client, guild, row, status, staffId, note, notify = true, askReview = true }) {
  const updated = await service.setStatus(row.id, status, staffId, note);
  const result = { row: updated, notified: null, review: null };
  if (notify) result.notified = await reachClient(client, updated, views.clientCard(updated, 'Commission Update'));
  if (status === 'completed' && askReview && !(await service.getReview(row.id))) result.review = await requestReview(client, guild, updated);
  return result;
}

// The review request always goes to the client's DMs first (it is theirs to answer in private), then their ticket.
async function requestReview(client, guild, row) {
  if (await service.getReview(row.id)) throw new ModError('This commission already has a review.');
  const where = await reachClient(client, row, views.reviewRequest(row, guild.name), { preferDm: true });
  if (where) await service.markReviewRequested(row.id);
  return where;
}

// The private channel reviews are posted to: COMMISSION_REVIEW_CHANNEL_ID if set, otherwise a channel named "commission-reviews".
async function reviewChannel(client, guildId) {
  if (cfg.reviewChannelId) {
    const byId = await client.channels.fetch(cfg.reviewChannelId).catch(() => null);
    if (byId) return byId;
  }
  const guild = client.guilds?.cache?.get(guildId);
  return guild?.channels?.cache?.find((c) => c.isTextBased?.() && matchesChannelName(c.name, 'commission-reviews')) ?? null;
}

// Saves the review and posts it to the staff's private channel, like a ticket log.
async function submitReview({ client, row, user, input }) {
  const review = await service.saveReview({
    commissionId: row.id, guildId: row.guild_id, clientId: user.id, orderText: input.orderText,
    rating: input.rating, wentWell: input.wentWell, improve: input.improve,
  });
  if (!review) return { already: true };
  const channel = await reviewChannel(client, row.guild_id);
  let posted = false;
  if (channel?.send) {
    const sent = await channel.send({
      ...ui.message(views.reviewLog(row, review, { guildId: row.guild_id, avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }) })),
      allowedMentions: { parse: [] },
    }).catch((err) => { console.error('[commission] review post:', err.message); return null; });
    if (sent) { posted = true; await service.setReviewMessage(row.id, sent.id); }
  } else {
    console.error('[commission] no review channel found (set COMMISSION_REVIEW_CHANNEL_ID or make a channel named commission-reviews). The review is saved and shows in /commission reviews.');
  }
  return { already: false, review, posted };
}

// ---------- deadline reminders, sent to whoever created the commission ----------
async function tick(client) {
  for (const row of await service.dueForReminder()) {
    try {
      const guild = client.guilds.cache.get(row.guild_id);
      const card = views.reminderCard(row);
      let user = await client.users.fetch(row.created_by).catch(() => null);
      let sent = user ? await user.send(ui.message(card)).then(() => true, () => false) : false;
      if (!sent && guild) {
        user = await guild.fetchOwner().then((m) => m.user).catch(() => null);
        sent = user ? await user.send(ui.message(card)).then(() => true, () => false) : false;
      }
      await service.markReminded(row.id);                // once a day at most, even if nobody could be reached
    } catch (err) {
      console.error(`[commission] reminder #${row.id}:`, err.message);
    }
  }
}
function startScheduler(client) {
  const run = () => tick(client).catch((err) => console.error('[commission] scheduler:', err.message));
  setTimeout(run, 45_000).unref();
  setInterval(run, cfg.reminderTickMs).unref();
}

module.exports = { create, changeStatus, requestReview, submitReview, reachClient, whereText, tick, startScheduler, withPing };
