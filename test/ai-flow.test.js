// Runs the assistant end to end with fake Discord objects, an in-memory database and a fake model.
const test = require('node:test');
const path = require('node:path');
const assert = require('node:assert/strict');

// ---------- in-memory database ----------
const db = { settings: null, knowledge: [], usage: new Map(), log: [] }; let nextId = 1;
const keyOf = (t) => t.trim().toLowerCase();
const DEFAULTS = { enabled: false, model: 'haiku', model_id: '', instructions: '', ticket_types: [], user_daily_limit: 20, daily_token_budget: 300000 };
const fakeService = {
  getSettings: async () => db.settings, settingsOrDefault: async (g) => ({ guild_id: g, ...DEFAULTS, ...(db.settings ?? {}) }),
  saveSettings: async (g, s) => { db.settings = { ...s }; },
  listKnowledge: async () => [...db.knowledge].sort((a, b) => a.title.localeCompare(b.title)),
  getKnowledge: async (g, t) => db.knowledge.find((e) => keyOf(e.title) === keyOf(t)) ?? null,
  saveKnowledge: async (g, title, content) => { const old = db.knowledge.find((e) => keyOf(e.title) === keyOf(title)); if (old) Object.assign(old, { title, content }); else db.knowledge.push({ id: nextId++, title, content }); },
  updateKnowledgeById: async (g, id, title, content) => { Object.assign(db.knowledge.find((e) => e.id === id), { title, content }); },
  usageFor: async (g, day, user) => { let guildTokens = 0; let guildRequests = 0; for (const [k, v] of db.usage) { if (k.startsWith(`${day}|`)) { guildTokens += v.tokens; guildRequests += v.requests; } }
    return { userRequests: db.usage.get(`${day}|${user}`)?.requests ?? 0, guildTokens, guildRequests }; },
  addUsage: async (g, day, user, tokens) => { const k = `${day}|${user}`; const v = db.usage.get(k) ?? { requests: 0, tokens: 0 }; v.requests++; v.tokens += tokens; db.usage.set(k, v); },
  addLog: async (l) => { const row = { id: nextId++, ...l, rating: null }; db.log.push(row); return row.id; },
  rate: async (id, user, rating) => { const row = db.log.find((r) => r.id === id && r.user_id === user || (r.id === id && r.userId === user)); if (!row) return false; row.rating = rating; return true; },
};
const servicePath = path.join(__dirname, '..', 'src/modules/ai/service.js');
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: fakeService };

const config = require('../src/config');
const { ai } = require('../src/constants');
const claude = require('../src/modules/ai/claude');
const ticketService = require('../src/modules/tickets/service');
const actions = require('../src/modules/ai/actions');
const handlers = require('../src/modules/ai/handlers');
const aiTickets = require('../src/modules/ai/tickets');

config.aiApiKey = 'sk-test';
const calls = [];
let reply = 'Open a ticket in the tickets channel.';
claude.complete = async (req) => { calls.push(req); if (reply instanceof Error) throw reply; return { text: reply, input: 800, output: 40, tokens: 840 }; };

// ---------- fake Discord ----------
const col = (items = []) => Object.assign(new Map(items.map((i) => [i.id, i])), { find(fn) { return [...this.values()].find(fn); }, some(fn) { return [...this.values()].some(fn); } });
const guild = { id: 'G1', name: 'Amber Saint', ownerId: 'owner', roles: { cache: col([{ id: '900000000000000001', name: 'Moderator' }]) } };
function member(id, { roles = [], admin = false } = {}) {
  return { id, guild, user: { id, bot: false }, roles: { cache: col(roles.map((n, i) => ({ id: `r${i}`, name: n }))) }, permissions: { has: () => admin } };
}
const ask = (m, question) => actions.ask({ guild, member: m, channelId: 'C1', question });
const flat = (p) => JSON.stringify(p.components.map((c) => c.toJSON()));

