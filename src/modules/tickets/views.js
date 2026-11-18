const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { card, fmt } = require('../../ui');
const { ic, object } = require('../../emojis');
const { colors, tickets } = require('../../constants');
const { caseLabel, clip, quote } = require('../../lib/text');
const { formatSeconds } = require('../../lib/time');

const typeOf = (key) => tickets.types[key] ?? { label: key, icon: 'ticket', summary: 'Details' };
const label = (n) => `Ticket ${caseLabel(n)}`;
const stars = (n) => '\u2605'.repeat(n) + '\u2606'.repeat(5 - n);
const channelUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

function button(id, text, style = ButtonStyle.Secondary, icon, disabled = false) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(text).setStyle(style).setDisabled(disabled);
  const emoji = icon && object(icon);
  if (emoji) b.setEmoji(emoji);
  return b;
}
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const linkButton = (url, text) => new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(text);

// ---------- the public panel ----------

function panel() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:open')
    .setPlaceholder('Choose what you need help with')
    .addOptions(Object.entries(tickets.types).map(([value, t]) => {
      const emoji = object(t.icon);
      return { label: t.label, value, description: t.description, ...(emoji ? { emoji } : {}) };
    }));
  return card({
    banner: 'tickets',
    icon: 'ticket',
    title: 'Support',
    description: 'Pick what you need from the menu below. A short form opens, then Tower creates a private channel for you and the right staff.',
    blocks: [
      [
        `### ${ic('play')}How it works`,
        '**1.** Choose a ticket type and fill in the short form.',
        '**2.** Tower opens a private channel that only you and the right staff can see.',
        '**3.** Chat there until it is sorted. Staff close the ticket, and you get a transcript and a quick review.',
      ].join('\n'),
      [
        `### ${ic('info')}Before you open one`,
        'Be specific, and fill in the format in the form. Clear tickets are answered faster.',
        `You can have up to **${tickets.maxOpenPerMember}** open tickets at a time. Misuse can get your access blocked.`,
      ].join('\n'),
    ],
    rows: [row(menu)],
  });
}

// ---------- inside the ticket ----------

// The form answers, laid out for whoever reads them.
function formBlocks(ticket) {
  const t = typeOf(ticket.type);
  const f = ticket.form ?? {};
  return [`**${t.summary}**\n${quote(f.details ?? '*No details*', 1500)}`];
}

function openingCard({ ticket, opener }) {
  const t = typeOf(ticket.type);
  const f = ticket.form ?? {};
  const claimed = ticket.claimed_by;
  return card({
    icon: t.icon,
    title: `${label(ticket.ticket_number)} | ${t.label}`,
    thumbnail: opener?.displayAvatarURL?.({ extension: 'png', size: 256 }),
    description: `${fmt.user(ticket.opener_id)}, thanks for reaching out. Staff will be with you shortly. Please keep everything about this issue in this channel.`,
    blocks: formBlocks(ticket),
    fields: [
      ['Opened By', `${fmt.user(ticket.opener_id)} (${ticket.opener_tag})`, 'user'],
      ['Subject', clip(ticket.subject, 100), 'hash'],
      ['Username', fmt.code(clip(f.username ?? 'not given', 60)), 'game'],
      ...(f.reported ? [['Reporting', fmt.code(clip(f.reported, 80)), 'flag']] : []),
      ['Handled By', claimed ? fmt.user(claimed) : fmt.bold('Not claimed yet'), 'staff'],
    ],
    rows: [row(
      button(`ticket:claim:${ticket.id}`, claimed ? 'Claimed' : 'Claim', ButtonStyle.Success, 'check', Boolean(claimed)),
      button(`ticket:close:${ticket.id}`, 'Close Ticket', ButtonStyle.Danger, 'lock'),
    )],
  });
}

function inactiveNotice({ openerId, closeAt }) {
  return card({
    icon: 'hourglass',
    title: 'Ticket Closing Soon',
    accent: colors.alert,
    description: `${fmt.user(openerId)}, we have not heard back from you. This ticket will close ${fmt.time(closeAt, 'R')} unless you reply.\nSend any message here to keep it open.`,
    fields: [['Closes', fmt.time(closeAt, 'F'), 'clock']],
  });
}

const inactiveCancelled = () => card({
  icon: 'check', title: 'Closure Cancelled', accent: colors.teal,
  description: 'Thanks for replying. The ticket will stay open.',
});

function closedCard({ ticket, deleteAt }) {
  return card({
    icon: 'lock',
    title: `${label(ticket.ticket_number)} Closed`,
    accent: colors.alert,
    description: deleteAt
      ? `This ticket is closed and the member has been removed from this channel. It will be deleted ${fmt.time(deleteAt, 'R')}. Staff can reopen it until then.`
      : 'This ticket is closed.',
    fields: [
      ['Closed By', fmt.user(ticket.closed_by), 'staff'],
      ['Reason', clip(ticket.close_reason ?? 'No reason given', 300), 'flag'],
    ],
    rows: deleteAt ? [row(
      button(`ticket:reopen:${ticket.id}`, 'Reopen', ButtonStyle.Secondary, 'unlock'),
      button(`ticket:delete:${ticket.id}`, 'Delete Now', ButtonStyle.Danger, 'trash'),
    )] : [],
  });
}

