const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../src/lib/automod');

const config = a.mergeConfig({});
const check = (content, over = {}) => a.evaluateContent({ content, config, words: [], ...over });

// ---------- settings ----------
test('missing or damaged settings fall back to safe defaults, and numbers are kept in range', () => {
  const d = a.mergeConfig(undefined);
  assert.deepEqual([d.spam.messages, d.spam.seconds, d.mentions.max, d.links.mode, d.formatting.capsPercent], [6, 8, 5, 'invites', 70]);
  const odd = a.mergeConfig({ spam: { messages: 9999, seconds: -4, enabled: 'yes' }, links: { mode: 'banana', allowedDomains: ['YouTube.com', 'not a domain', 'https://www.Twitch.tv/x'] }, mentions: null, formatting: { capsPercent: 'lots' } });
  assert.equal(odd.spam.messages, 20); assert.equal(odd.spam.seconds, 3); assert.equal(odd.spam.enabled, true);
  assert.equal(odd.links.mode, 'invites');
  assert.deepEqual(odd.links.allowedDomains, ['youtube.com', 'twitch.tv']);
  assert.equal(odd.mentions.max, 5); assert.equal(odd.formatting.capsPercent, 70);
  assert.equal(a.mergeConfig('nonsense').words.enabled, true);
});

// ---------- links and invites ----------
test('invites are found in every common form', () => {
  assert.deepEqual(a.findInvites('join discord.gg/abc123 or https://discord.com/invite/XyZ-9 or discordapp.com/invite/qq'), ['abc123', 'xyz-9', 'qq']);
  assert.deepEqual(a.findInvites('no invite here, just discord.com/channels/1/2'), []);
});

test('links are found, file names and invites are not mistaken for them', () => {
  assert.deepEqual(a.findHosts('look at https://youtu.be/x and www.Example.com/page'), ['youtu.be', 'example.com']);
  assert.deepEqual(a.findHosts('send me notes.txt and image.png and script.lua'), []);
  assert.deepEqual(a.findHosts('discord.gg/abc123'), [], 'an invite is judged as an invite');
  assert.deepEqual(a.findHosts('just words, nothing else. Really.'), []);
  assert.equal(a.isAllowedHost('music.youtube.com', ['youtube.com']), true);
  assert.equal(a.isAllowedHost('notyoutube.com', ['youtube.com']), false);
});

// ---------- shouting, emoji, zalgo ----------
test('shouting needs enough letters, ignores links and mentions, and other scripts are never flagged', () => {
  assert.equal(a.capsRatio('HELLO WORLD THIS IS LOUD').ratio, 1);
  assert.equal(a.capsRatio('Hello World').ratio < 0.3, true);
  assert.equal(a.capsRatio('https://EXAMPLE.COM/PAGE <@123456789012345678>').letters, 0);
  assert.equal(a.capsRatio('नमस्ते दोस्तों').letters, 0);
  assert.equal(a.countEmoji('hi 😀😀 <:tower:123456789012345678> <a:wave:123456789012345678>'), 4);
  assert.equal(a.isZalgo('h̸̡̪̯ͨ͊̽̅̾̎e̷llo'), true);
  assert.equal(a.isZalgo('café déjà vu naïve'), false);
  assert.equal(a.isZalgo('नमस्ते दोस्तों कैसे हो आप सब ภาษาไทย'), false, 'Hindi and Thai use many marks and are fine');
});

// ---------- banned words ----------
const WORDS = ['fuck', 'bad word', '*scam*', 'ass'];
const banned = (text, words = WORDS) => a.findBannedWord(text, words);
test('banned words match whole words, with stretched letters and number swaps', () => {
  assert.equal(banned('what the fuck'), 'fuck');
  assert.equal(banned('FUUUUCK'), 'fuck');
  assert.equal(banned('fu(k'.replace('(', 'c')), 'fuck');
  assert.equal(banned('a55 hole'), 'ass', 'numbers standing in for letters');
  assert.equal(banned('this is a bad     word'), 'bad word');
  assert.equal(banned('bad_word'), 'bad word');
  assert.equal(banned('h̸e̷ll̶o fuck'), 'fuck', 'accents and zero-width marks are stripped');
});

test('innocent words are never caught by accident', () => {
  for (const text of ['assistant', 'classic', 'bass guitar', 'Scunthorpe', 'compass', 'hello there', 'the passage', 'badge of honour']) assert.equal(banned(text), null, text);
  assert.equal(banned('what a scammer'), '*scam*', 'a *word* entry matches inside other words');
  assert.equal(banned('SCAM'), '*scam*');
  assert.equal(banned('anything', []), null);
});

