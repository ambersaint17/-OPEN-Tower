const { PermissionFlagsBits } = require('discord.js');
const ui = require('../../ui');
const config = require('../../config');
const { ai, tickets } = require('../../constants');
const { levelFor } = require('../moderation/permissions');
const { ModError } = require('../moderation/actions');
const service = require('./service');
const actions = require('./actions');
const views = require('./views');

// The AI only helps in a ticket it was asked to help in, only until a person from staff joins in,
// and only a few times. State is kept in memory, so after a restart it simply stays quiet.
const states = new Map();   // ticket channel id -> { openerId, type, replies, silenced, lastAt, convo }

const staffLevel = (member) => levelFor([...member.roles.cache.values()].map((r) => r.name), {
  isOwner: member.guild.ownerId === member.id, isAdmin: member.permissions.has(PermissionFlagsBits.Administrator),
});

async function enabledFor(guildId, type) {
  if (!config.aiApiKey) return false;
  const settings = await service.getSettings(guildId);
  return Boolean(settings?.enabled && settings.ticket_types.includes(type));
}

// Called by the ticket module right after a ticket is created.
async function onOpen({ guild, ticket, channel, member }) {
  if (!(await enabledFor(guild.id, ticket.type))) return;
  const first = { role: 'user', content: `<ticket>\nSubject: ${ticket.form?.subject ?? ''}\nDetails: ${ticket.form?.details ?? ''}\n</ticket>` };
  let answer;
  try {
    answer = await actions.ticketReply({ guild, userId: member.id, conversation: [first] });
  } catch (err) {
    if (!(err instanceof ModError)) console.error('[ai] ticket open:', err.message);
    return;
  }
  states.set(channel.id, { openerId: member.id, type: ticket.type, replies: 1, silenced: false, lastAt: Date.now(), convo: [first, { role: 'assistant', content: answer }] });
  await channel.send({ ...ui.message(views.ticketCard({ answer, channelId: channel.id })), allowedMentions: { parse: [] } });
}

// Called for every message in a ticket channel.
async function onMessage(message) {
  const state = states.get(message.channel.id);
  if (!state || state.silenced || message.author.bot || !message.member) return;
  if (message.author.id !== state.openerId) {
    if (staffLevel(message.member) > 0) state.silenced = true;        // a person has joined in, so the AI steps back
    return;
  }
  const text = message.content?.trim();
  if (!text || text.length < 3 || Date.now() - state.lastAt < ai.ticketCooldownMs) return;
  if (state.replies >= ai.ticketMaxReplies) {
    state.silenced = true;
    await message.channel.send({ content: 'A staff member will take it from here.', allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }
  state.lastAt = Date.now();
  await message.channel.sendTyping().catch(() => {});
  const conversation = [...state.convo, { role: 'user', content: `<conversation>${text.slice(0, 1500)}</conversation>` }];
  try {
    const answer = await actions.ticketReply({ guild: message.guild, userId: message.author.id, conversation });
    state.replies += 1;
    state.convo = [...conversation, { role: 'assistant', content: answer }];
    await message.reply({ content: `${answer}\n-# AI-generated`, allowedMentions: { parse: [], repliedUser: false } });
  } catch (err) {
    state.silenced = true;
    if (!(err instanceof ModError)) console.error('[ai] ticket reply:', err.message);
  }
}

const silence = (channelId) => { const s = states.get(channelId); if (s) s.silenced = true; };
const forget = (channelId) => states.delete(channelId);
setInterval(() => { const cutoff = Date.now() - 24 * 60 * 60 * 1000; for (const [id, s] of states) if (s.lastAt < cutoff) states.delete(id); }, 60 * 60 * 1000).unref();

module.exports = { onOpen, onMessage, silence, forget, enabledFor, staffLevel, states, tickets };
