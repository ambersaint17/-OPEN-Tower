// AutoMod end to end with fake messages, an in-memory settings store and a fake warning system.
const test = require('node:test');
const path = require('node:path');
const assert = require('node:assert/strict');
const lib = require('../src/lib/automod');

const state = { settings: null, words: [] };
const fakeService = { getSettings: async () => state.settings, getWords: async () => state.words, saveSettings: async () => {}, addWord: async () => true, removeWord: async () => true, recentWarns: async () => 0 };
const servicePath = path.join(__dirname, '..', 'src/modules/automod/service.js');
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: fakeService };

const { automod: cfg } = require('../src/constants');
const modActions = require('../src/modules/moderation/actions');
const engine = require('../src/modules/levels/engine');
const automod = require('../src/modules/automod');

const warnings = [];
modActions.warn = async (ctx, user, reason, opts) => { warnings.push({ ctx, user, reason, opts }); return { case_number: warnings.length }; };
engine.peek = async () => ({ xp: 0, level: 0 });
cfg.noticeSeconds = 0.02;

const col = (items = []) => Object.assign(new Map(items.map((i) => [i.id, i])), { some(fn) { return [...this.values()].some(fn); }, values() { return [...Map.prototype.values.call(this)][Symbol.iterator](); } });
const setup = (over = {}) => { state.settings = { enabled: true, config: lib.mergeConfig(over.config), exemptChannels: over.exemptChannels ?? [], exemptRoles: over.exemptRoles ?? [] }; state.words = over.words ?? []; };
const me = { id: 'bot', roles: { highest: { position: 99 } } };
const deleted = []; const bulk = []; const notices = [];
const channel = { id: 'c1', parentId: 'cat1', parent: { parentId: null },
  send: async (p) => { const n = { ...p, delete: async () => { n.gone = true; } }; notices.push(n); return n; },
  bulkDelete: async (ids) => { bulk.push(ids); return { size: ids.length }; }, messages: { delete: async (id) => { deleted.push(id); } } };
const guild = { id: 'G', ownerId: 'owner', members: { me }, channels: { cache: new Map([['c1', channel]]) } };
let counter = 0;
function message(content, { userId = 'u1', roles = [], admin = false, manage = false, ch = channel, mentions = [], edited = false, invite = null } = {}) {
  const user = { id: userId, bot: false, tag: `${userId}#0001`, toString: () => `<@${userId}>` };
  return { id: `msg${++counter}`, guild, author: user, content, channel: ch, channelId: ch.id, system: false, webhookId: null,
    member: { id: userId, roles: { cache: col(roles.map((n, i) => ({ id: `r-${n}`, name: n }))) }, permissions: { has: (p) => (admin ? true : manage && String(p).length > 0 && p === require('discord.js').PermissionFlagsBits.ManageMessages) } },
    mentions: { users: new Map(mentions.map((m) => [m, 1])), roles: new Map() }, attachments: { size: 0 },
    client: { fetchInvite: async (code) => { if (code === 'bad') throw new Error('Unknown Invite'); return { guild: { id: code === 'home' ? 'G' : 'other' } }; } } };
}
const reset = () => { warnings.length = 0; deleted.length = 0; bulk.length = 0; notices.length = 0; automod.lastWarn.clear(); automod.lastNotice.clear(); automod.tracker.people.clear(); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('nothing happens while AutoMod is off, and staff are never touched', async () => {
  reset(); setup(); state.settings.enabled = false;
  assert.equal(await automod.inspect(message('fuck', {})), false);
  setup({ words: ['fuck'] });
  for (const who of [message('fuck', { roles: ['Moderator'] }), message('fuck', { admin: true }), message('fuck', { userId: 'owner' }), message('fuck', { manage: true })]) assert.equal(await automod.inspect(who), false);
  assert.equal(warnings.length, 0); assert.equal(deleted.length, 0);
});

test('exempt channels, categories and roles are ignored', async () => {
  reset(); setup({ words: ['fuck'], exemptChannels: ['c1'] });
  assert.equal(await automod.inspect(message('fuck')), false);
  setup({ words: ['fuck'], exemptChannels: ['cat1'] });
  assert.equal(await automod.inspect(message('fuck')), false, 'a whole category');
  setup({ words: ['fuck'], exemptRoles: ['r-Trusted'] });
  assert.equal(await automod.inspect(message('fuck', { roles: ['Trusted'] })), false);
  assert.equal(await automod.inspect(message('fuck')), true, 'everyone else is still covered');
});

test('a banned word removes the message, warns through the case system, and tells the member briefly', async () => {
  reset(); setup({ words: ['fuck'] });
  const m = message('you are a fuck');
  assert.equal(await automod.inspect(m), true);
  assert.deepEqual(deleted, [m.id]);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].opts, { source: 'automod' });
  assert.match(warnings[0].reason, /^AutoMod: a banned word/);
  assert.match(warnings[0].reason, /you are a fuck/);
  assert.equal(warnings[0].ctx.moderator, me);
  assert.equal(warnings[0].user, m.author);
  assert.equal(notices.length, 1);
  assert.match(notices[0].content, /removed for a banned word/);
  assert.match(notices[0].content, /counts as a warning/);
  assert.deepEqual(notices[0].allowedMentions, { users: ['u1'] });
  await wait(60);
  assert.equal(notices[0].gone, true, 'the notice cleans itself up');
});

