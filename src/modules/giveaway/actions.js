const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const ui = require('../../ui');
const { giveaways } = require('../../constants');
const L = require('../../lib/levels');
const g = require('../../lib/giveaway');
const { matchesChannelName } = require('../../lib/channels');
const { ModError } = require('../moderation/actions');
const { normalize } = require('../moderation/permissions');
const logger = require('../logging/logger');
const engine = require('../levels/engine');
const service = require('./service');
const views = require('./views');

const { fmt } = ui;
const POSTABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

// ---------- who a member is, for requirements and entry weights ----------
async function factsFor(member) {
  const entry = await engine.peek(member.guild.id, member.id);
  return {
    xp: entry.xp, level: entry.level, roleIds: new Set(member.roles.cache.keys()),
    booster: Boolean(member.premiumSince), joinedAt: member.joinedTimestamp ?? null, now: Date.now(),
  };
}
const isUnverified = (member) => member.roles.cache.some((r) => normalize(r.name) === 'unverified');

function ticketChannelId(guild) {
  const channel = guild.channels.cache.find((c) => POSTABLE.includes(c.type) && giveaways.ticketChannelNames.some((n) => matchesChannelName(c.name, n)));
  return channel?.id ?? null;
}

// ---------- starting ----------
async function start(guild, host, opts) {
  const channel = opts.channel;
  if (!channel || !POSTABLE.includes(channel.type)) throw new ModError('Pick a text or announcement channel for the giveaway.');
  const have = channel.permissionsFor(guild.members.me);
  const missing = [[P.ViewChannel, 'View Channel'], [P.SendMessages, 'Send Messages'], [P.AttachFiles, 'Attach Files']].filter(([p]) => !have?.has(p)).map(([, n]) => n);
  if (missing.length) throw new ModError(`Tower is missing ${missing.join(' and ')} in ${channel}.`);
  if (await service.countActive(guild.id) >= giveaways.maxActive) throw new ModError(`There are already ${giveaways.maxActive} giveaways running. End or cancel one first.`);

  const row = await service.create({
    guildId: guild.id, channelId: channel.id, hostId: host.id, prize: opts.prize, description: opts.description ?? '', winnerNote: opts.winnerNote ?? '',
    winners: opts.winners, endsAt: opts.endsAt, requirements: g.cleanRequirements(opts.requirements), pingRoleId: opts.pingRoleId, claimHours: opts.claimHours,
  });
  const above = views.pingLine(row);
  const payload = views.compose(views.announcement(row, 0), { above });
  payload.allowedMentions = { parse: [], roles: row.ping_role_id ? [row.ping_role_id] : [] };
  const message = await channel.send(payload);
  await service.setMessage(row.id, message.id);
  row.message_id = message.id;
  await logger.log(guild, 'server', () => ui.notice('Giveaway Started', clipPrize(row), {
    icon: 'gift', fields: [['By', fmt.user(host.id), 'user'], ['Channel', fmt.channel(channel.id), 'hash'], ['Ends', fmt.time(row.ends_at, 'R'), 'calendar']],
  }), { actorId: host.id, detail: { giveaway: row.id } }).catch(() => {});
  return row;
}
const clipPrize = (row) => `**${String(row.prize).slice(0, 200)}** (#${row.id})`;

// ---------- keeping the card fresh ----------
async function messageOf(client, row) {
  if (!row.message_id) return null;
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  return channel?.messages?.fetch(row.message_id).catch(() => null) ?? null;
}
async function refreshCard(client, id) {
  const row = await service.get(id);
  if (!row || row.status !== 'active') return;
  const message = await messageOf(client, row);
  if (!message) return;
  const payload = views.compose(views.announcement(row, await service.countEntries(id)), { above: views.pingLine(row), mode: 'edit' });
  payload.allowedMentions = { parse: [] };
  await message.edit(payload).catch(() => {});
}
// The entry counter updates at most once every few seconds, however many people press the button.
const pending = new Map();
function scheduleRefresh(client, id) {
  if (pending.has(id)) return;
  pending.set(id, setTimeout(() => { pending.delete(id); refreshCard(client, id).catch(() => {}); }, giveaways.countRefreshMs).unref());
}

// ---------- entering ----------
async function enter(interaction, row) {
  const { member } = interaction;
  if (row.status !== 'active' || new Date(row.ends_at).getTime() <= Date.now()) throw new ModError('This giveaway has ended.');
  if (member.user.bot) throw new ModError('Bots cannot enter giveaways.');
  if (isUnverified(member)) throw new ModError('Verify yourself first, then come back and enter.');
  const facts = await factsFor(member);
  const evaluation = g.evaluate(row.requirements, facts);
  if (!evaluation.ok) return { blocked: evaluation };
  const added = await service.addEntry(row.id, member.id);
  if (added) scheduleRefresh(interaction.client, row.id);
  return { facts, already: !added };
}

