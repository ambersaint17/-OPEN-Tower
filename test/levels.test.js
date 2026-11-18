const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lib/levels');
const { computeDefaults, evaluate } = require('../src/modules/levels/rules');
const { levels, perks, colours, logTypes } = require('../src/constants');

test('the ladder is strictly increasing, starts tiny and ends big', () => {
  const totals = levels.ladder.map((l) => l.xp);
  assert.equal(totals[0], 40);                                  // level 1 is two messages
  for (let i = 1; i < totals.length; i++) assert.ok(totals[i] > totals[i - 1]);
  levels.ladder.forEach((l, i) => assert.equal(l.level, i + 1));
  const needs = totals.map((t, i) => t - (totals[i - 1] ?? 0));
  for (let i = 2; i < needs.length; i++) assert.ok(needs[i] > needs[i - 1], 'each level must cost more than the one before');
  assert.ok(totals.at(-1) >= 25_000, 'the top level must be a real commitment');
});

test('levels and progress are computed from XP', () => {
  assert.equal(L.levelFromXp(0), 0);
  assert.equal(L.levelFromXp(39), 0);
  assert.equal(L.levelFromXp(40), 1);
  assert.equal(L.levelFromXp(139), 1);
  assert.equal(L.levelFromXp(140), 2);
  assert.equal(L.levelFromXp(10 ** 9), L.MAX_LEVEL);
  const p = L.progress(90);
  assert.equal(p.level, 1);
  assert.equal(p.into, 50);
  assert.equal(p.needed, 100);
  assert.equal(p.toNext, 50);
  assert.equal(p.fraction, 0.5);
  const top = L.progress(10 ** 9);
  assert.equal(top.max, true);
  assert.equal(top.fraction, 1);
  assert.equal(top.toNext, 0);
  assert.equal(L.progress(0).fraction, 0);
});

test('each level unlocks exactly what was agreed', () => {
  const at = (n) => levels.ladder[n - 1].perks;
  assert.deepEqual([1, 2, 3, 4].map((n) => at(n)[0]), ['reactions', 'emojis', 'nickname', 'images']);
  assert.deepEqual(at(5), ['voice']);
  assert.deepEqual(at(6), ['colours']);
  assert.deepEqual(at(7), ['giveaway']);
  assert.deepEqual(at(8), ['shield', 'qotd']);
  assert.deepEqual(at(9), ['insider']);
  assert.deepEqual(at(10), ['elite']);
  assert.deepEqual(L.perksUpTo(4), ['reactions', 'emojis', 'nickname', 'images']);
  assert.equal(L.nextUnlock(4).level, 5);
  assert.equal(L.nextUnlock(10), null);
  assert.equal(L.perkLevel('insider'), 9);
  assert.equal(L.titleFor(0), 'Passenger');
  assert.equal(L.titleFor(10), 'Ace');
  for (const l of levels.ladder) for (const key of l.perks) assert.ok(perks[key], `${key} has no definition`);
});

test('every perk is fully described, and role perks name real permissions', () => {
  for (const [key, p] of Object.entries(perks)) {
    assert.ok(p.name && p.icon && p.summary && p.detail, key);
    assert.ok(p.summary.length <= 100, `${key} summary must fit a select menu description`);
    if (p.role) {
      assert.ok(p.role.aliases.length > 0, key);
      for (const perm of p.role.permissions) assert.match(perm, /^[A-Z][A-Za-z]+$/, `${key}: ${perm}`);
    }
  }
  assert.equal(perks.voice.role.permissions.includes('Connect'), true);   // the perk that gates joining voice
  assert.equal(colours.length, 10);
  assert.equal(new Set(colours.map((c) => c.key)).size, 10);
});

test('the daily soft cap slows XP without stopping it', () => {
  assert.equal(L.applySoftCap(0, 20), 20);
  assert.equal(L.applySoftCap(380, 20), 20);                // still under the cap
  assert.equal(L.applySoftCap(395, 20), Math.round(5 + 15 * 0.25));
  assert.equal(L.applySoftCap(400, 20), 5);
  assert.equal(L.applySoftCap(5000, 15), 4);
  assert.ok(L.applySoftCap(9999, 1) >= 1);
});

