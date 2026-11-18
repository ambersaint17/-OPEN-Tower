const { ChannelType, PermissionFlagsBits, AttachmentBuilder, OverwriteType } = require('discord.js');
const ui = require('../../ui');
const { tickets, moderation } = require('../../constants');
const { clip } = require('../../lib/text');
const { formatSeconds } = require('../../lib/time');
const { levelFor, normalize } = require('../moderation/permissions');
const { ModError } = require('../moderation/actions');
const verification = require('../verification/service');
const service = require('./service');
const views = require('./views');
const tracker = require('./tracker');
const { formFor, validateForm } = require('./forms');
const { renderTranscript, componentsText } = require('./transcript');

const fail = (message) => { throw new ModError(message); };
const typeConfig = (key) => tickets.types[key];

const TICKET_PERMS = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions,
];

// ---------- who can do what ----------

const levelOf = (guild, member) => levelFor([...member.roles.cache.values()].map((r) => r.name), {
  isOwner: guild.ownerId === member.id,
  isAdmin: member.permissions.has(PermissionFlagsBits.Administrator),
});

const canHandle = (guild, member, ticket) => levelOf(guild, member) >= typeConfig(ticket.type).minLevel;

function rolesAtOrAbove(guild, minLevel) {
  const wanted = moderation.ranks.filter((r) => r.level >= minLevel).map((r) => normalize(r.role));
  return [...guild.roles.cache.values()].filter((r) => wanted.includes(normalize(r.name)));
}

// Who gets pinged in the staff channel for this ticket type.
function pingTargets(guild, cfg) {
  if (cfg.pingOwner) return { text: `<@${guild.ownerId}>`, roles: [], users: [guild.ownerId] };
  const role = cfg.pingRole && guild.roles.cache.find((r) => normalize(r.name) === normalize(cfg.pingRole));
  return role ? { text: `<@&${role.id}>`, roles: [role.id], users: [] } : { text: '', roles: [], users: [] };
}

// Pure: who may see the new channel. Owner-only tickets get no staff roles at all.
function buildOverwrites({ everyoneId, openerId, ownerId, botId, staffRoleIds }) {
  const allow = (id) => ({ id, allow: TICKET_PERMS });
  const out = [{ id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] }, allow(openerId), allow(botId), allow(ownerId)];
  for (const id of staffRoleIds) out.push(allow(id));
  return out;
}

const ticketChannelName = (number, username) => {
  const slug = String(username).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'member';
  return `ticket-${String(number).padStart(4, '0')}-${slug}`;
};

// Pure: where a closed ticket's transcript goes.
//   general tickets (support, reports)               -> ticket-logs
//   services, partnerships, applications             -> the admin ticket log channel
// If that channel is not set, the transcript is DMed to whoever closed the ticket instead.
function logDestination(settings, cfg) {
  const general = cfg.minLevel <= 2;
  const channelId = (general ? settings?.logs_channel_id : settings?.admin_logs_channel_id) ?? null;
  return { channelId, dmFallback: !general && !channelId };
}

// ---------- sending ----------

async function sendTo(guild, channelId, payload) {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel.send({ allowedMentions: { parse: [] }, ...payload }).catch((err) => {
    console.error('[tickets] could not post:', err.message);
    return null;
  });
}

async function requireSettings(guildId) {
  const settings = await service.getSettings(guildId);
  if (!settings) fail('Tickets have not been set up yet. An administrator needs to run `/ticket setup`.');
  return settings;
}

// ---------- opening ----------

async function checkCanOpen(guild, member, typeKey) {
  const settings = await requireSettings(guild.id);
  if (!typeConfig(typeKey)) fail('That ticket type does not exist.');

  const block = await service.getBlock(guild.id, member.id);
  if (block) fail(`You are blocked from opening tickets. Reason: ${clip(block.reason, 200)}`);

  const gate = await verification.getSettings(guild.id);
  if (gate?.verification_enabled && !member.roles.cache.has(gate.verified_role_id)) {
    fail('Please verify first. If you are locked out, contact staff through modmail.');
  }

  if ((await service.countOpen(guild.id, member.id)) >= tickets.maxOpenPerMember) {
    fail(`You already have ${tickets.maxOpenPerMember} open tickets. Please wait for one to be closed first.`);
  }
  const last = await service.lastClosedAt(guild.id, member.id);
  if (last && Date.now() - new Date(last).getTime() < tickets.cooldownMs) {
    const until = Math.floor((new Date(last).getTime() + tickets.cooldownMs) / 1000);
    fail(`Please wait a little before opening another ticket. You can open one <t:${until}:R>.`);
  }
  return settings;
}

