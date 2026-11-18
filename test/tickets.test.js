const test = require('node:test');
const assert = require('node:assert/strict');
const { renderTranscript, escapeHtml, safeUrl, componentsText } = require('../src/modules/tickets/transcript');
const { formFor, validateForm, TEMPLATES } = require('../src/modules/tickets/forms');
const { formatSeconds } = require('../src/lib/time');
const { tickets, moderation } = require('../src/constants');

const ticket = { number: 7, typeLabel: 'Report a Member', openerTag: 'opener', claimedTag: 'staff', closedTag: 'staff', reason: 'Done', openedAt: 0, closedAt: 1000 };
const render = (messages) => renderTranscript({ ticket, guildName: 'Amber_Saint17', messages, generatedAt: 5000 });

test('hostile message text can never become markup', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>"><svg onload=alert(3)>';
  const html = render([{ authorTag: 'x', content: evil, createdTimestamp: 1 }]);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<svg'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('hostile names, tags and filenames are escaped too', () => {
  const html = render([{
    authorTag: '"><script>alert(1)</script>', content: 'hi', createdTimestamp: 1,
    attachments: [{ name: '"><img src=x onerror=alert(1)>.png', url: 'https://cdn.discordapp.com/a/b.png', contentType: 'image/png' }],
  }]);
  assert.ok(!/<script>alert/.test(html));
  assert.ok(!html.includes('"><img'));
  assert.ok(!html.includes('<img src=x'));
});

test('only Discord CDN links ever become links or images', () => {
  assert.equal(safeUrl('https://cdn.discordapp.com/attachments/1/2/a.png'), 'https://cdn.discordapp.com/attachments/1/2/a.png');
  for (const bad of ['javascript:alert(1)', 'http://cdn.discordapp.com/x', 'https://evil.example/x.png', 'data:text/html,hi', 'https://cdn.discordapp.com.evil.example/x', null, 42]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
  const html = render([{ authorTag: 'x', content: 'hi', createdTimestamp: 1, avatarUrl: 'javascript:alert(1)', attachments: [{ name: 'evil.png', url: 'javascript:alert(1)', contentType: 'image/png' }] }]);
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('href="javascript'));
});

test('the page ships with a strict content security policy and no scripts', () => {
  const html = render([{ authorTag: 'x', content: 'hello', createdTimestamp: 1 }]);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<iframe|<object|<embed|<form/i.test(html));
  assert.match(html, /Ticket #0007/);
});

test('line breaks survive, empty messages are labelled, and Tower cards are shown as text', () => {
  const html = render([
    { authorTag: 'a', content: 'one\ntwo', createdTimestamp: 1 },
    { authorTag: 'b', content: '', createdTimestamp: 2 },
    { authorTag: 'Tower', bot: true, content: '', cardText: ['## Ticket #0007', 'Roblox: <b>x</b>'], createdTimestamp: 3 },
  ]);
  assert.match(html, /one<br>two/);
  assert.match(html, /\(no text\)/);
  assert.match(html, /Roblox: &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /APP/);
});

test('text is pulled out of nested Components V2 messages', () => {
  const text = componentsText([{ components: [{ content: 'Title' }, { components: [{ content: 'Deep' }] }, { accessory: { content: 'Side' } }] }]);
  assert.deepEqual(text, ['Title', 'Deep', 'Side']);
  assert.deepEqual(componentsText(undefined), []);
});

test('escapeHtml covers every special character', () => {
  assert.equal(escapeHtml(`<>&"'\``), '&lt;&gt;&amp;&quot;&#39;&#96;');
  assert.equal(escapeHtml(null), '');
});

test('every ticket type has a form with a ready-made format', () => {
  for (const type of Object.keys(tickets.types)) {
    const fields = formFor(type);
    assert.ok(fields.length >= 3 && fields.length <= 5, `${type}: a modal allows 1 to 5 inputs`);
    for (const f of fields) {
      assert.ok(f.label.length <= 45, `${type}.${f.id} label too long for Discord`);
      assert.ok(!f.placeholder || f.placeholder.length <= 100);
    }
    const details = fields.find((f) => f.id === 'details');
    assert.ok(details.template && details.template.length < details.max);
    assert.equal(TEMPLATES[type], details.template);
  }
  assert.ok(formFor('report').some((f) => f.id === 'reported'));
  assert.ok(!formFor('support').some((f) => f.id === 'reported'));
});

test('the form rejects empty, unfilled and too-short answers but accepts real ones', () => {
  const good = (type) => ({ subject: 'My problem', username: 'Roblox: Tester', reported: 'BadUser', details: `${TEMPLATES[type]}\nI need help with something specific here.` });
  for (const type of Object.keys(tickets.types)) assert.equal(validateForm(type, good(type)), null, type);
  assert.match(validateForm('support', { ...good('support'), details: TEMPLATES.support }), /empty format|blanks/);
  assert.match(validateForm('support', { ...good('support'), details: 'help' }), /bit more/);
  assert.match(validateForm('support', { ...good('support'), subject: 'hi' }), /Subject/);
  assert.match(validateForm('report', { ...good('report'), reported: '' }), /reporting/);
});

