const test = require('node:test');
const { SeparatorSpacingSize } = require('discord.js');
const assert = require('node:assert/strict');
const embed = require('../src/lib/embed');
const render = require('../src/modules/embed/render');
const safety = require('../src/modules/embed/safety');
const handlers = require('../src/modules/embed/handlers');
const sessions = require('../src/modules/embed/session');

const draftWith = (blocks, extra = {}) => ({ ...embed.newDraft(), blocks, ...extra });
const json = (payload) => payload.components.map((c) => c.toJSON());
const ROLE = '1565048876933578999';

// ---------- parsing ----------
test('buttons are read one per line, as links or as role buttons', () => {
  const r = embed.parseButtons('Watch | https://youtu.be/x | ▶️\nGamer | role:Gaming | 🎮\nDocs | https://example.com');
  assert.deepEqual(r.errors, []);
  assert.equal(r.buttons.length, 3);
  assert.deepEqual(r.buttons[0], { label: 'Watch', url: 'https://youtu.be/x', emoji: '▶️' });
  assert.deepEqual(r.buttons[1], { label: 'Gamer', role: 'Gaming', emoji: '🎮' });
  assert.equal(r.buttons[2].emoji, null);
});

test('bad button lines are reported with their line number', () => {
  assert.match(embed.parseButtons('Go | not a link').errors[0], /Line 1/);
  assert.match(embed.parseButtons('Go | https://x.com | nope').errors[0], /not an emoji/);
  assert.match(embed.parseButtons(' | https://x.com').errors[0], /label or an emoji/);
  assert.match(embed.parseButtons('').errors[0], /at least one/);
  assert.match(embed.parseButtons('1|https://a.com\n2|https://a.com\n3|https://a.com\n4|https://a.com\n5|https://a.com\n6|https://a.com').errors[0], /at most 5/);
  assert.equal(embed.parseButtons('Go | javascript:alert(1)').errors.length, 1);
});

test('custom emoji are understood', () => {
  assert.deepEqual(embed.parseEmoji('<:tower:123456789012345678>'), { id: '123456789012345678', name: 'tower', animated: false });
  assert.equal(embed.parseEmoji('<a:wave:123456789012345678>').animated, true);
  assert.equal(embed.parseEmoji(''), null);
  assert.equal(embed.parseEmoji('hello'), undefined);
  assert.equal(embed.emojiText({ id: '1', name: 'x', animated: true }), '<a:x:1>');
});

test('a dropdown menu pairs each option with its reply', () => {
  const r = embed.parseMenu({
    placeholder: '', options: 'Rules | Read first | 📜\nRoles | Pick one | | role:Gamer\nHelp',
    replies: 'Be kind.\nNo spam.\n---\n\n---\nAsk in #help',
  });
  assert.deepEqual(r.errors, []);
  assert.equal(r.placeholder, 'Choose an option');
  assert.equal(r.options[0].reply, 'Be kind.\nNo spam.');
  assert.equal(r.options[1].role, 'Gamer');
  assert.equal(r.options[1].reply, '');         // a role alone is enough
  assert.equal(r.options[2].reply, 'Ask in #help');
});

test('menu mistakes are explained', () => {
  assert.match(embed.parseMenu({ options: 'Only', replies: '' }).errors[0], /needs a reply/);
  assert.match(embed.parseMenu({ options: 'A', replies: 'x\n---\ny' }).errors.join(' '), /2 replies for 1 options/);
  assert.match(embed.parseMenu({ options: 'A | d | | gamer', replies: 'x' }).errors[0], /role:RoleName/);
  assert.match(embed.parseMenu({ options: '', replies: '' }).errors[0], /at least one option/);
  assert.match(embed.parseMenu({ options: `A\n`.repeat(26), replies: 'x' }).errors[0], /at most 25/);
});

