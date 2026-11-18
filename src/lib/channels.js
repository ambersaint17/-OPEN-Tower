// Channel names carry emoji and dividers (for example "📜｜rules"), so match on the
// trailing word. A hyphen before it means a different channel ("staff-announcements").
function matchesChannelName(channelName, wanted) {
  return new RegExp(`(^|[^a-z0-9-])${wanted}$`, 'i').test(channelName);
}

// Returns a clickable <#id> mention, or a plain fallback when the channel is not found.
function findChannelMention(guild, wanted) {
  const channel = guild.channels.cache.find((c) => matchesChannelName(c.name, wanted));
  return channel ? `<#${channel.id}>` : `**#${wanted}**`;
}

// Ticket channels are private. Nothing inside them is cached, logged or copied into staff log channels.
const isTicketChannelName = (name) => /^ticket-\d+-/.test(String(name ?? ''));

module.exports = { matchesChannelName, findChannelMention, isTicketChannelName };