test('the assistant stays off until it is set up, then answers from the knowledge', async () => {
  const alice = member('alice');
  await assert.rejects(ask(alice, 'How do I verify?'), /switched off/);
  db.settings = { ...DEFAULTS, enabled: true };
  await assert.rejects(ask(alice, 'How do I verify?'), /not been given any server information/);

  await handlers.storeKnowledge({ guildId: 'G1', userId: 'owner', title: 'Verification', content: 'Press the Verify button in #verify and solve the captcha.' });
  const result = await ask(alice, 'How do I verify?');
  assert.equal(result.text, 'Open a ticket in the tickets channel.');
  const req = calls.at(-1);
  assert.equal(req.model, 'claude-haiku-5-5');
  assert.match(req.system[0].text, /Press the Verify button/);
  assert.match(req.system[0].text, /Amber Saint/);
  assert.deepEqual(req.messages, [{ role: 'user', content: '<question>How do I verify?</question>' }]);
  assert.equal(db.log.at(-1).kind, 'ask');
  assert.equal([...db.usage.values()][0].tokens, 840);
  assert.ok(result.logId);
});

test('slow down: one question every few seconds, and a failed call is not charged', async () => {
  const bob = member('bob');
  const first = await ask(bob, 'What are the rules?');
  assert.ok(first.text);
  await assert.rejects(ask(bob, 'And the prices?'), /Slow down/);

  const carol = member('carol');
  reply = new claude.AiError('The assistant is busy right now. Please try again in a minute.');
  await assert.rejects(ask(carol, 'Anything there?'), /busy right now/);
  reply = 'Fine, here you go.';
  assert.ok((await ask(carol, 'Anything there?')).text, 'the cooldown was not spent on the failed call');
});

test('follow-up questions remember the last few turns', async () => {
  const saved = ai.userCooldownMs; ai.userCooldownMs = 0;
  const dave = member('dave');
  reply = 'Prices are in a ticket.';
  await ask(dave, 'How much is a commission?');
  await ask(dave, 'And how long does it take?');
  const req = calls.at(-1);
  assert.equal(req.messages.length, 3);
  assert.equal(req.messages[0].content, '<question>How much is a commission?</question>');
  assert.equal(req.messages[1].role, 'assistant');
  assert.equal(req.messages[2].content, '<question>And how long does it take?</question>');
  ai.userCooldownMs = saved;
});

test('questions are checked before the model is called', async () => {
  const saved = ai.userCooldownMs; ai.userCooldownMs = 0;
  const before = calls.length;
  await assert.rejects(ask(member('e1'), 'hi'), /full question/);
  await assert.rejects(ask(member('e2'), 'x'.repeat(ai.askMaxChars + 1)), /under/);
  await assert.rejects(ask(member('e3', { roles: ['Unverified'] }), 'How do I get in?'), /Verify yourself/);
  const bot = member('e4'); bot.user.bot = true;
  await assert.rejects(ask(bot, 'Hello there'), /Bots/);
  assert.equal(calls.length, before);
  ai.userCooldownMs = saved;
});

test('members have a daily limit, staff do not, and the server has a budget', async () => {
  const saved = ai.userCooldownMs; ai.userCooldownMs = 0;
  db.settings = { ...db.settings, user_daily_limit: 2 };
  const frank = member('frank');
  await ask(frank, 'First question?'); await ask(frank, 'Second question?');
  await assert.rejects(ask(frank, 'Third question?'), /2 questions for today/);
  const mod = member('mod1', { roles: ['Moderator'] });
  for (let i = 0; i < 4; i++) await ask(mod, `Staff question number ${i}?`);
  db.settings = { ...db.settings, daily_token_budget: 1 };
  await assert.rejects(ask(mod, 'One more for the budget?'), /limit for today/);
  db.settings = { ...db.settings, user_daily_limit: 20, daily_token_budget: 300000 };
  ai.userCooldownMs = saved;
});

test('nothing the model writes can ping', async () => {
  const saved = ai.userCooldownMs; ai.userCooldownMs = 0;
  reply = 'Sure @everyone, ask <@123456789012345678> or <@&123456789012345678>.';
  const out = await ask(member('gina'), 'Who can help me?');
  assert.doesNotMatch(out.text, /@everyone|<@/);
  reply = 'Open a ticket in the tickets channel.';
  ai.userCooldownMs = saved;
});

