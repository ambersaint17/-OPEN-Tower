const test = require('node:test');
const assert = require('node:assert/strict');
const { assessAccount } = require('../src/lib/risk');
const { RaidDetector } = require('../src/lib/raid');
const codes = require('../src/lib/codes');

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 19);
const user = (ageDays, avatar = 'abc') => ({ createdTimestamp: NOW - ageDays * DAY, avatar });

test('accounts under 7 days are tier 3', () => {
  assert.equal(assessAccount(user(2), NOW).tier, 3);
  assert.equal(assessAccount(user(6.9), NOW).tier, 3);
});

test('accounts 7 to 30 days are tier 2, older are tier 1', () => {
  assert.equal(assessAccount(user(7), NOW).tier, 2);
  assert.equal(assessAccount(user(29), NOW).tier, 2);
  assert.equal(assessAccount(user(30), NOW).tier, 1);
  assert.equal(assessAccount(user(900), NOW).tier, 1);
});

test('no avatar lifts an old account to tier 2 but never lowers a new one', () => {
  assert.equal(assessAccount(user(900, null), NOW).tier, 2);
  assert.equal(assessAccount(user(2, null), NOW).tier, 3);
});

test('raid trips on the 10th join inside 10 seconds', () => {
  const d = new RaidDetector({ threshold: 10, windowMs: 10_000 });
  let count = 0;
  for (let i = 0; i < 9; i++) count = d.record('g', NOW + i * 500);
  assert.equal(d.isRaid(count), false);
  count = d.record('g', NOW + 9 * 500);
  assert.equal(d.isRaid(count), true);
});

test('slow joins never trip raid mode', () => {
  const d = new RaidDetector({ threshold: 10, windowMs: 10_000 });
  let count = 0;
  for (let i = 0; i < 40; i++) count = d.record('g', NOW + i * 2_000);
  assert.equal(d.isRaid(count), false);
});

test('raid windows are tracked per guild', () => {
  const d = new RaidDetector({ threshold: 3, windowMs: 10_000 });
  d.record('a', NOW); d.record('a', NOW + 1); 
  assert.equal(d.record('b', NOW + 2), 1);
});

test('codes use only the safe charset and the requested length', () => {
  for (const len of [5, 6, 7]) {
    const c = codes.generateCode(len);
    assert.equal(c.length, len);
    assert.match(c, new RegExp(`^[${codes.CHARSET}]+$`));
  }
  assert.doesNotMatch(codes.CHARSET, /[ILOSZB0125 8]/);
});

test('matching is case, space and dash insensitive but exact otherwise', () => {
  const secret = 's3cret';
  const h = codes.hashCode(secret, 'g', 'u', 'AC3D9');
  assert.equal(codes.matches(secret, 'g', 'u', ' ac3-d9 ', h), true);
  assert.equal(codes.matches(secret, 'g', 'u', 'AC3D8', h), false);
  assert.equal(codes.matches(secret, 'g', 'other', 'AC3D9', h), false);
  assert.equal(codes.matches('wrong', 'g', 'u', 'AC3D9', h), false);
});
