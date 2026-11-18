const { PermissionFlagsBits } = require('discord.js');
const ui = require('../../ui');
const { moderation } = require('../../constants');
const { clip } = require('../../lib/text');
const logger = require('../logging/logger');
const service = require('./service');
const views = require('./views');
const { levelFor, can, maxTimeoutMs, rankLabel } = require('./permissions');
const { checkTarget } = require('./checks');
const { parseDuration, formatDuration, DISCORD_MAX_TIMEOUT_MS } = require('./duration');

// A failure with a message that is safe and useful to show the moderator.
class ModError extends Error {}
const fail = (message) => { throw new ModError(message); };

// Who is running the command, and are they allowed to?
async function contextFor(interaction, action) {
  const { guild } = interaction;
  const moderator = interaction.member;
  const level = levelFor([...moderator.roles.cache.values()].map((r) => r.name), {
    isOwner: guild.ownerId === moderator.id,
    isAdmin: moderator.permissions.has(PermissionFlagsBits.Administrator),
  });
  if (!can(level, action)) {
    fail(level === 0 ? 'Only staff can use this command.' : `Your rank (${rankLabel(level)}) is not allowed to do that.`);
  }
  return { interaction, guild, moderator, level, botMember: guild.members.me };
}

function cleanReason(input, { required = false } = {}) {
  const text = (input ?? '').trim();
  if (!text) {
    if (required) fail('A reason is required for this action.');
    return 'No reason given';
  }
  return clip(text, moderation.reasonMax);
}

const auditReason = (moderator, reason) => clip(`${moderator.user.tag}: ${reason}`, 480);
const fetchMember = (guild, id) => guild.members.fetch(id).catch(() => null);

// Sends the member their notice. Falls back to plain text if Discord refuses the card format in DMs.
async function sendDm(user, { row, guild, warnCount }) {
  try {
    await user.send(ui.message(views.dmCard({ row, guild, warnCount })));
    return 'sent';
  } catch (err) {
    if (err.code === 50007) return 'failed'; // the member has DMs closed
  }
  try {
    await user.send({ content: views.dmPlain({ row, guild, warnCount }) });
    return 'sent';
  } catch {
    return 'failed';
  }
}

const postCase = (guild, row, user) =>
  logger.log(guild, 'cases', () => views.caseCard(row, user.displayAvatarURL({ extension: 'png', size: 256 })), {
    actorId: row.moderator_id, targetId: row.user_id, detail: { case: row.case_number, type: row.type },
  });

// Stores the case, optionally notifies the member, and posts the case card.
async function record(ctx, { type, user, reason, durationMs = null, expiresAt = null, dm = false, warnCount, source = 'command' }) {
  let row = await service.createCase({
    guildId: ctx.guild.id, type, user, moderator: ctx.moderator.user, reason, durationMs, expiresAt, source,
  });
  if (dm) {
    const status = await sendDm(user, { row, guild: ctx.guild, warnCount });
    await service.setDmStatus(row.id, status);
    row = { ...row, dm_status: status };
  }
  await postCase(ctx.guild, row, user);
  return row;
}

async function memberOrFail(ctx, user) {
  const member = await fetchMember(ctx.guild, user.id);
  if (!member) fail('That user is not in this server.');
  return member;
}

function guard(ctx, action, member, user, needsBotRank = true) {
  const error = checkTarget({
    action, moderator: ctx.moderator, target: member, targetUser: user,
    botMember: ctx.botMember, ownerId: ctx.guild.ownerId, needsBotRank,
  });
  if (error) fail(error);
}

// ---------- the actions ----------

async function warn(ctx, user, reasonInput, { source = 'command' } = {}) {
  const reason = cleanReason(reasonInput);
  const member = await memberOrFail(ctx, user);
  guard(ctx, 'warn', member, user, false);

  const count = (await service.countActiveWarns(ctx.guild.id, user.id)) + 1;
  const row = await record(ctx, { type: 'warn', user, reason, dm: true, warnCount: count, source });

  if (count >= moderation.escalation.warns) {
    await logger.log(ctx.guild, 'cases', () => views.escalation({ user, count }), { targetId: user.id, detail: { escalation: true } });
  }
  return row;
}

async function timeout(ctx, user, durationInput, reasonInput) {
  const ms = parseDuration(durationInput);
  if (!ms) fail('Use a duration like `30m`, `2h`, `1d` or `1h30m`.');
  if (ms < 60_000) fail('A timeout must be at least 1 minute.');
  if (ms > DISCORD_MAX_TIMEOUT_MS) fail('Discord does not allow timeouts longer than 28 days.');
  if (ms > maxTimeoutMs(ctx.level)) {
    fail(`Your rank (${rankLabel(ctx.level)}) can time out for at most ${formatDuration(maxTimeoutMs(ctx.level))}.`);
  }
  const reason = cleanReason(reasonInput);
  const member = await memberOrFail(ctx, user);
  guard(ctx, 'time out', member, user);
  if (!member.moderatable) fail('Tower cannot time out that member. Check Tower\'s role position and permissions.');

  await member.timeout(ms, auditReason(ctx.moderator, reason));
  return record(ctx, { type: 'timeout', user, reason, durationMs: ms, expiresAt: new Date(Date.now() + ms), dm: true });
}

