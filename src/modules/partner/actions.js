const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const ui = require('../../ui');
const { partners: cfg } = require('../../constants');
const lib = require('../../lib/partner');
const { matchesChannelName } = require('../../lib/channels');
const { ModError } = require('../moderation/actions');
const automodService = require('../automod/service');
const staffRoles = require('../staff/roles');
const logger = require('../logging/logger');
const service = require('./service');
const views = require('./views');

const POSTABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// The channel ads go to: the one chosen with /partners setup, or one with a partnership-like name.
async function resolveChannel(guild, settings) {
  const chosen = settings.channel_id && await guild.channels.fetch(settings.channel_id).catch(() => null);
  const channel = chosen ?? [...guild.channels.cache.values()].find((c) => POSTABLE.includes(c.type) && cfg.channelNames.some((n) => matchesChannelName(c.name, n)));
  if (!channel) throw new ModError('There is no partnership channel yet. Choose one with `/partners setup channel:#your-channel`.');
  const have = channel.permissionsFor(guild.members.me);
  const missing = [[P.ViewChannel, 'View Channel'], [P.SendMessages, 'Send Messages'], [P.EmbedLinks, 'Embed Links'], [P.AttachFiles, 'Attach Files']].filter(([p]) => !have?.has(p)).map(([, n]) => n);
  if (missing.length) throw new ModError(`Tower is missing ${missing.join(' and ')} in ${channel}.`);
  return channel;
}

// What Discord says about an invite, or null when it is invalid or expired.
async function inspectInvite(client, code) {
  try {
    const invite = await client.fetchInvite(code);
    return {
      code, guildId: invite.guild?.id ?? null, name: invite.guild?.name ?? null, members: invite.memberCount ?? null, iconUrl: invite.guild?.iconURL?.({ extension: 'png', size: 256 }) ?? null,
      expiresAt: invite.expiresTimestamp ?? null, maxUses: invite.maxUses ?? 0, nsfwLevel: invite.guild?.nsfwLevel ?? 0,
    };
  } catch { return null; }
}

// ---------- pictures ----------
// Copies a picture so the ad keeps working: Discord's own picture links expire after a day, a copy uploaded with the message does not.
async function downloadImage(url, n, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`the download failed (${res.status})`);
  const type = (res.headers?.get?.('content-type') ?? '').split(';')[0];
  if (!EXT[type]) throw new Error('it is not a PNG, JPG, GIF or WebP picture');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > cfg.maxImageBytes) throw new Error(`it is larger than ${cfg.maxImageBytes / 1024 / 1024} MB`);
  return { name: `ad-${n}.${EXT[type]}`, buffer };
}

