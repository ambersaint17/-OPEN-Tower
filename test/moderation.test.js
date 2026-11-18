const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration, formatDuration, DISCORD_MAX_TIMEOUT_MS } = require('../src/modules/moderation/duration');
const { levelFor, can, maxTimeoutMs, rankLabel } = require('../src/modules/moderation/permissions');
const { checkTarget } = require('../src/modules/moderation/checks');
const pending = require('../src/modules/moderation/pending');
const { statsTable, totals, topAction, teamTable } = require('../src/lib/stats');
const { caseLabel } = require('../src/lib/text');

const H = 3_600_000;
const D = 24 * H;

test('durations parse the way staff type them', () => {
  assert.equal(parseDuration('30m'), 30 * 60_000);
  assert.equal(parseDuration('2h'), 2 * H);
  assert.equal(parseDuration('1d12h'), 36 * H);
  assert.equal(parseDuration('1w'), 7 * D);
  assert.equal(parseDuration(' 1H 30M '), 90 * 60_000);
  for (const bad of ['', 'abc', '10', '5x', '-5m', '0m', '1.5h', 'm5']) assert.equal(parseDuration(bad), null, bad);
  assert.equal(DISCORD_MAX_TIMEOUT_MS, 28 * D);
});

test('durations are shown in a short readable form', () => {
  assert.equal(formatDuration(90 * 60_000), '1h 30m');
  assert.equal(formatDuration(36 * H), '1d 12h');
  assert.equal(formatDuration(28 * D), '28d');
  assert.equal(formatDuration(0), '0s');
});

test('staff ranks come from role names, ignoring case and punctuation', () => {
  assert.equal(levelFor(['Trial Moderator']), 1);
  assert.equal(levelFor(['trial-moderator', 'Moderator']), 2);
  assert.equal(levelFor(['Head Moderator', 'Member']), 3);
  assert.equal(levelFor(['Co-Owner']), 4);
  assert.equal(levelFor(['Member', 'Moderation Team', 'Staff']), 0); // generic team roles grant nothing
  assert.equal(levelFor([], { isAdmin: true }), 4);
  assert.equal(levelFor(['Trial Moderator'], { isOwner: true }), 5);
});

test('the permission matrix matches the plan', () => {
  assert.equal(can(1, 'warn'), true);
  assert.equal(can(1, 'timeout'), true);
  assert.equal(can(1, 'kick'), false);
  assert.equal(can(2, 'kick'), true);
  assert.equal(can(2, 'ban'), false);
  assert.equal(can(3, 'ban'), true);
  assert.equal(can(3, 'voidCase'), true);
  assert.equal(can(2, 'voidCase'), false);
  assert.equal(can(1, 'modstats'), true);   // every moderator can see their own stats
  assert.equal(can(2, 'statsOthers'), false);
  assert.equal(can(3, 'statsTeam'), true);
  assert.equal(can(0, 'warn'), false);      // non-staff can do nothing
  assert.equal(can(5, 'ban'), true);
  assert.equal(can(5, 'somethingUnknown'), false); // unknown actions are denied by default
});

test('timeout length limits grow with rank and never pass Discord\'s cap', () => {
  assert.equal(maxTimeoutMs(1), H);
  assert.equal(maxTimeoutMs(2), D);
  assert.equal(maxTimeoutMs(3), 28 * D);
  assert.equal(maxTimeoutMs(5), 28 * D);
  assert.equal(maxTimeoutMs(0), 0);
  for (let l = 0; l <= 5; l++) assert.ok(maxTimeoutMs(l) <= DISCORD_MAX_TIMEOUT_MS);
  assert.equal(rankLabel(0), 'No staff rank');
  assert.equal(rankLabel(2), 'Moderator');
  assert.equal(rankLabel(5), 'Owner');
});

const member = (id, position) => ({ id, roles: { highest: { position } } });
const world = { botMember: member('bot', 50), ownerId: 'owner' };

