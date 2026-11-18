// The whole staff flow with fake Discord objects and an in-memory database.
const test = require('node:test');
const path = require('node:path');
const assert = require('node:assert/strict');

const offers = new Map(); const history = []; let nextId = 1;
const fakeService = {
  createOffer: async (o) => { const row = { id: nextId++, guild_id: o.guildId, user_id: o.userId, team: o.team, rank_key: o.rankKey, offered_by: o.offeredBy, note: o.note, status: 'pending', response_note: '', dm_channel_id: null, dm_message_id: null, expires_at: new Date(Date.now() + 7 * 86_400_000) }; offers.set(row.id, row); return { ...row }; },
  setOfferMessage: async (id, c, m) => { Object.assign(offers.get(id), { dm_channel_id: c, dm_message_id: m }); },
  getOffer: async (id) => (offers.has(id) ? { ...offers.get(id) } : null),
  pendingFor: async (g, u) => [...offers.values()].find((o) => o.user_id === u && o.status === 'pending' && new Date(o.expires_at) > new Date()) ?? null,
  listPending: async () => [...offers.values()].filter((o) => o.status === 'pending'),
  settle: async (id, status, note = '') => { const o = offers.get(id); if (!o || o.status !== 'pending') return null; Object.assign(o, { status, response_note: note }); return { ...o }; },
  setStatus: async (id, status) => { offers.get(id).status = status; },
  expireDue: async () => [...offers.values()].filter((o) => o.status === 'pending' && new Date(o.expires_at) <= new Date()).map((o) => { o.status = 'expired'; return { ...o }; }),
  addHistory: async (h) => { history.push(h); }, inductedSince: async () => new Map(),
};
const servicePath = path.join(__dirname, '..', 'src/modules/staff/service.js');
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: fakeService };
const logger = require('../src/modules/logging/logger'); const logged = []; logger.log = async (g, type, fn) => { logged.push([type, fn()]); };
const actions = require('../src/modules/staff/actions');
const handlers = require('../src/modules/staff/handlers');
const views = require('../src/modules/staff/views');

// ---------- fake Discord ----------
const PERM = require('discord.js').PermissionFlagsBits;
const ROLE_NAMES = ['Trial Moderator', 'Moderator', 'Head Moderator', 'Trial Agent', 'Community Agent', 'Head of Community', 'Moderation Team', 'Community Engagement Team', 'Staff', '▬▬▬ STAFF ▬▬▬', 'Administrator'];
const roles = new Map(ROLE_NAMES.map((name, i) => [`r-${i}`, { id: `r-${i}`, name, position: i + 1, managed: false }]));
const roleByName = (n) => [...roles.values()].find((r) => r.name === n);
const guild = { id: 'G', name: 'Amber Saint', ownerId: 'owner', roles: { cache: Object.assign(roles, { find: (fn) => [...roles.values()].find(fn) }) }, members: { me: { roles: { highest: { position: 50 } } }, cache: new Map(), fetch: async (id) => { if (id === undefined) return people; const m = people.get(id); if (!m) throw new Error('unknown member'); return m; } } };
const people = new Map();
const dms = [];
function person(id, roleNames = [], { admin = false, manageable = true, dmOpen = true } = {}) {
  const held = new Map(roleNames.map((n) => [roleByName(n).id, roleByName(n)]));
  const m = { id, guild, displayName: id, manageable, user: { id, bot: false, tag: `${id}#1` }, permissions: { has: (p) => admin && p === PERM.Administrator },
    roles: { cache: Object.assign(held, { some: (fn) => [...held.values()].some(fn), values: () => [...Map.prototype.values.call(held)][Symbol.iterator](), find: (fn) => [...held.values()].find(fn) }),
      add: async (list) => { for (const r of [].concat(list)) held.set(r.id, r); m.calls.push(['add', [].concat(list).map((r) => r.name)]); }, remove: async (list) => { for (const r of [].concat(list)) held.delete(r.id); m.calls.push(['remove', [].concat(list).map((r) => r.name)]); } }, calls: [], dmOpen };
  people.set(id, m); return m;
}
const names = (m) => [...m.roles.cache.values()].map((r) => r.name);
const dmLog = [];
const client = { guilds: { cache: new Map([['G', guild]]), fetch: async () => guild },
  users: { fetch: async (id) => { const m = people.get(id); return { id, send: async (p) => { if (m && !m.dmOpen) throw new Error('closed'); dmLog.push({ id, p }); return { id: `dm-${dmLog.length}`, channelId: `dmc-${id}`, edit: async () => {} }; } }; } },
  channels: { fetch: async () => ({ messages: { fetch: async () => ({ edit: async (p) => { edits.push(p); } }) } }) } };