// Everything needed to post: the cleaned ad, its pictures, what the invite says, and the checks. Nothing is posted yet.
async function prepare({ client, guild, settings, ad: rawAd, typedName, ping, roleId, repId, style, ticketChannelId, actorId, attachments = [], keepLink = false, fetchImpl }) {
  const cleaned = lib.sanitizeAd(rawAd);
  const invites = lib.invitesIn(cleaned);
  const info = invites.length ? await inspectInvite(client, invites[0]) : null;

  // pictures: uploaded with the command, and picture links lifted out of the ad (plain ads keep their links, so Discord shows them itself)
  const lifted = style === 'plain' ? { text: cleaned, images: [], dropped: 0 } : lib.extractImages(cleaned, cfg.maxImages);
  const problems = []; const files = []; const urlImages = [];
  let n = 0;
  for (const att of attachments.slice(0, cfg.maxImages)) {
    if (att.size > cfg.maxImageBytes) { problems.push(`"${att.name}" is larger than ${cfg.maxImageBytes / 1024 / 1024} MB and was skipped.`); continue; }
    try { files.push(await downloadImage(att.url, ++n, { fetchImpl })); } catch (err) { problems.push(`The picture "${att.name}" was skipped: ${err.message}.`); }
  }
  for (const img of lifted.images) {
    if (files.length + urlImages.length >= cfg.maxImages) { problems.push(`Only ${cfg.maxImages} pictures are used. The rest were left out.`); break; }
    if (img.discord) {
      try { files.push(await downloadImage(img.url, ++n, { fetchImpl })); } catch { problems.push('A Discord picture link in the ad could not be copied (it may have expired). Send the picture with the command instead.'); }
    } else urlImages.push({ url: img.url });
  }
  if (lifted.dropped && !problems.some((p) => p.startsWith('Only'))) problems.push(`Only ${cfg.maxImages} pictures are used. The rest were left out.`);

  // the invite becomes the Join button, so the link itself is replaced in the text (unless asked to keep it, or the ad is plain text)
  const adText = lib.stripInvite(lifted.text, invites[0], { keep: keepLink || style === 'plain' });
  const words = await automodService.getWords(guild.id).catch(() => []);
  const duplicate = info?.guildId ? await service.activeForInviteGuild(guild.id, info.guildId) : null;
  const blacklisted = info?.guildId ? await service.getBlacklisted(guild.id, info.guildId) : null;
  const vetting = lib.vet({ ad: adText, invites, info, minMembers: settings.min_members, bannedWords: words, blacklisted, alreadyPartnered: Boolean(duplicate), imageProblems: problems });
  if (style === 'plain' && adText.length > cfg.plainMax) {
    vetting.findings.push({ level: 'block', text: `A plain text ad is limited to ${cfg.plainMax} characters (this one has ${adText.length}). Use the card style.` });
    vetting.blocked = true;
  }
  return {
    ad: adText, invites, info, vetting, ping: lib.parsePing({ ping, roleId }), style, keepLink, name: lib.serverName(info, typedName), repId, ticketChannelId, actorId,
    code: invites[0] ?? null, files, images: [...files.map((f) => ({ name: f.name })), ...urlImages],
  };
}

async function publish({ client, guild, settings, prepared }) {
  if (prepared.vetting.blocked) throw new ModError('This ad has a problem that must be fixed first.');
  const channel = await resolveChannel(guild, settings);
  const payload = views.adPayload({ name: prepared.name, ad: prepared.ad, code: prepared.code, members: prepared.info?.members, repId: prepared.repId, iconUrl: prepared.info?.iconUrl,
    images: prepared.images, files: prepared.files }, prepared.ping, prepared.style);
  const message = await channel.send(payload);
  const row = await service.create({
    guildId: guild.id, serverName: prepared.name, inviteCode: prepared.code, inviteGuildId: prepared.info?.guildId, memberCount: prepared.info?.members, repUserId: prepared.repId,
    postedBy: prepared.actorId, adText: prepared.ad, ping: prepared.ping.key, channelId: channel.id, messageId: message.id, ticketChannelId: prepared.ticketChannelId,
  });
  const jump = `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`;
  const notes = [];

  if (prepared.repId) {                                            // the partner's representative gets the Partner role, when there is one
    const role = settings.partner_role_id ? guild.roles.cache.get(settings.partner_role_id) : staffRoles.findRole(guild, cfg.roleName);
    const member = role && await guild.members.fetch(prepared.repId).catch(() => null);
    if (role && member && role.position < guild.members.me.roles.highest.position) await member.roles.add(role, `Partnership #${row.id}`).catch(() => notes.push('Could not give the Partner role.'));
  }
  if (prepared.ticketChannelId) {                                  // tell the partner in their ticket, and ask for our ad in return
    const ticket = await client.channels.fetch(prepared.ticketChannelId).catch(() => null);
    if (ticket?.send) await ticket.send({ ...ui.message(views.ticketNotice(row, jump, settings.our_ad)), allowedMentions: { parse: [] } }).catch(() => {});
  }
  await logger.log(guild, 'server', () => ui.notice('Partner Ad Posted', `**${row.server_name}** (${ui.fmt.code(`#${row.id}`)})`, {
    icon: 'link', fields: [['By', ui.fmt.user(prepared.actorId), 'user'], ['Jump', jump, 'link']],
  }), { actorId: prepared.actorId, detail: { partner: row.id } }).catch(() => {});
  return { row, jump, notes };
}

