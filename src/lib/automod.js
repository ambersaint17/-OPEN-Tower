// Pure logic for AutoMod: what counts as spam, mass mentions, links, shouting and banned words. No Discord calls in here.

// ---------- settings ----------
const DEFAULTS = {
  spam: { enabled: true, messages: 6, seconds: 8, duplicates: 3, duplicateSeconds: 30 },
  mentions: { enabled: true, max: 5 },
  links: { mode: 'invites', exemptLevel: 0, allowedDomains: [
    'youtube.com', 'youtu.be', 'twitch.tv', 'roblox.com', 'tenor.com', 'giphy.com', 'imgur.com', 'discord.com', 'discordapp.com',
    'github.com', 'x.com', 'twitter.com', 'tiktok.com', 'instagram.com', 'spotify.com', 'google.com', 'wikipedia.org',
  ] },
  formatting: { enabled: true, capsPercent: 70, capsMinLetters: 15, emojiMax: 12, zalgo: true },
  words: { enabled: true },
};
const LIMITS = {
  spam: { messages: [3, 20], seconds: [3, 30], duplicates: [2, 10], duplicateSeconds: [5, 120] },
  mentions: { max: [2, 30] }, links: { exemptLevel: [0, 10] }, formatting: { capsPercent: [50, 100], capsMinLetters: [8, 60], emojiMax: [5, 50] },
};
const clamp = (v, [lo, hi], fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

// Stored settings are merged over the defaults field by field, so a missing or damaged value can never break a rule.
function mergeConfig(stored = {}) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const d = DEFAULTS;
  return {
    spam: {
      enabled: bool(s.spam?.enabled, d.spam.enabled), messages: clamp(s.spam?.messages, LIMITS.spam.messages, d.spam.messages), seconds: clamp(s.spam?.seconds, LIMITS.spam.seconds, d.spam.seconds),
      duplicates: clamp(s.spam?.duplicates, LIMITS.spam.duplicates, d.spam.duplicates), duplicateSeconds: clamp(s.spam?.duplicateSeconds, LIMITS.spam.duplicateSeconds, d.spam.duplicateSeconds),
    },
    mentions: { enabled: bool(s.mentions?.enabled, d.mentions.enabled), max: clamp(s.mentions?.max, LIMITS.mentions.max, d.mentions.max) },
    links: {
      mode: ['off', 'invites', 'all'].includes(s.links?.mode) ? s.links.mode : d.links.mode, exemptLevel: clamp(s.links?.exemptLevel, LIMITS.links.exemptLevel, d.links.exemptLevel),
      allowedDomains: Array.isArray(s.links?.allowedDomains) ? [...new Set(s.links.allowedDomains.map(cleanDomain).filter(Boolean))].slice(0, 100) : [...d.links.allowedDomains],
    },
    formatting: {
      enabled: bool(s.formatting?.enabled, d.formatting.enabled), capsPercent: clamp(s.formatting?.capsPercent, LIMITS.formatting.capsPercent, d.formatting.capsPercent),
      capsMinLetters: clamp(s.formatting?.capsMinLetters, LIMITS.formatting.capsMinLetters, d.formatting.capsMinLetters), emojiMax: clamp(s.formatting?.emojiMax, LIMITS.formatting.emojiMax, d.formatting.emojiMax),
      zalgo: bool(s.formatting?.zalgo, d.formatting.zalgo),
    },
    words: { enabled: bool(s.words?.enabled, d.words.enabled) },
  };
}

// ---------- links and invites ----------
const INVITE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg|invite\.gg)\/([a-z0-9-]{2,32})/gi;
const URL_LIKE = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,24})(?::\d+)?(?:[/?#]\S*)?/gi;

function cleanDomain(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0];
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,24}$/.test(t) ? t : null;
}
const findInvites = (text) => [...new Set([...String(text).matchAll(INVITE)].map((m) => m[1].toLowerCase()))];

// Hostnames in a message. File names like "notes.txt" are not links, so only real-looking top level domains count.
const FILE_EXTENSIONS = new Set(['txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'pdf', 'zip', 'rar', 'js', 'json', 'lua', 'rbxm', 'rbxl', 'md', 'html', 'css', 'py', 'exe', 'doc', 'docx', 'csv', 'mp3', 'wav', 'ogg']);
function findHosts(text) {
  const hosts = [];
  const withoutInvites = String(text).replace(INVITE, ' ');
  for (const m of withoutInvites.matchAll(URL_LIKE)) {
    const host = m[1].toLowerCase().replace(/^www\./, '');
    const tld = host.split('.').pop();
    const hasScheme = /^https?:\/\//i.test(m[0]);
    if (!hasScheme && FILE_EXTENSIONS.has(tld)) continue;
    hosts.push(host);
  }
  return [...new Set(hosts)];
}
const isAllowedHost = (host, allowed) => allowed.some((d) => host === d || host.endsWith(`.${d}`));

// ---------- shouting, emoji and zalgo ----------
function capsRatio(text) {
  const letters = String(text).replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+/g, '').match(/[\p{Lu}\p{Ll}]/gu) ?? [];
  if (!letters.length) return { letters: 0, ratio: 0 };
  return { letters: letters.length, ratio: letters.filter((l) => l !== l.toLowerCase()).length / letters.length };
}
const countEmoji = (text) => (String(text).match(/<a?:\w+:\d+>|\p{Extended_Pictographic}/gu) ?? []).length;
// Stacks of combining accents on top of a letter. Only the accent blocks are counted, so Hindi, Thai and other scripts are never flagged.
const ZALGO = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]{4,}/;
const isZalgo = (text) => ZALGO.test(String(text));

