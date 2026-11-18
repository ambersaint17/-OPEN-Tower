// Remembers which channels are open tickets, so Tower can notice replies without a database query
// for every message in the server.
const open = new Map();   // channelId -> { id, guildId, openerId, minLevel, pendingClose }
const lastWrite = new Map(); // `${ticketId}:${kind}` -> timestamp, so busy tickets do not hammer the database

const add = (ticket, minLevel) => open.set(ticket.channel_id, {
  id: ticket.id, guildId: ticket.guild_id, openerId: ticket.opener_id, minLevel, pendingClose: Boolean(ticket.auto_close_at),
});
const remove = (channelId) => open.delete(channelId);
const get = (channelId) => open.get(channelId) ?? null;
const clear = () => { open.clear(); lastWrite.clear(); };

// True at most once per window for each ticket and kind of event.
function throttled(ticketId, kind, windowMs = 30_000, now = Date.now()) {
  const key = `${ticketId}:${kind}`;
  const last = lastWrite.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  lastWrite.set(key, now);
  return true;
}

module.exports = { add, remove, get, clear, throttled, _size: () => open.size };
