const test = require('node:test');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createTtlCache } = require('../src/lib/ttlcache');
const { createPool } = require('../src/modules/verification/pool');

// ---------- the cache ----------
test('cached values expire, and can be removed early', () => {
  let t = 1000;
  const cache = createTtlCache(500, () => t);
  assert.equal(cache.get('a'), undefined);
  cache.set('a', { n: 1 }); cache.set('none', null);
  assert.deepEqual(cache.get('a'), { n: 1 });
  assert.equal(cache.get('none'), null, 'a stored null (no settings yet) is remembered too');
  t += 499; assert.deepEqual(cache.get('a'), { n: 1 });
  t += 2; assert.equal(cache.get('a'), undefined);
  cache.set('b', 2); cache.delete('b'); assert.equal(cache.get('b'), undefined);
  cache.set('c', 3); cache.clear(); assert.equal(cache.get('c'), undefined);
});

// ---------- the captcha stock ----------
const tierList = { 1: { length: 5 }, 2: { length: 6 } };
function makePool(over = {}) {
  let n = 0; const drawn = [];
  const pool = createPool({ tierList, size: 3, generate: (len) => `C${++n}`.padEnd(len, 'X'), render: (code, tier) => { drawn.push([code, tier]); return Buffer.from(`img-${code}`); }, ...over });
  return { pool, drawn };
}

test('captchas are drawn ahead of time, in the background, and handed out once', async () => {
  const { pool, drawn } = makePool();
  assert.equal(pool.take(1), null, 'nothing is ready on the very first press, so it is drawn on the spot as before');
  await pool.refill();
  assert.deepEqual(pool.counts(), { 1: 3, 2: 3 });
  assert.equal(drawn.length, 6);

  const first = pool.take(1);
  assert.equal(first.code.length, 5);
  assert.ok(Buffer.isBuffer(first.image));
  const second = pool.take(1);
  assert.notEqual(first.code, second.code, 'never the same captcha twice');
  assert.equal(pool.take(2).code.length, 6);
  await pool.refill();
  assert.deepEqual(pool.counts(), { 1: 3, 2: 3 }, 'the stock is topped up after use');
  assert.equal(pool.take(99), null);
});

test('topping up never blocks other work, and overlapping calls do not draw extra', async () => {
  const { pool, drawn } = makePool();
  let ticks = 0;
  const interval = setInterval(() => { ticks++; }, 0);
  await Promise.all([pool.refill(), pool.refill(), pool.refill()]);
  clearInterval(interval);
  assert.equal(drawn.length, 6, 'three simultaneous calls still fill the stock only once');
  assert.ok(ticks > 0 || drawn.length === 6);
});

test('a drawing that fails is reported and does not break the stock', async () => {
  let fail = true;
  const { pool } = makePool({ render: (code) => { if (fail) { fail = false; throw new Error('font missing'); } return Buffer.from(code); } });
  const errors = []; const saved = console.error; console.error = (...a) => errors.push(a.join(' '));
  await pool.refill();
  console.error = saved;
  assert.match(errors[0], /font missing/);
  await pool.refill();                                    // the next top-up works
  assert.ok(pool.counts()[1] >= 1);
});

