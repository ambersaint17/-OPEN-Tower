const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const emojis = require('../src/emojis');
const { matchesChannelName } = require('../src/lib/channels');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('every emoji Tower references exists as a file and is uploaded at startup', () => {
  const files = ['src/modules/verification/views.js', 'src/modules/logging/views.js', 'src/modules/moderation/views.js', 'src/modules/tickets/views.js', 'src/modules/levels/views.js', 'src/commands/ticket.js', 'src/commands/level.js', 'src/commands/levels.js', 'src/commands/booster.js', 'src/commands/emoji.js', 'src/commands/logs.js', 'src/ui.js']
    .concat(require('node:fs').readdirSync(path.join(root, 'src/events')).map((f) => `src/events/${f}`));
  const sources = files.map(read).join('\n');
  const used = new Set();
  for (const re of [/icon:\s*'([a-z_]+)'/g, /\bic\('([a-z_]+)'\)/g, /[)\]'],\s*'([a-z_]+)'\],?\s*$/gm, /heading\('([a-z_]+)'/g]) {
    for (const m of sources.matchAll(re)) used.add(m[1]);
  }
  assert.ok(used.size > 20, `expected many emoji keys, found ${used.size}`);
  for (const key of used) {
    assert.ok(emojis.UI_KEYS.includes(key), `"${key}" is used in the UI but missing from UI_KEYS`);
  }
});

test('all configured emoji files exist and are valid PNGs', () => {
  for (const key of [...emojis.UI_KEYS, ...emojis.SERVER_KEYS]) {
    const file = emojis.fileFor(key);
    assert.ok(fs.existsSync(file), `missing ${file}`);
    assert.equal(fs.readFileSync(file).subarray(1, 4).toString(), 'PNG');
  }
});

test('emoji names are valid for Discord (2-32 chars, letters, digits, underscore)', () => {
  for (const key of [...emojis.UI_KEYS, ...emojis.SERVER_KEYS]) {
    assert.match(emojis.nameFor(key), /^[A-Za-z0-9_]{2,32}$/);
  }
});

test('the server set fits inside a level 0 server', () => {
  assert.ok(emojis.SERVER_KEYS.length <= emojis.serverEmojiLimit(0));
  assert.equal(new Set(emojis.SERVER_KEYS).size, emojis.SERVER_KEYS.length);
});

test('emoji helpers render when loaded and vanish gracefully when not', () => {
  emojis._clear();
  assert.equal(emojis.e('check'), '');
  assert.equal(emojis.ic('check'), '');
  assert.equal(emojis.object('check'), undefined);
  emojis.register('check', { id: '123', name: 'tower_check' });
  assert.equal(emojis.e('check'), '<:tower_check:123>');
  assert.equal(emojis.ic('check'), '<:tower_check:123> ');
  assert.deepEqual(emojis.object('check'), { id: '123', name: 'tower_check' });
  emojis._clear();
});

test('channel lookup matches decorated names but not look-alikes', () => {
  assert.equal(matchesChannelName('rules', 'rules'), true);
  assert.equal(matchesChannelName('📜｜rules', 'rules'), true);
  assert.equal(matchesChannelName('📜 | rules', 'rules'), true);
  assert.equal(matchesChannelName('📢｜announcements', 'announcements'), true);
  assert.equal(matchesChannelName('community-announcements', 'announcements'), false);
  assert.equal(matchesChannelName('staff-announcements', 'announcements'), false);
  assert.equal(matchesChannelName('💬｜general-chat', 'general-chat'), true);
  assert.equal(matchesChannelName('about-me', 'about-me'), true);
});

test('the footer brand defaults to Tower, with no custom emoji, and carries no server-specific values', () => {
  const { brand } = require('../src/constants');
  assert.equal(brand.name, 'Tower');
  assert.equal(brand.emoji, '');
  const constants = fs.readFileSync(path.join(root, 'src/constants.js'), 'utf8');
  assert.doesNotMatch(constants, /\d{17,20}/, 'no hardcoded Discord IDs in constants.js');
});

test('slash command text stays inside Discord limits', () => {
  const dir = path.join(root, 'src/commands');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of source.matchAll(/\.setDescription\('((?:[^'\\]|\\.)*)'\)/g)) {
      assert.ok(m[1].length >= 1 && m[1].length <= 100, `${file}: description over 100 characters: ${m[1]}`);
    }
    for (const m of source.matchAll(/\.setName\('([^']*)'\)/g)) {
      assert.match(m[1], /^[a-z0-9_-]{1,32}$/, `${file}: bad command or option name "${m[1]}"`);
    }
  }
});
