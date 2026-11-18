// Preloaded by `npm test`: harmless placeholder settings so tests never need a real .env or a real database.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const defaults = {
  DISCORD_TOKEN: 'test-token', CLIENT_ID: '1', GUILD_ID: '1',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/test', CAPTCHA_SECRET: 'test-secret',
};
defaults.COMMISSION_REVIEW_CHANNEL_ID = '900000000000000099';
for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;

// Tower ships with no banner images, so the tests use a folder of tiny placeholder PNGs to exercise the banner code.
if (!process.env.BANNER_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-banners-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const names = ['panel-banner', 'verification', 'tickets', 'moderation', 'levels', 'boost', 'youtube', 'earlyaccess', 'qotd', 'giveaway', 'commission', 'staff', 'partner'];
  for (const n of names) fs.writeFileSync(path.join(dir, n === 'panel-banner' ? 'panel-banner.png' : `banner-${n}.png`), png);
  process.env.BANNER_DIR = dir;
}
