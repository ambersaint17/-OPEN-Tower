const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/modules/help/catalog');
const views = require('../src/modules/help/views');
const registry = require('../src/commands');

const viewer = (over = {}) => ({ level: 0, roleNames: [], memberLevel: 0, booster: false, ...over });
const keys = (v) => catalog.visibleSections(v).map((s) => s.key);
const usages = (v) => catalog.visibleSections(v).flatMap((s) => s.commands.map((c) => c.usage));

test('a normal member only sees member commands', () => {
  assert.deepEqual(keys(viewer()), ['everyone', 'perks']);
  const all = usages(viewer());
  assert.ok(all.includes('/level') && all.includes('/help'));
  assert.ok(!all.some((u) => /warn|ban|kick|embed|giveaway start|youtube|earlyaccess/.test(u)));
});

test('staff see their own tools and everything below them, never above', () => {
  assert.deepEqual(keys(viewer({ level: 1 })), ['everyone', 'perks', 'rank1']);
  assert.deepEqual(keys(viewer({ level: 2 })), ['everyone', 'perks', 'rank1', 'rank2']);
  assert.deepEqual(keys(viewer({ level: 3 })), ['everyone', 'perks', 'rank1', 'rank2', 'rank3']);
  const admin = keys(viewer({ level: 4 }));
  assert.ok(admin.includes('rank4') && !admin.includes('rank5'));
  assert.ok(keys(viewer({ level: 5 })).includes('rank5'));
  const mod = usages(viewer({ level: 2 }));
  assert.ok(mod.includes('/warn') && mod.includes('/kick') && mod.includes('/giveaway verify'));
  assert.ok(!mod.includes('/ban') && !mod.some((u) => u.startsWith('/embed')));
});

test('level and booster perks are shown as unlocked or locked with the reason', () => {
  const state = (v, usage) => catalog.visibleSections(v).flatMap((s) => s.commands).find((c) => c.usage === usage).state;
  assert.deepEqual(state(viewer({ memberLevel: 5 }), '/colour'), { locked: 'Unlocks at level 6' });
  assert.equal(state(viewer({ memberLevel: 6 }), '/colour'), 'unlocked');
  assert.deepEqual(state(viewer({ memberLevel: 7 }), '/qotd suggest'), { locked: 'Unlocks at level 8' });
  assert.equal(state(viewer({ memberLevel: 8 }), '/qotd suggest'), 'unlocked');
  assert.equal(state(viewer({ booster: true }), '/colour'), 'unlocked');            // boosters get colours instantly
  assert.deepEqual(state(viewer(), '/booster colour'), { locked: 'Server boosters only' });
  assert.equal(state(viewer({ booster: true }), '/booster colour'), 'unlocked');
});

test('the Community Team section appears for QOTD managers and administrators only', () => {
  assert.ok(!keys(viewer()).includes('team'));
  assert.ok(keys(viewer({ roleNames: ['Community Agent'] })).includes('team'));
  assert.ok(keys(viewer({ level: 4 })).includes('team'));
  assert.ok(!keys(viewer({ level: 2 })).includes('team'));
});

test('every command Tower registers is listed in /help', () => {
  const listed = new Set(catalog.COMMANDS.filter((c) => c.usage.startsWith('/')).map((c) => catalog.nameOf(c.usage).slice(1)));
  for (const name of registry.commands.keys()) assert.ok(listed.has(name), `/${name} is registered but missing from the help catalog`);
});

test('the help card has an overview and a menu with only the sections you may open', () => {
  const sections = catalog.visibleSections(viewer({ level: 1 }));
  const card = views.helpCard(sections, viewer({ level: 1 })).toJSON();
  const text = JSON.stringify(card);
  assert.match(text, /Tower Help/);
  assert.match(text, /warn/);
  assert.doesNotMatch(text, /\/ban|earlyaccess/);
  const menu = card.components.find((c) => c.type === 1).components[0];
  assert.equal(menu.custom_id, 'help:view');
  assert.deepEqual(menu.options.map((o) => o.value), ['overview', 'everyone', 'perks', 'rank1']);
  const detail = JSON.stringify(views.helpCard(sections, viewer({ level: 1 }), 'rank1').toJSON());
  assert.match(detail, /Warn a member/);
});