test('ticket types map onto the staff ranks correctly', () => {
  const lvl = (t) => tickets.types[t].minLevel;
  assert.equal(lvl('support'), 2);   // Moderator and above
  assert.equal(lvl('report'), 2);
  assert.equal(lvl('partnership'), 4); // Administrator and above
  assert.equal(lvl('application'), 4);
  assert.equal(lvl('services'), 5);  // the owner only
  assert.ok(tickets.types.services.pingOwner);
  for (const t of Object.values(tickets.types)) {
    assert.ok(t.description.length <= 100, 'select option descriptions are capped at 100 characters');
    assert.ok(t.label.length <= 100);
  }
  const modRoles = moderation.ranks.filter((r) => r.level >= 2).map((r) => r.role);
  assert.ok(modRoles.includes('Moderator') && !modRoles.includes('Trial Moderator'));
});

test('the inactivity choices are the ones asked for', () => {
  const hours = tickets.inactiveChoices.map((c) => c.value / 3_600_000);
  for (const wanted of [6, 12, 24, 48]) assert.ok(hours.includes(wanted), `${wanted}h missing`);
});

test('response times read naturally', () => {
  assert.equal(formatSeconds(45), '45s');
  assert.equal(formatSeconds(7260), '2h 1m');
  assert.equal(formatSeconds(90000), '1d 1h');
  assert.equal(formatSeconds(null), 'n/a');
  assert.equal(formatSeconds(0), '0s');
});

// ---------- channel permissions, naming, tracking ----------
const actions = require('../src/modules/tickets/actions');
const tracker = require('../src/modules/tickets/tracker');
const { isTicketChannelName } = require('../src/lib/channels');

test('ticket channels are named safely and recognised', () => {
  assert.equal(actions.ticketChannelName(42, 'Cool User!!'), 'ticket-0042-cool-user');
  assert.equal(actions.ticketChannelName(7, '___'), 'ticket-0007-member');
  assert.equal(actions.ticketChannelName(1, 'A'.repeat(50)).length, 'ticket-0001-'.length + 20);
  assert.match(actions.ticketChannelName(3, '@everyone <script>'), /^ticket-0003-[a-z0-9-]+$/);
  assert.equal(isTicketChannelName('ticket-0042-cool-user'), true);
  assert.equal(isTicketChannelName('support-ticket'), false);
  assert.equal(isTicketChannelName('ticket-handling'), false);
  assert.equal(isTicketChannelName('ticket-logs'), false);
  assert.equal(isTicketChannelName(undefined), false);
});

test('a new ticket channel is hidden from everyone except the opener, the owner, Tower and the right staff', () => {
  const o = actions.buildOverwrites({ everyoneId: 'everyone', openerId: 'opener', ownerId: 'owner', botId: 'bot', staffRoleIds: ['modRole', 'adminRole'] });
  assert.deepEqual(o[0].deny.length, 1);
  assert.equal(o[0].id, 'everyone');
  assert.ok(!o[0].allow);
  assert.deepEqual(o.slice(1).map((x) => x.id), ['opener', 'bot', 'owner', 'modRole', 'adminRole']);
  assert.ok(o.slice(1).every((x) => x.allow.length >= 5 && !x.deny));
  // owner-only tickets pass no staff roles, so only the opener, Tower and the owner appear
  const ownerOnly = actions.buildOverwrites({ everyoneId: 'everyone', openerId: 'opener', ownerId: 'owner', botId: 'bot', staffRoleIds: [] });
  assert.deepEqual(ownerOnly.map((x) => x.id), ['everyone', 'opener', 'bot', 'owner']);
});

const role = (id, name) => ({ id, name });
// discord.js collections are Maps with extra helpers such as find.
class Col extends Map { find(fn) { for (const v of this.values()) if (fn(v)) return v; return undefined; } }
const guildWith = (roles, ownerId = 'owner') => ({ id: 'g', ownerId, roles: { cache: new Col(roles.map((r) => [r.id, r])) } });

test('roles are chosen by rank for each ticket type', () => {
  const guild = guildWith([role('1', 'Trial Moderator'), role('2', 'Moderator'), role('3', 'Head Moderator'), role('4', 'Administrator'), role('5', 'Co-Owner'), role('6', 'Member')]);
  const names = (lvl) => actions.rolesAtOrAbove(guild, lvl).map((r) => r.name).sort();
  assert.deepEqual(names(2), ['Administrator', 'Co-Owner', 'Head Moderator', 'Moderator']);   // support + reports: no Trial Moderators
  assert.deepEqual(names(4), ['Administrator', 'Co-Owner']);                                   // partnerships + applications
  assert.deepEqual(names(5), []);                                                                         // services: owner only
});

