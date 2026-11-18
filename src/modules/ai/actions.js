const { ai } = require('../../constants');
const config = require('../../config');
const lib = require('../../lib/ai');
const { ModError } = require('../moderation/actions');
const { normalize, levelFor } = require('../moderation/permissions');
const claude = require('./claude');
const pool = require('./pool');
const service = require('./service');

// A short memory of each person's last few questions, so follow-ups make sense. Kept in memory only, and forgotten after a while.
const history = new Map();   // "guildId:userId" -> { at, turns: [{ role, content }] }
const lastAsk = new Map();   // "guildId:userId" -> timestamp, for the cooldown

const keyOf = (guildId, userId) => `${guildId}:${userId}`;
const isStaff = (member) => levelFor([...member.roles.cache.values()].map((r) => r.name)) > 0;
const isUnverified = (member) => member.roles.cache.some((r) => normalize(r.name) === 'unverified');

async function loadReady(guild) {
  const settings = await service.settingsOrDefault(guild.id);
  if (!config.aiApiKey) throw new ModError('The AI assistant is not set up yet. The owner needs to add an API key (AI_API_KEY).');
  if (!settings.enabled) throw new ModError('The AI assistant is switched off right now.');
  const knowledge = await service.listKnowledge(guild.id);
  if (!knowledge.length && !settings.instructions.trim()) throw new ModError('The assistant has not been given any server information yet. Staff can add some with `/ai knowledge add`.');
  return { settings, knowledge };
}

// Failures that mean "this model cannot answer right now", so another one should be tried.
const FAILOVER = new Set(['rate', 'credit', 'down', 'model', 'empty', 'other']);

// The models to use, in order: the main one, then the backups.
const modelsFor = (settings) => pool.listFor(claude.modelFor(settings.model, undefined, settings.model_id), settings.backup_models);

// One call to the model, with usage recorded. `messages` already contains the question.
// If the current model has run out (or is down), the next one takes over, and the request is repeated on it.
async function run({ guild, userId, mode, settings, knowledge, messages }) {
  const models = modelsFor(settings);
  const system = lib.buildSystem({ serverName: guild.name, knowledge, instructions: settings.instructions, mode });
  let lastError = null;
  for (let tried = 0; tried < models.length; tried++) {
    const model = pool.pick(guild.id, models);
    if (!model) break;
    try {
      const out = await claude.complete({ model, maxTokens: ai.maxTokens[mode], system, messages });
      pool.used(guild.id, models, model);
      await service.addUsage(guild.id, lib.dayKey(), userId, out.tokens).catch((err) => console.error('[ai] usage:', err.message));
      return { ...out, model };
    } catch (err) {
      if (!(err instanceof claude.AiError) || !FAILOVER.has(err.kind)) throw err;
      lastError = err;
      if (models.length > 1) pool.failed(guild.id, models, model, err.cooldownMs ?? 60_000);   // with no backup there is nowhere to switch to
    }
  }
  throw lastError ?? new claude.AiError('The assistant has reached its limit for now. Please try again in a little while.', { kind: 'rate' });
}

async function checkAllowed(guild, member, settings) {
  const usage = await service.usageFor(guild.id, lib.dayKey(), member.id);
  const verdict = lib.checkLimits({ settings, usage, isStaff: isStaff(member) });
  if (!verdict.ok) throw new ModError(verdict.reason);
}

// /ask. Returns { text, logId }.
async function ask({ guild, member, channelId, question }) {
  const text = String(question ?? '').trim();
  if (text.length < 3) throw new ModError('Ask a full question, for example: "How do I open a ticket?"');
  if (text.length > ai.askMaxChars) throw new ModError(`Keep your question under ${ai.askMaxChars} characters.`);
  if (member.user.bot) throw new ModError('Bots cannot use the assistant.');
  if (isUnverified(member)) throw new ModError('Verify yourself first, then you can ask me things.');

  const key = keyOf(guild.id, member.id);
  const wait = (lastAsk.get(key) ?? 0) + ai.userCooldownMs - Date.now();
  if (wait > 0) throw new ModError(`Slow down a little. You can ask again in ${Math.ceil(wait / 1000)} seconds.`);

  const { settings, knowledge } = await loadReady(guild);
  await checkAllowed(guild, member, settings);
  lastAsk.set(key, Date.now());

  const mem = history.get(key);
  const prior = mem && Date.now() - mem.at < ai.historyTtlMs ? mem.turns : [];
  const messages = [...lib.trimHistory(prior), { role: 'user', content: `<question>${text}</question>` }];
  let out;
  try {
    out = await run({ guild, userId: member.id, mode: 'ask', settings, knowledge, messages });
  } catch (err) {
    lastAsk.delete(key);          // a failed call should not cost the member their cooldown
    if (!(err instanceof claude.AiError)) throw err;
    // The model is unreachable, out of credit or busy: fall back to the closest entry of the server knowledge.
    const match = lib.bestMatch(text, knowledge);
    if (!match) throw new ModError(err.message);
    return { text: `The assistant is not available right now, so here is the closest match from the server info:\n\n**${match.title}**\n${match.excerpt}`, logId: null, fallback: true };
  }
  const answer = lib.sanitizeOutput(out.text);
  history.set(key, { at: Date.now(), turns: lib.trimHistory([...prior, { role: 'user', content: `<question>${text}</question>` }, { role: 'assistant', content: answer }]) });
  const logId = await service.addLog({ guildId: guild.id, userId: member.id, channelId, kind: 'ask', question: text, answer, tokens: out.tokens }).catch(() => null);
  return { text: answer, logId };
}

// Used by the ticket helper: a first answer or a follow-up, without storing the conversation anywhere.
async function ticketReply({ guild, userId, conversation }) {
  const { settings, knowledge } = await loadReady(guild);
  const usage = await service.usageFor(guild.id, lib.dayKey(), userId);
  if (usage.guildTokens >= settings.daily_token_budget) throw new ModError('The assistant has reached its limit for today.');
  let out;
  try {
    out = await run({ guild, userId, mode: 'ticket', settings, knowledge, messages: conversation });
  } catch (err) { throw err instanceof claude.AiError ? new ModError(err.message) : err; }
  return lib.sanitizeOutput(out.text, 1800);
}

// A summary of a ticket for staff. `transcript` is plain text built from the channel.
async function summarise({ guild, userId, transcript }) {
  const { settings, knowledge } = await loadReady(guild);
  const usage = await service.usageFor(guild.id, lib.dayKey(), userId);
  if (usage.guildTokens >= settings.daily_token_budget) throw new ModError('The assistant has reached its limit for today.');
  let out;
  try {
    out = await run({ guild, userId, mode: 'summary', settings, knowledge, messages: [{ role: 'user', content: `<ticket>\n${transcript}\n</ticket>` }] });
  } catch (err) { throw err instanceof claude.AiError ? new ModError(err.message) : err; }
  return lib.sanitizeOutput(out.text);
}

function resetMemory() { history.clear(); lastAsk.clear(); }

module.exports = { modelsFor, ask, ticketReply, summarise, loadReady, isStaff, isUnverified, resetMemory };
