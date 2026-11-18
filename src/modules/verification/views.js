const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { card, fmt } = require('../../ui');
const { ic, object } = require('../../emojis');
const { colors, raid, tiers, verification, brand } = require('../../constants');
const { findChannelMention } = require('../../lib/channels');

function button(id, label, { style = ButtonStyle.Secondary, icon, disabled = false } = {}) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  const emoji = icon && object(icon);
  if (emoji) b.setEmoji(emoji);
  return b;
}

const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const heading = (icon, title) => `### ${ic(icon)}${title}`;

// ---------- the public panel: one message that replaces the guide channel ----------

function panel(guildName) {
  return card({
    banner: 'verification',
    icon: 'shield',
    title: 'Verification',
    description:
      `Welcome to **${guildName || brand.name}**. ` +
      'Verify once and the whole server opens up. It takes under a minute.',
    blocks: [
      [
        heading('play', 'How it works'),
        '**1.** Press **Verify** below. Tower prepares a private captcha that only you can see.',
        '**2.** Type the characters from the image. Press **New Code** if it is hard to read.',
        '**3.** That is it. Your roles update instantly and the server opens up.',
      ].join('\n'),
      [
        heading('unlock', 'What you unlock'),
        `${ic('video')}**Updates:** announcements and news the moment they land`,
        `${ic('chat')}**Community:** chat, media, questions and voice`,
        `${ic('gift')}**Engagement:** giveaways, the daily question and rank-ups`,
        `${ic('ticket')}**Support:** tickets, suggestions and feedback straight to staff`,
      ].join('\n'),
      [
        heading('lock', 'Safe by design'),
        'Verification happens entirely inside Discord. Tower will never ask you to open a link, scan a QR code ' +
          'or share your password or token. If anything asks for those, report it to staff.',
        '',
        heading('question', 'Stuck or locked out?'),
        'Press **Help** for quick fixes, or contact staff through modmail.',
      ].join('\n'),
    ],
    rows: [
      row(
        button('verify:start', 'Verify', { style: ButtonStyle.Success, icon: 'verified' }),
        button('verify:help', 'Help', { icon: 'question' }),
      ),
    ],
  });
}

function help() {
  return card({
    icon: 'question',
    title: 'Verification Help',
    blocks: [
      [
        `${ic('loading')}**Captcha hard to read?** Press **New Code**. You get a few per session.`,
        `${ic('hourglass')}**Code expired?** Codes only last a few minutes. Press **Verify** again for a fresh one.`,
        `${ic('lock')}**Locked out?** Too many wrong attempts starts a cooldown. Wait for the timer, then try again.`,
        `${ic('shield')}**Verified but nothing changed?** Restart Discord, or contact staff through modmail.`,
      ].join('\n'),
    ],
  });
}

// ---------- member-facing ----------

function challenge({ session, filename, note }) {
  const refreshesLeft = Math.max(0, verification.maxRefreshes - session.refreshes);
  return card({
    icon: 'shield',
    title: 'Verification',
    description: `${note ? `${ic('cross')}**${note}**\n` : ''}Type the characters shown in the image.`,
    image: filename,
    fields: [
      ['Attempts Remaining', fmt.code(session.attempts_left), 'key'],
      ['New Codes Remaining', fmt.code(refreshesLeft), 'loading'],
      ['Expires', fmt.time(session.expires_at, 'R'), 'clock'],
    ],
    rows: [
      row(
        button(`verify:enter:${session.id}`, 'Enter Code', { style: ButtonStyle.Success, icon: 'key' }),
        button(`verify:refresh:${session.id}`, 'New Code', { icon: 'loading', disabled: refreshesLeft === 0 }),
      ),
    ],
  });
}