async function openTicket(interaction, typeKey, values) {
  const { guild } = interaction;
  const member = interaction.member;
  const settings = await checkCanOpen(guild, member, typeKey);
  const error = validateForm(typeKey, values);
  if (error) fail(error);

  const cfg = typeConfig(typeKey);
  const category = await guild.channels.fetch(settings.category_id).catch(() => null);
  if (!category) fail('The ticket category no longer exists. Please tell an administrator to run `/ticket setup` again.');
  const categoryFull = category.children.cache.size >= tickets.categoryLimit;

  const number = await service.nextNumber(guild.id);
  const staffRoleIds = cfg.minLevel >= 5 ? [] : rolesAtOrAbove(guild, cfg.minLevel).map((r) => r.id);
  const channel = await guild.channels.create({
    name: ticketChannelName(number, member.user.username),
    type: ChannelType.GuildText,
    parent: categoryFull ? null : category.id,
    topic: `Ticket ${String(number).padStart(4, '0')} | ${cfg.label} | opened by ${member.user.tag} (${member.id})`,
    permissionOverwrites: buildOverwrites({
      everyoneId: guild.id, openerId: member.id, ownerId: guild.ownerId, botId: guild.members.me.id, staffRoleIds,
    }),
    reason: `Ticket ${number} opened by ${member.user.tag}`,
  });

  const form = Object.fromEntries(formFor(typeKey).map((f) => [f.id, String(values[f.id] ?? '').trim()]));
  let ticket = await service.createTicket({
    guildId: guild.id, number, type: typeKey, channelId: channel.id, openerId: member.id,
    openerTag: member.user.tag, subject: form.subject, form,
  });
  tracker.add(ticket, cfg.minLevel);

  const opening = await channel.send({
    ...ui.message(views.openingCard({ ticket, opener: member })), allowedMentions: { users: [member.id] },
  });
  await opening.pin().catch(() => {});

  // Tell staff. Higher-level tickets keep their details out of the shared staff channel.
  const ping = pingTargets(guild, cfg);
  const showDetails = cfg.minLevel <= 2;
  const handlingTicket = showDetails ? ticket : { ...ticket, form: { subject: '', username: 'private', details: 'Open the ticket to read the details.' } };
  const handling = await sendTo(guild, settings.handling_channel_id, {
    ...ui.message(views.handlingCard({ ticket: handlingTicket, guildId: guild.id, mention: ping.text, opener: member })),
    allowedMentions: { roles: ping.roles, users: ping.users },
  });
  if (cfg.pingOwner) {
    const owner = await guild.members.fetch(guild.ownerId).catch(() => null);
    await owner?.send(ui.message(views.handlingCard({ ticket, guildId: guild.id, mention: '', opener: member }))).catch(() => {});
  }
  if (categoryFull) {
    await sendTo(guild, settings.handling_channel_id, ui.message(ui.notice('Ticket Category Full',
      'The ticket category has reached Discord\'s 50 channel limit, so the latest ticket was created outside it. Please clear out old channels.', { icon: 'warning' })));
  }
  await service.setMessages(ticket.id, { openingId: opening.id, handlingId: handling?.id });
  ticket = { ...ticket, opening_message_id: opening.id, handling_message_id: handling?.id ?? null };
  // The AI assistant helps first in the ticket types the owner switched it on for. Never allowed to break opening a ticket.
  require('../ai/tickets').onOpen({ guild, ticket, channel, member }).catch((err) => console.error('[ai] ticket:', err.message));
  return { ticket, channel };
}

// ---------- claim, close, reopen, delete ----------

