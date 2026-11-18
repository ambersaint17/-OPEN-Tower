const test = require('node:test');
const assert = require('node:assert/strict');
const yt = require('../src/lib/youtube');
const { youtube } = require('../src/constants');

const CHANNEL = 'UCabcdefghijklmnopqrstuv';
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}"/>
 <id>yt:channel:${CHANNEL}</id>
 <yt:channelId>${CHANNEL}</yt:channelId>
 <title>Amber_Saint17</title>
 <link rel="alternate" href="https://www.youtube.com/channel/${CHANNEL}"/>
 <author><name>Amber_Saint17</name><uri>https://www.youtube.com/channel/${CHANNEL}</uri></author>
 <published>2026-01-01T10:00:00+00:00</published>
 <entry>
  <id>yt:video:AAAAAAAAAAA</id>
  <yt:videoId>AAAAAAAAAAA</yt:videoId>
  <yt:channelId>${CHANNEL}</yt:channelId>
  <title>Building a Gun System &amp; More: &quot;Part 2&quot;</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/>
  <author><name>Amber_Saint17</name></author>
  <published>2026-10-29T08:00:00+00:00</published>
  <updated>2026-10-29T08:05:00+00:00</updated>
  <media:group>
   <media:title>Building a Gun System</media:title>
   <media:content url="https://www.youtube.com/v/AAAAAAAAAAA?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i2.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg" width="480" height="360"/>
   <media:description>In this video we build a full gun system.

Follow me: https://twitter.com/example
Second line &amp; more</media:description>
   <media:community>
    <media:starRating count="12" average="5.00" min="1" max="5"/>
    <media:statistics views="345"/>
   </media:community>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:BBBBBBBBBBB</id>
  <yt:videoId>BBBBBBBBBBB</yt:videoId>
  <title>Quick tip</title>
  <link href="https://www.youtube.com/shorts/BBBBBBBBBBB" rel="alternate"/>
  <published>2026-10-28T08:00:00+00:00</published>
  <media:group><media:thumbnail url="https://i2.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg"/></media:group>
 </entry>
</feed>`;

test('the feed is parsed, including entities, links in any attribute order and missing fields', () => {
  const feed = yt.parseFeed(SAMPLE);
  assert.equal(feed.channelTitle, 'Amber_Saint17');
  assert.equal(feed.entries.length, 2);
  const [a, b] = feed.entries;
  assert.equal(a.id, 'AAAAAAAAAAA');
  assert.equal(a.title, 'Building a Gun System & More: "Part 2"');
  assert.equal(a.url, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
  assert.equal(a.published, Date.parse('2026-10-29T08:00:00Z'));
  assert.equal(a.views, 345);
  assert.equal(a.thumbnail, 'https://i2.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg');
  assert.match(a.description, /full gun system/);
  assert.match(a.description, /Second line & more/);
  assert.equal(b.url, 'https://www.youtube.com/shorts/BBBBBBBBBBB');      // href before rel still works
  assert.equal(b.views, null);
  assert.equal(b.description, '');
  assert.deepEqual(yt.parseFeed('<feed></feed>').entries, []);
  assert.deepEqual(yt.parseFeed('not xml at all').entries, []);
});

test('shorts are recognised and URLs are built correctly', () => {
  assert.equal(yt.isShortUrl('https://www.youtube.com/shorts/abc'), true);
  assert.equal(yt.isShortUrl('https://www.youtube.com/watch?v=abc'), false);
  assert.equal(yt.isShortUrl(null), false);
  assert.equal(yt.watchUrl('abc'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(yt.shortUrl('abc'), 'https://www.youtube.com/shorts/abc');
  assert.equal(yt.feedUrl(CHANNEL), `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`);
});

test('descriptions are shortened without links', () => {
  const text = yt.summarise('First line here.\n\nSecond line https://example.com/x\nThird line is dropped', 200);
  assert.equal(text, 'First line here. Second line');
  assert.equal(yt.summarise('x'.repeat(500), 50).length, 50);
  assert.ok(yt.summarise('x'.repeat(500), 50).endsWith('\u2026'));
  assert.equal(yt.summarise('https://only.a/link'), '');
});

test('hype lines are picked from the right list', () => {
  assert.ok(youtube.hype.video.includes(yt.pickHype('video', () => 0)));
  assert.ok(youtube.hype.short.includes(yt.pickHype('short', () => 0.999)));
});

test('channel input is understood in every form people paste it', () => {
  assert.equal(yt.normaliseChannelInput(CHANNEL), CHANNEL);
  assert.equal(yt.normaliseChannelInput('@amber_saint17'), 'https://www.youtube.com/@amber_saint17');
  assert.equal(yt.normaliseChannelInput('youtube.com/@amber_saint17'), 'https://youtube.com/@amber_saint17');
  assert.equal(yt.normaliseChannelInput('https://www.youtube.com/@amber_saint17'), 'https://www.youtube.com/@amber_saint17');
  const rss = `<link rel="alternate" type="application/rss+xml" title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}">`;
  assert.equal(yt.channelIdFromHtml(rss), CHANNEL);
  assert.equal(yt.channelIdFromHtml(`..."externalId":"${CHANNEL}","x":1`), CHANNEL);
  assert.equal(yt.channelIdFromHtml(`<a href="https://www.youtube.com/channel/${CHANNEL}">`), CHANNEL);
  assert.equal(yt.channelIdFromHtml('<html>nothing</html>'), null);
});

