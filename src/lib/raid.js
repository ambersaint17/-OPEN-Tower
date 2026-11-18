// Sliding-window join counter. Memory only: a restart just resets the window.
class RaidDetector {
  constructor({ threshold, windowMs }) {
    this.threshold = threshold;
    this.windowMs = windowMs;
    this.joins = new Map();
  }

  // Records a join and returns how many joins happened inside the window.
  record(guildId, now = Date.now()) {
    const list = this.joins.get(guildId) ?? [];
    list.push(now);
    const cutoff = now - this.windowMs;
    while (list.length && list[0] < cutoff) list.shift();
    this.joins.set(guildId, list);
    return list.length;
  }

  isRaid(count) {
    return count >= this.threshold;
  }

  reset(guildId) {
    this.joins.delete(guildId);
  }
}

module.exports = { RaidDetector };
