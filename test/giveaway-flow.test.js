// Runs a whole giveaway with fake Discord objects and an in-memory stand-in for the database.
const test = require('node:test');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');

// ---------- in-memory database ----------
const rows = new Map(); const entries = new Map(); let nextId = 1;
const fakeService = {
  create: async (g) => { const row = { id: nextId++, guild_id: g.guildId, channel_id: g.channelId, message_id: null, host_id: g.hostId, prize: g.prize, description: g.description, winner_note: g.winnerNote,
    winners: g.winners, ends_at: new Date(g.endsAt), status: 'active', requirements: g.requirements, ping_role_id: g.pingRoleId ?? null, claim_hours: g.claimHours, winner_ids: [], winner_message_id: null, ended_at: null };
    rows.set(row.id, row); entries.set(row.id, new Set()); return { ...row }; },
  setMessage: async (id, m) => { rows.get(id).message_id = m; }, setWinnerMessage: async (id, m) => { rows.get(id).winner_message_id = m; },
  setWinners: async (id, ids) => { rows.get(id).winner_ids = [...ids]; },
  get: async (id, guildId) => { const r = rows.get(id); return r && (!guildId || r.guild_id === guildId) ? { ...r, winner_ids: [...r.winner_ids] } : null; },
  listActive: async () => [...rows.values()].filter((r) => r.status === 'active'), listRecent: async () => [...rows.values()],
  countActive: async () => [...rows.values()].filter((r) => r.status === 'active').length,
  due: async () => [...rows.values()].filter((r) => r.status === 'active' && r.ends_at.getTime() <= Date.now()).map((r) => r.id),
  claimEnd: async (id) => { const r = rows.get(id); if (!r || r.status !== 'active') return null; r.status = 'ended'; r.ended_at = new Date(); return { ...r, winner_ids: [...r.winner_ids] }; },
  cancel: async (id) => { const r = rows.get(id); if (!r || r.status !== 'active') return null; r.status = 'cancelled'; return { ...r }; },
  addEntry: async (id, u) => { const s = entries.get(id); if (s.has(u)) return false; s.add(u); return true; },
  removeEntry: async (id, u) => entries.get(id).delete(u), hasEntry: async (id, u) => entries.get(id).has(u),
  countEntries: async (id) => entries.get(id).size, entryIds: async (id) => [...entries.get(id)],
};
const servicePath = path.join(__dirname, '..', 'src/modules/giveaway/service.js');
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: fakeService };

const engine = require('../src/modules/levels/engine');
const logger = require('../src/modules/logging/logger');
const ticketActions = require('../src/modules/tickets/actions');
const actions = require('../src/modules/giveaway/actions');
const handlers = require('../src/modules/giveaway/handlers');
logger.log = async () => {};
const stats = new Map();     // userId -> { xp, level }
engine.peek = async (_g, userId) => ({ xp: 0, level: 0, ...stats.get(userId) });
ticketActions.checkCanOpen = async () => ({});

// ---------- fake Discord ----------
const col = (items = []) => Object.assign(new Map(items.map((i) => [i.id, i])), {
  find(fn) { return [...this.values()].find(fn); }, some(fn) { return [...this.values()].some(fn); }, first() { return [...this.values()][0]; },
});
const HOST = '100000000000000001'; const PING = '100000000000000009';
const sent = []; const dms = [];
function makeChannel(id, name) {
  const channel = { id, name, type: ChannelType.GuildText, permissionsFor: () => ({ has: () => true }), messages: { items: new Map(), fetch: async (m) => channel.messages.items.get(m) },
    send: async (p) => { const m = { id: `${sent.length + 5000}`, channelId: id, payload: p, edits: [], edit: async (e) => { m.edits.push(e); } }; sent.push(m); channel.messages.items.set(m.id, m); return m; } };
  return channel;
}
const arena = makeChannel('200000000000000001', 'giveaways');
const support = makeChannel('200000000000000002', 'support');
const members = new Map();
function member(id, { xp = 0, level = 0, booster = false, roles = [] } = {}) {
  stats.set(id, { xp, level });
  const m = { id, user: { id, bot: false }, premiumSince: booster ? new Date() : null, joinedTimestamp: Date.now() - 40 * 86400000, roles: { cache: col(roles.map((r) => ({ id: r, name: r }))) } };
  m.guild = guild; members.set(id, m); return m;
}
const guild = { id: 'G1', name: 'Amber Saint', members: { me: {}, fetch: async ({ user }) => col(user.map((u) => members.get(u)).filter(Boolean)) },
  channels: { cache: col([arena, support]), fetch: async (id) => [arena, support].find((c) => c.id === id) ?? null }, roles: { cache: col() } };