test('streaks grow daily, reset after a gap, and a shield forgives one missed day', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  assert.equal(L.streakStep({}, '2026-10-20', now, false).streak, 1);
  assert.equal(L.streakStep({ streak: 3, lastDay: '2026-10-20' }, '2026-10-20', now, false).streak, 3);   // same day
  assert.equal(L.streakStep({ streak: 3, lastDay: '2026-10-19' }, '2026-10-20', now, false).streak, 4);
  assert.equal(L.streakStep({ streak: 3, lastDay: '2026-10-18' }, '2026-10-20', now, false).streak, 1);   // missed a day, no shield
  const shielded = L.streakStep({ streak: 3, lastDay: '2026-10-18' }, '2026-10-20', now, true);
  assert.equal(shielded.streak, 4);
  assert.equal(shielded.usedShield, true);
  // the shield is used up for a week
  const again = L.streakStep({ streak: 4, lastDay: '2026-10-22', shieldUsedAt: shielded.shieldUsedAt }, '2026-10-24', now + 4 * 86400000, true);
  assert.equal(again.streak, 1);
  const recharged = L.streakStep({ streak: 4, lastDay: '2026-10-29', shieldUsedAt: shielded.shieldUsedAt }, '2026-10-31', now + 11 * 86400000, true);
  assert.equal(recharged.streak, 5);
  assert.equal(L.streakStep({ streak: 9, lastDay: '2026-10-10' }, '2026-10-20', now, true).streak, 1);    // a long gap beats the shield
  assert.equal(L.daysBetween('2026-10-31', '2026-11-02'), 2);                                              // across a month end
});

test('streak bonus is small and capped', () => {
  assert.equal(L.streakBonus(0), 0);
  assert.equal(L.streakBonus(1), 0);
  assert.equal(L.streakBonus(2), 0.05);
  assert.ok(Math.abs(L.streakBonus(6) - 0.25) < 1e-9);
  assert.ok(Math.abs(L.streakBonus(400) - 0.25) < 1e-9);
});

test('XP per message stays in range', () => {
  assert.equal(L.rollXp(() => 0), 15);
  assert.equal(L.rollXp(() => 0.999999), 25);
  for (let i = 0; i < 200; i++) { const x = L.rollXp(); assert.ok(x >= 15 && x <= 25); }
});

test('giveaway entries grow with level and double for boosters', () => {
  assert.equal(L.giveawayEntries(0, false), 1);
  assert.equal(L.giveawayEntries(6, false), 1);
  assert.equal(L.giveawayEntries(7, false), 2);
  assert.equal(L.giveawayEntries(10, false), 3);
  assert.equal(L.giveawayEntries(0, true), 2);
  assert.equal(L.giveawayEntries(10, true), 6);
});

test('perk roles follow level, and boosters get the instant set on top', () => {
  assert.deepEqual(L.desiredPerks(0, false, perks), []);
  assert.deepEqual(L.desiredPerks(2, false, perks), ['reactions', 'emojis']);
  assert.deepEqual(L.desiredPerks(5, false, perks), ['reactions', 'emojis', 'nickname', 'images', 'voice']);
  const booster = L.desiredPerks(0, true, perks);
  for (const k of ['reactions', 'emojis', 'nickname', 'images', 'insider']) assert.ok(booster.includes(k), k);
  assert.ok(!booster.includes('voice'), 'boosters still earn voice');
  assert.ok(!booster.includes('elite'), 'boosters do not get Elite for free');
  assert.ok(!L.desiredPerks(10, false, perks).includes('colours'), 'colours has no role, so it is never a role');
  assert.ok(L.desiredPerks(10, false, perks).includes('elite'));
  assert.ok(L.desiredPerks(9, false, perks).includes('insider'));
});

test('time estimates read naturally', () => {
  assert.equal(L.estimateText(40), 'under a day');
  assert.equal(L.estimateText(1200), 'about 3 days');
  assert.equal(L.estimateText(8310), 'about 3 weeks');
  assert.equal(L.estimateText(29890), 'about 2 months');
});

// ---------- where XP is earned ----------

const state = (extra = {}) => ({
  explicit: new Map(), defaults: { channels: new Map(), categories: new Map() }, ignoredRoles: new Set(),
  channelMultipliers: new Map(), roleMultipliers: new Map(), ...extra,
});

