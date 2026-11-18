// Drives the whole /embed builder with fake Discord interactions and an in-memory stand-in for the database.
const test = require('node:test');
const path = require('path');
const store = { posts: new Map(), templates: new Map() };
const servicePath = path.join(__dirname, '..', 'src/modules/embed/service.js');
const embed = require('../src/lib/embed');
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: {
  getTemplate: async (g, n) => store.templates.get(n.toLowerCase()) ?? null, countTemplates: async () => store.templates.size,
  saveTemplate: async (g, n, d) => { store.templates.set(n.toLowerCase(), { name: n, draft: embed.sanitizeDraft(d) }); },
  recordPost: async (p) => { store.posts.set(p.messageId, { ...p }); }, updatePost: async (c, m, d) => { store.posts.get(m).draft = d; },
  postByMessage: async (id) => { const p = store.posts.get(id); return p ? { ...p, draft: embed.sanitizeDraft(p.draft) } : null; },
  listTemplates: async () => [], deleteTemplate: async () => true,
} };
const assert = require('node:assert/strict');
const handlers = require('../src/modules/embed/handlers');
const sessions = require('../src/modules/embed/session');
const editor = require('../src/modules/embed/editor');

const col = (items) => Object.assign(new Map(items.map((i) => [i.id, i])), { find(fn) { return [...this.values()].find(fn); }, some(fn) { return [...this.values()].some(fn); }, first() { return [...this.values()][0]; } });
const ROLE = '111111111111111111', ADMIN = '222222222222222222';
const sent = [];
const channel = { id: '333333333333333333', name: 'announcements', type: require('discord.js').ChannelType.GuildText,
  permissionsFor: () => ({ has: () => true }),
  send: async (p) => { const m = { id: '444444444444444444', attachments: new Map(), channelId: channel.id, ...p }; sent.push(m); m.edit = async (e) => { Object.assign(m, e); }; channel.messages.items.set(m.id, m); return m; },
  messages: { items: new Map(), fetch: async (id) => channel.messages.items.get(id) },
  createWebhook: async () => ({ applicationId: '1', send: async (p) => { const m = { id: '555555555555555555', webhookId: 'w', attachments: new Map(), ...p }; sent.push(m); return m; } }),
  fetchWebhooks: async () => col([]),
};
const gaming = { id: ROLE, name: 'Gaming', managed: false, position: 3, permissions: { any: () => false } };
const guild = { id: 'G1', ownerId: ADMIN, roles: { cache: col([gaming]) }, channels: { cache: col([channel]), fetch: async () => channel },
  members: { me: { roles: { highest: { position: 50 } } }, cache: col([]) } };
channel.guild = guild;
const memberRoles = col([]); memberRoles.add = async (r) => memberRoles.set(r.id, r); memberRoles.remove = async (r) => memberRoles.delete(r.id);
Object.defineProperty(memberRoles, 'cache', { get() { return memberRoles; } });
const admin = { id: ADMIN, roles: { cache: col([]) }, permissions: { has: () => true } };

const log = [];
function fake(customId, kind, extra = {}) {
  const i = { customId, guild, guildId: 'G1', member: admin, user: { id: ADMIN }, client: { user: { id: '1' } }, deferred: false, replied: false, values: [], ...extra,
    isModalSubmit: () => kind === 'modal', isStringSelectMenu: () => kind === 'select', isChannelSelectMenu: () => kind === 'channel', isButton: () => kind === 'button',
    update: async (p) => { i.replied = true; log.push(['update', p]); }, reply: async (p) => { i.replied = true; log.push(['reply', p]); },
    editReply: async (p) => { log.push(['editReply', p]); }, deferUpdate: async () => { i.deferred = true; }, deferReply: async () => { i.deferred = true; },
    followUp: async (p) => { log.push(['followUp', p]); }, showModal: async (m) => { log.push(['modal', m.toJSON?.() ?? m]); },
    fields: { getTextInputValue: (k) => (extra.fields ?? {})[k] ?? '' } };
  return i;
}
const text = (p) => JSON.stringify(p.components.map((c) => c.toJSON()));
const last = () => log.at(-1);

