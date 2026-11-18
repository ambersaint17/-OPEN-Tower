const { Events, AuditLogEvent, AttachmentBuilder } = require('discord.js');
const { messageCache } = require('../modules/logging/state');
const { snapshot } = require('../modules/logging/messageCache');
const channels = require('../modules/logging/channels');
const { isTicketChannelName } = require('../lib/channels');
const { log } = require('../modules/logging/logger');
const { findAudit } = require('../modules/logging/audit');
const views = require('../modules/logging/views');
const { fmt } = require('../ui');

module.exports = {
  name: Events.MessageBulkDelete,
  async execute(messages, channel) {
    const guild = channel.guild;
    if (!guild || channels.isLogChannel(guild, channel.id)) return;
    if (isTicketChannelName(channel.name)) return;

    const known = [];
    for (const message of messages.values()) {
      const snap = messageCache.take(message.id)
        ?? (!message.partial && message.author && !message.author.bot ? snapshot(message) : null);
      if (snap) known.push(snap);
    }
    known.sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0));

    const audit = await findAudit(guild, AuditLogEvent.MessageBulkDelete, { delay: true });

    // The transcript goes to the log channel as a file. It is never written to the database.
    const text = known
      .map((m) => {
        const when = m.createdTimestamp ? new Date(m.createdTimestamp).toISOString() : 'unknown time';
        const extra = m.attachments.length ? ` [attachments: ${m.attachments.map((a) => a.name).join(', ')}]` : '';
        return `[${when}] ${m.authorTag} (${m.authorId}): ${m.content || '(no text)'}${extra}`;
      })
      .join('\n');
    const files = known.length
      ? [new AttachmentBuilder(Buffer.from(text, 'utf8').subarray(0, 7_000_000), { name: 'transcript.txt' })]
      : [];

    await log(guild, 'bulkDelete', (id) => views.entry({
      id,
      icon: 'trash',
      title: 'Bulk Delete',
      description: known.length
        ? 'The recovered messages are in the attached transcript.'
        : '*None of these messages were in Tower\'s memory, so no transcript is available.*',
      file: files.length ? 'transcript.txt' : undefined,
      fields: [
        ['Channel', fmt.channel(channel.id), 'chat'],
        ['Messages Deleted', fmt.code(messages.size), 'trash'],
        ['Recovered', fmt.code(known.length), 'check'],
        ['Deleted By', audit?.executor ? views.tag(audit.executor) : 'Unknown', 'staff'],
      ],
    }), { files, actorId: audit?.executor?.id, detail: { channelId: channel.id, deleted: messages.size, recovered: known.length } });
  },
};
