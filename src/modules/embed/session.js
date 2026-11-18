const crypto = require('node:crypto');
const embed = require('../../lib/embed');

// One open builder per person. It lives in memory and disappears after 3 hours without use, or on restart,
// so anything worth keeping should be posted or saved as a template.
const TTL_MS = 3 * 60 * 60 * 1000;
const sessions = new Map(); // id -> session

function create({ userId, guildId, draft = embed.newDraft(), mode = 'new', target = null, retained = new Set(), retainedUrls = new Map() }) {
  for (const [id, s] of sessions) if (s.userId === userId && s.guildId === guildId) sessions.delete(id); // one builder at a time
  const session = {
    id: crypto.randomBytes(4).toString('hex'), userId, guildId, draft,
    mode,                    // 'new' or 'edit' (editing a message Tower already posted)
    target,                  // { channelId, messageId, via } when editing
    retained,                // attachment names already on the message being edited
    retainedUrls,            // the same attachments' addresses, so a preview can show them
    uploads: new Map(),      // name -> { buffer, size, contentType }
    sel: draft.blocks.length ? 0 : -1,
    view: 'editor',          // 'editor' | 'post' | 'confirm'
    pickedChannelId: null, pending: null, notice: null, ui: null, preview: null,
    touched: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

function get(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.touched > TTL_MS) { sessions.delete(id); return null; }
  s.touched = Date.now();
  return s;
}
const forUser = (userId, guildId) => [...sessions.values()].find((s) => s.userId === userId && s.guildId === guildId && Date.now() - s.touched <= TTL_MS) ?? null;
const remove = (id) => sessions.delete(id);

setInterval(() => {
  for (const [id, s] of sessions) if (Date.now() - s.touched > TTL_MS) sessions.delete(id);
}, 10 * 60 * 1000).unref();

module.exports = { create, get, forUser, remove, TTL_MS };
