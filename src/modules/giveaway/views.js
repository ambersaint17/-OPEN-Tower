const { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextDisplayBuilder } = require('discord.js');
const ui = require('../../ui');
const { ic, object } = require('../../emojis');
const { colors, giveaways } = require('../../constants');
const modViews = require('../moderation/views');
const g = require('../../lib/giveaway');
const L = require('../../lib/levels');
const { clip } = require('../../lib/text');

const { fmt } = ui;
const PINK = 0xd23f8c;
const GREY = 0x6b7280;
const iconOf = (key) => { try { return object(key); } catch { return undefined; } };
const id = (action, row) => `giveaway:${action}:${row.id}`;
const jump = (row) => `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.message_id}`;
const names = (winnerIds) => winnerIds.map(fmt.user).join(', ');

// "above" text lives outside the card as a plain text block (a components message cannot carry normal content).
function compose(container, { above, mode = 'send' } = {}) {
  const payload = mode === 'edit' ? ui.edit(container) : ui.message(container);
  if (above) payload.components.unshift(new TextDisplayBuilder().setContent(above));
  return payload;
}

const perkText = () => [
  `Everyone gets **1 entry**`,
  `Level **${L.perkLevel('giveaway')}** adds **+1**, level **${L.perkLevel('elite')}** adds **+1 more**`,
  'Server Boosters have their total **doubled**',
].join('\n');

// The giveaway post people enter from.
function announcement(row, entryCount) {
  const requirements = g.requirementLines(row.requirements);
  const description = [
    row.description || null,
    `**Requirements**\n${requirements.length ? requirements.map((l) => `• ${l}`).join('\n') : 'None. Anyone can enter.'}`,
    `**Bonus entries**\n${perkText()}`,
  ].filter(Boolean).join('\n\n');
  const enter = new ButtonBuilder().setCustomId(id('enter', row)).setLabel('Enter Giveaway').setStyle(ButtonStyle.Success);
  const emoji = iconOf('gift'); if (emoji) enter.setEmoji(emoji);
  return ui.card({
    banner: 'giveaway', icon: 'gift', title: clip(row.prize, 100), accent: PINK, description,
    fields: [
      ['Ends', fmt.time(row.ends_at, 'R'), 'calendar'],
      ['Winners', fmt.code(row.winners), 'trophy'],
      ['Hosted By', fmt.user(row.host_id), 'user'],
      ['Entries', fmt.code(entryCount), 'stats'],
      ['Giveaway ID', fmt.code(`#${row.id}`), 'hash'],
    ],
    rows: [new ActionRowBuilder().addComponents(enter)],
  });
}
const pingLine = (row) => (row.ping_role_id ? `<@&${row.ping_role_id}>` : null);

function ended(row, entryCount) {
  const winners = row.winner_ids;
  return ui.card({
    banner: 'giveaway', icon: 'trophy', title: 'Giveaway Ended', accent: GREY,
    description: `**${clip(row.prize, 200)}**\n${winners.length ? `Winner${winners.length === 1 ? '' : 's'}: ${names(winners)}` : 'Nobody entered with all requirements, so there is no winner.'}`,
    fields: [
      ['Entries', fmt.code(entryCount), 'stats'],
      ['Ended', fmt.time(row.ended_at ?? Date.now(), 'R'), 'calendar'],
      ['Hosted By', fmt.user(row.host_id), 'user'],
      ['Giveaway ID', fmt.code(`#${row.id}`), 'hash'],
    ],
  });
}
function cancelled(row) {
  return ui.card({
    banner: 'giveaway', icon: 'cross', title: 'Giveaway Cancelled', accent: GREY,
    description: `**${clip(row.prize, 200)}** was cancelled by staff.`,
    fields: [['Giveaway ID', fmt.code(`#${row.id}`), 'hash']],
  });
}