async function refreshCards(guild, ticket) {
  const settings = await service.getSettings(guild.id);
  const opener = await guild.members.fetch(ticket.opener_id).catch(() => null);
  const cfg = typeConfig(ticket.type);
  const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (channel && ticket.opening_message_id) {
    const message = await channel.messages.fetch(ticket.opening_message_id).catch(() => null);
    await message?.edit({ ...ui.edit(views.openingCard({ ticket, opener })), allowedMentions: { parse: [] } }).catch(() => {});
  }
  if (settings?.handling_channel_id && ticket.handling_message_id) {
    const handlingChannel = await guild.channels.fetch(settings.handling_channel_id).catch(() => null);
    const message = await handlingChannel?.messages?.fetch(ticket.handling_message_id).catch(() => null);
    const shown = cfg.minLevel <= 2 ? ticket : { ...ticket, form: { subject: '', username: 'private', details: 'Open the ticket to read the details.' } };
    await message?.edit({ ...ui.edit(views.handlingCard({ ticket: shown, guildId: guild.id, mention: '', opener })), allowedMentions: { parse: [] } }).catch(() => {});
  }
}

async function claim(guild, member, ticket) {
  if (!canHandle(guild, member, ticket)) fail('Only staff who handle this kind of ticket can claim it.');
  if (ticket.claimed_by) fail(`This ticket is already claimed by <@${ticket.claimed_by}>.`);
  const row = await service.claim(ticket.id, member.id);
  if (!row) fail('Someone claimed it a moment ago.');
  await refreshCards(guild, row);
  return row;
}

// Reads the channel, oldest first. The result is used for the transcript and then discarded.
async function collectMessages(channel) {
  const all = [];
  let before;
  while (all.length < tickets.transcriptMaxMessages) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch || batch.size === 0) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  const truncated = all.length >= tickets.transcriptMaxMessages;
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return {
    truncated,
    messages: all.map((m) => ({
      authorTag: m.author?.tag ?? m.author?.username ?? 'Unknown', bot: Boolean(m.author?.bot),
      avatarUrl: m.author?.displayAvatarURL?.({ extension: 'png', size: 64 }),
      content: m.content, createdTimestamp: m.createdTimestamp, editedTimestamp: m.editedTimestamp,
      attachments: [...m.attachments.values()].map((a) => ({ name: a.name, url: a.url, contentType: a.contentType })),
      cardText: componentsText(m.components),
    })),
  };
}

// Renders the transcript, dropping the oldest messages if the file would be too large to upload.
function fitTranscript(args) {
  let { messages } = args;
  let truncated = args.truncated;
  let html = renderTranscript({ ...args, messages, truncated });
  while (Buffer.byteLength(html) > tickets.transcriptMaxBytes && messages.length > 10) {
    messages = messages.slice(Math.ceil(messages.length / 4));
    truncated = true;
    html = renderTranscript({ ...args, messages, truncated });
  }
  return { html, count: messages.length };
}

// When a ticket closes the member leaves it entirely: their access, and anyone staff added by hand,
// is removed. Staff roles, the owner and Tower keep theirs, and reopening gives the opener access back.
async function removeMembers(channel, guild) {
  const keep = new Set([guild.members.me.id, guild.ownerId]);
  for (const overwrite of [...channel.permissionOverwrites.cache.values()]) {
    if (overwrite.type !== OverwriteType.Member || keep.has(overwrite.id)) continue;
    await channel.permissionOverwrites.delete(overwrite.id, 'Ticket closed').catch(() => {});
  }
}

const TICKET_PERM_NAMES = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'AddReactions'];

// Sends the member their closing notice and the review request. Every failure is logged with its
// error code, so "it did not arrive" can always be explained. Falls back to plain text if the card
// format is refused.
async function notifyOpener(guild, row, { fileName, makeFile, hasFile }) {
  const user = await guild.client.users.fetch(row.opener_id).catch(() => null);
  if (!user) return { delivered: false, reason: 'unknown-user' };

  try {
    await user.send(ui.message(views.dmClosed({ ticket: row, guildName: guild.name, fileName: hasFile ? fileName : undefined }),
      { files: hasFile ? [makeFile()] : undefined }));
  } catch (err) {
    if (err.code === 50007) return { delivered: false, reason: 'dms-closed' };
    console.error(`[tickets] closing DM failed (${err.code ?? 'no code'}): ${err.message}. Trying plain text.`);
    try {
      await user.send({ content: views.dmClosedPlain({ ticket: row, guildName: guild.name }), files: hasFile ? [makeFile()] : [] });
    } catch (err2) {
      console.error(`[tickets] plain-text closing DM failed (${err2.code ?? 'no code'}): ${err2.message}`);
      return { delivered: false, reason: err2.code === 50007 ? 'dms-closed' : 'error' };
    }
  }

  try {
    await user.send(ui.message(views.dmReview({ ticket: row })));
  } catch (err) {
    console.error(`[tickets] review DM failed (${err.code ?? 'no code'}): ${err.message}. Trying plain text.`);
    await user.send(views.dmReviewPlain({ ticket: row })).catch((err2) => console.error(`[tickets] plain-text review DM failed: ${err2.message}`));
  }
  return { delivered: true };
}