const reopenedCard = (byId) => card({
  icon: 'unlock', title: 'Ticket Reopened', accent: colors.teal,
  description: `${fmt.user(byId)} reopened this ticket.`,
});

// ---------- the staff channel ----------

function handlingCard({ ticket, guildId, mention, opener }) {
  const t = typeOf(ticket.type);
  const f = ticket.form ?? {};
  const claimed = ticket.claimed_by;
  return card({
    icon: t.icon,
    title: `New Ticket ${caseLabel(ticket.ticket_number)}`,
    thumbnail: opener?.displayAvatarURL?.({ extension: 'png', size: 256 }),
    description: `${mention ? `${mention} ` : ''}${fmt.user(ticket.opener_id)} opened a **${t.label}** ticket.`,
    blocks: formBlocks(ticket),
    fields: [
      ['Type', fmt.bold(t.label), 'info'],
      ['From', `${fmt.user(ticket.opener_id)} (${ticket.opener_tag})`, 'user'],
      ['Subject', clip(ticket.subject, 100), 'hash'],
      ['Username', fmt.code(clip(f.username ?? 'not given', 60)), 'game'],
      ...(f.reported ? [['Reporting', fmt.code(clip(f.reported, 80)), 'flag']] : []),
      ['Status', claimed ? `Claimed by ${fmt.user(claimed)}` : fmt.bold('Waiting for staff'), 'staff'],
    ],
    rows: [row(linkButton(channelUrl(guildId, ticket.channel_id), 'Open Ticket'))],
  });
}

function inactiveHint({ ticket, guildId }) {
  return card({
    icon: 'hourglass',
    title: `${label(ticket.ticket_number)} Is Waiting On The Member`,
    description: `${fmt.user(ticket.opener_id)} has not replied for 2 days. If you want to wrap this up, run \`/ticket inactive\` inside the ticket and pick how long they have.`,
    fields: [['Staff Reply', fmt.time(ticket.last_staff_message_at, 'R'), 'clock']],
    rows: [row(linkButton(channelUrl(guildId, ticket.channel_id), 'Open Ticket'))],
  });
}

// ---------- ticket-logs, and what the opener receives ----------

function logCard({ ticket, messages, fileName, firstResponse, openedFor }) {
  const t = typeOf(ticket.type);
  return card({
    icon: 'folder',
    title: `${label(ticket.ticket_number)} Closed`,
    accent: colors.alert,
    file: fileName,
    fields: [
      ['Type', fmt.bold(t.label), 'info'],
      ['Subject', clip(ticket.subject, 100), 'hash'],
      ['Opened By', `${fmt.user(ticket.opener_id)} (${ticket.opener_tag})`, 'user'],
      ['Handled By', ticket.claimed_by ? fmt.user(ticket.claimed_by) : fmt.code('nobody'), 'staff'],
      ['Closed By', fmt.user(ticket.closed_by), 'lock'],
      ['Reason', clip(ticket.close_reason ?? 'No reason given', 300), 'flag'],
      ['Open For', fmt.code(openedFor), 'hourglass'],
      ['First Response', fmt.code(firstResponse), 'clock'],
      ['Messages', fmt.code(messages), 'chat'],
    ],
  });
}

function dmClosed({ ticket, guildName, fileName }) {
  return card({
    banner: 'tickets',
    icon: 'ticket',
    title: `Your ticket in ${guildName} was closed`,
    description: 'Thank you for contacting us. A transcript of the conversation is attached, and you can open it in any browser.',
    file: fileName,
    fields: [
      ['Ticket', fmt.code(caseLabel(ticket.ticket_number)), 'ticket'],
      ['Subject', clip(ticket.subject, 100), 'hash'],
      ['Reason', clip(ticket.close_reason ?? 'No reason given', 300), 'flag'],
    ],
  });
}

// Plain-text versions, used only if Discord refuses the card format in DMs.
function dmClosedPlain({ ticket, guildName }) {
  return [
    `**Your ticket in ${guildName} was closed** (${caseLabel(ticket.ticket_number)})`,
    `Subject: ${clip(ticket.subject, 100)}`,
    `Reason: ${clip(ticket.close_reason ?? 'No reason given', 300)}`,
    'A transcript is attached. Open it in any browser.',
  ].join('\n');
}

function reviewRow(ticketId) {
  return row(...[1, 2, 3, 4, 5].map((n) => button(`ticket:rate:${ticketId}:${n}`, String(n), ButtonStyle.Secondary, 'star')));
}

