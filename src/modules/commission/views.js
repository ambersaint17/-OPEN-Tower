const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ui = require('../../ui');
const { object } = require('../../emojis');
const { colors } = require('../../constants');
const { clip } = require('../../lib/text');
const c = require('../../lib/commission');

const { fmt } = ui;
const TEAL = 0x2a9d8f;
const iconOf = (key) => { try { return object(key); } catch { return undefined; } };
const jump = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;
const dueText = (row) => (row.deadline ? `${fmt.time(row.deadline, 'D')} (${fmt.time(row.deadline, 'R')})` : 'Not set');

// What the client sees. Never includes private notes.
function clientCard(row, headline = 'Commission Update') {
  const status = c.statusInfo(row.status);
  return ui.card({
    banner: 'commission', icon: 'ticket', title: `${headline} #${row.id}`, accent: TEAL,
    description: `**${clip(row.title, 150)}**\n${status.client}${row.description ? `\n\n${clip(row.description, 600)}` : ''}`,
    fields: [
      ['Status', fmt.bold(status.label), 'check'],
      ['Price', row.price ? fmt.code(row.price) : 'To be agreed', 'gift'],
      ['Due', dueText(row), 'calendar'],
      ['Payment', row.paid ? 'Paid' : 'Not paid yet', 'stats'],
    ],
  });
}

// What the owner sees: everything, including private notes, the history and the review.
function staffCard(row, review) {
  const status = c.statusInfo(row.status);
  const notes = row.notes.slice(-4).map((n) => `• ${clip(n.text, 150)}`).join('\n');
  const history = row.history.slice(-5).map((h) => `• ${c.statusInfo(h.status).label}${h.note ? `: ${clip(h.note, 80)}` : ''} ${fmt.time(new Date(h.at), 'R')}`).join('\n');
  return ui.card({
    banner: 'commission', icon: 'ticket', title: `Commission #${row.id}`, accent: TEAL,
    description: `**${clip(row.title, 150)}**${row.description ? `\n${clip(row.description, 600)}` : ''}`,
    fields: [
      ['Client', fmt.user(row.client_id), 'user'],
      ['Status', fmt.bold(status.label), 'check'],
      ['Price', row.price ? fmt.code(row.price) : 'Not set', 'gift'],
      ['Due', dueText(row), 'calendar'],
      ['Payment', row.paid ? `Paid ${row.paid_at ? fmt.time(row.paid_at, 'R') : ''}` : 'Not paid', 'stats'],
      ['Ticket', row.ticket_channel_id ? fmt.channel(row.ticket_channel_id) : 'Not linked', 'ticket'],
      ['Review', review ? `${c.stars(review.rating)} (${review.rating}/5)` : row.review_requested_at ? 'Requested, waiting' : 'Not requested', 'trophy'],
      ...(notes ? [['Private Notes', notes, 'scroll']] : []),
      ...(history ? [['Recent History', history, 'clock']] : []),
    ],
  });
}