const client = { guilds: { cache: new Map([['G1', guild]]), fetch: async () => guild }, channels: { fetch: async (id) => [arena, support].find((c) => c.id === id) },
  users: { fetch: async (id) => ({ id, send: async (p) => { dms.push({ id, p }); } }) } };
const flat = (x) => JSON.stringify(x.components.map((c) => c.toJSON()));

function press(customId, who, extra = {}) {
  const log = [];
  const i = { customId, guildId: 'G1', guild, member: who, user: { id: who.id }, client, deferred: false, replied: false, log,
    deferReply: async () => { i.deferred = true; }, editReply: async (p) => { log.push(['editReply', p]); }, reply: async (p) => { i.replied = true; log.push(['reply', p]); },
    followUp: async (p) => { log.push(['followUp', p]); }, update: async (p) => { log.push(['update', p]); }, showModal: async (m) => { log.push(['modal', m]); }, ...extra };
  return i;
}
const answer = async (customId, who) => { const i = press(customId, who); await handlers.handle(i); return i.log.at(-1); };

test('a giveaway runs from the first post to the winners opening a claim ticket', async () => {
  const A = member('300000000000000001', { xp: 500, level: 7 });
  const B = member('300000000000000002', { xp: 50, level: 1 });
  const C = member('300000000000000003', { xp: 200, level: 2, booster: true });
  const D = member('300000000000000004', { xp: 300, level: 3 });
  member('300000000000000005', { xp: 900 });   // never enters

  // start: ping and card are posted, the message is remembered
  const row = await actions.start(guild, { id: HOST }, { channel: arena, prize: 'Discord Nitro', winners: 2, endsAt: Date.now() + 3_600_000, requirements: { minXp: 100 },
    pingRoleId: PING, claimHours: 48, winnerNote: 'Enjoy!', description: 'Monthly giveaway.' });
  const post = sent.at(-1);
  assert.equal(row.message_id, post.id);
  assert.deepEqual(post.payload.components.map((c) => c.toJSON().type), [10, 17]);
  assert.deepEqual(post.payload.allowedMentions, { parse: [], roles: [PING] });
  assert.match(flat(post.payload), /Discord Nitro/);

  // entering
  let reply = await answer(`giveaway:enter:${row.id}`, A);
  assert.match(flat(reply[1]), /You Are In/); assert.match(flat(reply[1]), /Giveaway Bonus/);
  reply = await answer(`giveaway:enter:${row.id}`, B);
  assert.match(flat(reply[1]), /Requirements Not Met/); assert.equal(await fakeService.hasEntry(row.id, B.id), false);
  await answer(`giveaway:enter:${row.id}`, C); await answer(`giveaway:enter:${row.id}`, D);
  reply = await answer(`giveaway:enter:${row.id}`, A);
  assert.match(flat(reply[1]), /Already In/);
  assert.equal(await fakeService.countEntries(row.id), 3);
  reply = await answer(`giveaway:leave:${row.id}`, D);
  assert.match(flat(reply[1]), /You Left/); assert.equal(await fakeService.hasEntry(row.id, D.id), false);
  await answer(`giveaway:enter:${row.id}`, D);
  members.delete(D.id);                                // D leaves the server before the draw

  // too early: nothing happens
  await actions.tick(client);
  assert.equal(rows.get(row.id).status, 'active');

  // the time is up
  rows.get(row.id).ends_at = new Date(Date.now() - 1000);
  const before = sent.length;
  await actions.tick(client);
  const done = rows.get(row.id);
  assert.equal(done.status, 'ended');
  assert.deepEqual([...done.winner_ids].sort(), [A.id, C.id]);          // D left, B never qualified
  assert.match(flat(post.edits.at(-1)), /Giveaway Ended/);
  assert.doesNotMatch(flat(post.edits.at(-1)), /"type":1[,}]/);     // the Enter button is gone
  const announce = sent[before];
  assert.deepEqual(announce.payload.allowedMentions, { parse: [], users: done.winner_ids });
  assert.match(flat(announce.payload), /Next steps/);
  assert.match(flat(announce.payload), /giveaway_claim|giveaway:claim:/);
  assert.match(flat(announce.payload), /channels\/G1\/200000000000000002/);    // link to the support channel
  assert.deepEqual(dms.map((d) => d.id).sort(), [A.id, C.id]);
  assert.match(flat(dms[0].p), /You won/);

  // drawing twice is impossible
  await actions.tick(client); assert.equal(sent.length, before + 1);

  // only winners can claim, and the ticket form opens filled in
  reply = await answer(`giveaway:claim:${row.id}`, B);
  assert.match(flat(reply[1]), /Only the winners/);
  const claim = press(`giveaway:claim:${row.id}`, A);
  await handlers.handle(claim);
  const modal = claim.log.at(-1)[1];
  assert.equal(claim.log.at(-1)[0], 'modal');
  assert.equal(modal.components[0].components[0].data.value, `Giveaway prize claim #${row.id}`);
  assert.match(modal.components[2].components[0].data.value, /I won "Discord Nitro" in giveaway #1/);

  // reroll: nobody left at first, then someone new qualifies
  await assert.rejects(actions.reroll(client, guild, await fakeService.get(row.id), { count: 1 }), /nobody else/);
  await fakeService.addEntry(row.id, B.id); stats.set(B.id, { xp: 400, level: 2 });
  const fresh = await actions.reroll(client, guild, await fakeService.get(row.id), { count: 1 });
  assert.deepEqual(fresh, [B.id]);
  assert.equal(rows.get(row.id).winner_ids.length, 3);
  assert.match(flat(sent.at(-1).payload), /Reroll/);
  await assert.rejects(actions.reroll(client, guild, await fakeService.get(row.id), { replace: '300000000000000099' }), /not one of the winners/);
});