test('colours accept names, hex codes and none', () => {
  assert.equal(embed.parseColour('Teal'), 0x2a8c99);
  assert.equal(embed.parseColour('#FF0000'), 0xff0000);
  assert.equal(embed.parseColour('0x00ff00'), 0x00ff00);
  assert.equal(embed.parseColour('none'), null);
  assert.equal(embed.parseColour('purplish'), undefined);
  assert.equal(embed.parseColour(''), undefined);
});

// ---------- limits ----------
test('size is counted the way Discord counts it', () => {
  const d = draftWith([{ type: 'text', content: 'hello' }, { type: 'separator', divider: true, size: 'small' }], { above: 'hey' });
  // container 1 + footer 2 + text 1 + separator 1 + above 1
  assert.equal(embed.countComponents(d), 6);
  assert.equal(embed.countText(d), 'hello'.length + 'hey'.length + 60);
  assert.equal(embed.countComponents(draftWith([{ type: 'buttons', buttons: [{ label: 'a', url: 'https://a.co' }, { label: 'b', url: 'https://b.co' }] }])), 1 + 2 + 3);
  assert.equal(embed.countComponents(draftWith([{ type: 'menu', id: 'abcdef', placeholder: 'x', options: [{ label: 'a', reply: 'b' }] }], { footer: false })), 3);
  assert.equal(embed.countComponents(draftWith([], { above: 'only text' })), 1);   // no card at all
});

test('too much for one message is refused', () => {
  const rows = Array.from({ length: 10 }, () => ({ type: 'buttons', buttons: Array.from({ length: 5 }, () => ({ label: 'x', url: 'https://x.co' })) }));
  assert.match(embed.validateDraft(draftWith(rows)).hard[0], /components/);
  assert.match(embed.validateDraft(draftWith([{ type: 'text', content: 'x'.repeat(3500) }, { type: 'text', content: 'y'.repeat(600) }])).hard[0], /characters/);
  assert.deepEqual(embed.validateDraft(draftWith([{ type: 'text', content: 'fine' }])).hard, []);
  assert.match(embed.validateDraft(embed.newDraft()).soft[0], /at least one block/);
});

// ---------- mentions ----------
test('only what is written can ping, and everyone only when allowed', () => {
  const d = draftWith([{ type: 'text', content: `Hi <@&${ROLE}> and <@123456789012345678>, @everyone` }]);
  assert.deepEqual(embed.mentionsOf(d), { roles: [ROLE], users: ['123456789012345678'], everyone: true });
  assert.deepEqual(embed.allowedMentionsFor(d), { parse: [], roles: [ROLE], users: ['123456789012345678'] });
  assert.deepEqual(embed.allowedMentionsFor({ ...d, everyone: true }).parse, ['everyone']);
});

test('@{Role}, @{Member} and #{channel} become real mentions, and unknown names are refused', () => {
  const find = (list) => (fn) => list.find(fn);
  const guild = {
    id: '1',
    roles: { cache: Object.assign(new Map([[ROLE, { id: ROLE, name: 'YouTube Ping' }]]), { find(fn) { return [...this.values()].find(fn); } }) },
    channels: { cache: { find: find([{ id: '555555555555555555', name: '📜｜rules' }]) } },
    members: { cache: { find: find([{ id: '777777777777777777', displayName: 'Amber', user: { username: 'amber_saint17' } }]) } },
  };
  assert.equal(handlers.expandMentions(guild, 'Hey @{YouTube Ping}, read #{rules}, thanks @{Amber} @{everyone}'),
    `Hey <@&${ROLE}>, read <#555555555555555555>, thanks <@777777777777777777> @everyone`);
  assert.throws(() => handlers.expandMentions(guild, 'Hi @{Nobody}'), /Nobody/);
  assert.equal(handlers.expandMentions(guild, 'plain text, no tokens'), 'plain text, no tokens');
});

