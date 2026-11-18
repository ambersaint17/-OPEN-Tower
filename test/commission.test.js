const test = require('node:test');
const path = require('node:path');
const assert = require('node:assert/strict');
const c = require('../src/lib/commission');

// ---------- pure logic ----------
test('deadlines are read as durations, dates, or none', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  assert.equal(c.parseWhen('5d', now).getTime(), now + 5 * 86_400_000);
  assert.equal(c.parseWhen('36h', now).getTime(), now + 36 * 3_600_000);
  assert.equal(c.parseWhen('2026-12-24').toISOString(), '2026-12-24T23:59:00.000Z');
  assert.equal(c.parseWhen('2026-12-24 18:30').toISOString(), '2026-12-24T18:30:00.000Z');
  assert.equal(c.parseWhen('none'), null);
  for (const bad of ['', 'soon', '2026-02-31', '2026-13-01', '24/12/2026', null]) assert.equal(c.parseWhen(bad), undefined, String(bad));
});

test('ratings are read from numbers, fractions and stars', () => {
  assert.equal(c.parseRating('4'), 4); assert.equal(c.parseRating(' 5/5 '), 5); assert.equal(c.parseRating('3 stars'), 3);
  assert.equal(c.parseRating('★★★★'), 4); assert.equal(c.parseRating('1 star'), 1);
  for (const bad of ['0', '6', '10', 'great', '', '★★★★★★', '4.5']) assert.equal(c.parseRating(bad), null, bad);
  assert.equal(c.stars(4), '★★★★☆'); assert.equal(c.stars(1), '★☆☆☆☆'); assert.equal(c.stars(5), '★★★★★');
});

test('statuses, closing and friendly time text', () => {
  assert.equal(c.statusInfo('in_progress').label, 'In Progress');
  assert.equal(c.statusInfo('mystery').label, 'mystery');
  assert.ok(c.isClosed('completed') && c.isClosed('cancelled') && !c.isClosed('delivered') && !c.isClosed('on_hold'));
  const now = 1_000_000_000_000;
  assert.equal(c.relativeText(now + 2 * 86_400_000, now), 'in 2 days');
  assert.equal(c.relativeText(now + 86_400_000, now), 'in 1 day');
  assert.equal(c.relativeText(now - 5 * 3_600_000, now), 'overdue by 5 hours');
  assert.equal(c.relativeText(now + 10 * 60_000, now), 'in 10 minutes');
  assert.deepEqual(c.pushLog([1, 2, 3], 4, 3), [2, 3, 4]);
  assert.deepEqual(c.pushLog(null, 1, 3), [1]);
});

// ---------- the whole flow, with fakes ----------
const rows = new Map(); const reviews = new Map(); let nextId = 1;
const fakeService = {
  create: async (x) => { const row = { id: nextId++, guild_id: x.guildId, client_id: x.clientId, title: x.title, description: x.description, price: x.price, status: x.status, deadline: x.deadline ?? null,
    paid: false, paid_at: null, ticket_channel_id: x.ticketChannelId ?? null, created_by: x.createdBy, closed_at: null, last_reminded_at: null, review_requested_at: null, notes: [], history: [] }; rows.set(row.id, row); return { ...row }; },
  get: async (id) => (rows.has(id) ? { ...rows.get(id) } : null), countOpen: async () => [...rows.values()].filter((r) => !r.closed_at).length,
  setStatus: async (id, status, by, note) => { const r = rows.get(id); r.status = status; r.history.push({ at: new Date().toISOString(), by, status, note }); r.closed_at = c.isClosed(status) ? new Date() : null; return { ...r }; },
  markReviewRequested: async (id) => { rows.get(id).review_requested_at = new Date(); },
  getReview: async (id) => reviews.get(id) ?? null,
  saveReview: async (r) => { if (reviews.has(r.commissionId)) return null; const row = { id: nextId++, commission_id: r.commissionId, guild_id: r.guildId, client_id: r.clientId, order_text: r.orderText, rating: r.rating, went_well: r.wentWell, improve: r.improve, created_at: new Date() }; reviews.set(r.commissionId, row); return row; },
  setReviewMessage: async () => {},
  dueForReminder: async () => [...rows.values()].filter((r) => !r.closed_at && r.deadline && new Date(r.deadline).getTime() <= Date.now() + 48 * 3_600_000 && !r.last_reminded_at),
  markReminded: async (id) => { rows.get(id).last_reminded_at = new Date(); },
};
const servicePath = path.join(__dirname, '..', 'src/modules/commission/service.js');
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: fakeService };
const logger = require('../src/modules/logging/logger'); logger.log = async () => {};
const { commissions: cfg } = require('../src/constants');
const actions = require('../src/modules/commission/actions');
const handlers = require('../src/modules/commission/handlers');
const views = require('../src/modules/commission/views');

