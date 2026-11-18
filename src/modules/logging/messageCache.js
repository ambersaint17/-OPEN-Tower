// A bounded, expiring, memory-only store of recent messages.
// This is the whole trick behind "what did the deleted message say" without
// putting server chat into the database: if Tower saw it recently, it can show
// it. After the TTL, a restart, or the size cap, it is simply gone.
class MessageCache {
  constructor({ max, ttlMs, clock = Date.now }) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.map = new Map();
  }

  get size() {
    return this.map.size;
  }

  set(entry) {
    this.map.delete(entry.id); // re-insert so the newest entries sit at the end
    this.map.set(entry.id, { ...entry, cachedAt: this.clock() });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  get(id) {
    const entry = this.map.get(id);
    if (!entry) return null;
    if (this.clock() - entry.cachedAt > this.ttlMs) {
      this.map.delete(id);
      return null;
    }
    return entry;
  }

  // Returns the entry and removes it. Used when a message is deleted.
  take(id) {
    const entry = this.get(id);
    if (entry) this.map.delete(id);
    return entry;
  }

  prune() {
    let removed = 0;
    const now = this.clock();
    for (const [id, entry] of this.map) {
      if (now - entry.cachedAt > this.ttlMs) {
        this.map.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

// Reduces a discord.js Message to plain data, so no live objects stay in memory.
function snapshot(message) {
  const author = message.author ?? {};
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: author.id ?? null,
    authorTag: author.tag ?? author.username ?? 'Unknown',
    avatarUrl: author.displayAvatarURL ? author.displayAvatarURL({ extension: 'png', size: 128 }) : null,
    content: message.content ?? '',
    attachments: [...(message.attachments?.values?.() ?? [])].map((a) => ({
      name: a.name, url: a.url, contentType: a.contentType ?? null, size: a.size ?? 0,
    })),
    stickers: [...(message.stickers?.values?.() ?? [])].map((s) => s.name),
    createdTimestamp: message.createdTimestamp ?? null,
  };
}

module.exports = { MessageCache, snapshot };
