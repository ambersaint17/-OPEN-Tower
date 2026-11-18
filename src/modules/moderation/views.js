const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { card, fmt } = require('../../ui');
const { ic, object } = require('../../emojis');
const { colors, moderation } = require('../../constants');
const { formatDuration } = require('./duration');
const { caseLabel, clip } = require('../../lib/text');
const { statsTable, totals, topAction, teamTable } = require('../../lib/stats');

const META = {
  warn:      { label: 'Warning',         icon: 'warning' },
  note:      { label: 'Note',            icon: 'scroll' },
  timeout:   { label: 'Timeout',         icon: 'mute' },
  untimeout: { label: 'Timeout Removed', icon: 'unlock', accent: colors.teal },
  kick:      { label: 'Kick',            icon: 'leave',  accent: colors.alert },
  ban:       { label: 'Ban',             icon: 'ban',    accent: colors.alert },
  unban:     { label: 'Unban',           icon: 'check',  accent: colors.teal },
};
const metaOf = (type) => META[type] ?? { label: type, icon: 'info' };

const DM_TEXT = { sent: 'Delivered', failed: 'Not delivered (DMs closed)', skipped: 'Not sent' };
const dmLabel = (status) => DM_TEXT[status] ?? status;

function button(id, label, style, icon) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  const emoji = icon && object(icon);
  if (emoji) b.setEmoji(emoji);
  return b;
}

// ---------- the case card posted to mod-cases ----------

function caseCard(row, avatarUrl) {
  const meta = metaOf(row.type);
  return card({
    icon: meta.icon,
    title: `Case ${caseLabel(row.case_number)} | ${meta.label}`,
    thumbnail: avatarUrl,
    accent: meta.accent,
    fields: [
      ['Member', `${fmt.user(row.user_id)} (${row.user_tag})`, 'user'],
      ['Member ID', fmt.code(row.user_id), 'hash'],
      ['Moderator', `${fmt.user(row.moderator_id)}`, 'staff'],
      ['Reason', clip(row.reason, 500), 'flag'],
      ...(row.duration_ms ? [['Duration', fmt.code(formatDuration(Number(row.duration_ms))), 'hourglass']] : []),
      ...(row.expires_at ? [['Ends', fmt.time(row.expires_at, 'R'), 'clock']] : []),
      ['Member Notified', fmt.bold(dmLabel(row.dm_status)), 'chat'],
      ['Source', fmt.bold(row.source === 'discord' ? 'Discord moderation menu' : row.source === 'automod' ? 'AutoMod' : 'Tower command'), 'cpu'],
      ['Timestamp', fmt.bold(fmt.time(row.created_at, 'F')), 'calendar'],
    ],
  });
}

// ---------- the private notice the member receives ----------

const DM_INTRO = {
  warn: 'A moderator has issued you a warning. Please take a moment to review the server rules.',
  timeout: 'A moderator has timed you out. You will not be able to chat, react or join voice until it ends.',
  untimeout: 'Your timeout has been lifted. You can take part in the server again.',
  kick: 'You have been removed from the server. You are welcome to rejoin through a fresh invite.',
  ban: 'You have been banned from the server.',
};

function dmCard({ row, guild, warnCount }) {
  const meta = metaOf(row.type);
  const lifted = row.type === 'untimeout';
  return card({
    banner: 'moderation',
    icon: meta.icon,
    title: lifted ? `Your timeout in ${guild.name} was lifted` : `You received a ${meta.label.toLowerCase()} in ${guild.name}`,
    accent: meta.accent,
    description: DM_INTRO[row.type] ?? 'A moderation action was taken on your account.',
    fields: [
      ['Reason', clip(row.reason, 500), 'flag'],
      ...(row.duration_ms ? [['Duration', fmt.code(formatDuration(Number(row.duration_ms))), 'hourglass']] : []),
      ...(row.expires_at ? [['Ends', fmt.time(row.expires_at, 'R'), 'clock']] : []),
      ...(warnCount ? [['Active Warnings', fmt.code(`${warnCount} in the last ${moderation.escalation.windowDays} days`), 'warning']] : []),
      ['Case', fmt.code(caseLabel(row.case_number)), 'ticket'],
      ['Server', guild.name, 'globe'],
    ],
    blocks: row.type === 'untimeout' ? [] : [`${ic('question')}${moderation.appealText}`],
  });
}

// Plain-text version, used only if Discord refuses the card format in DMs.
function dmPlain({ row, guild, warnCount }) {
  const meta = metaOf(row.type);
  return [
    `**${meta.label} in ${guild.name}** (case ${caseLabel(row.case_number)})`,
    DM_INTRO[row.type] ?? '',
    `Reason: ${clip(row.reason, 500)}`,
    row.duration_ms ? `Duration: ${formatDuration(Number(row.duration_ms))}` : '',
    warnCount ? `Active warnings: ${warnCount} in the last ${moderation.escalation.windowDays} days` : '',
    row.type === 'untimeout' ? '' : moderation.appealText,
  ].filter(Boolean).join('\n');
}

// ---------- replies to the moderator ----------

function done({ row, title }) {
  const meta = metaOf(row.type);
  return card({
    icon: meta.icon,
    title: title ?? `${meta.label} Recorded`,
    accent: meta.accent ?? colors.teal,
    fields: [
      ['Case', fmt.code(caseLabel(row.case_number)), 'ticket'],
      ['Member', `${fmt.user(row.user_id)} (${row.user_tag})`, 'user'],
      ['Reason', clip(row.reason, 300), 'flag'],
      ...(row.duration_ms ? [['Duration', fmt.code(formatDuration(Number(row.duration_ms))), 'hourglass']] : []),
      ['Member Notified', fmt.bold(dmLabel(row.dm_status)), 'chat'],
    ],
  });
}

