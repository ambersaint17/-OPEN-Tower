// One full member list at a time, shared. Several startup tasks (levels clean-up, booster colours,
// verification sweep, dividers) all want every member of a server. Asking Discord once and reusing the
// answer for a couple of minutes saves a lot of waiting, memory churn and rate-limit trouble on small hosts.
const TTL_MS = 2 * 60 * 1000;
const inflight = new Map();   // guild id -> Promise
const fetchedAt = new Map();  // guild id -> ms

async function fetchAll(guild, { fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && inflight.has(guild.id)) return inflight.get(guild.id);
  if (!fresh && fetchedAt.has(guild.id) && now - fetchedAt.get(guild.id) < TTL_MS && guild.members.cache.size >= (guild.memberCount ?? 0) * 0.9) {
    return guild.members.cache;
  }
  const job = Promise.resolve(guild.members.fetch())
    .then((members) => { fetchedAt.set(guild.id, Date.now()); return members; })
    .finally(() => inflight.delete(guild.id));
  inflight.set(guild.id, job);
  return job;
}

module.exports = { fetchAll, _clear: () => { inflight.clear(); fetchedAt.clear(); } };