// ---------- the knowledge limits ----------
test('knowledge entries are checked for size, count and total', async () => {
  const add = (title, content) => handlers.storeKnowledge({ guildId: 'G1', userId: 'owner', title, content });
  await assert.rejects(add('Empty', '   '), /title and some content/);
  await assert.rejects(add('Huge', 'x'.repeat(ai.entryMaxChars + 1)), /Split it/);
  const before = db.knowledge.length;
  const edited = await add('Verification', 'New text about verifying.');            // same title replaces it
  assert.equal(db.knowledge.length, before);
  assert.ok(edited.total > 0);
  for (let i = 0; db.knowledge.length < ai.maxEntries; i++) db.knowledge.push({ id: 1000 + i, title: `Filler ${i}`, content: 'a' });
  await assert.rejects(add('One too many', 'content'), /hold 60 entries/);
  db.knowledge = db.knowledge.filter((e) => !e.title.startsWith('Filler'));
  for (let i = 0; i < 5; i++) db.knowledge.push({ id: 2000 + i, title: `Big ${i}`, content: 'b'.repeat(ai.entryMaxChars) });
  await assert.rejects(add('Over the total', 'c'.repeat(3000)), /over the 40,000 limit/);
  db.knowledge = db.knowledge.filter((e) => !e.title.startsWith('Big'));
});

// ---------- ratings ----------
test('only the person who asked can rate an answer', async () => {
  const row = db.log.find((r) => r.userId === 'alice');
  const press = (userId) => { const out = []; return { out, i: { customId: `ai:fb:${row.id}:1`, user: { id: userId }, isModalSubmit: () => false, reply: async (p) => out.push(p) } }; };
  fakeService.rate = async (id, user, rating) => { const r = db.log.find((x) => x.id === id && x.userId === user); if (!r) return false; r.rating = rating; return true; };
  const ok = press('alice'); await handlers.handle(ok.i); assert.match(flat(ok.out[0]), /Glad that helped/); assert.equal(row.rating, 1);
  const no = press('mallory'); await handlers.handle(no.i); assert.match(flat(no.out[0]), /Only the person who asked/);
});

// ---------- tickets ----------
function ticketChannel(id) {
  const sent = [];
  return { id, sent, send: async (p) => { sent.push(p); return p; }, sendTyping: async () => {} };
}
const ticket = (type) => ({ type, form: { subject: 'Cannot verify', details: 'The captcha does not load for me.' }, opener_id: 'opener', channel_id: 'T1' });

test('the assistant opens a ticket only where it was switched on, and answers the opener', async () => {
  const opener = member('opener');
  const off = ticketChannel('T0');
  db.settings = { ...db.settings, ticket_types: ['support'] };
  await aiTickets.onOpen({ guild, ticket: ticket('services'), channel: off, member: opener });
  assert.equal(off.sent.length, 0, 'commissions stay private unless the owner opts in');

  const channel = ticketChannel('T1');
  reply = 'Try refreshing Discord, then press Verify again.';
  await aiTickets.onOpen({ guild, ticket: ticket('support'), channel, member: opener });
  assert.equal(channel.sent.length, 1);
  const text = flat(channel.sent[0]);
  assert.match(text, /Try refreshing Discord/);
  assert.match(text, /ai:human:T1/); assert.match(text, /ai:solved:T1/);
  assert.match(calls.at(-1).messages[0].content, /Subject: Cannot verify/);
  assert.match(calls.at(-1).system[1].text, /private support ticket/);
  assert.equal(db.log.filter((r) => r.kind === 'ticket').length, 0, 'ticket text is never stored');

  const saved = ai.ticketCooldownMs; ai.ticketCooldownMs = 0;
  const reaction = [];
  const message = (m, content) => ({ channel: { id: 'T1', send: async (p) => reaction.push(['send', p]), sendTyping: async () => {} }, guild, author: m.user, member: m, content, reply: async (p) => reaction.push(['reply', p]) });
  reply = 'It sometimes helps to disable your VPN.';
  await aiTickets.onMessage(message(opener, 'I already tried that'));
  assert.equal(reaction.at(-1)[0], 'reply');
  assert.match(reaction.at(-1)[1].content, /disable your VPN/);
  assert.deepEqual(reaction.at(-1)[1].allowedMentions, { parse: [], repliedUser: false });
  assert.match(calls.at(-1).messages.at(-1).content, /<conversation>I already tried that<\/conversation>/);

  await aiTickets.onMessage(message(opener, 'still not working sorry'));            // third answer
  await aiTickets.onMessage(message(opener, 'okay and now what should I do'));      // over the cap
  assert.match(reaction.at(-1)[1].content, /staff member will take it from here/);
  const countAfter = reaction.length;
  await aiTickets.onMessage(message(opener, 'hello?'));
  assert.equal(reaction.length, countAfter, 'silent once it handed over');
  ai.ticketCooldownMs = saved;
});