const denied = (text, title = 'Cannot Continue') =>
  card({ icon: 'warning', title, description: text, accent: colors.alert });

function banConfirm({ user, reason, token, deleteLabel }) {
  return card({
    icon: 'ban',
    title: 'Confirm Ban',
    accent: colors.alert,
    description: `You are about to ban ${fmt.user(user.id)} (${user.tag ?? user.username}). Press Confirm to continue. This expires in a minute.`,
    fields: [
      ['Reason', clip(reason, 300), 'flag'],
      ['Delete Messages', fmt.bold(deleteLabel), 'trash'],
    ],
    rows: [new ActionRowBuilder().addComponents(
      button(`mod:ban:yes:${token}`, 'Confirm Ban', ButtonStyle.Danger, 'ban'),
      button(`mod:ban:no:${token}`, 'Cancel', ButtonStyle.Secondary, 'cross'),
    )],
  });
}

const banCancelled = () => card({ icon: 'check', title: 'Ban Cancelled', description: 'Nothing was changed.', accent: colors.teal });
const banExpired = () => card({ icon: 'hourglass', title: 'Confirmation Expired', description: 'That confirmation is no longer valid. Run the command again.' });

// ---------- case lookups ----------

function caseLine(row) {
  const meta = metaOf(row.type);
  const flag = row.voided ? ' (voided)' : '';
  return `${ic(meta.icon)}${fmt.code(caseLabel(row.case_number))} **${meta.label}**${flag} by ${fmt.user(row.moderator_id)} ${fmt.time(row.created_at, 'R')}\n> ${clip(row.reason, 120)}`;
}

function casesList({ user, cases, total }) {
  return card({
    icon: 'folder',
    title: `Cases for ${user.tag ?? user.username}`,
    thumbnail: user.displayAvatarURL({ extension: 'png', size: 256 }),
    description: cases.length ? cases.map(caseLine).join('\n') : '*No cases on record.*',
    fields: [['Total Cases', fmt.code(total), 'hash'], ['Showing', fmt.code(`latest ${cases.length}`), 'eye']],
  });
}

function caseDetail(row, avatarUrl) {
  const base = caseCard(row, avatarUrl);
  return base;
}

function voided(row) {
  return card({
    icon: 'trash',
    title: `Case ${caseLabel(row.case_number)} Voided`,
    fields: [
      ['Original Type', fmt.bold(metaOf(row.type).label), 'info'],
      ['Voided By', fmt.user(row.voided_by), 'staff'],
      ['Why', clip(row.voided_reason ?? 'No reason given', 300), 'flag'],
    ],
    description: 'Voiding only changes the record. It does not undo the action. Use `/unban` or `/untimeout` for that.',
  });
}

function edited(row, byId) {
  return card({
    icon: 'edit',
    title: `Case ${caseLabel(row.case_number)} Edited`,
    fields: [['Edited By', fmt.user(byId), 'staff'], ['New Reason', clip(row.reason, 400), 'flag']],
  });
}

function escalation({ user, count }) {
  return card({
    icon: 'warning',
    title: 'Review Suggested',
    accent: colors.alert,
    thumbnail: user.displayAvatarURL({ extension: 'png', size: 256 }),
    description: `${fmt.user(user.id)} now has **${count}** active warnings in the last ${moderation.escalation.windowDays} days. Tower will not act on its own, so a moderator should decide what happens next.`,
    fields: [
      ['Member ID', fmt.code(user.id), 'hash'],
      ['History', fmt.code(`/cases member user:${user.tag ?? user.username}`), 'terminal'],
    ],
  });
}

// ---------- moderator statistics ----------

function statsCard({ user, rank, stats }) {
  const sum = totals(stats.rows);
  const top = topAction(stats.rows);
  return card({
    icon: 'stats',
    title: `${user.displayName ?? user.username}'s Moderation Stats`,
    thumbnail: user.displayAvatarURL({ extension: 'png', size: 256 }),
    description: '```\n' + statsTable(stats.rows) + '\n```',
    fields: [
      ['Rank', fmt.bold(rank), 'staff'],
      ['Actions This Week', fmt.code(sum.d7), 'calendar'],
      ['Actions This Month', fmt.code(sum.d30), 'calendar'],
      ['Actions All Time', fmt.code(sum.total), 'trophy'],
      ['Most Used', fmt.bold(top ?? 'none yet'), 'star'],
      ['Last Action', stats.last ? `${fmt.code(caseLabel(stats.last.case_number))} ${fmt.time(stats.last.created_at, 'R')}` : fmt.code('none yet'), 'clock'],
      ['Active Since', stats.firstAt ? fmt.time(stats.firstAt, 'D') : fmt.code('no cases yet'), 'join'],
      ['Voided Cases', fmt.code(stats.voided), 'trash'],
    ],
  });
}

function teamCard(rows) {
  return card({
    icon: 'trophy',
    title: 'Team Activity, Last 30 Days',
    description: rows.length ? '```\n' + teamTable(rows) + '\n```' : '*No moderation actions in the last 30 days.*',
    fields: [['Moderators Active', fmt.code(rows.length), 'users']],
  });
}

module.exports = {
  caseCard, dmCard, dmPlain, done, denied, banConfirm, banCancelled, banExpired,
  casesList, caseDetail, voided, edited, escalation, statsCard, teamCard,
};