// ---------- saved data ----------
test('anything read back from the database is cleaned', () => {
  const d = embed.sanitizeDraft({
    accent: 'red', banner: 'nope', above: 5, everyone: 'yes', identity: { name: 'N', avatar: 'javascript:x' },
    blocks: [
      { type: 'evil' }, { type: 'text', content: '' }, { type: 'text', content: 'ok' },
      { type: 'image', items: [{ url: 'ftp://x' }, { url: 'https://a.co/i.png' }] },
      { type: 'buttons', buttons: [{ label: 'x', url: 'javascript:1' }, { label: 'y', roleId: 7 }] },
      { type: 'menu', options: [{ label: 'A', reply: 'r' }] },
      null, 'string',
    ],
  });
  assert.equal(d.accent, embed.newDraft().accent);
  assert.equal(d.banner, null);
  assert.equal(d.above, '');
  assert.equal(d.everyone, false);
  assert.equal(d.identity.avatar, '');
  assert.deepEqual(d.blocks.map((b) => b.type), ['text', 'image', 'buttons', 'menu']);
  assert.deepEqual(d.blocks[1].items, [{ url: 'https://a.co/i.png' }]);
  assert.deepEqual(d.blocks[2].buttons, [{ label: 'y', emoji: null, roleId: '7' }]);
  assert.match(d.blocks[3].id, /^[0-9a-f]{6}$/);
  assert.equal(embed.sanitizeDraft(null).blocks.length, 0);
});

test('templates keep links but not uploads', () => {
  const d = draftWith([
    { type: 'image', items: [{ url: 'https://a.co/1.png' }, { upload: 'img-1.png' }] },
    { type: 'image', items: [{ upload: 'img-2.png' }] },
    { type: 'section', content: 'hi', thumb: { upload: 'img-3.png' } },
    { type: 'file', upload: 'doc.pdf' },
    { type: 'text', content: 'keep' },
  ]);
  const { draft, dropped } = embed.stripUploads(d);
  assert.equal(dropped, 4);
  assert.deepEqual(draft.blocks.map((b) => b.type), ['image', 'section', 'text']);
  assert.equal(draft.blocks[0].items.length, 1);
  assert.equal(draft.blocks[1].thumb, null);
  assert.equal(d.blocks.length, 5);   // the original is untouched
  assert.equal(embed.uploadNamesUsed(d).size, 4);
});

test('every block type has a readable summary', () => {
  const samples = [
    { type: 'text', content: '**bold** `code`' }, { type: 'separator', divider: false, size: 'large' },
    { type: 'image', items: [{ url: 'https://a.co/i.png' }] }, { type: 'section', content: 'x', thumb: null },
    { type: 'buttons', buttons: [{ label: 'A', url: 'https://a.co' }] }, { type: 'menu', id: 'abcdef', placeholder: 'p', options: [{ label: 'o', reply: 'r' }] },
    { type: 'file', upload: 'a.pdf' },
  ];
  for (const b of samples) assert.ok(embed.blockSummary(b).length > 3, b.type);
  assert.equal(embed.snippet('a'.repeat(100), 10).length, 10);
});

// ---------- the finished message ----------
test('text outside the card is a plain text block above or below it', () => {
  const built = render.build(draftWith([{ type: 'text', content: 'Inside' }], { above: 'Before', below: 'After' }));
  assert.deepEqual(built.components.map((c) => c.toJSON().type), [10, 17, 10]);
  assert.equal(built.components[0].toJSON().content, 'Before');
  assert.equal(built.components[2].toJSON().content, 'After');
  assert.ok(built.flags & (1 << 15));
});

test('with no card blocks there is no card at all, only the text', () => {
  const built = render.build(draftWith([], { above: 'Just a line', footer: true }));
  assert.deepEqual(built.components.map((c) => c.toJSON().type), [10]);
});

