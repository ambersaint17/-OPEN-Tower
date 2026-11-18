const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Loads constants.js in a fresh process, so the override file is read from scratch.
function load(config, env = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tower-cfg-')), 'tower.config.json');
  if (config !== null) fs.writeFileSync(file, typeof config === 'string' ? config : JSON.stringify(config));
  const code = `const c = require('./src/constants'); console.log(JSON.stringify({ name: c.brand.name, emoji: c.brand.emoji, lead: c.staff.leadershipRoles, label: c.tickets.types.support.label, icon: c.tickets.types.support.icon, report: c.tickets.types.report.label }));`;
  const run = spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, TOWER_CONFIG: file, ...env }, encoding: 'utf8' });
  return { out: run.stdout.trim().split('\n').pop(), err: run.stderr, status: run.status };
}

test('with no config file the defaults are used', () => {
  const r = load(null);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.out);
  assert.equal(v.name, 'Tower'); assert.equal(v.label, 'General Support');
});

test('overrides merge key by key, replace arrays and ignore unknown or underscore keys', () => {
  const r = load({ _note: 'x', brand: { name: 'Skyline' }, staff: { leadershipRoles: ['Boss'] }, tickets: { types: { support: { label: 'Help Desk' } } }, nonsense: 1 });
  const v = JSON.parse(r.out);
  assert.equal(v.name, 'Skyline');
  assert.deepEqual(v.lead, ['Boss']);
  assert.equal(v.label, 'Help Desk');
  assert.equal(v.icon, 'question', 'untouched keys keep their default');
  assert.equal(v.report, 'Report a Member');
  assert.match(r.err, /unknown setting "nonsense"/);
});

test('a broken config file falls back to the defaults instead of crashing', () => {
  const r = load('{ not json');
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.out).name, 'Tower');
  assert.match(r.err, /could not read/);
});

test('BOT_NAME and BRAND_EMOJI set the footer brand', () => {
  const v = JSON.parse(load(null, { BOT_NAME: 'Harbor', BRAND_EMOJI: '<:h:123456789012345678>' }).out);
  assert.equal(v.name, 'Harbor'); assert.equal(v.emoji, '<:h:123456789012345678>');
});

test('tower.config.example.json is valid and every setting in it is a real one', () => {
  const example = fs.readFileSync(path.join(__dirname, '..', 'tower.config.example.json'), 'utf8');
  const r = load(example);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.err, /unknown setting|could not read/);
  assert.equal(JSON.parse(r.out).name, 'Your Bot Name');
});
