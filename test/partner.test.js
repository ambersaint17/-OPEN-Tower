const test = require('node:test');
const path = require('node:path');
const assert = require('node:assert/strict');
const lib = require('../src/lib/partner');

// ---------- the pure rules ----------
test('a pasted ad can never ping anyone by itself', () => {
  const clean = lib.sanitizeAd('Hello @everyone and @here! <@123456789012345678> <@&123456789012345678> join discord.gg/abc');
  assert.doesNotMatch(clean, /@everyone|@here|<@/);
  assert.match(clean, /discord\.gg\/abc/);
  assert.equal(lib.sanitizeAd('  a\r\nb  '), 'a\nb');
  assert.equal(lib.sanitizeAd('a\n\n\n\n\n\nb'), 'a\n\n\nb');
});

test('each ping choice is exactly what it says', () => {
  assert.deepEqual(lib.parsePing({}), { key: 'none', text: '', allowedMentions: { parse: [] }, label: 'no ping' });
  assert.deepEqual(lib.parsePing({ ping: 'here' }).allowedMentions, { parse: ['everyone'] });
  assert.equal(lib.parsePing({ ping: 'everyone' }).text, '@everyone');
  const role = lib.parsePing({ ping: 'everyone', roleId: '123' });
  assert.equal(role.key, 'role:123'); assert.deepEqual(role.allowedMentions, { parse: [], roles: ['123'] }); assert.equal(role.text, '<@&123>');
  assert.equal(lib.isLoudPing('everyone') && lib.isLoudPing('here'), true);
  assert.equal(lib.isLoudPing('role:1') || lib.isLoudPing('none'), false);
});

const good = { name: 'Cool Club', members: 500, expiresAt: null, maxUses: 0, nsfwLevel: 0 };
const vet = (over = {}) => lib.vet({ ad: 'A nice server. Join us!', invites: ['abc'], info: good, ...over });

test('a good partner passes, and every problem is reported in plain words', () => {
  const ok = vet(); assert.equal(ok.blocked, false); assert.equal(ok.warned, false); assert.equal(ok.findings[0].level, 'ok');
  assert.match(vet({ invites: [], info: null }).findings[0].text, /no Discord invite/);
  assert.equal(vet({ invites: [], info: null }).blocked, true);
  assert.match(vet({ info: null }).findings[0].text, /invalid or expired/);
  assert.match(vet({ info: { ...good, expiresAt: Date.now() + 1000 } }).findings.map((f) => f.text).join(' '), /expires/);
  assert.match(vet({ info: { ...good, maxUses: 5 } }).findings.map((f) => f.text).join(' '), /limited to 5 uses/);
  assert.match(vet({ info: { ...good, nsfwLevel: 3 } }).findings.map((f) => f.text).join(' '), /age-restricted/);
  const small = vet({ info: { ...good, members: 30 }, minMembers: 100 });
  assert.equal(small.warned, true); assert.equal(small.blocked, false);
  assert.match(small.findings[0].text, /30 members, below your minimum of 100/);
  assert.equal(vet({ minMembers: 100 }).warned, false);
  assert.match(vet({ invites: ['a', 'b'] }).findings.map((f) => f.text).join(' '), /2 invite links/);
  assert.match(vet({ alreadyPartnered: true }).findings.map((f) => f.text).join(' '), /already has an active partnership/);
  assert.match(vet({ ad: 'this has a fuck word', bannedWords: ['fuck'] }).findings.map((f) => f.text).join(' '), /banned list/);
  assert.equal(vet({ ad: 'x'.repeat(4000) }).blocked, true);
  assert.equal(lib.serverName({ name: 'From Invite' }, 'Typed'), 'From Invite');
  assert.equal(lib.serverName(null, ' Typed '), 'Typed');
  assert.equal(lib.serverName(null, ''), 'Partner Server');
});

