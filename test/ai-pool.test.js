const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/modules/ai/pool');

const MAIN = 'nvidia/nemotron-3.5-super-vl:free'; const BACKUP = 'nvidia/nemotron-3.5-lightning:free';
const models = pool.listFor(MAIN, [BACKUP]);
const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };

test('the main model comes first, backups after it, and duplicates or blanks are dropped', () => {
  assert.deepEqual(pool.listFor(MAIN, [BACKUP, MAIN, '', null]), [MAIN, BACKUP]);
  assert.deepEqual(pool.listFor(MAIN), [MAIN]);
  assert.deepEqual(pool.listFor(null, []), []);
});

test('it stays on the main model, switches when it runs out, stays there, and comes back when the backup runs out', () => {
  pool.reset('g');
  const t0 = 1_000_000;
  assert.equal(pool.pick('g', models, t0), MAIN);

  quiet(() => pool.failed('g', models, MAIN, 60 * 60_000, t0));         // the main one runs out for an hour
  assert.equal(pool.pick('g', models, t0 + 1000), BACKUP);
  assert.equal(pool.pick('g', models, t0 + 10 * 60_000), BACKUP);       // still on the backup, even though time passes

  quiet(() => pool.failed('g', models, BACKUP, 5 * 60_000, t0 + 70 * 60_000));   // an hour later the backup runs out
  assert.equal(pool.pick('g', models, t0 + 70 * 60_000 + 1), MAIN);              // the main one has recovered, so back to it
});

test('when every model is resting there is nothing to pick, until one wakes up', () => {
  pool.reset('g2');
  const t0 = 5_000_000;
  quiet(() => { pool.failed('g2', models, MAIN, 10 * 60_000, t0); pool.failed('g2', models, BACKUP, 20 * 60_000, t0); });
  assert.equal(pool.pick('g2', models, t0 + 1000), null);
  assert.equal(pool.pick('g2', models, t0 + 11 * 60_000), MAIN);          // the main one woke up first
  quiet(() => pool.used('g2', models, MAIN));                              // and it answered, so it is the current one again
  assert.equal(pool.pick('g2', models, t0 + 21 * 60_000 + 1), MAIN);
});

test('servers do not affect each other, and the status shows who is active and who is resting', () => {
  pool.reset();
  const t0 = 9_000_000;
  quiet(() => pool.failed('a', models, MAIN, 30 * 60_000, t0));
  assert.equal(pool.pick('a', models, t0 + 1), BACKUP);
  assert.equal(pool.pick('b', models, t0 + 1), MAIN);
  const snap = pool.snapshot('a', models, t0 + 1);
  assert.deepEqual(snap.map((m) => [m.model, m.active, m.restingUntil !== null]), [[MAIN, false, true], [BACKUP, true, false]]);
  assert.equal(snap[0].restingUntil, t0 + 30 * 60_000);
  assert.deepEqual(pool.snapshot('a', [], t0), []);
});

test('with a single model there is only ever that one', () => {
  pool.reset('solo');
  assert.equal(pool.pick('solo', [MAIN]), MAIN);
  quiet(() => pool.failed('solo', [MAIN], MAIN, 60_000, 1000));
  assert.equal(pool.pick('solo', [MAIN], 2000), null);
  assert.equal(pool.pick('solo', [MAIN], 62_000), MAIN);
});