test('staff pings go to the right place', () => {
  const guild = guildWith([role('2', 'Moderator'), role('4', 'Administrator')]);
  assert.equal(actions.pingTargets(guild, tickets.types.support).text, '<@&2>');
  assert.equal(actions.pingTargets(guild, tickets.types.partnership).text, '<@&4>');
  assert.deepEqual(actions.pingTargets(guild, tickets.types.services), { text: '<@owner>', roles: [], users: ['owner'] });
  assert.equal(actions.pingTargets(guildWith([]), tickets.types.support).text, '');
});

test('who may handle which ticket', () => {
  const guild = guildWith([]);
  const staff = (...names) => ({ id: 'u', roles: { cache: new Map(names.map((n, i) => [i, { name: n }])) }, permissions: { has: () => false } });
  const t = (type) => ({ type });
  assert.equal(actions.canHandle(guild, staff('Moderator'), t('support')), true);
  assert.equal(actions.canHandle(guild, staff('Trial Moderator'), t('support')), false);
  assert.equal(actions.canHandle(guild, staff('Head Moderator'), t('partnership')), false);
  assert.equal(actions.canHandle(guild, staff('Administrator'), t('partnership')), true);
  assert.equal(actions.canHandle(guild, staff('Administrator'), t('services')), false);   // "direct to the owner"
  assert.equal(actions.canHandle(guild, { ...staff(), id: 'owner' }, t('services')), true);
  assert.equal(actions.canHandle(guild, staff('Member'), t('support')), false);            // members can never close or claim
});

test('the tracker throttles busy tickets and remembers pending closures', () => {
  tracker.clear();
  tracker.add({ id: 9, channel_id: 'c1', guild_id: 'g', opener_id: 'o', auto_close_at: new Date() }, 2);
  assert.equal(tracker.get('c1').pendingClose, true);
  assert.equal(tracker.get('nope'), null);
  assert.equal(tracker.throttled(9, 'opener', 30_000, 1000), true);
  assert.equal(tracker.throttled(9, 'opener', 30_000, 2000), false);   // too soon
  assert.equal(tracker.throttled(9, 'staff', 30_000, 2000), true);     // different kind of event
  assert.equal(tracker.throttled(9, 'opener', 30_000, 40_000), true);  // window passed
  tracker.remove('c1');
  assert.equal(tracker.get('c1'), null);
});

test('oversized transcripts shed their oldest messages instead of failing to upload', () => {
  const big = 'x'.repeat(5000);
  const messages = Array.from({ length: 2000 }, (_, i) => ({ authorTag: `u${i}`, content: big, createdTimestamp: i }));
  const args = { ticket, guildName: 'G', messages, truncated: false };
  const { html, count } = actions.fitTranscript(args);
  assert.ok(Buffer.byteLength(html) <= tickets.transcriptMaxBytes);
  assert.ok(count < 2000 && count >= 10);
  assert.match(html, /cut short/);
  const small = actions.fitTranscript({ ...args, messages: messages.slice(0, 5) });
  assert.equal(small.count, 5);
});

test('transcripts go to the right log channel for each ticket type', () => {
  const settings = { logs_channel_id: 'general-logs', admin_logs_channel_id: 'admin-logs' };
  const dest = (type, s = settings) => actions.logDestination(s, tickets.types[type]);
  assert.deepEqual(dest('support'), { channelId: 'general-logs', dmFallback: false });
  assert.deepEqual(dest('report'), { channelId: 'general-logs', dmFallback: false });
  for (const type of ['services', 'partnership', 'application']) {
    assert.deepEqual(dest(type), { channelId: 'admin-logs', dmFallback: false }, type);
  }
  // an admin ticket never lands in the general log channel, even when the admin channel is not set
  const noAdmin = { logs_channel_id: 'general-logs', admin_logs_channel_id: null };
  assert.deepEqual(dest('services', noAdmin), { channelId: null, dmFallback: true });
  assert.deepEqual(dest('partnership', noAdmin), { channelId: null, dmFallback: true });
  assert.deepEqual(dest('support', noAdmin), { channelId: 'general-logs', dmFallback: false });
  assert.deepEqual(dest('support', null), { channelId: null, dmFallback: false });
});

// ---------- encoding, banner attachments, DM wording ----------