// ---------- the content rules together ----------
test('each content rule fires on its own and says why', async () => {
  assert.deepEqual(await check('fuck', { words: WORDS }), { rule: 'words', label: 'a banned word' });
  assert.deepEqual(await check('join discord.gg/abc123'), { rule: 'links', label: 'a server invite' });
  assert.equal((await check('<@1> <@2> <@3> <@4> <@5> <@6>', { mentionCount: 6 })).rule, 'mentions');
  assert.equal(await check('hey', { mentionCount: 5 }), null, 'exactly at the limit is fine');
  assert.equal((await check('THIS IS A VERY LOUD MESSAGE INDEED')).rule, 'formatting');
  assert.equal((await check('😀'.repeat(13))).label, 'too many emoji');
  assert.equal((await check('h̸̡̪̯ͨ͊̽̅̾̎e̷llo')).label, 'distorted text');
  assert.equal(await check('a perfectly normal message, with nothing wrong in it at all'), null);
  assert.equal(await check('Short SHOUT'), null, 'short messages are not "shouting"');
});

test('link modes: off, invites only, and all links with an allowed list', async () => {
  const mode = (m, extra = {}) => a.mergeConfig({ links: { mode: m, ...extra } });
  assert.equal(await check('https://evil.site/x', { config: mode('invites') }), null);
  assert.equal((await check('https://evil.site/x', { config: mode('all') })).rule, 'links');
  assert.equal(await check('https://youtu.be/x', { config: mode('all') }), null);
  assert.equal(await check('discord.gg/abc123', { config: mode('off') }), null);
  assert.equal(await check('https://evil.site/x', { config: mode('all', { allowedDomains: ['evil.site'] }) }), null);
});

test('your own server\'s invite is allowed, and trusted levels may post links', async () => {
  assert.equal(await check('discord.gg/home', { isForeignInvite: async () => false }), null);
  assert.equal((await check('discord.gg/other', { isForeignInvite: async (c) => c !== 'home' })).rule, 'links');
  const trusted = a.mergeConfig({ links: { mode: 'all', exemptLevel: 5 } });
  assert.equal(await check('https://evil.site/x', { config: trusted, memberLevel: 5 }), null);
  assert.equal((await check('https://evil.site/x', { config: trusted, memberLevel: 4 })).rule, 'links');
});

test('switching a rule off stops it', async () => {
  const off = a.mergeConfig({ formatting: { enabled: false }, mentions: { enabled: false }, words: { enabled: false } });
  assert.equal(await check('THIS IS A VERY LOUD MESSAGE INDEED', { config: off }), null);
  assert.equal(await check('hey', { config: off, mentionCount: 20 }), null);
  assert.equal(await check('fuck', { config: off, words: WORDS }), null);
});

// ---------- flooding ----------
const spam = { messages: 6, seconds: 8, duplicates: 3, duplicateSeconds: 30 };
const msg = (id, content = 'hi') => ({ id, channelId: 'c1', content });

test('six messages in eight seconds is flooding, and the whole burst is reported', () => {
  const t = new a.FloodTracker(60_000);
  const t0 = 1_000_000;
  for (let i = 1; i <= 5; i++) assert.equal(t.record('g:u', msg(`m${i}`, `message number ${i}`), spam, t0 + i * 500), null);
  const hit = t.record('g:u', msg('m6', 'message number 6'), spam, t0 + 3000);
  assert.equal(hit.rule, 'spam'); assert.match(hit.label, /too quickly/);
  assert.deepEqual(hit.messages.map((m) => m.id), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
});

test('a normal pace never counts, and old messages fall out of the window', () => {
  const t = new a.FloodTracker(60_000);
  let now = 5_000_000;
  for (let i = 0; i < 20; i++) { assert.equal(t.record('g:u', msg(`m${i}`, `different text ${i}`), spam, now), null); now += 3000; }
});

test('the same message three times is spam, but different people and different texts are not', () => {
  const t = new a.FloodTracker(60_000); const t0 = 9_000_000;
  assert.equal(t.record('g:u', msg('a', 'Buy my stuff'), spam, t0), null);
  assert.equal(t.record('g:u', msg('b', 'buy   my STUFF'), spam, t0 + 4000), null);
  const hit = t.record('g:u', msg('c', 'buy my stuff'), spam, t0 + 9000);
  assert.match(hit.label, /repeating/);
  assert.deepEqual(hit.messages.map((m) => m.id), ['a', 'b', 'c']);
  const other = new a.FloodTracker(60_000);
  other.record('g:u1', msg('x', 'same'), spam, t0); other.record('g:u2', msg('y', 'same'), spam, t0 + 1000);
  assert.equal(other.record('g:u3', msg('z', 'same'), spam, t0 + 2000), null, 'three different people saying the same thing is a conversation');
});

test('a handled burst is forgotten, so it is not punished twice, and old entries are pruned', () => {
  const t = new a.FloodTracker(60_000); const t0 = 1_000;
  let hit;
  for (let i = 1; i <= 6; i++) hit = t.record('k', msg(`m${i}`, `t${i}`), spam, t0 + i * 100);
  t.clear('k', hit.messages.map((m) => m.id));
  assert.equal(t.record('k', msg('m7', 't7'), spam, t0 + 1000), null);
  t.prune(t0 + 200_000);
  assert.equal(t.people.size, 0);
});
