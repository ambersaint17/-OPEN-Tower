const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/lib/giveaway');
const L = require('../src/lib/levels');
const views = require('../src/modules/giveaway/views');

const ROLE = '1565048876933578999';
const json = (container) => JSON.stringify(container.toJSON());

// ---------- durations and requirements ----------
test('durations are read in every common form', () => {
  assert.equal(g.parseDuration('30m'), 30 * 60_000);
  assert.equal(g.parseDuration('2h'), 2 * 3_600_000);
  assert.equal(g.parseDuration('1w'), 7 * g.DAY);
  assert.equal(g.parseDuration('1d 12h'), 36 * 3_600_000);
  assert.equal(g.parseDuration('3D'), 3 * g.DAY);
  for (const bad of ['', 'soon', '5', '0h', '1x', null, '-2h']) assert.equal(g.parseDuration(bad), null, String(bad));
});

test('only real requirements are kept', () => {
  assert.deepEqual(g.cleanRequirements({ minXp: 5000, minLevel: 0, roleId: 'abc', booster: false, minDays: -1 }), { minXp: 5000 });
  assert.deepEqual(g.cleanRequirements({ minLevel: 99, roleId: ROLE, booster: true, minDays: 30 }), { minLevel: L.MAX_LEVEL, roleId: ROLE, booster: true, minDays: 30 });
  assert.equal(g.hasRequirements({}), false);
  assert.equal(g.hasRequirements({ booster: true }), true);
});

test('each requirement is checked on its own, with what the member has', () => {
  const day = g.DAY;
  const facts = { xp: 2340, level: 3, roleIds: [ROLE], booster: false, joinedAt: Date.now() - 10 * day, now: Date.now() };
  assert.equal(g.evaluate({}, facts).ok, true);
  assert.equal(g.evaluate({ minXp: 2000 }, facts).ok, true);
  assert.equal(g.evaluate({ minXp: 5000 }, facts).ok, false);
  assert.equal(g.evaluate({ minLevel: 3 }, facts).ok, true);
  assert.equal(g.evaluate({ minLevel: 4 }, facts).ok, false);
  assert.equal(g.evaluate({ roleId: ROLE }, facts).ok, true);
  assert.equal(g.evaluate({ roleId: '123456789012345678' }, facts).ok, false);
  assert.equal(g.evaluate({ booster: true }, facts).ok, false);
  assert.equal(g.evaluate({ booster: true }, { ...facts, booster: true }).ok, true);
  assert.equal(g.evaluate({ minDays: 7 }, facts).ok, true);
  assert.equal(g.evaluate({ minDays: 30 }, facts).ok, false);
  const all = g.evaluate({ minXp: 5000, minLevel: 4, booster: true }, facts);
  assert.equal(all.ok, false);
  assert.deepEqual(all.checks.map((c) => c.ok), [false, false, false]);
  assert.equal(all.checks[0].have, '2,340 XP');
});

test('requirement lines read naturally', () => {
  const lines = g.requirementLines({ minXp: 5000, minLevel: 5, roleId: ROLE, booster: true, minDays: 1 });
  assert.equal(lines.length, 5);
  assert.match(lines[0], /5,000 XP/);
  assert.match(lines[2], new RegExp(ROLE));
  assert.match(lines[4], /1\+ day\b/);
  assert.deepEqual(g.requirementLines({}), []);
});

// ---------- entries ----------
test('entries follow the level and booster perks', () => {
  const total = (level, booster) => g.entryBreakdown(level, booster).total;
  assert.equal(total(0, false), 1);
  assert.equal(total(6, false), 1);
  assert.equal(total(7, false), 2);
  assert.equal(total(10, false), 3);
  assert.equal(total(1, true), 2);
  assert.equal(total(7, true), 4);
  assert.equal(total(10, true), 6);
  for (const level of [0, 7, 10]) for (const booster of [true, false]) assert.equal(total(level, booster), L.giveawayEntries(level, booster));
  assert.equal(g.entryBreakdown(10, true).parts.length, 4);
});

// ---------- picking ----------
test('winners are distinct, limited to the pool, and weighted by entries', () => {
  const pool = [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }];
  const three = g.pickWinners(pool, 3);
  assert.deepEqual([...three].sort(), ['a', 'b', 'c']);
  assert.equal(g.pickWinners(pool, 10).length, 3);
  assert.deepEqual(g.pickWinners([], 2), []);
  assert.deepEqual(g.pickWinners([{ id: 'x', weight: 0 }], 1), []);
  assert.equal(new Set(g.pickWinners(pool, 2)).size, 2);

  let seed = 7; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const wins = { heavy: 0, light: 0 };
  for (let i = 0; i < 6000; i++) wins[g.pickWinners([{ id: 'heavy', weight: 6 }, { id: 'light', weight: 1 }], 1, rng)[0]]++;
  assert.ok(wins.heavy / 6000 > 0.8 && wins.heavy / 6000 < 0.9, `6:1 weights gave ${wins.heavy / 6000}`);
});