// ---------- the whole flow, with fakes ----------
const rows = new Map(); const blacklist = new Map(); const stickyIds = new Map(); let nextId = 1;
const state = { settings: { channel_id: 'PC', min_members: 0, partner_role_id: null, our_ad: '', sticky_enabled: true, sticky_channels: [] } };
const fakeService = {
  getSettings: async () => ({ guildId: 'G', ...state.settings }), saveSettings: async (g, s) => { state.settings = s; },
  create: async (p) => { const r = { id: nextId++, guild_id: p.guildId, server_name: p.serverName, invite_code: p.inviteCode, invite_guild_id: p.inviteGuildId, member_count: p.memberCount, rep_user_id: p.repUserId, posted_by: p.postedBy, ad_text: p.adText, ping: p.ping, channel_id: p.channelId, message_id: p.messageId, ticket_channel_id: p.ticketChannelId, status: 'active', created_at: new Date(), end_reason: '', reciprocated: false }; rows.set(r.id, r); return { ...r }; },
  get: async (id) => (rows.has(id) ? { ...rows.get(id) } : null), list: async () => [...rows.values()],
  activeForInviteGuild: async (g, ig) => [...rows.values()].find((r) => r.invite_guild_id === ig && r.status === 'active') ?? null,
  end: async (id, reason) => { const r = rows.get(id); if (!r || r.status !== 'active') return null; r.status = 'ended'; r.end_reason = reason; return { ...r }; },
  getBlacklisted: async (g, id) => blacklist.get(id) ?? null, addBlacklist: async (b) => { blacklist.set(b.serverId, { server_id: b.serverId, name: b.name, reason: b.reason }); return b; }, removeBlacklist: async (g, id) => blacklist.delete(id), listBlacklist: async () => [...blacklist.values()],
  setReciprocated: async (id, done, proof) => { const r = rows.get(id); r.reciprocated = done; r.reciprocal_proof = proof; return { ...r }; },
  dueForReciprocityReminder: async () => [...rows.values()].filter((r) => r.status === 'active' && !r.reciprocated && !r.reminded), markReciprocityReminded: async (id) => { rows.get(id).reminded = true; },
  getSticky: async (g, c) => stickyIds.get(c) ?? null, setSticky: async (g, c, m) => { stickyIds.set(c, m); },
  repHasOtherActive: async (g, rep, except) => [...rows.values()].some((r) => r.rep_user_id === rep && r.status === 'active' && r.id !== except),
};
const put = (rel, exports) => { const p = path.join(__dirname, '..', rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
put('src/modules/partner/service.js', fakeService);
put('src/modules/automod/service.js', { getWords: async () => ['fuck'] });
const logger = require('../src/modules/logging/logger'); logger.log = async () => {};
const actions = require('../src/modules/partner/actions');
const handlers = require('../src/modules/partner/handlers');
const views = require('../src/modules/partner/views');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

const flat = (p) => JSON.stringify((p.components ?? [p]).map((c) => (c.toJSON ? c.toJSON() : c)));
const col = (items) => Object.assign(new Map(items.map((i) => [i.id, i])), { find(fn) { return [...this.values()].find(fn); }, some(fn) { return [...this.values()].some(fn); } });
const sent = []; const deleted = []; const ticketSent = [];
const partnerChannel = { id: 'PC', name: '🤝｜partnerships', type: ChannelType.GuildText, permissionsFor: () => ({ has: () => true }), send: async (p) => { sent.push(p); return { id: `m${sent.length}` }; }, messages: { delete: async (id) => { deleted.push(id); } } };
const ticketChannel = { id: 'TK', send: async (p) => { ticketSent.push(p); } };
const roleP = { id: 'RP', name: 'Partner', position: 3, managed: false };
const repMember = (roleHeld = false) => ({ id: 'rep1', roles: { cache: new Map(roleHeld ? [['RP', roleP]] : []), add: async (r) => { repMember.added.push(r.id); repMember.held = true; }, remove: async (r) => { repMember.removed.push(r.id); } } });
repMember.added = []; repMember.removed = [];
const members = new Map();
const guild = { id: 'G', ownerId: 'owner', members: { me: { roles: { highest: { position: 50 } } }, fetch: async (id) => { if (!members.has(id)) throw new Error('x'); return members.get(id); } },
  channels: { cache: col([partnerChannel]), fetch: async (id) => (id === 'PC' ? partnerChannel : null) }, roles: { cache: col([roleP]) } };
const invites = { abc: { guild: { id: 'S1', name: 'Cool Club', iconURL: () => 'https://cdn/icon.png', nsfwLevel: 0 }, memberCount: 480, expiresTimestamp: null, maxUses: 0 } };
const client = { fetchInvite: async (code) => { if (!invites[code]) throw new Error('Unknown Invite'); return invites[code]; }, channels: { fetch: async (id) => (id === 'TK' ? ticketChannel : null) } };
const admin = { id: 'admin1', roles: { cache: col([]) }, permissions: { has: (p) => p === PermissionFlagsBits.Administrator }, guild };
const nobody = { id: 'nobody', roles: { cache: col([]) }, permissions: { has: () => false }, guild };

function submit(form, ad, { name = '', member = admin } = {}) {
  const token = actions.holdForm({ userId: member.id, ping: 'none', roleId: null, repId: null, style: 'card', ticketChannelId: null, ...form });
  const out = [];
  return { out, i: { customId: `partner:ad:${token}`, guild, guildId: 'G', member, user: { id: member.id }, client, isModalSubmit: () => true, isButton: () => false, deferred: false, replied: false,
    deferReply: async () => {}, editReply: async (p) => out.push(p), followUp: async (p) => out.push(p), reply: async (p) => out.push(p), fields: { getTextInputValue: (k) => (k === 'ad' ? ad : name) } } };
}
const AD = 'Welcome to Cool Club! We are a friendly gaming community with events every week and great people. Join here: discord.gg/abc';

test('a clean ad with no ping is posted straight away as a card with a Join button', async () => {
  const { i, out } = submit({}, AD);
  await handlers.handle(i);
  assert.equal(sent.length, 1);
  const post = flat(sent[0]);
  assert.match(post, /Cool Club/); assert.match(post, /friendly gaming community/);
  assert.match(post, /https:\/\/discord\.gg\/abc/);                      // the Join button
  assert.match(post, /👇/);                                                // the link in the text became a pointer to it
  assert.doesNotMatch(JSON.stringify(sent[0].components[0].toJSON().components.filter((c) => c.type === 10)), /discord\.gg\/abc/, 'no raw invite left in the text');
  assert.match(post, /attachment:\/\/tower-banner-partner\.png/);
  assert.match(post, /480/);                                              // members, from the invite
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.equal(sent[0].components.length, 1, 'no ping line');
  assert.match(flat(out[0]), /Ad Posted/);
  assert.equal(rows.get(1).server_name, 'Cool Club');
  assert.equal(rows.get(1).invite_guild_id, 'S1');
});

test('pings inside the pasted ad are neutralised, and a role ping goes out quietly', async () => {
  invites.xyz = { guild: { id: 'S2', name: 'Role Land', iconURL: () => null, nsfwLevel: 0 }, memberCount: 90, expiresTimestamp: null, maxUses: 0 };
  const { i } = submit({ roleId: '123456789012345678' }, 'Hey @everyone, come and see Role Land! It is a lovely place to chat all day. discord.gg/xyz');
  await handlers.handle(i);
  const post = sent.at(-1);
  assert.doesNotMatch(flat(post), /"content":"@everyone/);
  assert.deepEqual(post.allowedMentions, { parse: [], roles: ['123456789012345678'] });
  assert.equal(post.components[0].toJSON().content, '<@&123456789012345678>', 'the ping sits above the card');
});

test('@everyone and @here wait for a confirmation, and Post sends them', async () => {
  invites.big = { guild: { id: 'S3', name: 'Big Server', iconURL: () => null, nsfwLevel: 0 }, memberCount: 9000, expiresTimestamp: null, maxUses: 0 };
  const before = sent.length;
  const { i, out } = submit({ ping: 'everyone' }, 'Big Server is the biggest community around, with something for everyone. discord.gg/big');
  await handlers.handle(i);
  assert.equal(sent.length, before, 'nothing is posted before the button');
  const preview = flat(out[0]);
  assert.match(preview, /Check Before Posting/); assert.match(preview, /@everyone/);
  const token = /partner:go:(\w+)/.exec(preview)[1];
  const press = { customId: `partner:go:${token}`, guild, guildId: 'G', member: admin, user: { id: 'admin1' }, client, isModalSubmit: () => false, isButton: () => true, deferUpdate: async () => {}, editReply: async (p) => out.push(p), reply: async (p) => out.push(p), followUp: async (p) => out.push(p) };
  await handlers.handle(press);
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1).components[0].toJSON().content, '@everyone');
  assert.deepEqual(sent.at(-1).allowedMentions, { parse: ['everyone'] });
  await handlers.handle(press);                                          // the same button again does nothing
  assert.equal(sent.length, before + 1);
  assert.match(flat(out.at(-1)), /expired/);
});

test('a bad invite blocks the ad, and the Post button is disabled', async () => {
  const before = sent.length;
  const { i, out } = submit({}, 'Dead Server is great and has many members to talk to every day. discord.gg/dead');
  await handlers.handle(i);
  assert.equal(sent.length, before);
  const preview = flat(out[0]);
  assert.match(preview, /Cannot Be Posted Yet/); assert.match(preview, /invalid or expired/);
  assert.match(preview, /"disabled":true/);
  const none = submit({}, 'No invite anywhere in this advertisement, which is rather long and chatty.');
  await handlers.handle(none.i);
  assert.match(flat(none.out[0]), /no Discord invite/);
});

test('warnings (a small server, a banned word, a duplicate) ask for a look before posting', async () => {
  state.settings.min_members = 1000;
  const before = sent.length;
  invites.tiny = { guild: { id: 'S4', name: 'Tiny', iconURL: () => null, nsfwLevel: 0 }, memberCount: 20, expiresTimestamp: null, maxUses: 0 };
  const a = submit({}, 'Tiny is a cosy little place for friends to hang out and play together. discord.gg/tiny');
  await handlers.handle(a.i);
  assert.equal(sent.length, before); assert.match(flat(a.out[0]), /below your minimum of 1,000/);
  state.settings.min_members = 0;
  const b = submit({}, 'Cool Club is back again with the same fine people and events. discord.gg/abc');
  await handlers.handle(b.i);
  assert.match(flat(b.out[0]), /already has an active partnership/);
  const c = submit({}, 'Tiny is a fuck of a good time for friends and games all week. discord.gg/tiny');
  await handlers.handle(c.i);
  assert.match(flat(c.out[0]), /banned list/);
});

test('plain style posts the ad as written, and refuses one that is too long', async () => {
  invites.plain = { guild: { id: 'S5', name: 'Plain Place', iconURL: () => null, nsfwLevel: 0 }, memberCount: 300, expiresTimestamp: null, maxUses: 0 };
  const { i } = submit({ style: 'plain', ping: 'none' }, 'Plain Place is simple and friendly, with lots of chat. discord.gg/plain');
  await handlers.handle(i);
  assert.match(sent.at(-1).content, /^Plain Place is simple/);
  assert.equal(sent.at(-1).components, undefined, 'a classic message, so Discord shows the invite preview');
  const long = submit({ style: 'plain' }, `${'x'.repeat(2000)} discord.gg/plain`);
  await handlers.handle(long.i);
  assert.match(flat(long.out[0]), /plain text ad is limited/);
});

test('inside a ticket the representative gets the Partner role and the ticket is told', async () => {
  invites.tk = { guild: { id: 'S6', name: 'Ticket Land', iconURL: () => null, nsfwLevel: 0 }, memberCount: 800, expiresTimestamp: null, maxUses: 0 };
  members.set('rep1', repMember());
  const { i, out } = submit({ repId: 'rep1', ticketChannelId: 'TK' }, 'Ticket Land is where good people gather to talk and play every day. discord.gg/tk');
  await handlers.handle(i);
  assert.deepEqual(repMember.added, ['RP']);
  assert.match(flat(ticketSent.at(-1)), /Your Advertisement Is Live/);
  assert.deepEqual(ticketSent.at(-1).allowedMentions, { parse: [] });
  assert.match(flat(sent.at(-1)), /rep1/, 'the card names the representative');
  assert.match(flat(out[0]), /Ad Posted/);
});

test('ending a partnership removes the ad and the Partner role, once', async () => {
  const row = [...rows.values()].find((r) => r.invite_code === 'tk');
  members.set('rep1', repMember(true));
  const settings = await fakeService.getSettings();
  const result = await actions.endPartnership({ guild, row: { ...row }, reason: 'Inactive', deleteAd: true, settings });
  assert.equal(result.removed, true); assert.deepEqual(deleted.at(-1), row.message_id);
  assert.deepEqual(repMember.removed, ['RP']);
  assert.equal(rows.get(row.id).status, 'ended');
  await assert.rejects(actions.endPartnership({ guild, row: { ...row }, reason: '', deleteAd: true, settings }), /already ended/);
});

test('the partnership channel is the chosen one, a matching name, or a clear error', async () => {
  assert.equal((await actions.resolveChannel(guild, { channel_id: 'PC' })).id, 'PC');
  assert.equal((await actions.resolveChannel(guild, { channel_id: null })).id, 'PC', 'found by its name');
  const lonely = { ...guild, channels: { cache: col([]), fetch: async () => null } };
  await assert.rejects(actions.resolveChannel(lonely, { channel_id: null }), /no partnership channel/);
  const noPerm = { ...partnerChannel, permissionsFor: () => ({ has: (p) => p !== PermissionFlagsBits.EmbedLinks }) };
  await assert.rejects(actions.resolveChannel({ ...guild, channels: { cache: col([noPerm]), fetch: async () => noPerm } }, { channel_id: 'PC' }), /missing Embed Links/);
});

test('only administrators can use the partner form, and expired forms are explained', async () => {
  const denied = submit({}, AD, { member: nobody });
  await handlers.handle(denied.i);
  assert.match(flat(denied.out[0]), /Only staff|not allowed/);
  const stale = { ...submit({}, AD).i, customId: 'partner:ad:nosuchtoken' };
  const out = []; stale.reply = async (p) => out.push(p); stale.followUp = async (p) => out.push(p);
  await handlers.handle(stale);
  assert.match(flat(out[0]), /expired/);
});

test('the list, info and settings cards read well', () => {
  const row = { id: 7, guild_id: 'G', server_name: 'Cool Club', invite_code: 'abc', member_count: 480, rep_user_id: 'rep1', posted_by: 'admin1', ad_text: 'Hello\nworld', status: 'active', created_at: new Date(), channel_id: 'PC', message_id: 'm1', ticket_channel_id: 'TK', end_reason: '' };
  assert.match(flat(views.listCard([row])), /Cool Club/);
  assert.match(flat(views.infoCard(row, 'https://x')), /discord\.gg\/abc/);
  assert.match(flat(views.setupCard({ min_members: 100, our_ad: 'x', partner_role_id: null }, partnerChannel, null)), /Minimum Members/);
  assert.match(flat(views.ourAd('Join us!')), /Join us!/);
  assert.match(flat(views.ourAd('')), /No ad saved yet/);
});


// ---------- pictures ----------
const image = (type = 'image/png', size = 2048) => ({ ok: true, status: 200, headers: { get: () => type }, arrayBuffer: async () => new ArrayBuffer(size) });
const prep = (over = {}) => actions.prepare({ client, guild, settings: state.settings, ad: AD, typedName: '', ping: 'none', roleId: null, repId: null, style: 'card', ticketChannelId: null, actorId: 'admin1', ...over });

test('pictures sent with the command are copied and shown inside the card', async () => {
  const p = await prep({ attachments: [{ url: 'https://cdn/x.png', name: 'banner.png', size: 1000 }], fetchImpl: async () => image() });
  assert.equal(p.files.length, 1); assert.equal(p.files[0].name, 'ad-1.png');
  const payload = views.adPayload({ name: 'X', ad: p.ad, code: 'abc', images: p.images, files: p.files }, p.ping, 'card');
  assert.match(flat(payload), /attachment:\/\/ad-1\.png/);
  assert.equal(payload.files.length, 2, 'the picture and the banner');
});

test('picture links in the ad are lifted out and shown, and Discord links are copied because they expire', async () => {
  const p = await prep({ ad: `${AD}\nhttps://i.imgur.com/pic.png\nhttps://cdn.discordapp.com/attachments/1/2/shot.jpg?ex=1&hm=2`, fetchImpl: async () => image('image/jpeg') });
  assert.doesNotMatch(p.ad, /imgur|discordapp/, 'the links are gone from the text');
  assert.deepEqual(p.images.map((i) => i.name ?? i.url).sort(), ['ad-1.jpg', 'https://i.imgur.com/pic.png']);
  const card = JSON.stringify(views.adPayload({ name: 'X', ad: p.ad, code: 'abc', images: p.images, files: p.files }, p.ping, 'card').components.map((c) => c.toJSON()));
  assert.match(card, /i\.imgur\.com\/pic\.png/);
});

test('a picture that cannot be used is reported, not silently dropped', async () => {
  const bad = await prep({ attachments: [{ url: 'https://cdn/x.pdf', name: 'doc.pdf', size: 10 }], fetchImpl: async () => image('application/pdf') });
  assert.equal(bad.vetting.warned, true); assert.match(bad.vetting.findings.map((f) => f.text).join(' '), /doc\.pdf.*not a PNG/);
  const big = await prep({ attachments: [{ url: 'https://cdn/x.png', name: 'huge.png', size: 50 * 1024 * 1024 }], fetchImpl: async () => image() });
  assert.match(big.vetting.findings.map((f) => f.text).join(' '), /larger than 8 MB/);
  const many = await prep({ attachments: [1, 2, 3, 4, 5].map((n) => ({ url: `https://cdn/${n}.png`, name: `${n}.png`, size: 10 })), fetchImpl: async () => image() });
  assert.equal(many.images.length, 4);
});

test('plain ads keep their links and pictures as written, and the invite can be kept in a card on request', async () => {
  const plain = await prep({ style: 'plain', ad: `${AD}\nhttps://i.imgur.com/pic.png` });
  assert.match(plain.ad, /discord\.gg\/abc/); assert.match(plain.ad, /imgur/);
  const kept = await prep({ keepLink: true });
  assert.match(kept.ad, /discord\.gg\/abc/); assert.doesNotMatch(kept.ad, /👇/);
});

// ---------- the blacklist ----------
test('a blacklisted server is blocked whatever invite it uses, and ending can blacklist it', async () => {
  blacklist.set('S1', { server_id: 'S1', name: 'Cool Club', reason: 'Scam server' });
  const p = await prep();
  assert.equal(p.vetting.blocked, true); assert.match(p.vetting.findings.map((f) => f.text).join(' '), /blacklist: Scam server/);
  blacklist.clear();
  assert.equal((await actions.resolveServer(client, '123456789012345678')).id, '123456789012345678');
  assert.deepEqual(await actions.resolveServer(client, 'https://discord.gg/abc'), { id: 'S1', name: 'Cool Club' });
  assert.equal((await actions.resolveServer(client, 'abc')).id, 'S1');
  await assert.rejects(actions.resolveServer(client, 'discord.gg/nope'), /invalid or expired/);
  await assert.rejects(actions.resolveServer(client, '!!'), /server ID, an invite/);
  const row = [...rows.values()].find((r) => r.status === 'active');
  const result = await actions.endPartnership({ guild, row: { ...row }, reason: 'Spam', deleteAd: false, settings: state.settings, blacklist: true, by: 'admin1' });
  assert.equal(result.blacklisted, true); assert.equal(blacklist.get(row.invite_guild_id).reason, 'Spam');
});

// ---------- reciprocity ----------
test('Tower reminds the person who posted an ad when the partner has not posted ours, and the button records it', async () => {
  const row = await fakeService.create({ guildId: 'G', serverName: 'Waiting', inviteCode: 'w', inviteGuildId: 'S9', memberCount: 10, repUserId: null, postedBy: 'admin1', adText: 'x', ping: 'none', channelId: 'PC', messageId: 'mm', ticketChannelId: null });
  const dms = []; const c = { users: { fetch: async () => ({ send: async (p) => { dms.push(p); } }) }, guilds: { cache: new Map() } };
  await actions.tickReciprocity(c);
  assert.ok(dms.length >= 1);
  assert.match(flat(dms.at(-1)), /Have They Posted Our Ad/); assert.match(flat(dms.at(-1)), new RegExp(`partner:recip:${row.id}`));
  const before = dms.length; await actions.tickReciprocity(c); assert.equal(dms.length, before, 'asked once per period');

  const press = (userId) => { const out = []; return { out, i: { customId: `partner:recip:${row.id}`, user: { id: userId }, isButton: () => true, isModalSubmit: () => false, update: async (p) => out.push(p), reply: async (p) => out.push(p) } }; };
  const stranger = press('someone'); await handlers.handle(stranger.i);
  assert.match(flat(stranger.out[0]), /Only the person who posted/); assert.equal(rows.get(row.id).reciprocated, false);
  const owner = press('admin1'); await handlers.handle(owner.i);
  assert.match(flat(owner.out[0]), /Marked As Posted/); assert.equal(rows.get(row.id).reciprocated, true);
  assert.match(flat(views.listCard([{ ...rows.get(row.id), created_at: new Date() }])), /posted our ad/);
  assert.match(flat(views.listCard([{ ...rows.get(row.id), reciprocated: false, created_at: new Date(Date.now() - 20 * 86_400_000) }])), /has not posted our ad/);
});

// ---------- the sticky mute message ----------
test('the mute guide stays at the bottom of the partnership channel, replacing the old one', async () => {
  const sticky = require('../src/modules/partner/sticky'); const { partners: cfg } = require('../src/constants');
  cfg.sticky.debounceMs = 10; sticky.forget('G');
  const posts = []; const removed = [];
  const channel = { id: 'PC', name: 'partnerships', guild, send: async (p) => { posts.push(p); return { id: `s${posts.length}` }; }, messages: { delete: async (id) => { removed.push(id); } } };
  const msg = (id, channelId = 'PC') => ({ id, guild, channelId, channel: { ...channel, id: channelId }, system: false });
  await sticky.onMessage(msg('a1')); await sticky.onMessage(msg('a2'));            // a burst is handled once
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(posts.length, 1);
  const text = flat(posts[0]);
  assert.match(text, /Tired of getting pings from this channel/); assert.match(text, /Mute Channel/); assert.match(text, /<#PC>/);
  assert.match(text, /attachment:\/\/partner-mute-guide\.png/);
  assert.ok(posts[0].files.some((f) => f.name === 'partner-mute-guide.png'), 'the picture is attached');
  assert.deepEqual(posts[0].allowedMentions, { parse: [] });

  await sticky.onMessage(msg('s1'));                                              // its own message does not trigger another
  await new Promise((r) => setTimeout(r, 40)); assert.equal(posts.length, 1);
  await sticky.onMessage(msg('a3'));                                              // a new ad: replaced
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(posts.length, 2); assert.deepEqual(removed, ['s1']);
  await sticky.onMessage(msg('x1', 'OTHER')); await new Promise((r) => setTimeout(r, 40));
  assert.equal(posts.length, 2, 'other channels are left alone');
  state.settings.sticky_enabled = false; sticky.forget('G');
  await sticky.onMessage(msg('a4')); await new Promise((r) => setTimeout(r, 40));
  assert.equal(posts.length, 2, 'off means off');
});
