const { PermissionFlagsBits } = require('discord.js');
const ui = require('../../ui');
const { staff: cfg } = require('../../constants');
const lib = require('../../lib/staff');
const { ModError } = require('../moderation/actions');
const logger = require('../logging/logger');
const logChannels = require('../logging/channels');
const service = require('./service');
const roles = require('./roles');
const views = require('./views');

const roleNamesOf = (member) => [...member.roles.cache.values()].map((r) => r.name);
const staffAuth = (member) => lib.authority(roleNamesOf(member), { isOwner: member.guild.ownerId === member.id, isAdmin: member.permissions.has(PermissionFlagsBits.Administrator) });
const profile = (member) => lib.profileOf(roleNamesOf(member));

// Anyone on a team, in leadership, or holding the Staff role may look at the roster.
const isStaffMember = (member) => Boolean(profile(member) || staffAuth(member) || member.roles.cache.some((r) => lib.norm(r.name) === lib.norm(cfg.staffRole)));

async function dm(client, userId, payload) {
  const user = await client.users.fetch(userId).catch(() => null);
  return user ? user.send(payload).catch(() => null) : null;
}
// Staff changes go to the staff log channel. Until one is found they go to server-logs, so nothing is lost.
function logType(guild) {
  try { return logChannels.channelFor(guild, 'staff') ? 'staff' : 'server'; } catch { return 'server'; }
}
const record = (guild, card, actorId, targetId, detail) => logger.log(guild, logType(guild), () => card, { actorId, targetId, detail }).catch(() => {});

// Checks that every role exists and that Tower may give and take them, before anyone is bothered or anything is changed.
function checkReady(guild, plan, member) {
  const resolved = roles.resolve(guild, plan, member);
  if (resolved.missing.length) throw new ModError(`These roles do not exist yet: ${resolved.missing.map((n) => `**${n}**`).join(', ')}. Create them first.`);
  if (resolved.problems.length) throw new ModError(`Tower cannot manage: ${resolved.problems.map((n) => `**${n}**`).join(', ')}. Move Tower's role above them in the role list.`);
  return resolved;
}

// ---------- /induct: make the offer ----------
async function induct({ client, guild, actor, target, teamKey, rankKey, note }) {
  if (target.user.bot) throw new ModError('Bots cannot join the staff team.');
  if (target.id === actor.id) throw new ModError('You cannot induct yourself.');
  const decision = lib.decideInduct({ auth: staffAuth(actor), teamKey, rankKey, targetProfile: profile(target) });
  if (decision.error) throw new ModError(decision.error);
  if (await service.pendingFor(guild.id, target.id)) throw new ModError('They already have an offer waiting for an answer. See `/offers list`.');
  checkReady(guild, lib.rolePlan({ action: 'induct', team: decision.team, toIndex: decision.index }), target);

  const offer = await service.createOffer({ guildId: guild.id, userId: target.id, team: teamKey, rankKey: decision.rank.key, offeredBy: actor.id, note: note ?? '' });
  const message = await dm(client, target.id, ui.message(views.offerCard(offer, guild.name)));
  if (!message) {
    await service.settle(offer.id, 'cancelled');
    throw new ModError('They could not be sent the offer: their DMs are closed. Ask them to allow DMs from server members, then try again.');
  }
  await service.setOfferMessage(offer.id, message.channelId, message.id);
  return offer;
}

// ---------- the person's answer ----------
const alreadyAnswered = () => ({ card: ui.notice('Already Answered', 'This offer has already been dealt with.', { icon: 'check' }) });

async function respond({ client, user, offerId, accept, note }) {
  const offer = await service.getOffer(offerId);
  if (!offer || offer.user_id !== user.id) throw new ModError('That offer could not be found.');
  if (offer.status !== 'pending') return alreadyAnswered();
  if (new Date(offer.expires_at).getTime() <= Date.now()) { await service.settle(offer.id, 'expired'); return { card: views.expired(offer) }; }

  const guild = client.guilds.cache.get(offer.guild_id) ?? await client.guilds.fetch(offer.guild_id).catch(() => null);
  if (!guild) throw new ModError('Tower cannot reach that server right now.');
  const tell = (card) => dm(client, offer.offered_by, ui.message(card));

  if (!accept) {
    if (!(await service.settle(offer.id, 'declined', note))) return alreadyAnswered();
    await tell(views.answered(offer, user, { accepted: false, note }));
    await record(guild, views.logCard({ action: 'induct', userId: user.id, byId: offer.offered_by, team: offer.team, toRank: `${views.rankLabel(offer.team, offer.rank_key)} (declined)`, note }), user.id, user.id);
    return { card: views.declined(offer) };
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) { await service.settle(offer.id, 'cancelled'); throw new ModError('You are no longer in the server, so this offer cannot be used.'); }
  const inductor = await guild.members.fetch(offer.offered_by).catch(() => null);
  const team = lib.teamOf(offer.team);
  const decision = lib.decideInduct({ auth: inductor ? staffAuth(inductor) : null, teamKey: offer.team, rankKey: offer.rank_key, targetProfile: profile(member) });
  if (decision.error) {                                               // the person who offered can no longer give this, or the member is already staff
    await service.settle(offer.id, 'cancelled');
    await tell(ui.notice('Offer No Longer Valid', `The offer to ${ui.fmt.user(user.id)} could not be completed: ${decision.error}`, { icon: 'warning' }));
    return { card: views.cancelledOffer(offer) };
  }

  const plan = lib.rolePlan({ action: 'induct', team, toIndex: decision.index });
  let resolved;
  try { resolved = checkReady(guild, plan, member); } catch (err) {
    await service.settle(offer.id, 'failed', note);
    await tell(views.answered(offer, user, { accepted: true, note, failed: err.message }));
    return { card: views.failedAccept('Your roles could not be given right now.') };
  }
  if (!(await service.settle(offer.id, 'accepted', note))) return alreadyAnswered();

  try {
    await roles.apply(member, resolved, `Staff induction accepted (offer #${offer.id})`);
  } catch (err) {
    await service.setStatus(offer.id, 'failed');
    await tell(views.answered(offer, user, { accepted: true, note, failed: `Discord refused the role change: ${err.message}` }));
    return { card: views.failedAccept('Your roles could not be given right now.') };
  }
  const rankName = decision.rank.label;
  await service.addHistory({ guildId: guild.id, userId: user.id, action: 'induct', team: offer.team, toRank: rankName, by: offer.offered_by, reason: note });
  await tell(views.answered(offer, user, { accepted: true, note, failed: resolved.headerNote }));
  await record(guild, views.logCard({ action: 'induct', userId: user.id, byId: offer.offered_by, team: offer.team, toRank: rankName, note }), offer.offered_by, user.id);
  return { card: views.accepted(offer, guild.name) };
}