test('the builder works from first block to posted, edited and clicked embed', async () => {
  const s = sessions.create({ userId: ADMIN, guildId: 'G1' });
  const go = async (customId, kind, extra) => { log.length = 0; await handlers.handle(fake(`embed:${customId}:${s.id}`, kind, extra)); };

  // add text block with a role mention token
  await go('add', 'select', { values: ['text'] }); assert.equal(last()[0], 'modal'); 
  await go('m_text', 'modal', { fields: { content: '# Welcome\nHello @{Gaming}!' } });
  assert.equal(s.draft.blocks[0].content, `# Welcome\nHello <@&${ROLE}>!`); assert.equal(last()[0], 'update');
  // add separator then buttons then menu
  await go('add', 'select', { values: ['separator'] }); assert.equal(s.draft.blocks.length, 2);
  await go('add', 'select', { values: ['buttons'] });
  await go('m_buttons', 'modal', { fields: { lines: 'Watch | https://youtu.be/x | ▶️\nGamer | role:Gaming | 🎮' } });
  assert.equal(s.draft.blocks[2].buttons[1].roleId, ROLE);
  await go('add', 'select', { values: ['menu'] });
  await go('m_menu', 'modal', { fields: { placeholder: 'Choose a level', options: 'Rules | Read | 📜\nRoles | Pick | | role:Gaming', replies: 'Be kind.\n---\nWelcome to the club.' } });
  assert.equal(s.draft.blocks[3].type, 'menu'); const menuId = s.draft.blocks[3].id;
  // bad input keeps the builder unchanged and explains
  await go('add', 'select', { values: ['buttons'] });
  const before = s.draft.blocks.length;
  await go('m_buttons', 'modal', { fields: { lines: 'Bad | nonsense' } });
  assert.equal(s.draft.blocks.length, before); assert.equal(last()[0], 'reply'); assert.match(text(last()[1]), /Line 1/);
  // protected role is refused
  gaming.permissions = { any: () => true };
  await go('add', 'select', { values: ['buttons'] }); await go('m_buttons', 'modal', { fields: { lines: 'Admin | role:Gaming' } });
  assert.match(text(last()[1]), /staff or admin/); gaming.permissions = { any: () => false };

  // reorder: select block 3 (menu), move up, then delete a block
  await go('pick', 'select', { values: ['3'] }); await go('up', 'button'); assert.equal(s.draft.blocks[2].type, 'menu'); assert.equal(s.sel, 2);
  await go('down', 'button'); assert.equal(s.draft.blocks[3].type, 'menu');
  await go('dup', 'button'); assert.equal(s.draft.blocks.length, 5); assert.notEqual(s.draft.blocks[4].id, menuId);
  await go('del', 'button'); assert.equal(s.draft.blocks.length, 4);
  // edit opens a prefilled modal
  await go('pick', 'select', { values: ['2'] }); await go('edit', 'button'); assert.equal(last()[0], 'modal');
  // text above / below / style / identity / pings
  await go('m_above', 'modal', { fields: { content: 'New post for @{Gaming}' } }); assert.match(s.draft.above, /<@&111/);
  await go('m_style', 'modal', { fields: { accent: 'teal', banner: 'youtube', footer: 'yes' } }); assert.equal(s.draft.banner, 'youtube');
  await go('m_style', 'modal', { fields: { accent: 'teal', banner: 'zzz', footer: 'yes' } }); assert.match(text(last()[1]), /no banner called/);
  await go('pings', 'button'); assert.equal(s.draft.everyone, true); await go('pings', 'button'); assert.equal(s.draft.everyone, false);
  // preview, then a change refreshes it
  await go('preview', 'button'); assert.equal(last()[0], 'reply'); assert.ok(last()[1].flags & 64);
  // post flow
  await go('post', 'button'); assert.equal(s.view, 'post');
  await go('channel', 'channel', { channels: col([channel]) }); assert.equal(s.view, 'confirm');
  await go('confirm', 'button');
  assert.equal(s.mode, 'edit'); assert.equal(sent.length, 1); assert.equal(sent[0].allowedMentions.roles[0], ROLE);
  assert.deepEqual(sent[0].components.map((c) => c.toJSON().type), [10, 17]);
  assert.ok(store.posts.get('444444444444444444'));
  // edit in place
  await go('m_above', 'modal', { fields: { content: 'Edited' } }); await go('update', 'button');
  assert.equal(channel.messages.items.get('444444444444444444').components[0].toJSON().content, 'Edited');
  // template
  await go('m_template', 'modal', { fields: { name: 'Welcome' } }); assert.ok(store.templates.get('welcome'));
  // someone else cannot use this builder; an expired builder is explained
  log.length = 0; await handlers.handle({ ...fake(`embed:up:${s.id}`, 'button'), user: { id: 'other' } }); assert.match(text(last()[1]), /belongs to someone else/);
  log.length = 0; await handlers.handle(fake('embed:up:deadbeef', 'button')); assert.match(text(last()[1]), /expired/);
  // a non-admin loses access mid-session
  const lowly = { id: '999999999999999999', roles: { cache: col([]) }, permissions: { has: () => false } };
  log.length = 0; await handlers.handle({ ...fake(`embed:up:${s.id}`, 'button'), member: lowly, user: { id: ADMIN } }); assert.match(text(last()[1]), /Only staff/);

  // public side: role button and dropdown menu
  const member = { id: '888888888888888888', roles: { cache: memberRoles, add: memberRoles.add, remove: memberRoles.remove } };
  log.length = 0; await handlers.handle(fake(`embed:role:${ROLE}`, 'button', { member, user: { id: member.id } }));
  assert.ok(memberRoles.has(ROLE)); assert.match(text(last()[1]), /Added/);
  log.length = 0; await handlers.handle(fake(`embed:role:${ROLE}`, 'button', { member, user: { id: member.id } }));
  assert.ok(!memberRoles.has(ROLE)); assert.match(text(last()[1]), /Removed/);
  log.length = 0; await handlers.handle(fake(`embed:menu:${menuId}`, 'select', { member, user: { id: member.id }, values: ['1'], message: { id: '444444444444444444' } }));
  assert.match(text(last()[1]), /Welcome to the club/); assert.ok(memberRoles.has(ROLE));
  log.length = 0; await handlers.handle(fake(`embed:menu:${menuId}`, 'select', { member, user: { id: member.id }, values: ['0'], message: { id: '444444444444444444' } }));
  assert.match(text(last()[1]), /Be kind/);
  log.length = 0; await handlers.handle(fake('embed:menu:ffffff', 'select', { member, user: { id: member.id }, values: ['0'], message: { id: '444444444444444444' } }));
  assert.match(text(last()[1]), /no longer available/);
  // webhook identity posts through the webhook
  const s2 = sessions.create({ userId: ADMIN, guildId: 'G1' });
  const go2 = async (c, k, e) => { await handlers.handle(fake(`embed:${c}:${s2.id}`, k, e)); };
  await go2('add', 'select', { values: ['text'] }); await go2('m_text', 'modal', { fields: { content: 'From a webhook' } });
  await go2('m_identity', 'modal', { fields: { name: 'Amber News', avatar: 'https://a.co/a.png' } });
  await go2('post', 'button'); await go2('channel', 'channel', { channels: col([channel]) }); await go2('confirm', 'button');
  assert.equal(sent.at(-1).username, 'Amber News'); assert.equal(store.posts.get('555555555555555555').via, 'webhook');
});


test('the live preview opens beside the builder and follows every change', async () => {
  const s = sessions.create({ userId: ADMIN, guildId: 'G1' });
  const edits = []; let followed = null;
  const opener = { followUp: async (p) => { followed = p; return { id: 'PREVIEW1' }; }, webhook: { editMessage: async (id, p) => { edits.push([id, p]); } } };
  await handlers.openPreview(s, opener);
  assert.ok(followed.flags & 64, 'the preview is private');
  assert.match(text(followed), /Nothing to show yet/);                  // an empty draft says so instead of failing
  s.draft.blocks.push({ type: 'text', content: 'Hello there' });
  await handlers.refreshPreview(s);
  assert.equal(edits.length, 1);
  assert.equal(edits[0][0], 'PREVIEW1');
  assert.match(text(edits[0][1]), /Hello there/);
  assert.deepEqual(edits[0][1].attachments, []);
  const broken = sessions.create({ userId: ADMIN, guildId: 'G1' });
  broken.preview = { editReply: async () => { throw new Error('token expired'); } };
  await handlers.refreshPreview(broken);
  assert.equal(broken.preview, null, 'a preview that can no longer be edited is dropped, not retried forever');
});