const edits = [];
const flat = (p) => JSON.stringify((p.components ?? [p]).map((x) => (x.toJSON ? x.toJSON() : x)));
const lastDm = (id) => dmLog.filter((d) => d.id === id).at(-1);

test('a team head sends an offer, the person accepts with a note, and every role is applied', async () => {
  const head = person('head1', ['Head Moderator', 'Moderation Team', 'Staff']);
  const target = person('newbie');
  const offer = await actions.induct({ client, guild, actor: head, target, teamKey: 'moderation', rankKey: 'trial', note: 'We loved your application.' });
  assert.equal(offer.status, 'pending');
  const dm = flat(lastDm('newbie').p);
  assert.match(dm, /You Have Been Selected/); assert.match(dm, /Moderation Team/); assert.match(dm, /Trial Moderator/); assert.match(dm, /We loved your application/);
  assert.match(dm, /staff:accept:1/); assert.match(dm, /staff:decline:1/);
  assert.equal(offers.get(1).dm_message_id, 'dm-1');
  assert.deepEqual(names(target), [], 'nothing changes before they answer');

  const press = (customId, modal = false, note = '') => {
    const out = [];
    const i = { customId, user: target.user, client, isButton: () => !modal, isModalSubmit: () => modal, deferUpdate: async () => {}, editReply: async (p) => out.push(p),
      showModal: async (m) => out.push({ modal: m }), reply: async (p) => out.push(p), followUp: async (p) => out.push(p), fields: { getTextInputValue: () => note } };
    return { out, i };
  };
  const open = press('staff:accept:1'); await handlers.handle(open.i);
  assert.equal(open.out[0].modal.toJSON().custom_id, 'staff:ma:1');
  assert.equal(open.out[0].modal.toJSON().components[0].components[0].required, false, 'the note is optional');

  const submit = press('staff:ma:1', true, 'Happy to join. I am free evenings.'); await handlers.handle(submit.i);
  assert.deepEqual(names(target).sort(), ['Moderation Team', 'Staff', 'Trial Moderator', '▬▬▬ STAFF ▬▬▬'].sort(), 'team, rank, Staff and the staff header');
  assert.match(flat(submit.out[0]), /Welcome To The Team/);
  assert.equal(offers.get(1).status, 'accepted'); assert.equal(offers.get(1).response_note, 'Happy to join. I am free evenings.');
  assert.match(flat(lastDm('head1').p), /Happy to join. I am free evenings./, 'the inviter is told, with the note');
  assert.equal(history.at(-1).action, 'induct');
  assert.equal(logged.at(-1)[0], 'server', 'with no staff channel found it falls back to server-logs');

  const again = press('staff:ma:1', true); await handlers.handle(again.i);
  assert.match(flat(again.out[0]), /Already Answered/);
  assert.equal(target.calls.filter((c) => c[0] === 'add').length, 1, 'never applied twice');
});

test('declining changes nothing, and the inviter hears about it', async () => {
  const head = people.get('head1'); const target = person('shy');
  await actions.induct({ client, guild, actor: head, target, teamKey: 'moderation', rankKey: 'moderator' });
  const id = [...offers.values()].at(-1).id;
  const result = await actions.respond({ client, user: target.user, offerId: id, accept: false, note: 'Not right now, sorry.' });
  assert.match(flat(result.card), /Offer Declined/);
  assert.deepEqual(names(target), []);
  assert.equal(offers.get(id).status, 'declined');
  assert.match(flat(lastDm('head1').p), /Not right now, sorry./);
});

test('who may send which offer is enforced, with clear reasons', async () => {
  const head = people.get('head1'); const t = person('t1');
  await assert.rejects(actions.induct({ client, guild, actor: head, target: t, teamKey: 'moderation', rankKey: 'head' }), /administrator or the owner/);
  await assert.rejects(actions.induct({ client, guild, actor: head, target: t, teamKey: 'community', rankKey: 'trial' }), /different team/);
  const plain = person('plain', ['Moderator']);
  await assert.rejects(actions.induct({ client, guild, actor: plain, target: t, teamKey: 'moderation', rankKey: 'trial' }), /Only team heads/);
  await assert.rejects(actions.induct({ client, guild, actor: head, target: head, teamKey: 'moderation', rankKey: 'trial' }), /yourself/);
  const admin = person('admin1', [], { admin: true });
  assert.equal((await actions.induct({ client, guild, actor: admin, target: t, teamKey: 'community', rankKey: 'head' })).rank_key, 'head');
  await assert.rejects(actions.induct({ client, guild, actor: admin, target: t, teamKey: 'community', rankKey: 'trial' }), /already have an offer/);
});