function listCard(rows, title = 'Commissions') {
  const description = rows.length
    ? rows.map((r) => `• ${fmt.code(`#${r.id}`)} **${clip(r.title, 50)}**, ${fmt.user(r.client_id)}, ${c.statusInfo(r.status).label}${r.deadline && !c.isClosed(r.status) ? `, due ${fmt.time(r.deadline, 'R')}` : ''}${r.paid ? ', paid' : ''}`).join('\n')
    : 'Nothing here yet.';
  return ui.notice(title, description, { icon: 'ticket', accent: TEAL });
}

// A client's own list, with their review button where one is due.
function mineCard(rows) {
  const description = rows.length
    ? rows.map((r) => `• ${fmt.code(`#${r.id}`)} **${clip(r.title, 60)}**: ${c.statusInfo(r.status).label}${r.deadline && !c.isClosed(r.status) ? `, due ${fmt.time(r.deadline, 'R')}` : ''}`).join('\n')
    : 'You have no commissions with us yet.';
  return ui.notice('Your Commissions', description, { icon: 'ticket', accent: TEAL });
}

function reminderCard(row) {
  const late = new Date(row.deadline).getTime() < Date.now();
  return ui.notice(late ? 'Commission Overdue' : 'Commission Due Soon', `**${clip(row.title, 150)}** for ${fmt.user(row.client_id)} is ${c.relativeText(row.deadline)}.`, {
    icon: late ? 'warning' : 'clock', accent: late ? colors.alert : TEAL,
    fields: [['Commission', fmt.code(`#${row.id}`), 'ticket'], ['Status', c.statusInfo(row.status).label, 'check'], ['Due', dueText(row), 'calendar']],
  });
}

// ---------- reviews ----------
function reviewRequest(row, guildName) {
  const button = new ButtonBuilder().setCustomId(`commission:review:${row.id}`).setLabel('Leave A Review').setStyle(ButtonStyle.Success);
  const emoji = iconOf('trophy'); if (emoji) button.setEmoji(emoji);
  const buttons = [button];
  if (row.ticket_channel_id) buttons.push(new ButtonBuilder().setLabel('Open Ticket').setStyle(ButtonStyle.Link).setURL(jump(row.guild_id, row.ticket_channel_id)));
  return ui.card({
    banner: 'commission', icon: 'trophy', title: 'How Did We Do?', accent: TEAL,
    description: `Your commission **${clip(row.title, 150)}** is complete. Thank you for ordering from **${guildName}**!\n\nIt takes about a minute to tell us how it went. Your review is private and only the owner sees it.`,
    fields: [['Commission', fmt.code(`#${row.id}`), 'ticket']],
    rows: [new ActionRowBuilder().addComponents(buttons)],
  });
}

const thanks = () => ui.notice('Thank You', 'Your review was sent to the owner. It really helps.', { icon: 'check', accent: colors.teal });
const alreadyReviewed = () => ui.notice('Already Reviewed', 'You have already reviewed this commission. Thank you!', { icon: 'check' });

// The private record posted for the owner, like a ticket log.
function reviewLog(row, review, { guildId, avatarUrl } = {}) {
  return ui.card({
    banner: 'commission', icon: 'trophy', title: `Review: ${c.stars(review.rating)}`, accent: review.rating >= 4 ? colors.teal : review.rating === 3 ? TEAL : colors.alert,
    description: `**${clip(review.order_text, 200)}**`,
    fields: [
      ['Client', fmt.user(review.client_id), 'user'],
      ['Rating', fmt.code(`${review.rating} / 5`), 'trophy'],
      ['Commission', `${fmt.code(`#${row.id}`)} ${clip(row.title, 60)}`, 'ticket'],
      ['What Went Well', review.went_well ? `> ${clip(review.went_well, 900).replace(/\n/g, '\n> ')}` : '*Nothing written*', 'check'],
      ['What To Improve', review.improve ? `> ${clip(review.improve, 900).replace(/\n/g, '\n> ')}` : '*Nothing written*', 'wrench'],
      ...(row.price ? [['Price', fmt.code(row.price), 'gift']] : []),
      ...(row.ticket_channel_id && guildId ? [['Ticket', fmt.channel(row.ticket_channel_id), 'link']] : []),
    ],
    thumbnail: avatarUrl,
  });
}

function reviewsSummary(rows, stats) {
  const description = rows.length
    ? rows.map((r) => `${c.stars(r.rating)} ${fmt.code(`#${r.commission_id}`)} **${clip(r.title, 40)}** by ${fmt.user(r.client_id)}${r.improve ? `\n> ${clip(r.improve, 100)}` : ''}`).join('\n')
    : 'No reviews yet.';
  return ui.notice('Commission Reviews', description, {
    icon: 'trophy', accent: TEAL, fields: [['Average', fmt.code(stats.n ? `${stats.average} / 5` : 'n/a'), 'stats'], ['Reviews', fmt.code(stats.n), 'user']],
  });
}

module.exports = { clientCard, staffCard, listCard, mineCard, reminderCard, reviewRequest, thanks, alreadyReviewed, reviewLog, reviewsSummary, jump };