function dmReviewPlain({ ticket }) {
  return { content: '**How did we do?** Tap a number to rate your support from 1 to 5.', components: [reviewRow(ticket.id)] };
}

function dmThanksPlain({ rating, askFeedback, ticketId }) {
  return {
    content: `Thank you. You rated this ticket **${rating} out of 5** ${stars(rating)}.${askFeedback ? '\nWould you like to tell us what went well, or what we could do better?' : ''}`,
    components: askFeedback ? [row(button(`ticket:feedback:${ticketId}`, 'Write Feedback', ButtonStyle.Secondary, 'edit'))] : [],
  };
}

function dmReview({ ticket }) {
  return card({
    icon: 'star',
    title: 'How did we do?',
    description: 'Tap a number to rate your support from 1 to 5. It takes a second and helps us improve.',
    rows: [reviewRow(ticket.id)],
  });
}

function dmThanks({ rating, askFeedback, ticketId }) {
  return card({
    icon: 'heart',
    title: 'Thank you',
    accent: colors.teal,
    description: `You rated this ticket ${fmt.bold(`${rating} out of 5`)} ${stars(rating)}.${askFeedback ? '\nWould you like to tell us what went well, or what we could do better?' : ''}`,
    rows: askFeedback ? [row(button(`ticket:feedback:${ticketId}`, 'Write Feedback', ButtonStyle.Secondary, 'edit'))] : [],
  });
}

function reviewCard({ ticket, rating, staffId, wentWell, wentWrong }) {
  const t = typeOf(ticket.type);
  return card({
    icon: 'star',
    title: `${label(ticket.ticket_number)} Review`,
    accent: rating >= 4 ? colors.teal : rating === 3 ? colors.cobalt : colors.alert,
    description: `${stars(rating)}  ${fmt.bold(`${rating}/5`)}`,
    blocks: [
      ...(wentWell ? [`**What went well**\n${quote(wentWell, 600)}`] : []),
      ...(wentWrong ? [`**What could be better**\n${quote(wentWrong, 600)}`] : []),
    ],
    fields: [
      ['Member', fmt.user(ticket.opener_id), 'user'],
      ['Handled By', staffId ? fmt.user(staffId) : fmt.code('nobody'), 'staff'],
      ['Type', fmt.bold(t.label), 'info'],
    ],
  });
}

// ---------- stats ----------

function statsCard({ user, stats }) {
  const lines = [
    `${'Tickets'.padEnd(10)}${'30d'.padStart(6)}${'All'.padStart(6)}`,
    `${'Claimed'.padEnd(10)}${String(stats.claimed_30).padStart(6)}${String(stats.claimed_all).padStart(6)}`,
    `${'Closed'.padEnd(10)}${String(stats.closed_30).padStart(6)}${String(stats.closed_all).padStart(6)}`,
  ].join('\n');
  return card({
    icon: 'stats',
    title: `${user.displayName ?? user.username}'s Ticket Stats`,
    thumbnail: user.displayAvatarURL({ extension: 'png', size: 256 }),
    description: '```\n' + lines + '\n```',
    fields: [
      ['First Response, 30 Days', fmt.code(formatSeconds(stats.resp_30)), 'clock'],
      ['First Response, All Time', fmt.code(formatSeconds(stats.resp_all)), 'clock'],
      ['Average Rating', stats.avg_rating ? `${fmt.code(`${stats.avg_rating.toFixed(2)}/5`)} from ${stats.ratings} review${stats.ratings === 1 ? '' : 's'}` : fmt.code('no reviews yet'), 'star'],
      ['Open Right Now', fmt.code(stats.open_now), 'ticket'],
    ],
  });
}

function teamCard(rows, names) {
  const lines = [`${'Staff'.padEnd(18)}${'Tickets'.padStart(8)}${'Reply'.padStart(8)}${'Rating'.padStart(8)}`];
  for (const r of rows) {
    lines.push(`${String(names.get(r.staff_id) ?? r.staff_id).slice(0, 17).padEnd(18)}${String(r.handled).padStart(8)}${formatSeconds(r.resp).padStart(8)}${(r.rating ? r.rating.toFixed(1) : 'n/a').padStart(8)}`);
  }
  return card({
    icon: 'trophy',
    title: 'Ticket Team, Last 30 Days',
    description: rows.length ? '```\n' + lines.join('\n') + '\n```' : '*No handled tickets in the last 30 days.*',
    fields: [['Staff Active', fmt.code(rows.length), 'users']],
  });
}

module.exports = {
  panel, openingCard, inactiveNotice, inactiveCancelled, closedCard, reopenedCard, handlingCard, inactiveHint,
  logCard, dmClosed, dmClosedPlain, dmReview, dmReviewPlain, dmThanks, dmThanksPlain, reviewCard, statsCard, teamCard, channelUrl, stars,
};
