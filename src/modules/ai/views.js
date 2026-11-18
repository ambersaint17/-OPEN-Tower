const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ui = require('../../ui');
const { object } = require('../../emojis');
const { colors, ai } = require('../../constants');
const { clip } = require('../../lib/text');
const lib = require('../../lib/ai');

const { fmt } = ui;
const NOTE = '-# AI-generated. For anything important, check with staff.';

// The answer to /ask. A public answer quotes the question first so everyone can follow it.
function answerCard({ answer, question, isPublic, logId, ticketUrl }) {
  const buttons = [];
  if (logId) {
    buttons.push(new ButtonBuilder().setCustomId(`ai:fb:${logId}:1`).setLabel('Helpful').setEmoji('👍').setStyle(ButtonStyle.Secondary));
    buttons.push(new ButtonBuilder().setCustomId(`ai:fb:${logId}:0`).setLabel('Not helpful').setEmoji('👎').setStyle(ButtonStyle.Secondary));
  }
  if (ticketUrl) buttons.push(new ButtonBuilder().setLabel('Talk to staff').setStyle(ButtonStyle.Link).setURL(ticketUrl));
  return ui.card({
    icon: 'sparkle', title: 'Tower Assistant', accent: colors.cobalt,
    description: [isPublic ? `> ${clip(question, 200).replace(/\n/g, ' ')}` : null, answer, NOTE].filter(Boolean).join('\n\n'),
    rows: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [],
  });
}

// The first answer inside a ticket, with a way to reach a person at any time.
function ticketCard({ answer, channelId }) {
  const human = new ButtonBuilder().setCustomId(`ai:human:${channelId}`).setLabel('Talk to a human').setStyle(ButtonStyle.Primary);
  const solved = new ButtonBuilder().setCustomId(`ai:solved:${channelId}`).setLabel('That solved it').setStyle(ButtonStyle.Success);
  return ui.card({
    icon: 'sparkle', title: 'A First Answer', accent: colors.cobalt,
    description: `${answer}\n\n${NOTE}\nA staff member will still look at your ticket. If I did not help, press **Talk to a human**.`,
    rows: [new ActionRowBuilder().addComponents(human, solved)],
  });
}

// One line per model: the active one is marked, and one that ran out says when it wakes up.
function modelLines(models) {
  if (!models.length) return fmt.code('not set: use /ai settings model_id');
  return models.map((m, i) => `${m.active ? '▶' : '•'} ${fmt.code(m.model)} ${i === 0 ? '(main)' : '(backup)'}${m.restingUntil ? ` resting, back ${fmt.time(m.restingUntil, 'R')}` : ''}`).join('\n');
}

const statusCard = ({ settings, keyPresent, knowledge, usage, ratings, ticketLabels, engine }) => ui.card({
  icon: 'settings', title: 'AI Assistant', accent: settings.enabled && keyPresent ? colors.teal : colors.cobalt,
  description: !keyPresent ? '**No API key found.** Add `AI_API_KEY` to the host settings and restart Tower. Everything else keeps working.' : null,
  fields: [
    ['Status', settings.enabled ? 'On' : 'Off', 'check'],
    ['Service', fmt.code(engine.provider), 'link'],
    ['Models', modelLines(engine.models), 'sparkle'],
    ['Knowledge', fmt.code(`${knowledge.length} ${knowledge.length === 1 ? 'entry' : 'entries'}, ${lib.knowledgeSize(knowledge).toLocaleString('en-US')} characters`), 'scroll'],
    ['Limits', fmt.code(`${settings.user_daily_limit} questions per member, ${settings.daily_token_budget.toLocaleString('en-US')} tokens per day`), 'clock'],
    ['Used Today', fmt.code(`${usage.guildRequests} questions, ${usage.guildTokens.toLocaleString('en-US')} tokens`), 'stats'],
    ['Helpful Ratings', fmt.code(`${ratings.up} up, ${ratings.down} down`), 'trophy'],
    ['Helps In Tickets', ticketLabels.length ? ticketLabels.join(', ') : 'none', 'ticket'],
  ].filter(Boolean),
});

function knowledgeList(entries) {
  const total = lib.knowledgeSize(entries);
  const description = entries.length
    ? entries.map((e) => `• ${fmt.bold(clip(e.title, 60))}, ${e.content.length.toLocaleString('en-US')} characters`).join('\n')
    : 'Nothing yet. Add what the assistant should know with `/ai knowledge add`.';
  return ui.notice('Assistant Knowledge', description, { icon: 'scroll', fields: [['Total', fmt.code(`${total.toLocaleString('en-US')} of ${ai.maxKnowledgeChars.toLocaleString('en-US')} characters`), 'stats']] });
}

function logCard(rows) {
  const mark = (r) => (r.rating === 1 ? '👍' : r.rating === 0 ? '👎' : '▫️');
  const description = rows.length
    ? rows.map((r) => `${mark(r)} ${fmt.user(r.user_id)} ${fmt.time(r.created_at, 'R')}: ${clip(r.question.replace(/\n/g, ' '), 90)}`).join('\n')
    : 'No questions yet.';
  return ui.notice('Recent Questions', `${description}\n\n-# Questions from /ask are kept for 30 days. Ticket conversations are never stored.`, { icon: 'search' });
}

module.exports = { answerCard, ticketCard, statusCard, knowledgeList, logCard, NOTE };