test('nobody can act on themselves, bots, Tower or the owner', () => {
  const mod = member('mod', 10);
  const run = (targetUser, target) => checkTarget({ action: 'ban', moderator: mod, target, targetUser, ...world });
  assert.match(run({ id: 'mod' }, mod), /yourself/);
  assert.match(run({ id: 'bot' }, world.botMember), /Tower/);
  assert.match(run({ id: 'x', bot: true }, member('x', 1)), /bot/);
  assert.match(run({ id: 'owner' }, member('owner', 1)), /owner/);
  assert.equal(run({ id: 'ok' }, member('ok', 1)), null);
});

test('rank hierarchy is enforced for the moderator and for Tower', () => {
  const mod = member('mod', 10);
  const check = (target, extra = {}) => checkTarget({ action: 'kick', moderator: mod, target, targetUser: { id: target.id }, ...world, ...extra });
  assert.match(check(member('peer', 10)), /same or a higher/);
  assert.match(check(member('boss', 20)), /same or a higher/);
  assert.match(check(member('tall', 60), { moderator: member('mod', 70) }), /Tower's role is not high enough/);
  assert.equal(check(member('low', 5)), null);
  // the owner ignores the hierarchy between staff
  assert.equal(checkTarget({ action: 'kick', moderator: member('owner', 5), target: member('boss', 20), targetUser: { id: 'boss' }, ...world }), null);
  // warnings do not need Tower to outrank the member
  assert.equal(check(member('low', 60), { moderator: member('mod', 70), needsBotRank: false }), null);
  // banning someone who already left has no member to compare
  assert.equal(checkTarget({ action: 'ban', moderator: mod, target: null, targetUser: { id: 'gone' }, ...world }), null);
});

test('a pending ban can be confirmed once, only by the moderator who asked, and expires', () => {
  pending._clear();
  const t = { now: 0 };
  const token = pending.add({ moderatorId: 'mod', userId: 'u' }, () => t.now);
  assert.equal(pending.take(token, 'someone-else', () => t.now), null);   // wrong person does not burn it
  assert.equal(pending.take(token, 'mod', () => t.now).userId, 'u');
  assert.equal(pending.take(token, 'mod', () => t.now), null);            // only once
  const late = pending.add({ moderatorId: 'mod' }, () => t.now);
  t.now = 61_000;
  assert.equal(pending.take(late, 'mod', () => t.now), null);             // expired
  assert.equal(pending._size(), 0);
});

test('the stats table and totals add up', () => {
  const rows = [
    { type: 'warn', d7: 2, d30: 5, total: 12 },
    { type: 'timeout', d7: 1, d30: 2, total: 4 },
    { type: 'kick', d7: 0, d30: 1, total: 3 },
    { type: 'ban', d7: 0, d30: 0, total: 1 },
  ];
  assert.deepEqual(totals(rows), { d7: 3, d30: 8, total: 20 });
  assert.equal(topAction(rows), 'Warns');
  assert.equal(topAction([]), null);
  const table = statsTable(rows);
  const lines = table.split('\n');
  assert.equal(lines.length, 8);                        // header + 7 action types
  assert.match(lines[1], /^Warns\s+2\s+5\s+12$/);
  assert.match(lines[7], /^Notes\s+0\s+0\s+0$/);        // missing types show as zero
  assert.equal(new Set(lines.map((l) => l.length)).size, 1, 'columns must line up');
});

test('the team table keeps every row the same width', () => {
  const lines = teamTable([
    { tag: 'Patrick Jane', warns: 3, timeouts: 1, kicks: 0, bans: 0, total: 4 },
    { tag: 'a-very-long-moderator-name-indeed', warns: 10, timeouts: 22, kicks: 3, bans: 1, total: 36 },
  ]).split('\n');
  assert.equal(new Set(lines.map((l) => l.length)).size, 1);
});

test('case numbers are padded', () => {
  assert.equal(caseLabel(7), '#0007');
  assert.equal(caseLabel(12345), '#12345');
});