test('blocks keep the order they were given, and the footer closes the card', () => {
  const built = render.build(draftWith([
    { type: 'text', content: 'one' }, { type: 'separator', divider: true, size: 'large' },
    { type: 'image', items: [{ url: 'https://a.co/i.png' }] }, { type: 'text', content: 'two' },
  ]));
  const parts = built.components[0].toJSON().components;
  assert.deepEqual(parts.map((p) => p.type), [10, 14, 12, 10, 14, 10]);   // text, separator, gallery, text, footer divider, footer
  assert.equal(parts[1].spacing, SeparatorSpacingSize.Large);
  assert.match(parts.at(-1).content, /Powered by/);
  assert.equal(parts[2].items[0].media.url, 'https://a.co/i.png');
});

test('the banner, accent and footer follow the style choices', () => {
  const on = render.build(draftWith([{ type: 'text', content: 'x' }], { banner: 'youtube', accent: 0x123456 }));
  assert.equal(on.components[0].toJSON().accent_color, 0x123456);
  assert.ok(on.files.some((f) => f.name === 'tower-banner-youtube.png'));
  assert.equal(on.components[0].toJSON().components[0].items[0].media.url, 'attachment://tower-banner-youtube.png');
  const off = render.build(draftWith([{ type: 'text', content: 'x' }], { accent: null, footer: false }));
  assert.equal(off.components[0].toJSON().accent_color, undefined);
  assert.equal(off.components[0].toJSON().components.length, 1);
});

test('role buttons work when posted and are disabled in the preview', () => {
  const d = draftWith([{ type: 'buttons', buttons: [{ label: 'Docs', url: 'https://a.co' }, { label: 'Gamer', roleId: ROLE }] }]);
  const row = (built) => built.components[0].toJSON().components.find((c) => c.type === 1).components;
  const live = row(render.build(d)); const dry = row(render.build(d, { preview: true }));
  assert.equal(live[0].url, 'https://a.co');
  assert.equal(live[1].custom_id, `embed:role:${ROLE}`);
  assert.ok(!live[1].disabled);
  assert.equal(dry[1].disabled, true);
});

test('a dropdown menu answers by its block ID and option number', () => {
  const d = draftWith([{ type: 'menu', id: 'a1b2c3', placeholder: 'Pick one', options: [{ label: 'Rules', description: 'Read', reply: 'x', emoji: '📜' }, { label: 'Help', description: '', reply: 'y' }] }]);
  const select = (built) => built.components[0].toJSON().components.find((c) => c.type === 1).components[0];
  const s = select(render.build(d));
  assert.equal(s.custom_id, 'embed:menu:a1b2c3');
  assert.equal(s.placeholder, 'Pick one');
  assert.deepEqual(s.options.map((o) => o.value), ['0', '1']);
  assert.equal(s.options[1].description, undefined);
  assert.equal(select(render.build(d, { preview: true })).disabled, true);
});

test('uploaded files travel with the message, and missing ones are reported', () => {
  const d = draftWith([{ type: 'image', items: [{ upload: 'img-a.png' }, { upload: 'gone.png' }] }, { type: 'file', upload: 'doc.pdf' }]);
  const uploads = new Map([['img-a.png', { buffer: Buffer.from('a') }], ['doc.pdf', { buffer: Buffer.from('b') }]]);
  const built = render.build(d, { uploads });
  assert.deepEqual(built.files.map((f) => f.name).sort(), ['doc.pdf', 'img-a.png', 'tower-banner.png'].filter((n) => n !== 'tower-banner.png'));
  assert.deepEqual(built.missing, ['gone.png']);
  const parts = built.components[0].toJSON().components;
  assert.equal(parts[0].items.length, 1);
  assert.equal(parts[1].file.url, 'attachment://doc.pdf');
});

test('pictures already on a posted message are kept when editing it, but not copied to a new one', () => {
  const d = draftWith([{ type: 'image', items: [{ upload: 'img-old.png' }] }]);
  const retained = new Set(['img-old.png']);
  const inPlace = render.build(d, { retained, retainedOk: true });
  assert.deepEqual(inPlace.keep, ['img-old.png']);
  assert.deepEqual(inPlace.missing, []);
  const asNew = render.build(d, { retained });
  assert.deepEqual(asNew.missing, ['img-old.png']);
  const preview = render.build(d, { retained, retainedUrls: new Map([['img-old.png', 'https://cdn.example/img-old.png']]), preview: true });
  assert.equal(preview.components[0].toJSON().components[0].items[0].media.url, 'https://cdn.example/img-old.png');
});