test('closed DMs, missing roles and roles Tower cannot manage are all caught before anything is sent', async () => {
  const head = people.get('head1');
  const closed = person('closed', [], { dmOpen: false });
  await assert.rejects(actions.induct({ client, guild, actor: head, target: closed, teamKey: 'moderation', rankKey: 'trial' }), /DMs are closed/);
  assert.equal([...offers.values()].at(-1).status, 'cancelled');

  const staffRole = roleByName('Staff'); roles.delete(staffRole.id);
  await assert.rejects(actions.induct({ client, guild, actor: head, target: person('x1'), teamKey: 'moderation', rankKey: 'trial' }), /do not exist yet: \*\*Staff\*\*/);
  roles.set(staffRole.id, staffRole);

  roleByName('Moderator').position = 60;
  await assert.rejects(actions.induct({ client, guild, actor: head, target: person('x2'), teamKey: 'moderation', rankKey: 'moderator' }), /Tower cannot manage: \*\*Moderator\*\*/);
  roleByName('Moderator').position = 2;
  await assert.rejects(actions.induct({ client, guild, actor: head, target: person('x3', [], { manageable: false }), teamKey: 'moderation', rankKey: 'trial' }), /Tower cannot manage/);
});

test('a missing staff header is skipped with a note instead of blocking the induction', async () => {
  const header = roleByName('▬▬▬ STAFF ▬▬▬'); roles.delete(header.id);
  const head = people.get('head1'); const t = person('noheader');
  const offer = await actions.induct({ client, guild, actor: head, target: t, teamKey: 'moderation', rankKey: 'trial' });
  const result = await actions.respond({ client, user: t.user, offerId: offer.id, accept: true, note: '' });
  assert.match(flat(result.card), /Welcome/);
  assert.ok(names(t).includes('Staff') && !names(t).includes('▬▬▬ STAFF ▬▬▬'));
  assert.match(flat(lastDm('head1').p), /no divider role/);
  roles.set(header.id, header);
});

test('promoting, demoting and removing change the right roles and tell the person', async () => {
  const head = person('head2', ['Head Moderator', 'Moderation Team', 'Staff', '▬▬▬ STAFF ▬▬▬']);
  const admin = person('admin2', [], { admin: true });
  const trial = person('p1', ['Trial Moderator', 'Moderation Team', 'Staff', '▬▬▬ STAFF ▬▬▬']);

  const up = await actions.change({ client, guild, actor: head, target: trial, action: 'promote', reason: 'Great work' });
  assert.deepEqual(names(trial).sort(), ['Moderation Team', 'Moderator', 'Staff', '▬▬▬ STAFF ▬▬▬'].sort());
  assert.equal(up.toRank, 'Moderator'); assert.equal(up.dmSent, true);
  assert.match(flat(lastDm('p1').p), /promoted/); assert.match(flat(lastDm('p1').p), /Great work/);
  await assert.rejects(actions.change({ client, guild, actor: head, target: trial, action: 'promote' }), /Only an administrator or the owner/);
  await actions.change({ client, guild, actor: admin, target: trial, action: 'promote' });
  assert.ok(names(trial).includes('Head Moderator') && !names(trial).includes('Moderator'));

  await actions.change({ client, guild, actor: admin, target: trial, action: 'demote', reason: 'Stepping back' });
  assert.ok(names(trial).includes('Moderator') && !names(trial).includes('Head Moderator'));
  await assert.rejects(actions.change({ client, guild, actor: head, target: head, action: 'demote' }), /yourself/);

  const quiet = await actions.change({ client, guild, actor: head, target: trial, action: 'demote', notify: false });
  assert.equal(quiet.dmSent, false);
  await assert.rejects(actions.change({ client, guild, actor: head, target: trial, action: 'demote' }), /lowest rank/);

  await actions.change({ client, guild, actor: head, target: trial, action: 'remove', reason: 'Went inactive' });
  assert.deepEqual(names(trial), [], 'every staff role and the header are gone');
  assert.equal(history.at(-1).action, 'remove');
  await assert.rejects(actions.change({ client, guild, actor: head, target: trial, action: 'remove' }), /not on a staff team/);
});