// Shown ephemerally after a successful verification.
function success({ verificationId, member, guild }) {
  return card({
    banner: 'brand',
    icon: 'welcome',
    title: `Welcome aboard, ${member.displayName}`,
    thumbnail: member.displayAvatarURL({ extension: 'png', size: 256 }),
    accent: colors.teal,
    description:
      `You are verified, and **${guild.name}** is now open to you. We are glad you are here.\n\n` +
      '**Start here**\n' +
      `${ic('scroll')}Read the ${findChannelMention(guild, 'rules')}\n` +
      `${ic('user')}Introduce yourself in ${findChannelMention(guild, 'about-me')}\n` +
      `${ic('bell')}Catch up in ${findChannelMention(guild, 'announcements')}\n` +
      `${ic('chat')}Say hello in ${findChannelMention(guild, 'general-chat')}`,
    fields: [['Verification ID', fmt.code(verificationId), 'check']],
  });
}

function locked(lockedUntil) {
  return card({
    icon: 'lock',
    title: 'Verification Locked',
    description: 'Too many incorrect attempts. Wait for the cooldown to finish, then press Verify again.',
    fields: [['Try Again', fmt.time(lockedUntil, 'R'), 'hourglass']],
    accent: colors.alert,
  });
}

function removed() {
  return card({
    icon: 'leave',
    title: 'Verification Failed',
    description: 'You were removed from the server after repeated failed attempts. You are welcome to rejoin and try again later.',
    accent: colors.alert,
  });
}

function expired() {
  return card({
    icon: 'hourglass',
    title: 'Session Expired',
    description: 'This captcha is no longer valid. Press Verify in the verification channel to get a new one.',
  });
}

function paused() {
  return card({
    icon: 'radar',
    title: 'Verification Paused',
    description: 'Verification is temporarily paused while staff review recent activity. Please try again shortly.',
    accent: colors.alert,
  });
}

function alreadyVerified() {
  return card({ icon: 'verified', title: 'Already Verified', description: 'You already have access to the server.', accent: colors.teal });
}

function notEnabled() {
  return card({ icon: 'wrench', title: 'Verification Unavailable', description: 'Verification has not been set up on this server yet.' });
}

// ---------- staff-facing logs ----------

const now = () => fmt.bold(fmt.time(new Date(), 'F'));

function logCompleted({ userId, avatarUrl, createdAt, tierNumber, attemptsUsed, verifiedRoleId, verificationId }) {
  return card({
    icon: 'verified',
    title: 'Verification Completed',
    thumbnail: avatarUrl,
    accent: colors.teal,
    fields: [
      ['Discord', fmt.user(userId), 'user'],
      ['Discord ID', fmt.code(userId), 'hash'],
      ['Account Created', fmt.time(createdAt, 'R'), 'calendar'],
      ['Risk Tier', fmt.bold(tiers[tierNumber].label), 'shield'],
      ['Attempts Used', fmt.code(attemptsUsed), 'key'],
      ['Verified Role', fmt.role(verifiedRoleId), 'staff'],
      ['Verification ID', fmt.code(verificationId), 'ticket'],
      ['Timestamp', now(), 'clock'],
    ],
  });
}

function logLockout({ userId, avatarUrl, tierNumber, strikes, lockedUntil, auditId }) {
  return card({
    icon: 'lock',
    title: 'Verification Locked',
    thumbnail: avatarUrl,
    accent: colors.alert,
    fields: [
      ['Discord', fmt.user(userId), 'user'],
      ['Discord ID', fmt.code(userId), 'hash'],
      ['Risk Tier', fmt.bold(tiers[tierNumber].label), 'shield'],
      ['Strikes', fmt.code(`${strikes}/${verification.maxStrikes}`), 'warning'],
      ['Locked Until', fmt.time(lockedUntil, 'R'), 'hourglass'],
      ['Audit ID', fmt.code(auditId), 'ticket'],
      ['Timestamp', now(), 'clock'],
    ],
  });
}