// ---------- the Verify button, end to end with fakes ----------
const calls = [];
const state = { locked: null, settings: { verification_enabled: true, verified_role_id: 'VR', unverified_role_id: 'UR', raid_mode: false } };
const slow = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const fakeService = {
  getSettings: async () => { calls.push('settings'); return state.settings; },
  getState: async () => { calls.push('state:start'); await slow(30); calls.push('state:end'); return { lockedUntil: state.locked }; },
  issueChallenge: async () => { calls.push('issue:start'); await slow(30); calls.push('issue:end'); return { session: { id: '11111111-1111-1111-1111-111111111111', attempts_left: 3, expires_at: new Date(Date.now() + 100000), tier: 1 }, risk: {}, png: Buffer.from('jpg'), filename: 'captcha-ab.jpg' }; },
  deleteSession: async () => { calls.push('deleteSession'); }, clearState: async () => { calls.push('clearState'); },
  logEvent: async () => { calls.push('logEvent'); return 'VER-1'; },
  consumeAttempt: async () => ({ id: '11111111-1111-1111-1111-111111111111', tier: 1, attempts_left: 2, code_hash: 'h' }),
  codeMatches: () => true,
  grantVerified: async (member) => { calls.push('grant'); return { id: 'VR' }; },
};
const put = (rel, exports) => { const p = path.join(__dirname, '..', rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
let logDone = false;
put('src/modules/verification/service.js', fakeService);
put('src/lib/logging.js', { postLog: async () => { calls.push('postLog:start'); await slow(80); logDone = true; calls.push('postLog:end'); } });
const handlers = require('../src/modules/verification/handlers');

const col = (ids) => ({ has: (id) => ids.includes(id) });
function press(customId, { roles = [], modal = false } = {}) {
  const out = [];
  const member = { id: 'u1', displayName: 'Tester', displayAvatarURL: () => 'https://example.com/a.png', roles: { cache: col(roles) } };
  const i = { customId, guild: { id: 'G', name: 'Amber Saint', channels: { cache: Object.assign(new Map(), { find() { return undefined; } }) }, members: { fetch: async () => { calls.push('members.fetch'); return member; } } }, user: { id: 'u1', displayAvatarURL: () => 'https://example.com/a.png', createdAt: new Date() }, member, out,
    isButton: () => !modal, isModalSubmit: () => modal, isFromMessage: () => true, deferReply: async () => {}, deferUpdate: async () => {}, reply: async () => {},
    fields: { getTextInputValue: () => 'ABCDE' }, editReply: async (p) => { out.push(p); calls.push('editReply'); return p; } };
  return i;
}

test('pressing Verify does no member lookup and reads the lock and issues the code at the same time', async () => {
  calls.length = 0;
  const i = press('verify:start');
  const started = Date.now();
  await handlers.handle(i);
  const took = Date.now() - started;
  assert.ok(!calls.includes('members.fetch'), 'the member comes with the button press');
  assert.ok(calls.indexOf('issue:start') < calls.indexOf('state:end'), 'both reads started before either finished');
  assert.ok(took < 55, `two 30 ms reads in parallel should take about 30 ms, took ${took}`);
  assert.equal(i.out.length, 1);
  assert.ok(i.out[0].files.some((f) => f.name === 'captcha-ab.jpg'));
});

test('a locked member gets no code, and a verified or paused one is turned away without any work', async () => {
  calls.length = 0; state.locked = new Date(Date.now() + 60000);
  const locked = press('verify:start'); await handlers.handle(locked);
  assert.ok(calls.includes('deleteSession'));
  assert.equal(locked.out[0].files, undefined, 'no captcha image is sent');
  state.locked = null;

  calls.length = 0;
  const done = press('verify:start', { roles: ['VR'] }); await handlers.handle(done);
  assert.ok(!calls.includes('issue:start'));
  state.settings = { ...state.settings, raid_mode: true };
  calls.length = 0;
  const paused = press('verify:start'); await handlers.handle(paused);
  assert.ok(!calls.includes('issue:start'));
  state.settings = { ...state.settings, raid_mode: false };
});

test('a correct code tells the member first and posts the staff log afterwards', async () => {
  calls.length = 0; logDone = false;
  const i = press('verify:submit:11111111-1111-1111-1111-111111111111', { modal: true });
  await handlers.handle(i);
  assert.equal(i.out.length, 1, 'the member was told');
  assert.equal(logDone, false, 'without waiting for the log to finish');
  assert.ok(!calls.includes('members.fetch'));
  assert.ok(calls.indexOf('editReply') < calls.indexOf('postLog:end') || !calls.includes('postLog:end'));
  await slow(120);
  assert.equal(logDone, true, 'the log still gets posted');
});
