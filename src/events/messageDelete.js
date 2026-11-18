const { Events, AuditLogEvent } = require('discord.js');
const { messageCache } = require('../modules/logging/state');
const { snapshot } = require('../modules/logging/messageCache');
const channels = require('../modules/logging/channels');
const { isTicketChannelName } = require('../lib/channels');
const { log } = require('../modules/logging/logger');
const { findAudit } = require('../modules/logging/audit');
const { fetchImages } = require('../modules/logging/media');
const views = require('../modules/logging/views');
const { fmt } = require('../ui');
const { quote } = require('../lib/text');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    const guild = message.guild;
    if (!guild || channels.isLogChannel(guild, message.channelId)) return;
    if (isTicketChannelName(message.channel?.name)) return;

    // The memory cache is the source of truth. A message Tower never saw has no text to show.
    const snap = messageCache.take(message.id)
      ?? (!message.partial && message.author && !message.author.bot ? snapshot(message) : null);

    // Someone else deleted it (a moderator): the audit log names who.
    const audit = await findAudit(guild, AuditLogEvent.MessageDelete, {
      targetId: snap?.authorId, channelId: message.channelId,
    });

    // Unknown message and no moderator involved: nothing useful to report.
    if (!snap && !audit) return;

    const author = snap
      ? { id: snap.authorId, tag: snap.authorTag, avatar: snap.avatarUrl }
      : { id: audit.target?.id, tag: audit.target?.tag ?? audit.target?.username, avatar: audit.target?.displayAvatarURL?.({ extension: 'png', size: 256 }) };
    const attachments = snap?.attachments ?? [];

    await log(guild, 'messageDelete', (id) => views.entry({
      id,
      icon: 'trash',
      title: 'Message Deleted',
      thumbnail: author.avatar ?? undefined,
      description: snap
        ? (snap.content ? quote(snap.content, 1500) : '*No text content*')
        : '*Content unavailable. The message was sent before Tower\'s memory of it began.*',
      fields: [
        ['Author', author.id ? `${fmt.user(author.id)} (${author.tag ?? 'unknown'})` : fmt.code('unknown'), 'user'],
        ['Author ID', fmt.code(author.id ?? 'unknown'), 'hash'],
        ['Channel', fmt.channel(message.channelId), 'chat'],
        ['Sent', snap?.createdTimestamp ? fmt.time(snap.createdTimestamp, 'R') : fmt.code('unknown'), 'calendar'],
        ['Deleted By', audit?.executor ? views.tag(audit.executor) : 'The author, or unknown', 'staff'],
        ...(attachments.length ? [['Attachments', fmt.code(attachments.map((a) => a.name).slice(0, 4).join(', ')), 'image']] : []),
        ['Message ID', fmt.code(message.id), 'hash'],
      ],
    }), { actorId: audit?.executor?.id ?? author.id, targetId: author.id, detail: { channelId: message.channelId, messageId: message.id, attachments: attachments.length } });

    // Keep a copy of deleted images in the media log.
    if (attachments.length) {
      const { files, names } = await fetchImages(attachments);
      if (files.length) {
        await log(guild, 'media', (id) => views.entry({
          id,
          icon: 'image',
          title: 'Deleted Media',
          thumbnail: author.avatar ?? undefined,
          images: names,
          fields: [
            ['Author', author.id ? fmt.user(author.id) : fmt.code('unknown'), 'user'],
            ['Channel', fmt.channel(message.channelId), 'chat'],
            ['Files Recovered', fmt.code(files.length), 'check'],
          ],
        }), { files, actorId: author.id, targetId: author.id, detail: { channelId: message.channelId, files: files.length } });
      }
    }
  },
};