// ---------- drawing ----------
// Everyone who entered is checked again at the draw: still in the server, still meeting the requirements.
async function eligiblePool(guild, row, exclude = []) {
  const ids = (await service.entryIds(row.id)).filter((u) => !exclude.includes(u));
  const pool = [];
  for (let i = 0; i < ids.length; i += 100) {
    const members = await guild.members.fetch({ user: ids.slice(i, i + 100) }).catch(() => null);
    if (!members) continue;
    for (const member of members.values()) {
      if (member.user.bot) continue;
      const facts = await factsFor(member);
      if (!g.evaluate(row.requirements, facts).ok) continue;
      pool.push({ id: member.id, weight: L.giveawayEntries(facts.level, facts.booster) });
    }
  }
  return pool;
}

async function announceWinners(client, guild, row, winnerIds, { reroll = false } = {}) {
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  const ticketChannel = ticketChannelId(guild);
  if (channel) {
    const payload = views.compose(views.winnerMessage(row, winnerIds, { guildName: guild.name, ticketChannelId: ticketChannel, reroll }), {
      above: `${reroll ? '**Reroll**' : '**Winners**'}: ${winnerIds.map(fmt.user).join(' ')}`,
    });
    payload.allowedMentions = { parse: [], users: winnerIds };
    const sent = await channel.send(payload).catch((err) => { console.error('[giveaway] announce:', err.message); return null; });
    if (sent) await service.setWinnerMessage(row.id, sent.id);
  }
  for (const userId of winnerIds) {
    const user = await client.users.fetch(userId).catch(() => null);
    await user?.send(ui.message(views.winnerMessage(row, [userId], { guildName: guild.name, ticketChannelId: ticketChannel, dm: true, reroll }))).catch(() => {});
  }
}

async function showEnded(client, row) {
  const message = await messageOf(client, row);
  if (!message) return;
  await message.edit(views.compose(views.ended(row, await service.countEntries(row.id)), { above: views.pingLine(row), mode: 'edit' })).catch(() => {});
}

async function finish(client, id) {
  const row = await service.claimEnd(id);
  if (!row) return null;
  const guild = client.guilds.cache.get(row.guild_id) ?? await client.guilds.fetch(row.guild_id).catch(() => null);
  if (!guild) return row;
  const winners = g.pickWinners(await eligiblePool(guild, row), row.winners);
  row.winner_ids = winners;
  await service.setWinners(row.id, winners);
  await showEnded(client, row);
  if (winners.length) await announceWinners(client, guild, row, winners);
  await logger.log(guild, 'server', () => ui.notice('Giveaway Ended', clipPrize(row), {
    icon: 'trophy', fields: [['Winners', winners.length ? winners.map(fmt.user).join(' ') : 'none', 'user']],
  }), { detail: { giveaway: row.id, winners } }).catch(() => {});
  return row;
}

// Rerolls: `replace` removes someone who did not claim and draws one new winner instead.
async function reroll(client, guild, row, { count = 1, replace = null } = {}) {
  if (row.status !== 'ended') throw new ModError('Only a giveaway that has ended can be rerolled.');
  let current = [...row.winner_ids];
  if (replace) {
    if (!current.includes(replace)) throw new ModError('That member is not one of the winners.');
    current = current.filter((u) => u !== replace);
    count = 1;
  }
  const fresh = g.pickWinners(await eligiblePool(guild, row, [...row.winner_ids]), Math.min(count, giveaways.maxWinners));
  if (!fresh.length) throw new ModError('There is nobody else eligible to win.');
  row.winner_ids = [...current, ...fresh];
  await service.setWinners(row.id, row.winner_ids);
  await showEnded(client, row);
  await announceWinners(client, guild, row, fresh, { reroll: true });
  return fresh;
}

async function cancel(client, row) {
  const done = await service.cancel(row.id);
  if (!done) throw new ModError('That giveaway is not running.');
  const message = await messageOf(client, done);
  if (message) await message.edit(views.compose(views.cancelled(done), { mode: 'edit' })).catch(() => {});
  return done;
}

// ---------- scheduler ----------
let running = false;
async function tick(client) {
  if (running) return;
  running = true;
  try {
    for (const id of await service.due()) {
      try { await finish(client, id); } catch (err) { console.error(`[giveaway] #${id}:`, err.message); }
    }
  } finally { running = false; }
}
function start_(client) {
  const run = () => tick(client).catch((err) => console.error('[giveaway] scheduler:', err.message));
  setTimeout(run, 20_000).unref();
  setInterval(run, giveaways.tickMs).unref();
}

module.exports = {
  start, enter, finish, reroll, cancel, refreshCard, tick, startScheduler: start_, factsFor, eligiblePool, ticketChannelId, isUnverified, POSTABLE,
};