// Short, honest sentence for staff about what happened with the member's DM.
function dmNote(result) {
  if (result.delivered) return 'The member received a copy and a review request.';
  if (result.reason === 'dms-closed') return 'The member has DMs closed, so they received nothing.';
  return 'Tower could not DM the member. The reason is in the console.';
}

async function closeTicket(guild, ticket, { by, reason }) {
  const row = await service.markClosed(ticket.id, { by, reason: clip(reason || 'No reason given', 300) });
  if (!row) fail('That ticket is already closed.');
  tracker.remove(row.channel_id);

  const cfg = typeConfig(row.type);
  const settings = await service.getSettings(guild.id);
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  if (channel) {
    await removeMembers(channel, guild);
  }

  // Transcript, straight from the live channel. Nothing is written to the database.
  let buffer = null;
  let count = 0;
  const fileName = `ticket-${String(row.ticket_number).padStart(4, '0')}-transcript.html`;
  if (channel) {
    const { messages, truncated } = await collectMessages(channel);
    const closer = await guild.members.fetch(by).catch(() => null);
    const claimer = row.claimed_by ? await guild.members.fetch(row.claimed_by).catch(() => null) : null;
    const { html, count: kept } = fitTranscript({
      ticket: {
        number: row.ticket_number, typeLabel: cfg.label, openerTag: row.opener_tag,
        claimedTag: claimer?.user.tag, closedTag: closer?.user.tag ?? 'Tower (automatic)',
        reason: row.close_reason, openedAt: new Date(row.created_at).getTime(), closedAt: new Date(row.closed_at).getTime(),
      },
      guildName: guild.name, messages, truncated,
    });
    buffer = Buffer.from(html, 'utf8');
    count = kept;
  }
  const makeFile = () => new AttachmentBuilder(buffer, { name: fileName });
  const destination = logDestination(settings, cfg);

  const openedFor = formatSeconds((new Date(row.closed_at) - new Date(row.created_at)) / 1000);
  const firstResponse = row.first_response_at ? formatSeconds((new Date(row.first_response_at) - new Date(row.created_at)) / 1000) : 'none';
  if (destination.channelId) {
    await sendTo(guild, destination.channelId, ui.message(
      views.logCard({ ticket: row, messages: count, fileName: buffer ? fileName : undefined, firstResponse, openedFor }),
      { files: buffer ? [makeFile()] : undefined },
    ));
  }

  // No admin log channel set yet: the transcript goes privately to whoever closed the ticket.
  if (buffer && destination.dmFallback) {
    const recipient = await guild.members.fetch(by === guild.client.user.id ? guild.ownerId : by).catch(() => null);
    await recipient?.send(ui.message(ui.notice(`Transcript for Ticket #${String(row.ticket_number).padStart(4, '0')}`,
      'No admin ticket log channel is set, so here is your copy. Set one with `/ticket channels`.', { icon: 'folder' }), { files: [makeFile()] })).catch(() => {});
  }

  // The opener gets their own copy and the review request right now, not when the channel is deleted.
  const dm = await notifyOpener(guild, row, { fileName, makeFile, hasFile: Boolean(buffer) });

  const deleteAt = tickets.closedKeepMs > 0 ? new Date(row.delete_at) : null;
  if (channel) {
    if (deleteAt) await channel.send({ ...ui.message(views.closedCard({ ticket: row, deleteAt })), allowedMentions: { parse: [] } }).catch(() => {});
    else { await service.markDeleted(row.id); await channel.delete('Ticket closed').catch(() => {}); }
  }
  await refreshCards(guild, row).catch(() => {});
  return { row, dmDelivered: dm.delivered, dmReason: dm.reason, dm };
}

