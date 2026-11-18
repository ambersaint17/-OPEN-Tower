const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'assets', 'emojis');
const PREFIX = 'tower_';

// Emojis Tower itself uses in its messages. They are uploaded as APPLICATION emojis,
// which belong to the bot, work in every server and use no server emoji slots.
const UI_KEYS = [
  'shield', 'verified', 'play', 'unlock', 'lock', 'question', 'video', 'chat', 'gift', 'ticket',
  'hourglass', 'clock', 'key', 'loading', 'welcome', 'check', 'cross', 'ban', 'warning', 'radar',
  'user', 'hash', 'calendar', 'scroll', 'bell', 'staff', 'code', 'flag', 'star', 'leave', 'wrench', 'terminal',
  'join', 'edit', 'trash', 'image', 'mic', 'headphones', 'link', 'cpu', 'zap', 'globe', 'crown', 'gem',
  'heart', 'party', 'level_up', 'users', 'eye', 'info', 'arrow_right', 'plus', 'minus',
  'mute', 'folder', 'stats', 'search', 'trophy', 'medal', 'game', 'sparkle', 'fire', 'settings',
];

// Emojis for members to use in the server itself, most important first.
// A server without boosts only has 50 emoji slots, so Tower stops when the slots run out.
const SERVER_KEYS = [
  'check', 'cross', 'heart', 'fire', 'star', 'sparkle', 'party', 'rocket', 'zap',
  'upvote', 'downvote', 'welcome', 'verified', 'jet', 'code', 'git', 'terminal', 'video', 'live',
  'announce', 'bell', 'gift', 'trophy', 'medal', 'crown', 'gem', 'level_up', 'chat', 'question',
  'info', 'warning', 'shield', 'scroll', 'rules', 'ticket', 'calendar', 'clock', 'music', 'headphones',
  'mic', 'game', 'camera', 'user', 'users', 'link', 'radar', 'target',
];

const registry = new Map(); // key -> { id, name }

const fileFor = (key) => path.join(DIR, `${PREFIX}${key}.png`);
const nameFor = (key) => `${PREFIX}${key}`;

// "<:tower_check:123>" or "" when the emoji is not loaded, so messages degrade gracefully.
function e(key) {
  const entry = registry.get(key);
  return entry ? `<:${entry.name}:${entry.id}>` : '';
}

// Emoji followed by a space, or nothing. Handy for building lines.
function ic(key) {
  const text = e(key);
  return text ? `${text} ` : '';
}

// { id, name } for ButtonBuilder#setEmoji, or undefined.
function object(key) {
  const entry = registry.get(key);
  return entry ? { id: entry.id, name: entry.name } : undefined;
}

function register(key, emoji) {
  registry.set(key, { id: emoji.id, name: emoji.name });
}

async function syncApplicationEmojis(client) {
  const existing = await client.application.emojis.fetch();
  let created = 0;
  for (const key of UI_KEYS) {
    let emoji = existing.find((x) => x.name === nameFor(key));
    if (!emoji) {
      if (!fs.existsSync(fileFor(key))) {
        console.warn(`[emoji] missing file for "${key}"`);
        continue;
      }
      emoji = await client.application.emojis.create({ attachment: fileFor(key), name: nameFor(key) });
      created++;
    }
    register(key, emoji);
  }
  console.log(`[emoji] ${registry.size}/${UI_KEYS.length} application emojis ready (${created} newly uploaded)`);
}

const loadedCount = () => registry.size;

function serverEmojiLimit(premiumTier) {
  return [50, 100, 150, 250][premiumTier] ?? 50;
}

module.exports = {
  UI_KEYS, SERVER_KEYS, PREFIX, fileFor, nameFor,
  e, ic, object, register, loadedCount, syncApplicationEmojis, serverEmojiLimit,
  _clear: () => registry.clear(),
};