const flat = (p) => JSON.stringify((p.components ?? [p]).map((x) => (x.toJSON ? x.toJSON() : x)));
const CLIENT = '400000000000000001'; const STAFF = '400000000000000002';
const sent = { ticket: [], dm: [], review: [] }; let dmOpen = true;
const channels = new Map([
  ['T1', { id: 'T1', send: async (p) => { sent.ticket.push(p); return { id: 'm1' }; } }],
  [cfg.reviewChannelId, { id: cfg.reviewChannelId, send: async (p) => { sent.review.push(p); return { id: 'r1' }; } }],
]);
const users = { send: async (p) => { if (!dmOpen) throw new Error('closed'); sent.dm.push(p); } };
const client = { channels: { fetch: async (id) => { if (!channels.has(id)) throw new Error('unknown'); return channels.get(id); } },
  users: { fetch: async (id) => ({ id, send: users.send }) }, guilds: { cache: new Map([['G1', { fetchOwner: async () => ({ user: { id: 'owner', send: users.send } }) }]]) } };
const guild = { id: 'G1', name: 'Amber Saint' };

test('a new commission is tracked, and status changes reach the client in their ticket', async () => {
  const row = await actions.create(guild, STAFF, { clientId: CLIENT, title: 'Custom HUD', price: '$80', description: 'A HUD', status: 'quoted', deadline: new Date(Date.now() + 5 * 86_400_000), ticketChannelId: 'T1' });
  assert.equal(row.id, 1);
  const first = await actions.reachClient(client, row, views.clientCard(row, 'New Commission'));
  assert.equal(first, 'ticket');
  assert.match(flat(sent.ticket.at(-1)), /Custom HUD/);
  assert.match(flat(sent.ticket.at(-1)), new RegExp(CLIENT), 'the client is pinged');
  assert.deepEqual(sent.ticket.at(-1).allowedMentions, { parse: [], users: [CLIENT] });
  assert.doesNotMatch(flat(sent.ticket.at(-1)), /Private Notes/);

  const result = await actions.changeStatus({ client, guild, row, status: 'in_progress', staffId: STAFF, note: 'Started' });
  assert.equal(result.notified, 'ticket');
  assert.equal(result.review, null, 'no review request before it is complete');
  assert.match(flat(sent.ticket.at(-1)), /In Progress/);
  assert.equal(rows.get(1).history.at(-1).status, 'in_progress');
});

test('without a ticket the client is told by DM, and a closed DM is reported rather than hidden', async () => {
  const row = await actions.create(guild, STAFF, { clientId: CLIENT, title: 'Logo', price: '', description: '', status: 'accepted', deadline: null });
  assert.equal(await actions.reachClient(client, row, views.clientCard(row)), 'dm');
  dmOpen = false;
  assert.equal(await actions.reachClient(client, row, views.clientCard(row)), null);
  dmOpen = true;
  assert.match(actions.whereText(null), /DMs are closed/);
});

test('completing a commission sends the client a review request by DM', async () => {
  const row = await fakeService.get(1);
  const before = sent.dm.length;
  const result = await actions.changeStatus({ client, guild, row, status: 'completed', staffId: STAFF });
  assert.equal(result.review, 'dm');
  assert.equal(rows.get(1).status, 'completed');
  assert.ok(rows.get(1).closed_at);
  const request = sent.dm.at(-1);
  assert.equal(sent.dm.length, before + 1);
  assert.match(flat(request), /How Did We Do/);
  assert.match(flat(request), /commission:review:1/);
  assert.match(flat(request), /only the owner sees it/);
  assert.ok(rows.get(1).review_requested_at);
  const skipped = await actions.changeStatus({ client, guild, row: await fakeService.get(2), status: 'completed', staffId: STAFF, askReview: false });
  assert.equal(skipped.review, null);
});

test('only the client can open the review, and a bad rating is explained', async () => {
  const replies = [];
  const press = (userId, customId, extra = {}) => ({ customId, user: { id: userId, displayAvatarURL: () => 'https://a.co/a.png' }, client, replies,
    isButton: () => !extra.modal, isModalSubmit: () => Boolean(extra.modal), reply: async (p) => replies.push(p), showModal: async (m) => replies.push({ modal: m }), fields: extra.fields });
  await handlers.handle(press('stranger', 'commission:review:1'));
  assert.match(flat(replies.at(-1)), /person who ordered/);
  await handlers.handle(press(CLIENT, 'commission:review:1'));
  const modal = replies.at(-1).modal;
  assert.equal(modal.toJSON().custom_id, 'commission:rv:1');
  const inputs = modal.toJSON().components.map((r) => r.components[0]);
  assert.deepEqual(inputs.map((i) => i.custom_id), ['order', 'rating', 'good', 'improve']);
  assert.equal(inputs[0].value, 'Custom HUD');

  const fields = (v) => ({ getTextInputValue: (k) => v[k] ?? '' });
  await handlers.handle(press(CLIENT, 'commission:rv:1', { modal: true, fields: fields({ order: 'Custom HUD', rating: 'great' }) }));
  assert.match(flat(replies.at(-1)), /Rating Not Understood/);
  assert.equal(reviews.size, 0, 'nothing is saved for a bad rating');
});