// The congratulation message. In the server it carries the claim button, in a DM only links.
function winnerMessage(row, winnerIds, { guildName, ticketChannelId, dm = false, reroll = false } = {}) {
  const ticketPlace = ticketChannelId ? fmt.channel(ticketChannelId) : 'the tickets channel';
  const reqs = g.requirementLines(row.requirements);
  const steps = [
    dm
      ? `Open a **General Support** ticket in ${guildName ?? 'the server'}, from ${ticketPlace}.`
      : `Press **Open Claim Ticket** below, or open a **General Support** ticket from ${ticketPlace}.`,
    `Tell staff you won giveaway **#${row.id}**.${reqs.length ? ' They will check you meet the requirements first.' : ''}`,
    'Once you are verified, your prize is delivered.',
  ];
  const lines = [
    dm ? `You won **${clip(row.prize, 200)}** in **${guildName ?? 'the server'}**!` : `${names(winnerIds)} won **${clip(row.prize, 200)}**!`,
    row.winner_note || null,
    `**Next steps**\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    reqs.length ? `**Requirements to verify**\n${reqs.map((l) => `• ${l}`).join('\n')}` : null,
    `-# Please claim within ${row.claim_hours} hours, or the prize may be rerolled.`,
  ].filter(Boolean).join('\n\n');

  const buttons = [];
  if (!dm) {
    const claim = new ButtonBuilder().setCustomId(id('claim', row)).setLabel('Open Claim Ticket').setStyle(ButtonStyle.Success);
    const emoji = iconOf('ticket'); if (emoji) claim.setEmoji(emoji);
    buttons.push(claim);
  }
  if (row.message_id) buttons.push(new ButtonBuilder().setLabel('View Giveaway').setStyle(ButtonStyle.Link).setURL(jump(row)));
  if (ticketChannelId) buttons.push(new ButtonBuilder().setLabel('Tickets Channel').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${row.guild_id}/${ticketChannelId}`));

  return ui.card({
    banner: 'giveaway', icon: 'trophy', title: reroll ? 'Reroll: Congratulations!' : 'Congratulations!', accent: PINK, description: lines,
    rows: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [],
  });
}

// ---------- private replies ----------
function entered(row, level, booster, { already = false, entryCount } = {}) {
  const b = g.entryBreakdown(level, booster);
  const leave = new ButtonBuilder().setCustomId(id('leave', row)).setLabel('Leave Giveaway').setStyle(ButtonStyle.Secondary);
  return ui.card({
    icon: 'gift', title: already ? 'You Are Already In' : 'You Are In!', accent: colors.teal,
    description: already ? 'Your entry is saved. Nothing more to do.' : 'Good luck! Winners are picked when the giveaway ends.',
    fields: [
      ['Your Entries', fmt.code(b.total), 'stats'],
      ['How You Got Them', b.parts.join('\n'), 'sparkle'],
      ['Ends', fmt.time(row.ends_at, 'R'), 'calendar'],
      ...(entryCount === undefined ? [] : [['Total Entrants', fmt.code(entryCount), 'user']]),
    ],
    rows: [new ActionRowBuilder().addComponents(leave)],
  });
}
const left = () => ui.notice('You Left The Giveaway', 'Your entry was removed. You can press **Enter Giveaway** again while it is still running.', { icon: 'check' });

const checkLine = (c) => `${c.ok ? ic('check') : ic('cross')} Needs **${c.need}**. ${c.key === 'role' ? (c.ok ? 'You have it.' : 'You do not have it.') : `You: ${c.have}.`}`;
function unmet(evaluation) {
  return modViews.denied(evaluation.checks.map(checkLine).join('\n'), 'Requirements Not Met');
}

function verifyCard(row, member, evaluation, { entries, entered: isIn, isWinner }) {
  const lines = evaluation.checks.length ? evaluation.checks.map(checkLine) : ['No requirements on this giveaway.'];
  return ui.card({
    icon: evaluation.ok ? 'verified' : 'warning', title: evaluation.ok ? 'Requirements Met' : 'Requirements Not Met',
    accent: evaluation.ok ? colors.teal : colors.alert,
    description: lines.join('\n'),
    fields: [
      ['Member', fmt.user(member.id), 'user'],
      ['Giveaway', `${fmt.code(`#${row.id}`)} ${clip(row.prize, 60)}`, 'gift'],
      ['Entered', isIn ? 'Yes' : 'No', 'check'],
      ['Is A Winner', isWinner ? 'Yes' : 'No', 'trophy'],
      ['Entries Right Now', fmt.code(entries), 'stats'],
    ],
  });
}

function list(rows) {
  const description = rows.length
    ? rows.map((r) => `• ${fmt.code(`#${r.id}`)} **${clip(r.prize, 50)}**, ${r.status === 'active' ? `ends ${fmt.time(r.ends_at, 'R')}` : r.status} ${r.message_id ? `([jump](${jump(r)}))` : ''}`).join('\n')
    : 'No giveaways yet. Start one with `/giveaway start`.';
  return ui.notice('Giveaways', description, { icon: 'gift', accent: PINK });
}

module.exports = { announcement, pingLine, ended, cancelled, winnerMessage, entered, left, unmet, verifyCard, list, compose, jump, giveaways };