async function reopen(guild, member, ticket) {
  if (!canHandle(guild, member, ticket)) fail('Only staff who handle this kind of ticket can reopen it.');
  const row = await service.reopen(ticket.id);
  if (!row) fail('That ticket is not closed, or it was already reopened.');
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  await channel?.permissionOverwrites.edit(row.opener_id, Object.fromEntries(TICKET_PERM_NAMES.map((p) => [p, true]))).catch(() => {});
  tracker.add(row, typeConfig(row.type).minLevel);
  return row;
}

async function deleteNow(guild, member, ticket) {
  if (!canHandle(guild, member, ticket)) fail('Only staff who handle this kind of ticket can delete it.');
  await service.markDeleted(ticket.id);
  tracker.remove(ticket.channel_id);
  const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  await channel?.delete(`Deleted by ${member.user.tag}`).catch(() => {});
}

// A staff member deleted the channel by hand: keep the records tidy.
async function onChannelDeleted(channel) {
  tracker.remove(channel.id);
  const row = await service.byChannel(channel.id);
  if (row && row.status !== 'deleted') await service.markDeleted(row.id);
}

// ---------- staff tools inside a ticket ----------

async function ticketHere(interaction) {
  const ticket = await service.byChannel(interaction.channelId);
  if (!ticket || ticket.status === 'deleted') fail('Run this inside a ticket channel.');
  if (!canHandle(interaction.guild, interaction.member, ticket)) fail('Only staff who handle this kind of ticket can do that.');
  return ticket;
}

async function addUser(interaction, ticket, user) {
  if (user.bot) fail('You cannot add a bot.');
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) fail('That user is not in this server.');
  await interaction.channel.permissionOverwrites.edit(user.id, Object.fromEntries(
    ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks'].map((p) => [p, true])));
  await interaction.channel.send({
    ...ui.message(ui.notice('Member Added', `${ui.fmt.user(user.id)} was added to this ticket by ${ui.fmt.user(interaction.user.id)}.`, { icon: 'plus' })),
    allowedMentions: { users: [user.id] },
  });
}

async function removeUser(interaction, ticket, user) {
  if (user.id === ticket.opener_id) fail('You cannot remove the person who opened the ticket.');
  if (user.id === interaction.guild.members.me.id) fail('You cannot remove Tower.');
  await interaction.channel.permissionOverwrites.delete(user.id);
  await interaction.channel.send({
    ...ui.message(ui.notice('Member Removed', `${ui.fmt.user(user.id)} was removed from this ticket by ${ui.fmt.user(interaction.user.id)}.`, { icon: 'minus' })),
    allowedMentions: { parse: [] },
  });
}

async function markInactive(interaction, ticket, ms) {
  const closeAt = new Date(Date.now() + ms);
  await service.setInactive(ticket.id, closeAt, interaction.user.id);
  const entry = tracker.get(ticket.channel_id);
  if (entry) entry.pendingClose = true;
  await interaction.channel.send({
    ...ui.message(views.inactiveNotice({ openerId: ticket.opener_id, closeAt })), allowedMentions: { users: [ticket.opener_id] },
  });
  return closeAt;
}

// ---------- reviews ----------

async function guildFor(client, id) {
  return client.guilds.cache.get(id) ?? client.guilds.fetch(id).catch(() => null);
}

async function postReview(guild, ticket, rating, comments = {}) {
  const settings = await service.getSettings(guild.id);
  const staffId = ticket.claimed_by ?? ticket.first_response_by;
  const container = views.reviewCard({ ticket, rating, staffId, ...comments });
  const existing = await service.getReview(ticket.id);
  if (existing?.review_message_id && settings?.reviews_channel_id) {
    const channel = await guild.channels.fetch(settings.reviews_channel_id).catch(() => null);
    const message = await channel?.messages?.fetch(existing.review_message_id).catch(() => null);
    if (message) return message.edit({ ...ui.edit(container), allowedMentions: { parse: [] } });
  }
  const sent = await sendTo(guild, settings?.reviews_channel_id, ui.message(container));
  if (sent) await service.setReviewMessage(ticket.id, sent.id);
  return sent;
}

module.exports = {
  ModError, logDestination, dmNote, levelOf, canHandle, rolesAtOrAbove, pingTargets, buildOverwrites, ticketChannelName, sendTo, requireSettings,
  checkCanOpen, openTicket, refreshCards, claim, closeTicket, reopen, deleteNow, onChannelDeleted,
  ticketHere, addUser, removeUser, markInactive, guildFor, postReview, collectMessages, fitTranscript,
};