test('the assistant steps back the moment staff join in', async () => {
  const opener = member('opener2'); const channel = ticketChannel('T2');
  await aiTickets.onOpen({ guild, ticket: { ...ticket('support'), opener_id: 'opener2' }, channel, member: opener });
  assert.ok(aiTickets.states.get('T2'));
  const saved = ai.ticketCooldownMs; ai.ticketCooldownMs = 0;
  const heard = [];
  const message = (m, content) => ({ channel: { id: 'T2', send: async () => {}, sendTyping: async () => {} }, guild, author: m.user, member: m, content, reply: async (p) => heard.push(p) });
  await aiTickets.onMessage(message(member('helper', { roles: ['Moderator'] }), 'Hi, I am looking at this now'));
  assert.equal(aiTickets.states.get('T2').silenced, true);
  await aiTickets.onMessage(message(opener, 'thank you, can you check my captcha'));
  assert.equal(heard.length, 0);
  ai.ticketCooldownMs = saved;
});

test('Talk to a human silences the assistant and calls staff, and only the opener or staff can press it', async () => {
  const opener = member('opener3'); const channel = ticketChannel('T3');
  await aiTickets.onOpen({ guild, ticket: { ...ticket('support'), opener_id: 'opener3' }, channel, member: opener });
  ticketService.byChannel = async (id) => ({ ...ticket('support'), channel_id: id, opener_id: 'opener3' });
  const press = (m, action) => { const out = []; const posted = []; return { out, posted, i: { customId: `ai:${action}:T3`, member: m, user: m.user, guild, channel: { send: async (p) => posted.push(p) }, isModalSubmit: () => false, reply: async (p) => out.push(p) } }; };

  const stranger = press(member('stranger'), 'human');
  await handlers.handle(stranger.i);
  assert.match(flat(stranger.out[0]), /Only the person who opened/);
  assert.equal(aiTickets.states.get('T3').silenced, false);

  const real = press(opener, 'human');
  await handlers.handle(real.i);
  assert.equal(aiTickets.states.get('T3').silenced, true);
  assert.match(real.posted[0].content, /<@&900000000000000001>/);        // the Moderator role is pinged
  assert.match(real.posted[0].content, /take over this ticket/);
  assert.match(flat(real.out[0]), /Staff Called/);

  const solved = press(opener, 'solved'); await handlers.handle(solved.i);
  assert.match(flat(solved.out[0]), /Glad That Helped/);
});

test('staff can have a ticket summarised, with the ticket as data', async () => {
  reply = '- Member cannot verify.\n- Suggested: check the captcha loads.';
  const out = await actions.summarise({ guild, userId: 'helper', transcript: 'Type: General Support\nopener: it does not load' });
  assert.match(out, /Member cannot verify/);
  const req = calls.at(-1);
  assert.match(req.messages[0].content, /^<ticket>\nType: General Support/);
  assert.match(req.system[1].text, /summarising/);
});

