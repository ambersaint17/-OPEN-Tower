const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageCache, snapshot } = require('../src/modules/logging/messageCache');
const { clip, quote, diffLists, listOrNone, safeFilename } = require('../src/lib/text');
const { pickLogChannel } = require('../src/modules/logging/channels');
const { matchesChannelName } = require('../src/lib/channels');
const { logTypes, logging } = require('../src/constants');

const clockAt = (t) => () => t.now;

test('the cache returns what it holds and forgets it after the TTL', () => {
  const t = { now: 1000 };
  const cache = new MessageCache({ max: 10, ttlMs: 5000, clock: clockAt(t) });
  cache.set({ id: 'a', content: 'hello' });
  assert.equal(cache.get('a').content, 'hello');
  t.now += 5001;
  assert.equal(cache.get('a'), null);
  assert.equal(cache.size, 0);
});

test('the cache never grows past its cap and drops the oldest first', () => {
  const cache = new MessageCache({ max: 3, ttlMs: 60_000 });
  for (const id of ['1', '2', '3', '4', '5']) cache.set({ id, content: id });
  assert.equal(cache.size, 3);
  assert.equal(cache.get('1'), null);
  assert.equal(cache.get('2'), null);
  assert.equal(cache.get('5').content, '5');
});

test('take removes the entry, and an edited message moves to the newest slot', () => {
  const cache = new MessageCache({ max: 3, ttlMs: 60_000 });
  cache.set({ id: 'a', content: '1' });
  cache.set({ id: 'b', content: '2' });
  cache.set({ id: 'a', content: '1 edited' }); // refresh a
  cache.set({ id: 'c', content: '3' });
  cache.set({ id: 'd', content: '4' }); // evicts the oldest, which is now b
  assert.equal(cache.get('b'), null);
  assert.equal(cache.take('a').content, '1 edited');
  assert.equal(cache.get('a'), null);
});

test('prune clears expired entries', () => {
  const t = { now: 0 };
  const cache = new MessageCache({ max: 10, ttlMs: 100, clock: clockAt(t) });
  cache.set({ id: 'a' });
  t.now = 50; cache.set({ id: 'b' });
  t.now = 130;
  assert.equal(cache.prune(), 1);
  assert.equal(cache.size, 1);
});

test('snapshot keeps plain data only', () => {
  const message = {
    id: '9', channelId: 'c', content: 'hi',
    author: { id: 'u', tag: 'u#0', displayAvatarURL: () => 'https://a/b.png' },
    attachments: new Map([['1', { name: 'p.png', url: 'https://x', contentType: 'image/png', size: 10 }]]),
    stickers: new Map([['2', { name: 'wave' }]]),
    createdTimestamp: 123,
  };
  const snap = snapshot(message);
  assert.deepEqual(snap.attachments, [{ name: 'p.png', url: 'https://x', contentType: 'image/png', size: 10 }]);
  assert.deepEqual(snap.stickers, ['wave']);
  assert.equal(snap.authorId, 'u');
  assert.equal(JSON.parse(JSON.stringify(snap)).content, 'hi');
});

test('clip, quote and list helpers', () => {
  assert.equal(clip('abcdef', 4), 'abc\u2026');
  assert.equal(clip('abc', 4), 'abc');
  assert.equal(quote('a\nb'), '> a\n> b');
  assert.deepEqual(diffLists(['a', 'b'], ['b', 'c']), { added: ['c'], removed: ['a'] });
  assert.equal(listOrNone([]), '`none`');
  assert.equal(listOrNone(['1', '2', '3'], 2), '1 2 +1 more');
  assert.equal(safeFilename('../../evil name.PNG', 0), 'deleted-1.png');
  assert.equal(safeFilename('noextension', 1), 'deleted-2.png');
});

test('duplicate channel names resolve to the one under a log category', () => {
  const pick = pickLogChannel([
    { id: '1', name: 'mod-logs', parentName: 'SUPPORT & MODERATION' },
    { id: '2', name: 'mod-logs', parentName: 'SERVER LOGS' },
  ]);
  assert.equal(pick.id, '2');
  assert.equal(pickLogChannel([{ id: '3', name: 'x', parentName: null }]).id, '3');
  assert.equal(pickLogChannel([]), null);
});

test('the category holding the most log channels wins, even with decorative category names', () => {
  // Your real situation: two mod-logs, and the category names use fancy letters, so "log" never matches.
  const scores = new Map([['serverlogs', 18], ['support', 1]]);
  const pick = pickLogChannel([
    { id: 'wrong', name: '📃｜mod-logs', parentId: 'support', parentName: 'ꜱᴜᴘᴘᴏʀᴛ & ᴍᴏᴅᴇʀᴀᴛɪᴏɴ' },
    { id: 'right', name: 'mod-logs', parentId: 'serverlogs', parentName: 'ꜱᴇʀᴠᴇʀ ʟᴏɢꜱ' },
  ], scores);
  assert.equal(pick.id, 'right');
  // The order channels are listed in must not matter.
  const flipped = pickLogChannel([
    { id: 'right', name: 'mod-logs', parentId: 'serverlogs', parentName: 'x' },
    { id: 'wrong', name: '📃｜mod-logs', parentId: 'support', parentName: 'y' },
  ], scores);
  assert.equal(flipped.id, 'right');
});

test('every log type matches your real channel names, and none collide', () => {
  const real = ['mod-logs', 'ban-logs', 'unban-logs', 'kick-logs', 'join-logs', 'leave-logs', 'member-update-logs',
    'role-logs', 'invite-logs', 'message-delete-logs', 'message-edit-logs', 'bulk-delete-logs', 'media-logs',
    'automod-logs', 'staff-logs', 'vc-logs', 'server-logs', 'webhook-logs', 'bot-logs', 'mod-cases', 'level-logs'];
  for (const def of Object.values(logTypes)) assert.ok(real.includes(def.channel), `${def.channel} is not one of your channels`);
  assert.equal(new Set(Object.values(logTypes).map((d) => d.channel)).size, Object.keys(logTypes).length);
  assert.ok(Object.keys(logTypes).length <= 25, 'Discord allows at most 25 choices');
  assert.equal(matchesChannelName('📜｜member-update-logs', 'member-update-logs'), true);
  assert.equal(matchesChannelName('ticket-logs', 'mod-logs'), false);
});

test('the message cache is bounded and short-lived by default', () => {
  assert.ok(logging.messageCache.max <= 20_000);
  assert.ok(logging.messageCache.ttlMs <= 24 * 60 * 60 * 1000);
});
