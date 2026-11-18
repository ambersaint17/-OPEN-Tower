const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { moderation } = require('../src/constants');
const { levelFor, can } = require('../src/modules/moderation/permissions');
const views = require('../src/modules/youtube/views');

const root = path.join(__dirname, '..');

// A missing action name is denied to EVERYONE, the owner included (this is what broke /youtube setup).
test('every action name a command checks has a rank in moderation.actionLevel', () => {
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full); else if (e.name.endsWith('.js')) files.push(full);
  });
  walk(path.join(root, 'src'));
  const used = new Set(['voidCase', 'cases', 'giveawayManage', 'giveawayVerify', 'aiAdmin', 'aiSummarize']); // chosen at run time in commands/moderation.js and commands/giveaway.js
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\b(?:contextFor\([\w.]+|can\([\w.]+|allow\([\w.]+),\s*'([A-Za-z]+)'\)/g)) used.add(m[1]);
    for (const m of text.matchAll(/\brun\(i,\s*'([A-Za-z]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.has('contentAdmin'), 'the scan should find /youtube');
  for (const action of used) assert.ok(action in moderation.actionLevel, `"${action}" is checked in the code but has no rank in constants.js`);
});

test('YouTube setup is open to the owner and administrators, and closed to everyone else', () => {
  assert.equal(can(levelFor([], { isOwner: true }), 'contentAdmin'), true);
  assert.equal(can(levelFor([], { isAdmin: true }), 'contentAdmin'), true);
  assert.equal(can(levelFor(['Administrator']), 'contentAdmin'), true);
  assert.equal(can(levelFor(['Co-Owner']), 'contentAdmin'), true);
  assert.equal(can(levelFor(['Head Moderator']), 'contentAdmin'), false);
  assert.equal(can(levelFor(['Moderator']), 'contentAdmin'), false);
  assert.equal(can(levelFor([]), 'contentAdmin'), false);
});

const flat = (container) => JSON.stringify(container.toJSON());
const ROLE = '1565048876933578999';

test('early access is a Components V2 card, never a plain message', () => {
  const p = views.buildEarlyAccess({ title: 'Gun System Part 3', description: 'A first look.', link: 'https://youtu.be/dQw4w9WgXcQ', insiderRoleId: ROLE });
  assert.equal(p.content, undefined);                    // V2 messages cannot carry plain content
  assert.ok(p.flags & (1 << 15), 'IsComponentsV2 flag is set');
  assert.equal(p.components.length, 1);
  assert.deepEqual(p.allowedMentions, { roles: [ROLE] });
  const json = flat(p.components[0]);
  assert.match(json, /Gun System Part 3/);
  assert.match(json, new RegExp(`<@&${ROLE}>`));
  assert.match(json, /i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg/);   // thumbnail from the YouTube link
  assert.match(json, /Watch Early/);
  assert.match(json, /Powered by/);
  assert.match(json, /attachment:\/\/tower-banner-earlyaccess\.png/);
  assert.ok(p.files.some((f) => f.name === 'tower-banner-earlyaccess.png'), 'the banner is uploaded with the card');
});

test('early access with an uploaded image shows it inside the card', () => {
  const p = views.buildEarlyAccess({ title: 'Teaser', clip: { name: 'My Teaser (final).PNG', url: 'https://cdn.discordapp.com/x.png', contentType: 'image/png' } });
  const json = flat(p.components[0]);
  assert.match(json, /attachment:\/\/early-access\.png/);
  assert.ok(p.files.some((f) => f.name === 'early-access.png' && f.attachment === 'https://cdn.discordapp.com/x.png'));
  assert.doesNotMatch(json, /Watch Early/);              // no link, so no button
  assert.deepEqual(p.allowedMentions, { roles: [] });    // and no role to ping
});

test('early access with an uploaded video is shown as a file, since cards cannot play video', () => {
  const p = views.buildEarlyAccess({ title: 'Clip', clip: { name: 'clip.mp4', url: 'https://cdn.discordapp.com/x.mp4', contentType: 'video/mp4' } });
  const parts = JSON.parse(flat(p.components[0])).components;
  assert.ok(parts.some((c) => c.type === 13 && c.file.url === 'attachment://early-access.mp4'), 'a file component points at the clip');
  assert.ok(!parts.some((c) => c.type === 12 && c.items.some((i) => i.media.url === 'attachment://early-access.mp4')));
});

test('clip names are always safe', () => {
  assert.equal(views.clipName('Weird name (1).MP4'), 'early-access.mp4');
  assert.equal(views.clipName('noextension'), 'early-access.bin');
  assert.equal(views.clipName(undefined), 'early-access.bin');
});

test('uploads post as cards too: banner, divider, details and footer in order', () => {
  const parts = JSON.parse(flat(views.buildEarlyAccess({ title: 'T', link: 'https://example.com/v' }).components[0])).components;
  assert.equal(parts[0].type, 12);                       // banner first
  assert.equal(parts.at(-1).type, 10);                   // footer last
  assert.ok(parts.some((c) => c.type === 1), 'the Watch Early button row is present');
});

// ---------- commands that used to rely only on Discord's default permission ----------
const guard = require('../src/lib/guard');
function fakeInteraction({ roles = [], owner = false, admin = false } = {}) {
  const calls = [];
  const member = { id: 'm1', roles: { cache: new Map(roles.map((n, i) => [String(i), { name: n }])) }, permissions: { has: () => admin } };
  member.roles.cache.values = () => roles.map((name) => ({ name }))[Symbol.iterator]();
  return { calls, guild: { ownerId: owner ? 'm1' : 'someone', members: { me: {} } }, member, editReply: async (p) => { calls.push(p); } };
}

test('emoji, logs and verification now check the rank themselves', async () => {
  for (const action of ['emojiAdmin', 'logsAdmin', 'verificationAdmin']) {
    assert.equal(await guard.allow(fakeInteraction({ owner: true }), action), true, `${action}: owner`);
    assert.equal(await guard.allow(fakeInteraction({ admin: true }), action), true, `${action}: administrator`);
    const mod = fakeInteraction({ roles: ['Head Moderator'] });
    assert.equal(await guard.allow(mod, action), false, `${action}: head moderator`);
    assert.equal(mod.calls.length, 1);
    assert.match(JSON.stringify(mod.calls[0].components.map((c) => c.toJSON())), /not allowed|Only staff/);
    assert.equal(await guard.allow(fakeInteraction(), action), false, `${action}: ordinary member`);
  }
});

test('the three commands call the guard before doing anything', () => {
  for (const [file, action] of [['emoji', 'emojiAdmin'], ['logs', 'logsAdmin'], ['verification', 'verificationAdmin']]) {
    const text = fs.readFileSync(path.join(root, `src/commands/${file}.js`), 'utf8');
    assert.match(text, new RegExp(`await allow\\(interaction, '${action}'\\)`), file);
  }
});
