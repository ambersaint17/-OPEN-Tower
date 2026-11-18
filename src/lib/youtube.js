// Everything about talking to YouTube. The feed parser and URL helpers are pure, and the network
// calls take an injectable fetch so they can be tested without internet.
const { youtube } = require('../constants');

const UA = 'Mozilla/5.0 (compatible; TowerBot/1.0)';
// Hosts in Europe get YouTube's cookie-consent page instead of the real page unless a consent cookie is sent.
const HEADERS = { 'user-agent': UA, 'accept-language': 'en', cookie: 'CONSENT=YES+cb; SOCS=CAI' };

function decode(text) {
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

const tag = (xml, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decode(m[1].trim()) : null;
};

const attrOf = (xml, tagName, attr) => {
  const m = new RegExp(`<${tagName}\\b[^>]*\\b${attr}="([^"]*)"`).exec(xml);
  return m ? decode(m[1]) : null;
};

// The "alternate" link is the page for the video. Attribute order is not guaranteed.
function alternateLink(xml) {
  for (const m of xml.matchAll(/<link\b[^>]*>/g)) {
    if (/rel="alternate"/.test(m[0])) return attrOf(m[0], 'link', 'href');
  }
  return null;
}

const isShortUrl = (url) => /youtube\.com\/shorts\//.test(url ?? '');
const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
const shortUrl = (id) => `https://www.youtube.com/shorts/${id}`;
const feedUrl = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

function parseFeed(xml) {
  const parts = xml.split('<entry>');
  const header = parts[0];
  const entries = parts.slice(1).map((chunk) => {
    const body = chunk.split('</entry>')[0];
    const id = tag(body, 'yt:videoId');
    const views = attrOf(body, 'media:statistics', 'views');
    return {
      id,
      title: tag(body, 'title') ?? 'Untitled',
      url: alternateLink(body) ?? watchUrl(id),
      published: Date.parse(tag(body, 'published') ?? '') || 0,
      description: tag(body, 'media:description') ?? '',
      thumbnail: attrOf(body, 'media:thumbnail', 'url'),
      views: views === null ? null : Number(views),
    };
  }).filter((e) => e.id);
  return { channelTitle: tag(header, 'title'), entries };
}

// A short description for the post: a couple of lines, without links.
function summarise(description, max = 180) {
  const lines = String(description).split('\n').map((l) => l.replace(/https?:\/\/\S+/g, '').trim()).filter(Boolean);
  const text = lines.slice(0, 2).join(' ').replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}\u2026` : text;
}

const pickHype = (kind, rand = Math.random) => {
  const list = youtube.hype[kind];
  return list[Math.floor(rand() * list.length)];
};

// "@handle", "youtube.com/@handle", a channel link, or a bare UC... id -> something fetchable.
function normaliseChannelInput(input) {
  const text = String(input).trim();
  if (/^UC[\w-]{22}$/.test(text)) return text;
  if (text.startsWith('@')) return `https://www.youtube.com/${text}`;
  return /^https?:\/\//.test(text) ? text : `https://${text}`;
}

function channelIdFromHtml(html) {
  const patterns = [
    /<link rel="alternate" type="application\/rss\+xml"[^>]*channel_id=(UC[\w-]{22})/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
    /youtube\.com\/channel\/(UC[\w-]{22})/,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m) return m[1];
  }
  return null;
}

// ---------- network ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// YouTube's feed endpoint sometimes answers 404 or 5xx for a moment, so those are tried once more.
async function fetchText(url, { fetchImpl = fetch, timeoutMs = 10_000, retries = 0, retryDelayMs = 1500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: HEADERS });
      if (res.ok) return await res.text();
      const error = new Error(`YouTube answered with HTTP ${res.status}`);
      error.status = res.status;
      error.retryable = res.status === 404 || res.status >= 500;
      throw error;
    } catch (err) {
      const retryable = err.retryable ?? true; // network errors and timeouts are worth another try
      if (attempt >= retries || !retryable) throw err;
      await sleep(retryDelayMs);
    }
  }
}

async function resolveChannelId(input, opts) {
  const target = normaliseChannelInput(input);
  if (/^UC[\w-]{22}$/.test(target)) return target;
  const direct = /youtube\.com\/channel\/(UC[\w-]{22})/.exec(target);
  if (direct) return direct[1];
  const id = channelIdFromHtml(await fetchText(target, opts));
  if (!id) throw new Error('Could not find a channel ID on that page. Give the channel ID (it starts with UC) instead.');
  return id;
}

// The "uploads" playlist of a channel has the same ID with UC swapped for UU. Its feed often still works
// when the channel feed answers 404.
const uploadsFeedUrl = (channelId) => `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${String(channelId).slice(2)}`;

// Reads a channel's feed. Tries the channel feed, then the uploads playlist feed. If YouTube has neither,
// the error has notFound = true (a wrong ID, a channel with no public videos yet, or a blocked host).
async function fetchFeed(channelId, opts) {
  const options = { retries: 1, ...opts };
  try {
    return parseFeed(await fetchText(feedUrl(channelId), options));
  } catch (err) {
    if (err.status !== 404 || !/^UC[\w-]{22}$/.test(channelId)) throw err;
  }
  try {
    return parseFeed(await fetchText(uploadsFeedUrl(channelId), { ...options, retries: 0 }));
  } catch (err) {
    if (err.status !== 404) throw err;
    const notFound = new Error('YouTube answered with HTTP 404 for both of the channel\'s feeds');
    notFound.notFound = true;
    throw notFound;
  }
}

// Does the channel page itself exist? Tells a wrong ID apart from a channel that simply has no feed yet.
async function channelExists(channelId, opts) {
  try {
    await fetchText(`https://www.youtube.com/channel/${channelId}`, opts);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

// The public home page of the channel, whatever form the owner typed it in (a handle, a /videos link, an ID).
function channelHomeUrl(input, channelId) {
  const handle = /(?:^|youtube\.com\/)(@[\w.-]+)/i.exec(String(input).trim());
  return handle ? `https://www.youtube.com/${handle[1]}` : `https://www.youtube.com/channel/${channelId}`;
}

// A video ID from any of the usual YouTube links, or null for anything else.
function videoIdFromUrl(url) {
  const m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i.exec(String(url ?? '').trim());
  return m ? m[1] : null;
}

const isHttpUrl = (text) => {
  try { return ['http:', 'https:'].includes(new URL(String(text)).protocol); } catch { return false; }
};

const thumbnailFor = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// Normal videos redirect away from /shorts/, real Shorts answer 200. Used only if the feed link says nothing.
async function probeShort(id, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(shortUrl(id), { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: HEADERS });
    return res.status === 200;
  } catch {
    return false;
  }
}

// The feed itself says which it is: Shorts link to /shorts/, normal videos to /watch. That is trusted first,
// because the network probe can be fooled (a wrong answer would label every normal upload a Short).
async function classify(entry, deps = {}) {
  if (isShortUrl(entry.url)) return true;
  if (/youtube\.com\/watch\?/.test(entry.url ?? '')) return false;
  return probeShort(entry.id, deps);
}

module.exports = {
  decode, parseFeed, isShortUrl, watchUrl, shortUrl, feedUrl, summarise, pickHype, normaliseChannelInput,
  channelIdFromHtml, fetchText, resolveChannelId, fetchFeed, channelExists, uploadsFeedUrl, probeShort, classify,
  channelHomeUrl, videoIdFromUrl, thumbnailFor, isHttpUrl,
};