test('a text block with a missing picture falls back to plain text', () => {
  const built = render.build(draftWith([{ type: 'section', content: 'Hello', thumb: null }], { footer: false }));
  assert.equal(built.components[0].toJSON().components[0].type, 10);
  const withPic = render.build(draftWith([{ type: 'section', content: 'Hello', thumb: { url: 'https://a.co/t.png' } }], { footer: false }));
  const section = withPic.components[0].toJSON().components[0];
  assert.equal(section.type, 9);
  assert.equal(section.accessory.media.url, 'https://a.co/t.png');
});

test('previews never ping, posts ping only what was written', () => {
  const d = draftWith([{ type: 'text', content: `<@&${ROLE}> @everyone` }]);
  assert.deepEqual(render.build(d, { preview: true }).allowedMentions, { parse: [] });
  assert.deepEqual(render.build(d).allowedMentions, { parse: [], roles: [ROLE], users: [] });
  assert.deepEqual(render.build({ ...d, everyone: true }).allowedMentions.parse, ['everyone']);
});

// ---------- builder sessions ----------
test('each person has one builder at a time, and it forgets after idling', () => {
  const a = sessions.create({ userId: 'u1', guildId: 'g1' });
  assert.equal(sessions.get(a.id), a);
  assert.equal(sessions.forUser('u1', 'g1'), a);
  const b = sessions.create({ userId: 'u1', guildId: 'g1' });
  assert.equal(sessions.get(a.id), null);
  assert.equal(sessions.get(b.id), b);
  b.touched = Date.now() - sessions.TTL_MS - 1;
  assert.equal(sessions.get(b.id), null);
  assert.equal(sessions.forUser('u1', 'g1'), null);
});

// ---------- role safety ----------
function fakeGuild(roles, { botPosition = 50 } = {}) {
  const cache = Object.assign(new Map(roles.map((r) => [r.id, r])), { find(fn) { return [...this.values()].find(fn); } });
  return { id: 'G', roles: { cache }, members: { me: { roles: { highest: { position: botPosition } } } } };
}
const role = (over) => ({ id: '1', name: 'Gaming', managed: false, position: 5, permissions: { any: () => false }, ...over });

test('a role button can never hand out staff, admin, verification or earned roles', () => {
  const ok = role({});
  const guild = fakeGuild([ok, role({ id: '2', name: 'Voice' })]);
  assert.equal(safety.protectedReason(guild, ok), null);
  assert.match(safety.protectedReason(guild, role({ id: 'G' })), /everyone/);
  assert.match(safety.protectedReason(guild, role({ managed: true })), /integration/);
  assert.match(safety.protectedReason(guild, role({ position: 60 })), /above Tower/);
  assert.match(safety.protectedReason(guild, role({ permissions: { any: () => true } })), /staff or admin/);
  assert.match(safety.protectedReason(guild, role({ name: 'Moderator' })), /staff rank/);
  assert.match(safety.protectedReason(guild, role({ name: 'Member' })), /verification/);
  assert.match(safety.protectedReason(guild, role({ name: 'Unverified' })), /verification/);
  assert.match(safety.protectedReason(guild, guild.roles.cache.get('2')), /earned through levels/);
  assert.match(safety.protectedReason(guild, null), /does not exist/);
});

test('roles are found by ID or by name', () => {
  const guild = fakeGuild([role({ id: '123456789012345678', name: 'YouTube Ping' })]);
  assert.equal(safety.findRole(guild, 'youtube ping').id, '123456789012345678');
  assert.equal(safety.findRole(guild, '123456789012345678').name, 'YouTube Ping');
  assert.equal(safety.findRole(guild, 'nobody'), null);
});