test('only one warning a minute and one notice per burst, but every message is still removed', async () => {
  reset(); setup({ words: ['fuck'] });
  await automod.inspect(message('fuck one'));
  await automod.inspect(message('fuck two'));
  await automod.inspect(message('fuck three'));
  assert.equal(deleted.length, 3);
  assert.equal(warnings.length, 1);
  assert.equal(notices.length, 1);
  automod.lastWarn.clear(); automod.lastNotice.clear();
  await automod.inspect(message('fuck later'));
  assert.equal(warnings.length, 2, 'a new offence a while later counts again, so repeat offenders escalate');
  await automod.inspect(message('fuck other', { userId: 'u2' }));
  assert.equal(warnings.length, 3, 'each person has their own cooldown');
});

test('flooding removes the whole burst at once, with one warning', async () => {
  reset(); setup();
  const results = [];
  for (let i = 1; i <= 6; i++) results.push(await automod.inspect(message(`different message ${i}`)));
  assert.deepEqual(results, [false, false, false, false, false, true]);
  assert.equal(bulk.length, 1);
  assert.equal(bulk[0].length, 6, 'all six, not just the last');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].reason, /too quickly/);
  assert.equal(await automod.inspect(message('a fresh message afterwards')), false, 'the handled burst is forgotten');
});

test('repeating the same message, mass mentions and invites are caught', async () => {
  reset(); setup();
  assert.equal(await automod.inspect(message('buy my stuff')), false);
  assert.equal(await automod.inspect(message('buy my stuff')), false);
  assert.equal(await automod.inspect(message('buy my stuff')), true);
  assert.match(warnings.at(-1).reason, /repeating/);
  reset();
  assert.equal(await automod.inspect(message('hello', { mentions: ['a', 'b', 'c', 'd', 'e', 'f'] })), true);
  assert.match(warnings.at(-1).reason, /mass mentions/);
  reset();
  assert.equal(await automod.inspect(message('come to discord.gg/other')), true);
  assert.match(warnings.at(-1).reason, /server invite/);
});

test('an invite to this same server is allowed, and a dead invite counts as foreign', async () => {
  reset(); setup();
  assert.equal(await automod.inspect(message('join us: discord.gg/home')), false);
  assert.equal(await automod.inspect(message('discord.gg/bad', { userId: 'u9' })), true);
});

test('an edit is checked too, but editing does not count as flooding', async () => {
  reset(); setup({ words: ['fuck'] });
  assert.equal(await automod.inspect(message('fuck'), { edited: true }), true);
  reset(); setup();
  for (let i = 1; i <= 8; i++) assert.equal(await automod.inspect(message(`edit ${i}`), { edited: true }), false);
});

test('trouble warning or deleting never breaks the message handler', async () => {
  reset(); setup({ words: ['fuck'] });
  const warn = modActions.warn;
  modActions.warn = async () => { throw new Error('cannot warn someone with a higher role'); };
  const log = console.warn; const lines = []; console.warn = (...a) => lines.push(a.join(' '));
  assert.equal(await automod.inspect(message('fuck')), true);
  assert.match(lines.join(''), /could not warn/);
  modActions.warn = warn;
  channel.messages.delete = async () => { throw new Error('Missing Permissions'); };
  automod.lastWarn.clear();
  assert.equal(await automod.inspect(message('fuck again')), true);
  console.warn = log;
  channel.messages.delete = async (id) => { deleted.push(id); };
  assert.match(lines.join(''), /Manage Messages/);
});

test('the dry run reports what the content rules would do, without removing anything', async () => {
  reset(); setup({ words: ['fuck'] });
  assert.equal((await automod.dryRun('fuck you', state.settings, state.words)).rule, 'words');
  assert.equal(await automod.dryRun('lovely day', state.settings, state.words), null);
  assert.equal((await automod.dryRun('discord.gg/abc', state.settings, state.words)).rule, 'links');
  assert.equal((await automod.dryRun('<@1> <@2> <@3> <@4> <@5> <@6>', state.settings, state.words)).rule, 'mentions');
  assert.equal(deleted.length, 0);
});
