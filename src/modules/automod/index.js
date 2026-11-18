const { PermissionFlagsBits } = require('discord.js');
const { automod: cfg } = require('../../constants');
const lib = require('../../lib/automod');
const { clip } = require('../../lib/text');
const modActions = require('../moderation/actions');
const { levelFor } = require('../moderation/permissions');
const engine = require('../levels/engine');
const service = require('./service');

const tracker = new lib.FloodTracker(cfg.trackerKeepMs);
setInterval(() => tracker.prune(), 5 * 60_000).unref();

const lastWarn = new Map();     // "guild:user" -> time of the last warning
const lastNotice = new Map();   // "guild:user" -> time of the last notice
const invites = new Map();      // invite code -> { at, foreign }

// ---------- who is never touched ----------
function isExempt(message, settings) {
  const member = message.member;
  if (!member) return true;                                           // nothing to judge without the member
  const staff = levelFor([...member.roles.cache.values()].map((r) => r.name), { isOwner: message.guild.ownerId === member.id, isAdmin: member.permissions.has(PermissionFlagsBits.Administrator) });
  if (staff > 0 || member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  const ch = message.channel;
  if (settings.exemptChannels.some((id) => id === message.channelId || id === ch?.parentId || id === ch?.parent?.parentId)) return true;
  return settings.exemptRoles.some((id) => member.roles.cache.has(id));
}

// An invite to this same server is fine; any other is not. Looked up once and remembered for a while.
async function isForeignInvite(message, code) {
  const hit = invites.get(code);
  if (hit && Date.now() - hit.at < cfg.inviteCacheMs) return hit.foreign;
  let foreign = true;
  try {
    const invite = await message.client.fetchInvite(code);
    foreign = invite.guild?.id !== message.guild.id;
  } catch { /* an invalid or expired invite is treated as foreign */ }
  invites.set(code, { at: Date.now(), foreign });
  return foreign;
}

const mentionCount = (message) => new Set([...message.mentions.users.keys(), ...message.mentions.roles.keys()]).size;

// ---------- the check ----------
// Returns true when the message was removed, so the caller can stop (no XP, no logging of a deleted message).
async function inspect(message, { edited = false } = {}) {
  if (!message.guild || message.author?.bot || message.webhookId || message.system) return false;
  const settings = await service.getSettings(message.guild.id);
  if (!settings.enabled || isExempt(message, settings)) return false;

  const { config } = settings;
  const words = config.words.enabled ? await service.getWords(message.guild.id) : [];
  const memberLevel = config.links.exemptLevel > 0 ? (await engine.peek(message.guild.id, message.author.id).catch(() => null))?.level ?? 0 : 0;

  let violation = await lib.evaluateContent({
    content: message.content, mentionCount: mentionCount(message), config, words, memberLevel,
    isForeignInvite: (code) => isForeignInvite(message, code),
  });
  let messages = [{ id: message.id, channelId: message.channelId }];

  if (!violation && !edited && config.spam.enabled) {
    const key = `${message.guild.id}:${message.author.id}`;
    const hit = tracker.record(key, { id: message.id, channelId: message.channelId, content: message.content || `[${message.attachments.size} attachment]` }, config.spam);
    if (hit) { violation = hit; messages = hit.messages.map((m) => ({ id: m.id, channelId: m.channelId })); tracker.clear(key, messages.map((m) => m.id)); }
  }
  if (!violation) return false;

  await enforce(message, violation, messages);
  return true;
}

// ---------- the response: remove, warn (at most once a minute), tell them briefly ----------
let permissionWarned = 0;
async function removeAll(message, targets) {
  const { guild } = message;
  let removed = 0;
  const byChannel = new Map();
  for (const t of targets) byChannel.set(t.channelId, [...(byChannel.get(t.channelId) ?? []), t.id]);
  for (const [channelId, ids] of byChannel) {
    const channel = guild.channels.cache.get(channelId) ?? message.channel;
    try {
      if (ids.length > 1 && channel.bulkDelete) removed += (await channel.bulkDelete(ids, true)).size ?? ids.length;
      else { await channel.messages.delete(ids[0]); removed += 1; }
    } catch (err) {
      if (Date.now() - permissionWarned > 10 * 60_000) { permissionWarned = Date.now(); console.warn(`[automod] could not delete a message: ${err.message}. Tower needs Manage Messages in that channel.`); }
    }
  }
  return removed;
}

async function enforce(message, violation, targets) {
  const { guild, author } = message;
  const key = `${guild.id}:${author.id}`;
  const content = message.content ?? '';
  await removeAll(message, targets);

  let warned = false;
  if (Date.now() - (lastWarn.get(key) ?? 0) >= cfg.warnCooldownMs) {
    lastWarn.set(key, Date.now());
    const me = guild.members.me;
    try {
      await modActions.warn({ guild, moderator: me, botMember: me, level: 5 }, author, `AutoMod: ${violation.label}${content ? ` ("${clip(content, 150)}")` : ''}`, { source: 'automod' });
      warned = true;
    } catch (err) {
      console.warn(`[automod] could not warn ${author.tag ?? author.id}: ${err.message}`);
    }
  }

  if (Date.now() - (lastNotice.get(key) ?? 0) >= cfg.noticeCooldownMs) {
    lastNotice.set(key, Date.now());
    const note = await message.channel.send({
      content: `${author}, your message was removed for ${violation.label}.${warned ? ' This counts as a warning.' : ''}`,
      allowedMentions: { users: [author.id] },
    }).catch(() => null);
    if (note) setTimeout(() => note.delete().catch(() => {}), cfg.noticeSeconds * 1000).unref();
  }
}

// For /automod test: what the content rules would say about some text. Spam cannot be tested this way.
async function dryRun(text, settings, words, guildId = null) {
  return lib.evaluateContent({
    content: text, mentionCount: new Set(text.match(/<@[!&]?\d+>/g) ?? []).size, config: settings.config, words: settings.config.words.enabled ? words : [],
    isForeignInvite: async () => true,
  });
}

module.exports = { inspect, enforce, dryRun, isExempt, tracker, lastWarn, lastNotice };