function logRemoved({ userId, avatarUrl, strikes, auditId, kicked }) {
  return card({
    icon: 'ban',
    title: kicked ? 'Member Removed' : 'Removal Failed',
    thumbnail: avatarUrl,
    accent: colors.alert,
    fields: [
      ['Discord', fmt.user(userId), 'user'],
      ['Discord ID', fmt.code(userId), 'hash'],
      ['Reason', 'Repeated failed verification', 'flag'],
      ['Strikes', fmt.code(`${strikes}/${verification.maxStrikes}`), 'warning'],
      ['Action', kicked ? fmt.bold('Kicked') : fmt.bold('Kick failed, check Tower permissions'), 'leave'],
      ['Audit ID', fmt.code(auditId), 'ticket'],
      ['Timestamp', now(), 'clock'],
    ],
  });
}

function logApproved({ userId, avatarUrl, approvedBy, verifiedRoleId, auditId }) {
  return card({
    icon: 'check',
    title: 'Manual Approval',
    thumbnail: avatarUrl,
    fields: [
      ['Discord', fmt.user(userId), 'user'],
      ['Discord ID', fmt.code(userId), 'hash'],
      ['Approved By', fmt.user(approvedBy), 'staff'],
      ['Verified Role', fmt.role(verifiedRoleId), 'verified'],
      ['Audit ID', fmt.code(auditId), 'ticket'],
      ['Timestamp', now(), 'clock'],
    ],
  });
}

function logRaid({ on, trigger, auditId }) {
  return card({
    icon: on ? 'radar' : 'check',
    title: on ? 'Raid Mode Enabled' : 'Raid Mode Disabled',
    description: on
      ? 'Verification is paused. New members still receive the unverified role.'
      : 'Verification has resumed.',
    accent: on ? colors.alert : colors.teal,
    fields: [
      ['Trigger', trigger, 'flag'],
      ['Action', on ? fmt.bold('Verification paused') : fmt.bold('Verification resumed'), 'shield'],
      [on ? 'Lift With' : 'Re-enable With', fmt.code(on ? '/verification raid off' : '/verification raid on'), 'terminal'],
      ...(on ? [['Manual Approval', fmt.code('/verification approve'), 'check']] : []),
      ['Audit ID', fmt.code(auditId), 'ticket'],
      ['Timestamp', now(), 'clock'],
    ],
  });
}

function raidTrigger(count) {
  return `${fmt.code(`${count} joins in ${raid.windowMs / 1000}s`)} (limit ${raid.threshold})`;
}

// ---------- staff commands ----------

function status({ settings, activeSessions }) {
  return card({
    icon: 'shield',
    title: 'Verification Status',
    fields: [
      ['State', fmt.bold(settings.verification_enabled ? 'Enabled' : 'Disabled'), 'check'],
      ['Verify Channel', settings.verify_channel_id ? fmt.channel(settings.verify_channel_id) : fmt.code('not set'), 'hash'],
      ['Log Channel', settings.log_channel_id ? fmt.channel(settings.log_channel_id) : fmt.code('not set'), 'scroll'],
      ['Unverified Role', settings.unverified_role_id ? fmt.role(settings.unverified_role_id) : fmt.code('not set'), 'lock'],
      ['Verified Role', settings.verified_role_id ? fmt.role(settings.verified_role_id) : fmt.code('not set'), 'verified'],
      [
        'Raid Mode',
        settings.raid_mode ? fmt.bold(`Active since ${fmt.time(settings.raid_started_at, 'R')}`) : fmt.bold('Off'),
        'radar',
      ],
      ['Raid Trigger', fmt.code(`${raid.threshold} joins in ${raid.windowMs / 1000}s`), 'flag'],
      ['Active Sessions', fmt.code(activeSessions), 'key'],
    ],
  });
}

module.exports = {
  panel, help, challenge, success, locked, removed, expired, paused, alreadyVerified, notEnabled,
  logCompleted, logLockout, logRemoved, logApproved, logRaid, raidTrigger, status,
};