test('when the model cannot be reached, /ask answers from the closest knowledge entry', async () => {
  const saved = ai.userCooldownMs; ai.userCooldownMs = 0;
  await handlers.storeKnowledge({ guildId: 'G1', userId: 'owner', title: 'Commission prices', content: 'Prices depend on the size of the project. Open a services ticket to get a quote.' });
  reply = new claude.AiError('The AI account has run out of credit.');
  const out = await ask(member('hana'), 'How much do commission prices cost?');
  assert.equal(out.fallback, true);
  assert.equal(out.logId, null);
  assert.match(out.text, /not available right now/);
  assert.match(out.text, /Commission prices/);
  assert.match(out.text, /services ticket/);
  await assert.rejects(ask(member('ivan'), 'What is the weather on mars?'), /run out of credit/);   // nothing relevant: the real reason is shown
  reply = 'Fine.';
  ai.userCooldownMs = saved;
});

// ---------- switching between models ----------
test('when the main model runs out, the backup answers, and it stays on the backup until that runs out too', async () => {
  const pool = require('../src/modules/ai/pool');
  const saved = ai.userCooldownMs; ai.userCooldownMs = 0;
  const log = console.log; console.log = () => {};
  const MAIN = 'nvidia/nemotron-3.5-super-vl:free'; const BACKUP = 'nvidia/nemotron-3.5-lightning:free';
  db.settings = { ...DEFAULTS, enabled: true, model_id: MAIN, backup_models: [BACKUP] };
  pool.reset('G1');
  const used = [];
  const limited = new Set();
  claude.complete = async (req) => {
    used.push(req.model);
    if (limited.has(req.model)) throw new claude.AiError('The assistant is busy right now.', { kind: 'rate', cooldownMs: 40 });
    return { text: `answer from ${req.model}`, input: 1, output: 1, tokens: 2 };
  };
  const who = (n) => member(`switch${n}`);

  assert.match((await ask(who(1), 'First question here?')).text, /super-vl/);
  limited.add(MAIN);                                                 // the main model hits its limit
  assert.match((await ask(who(2), 'Second question here?')).text, /lightning/);
  assert.deepEqual(used.slice(-2), [MAIN, BACKUP], 'the failed call was repeated on the backup, within the same question');
  const before = used.length;
  assert.match((await ask(who(3), 'Third question here?')).text, /lightning/);
  assert.equal(used.length, before + 1, 'the main model is not even tried while it rests');

  limited.delete(MAIN); limited.add(BACKUP);                         // the main one recovers; the backup runs out
  await new Promise((resolve) => setTimeout(resolve, 60));            // the main model's short rest is over
  assert.match((await ask(who(4), 'Fourth question here?')).text, /super-vl/);
  assert.equal(aiRun(), BACKUP === used.at(-1) ? BACKUP : MAIN);

  console.log = log;
  claude.complete = async (req) => ({ text: 'Open a ticket in the tickets channel.', input: 800, output: 40, tokens: 840 });
  ai.userCooldownMs = saved;
  function aiRun() { return used.at(-1); }
});

test('when every model has run out, the question is answered from the knowledge instead', async () => {
  const pool = require('../src/modules/ai/pool');
  const saved = ai.userCooldownMs; ai.userCooldownMs = 0;
  const log = console.log; console.log = () => {};
  db.settings = { ...DEFAULTS, enabled: true, model_id: 'a/main:free', backup_models: ['b/backup:free'] };
  pool.reset('G1');
  claude.complete = async () => { throw new claude.AiError('The assistant is busy right now.', { kind: 'rate', cooldownMs: 600_000 }); };
  await handlers.storeKnowledge({ guildId: 'G1', userId: 'owner', title: 'Commission prices', content: 'Prices depend on the size of the project. Open a services ticket to get a quote.' });
  const out = await ask(member('allout'), 'How much do commission prices cost?');
  assert.equal(out.fallback, true);
  assert.match(out.text, /closest match/);
  const calls = [];
  claude.complete = async (req) => { calls.push(req.model); return { text: 'back', input: 1, output: 1, tokens: 2 }; };
  const again = await ask(member('allout2'), 'How much do commission prices cost?');
  assert.equal(again.fallback, true, 'both models are still resting, so they are not called again');
  assert.equal(calls.length, 0);
  console.log = log;
  pool.reset('G1');
  db.settings = { ...DEFAULTS, enabled: true };
  claude.complete = async () => ({ text: 'Open a ticket in the tickets channel.', input: 800, output: 40, tokens: 840 });
  ai.userCooldownMs = saved;
});