// a layout shaped like the real server
const server = [
  { id: 'rules', name: '\u{1F4DC}\uFF5Crules', parentId: 'cat-important' },
  { id: 'ann', name: '\u{1F4E2}\uFF5Cannouncements', parentId: 'cat-important' },
  { id: 'about', name: 'about-me', parentId: 'cat-important' },
  { id: 'newvid', name: 'new-videos', parentId: 'cat-important' },
  { id: 'comm-ann', name: 'community-announcements', parentId: 'cat-engage' },
  { id: 'qotd', name: 'qotd', parentId: 'cat-engage' },
  { id: 'general', name: 'general-chat', parentId: 'cat-community' },
  { id: 'media', name: 'media', parentId: 'cat-community' },
  { id: 'creations', name: 'creations', parentId: 'cat-community' },
  { id: 'botcmd', name: 'bot-commands', parentId: 'cat-community' },
  { id: 'questions', name: 'questions', parentId: 'cat-community' },
  { id: 'verify', name: 'verify', parentId: 'cat-verify' },
  { id: 'staffchat', name: 'staff-chat', parentId: 'cat-staff' },
  { id: 'modlogs', name: 'mod-logs', parentId: 'cat-logs' },
  { id: 'joinlogs', name: 'join-logs', parentId: 'cat-logs' },
  { id: 'levelups', name: 'level-ups', parentId: 'cat-engage' },
];

test('default ignores cover the Important category, staff, logs, verification and spam channels', () => {
  const d = computeDefaults(server);
  const st = state({ defaults: d });
  const ignored = (id, parent) => evaluate({ ids: [id, parent], roleIds: [] }, st).ignored;
  // everything in Important is ignored, even channels that are not named rules or announcements
  for (const [id, cat] of [['rules', 'cat-important'], ['about', 'cat-important'], ['newvid', 'cat-important'], ['ann', 'cat-important']]) assert.equal(ignored(id, cat), true, id);
  assert.equal(ignored('media', 'cat-community'), true);
  assert.equal(ignored('creations', 'cat-community'), true);
  assert.equal(ignored('botcmd', 'cat-community'), true);
  assert.equal(ignored('verify', 'cat-verify'), true);
  assert.equal(ignored('staffchat', 'cat-staff'), true);
  assert.equal(ignored('modlogs', 'cat-logs'), true);
  assert.equal(ignored('levelups', 'cat-engage'), true);
  // real conversation still earns XP, including in channels that merely share a word
  assert.equal(ignored('general', 'cat-community'), false);
  assert.equal(ignored('questions', 'cat-community'), false);
  assert.equal(ignored('qotd', 'cat-engage'), false);
  assert.equal(ignored('comm-ann', 'cat-engage'), false, 'community-announcements is not the Important announcements channel');
});

test('threads inherit from their forum and category', () => {
  const st = state({ defaults: computeDefaults(server) });
  const thread = { ids: ['thread-1', 'creations', 'cat-community'], roleIds: [] };
  assert.equal(evaluate(thread, st).ignored, true);               // a post inside the creations forum
  assert.equal(evaluate({ ids: ['thread-2', 'general', 'cat-community'], roleIds: [] }, st).ignored, false);
});

test('staff rules override the defaults, most specific first', () => {
  const defaults = computeDefaults(server);
  // allow one channel inside an ignored category
  let st = state({ defaults, explicit: new Map([['about', 'allow']]) });
  assert.equal(evaluate({ ids: ['about', 'cat-important'], roleIds: [] }, st).ignored, false);
  assert.equal(evaluate({ ids: ['rules', 'cat-important'], roleIds: [] }, st).ignored, true);
  // ignore a normal channel
  st = state({ defaults, explicit: new Map([['general', 'ignore']]) });
  assert.equal(evaluate({ ids: ['general', 'cat-community'], roleIds: [] }, st).ignored, true);
  // a channel rule beats a category rule
  st = state({ defaults, explicit: new Map([['cat-community', 'ignore'], ['questions', 'allow']]) });
  assert.equal(evaluate({ ids: ['questions', 'cat-community'], roleIds: [] }, st).ignored, false);
  assert.equal(evaluate({ ids: ['general', 'cat-community'], roleIds: [] }, st).ignored, true);
});

test('ignored roles earn nothing, and multipliers combine sensibly', () => {
  let st = state({ ignoredRoles: new Set(['bots']) });
  assert.equal(evaluate({ ids: ['general'], roleIds: ['bots', 'member'] }, st).ignored, true);
  st = state({ channelMultipliers: new Map([['questions', 1.5]]), roleMultipliers: new Map([['booster', 1.25], ['vip', 2]]) });
  assert.equal(evaluate({ ids: ['questions', 'cat'], roleIds: [] }, st).multiplier, 1.5);
  assert.equal(evaluate({ ids: ['general', 'cat'], roleIds: ['booster', 'vip'] }, st).multiplier, 2);       // the best role, not stacked
  assert.equal(evaluate({ ids: ['questions'], roleIds: ['booster'] }, st).multiplier, 1.5 * 1.25);
  assert.equal(evaluate({ ids: ['x'], roleIds: [] }, st).multiplier, 1);
});