test('a giveaway nobody qualifies for ends cleanly, and a running one can be cancelled', async () => {
  const lonely = await actions.start(guild, { id: HOST }, { channel: arena, prize: 'Mystery Box', winners: 1, endsAt: Date.now() + 1000, requirements: {}, claimHours: 24 });
  const postId = lonely.message_id; const before = sent.length;
  const ended = await actions.finish(client, lonely.id);
  assert.deepEqual(ended.winner_ids, []);
  assert.equal(sent.length, before);                                    // no winner message
  assert.match(flat(arena.messages.items.get(postId).edits.at(-1)), /no winner/);

  const running = await actions.start(guild, { id: HOST }, { channel: arena, prize: 'Cancelled Prize', winners: 1, endsAt: Date.now() + 5_000_000, requirements: {}, claimHours: 24 });
  await actions.cancel(client, await fakeService.get(running.id));
  assert.equal(rows.get(running.id).status, 'cancelled');
  assert.match(flat(arena.messages.items.get(running.message_id).edits.at(-1)), /Cancelled/);
  await assert.rejects(actions.cancel(client, await fakeService.get(running.id)), /not running/);

  const late = press(`giveaway:enter:${running.id}`, member('300000000000000010'));
  await handlers.handle(late);
  assert.match(flat(late.log.at(-1)[1]), /ended/);
});

test('unverified members cannot enter, and bots never win', async () => {
  const row = await actions.start(guild, { id: HOST }, { channel: arena, prize: 'Gift', winners: 1, endsAt: Date.now() + 1_000_000, requirements: {}, claimHours: 24 });
  const raw = member('300000000000000020', { roles: ['Unverified'] });
  const i = press(`giveaway:enter:${row.id}`, raw); await handlers.handle(i);
  assert.match(flat(i.log.at(-1)[1]), /Verify yourself/);
  const bot = member('300000000000000021'); bot.user.bot = true;
  await fakeService.addEntry(row.id, bot.id);
  const pool = await actions.eligiblePool(guild, await fakeService.get(row.id));
  assert.equal(pool.length, 0);
});