// ---------- banned words ----------
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
function normalizeText(text) {
  return String(text).normalize('NFKD').replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g, '').toLowerCase().replace(/[01345 7@$!]/g, (c) => (c === ' ' ? ' ' : LEET[c] ?? c));
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One regex per word. Letters may be stretched ("fuuuck"), spaces in a phrase match any separator, and *word or word* allows partial matches.
function wordRegex(word) {
  const raw = String(word).trim().toLowerCase();
  const startOpen = raw.startsWith('*'); const endOpen = raw.endsWith('*');
  const core = normalizeText(raw.replace(/^\*|\*$/g, ''));
  const body = [...core].map((ch) => (/\s/.test(ch) ? '[\\s._\\-]+' : `${esc(ch)}+`)).join('');
  return new RegExp(`${startOpen ? '' : '(?<![a-z0-9])'}${body}${endOpen ? '' : '(?![a-z0-9])'}`, 'i');
}
// The first banned word found in the text, or null. Compiled patterns are reused between calls.
const compiled = new Map();
function findBannedWord(text, words) {
  const haystack = normalizeText(text);
  for (const word of words) {
    let re = compiled.get(word);
    if (!re) { re = wordRegex(word); compiled.set(word, re); }
    if (re.test(haystack)) return word;
  }
  return null;
}

// ---------- the message content rules ----------
// input: { content, mentionCount, config, words, isForeignInvite(code) -> Promise<boolean>, memberLevel }
// Returns the first rule broken as { rule, label }, or null.
async function evaluateContent({ content, mentionCount = 0, config, words = [], isForeignInvite = async () => true, memberLevel = 0 }) {
  const text = String(content ?? '');
  const c = config;

  if (c.words.enabled && words.length && findBannedWord(text, words)) return { rule: 'words', label: 'a banned word' };

  if (c.links.mode !== 'off' && !(c.links.exemptLevel > 0 && memberLevel >= c.links.exemptLevel)) {
    for (const code of findInvites(text)) if (await isForeignInvite(code)) return { rule: 'links', label: 'a server invite' };
    if (c.links.mode === 'all') {
      const blocked = findHosts(text).find((h) => !isAllowedHost(h, c.links.allowedDomains));
      if (blocked) return { rule: 'links', label: 'a link that is not allowed here' };
    }
  }

  if (c.mentions.enabled && mentionCount > c.mentions.max) return { rule: 'mentions', label: 'mass mentions' };

  if (c.formatting.enabled) {
    const caps = capsRatio(text);
    if (caps.letters >= c.formatting.capsMinLetters && caps.ratio * 100 >= c.formatting.capsPercent) return { rule: 'formatting', label: 'too many capital letters' };
    if (countEmoji(text) > c.formatting.emojiMax) return { rule: 'formatting', label: 'too many emoji' };
    if (c.formatting.zalgo && isZalgo(text)) return { rule: 'formatting', label: 'distorted text' };
  }
  return null;
}

// ---------- flooding and repeats ----------
const sameText = (text) => String(text).toLowerCase().replace(/\s+/g, ' ').trim();

// Remembers each person's recent messages. record() says whether the newest one tips them over a limit,
// and lists the messages that belong to the burst so they can be removed together.
class FloodTracker {
  constructor(keepMs = 60_000) { this.keepMs = keepMs; this.people = new Map(); }

  record(key, entry, spam, now = Date.now()) {
    const recent = (this.people.get(key) ?? []).filter((e) => now - e.at <= this.keepMs);
    recent.push({ ...entry, at: now, text: sameText(entry.content) });
    this.people.set(key, recent);

    const burst = recent.filter((e) => now - e.at <= spam.seconds * 1000);
    if (burst.length >= spam.messages) return { rule: 'spam', label: 'sending messages too quickly', messages: burst };

    const text = recent.at(-1).text;
    if (text.length >= 2) {
      const repeats = recent.filter((e) => e.text === text && now - e.at <= spam.duplicateSeconds * 1000);
      if (repeats.length >= spam.duplicates) return { rule: 'spam', label: 'repeating the same message', messages: repeats };
    }
    return null;
  }

  // Forgets what was already handled, so the same burst is not punished twice.
  clear(key, ids) { const keep = new Set(ids); this.people.set(key, (this.people.get(key) ?? []).filter((e) => !keep.has(e.id))); }
  prune(now = Date.now()) { for (const [k, list] of this.people) { const live = list.filter((e) => now - e.at <= this.keepMs); if (live.length) this.people.set(k, live); else this.people.delete(k); } }
}

module.exports = {
  DEFAULTS, LIMITS, mergeConfig, cleanDomain, findInvites, findHosts, isAllowedHost, capsRatio, countEmoji, isZalgo,
  normalizeText, wordRegex, findBannedWord, evaluateContent, FloodTracker, sameText,
};