test('the transcript is pure ASCII, so no browser can misread its encoding', () => {
  const nasty = 'caf\u00e9 \u00fcber na\u00efve \u2019quotes\u2019 \u2014 dash, \u65e5\u672c\u8a9e, \u0645\u0631\u062d\u0628\u0627, emoji \ud83d\ude00\ud83d\udd25\u2764\ufe0f, null\u0000byte';
  const html = render([{ authorTag: 'J\u00fcrgen \ud83d\ude0e', content: nasty, createdTimestamp: 1, attachments: [{ name: 'r\u00e9sum\u00e9.png', url: 'https://cdn.discordapp.com/a/b.png', contentType: 'image/png' }] }]);
  for (let i = 0; i < html.length; i++) assert.ok(html.charCodeAt(i) < 128, `non-ASCII character at position ${i}`);
  assert.match(html, /&#233;/);        // e with acute
  assert.match(html, /&#128512;/);     // the grinning face, written as one reference for the whole emoji
  assert.match(html, /charset="utf-8"/);
  assert.ok(!html.includes('\u0000'));
});

test('numeric references decode back to exactly what people wrote', () => {
  const original = 'na\u00efve \u2014 \u65e5\u672c \ud83d\ude00';
  const escaped = escapeHtml(original);
  const decoded = escaped.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  assert.equal(decoded, original);
  assert.equal(escapeHtml('a\nb\tc'), 'a\nb\tc');
  assert.equal(escapeHtml('x\u0001y\u007fz\u0085w'), 'xyzw');   // control characters never reach the page
});

const ui = require('../src/ui');

test('a card with a banner always ships with that banner file, exactly once', () => {
  const withBanner = ui.card({ title: 'x', banner: 'tickets' });
  assert.equal(ui.message(withBanner).files.length, 1);
  assert.equal(ui.edit(withBanner).files.length, 1);
  assert.equal(ui.message(withBanner, { files: [{ name: 'tower-banner-tickets.png' }] }).files.length, 1);   // not duplicated
  assert.equal(ui.message(withBanner, { files: [{ name: 'transcript.html' }] }).files.length, 2);            // added next to other files
  const plain = ui.card({ title: 'y' });
  assert.equal(ui.message(plain).files, undefined);
  assert.equal(ui.edit(plain).files, undefined);
});

test('no two features share a banner, and banners are optional', () => {
  const assets = require('../src/assets');
  const { FILES, bannerName } = assets;
  assert.equal(new Set(Object.values(FILES)).size, Object.keys(FILES).length);
  assert.equal(new Set(Object.keys(FILES).map(bannerName)).size, Object.keys(FILES).length);
  // With the folder present every banner is found; with it missing, cards simply have none.
  assets._reset();
  assert.equal(assets.availableBanners().length, Object.keys(FILES).length);
  const saved = process.env.BANNER_DIR;
  process.env.BANNER_DIR = '/nonexistent-tower-banners';
  assets._reset();
  try {
    assert.deepEqual(assets.availableBanners(), []);
    assert.equal(assets.bannerFile('tickets'), null);
    const bare = ui.message(ui.card({ title: 'x', banner: 'tickets' }));
    assert.equal(bare.files, undefined, 'no banner file is attached when the image is missing');
    assert.doesNotMatch(JSON.stringify(bare.components[0].toJSON()), /attachment:/);
  } finally {
    process.env.BANNER_DIR = saved;
    assets._reset();
  }
});

test('the closing DM card carries the banner, so it can no longer be rejected for a missing image', () => {
  const views = require('../src/modules/tickets/views');
  const t = { id: 1, ticket_number: 4, subject: 'Help', close_reason: 'Done' };
  const payload = ui.message(views.dmClosed({ ticket: t, guildName: 'G', fileName: 'x.html' }), { files: [{ name: 'x.html' }] });
  assert.equal(payload.files.length, 2);   // the transcript and the banner
});

test('plain-text fallbacks exist for the closing and review DMs', () => {
  const views = require('../src/modules/tickets/views');
  const t = { id: 3, ticket_number: 4, subject: 'Help me', close_reason: 'Done' };
  assert.match(views.dmClosedPlain({ ticket: t, guildName: 'Amber' }), /Help me/);
  const review = views.dmReviewPlain({ ticket: t });
  assert.match(review.content, /How did we do/);
  assert.equal(review.components.length, 1);
  const thanks = views.dmThanksPlain({ rating: 4, askFeedback: true, ticketId: 3 });
  assert.match(thanks.content, /4 out of 5/);
  assert.equal(thanks.components.length, 1);
  assert.equal(views.dmThanksPlain({ rating: 4, askFeedback: false, ticketId: 3 }).components.length, 0);
});

test('staff are told the truth about the member DM', () => {
  assert.match(actions.dmNote({ delivered: true }), /received a copy and a review/);
  assert.match(actions.dmNote({ delivered: false, reason: 'dms-closed' }), /DMs closed/);
  assert.match(actions.dmNote({ delivered: false, reason: 'error' }), /console/);
  assert.ok(!/DMs closed/.test(actions.dmNote({ delivered: false, reason: 'error' })), 'a real error must not be reported as closed DMs');
});