const reply = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test('the network helpers work against a fake YouTube', async () => {
  const feed = await yt.fetchFeed(CHANNEL, { fetchImpl: reply(SAMPLE) });
  assert.equal(feed.entries.length, 2);
  await assert.rejects(yt.fetchFeed(CHANNEL, { fetchImpl: reply('', 404), retryDelayMs: 1 }), /HTTP 404/);
  assert.equal(await yt.resolveChannelId(CHANNEL), CHANNEL);                                     // no request needed
  assert.equal(await yt.resolveChannelId(`https://www.youtube.com/channel/${CHANNEL}`), CHANNEL);
  assert.equal(await yt.resolveChannelId('@amber_saint17', { fetchImpl: reply(`"externalId":"${CHANNEL}"`) }), CHANNEL);
  await assert.rejects(yt.resolveChannelId('@nobody', { fetchImpl: reply('<html></html>') }), /channel ID/);
});

test('Shorts are told apart from videos, with a safe default', async () => {
  const short = { id: 'S', url: 'https://www.youtube.com/shorts/S' };
  const normal = { id: 'V', url: 'https://www.youtube.com/watch?v=V' };
  const unknown = { id: 'U', url: null };
  const noRequest = { fetchImpl: () => { throw new Error('no request needed'); } };
  assert.equal(await yt.classify(short, noRequest), true);
  assert.equal(await yt.classify(normal, noRequest), false);   // the feed link already says it is a normal video: never probe
  assert.equal(await yt.classify(unknown, { fetchImpl: reply('', 200) }), true);     // /shorts/ answers 200: it is a Short
  assert.equal(await yt.classify(unknown, { fetchImpl: reply('', 303) }), false);    // redirected away: a normal video
  assert.equal(await yt.classify(unknown, { fetchImpl: () => { throw new Error('offline'); } }), false);   // unknown means normal
});

test('a channel home link is built from whatever was typed', () => {
  assert.equal(yt.channelHomeUrl('@amber_saint17', CHANNEL), 'https://www.youtube.com/@amber_saint17');
  assert.equal(yt.channelHomeUrl('https://www.youtube.com/@amber_saint17/videos', CHANNEL), 'https://www.youtube.com/@amber_saint17');
  assert.equal(yt.channelHomeUrl(CHANNEL, CHANNEL), `https://www.youtube.com/channel/${CHANNEL}`);
  assert.equal(yt.channelHomeUrl(`https://www.youtube.com/channel/${CHANNEL}`, CHANNEL), `https://www.youtube.com/channel/${CHANNEL}`);
});

test('video IDs are found in every kind of YouTube link, and only there', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}?t=4`, `https://www.youtube.com/shorts/${id}`,
    `https://m.youtube.com/watch?feature=share&v=${id}`, `https://www.youtube.com/live/${id}`]) {
    assert.equal(yt.videoIdFromUrl(url), id, url);
  }
  assert.equal(yt.videoIdFromUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(yt.videoIdFromUrl('https://www.youtube.com/@amber_saint17'), null);
  assert.equal(yt.videoIdFromUrl(null), null);
  assert.equal(yt.thumbnailFor(id), `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
});

test('only http and https links are accepted', () => {
  assert.equal(yt.isHttpUrl('https://youtu.be/x'), true);
  assert.equal(yt.isHttpUrl('http://example.com'), true);
  for (const bad of ['javascript:alert(1)', 'youtu.be/x', 'not a link', '', null]) assert.equal(yt.isHttpUrl(bad), false, String(bad));
});

test('a flaky feed is tried again, but a real refusal is not', async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => SAMPLE });
  const feed = await yt.fetchFeed(CHANNEL, { fetchImpl: flaky, retryDelayMs: 1 });
  assert.equal(feed.entries.length, 2);
  assert.equal(calls, 2);

  calls = 0;
  const forbidden = async () => { calls++; return { ok: false, status: 403, text: async () => '' }; };
  await assert.rejects(yt.fetchFeed(CHANNEL, { fetchImpl: forbidden, retryDelayMs: 1 }), /HTTP 403/);
  assert.equal(calls, 1);
});

test('requests carry a consent cookie so European hosts get the real page', async () => {
  let seen;
  await yt.fetchText('https://www.youtube.com/x', { fetchImpl: async (url, init) => { seen = init.headers; return { ok: true, status: 200, text: async () => '' }; } });
  assert.match(seen.cookie, /CONSENT=/);
});

test('when the channel feed says 404, the uploads playlist feed is tried before giving up', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return url.includes('channel_id=') ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => SAMPLE };
  };
  const feed = await yt.fetchFeed(CHANNEL, { fetchImpl, retryDelayMs: 1 });
  assert.equal(feed.entries.length, 2);
  assert.ok(urls.at(-1).includes(`playlist_id=UU${CHANNEL.slice(2)}`));
  assert.equal(yt.uploadsFeedUrl(CHANNEL), `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${CHANNEL.slice(2)}`);
});

test('no feed at all is reported as notFound, and the channel page tells a wrong ID from a quiet channel', async () => {
  await assert.rejects(yt.fetchFeed(CHANNEL, { fetchImpl: reply('', 404), retryDelayMs: 1 }), (err) => err.notFound === true && /HTTP 404/.test(err.message));
  await assert.rejects(yt.fetchFeed(CHANNEL, { fetchImpl: reply('', 500), retryDelayMs: 1 }), (err) => !err.notFound && /HTTP 500/.test(err.message));
  assert.equal(await yt.channelExists(CHANNEL, { fetchImpl: reply('<html></html>') }), true);
  assert.equal(await yt.channelExists(CHANNEL, { fetchImpl: reply('', 404) }), false);
  await assert.rejects(yt.channelExists(CHANNEL, { fetchImpl: reply('', 403) }), /HTTP 403/);
});
