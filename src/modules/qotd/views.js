const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { card, fmt } = require('../../ui');
const { ic, object } = require('../../emojis');
const { colors, qotd } = require('../../constants');
const { clip } = require('../../lib/text');

const btn = (id, label, style, icon) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  const e = icon && object(icon);
  if (e) b.setEmoji(e);
  return b;
};

function questionCard({ number, question, kind, optionA, optionB, pingRoleId, suggestedBy }) {
  return card({
    banner: 'qotd', icon: 'question', title: `Question of the Day #${number}`, accent: colors.teal,
    description: [
      pingRoleId ? `<@&${pingRoleId}>` : '',
      `### ${question}`,
      ...(kind === 'choice' ? [`\uD83C\uDD70\uFE0F **${optionA}**`, `\uD83C\uDD71\uFE0F **${optionB}**`, 'Vote with a reaction, then tell us why in the thread.'] : []),
      `${ic('chat')}Answer in the thread below.${suggestedBy ? ` Suggested by ${fmt.user(suggestedBy)}.` : ''}`,
    ].filter(Boolean).join('\n'),
  });
}

function suggestionCard({ id, userId, question, status, decidedBy }) {
  const pending = !status || status === 'pending';
  return card({
    icon: 'question', title: pending ? 'Question Suggestion' : `Suggestion ${status === 'approved' ? 'Approved' : 'Rejected'}`,
    accent: pending ? colors.cobalt : status === 'approved' ? colors.teal : colors.alert,
    description: `### ${clip(question, qotd.maxLength)}`,
    fields: [
      ['Suggested By', fmt.user(userId), 'user'],
      ...(pending ? [] : [[status === 'approved' ? 'Approved By' : 'Rejected By', fmt.user(decidedBy), 'staff']]),
    ],
    rows: pending ? [new ActionRowBuilder().addComponents(
      btn(`qotd:approve:${id}`, 'Approve', ButtonStyle.Success, 'check'),
      btn(`qotd:reject:${id}`, 'Reject', ButtonStyle.Danger, 'cross'),
    )] : [],
  });
}

const lowQueue = (count) => card({
  icon: 'warning', title: 'Question Queue Running Low', accent: colors.alert,
  description: `Only **${count}** question${count === 1 ? ' is' : 's are'} left. Add more with \`/qotd add\`.`,
});

const empty = () => card({
  icon: 'warning', title: 'No Question To Post', accent: colors.alert,
  description: 'The queue is empty, so nothing was posted today. Add questions with `/qotd add`.',
});

function queueList(rows) {
  return card({
    icon: 'scroll', title: 'Question Queue',
    description: rows.length ? rows.map((q, i) => `**${i + 1}.** ${fmt.code(`#${q.id}`)} ${clip(q.question, 110)}${q.kind === 'choice' ? ' (this or that)' : ''}`).join('\n') : '*The queue is empty.*',
    fields: [['Showing', fmt.code(`next ${rows.length}`), 'eye']],
  });
}

function status({ settings, queued }) {
  const o = settings.utc_offset_min;
  const tz = `UTC${o >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(o) / 60)).padStart(2, '0')}:${String(Math.abs(o) % 60).padStart(2, '0')}`;
  return card({
    icon: 'info', title: 'Question Of The Day',
    fields: [
      ['Channel', fmt.channel(settings.channel_id), 'hash'],
      ['Posts At', fmt.code(`${String(settings.post_hour).padStart(2, '0')}:${String(settings.post_minute).padStart(2, '0')} ${tz}`), 'clock'],
      ['In The Queue', fmt.code(queued), 'scroll'],
      ['Ping Role', settings.ping_role_id ? fmt.role(settings.ping_role_id) : fmt.code('none'), 'bell'],
      ['Alerts Go To', settings.alert_channel_id ? fmt.channel(settings.alert_channel_id) : fmt.code('not set'), 'warning'],
    ],
  });
}

module.exports = { questionCard, suggestionCard, lowQueue, empty, queueList, status };