test('removing someone who also holds a leadership role keeps their Staff roles', async () => {
  const admin = person('admin3', [], { admin: true });
  const both = person('both', ['Trial Moderator', 'Moderation Team', 'Staff', '▬▬▬ STAFF ▬▬▬', 'Administrator']);
  await actions.change({ client, guild, actor: admin, target: both, action: 'remove' });
  assert.deepEqual(names(both).sort(), ['Administrator', 'Staff', '▬▬▬ STAFF ▬▬▬'].sort());
});

test('an offer is void if the person who sent it has since lost the authority', async () => {
  const head = person('head3', ['Head Moderator', 'Moderation Team', 'Staff']); const t = person('late');
  const offer = await actions.induct({ client, guild, actor: head, target: t, teamKey: 'moderation', rankKey: 'trial' });
  for (const n of ['Head Moderator']) head.roles.cache.delete(roleByName(n).id);       // demoted before the answer
  const result = await actions.respond({ client, user: t.user, offerId: offer.id, accept: true, note: '' });
  assert.match(flat(result.card), /Offer Withdrawn/);
  assert.deepEqual(names(t), []);
  assert.match(flat(lastDm('head3').p), /No Longer Valid/);
});

test('offers can be withdrawn by the sender or an administrator, and expire by themselves', async () => {
  const head = person('head4', ['Head Moderator', 'Moderation Team', 'Staff']); const other = person('head5', ['Head Moderator']); const admin = person('admin4', [], { admin: true });
  const t = person('wait');
  const offer = await actions.induct({ client, guild, actor: head, target: t, teamKey: 'moderation', rankKey: 'trial' });
  await assert.rejects(actions.cancelOffer({ client, guild, actor: other, offerId: offer.id }), /Only the person who made an offer/);
  await actions.cancelOffer({ client, guild, actor: admin, offerId: offer.id });
  assert.equal(offers.get(offer.id).status, 'cancelled');
  await assert.rejects(actions.cancelOffer({ client, guild, actor: admin, offerId: offer.id }), /already been answered/);
  assert.ok(edits.length > 0, 'the DM is updated so the buttons stop working');

  const t2 = person('slow');
  const o2 = await actions.induct({ client, guild, actor: head, target: t2, teamKey: 'moderation', rankKey: 'trial' });
  offers.get(o2.id).expires_at = new Date(Date.now() - 1000);
  const before = dmLog.length;
  await actions.tick(client);
  assert.equal(offers.get(o2.id).status, 'expired');
  assert.match(flat(dmLog.at(-1).p), /Offer Expired/);
  const late = await actions.respond({ client, user: t2.user, offerId: o2.id, accept: true, note: '' });
  assert.match(flat(late.card), /Already Answered/);
  assert.ok(dmLog.length > before);
});

test('the roster lists each team by rank, plus leadership', async () => {
  people.clear();
  person('owner'); person('boss', ['Administrator']);
  person('a', ['Head Moderator', 'Moderation Team']); person('b', ['Moderator']); person('c', ['Trial Agent']); person('d', ['Head of Community']);
  const data = await actions.rosterData(guild);
  const card = flat(views.rosterCard(data));
  assert.match(card, /Moderation Team/); assert.match(card, /Community Engagement Team/);
  assert.match(card, /Administrator: <@boss>/); assert.match(card, /Owner: <@owner>/);
  const mod = data.teams[0].ranks;
  assert.deepEqual(mod.map((r) => r.ids), [[], ['b'], ['a']]);
  assert.deepEqual(data.teams[1].ranks.map((r) => r.ids), [['c'], [], ['d']]);
  assert.ok(card.indexOf('Head Moderator') < card.indexOf('Trial Moderator'), 'heads first');
  const only = await actions.rosterData(guild, { teamKey: 'community', withLeadership: false });
  assert.equal(only.teams.length, 1); assert.equal(only.leadership, null);
  assert.equal(actions.isStaffMember(people.get('b')), true);
  assert.equal(actions.isStaffMember(person('rando')), false);
});


test('staff changes use the staff log channel once there is one', () => {
  const logChannels = require('../src/modules/logging/channels');
  const real = logChannels.channelFor;
  logChannels.channelFor = (g, type) => (type === 'staff' ? 'chan-1' : null);
  const before = logged.length;
  return actions.change({ client, guild, actor: person('adminX', [], { admin: true }), target: person('tmp', ['Trial Moderator', 'Moderation Team', 'Staff', '▬▬▬ STAFF ▬▬▬']), action: 'remove' })
    .then(() => { assert.equal(logged.length, before + 1); assert.equal(logged.at(-1)[0], 'staff'); })
    .finally(() => { logChannels.channelFor = real; });
});
