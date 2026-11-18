const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');

// Banners are OPTIONAL. Tower ships without any, and every card simply has no banner image.
// To add your own, put PNG files in assets/images/ (or the folder set by BANNER_DIR) using the names below.
// Recommended size: 1600 x 280 pixels. Missing files are skipped silently, so add as many or as few as you like.
//   panel-banner.png         the general banner ("brand"): help, embed builder, verification panel
//   banner-<feature>.png     one per feature: verification, tickets, moderation, levels, boost, youtube,
//                            earlyaccess, qotd, giveaway, commission, staff, partner
const FILES = {
  brand: 'panel-banner.png',
  verification: 'banner-verification.png',
  tickets: 'banner-tickets.png',
  moderation: 'banner-moderation.png',
  levels: 'banner-levels.png',
  boost: 'banner-boost.png',
  youtube: 'banner-youtube.png',
  earlyaccess: 'banner-earlyaccess.png',
  qotd: 'banner-qotd.png',
  giveaway: 'banner-giveaway.png',
  commission: 'banner-commission.png',
  staff: 'banner-staff.png',
  partner: 'banner-partner.png',
};

const dir = () => (process.env.BANNER_DIR ? path.resolve(process.env.BANNER_DIR) : path.join(__dirname, '..', 'assets', 'images'));

const bannerName = (key = 'brand') => (key === 'brand' ? 'tower-banner.png' : `tower-banner-${key}.png`);
const BANNER_NAME = bannerName('brand');

// Checked once per key, so a missing banner costs nothing after the first lookup.
const present = new Map();
function hasBanner(key = 'brand') {
  if (!FILES[key]) return false;
  if (!present.has(key)) present.set(key, fs.existsSync(path.join(dir(), FILES[key])));
  return present.get(key);
}

// The banner keys that can actually be used right now (the embed builder only offers these).
const availableBanners = () => Object.keys(FILES).filter(hasBanner);

// null when this banner was not provided, so callers just skip it.
function bannerFile(key = 'brand') {
  if (!FILES[key]) throw new Error(`Unknown banner "${key}"`);
  if (!hasBanner(key)) return null;
  return new AttachmentBuilder(path.join(dir(), FILES[key]), { name: bannerName(key) });
}

module.exports = { FILES, BANNER_NAME, bannerName, bannerFile, hasBanner, availableBanners, _reset: () => present.clear() };