// ---------- /promote, /demote, /remove ----------
async function change({ client, guild, actor, target, action, reason = '', notify = true }) {
  if (target.user.bot) throw new ModError('Bots are not on the staff team.');
  if (target.id === actor.id) throw new ModError(`You cannot ${action} yourself.`);
  const decision = lib.decideChange({ action, auth: staffAuth(actor), targetProfile: profile(target) });
  if (decision.error) throw new ModError(decision.error);

  const plan = lib.rolePlan({ action, team: decision.team, fromIndex: decision.from, toIndex: decision.to, keepStaff: lib.holdsLeadership(roleNamesOf(target)) });
  const resolved = checkReady(guild, plan, target);
  const applied = await roles.apply(target, resolved, `${action} by ${actor.user.tag ?? actor.id}${reason ? `: ${reason}` : ''}`);

  const fromRank = decision.fromRank?.label; const toRank = decision.toRank?.label;
  await service.addHistory({ guildId: guild.id, userId: target.id, action, team: decision.team.key, fromRank, toRank, by: actor.id, reason });
  await record(guild, views.logCard({ action, userId: target.id, byId: actor.id, team: decision.team.key, fromRank, toRank, reason }), actor.id, target.id);
  const dmSent = notify ? Boolean(await dm(client, target.id, ui.message(views.memberNotice({ action, guildName: guild.name, team: decision.team.key, fromRank, toRank, reason })))) : false;
  return { applied, headerNote: resolved.headerNote, dmSent, team: decision.team.key, fromRank, toRank };
}

// ---------- /offers ----------
async function cancelOffer({ client, guild, actor, offerId }) {
  const offer = await service.getOffer(offerId);
  if (!offer || offer.guild_id !== guild.id) throw new ModError('There is no offer with that number.');
  const auth = staffAuth(actor);
  if (offer.offered_by !== actor.id && !(auth && (auth.kind === 'owner' || auth.kind === 'admin'))) throw new ModError('Only the person who made an offer, or an administrator, can withdraw it.');
  const settled = await service.settle(offer.id, 'cancelled');
  if (!settled) throw new ModError('That offer has already been answered.');
  await editOfferMessage(client, offer, views.cancelledOffer(offer));
  return offer;
}

async function editOfferMessage(client, offer, card) {
  if (!offer.dm_channel_id || !offer.dm_message_id) return;
  try {
    const channel = await client.channels.fetch(offer.dm_channel_id);
    const message = await channel.messages.fetch(offer.dm_message_id);
    await message.edit(ui.edit(card));
  } catch { /* the message may have been deleted by the person, which is fine */ }
}

// Offers nobody answered are closed after a week, and both sides are told.
async function tick(client) {
  for (const offer of await service.expireDue()) {
    await editOfferMessage(client, offer, views.expired(offer));
    await dm(client, offer.offered_by, ui.message(ui.notice('Offer Expired', `${ui.fmt.user(offer.user_id)} did not answer the **${views.rankLabel(offer.team, offer.rank_key)}** offer in time (${ui.fmt.code(`#${offer.id}`)}).`, { icon: 'clock' })));
  }
}
function startScheduler(client) {
  const run = () => tick(client).catch((err) => console.error('[staff] scheduler:', err.message));
  setTimeout(run, 60_000).unref();
  setInterval(run, cfg.tickMs).unref();
}

// ---------- /roster ----------
// Built from the roles people hold, so it is right even for people given a role by hand.
async function rosterData(guild, { teamKey = null, withLeadership = true } = {}) {
  let partial = false;
  let members;
  try { members = await guild.members.fetch(); } catch { members = guild.members.cache; partial = true; }
  const all = [...members.values()];
  const teams = (teamKey ? [lib.teamOf(teamKey)] : lib.TEAMS).filter(Boolean).map((team) => ({
    team, ranks: team.ranks.map((rank, index) => ({ label: rank.label, ids: all.filter((m) => { const p = profile(m); return p && p.team === team.key && p.index === index; }).map((m) => m.id) })),
  }));
  const named = (roleName) => all.filter((m) => m.roles.cache.some((r) => lib.norm(r.name) === lib.norm(roleName))).map((m) => m.id);
  const leadership = withLeadership ? { owner: guild.ownerId, administrators: named('Administrator'), producers: named('Co-Owner') } : null;
  const ids = [...new Set([...teams.flatMap((t) => t.ranks.flatMap((r) => r.ids))])];
  const since = await service.inductedSince(guild.id, ids).catch(() => new Map());
  return { leadership, teams, since, partial };
}

module.exports = { induct, respond, change, cancelOffer, tick, startScheduler, rosterData, staffAuth, profile, isStaffMember, roleNamesOf, checkReady };