async function untimeout(ctx, user, reasonInput) {
  const reason = cleanReason(reasonInput);
  const member = await memberOrFail(ctx, user);
  guard(ctx, 'remove the timeout of', member, user);
  if (!(member.communicationDisabledUntilTimestamp > Date.now())) fail('That member is not timed out.');

  await member.timeout(null, auditReason(ctx.moderator, reason));
  return record(ctx, { type: 'untimeout', user, reason, dm: true });
}

// Kicks and bans notify the member BEFORE the action: once they are gone, Tower can no longer message them.
// If the action then fails, the case is voided so the record stays honest.
async function removeMember(ctx, { type, user, reason, perform }) {
  let row = await service.createCase({ guildId: ctx.guild.id, type, user, moderator: ctx.moderator.user, reason });
  const status = await sendDm(user, { row, guild: ctx.guild });
  await service.setDmStatus(row.id, status);
  row = { ...row, dm_status: status };
  try {
    await perform();
  } catch (err) {
    await service.voidCase(ctx.guild.id, row.case_number, ctx.botMember.id, 'The action failed, so nothing was changed.');
    throw err;
  }
  await postCase(ctx.guild, row, user);
  return row;
}

async function kick(ctx, user, reasonInput) {
  const reason = cleanReason(reasonInput, { required: true });
  const member = await memberOrFail(ctx, user);
  guard(ctx, 'kick', member, user);
  if (!member.kickable) fail('Tower cannot kick that member. Check Tower\'s role position and permissions.');
  return removeMember(ctx, { type: 'kick', user, reason, perform: () => member.kick(auditReason(ctx.moderator, reason)) });
}

// Shared by the confirmation prompt and the real ban, so mistakes show up before the button.
async function validateBan(ctx, user, reasonInput) {
  const reason = cleanReason(reasonInput, { required: true });
  const member = await fetchMember(ctx.guild, user.id);
  guard(ctx, 'ban', member, user, Boolean(member));
  if (member && !member.bannable) fail('Tower cannot ban that member. Check Tower\'s role position and permissions.');
  if (await ctx.guild.bans.fetch(user.id).catch(() => null)) fail('That user is already banned.');
  return reason;
}

async function ban(ctx, user, reasonInput, deleteSeconds = 0) {
  const reason = await validateBan(ctx, user, reasonInput);
  return removeMember(ctx, {
    type: 'ban', user, reason,
    perform: () => ctx.guild.members.ban(user.id, {
      reason: auditReason(ctx.moderator, reason), deleteMessageSeconds: deleteSeconds,
    }),
  });
}

async function unban(ctx, userId, reasonInput) {
  if (!/^\d{15,22}$/.test(userId.trim())) fail('Give the numeric user ID of the banned person.');
  const reason = cleanReason(reasonInput);
  const entry = await ctx.guild.bans.fetch(userId.trim()).catch(() => null);
  if (!entry) fail('That user is not banned.');
  await ctx.guild.members.unban(userId.trim(), auditReason(ctx.moderator, reason));
  return record(ctx, { type: 'unban', user: entry.user, reason }); // no notice: Tower shares no server with them
}

async function note(ctx, user, text) {
  const reason = cleanReason(text, { required: true });
  if (user.id === ctx.moderator.id) fail('You cannot add a note about yourself.');
  return record(ctx, { type: 'note', user, reason });
}

async function editCase(ctx, number, reasonInput) {
  const existing = await service.getCase(ctx.guild.id, number);
  if (!existing) fail(`There is no case #${number}.`);
  if (existing.moderator_id !== ctx.moderator.id && !can(ctx.level, 'editAnyCase')) fail('You can only edit your own cases.');
  const reason = cleanReason(reasonInput, { required: true });
  const row = await service.editReason(ctx.guild.id, number, reason);
  await logger.log(ctx.guild, 'cases', () => views.edited(row, ctx.moderator.id), { actorId: ctx.moderator.id, detail: { case: number } });
  return row;
}

async function voidCase(ctx, number, reasonInput) {
  const existing = await service.getCase(ctx.guild.id, number);
  if (!existing) fail(`There is no case #${number}.`);
  if (existing.voided) fail('That case is already voided.');
  const reason = cleanReason(reasonInput, { required: true });
  const row = await service.voidCase(ctx.guild.id, number, ctx.moderator.id, reason);
  await logger.log(ctx.guild, 'cases', () => views.voided(row), { actorId: ctx.moderator.id, detail: { case: number } });
  return row;
}

module.exports = {
  ModError, contextFor, sendDm, postCase,
  warn, timeout, untimeout, kick, validateBan, ban, unban, note, editCase, voidCase,
};