// ---------- ending, and the blacklist ----------
async function endPartnership({ guild, row, reason, deleteAd, settings, blacklist = false, by }) {
  const ended = await service.end(row.id, reason);
  if (!ended) throw new ModError('That partnership has already ended.');
  let removed = false; let blacklisted = false;
  if (deleteAd && row.channel_id && row.message_id) {
    const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
    removed = Boolean(channel && await channel.messages.delete(row.message_id).then(() => true, () => false));
  }
  if (row.rep_user_id && !(await service.repHasOtherActive(guild.id, row.rep_user_id, row.id))) {
    const role = settings.partner_role_id ? guild.roles.cache.get(settings.partner_role_id) : staffRoles.findRole(guild, cfg.roleName);
    const member = role && await guild.members.fetch(row.rep_user_id).catch(() => null);
    if (role && member?.roles.cache.has(role.id)) await member.roles.remove(role, `Partnership #${row.id} ended`).catch(() => {});
  }
  if (blacklist && row.invite_guild_id) {
    await service.addBlacklist({ guildId: guild.id, serverId: row.invite_guild_id, name: row.server_name, reason: reason || 'Ended and blacklisted', addedBy: by });
    blacklisted = true;
  }
  return { ended, removed, blacklisted };
}

// A server ID, an invite link or an invite code, turned into a server ID and name.
async function resolveServer(client, text) {
  const t = String(text).trim();
  if (/^\d{17,20}$/.test(t)) return { id: t, name: null };
  const code = lib.invitesIn(t)[0] ?? (/^[a-z0-9-]{2,32}$/i.test(t) ? t : null);
  if (!code) throw new ModError('Give a server ID, an invite link, or an invite code.');
  const info = await inspectInvite(client, code);
  if (!info?.guildId) throw new ModError('That invite is invalid or expired, so Tower cannot tell which server it is. Use the server ID instead.');
  return { id: info.guildId, name: info.name };
}

// ---------- reciprocity: did they post our ad too? ----------
async function tickReciprocity(client) {
  for (const row of await service.dueForReciprocityReminder(cfg.reciprocity.firstReminderDays, cfg.reciprocity.repeatDays)) {
    try {
      const card = ui.message(views.reciprocityReminder(row));
      let user = await client.users.fetch(row.posted_by).catch(() => null);
      let sent = user ? await user.send(card).then(() => true, () => false) : false;
      if (!sent) {
        const guild = client.guilds.cache.get(row.guild_id);
        user = guild ? await guild.fetchOwner().then((m) => m.user).catch(() => null) : null;
        if (user) await user.send(card).catch(() => {});
      }
      await service.markReciprocityReminded(row.id);
    } catch (err) { console.error(`[partner] reminder #${row.id}:`, err.message); }
  }
}
function startScheduler(client) {
  const run = () => tickReciprocity(client).catch((err) => console.error('[partner] scheduler:', err.message));
  setTimeout(run, 90_000).unref();
  setInterval(run, cfg.reciprocity.tickMs).unref();
}

// ---------- the form's options and previews waiting for the Post button ----------
const forms = new Map();
function holdForm(options) {
  const token = Math.random().toString(36).slice(2, 10);
  forms.set(token, options);
  setTimeout(() => forms.delete(token), 30 * 60_000).unref();
  return token;
}
const takeForm = (token) => forms.get(token) ?? null;

const pending = new Map();
function hold(prepared, userId) {
  const token = Math.random().toString(36).slice(2, 10);
  pending.set(token, { prepared, userId, at: Date.now() });
  setTimeout(() => pending.delete(token), cfg.pendingMinutes * 60_000).unref();
  return token;
}
const take = (token) => pending.get(token) ?? null;
const drop = (token) => pending.delete(token);

module.exports = {
  holdForm, takeForm, resolveChannel, inspectInvite, downloadImage, prepare, publish, endPartnership, resolveServer, tickReciprocity, startScheduler, hold, take, drop, POSTABLE,
};
