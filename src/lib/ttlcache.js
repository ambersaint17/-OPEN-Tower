// A tiny cache whose entries expire. Used for things that rarely change but are read on every button press.
function createTtlCache(ttlMs, now = () => Date.now()) {
  const items = new Map();
  return {
    get(key) {
      const hit = items.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) { items.delete(key); return undefined; }
      return hit.value;
    },
    set(key, value) { items.set(key, { at: now(), value }); return value; },
    delete(key) { items.delete(key); },
    clear() { items.clear(); },
  };
}
module.exports = { createTtlCache };