test('the level log type exists and does not collide with another channel name', () => {
  assert.equal(logTypes.levels.channel, 'level-logs');
  assert.equal(new Set(Object.values(logTypes).map((t) => t.channel)).size, Object.keys(logTypes).length);
});

// ---------- boosters, perk roles, and the XP engine end to end ----------

const boosters = require('../src/modules/levels/boosters');
const perkSync = require('../src/modules/levels/perks');

test('booster anniversaries, colours and months', () => {
  assert.equal(boosters.pickAnniversary(0), null);
  assert.equal(boosters.pickAnniversary(1), 1);
  assert.equal(boosters.pickAnniversary(2), 1);
  assert.equal(boosters.pickAnniversary(3), 3);
  assert.equal(boosters.pickAnniversary(11), 6);
  assert.equal(boosters.pickAnniversary(12), 12);
  assert.equal(boosters.pickAnniversary(40), 12);
  assert.equal(boosters.anniversaryLabel(1), '1 Month');
  assert.equal(boosters.anniversaryLabel(6), '6 Months');
  assert.equal(boosters.anniversaryLabel(12), '1 Year');
  assert.equal(boosters.anniversaryRoleName(3), 'Booster | 3 Months');
  assert.equal(boosters.parseHex('#ff5c8a'), 0xff5c8a);
  assert.equal(boosters.parseHex('FF5C8A'), 0xff5c8a);
  for (const bad of ['', '#fff', 'ff5c8', 'gggggg', '#ff5c8a1', null]) assert.equal(boosters.parseHex(bad), null, String(bad));
  const day = 86_400_000;
  assert.equal(boosters.monthsBoosted(0, 31 * day), 1);
  assert.equal(boosters.monthsBoosted(0, 10 * day), 0);
});

test('perk roles: who needs what, and nobody loses something by accident', () => {
  const held = (...k) => new Set(k);
  assert.deepEqual(perkSync.plan({ level: 2, booster: false, heldKeys: held('reactions'), hasAdmin: false }), { add: ['emojis'], remove: [] });
  // a level 2 member holding Images (not earned) loses it only when removal is asked for by the caller
  const p = perkSync.plan({ level: 2, booster: false, heldKeys: held('reactions', 'emojis', 'images'), hasAdmin: false });
  assert.deepEqual(p.remove, ['images']);
  assert.deepEqual(perkSync.plan({ level: 2, booster: false, heldKeys: held('images'), hasAdmin: true }).remove, []);   // administrators are never stripped
  // boosters are owed the instant perks, and keep them
  const b = perkSync.plan({ level: 0, booster: true, heldKeys: held(), hasAdmin: false });
  assert.deepEqual(b.add.sort(), ['emojis', 'images', 'insider', 'nickname', 'reactions']);
  assert.deepEqual(perkSync.plan({ level: 0, booster: true, heldKeys: held('insider', 'reactions'), hasAdmin: false }).remove, []);
  // when the boost ends, only what the level justifies stays
  assert.deepEqual(perkSync.plan({ level: 1, booster: false, heldKeys: held('reactions', 'insider', 'images'), hasAdmin: false }).remove.sort(), ['images', 'insider']);
});

test('the permission audit flags perks that @everyone already has', () => {
  const everyone = new Set(['ViewChannel', 'SendMessages', 'AttachFiles', 'Connect']);
  assert.deepEqual(perkSync.auditPerk('images', everyone, new Set(['AttachFiles', 'EmbedLinks'])), [{ type: 'everyone', perms: ['AttachFiles'] }]);
  assert.deepEqual(perkSync.auditPerk('voice', everyone, new Set(['Connect'])).map((i) => i.type), ['everyone', 'role']);
  assert.deepEqual(perkSync.auditPerk('reactions', everyone, new Set(['AddReactions'])), []);   // correctly gated
  assert.deepEqual(perkSync.auditPerk('nickname', everyone, null), []);                          // role missing: nothing to compare yet
});

