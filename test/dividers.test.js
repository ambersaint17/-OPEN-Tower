const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/lib/dividers');
const sync = require('../src/modules/dividers/sync');
const { dividers: cfg } = require('../src/constants');

const role = (id, name, managed = false) => ({ id, name, managed });
const guildRoles = [
  role('pd', '▬▬▬ PINGS ▬▬▬'), role('ind', '▬▬▬ INTERESTS ▬▬▬'), role('lvd', '▬▬▬ LEVELS ▬▬▬'),
  role('r1', 'Announcement'), role('r2', 'YouTube Ping'), role('r3', 'Giveaway'), role('r4', 'Event Ping'),
  role('i1', 'Gaming'), role('i2', 'Music'), role('i3', 'Developing'),
  role('p1', 'Reactions'), role('p2', 'Emojis'), role('c1', 'Colour | Sky'), role('x1', 'Moderator'), role('boost', 'Server Booster', true),
];
const groups = sync.groups;
const run = (held) => d.plan({ guildRoles, memberRoleIds: new Set(held), groups });

test('getting a ping role gives the PINGS divider, and an interest gives INTERESTS', () => {
  assert.deepEqual(run(['r1']), { add: ['pd'], remove: [], missing: [] });
  assert.deepEqual(run(['i1']), { add: ['ind'], remove: [], missing: [] });
  assert.deepEqual(run(['r2', 'i2', 'i3']).add.sort(), ['ind', 'pd']);
});

test('level perk roles and name colours give the LEVELS divider', () => {
  assert.deepEqual(run(['p1']).add, ['lvd']);
  assert.deepEqual(run(['c1']).add, ['lvd']);
  assert.deepEqual(run(['x1', 'boost']).add, [], 'staff and booster roles belong to no section');
});

test('already right means nothing to do, and the divider goes when the last role of its section does', () => {
  assert.deepEqual(run(['r1', 'pd']), { add: [], remove: [], missing: [] });
  assert.deepEqual(run(['pd']).remove, ['pd']);
  assert.deepEqual(run(['pd', 'r1', 'r2']).remove, []);              // still holds two of them
  assert.deepEqual(run(['pd', 'ind', 'i1']), { add: [], remove: ['pd'], missing: [] });   // pings gone, interest stays
  assert.deepEqual(run([]), { add: [], remove: [], missing: [] });
});

test('a divider itself never counts as a role of its section, and a missing divider is skipped', () => {
  assert.deepEqual(run(['pd', 'ind']).remove.sort(), ['ind', 'pd']);   // holding only dividers is not a reason to keep them
  const noPings = d.plan({ guildRoles: guildRoles.filter((r) => r.id !== 'pd'), memberRoleIds: new Set(['r1']), groups });
  assert.deepEqual(noPings.add, []);
  assert.deepEqual(noPings.missing, ['pings']);
});

test('role names are matched loosely: capitals, symbols and small variations', () => {
  assert.equal(d.nameMatches('YouTube Ping', ['YouTube']), true);
  assert.equal(d.nameMatches('📣 Announcements', ['Announcement']), true);
  assert.equal(d.nameMatches('Dev Updates', ['Dev Updates']), true);
  assert.equal(d.nameMatches('Moderator', ['Music']), false);
});

// ---------- the member sync ----------
function member(roleIds, { bot = false } = {}) {
  const held = new Map(roleIds.map((id) => [id, { id }]));
  const calls = { add: [], remove: [] };
  const guild = { id: 'G', roles: { cache: new Map(guildRoles.map((r) => [r.id, r])) }, members: { cache: new Map(), me: { roles: { highest: { position: 50 } } } } };
  const m = { id: 'M', user: { bot }, guild, roles: { cache: held, add: async (ids) => { calls.add.push(ids); }, remove: async (ids) => { calls.remove.push(ids); } }, calls };
  guild.members.cache.set('M', m);
  return m;
}

test('onboarding roles are turned into divider roles', async () => {
  const m = member(['r1', 'i1']);
  const result = await sync.syncMember(m);
  assert.deepEqual(m.calls.add, [['pd', 'ind']]);
  assert.deepEqual(result, { added: 2, removed: 0 });
  assert.deepEqual((await sync.syncMember(member(['pd', 'r1']))).added, 0);
});

test('bots are left alone, and a hierarchy error is reported once without crashing', async () => {
  assert.deepEqual(await sync.syncMember(member(['r1'], { bot: true })), { added: 0, removed: 0 });
  const m = member(['r1']); m.roles.add = async () => { throw new Error('Missing Permissions'); };
  const warn = console.warn; const lines = []; console.warn = (...a) => lines.push(a.join(' '));
  const first = await sync.syncMember(m); await sync.syncMember(m);
  console.warn = warn;
  assert.equal(first.failed, true);
  assert.equal(lines.length, 1, 'one warning, not one per member');
  assert.match(lines[0], /above the divider roles/);
});

test('a burst of role changes is handled once, after the last one', async () => {
  const saved = cfg.syncDelayMs; cfg.syncDelayMs = 20;
  const m = member(['r1']);
  sync.schedule(m); sync.schedule(m); sync.schedule(m);
  assert.equal(m.calls.add.length, 0, 'nothing happens straight away');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(m.calls.add, [['pd']]);
  cfg.syncDelayMs = saved;
});

test('status says which sections have a divider and whether Tower can move it', () => {
  const guild = { roles: { cache: new Map(guildRoles.map((r, i) => [r.id, { ...r, position: r.id === 'pd' ? 60 : i }])) }, members: { me: { roles: { highest: { position: 50 } } } } };
  const status = sync.status(guild);
  assert.deepEqual(status.map((s) => [s.key, Boolean(s.roleId), s.tooHigh]), [['pings', true, true], ['interests', true, false], ['levels', true, false]]);
});