test('a review is saved and posted privately for the owner, once', async () => {
  const replies = [];
  const submit = (fields) => ({ customId: 'commission:rv:1', user: { id: CLIENT, displayAvatarURL: () => 'https://a.co/a.png' }, client, isButton: () => false, isModalSubmit: () => true,
    reply: async (p) => replies.push(p), fields: { getTextInputValue: (k) => fields[k] ?? '' } });
  await handlers.handle(submit({ order: 'Custom HUD', rating: '4/5', good: 'Fast and clean.\nGreat communication.', improve: 'More previews along the way.' }));
  assert.match(flat(replies.at(-1)), /Thank You/);
  assert.equal(reviews.get(1).rating, 4);

  assert.equal(sent.review.length, 1, 'posted to the private review channel');
  const post = flat(sent.review[0]);
  assert.match(post, /★★★★☆/);
  assert.match(post, new RegExp(CLIENT));
  assert.match(post, /Custom HUD/);
  assert.match(post, /Fast and clean/);
  assert.match(post, /More previews along the way/);
  assert.match(post, /4 \/ 5/);
  assert.deepEqual(sent.review[0].allowedMentions, { parse: [] });

  await handlers.handle(submit({ order: 'Custom HUD', rating: '1', good: '', improve: '' }));
  assert.match(flat(replies.at(-1)), /Already Reviewed/);
  assert.equal(sent.review.length, 1, 'a second review is never posted');
  assert.equal(reviews.get(1).rating, 4);
});

test('the review goes to the owner\'s channel and a missing channel does not lose it', async () => {
  const saved = channels.get(cfg.reviewChannelId); channels.delete(cfg.reviewChannelId);
  const errors = []; const log = console.error; console.error = (...a) => errors.push(a.join(' '));
  const result = await actions.submitReview({ client, row: await fakeService.get(2), user: { id: CLIENT, displayAvatarURL: () => 'x' }, input: { orderText: 'Logo', rating: 5, wentWell: 'All of it', improve: '' } });
  console.error = log; channels.set(cfg.reviewChannelId, saved);
  assert.equal(result.posted, false);
  assert.equal(reviews.get(2).rating, 5, 'still saved, so it shows in /commission reviews');
  assert.match(errors.join(''), /review channel/);
  assert.equal(cfg.reviewChannelId, process.env.COMMISSION_REVIEW_CHANNEL_ID);
});

test('the client never sees private notes, and the owner does', () => {
  const row = { id: 9, guild_id: 'G1', client_id: CLIENT, title: 'Thing', description: '', price: '', status: 'review', deadline: null, paid: true, paid_at: new Date(), ticket_channel_id: 'T1',
    created_at: new Date(), review_requested_at: null, notes: [{ at: new Date().toISOString(), by: STAFF, text: 'Client is picky about colours' }], history: [{ at: new Date().toISOString(), by: STAFF, status: 'review', note: 'Preview sent' }] };
  assert.doesNotMatch(flat(views.clientCard(row)), /picky about colours/);
  assert.match(flat(views.staffCard(row, null)), /picky about colours/);
  assert.match(flat(views.staffCard(row, { rating: 5 })), /★★★★★/);
  assert.match(flat(views.mineCard([row])), /Thing/);
  assert.match(flat(views.listCard([row])), /Thing/);
  assert.match(flat(views.reviewsSummary([{ rating: 4, commission_id: 9, title: 'Thing', client_id: CLIENT, improve: 'Faster' }], { n: 1, average: 4 })), /4 \/ 5/);
});

test('deadline reminders go to whoever made the commission, once, and overdue ones say so', async () => {
  for (const r of rows.values()) r.last_reminded_at = new Date();
  const due = await actions.create(guild, STAFF, { clientId: CLIENT, title: 'Due Soon', price: '', description: '', status: 'in_progress', deadline: new Date(Date.now() - 3_600_000) });
  const before = sent.dm.length;
  await actions.tick(client);
  assert.equal(sent.dm.length, before + 1);
  assert.match(flat(sent.dm.at(-1)), /Overdue/);
  assert.ok(rows.get(due.id).last_reminded_at);
  await actions.tick(client);
  assert.equal(sent.dm.length, before + 1, 'not again today');
});
