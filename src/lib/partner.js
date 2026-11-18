// Pure logic for partnerships: cleaning an ad, working out the ping, and checking a partner before the ad goes out.
const { partners: cfg } = require('../constants');
const { findInvites, findBannedWord } = require('./automod');

const ZWSP = '\u200b';

// A pasted ad must never ping anyone by itself: only the ping chosen in the command may.
function sanitizeAd(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trim()
    .replace(/@(everyone|here)/gi, `@${ZWSP}$1`)
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/\n{4,}/g, '\n\n\n');
}

// The ping as stored ("none", "here", "everyone", "role:<id>") and what it means for the message.
function parsePing({ ping = 'none', roleId = null } = {}) {
  if (roleId) return { key: `role:${roleId}`, text: `<@&${roleId}>`, allowedMentions: { parse: [], roles: [roleId] }, label: 'a role' };
  if (ping === 'everyone') return { key: 'everyone', text: '@everyone', allowedMentions: { parse: ['everyone'] }, label: '@everyone' };
  if (ping === 'here') return { key: 'here', text: '@here', allowedMentions: { parse: ['everyone'] }, label: '@here' };
  return { key: 'none', text: '', allowedMentions: { parse: [] }, label: 'no ping' };
}
const isLoudPing = (key) => key === 'everyone' || key === 'here';

const inviteUrl = (code) => `https://discord.gg/${code}`;

// ---------- images in the ad ----------
const IMAGE_URL = /https?:\/\/[^\s<>)\]]+?\.(?:png|jpe?g|gif|webp)(?:\?[^\s<>)\]]*)?/gi;
const DISCORD_ATTACHMENT = /https?:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/[^\s<>)\]]+/gi;
const isDiscordCdn = (url) => /^https?:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\//i.test(url);
const hasImageExtension = (url) => /\.(?:png|jpe?g|gif|webp)(?:\?|$)/i.test(url.split('#')[0]);

// Picture links in the ad are lifted out of the text so they can be shown as pictures.
// Returns the text without them and the list (Discord's own links are flagged, because those expire and are copied instead).
function extractImages(text, max = cfg.maxImages) {
  const found = [];
  const take = (m) => { if (!found.includes(m)) found.push(m); return ''; };
  let out = String(text).replace(DISCORD_ATTACHMENT, (m) => (hasImageExtension(m) ? take(m) : m));
  out = out.replace(IMAGE_URL, (m) => take(m));
  const tidy = out.replace(/\[([^\]]*)\]\(\s*\)/g, '$1').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: tidy, images: found.slice(0, max).map((url) => ({ url, discord: isDiscordCdn(url) })), dropped: Math.max(0, found.length - max) };
}

// The invite becomes the Join button, so the first link to it is replaced by a pointer to the button and any others are removed.
// `[label](invite)` keeps its label. With keep = true the text is left alone.
function stripInvite(text, code, { keep = false } = {}) {
  if (keep || !code) return text;
  const c = String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const url = `(?:https?:\\/\\/)?(?:www\\.)?(?:discord(?:app)?\\.com\\/invite|discord\\.gg|dsc\\.gg|invite\\.gg)\\/${c}(?![a-z0-9-])`;
  let out = String(text).replace(new RegExp(`\\[([^\\]]*)\\]\\(\\s*${url}\\s*\\)`, 'gi'), '$1');
  let first = true;
  out = out.replace(new RegExp(url, 'gi'), () => { if (first) { first = false; return '👇'; } return ''; });
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// The first invite in the ad is the partner's own. Any others are mentioned to staff.
const invitesIn = (text) => findInvites(text);

// Checks before posting. Each finding is { level: 'block' | 'warn' | 'ok', text }. A block stops the post.
// info is what Discord says about the invite (or null when it could not be looked up).
function vet({ ad, invites, info, minMembers = 0, bannedWords = [], blacklisted = null, alreadyPartnered = false, imageProblems = [] }) {
  const f = [];
  if (!invites.length) f.push({ level: 'block', text: 'The ad has no Discord invite link, so there is nothing for members to join.' });
  else if (!info) f.push({ level: 'block', text: `The invite \`${invites[0]}\` is invalid or expired. Ask the partner for a working, permanent invite.` });
  if (invites.length > 1) f.push({ level: 'warn', text: `The ad contains ${invites.length} invite links. Only the first is used for the Join button.` });
  if (info) {
    if (blacklisted) f.push({ level: 'block', text: `${info.name} is on the partner blacklist${blacklisted.reason ? `: ${blacklisted.reason}` : ''}.` });
    if (alreadyPartnered) f.push({ level: 'warn', text: `${info.name} already has an active partnership.` });
    if (info.expiresAt) f.push({ level: 'warn', text: 'This invite expires. Ask for a permanent invite so the ad never goes stale.' });
    if (info.maxUses) f.push({ level: 'warn', text: `This invite is limited to ${info.maxUses} uses, so it will stop working.` });
    if (info.nsfwLevel && info.nsfwLevel > 0) f.push({ level: 'warn', text: 'Discord marks this server as age-restricted or explicit.' });
    if (minMembers > 0 && info.members != null && info.members < minMembers) f.push({ level: 'warn', text: `It has ${info.members.toLocaleString('en-US')} members, below your minimum of ${minMembers.toLocaleString('en-US')}.` });
    if (!f.some((x) => x.level === 'warn' || x.level === 'block')) f.push({ level: 'ok', text: `${info.name} checks out: a working permanent invite${info.members != null ? ` and ${info.members.toLocaleString('en-US')} members` : ''}.` });
  }
  for (const problem of imageProblems) f.push({ level: 'warn', text: problem });
  const banned = bannedWords.length ? findBannedWord(ad, bannedWords) : null;
  if (banned) f.push({ level: 'warn', text: 'The ad contains a word from your AutoMod banned list.' });
  if (ad.length > cfg.adMax) f.push({ level: 'block', text: `The ad is ${ad.length} characters. The limit is ${cfg.adMax}.` });
  return { findings: f, blocked: f.some((x) => x.level === 'block'), warned: f.some((x) => x.level === 'warn') };
}

// A server name to show: what the partner's invite says wins over what was typed.
const serverName = (info, typed) => (info?.name || String(typed ?? '').trim() || 'Partner Server').slice(0, 100);

module.exports = { extractImages, stripInvite, isDiscordCdn, sanitizeAd, parsePing, isLoudPing, inviteUrl, invitesIn, vet, serverName, ZWSP };