// ---------- cards ----------
const row = (over = {}) => ({
  id: 12, guild_id: 'G', channel_id: 'C', message_id: 'M', host_id: '111111111111111111', prize: 'Discord Nitro', description: 'A monthly treat.',
  winner_note: 'Thanks for being here.', winners: 2, ends_at: new Date(Date.now() + 3_600_000), status: 'active', claim_hours: 48,
  requirements: { minXp: 5000, booster: true }, winner_ids: [], ping_role_id: ROLE, ...over,
});

test('the giveaway card shows the prize, requirements, bonus entries and an Enter button', () => {
  const card = views.announcement(row(), 7).toJSON();
  const text = JSON.stringify(card);
  assert.match(text, /Discord Nitro/);
  assert.match(text, /A monthly treat/);
  assert.match(text, /5,000 XP/);
  assert.match(text, /Server Booster/);
  assert.match(text, /doubled/);                         // the perk explanation
  assert.match(text, /attachment:\/\/tower-banner-giveaway\.png/);
  const button = card.components.find((c) => c.type === 1).components[0];
  assert.equal(button.custom_id, 'giveaway:enter:12');
  assert.match(json(views.announcement(row({ requirements: {} }), 0)), /Anyone can enter/);
});

test('text outside the card carries the ping, and the ended card replaces the button', () => {
  const payload = views.compose(views.announcement(row(), 0), { above: views.pingLine(row()) });
  assert.deepEqual(payload.components.map((c) => c.toJSON().type), [10, 17]);
  assert.match(payload.components[0].toJSON().content, new RegExp(ROLE));
  assert.equal(views.pingLine(row({ ping_role_id: null })), null);
  const ended = views.ended(row({ status: 'ended', winner_ids: ['222222222222222222'] }), 9).toJSON();
  assert.match(JSON.stringify(ended), /222222222222222222/);
  assert.equal(ended.components.some((c) => c.type === 1), false);
  assert.match(json(views.ended(row({ status: 'ended' }), 0)), /no winner/);
});

test('the winner message gives the next steps, a claim button, and links', () => {
  const winnerRow = row({ winner_ids: ['222222222222222222'] });
  const card = views.winnerMessage(winnerRow, ['222222222222222222'], { guildName: 'Amber', ticketChannelId: '999999999999999999' }).toJSON();
  const text = JSON.stringify(card);
  assert.match(text, /Congratulations/);
  assert.match(text, /Next steps/);
  assert.match(text, /General Support/);
  assert.match(text, /Thanks for being here/);                 // the custom note
  assert.match(text, /5,000 XP/);                              // what staff will verify
  assert.match(text, /48 hours/);
  const buttons = card.components.find((c) => c.type === 1).components;
  assert.equal(buttons[0].custom_id, 'giveaway:claim:12');
  assert.ok(buttons.some((b) => b.url === 'https://discord.com/channels/G/C/M'));
  assert.ok(buttons.some((b) => b.url === 'https://discord.com/channels/G/999999999999999999'));

  const dm = views.winnerMessage(winnerRow, ['222222222222222222'], { guildName: 'Amber', ticketChannelId: '999999999999999999', dm: true }).toJSON();
  const dmButtons = dm.components.find((c) => c.type === 1).components;
  assert.ok(!dmButtons.some((b) => b.custom_id), 'a DM cannot open a ticket, so it only links');
  assert.match(JSON.stringify(dm), /You won/);
  assert.match(json(views.winnerMessage(winnerRow, ['222222222222222222'], { reroll: true })), /Reroll/);
});

test('the private replies explain entries and unmet requirements', () => {
  const inCard = JSON.stringify(views.entered(row(), 10, true, { entryCount: 4 }).toJSON());
  assert.match(inCard, /You Are In/);
  assert.match(inCard, /Elite/);
  assert.match(inCard, /Server Booster/);
  assert.match(JSON.stringify(views.entered(row(), 0, false, { already: true }).toJSON()), /Already In/);
  const blocked = g.evaluate({ minXp: 5000, booster: true }, { xp: 2340, level: 3, booster: false });
  const text = JSON.stringify(views.unmet(blocked).toJSON());
  assert.match(text, /Requirements Not Met/);
  assert.match(text, /5,000 XP/);
  assert.match(text, /2,340 XP/);
  const verify = JSON.stringify(views.verifyCard(row(), { id: '333333333333333333' }, blocked, { entries: 2, entered: true, isWinner: false }).toJSON());
  assert.match(verify, /333333333333333333/);
  assert.match(verify, /Discord Nitro/);
});