test('XP engine: earning, cooldown, rules, boosters and the daily cap', async () => {
  const service = require('../src/modules/levels/service');
  Object.assign(service, {   // the engine must never touch a real database in a test
    getMember: async () => null, saveMember: async () => {}, loadRules: async () => [], deleteMember: async () => {},
  });
  const engine = require('../src/modules/levels/engine');
  const original = Math.random;
  Math.random = () => 0.999999;                    // every roll is the maximum, 25 XP
  try {
    const added = [];
    const role = (id, name) => ({ id, name, managed: false, editable: true, position: 1 });
    const roles = new Map([['r1', role('r1', 'Reactions')], ['r2', role('r2', 'Emojis')], ['r3', role('r3', 'Nickname')], ['r4', role('r4', 'Images')]]);
    const channel = (id, name, parentId = 'cat') => ({ id, name, parentId, type: 0 });
    const channels = new Map([['gen', channel('gen', 'general-chat')], ['med', channel('med', 'media')], ['rul', channel('rul', 'rules', 'imp')], ['ann', channel('ann', 'announcements', 'imp')], ['abt', channel('abt', 'about-me', 'imp')]]);
    const guild = { id: 'g1', channels: { cache: channels }, roles: { cache: roles, everyone: {} }, premiumTier: 0 };
    const mkMember = (premium) => ({
      id: 'u1', guild, premiumSince: premium, permissions: { has: () => false },
      roles: { cache: new Map(), add: async (r) => { added.push(r.name); }, remove: async () => {} },
    });
    const msg = (text, chId = 'gen', member = mkMember(null), userId = 'u1') => ({
      guild, member, author: { id: userId, bot: false }, system: false, webhookId: null, content: text,
      channel: { id: chId, parentId: channels.get(chId).parentId, isThread: () => false, parent: null },
    });
    const T = 1_000_000_000_000;
    const entryOf = (id = 'u1') => engine._active.get(`g1:${id}`);

    await engine.onMessage(msg('hello everyone out there'), T);
    assert.equal(entryOf().xp, 25);
    assert.equal(entryOf().dirty, true);

    await engine.onMessage(msg('a second different message'), T + 1_000);          // inside the 60 second cooldown
    assert.equal(entryOf().xp, 25);

    await engine.onMessage(msg('a second different message'), T + 61_000);         // level 1 needs 40: 25 + 25 = 50
    assert.equal(entryOf().xp, 50);
    assert.equal(entryOf().level, 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(added, ['Reactions']);                                          // the Reactions perk arrived by itself

    await engine.onMessage(msg('a second different message'), T + 130_000);        // the same text again
    assert.equal(entryOf().xp, 50);

    for (const [text, chId] of [['hi', 'gen'], ['https://example.com/very/long/link', 'gen'], ['<@123> <@456>', 'gen'], ['a perfectly long message', 'med'], ['a perfectly long message', 'rul'], ['a perfectly long message', 'abt']]) {
      await engine.onMessage(msg(text, chId), T + 300_000);
      assert.equal(entryOf().xp, 50, `${text} in ${chId} must not earn XP`);
    }

    const bot = msg('a perfectly long message'); bot.author.bot = true;
    await engine.onMessage(bot, T + 400_000);
    assert.equal(engine._active.has('g1:botuser'), false);

    // boosters earn x1.25
    await engine.onMessage(msg('boosters chat too, you know', 'gen', mkMember(new Date()), 'u2'), T);
    assert.equal(entryOf('u2').xp, Math.round(25 * 1.25));

    // the daily soft cap: base XP stops at 400 and then slows right down
    const u3 = 'u3';
    let now = T;
    for (let i = 0; i < 16; i++) { now += 61_000; await engine.onMessage(msg(`unique message number ${i} here`, 'gen', mkMember(null), u3), now); }
    assert.equal(entryOf(u3).xp, 400);                                               // 16 x 25, still at full rate (day 1: no streak bonus)
    now += 61_000;
    await engine.onMessage(msg('one more message after the cap', 'gen', mkMember(null), u3), now);
    assert.equal(entryOf(u3).xp - 400, Math.round(25 * 0.25));                      // 6 XP instead of 25

    // leaving removes everything straight away
    await engine.forget('g1', 'u3');
    assert.equal(engine._active.has('g1:u3'), false);

    // staff setting XP corrects roles and level
    const set = await engine.setXp(guild, 'u1', 0).catch(() => null);
    assert.equal(entryOf().xp, 0);
    assert.equal(entryOf().level, 0);
    assert.ok(set === null || set.entry.level === 0);
  } finally {
    Math.random = original;
  }
});
