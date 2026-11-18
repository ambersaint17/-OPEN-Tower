const fs = require('node:fs');
const path = require('node:path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextDisplayBuilder, AttachmentBuilder } = require('discord.js');
const ui = require('../../ui');
const { colors, partners: cfg } = require('../../constants');
const { clip } = require('../../lib/text');
const lib = require('../../lib/partner');

const { fmt } = ui;
const INDIGO = 0x4c5fd0;
const mark = { ok: '✅', warn: '⚠️', block: '⛔' };
const MUTE_GUIDE = 'partner-mute-guide.png';

// images: [{ name }] for pictures Tower uploads with the message, [{ url }] for pictures shown from a web address.
function adPayload({ name, ad, code, members, repId, iconUrl, since = Date.now(), images = [], files = [] }, ping, style) {
  if (style === 'plain') {
    return { content: [ping.text, ad].filter(Boolean).join('\n'), allowedMentions: ping.allowedMentions, files: files.map((f) => ({ attachment: f.buffer, name: f.name })) };
  }
  const join = new ButtonBuilder().setLabel(`Join ${clip(name, 60)}`).setStyle(ButtonStyle.Link).setURL(lib.inviteUrl(code));
  const card = ui.card({
    banner: 'partner', icon: 'link', title: clip(name, 100), accent: INDIGO, description: ad, thumbnail: iconUrl || undefined,
    images: files.map((f) => f.name), imageUrls: images.filter((i) => i.url).map((i) => i.url),
    fields: [
      ...(members != null ? [['Members', fmt.code(members.toLocaleString('en-US')), 'user']] : []),
      ...(repId ? [['Representative', fmt.user(repId), 'staff']] : []),
      ['Partners Since', fmt.time(since, 'D'), 'calendar'],
    ],
    rows: [new ActionRowBuilder().addComponents(join)],
  });
  const payload = ui.message(card, { files: files.map((f) => ({ attachment: f.buffer, name: f.name })) });
  if (ping.text) payload.components.unshift(new TextDisplayBuilder().setContent(ping.text));
  payload.allowedMentions = ping.allowedMentions;
  return payload;
}

// Shown to the admin before anything is posted: what was found, and the Post button.
function preview(token, prepared) {
  const { vetting, ping, style, name, ad, info, images, keepLink } = prepared;
  const lines = vetting.findings.map((f) => `${mark[f.level]} ${f.text}`);
  const post = new ButtonBuilder().setCustomId(`partner:go:${token}`).setLabel('Post Ad').setStyle(ButtonStyle.Success).setDisabled(vetting.blocked);
  const cancel = new ButtonBuilder().setCustomId(`partner:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary);
  return ui.card({
    icon: vetting.blocked ? 'warning' : 'link', title: vetting.blocked ? 'This Ad Cannot Be Posted Yet' : 'Check Before Posting', accent: vetting.blocked ? colors.alert : INDIGO,
    description: `${lines.join('\n')}\n\n**The start of the ad**\n> ${clip(ad, 350).replace(/\n/g, '\n> ')}`,
    fields: [
      ['Server', fmt.bold(name), 'hash'], ['Ping', ping.key === 'none' ? 'No ping' : ping.key.startsWith('role:') ? fmt.role(ping.key.slice(5)) : `\`${ping.text}\``, 'bell'],
      ['Style', style === 'plain' ? 'Plain text' : 'Card with Join button', 'sparkle'], ['Pictures', fmt.code(images.length), 'image'],
      ['Invite Link', style === 'plain' || keepLink ? 'Kept in the text' : 'Replaced by the Join button', 'link'],
      ...(info?.members != null ? [['Members', fmt.code(info.members.toLocaleString('en-US')), 'user']] : []),
    ],
    rows: [new ActionRowBuilder().addComponents(post, cancel)],
  });
}

const posted = (row, jump, extra = []) => ui.notice('Ad Posted', `**${clip(row.server_name, 100)}** is live in <#${row.channel_id}>.`, {
  icon: 'check', accent: colors.teal,
  fields: [['Partnership', fmt.code(`#${row.id}`), 'ticket'], ['Jump', jump, 'link'], ...(row.rep_user_id ? [['Representative', fmt.user(row.rep_user_id), 'staff']] : []),
    ['Next', 'Ask them to post our ad too. `/partners ourad` has it, and Tower will remind you if they have not.', 'scroll'], ...extra],
});

function ticketNotice(row, jump, ourAdText) {
  return ui.notice('Your Advertisement Is Live', [`Your ad for **${clip(row.server_name, 100)}** was posted in <#${row.channel_id}>.`, jump, '',
    ourAdText ? `Please post ours in your server as well:\n\n${clip(ourAdText, 1500)}` : 'Please post our advertisement in your server as well.', '', 'Thank you for partnering with us!'].join('\n'), { icon: 'check', accent: colors.teal });
}

const late = (row) => !row.reciprocated && row.status === 'active' && Date.now() - new Date(row.created_at).getTime() > cfg.reciprocity.graceDays * 86_400_000;
function listCard(rows) {
  const description = rows.length
    ? rows.map((r) => `• ${fmt.code(`#${r.id}`)} **${clip(r.server_name, 50)}**${r.rep_user_id ? `, ${fmt.user(r.rep_user_id)}` : ''}, since ${fmt.time(r.created_at, 'D')}${r.status === 'ended' ? ' (ended)' : r.reciprocated ? ' ✅ posted our ad' : late(r) ? ' ⚠️ has not posted our ad' : ' ⏳ waiting for our ad'}`).join('\n')
    : 'No partnerships yet. Post one with `/partner`.';
  return ui.notice('Partnerships', description, { icon: 'link', accent: INDIGO });
}

function infoCard(row, jump) {
  return ui.card({
    icon: 'link', title: `Partnership #${row.id}`, accent: INDIGO,
    description: `**${clip(row.server_name, 100)}**\n> ${clip(row.ad_text, 500).replace(/\n/g, '\n> ')}`,
    fields: [
      ['Status', row.status === 'active' ? 'Active' : `Ended${row.end_reason ? `: ${clip(row.end_reason, 100)}` : ''}`, 'check'],
      ['They Posted Our Ad', row.reciprocated ? `Yes${row.reciprocated_at ? ` ${fmt.time(row.reciprocated_at, 'R')}` : ''}${row.reciprocal_proof ? `\n${row.reciprocal_proof}` : ''}` : late(row) ? 'Not yet, and it is overdue' : 'Not yet', 'trophy'],
      ['Invite', lib.inviteUrl(row.invite_code), 'link'], ['Members When Posted', row.member_count != null ? fmt.code(row.member_count.toLocaleString('en-US')) : 'Unknown', 'user'],
      ['Representative', row.rep_user_id ? fmt.user(row.rep_user_id) : 'None', 'staff'], ['Posted By', fmt.user(row.posted_by), 'user'],
      ['Since', fmt.time(row.created_at, 'D'), 'calendar'], ...(jump ? [['Ad', jump, 'hash']] : []), ...(row.ticket_channel_id ? [['Ticket', fmt.channel(row.ticket_channel_id), 'ticket']] : []),
    ],
  });
}

function setupCard(settings, channel, role) {
  return ui.notice('Partnership Settings', 'Ads are posted in the channel below. Change anything with `/partners setup`.', {
    icon: 'settings', accent: INDIGO,
    fields: [
      ['Partnership Channel', channel ? fmt.channel(channel.id) : 'Not found. Pick one with `/partners setup channel:`', 'hash'],
      ['Minimum Members', settings.min_members ? fmt.code(settings.min_members.toLocaleString('en-US')) : 'No minimum', 'user'],
      ['Partner Role', role ? fmt.role(role.id) : settings.partner_role_id ? fmt.role(settings.partner_role_id) : 'None', 'staff'],
      ['Mute Guide Message', settings.sticky_enabled ? `On${settings.sticky_channels.length ? ` (also in ${settings.sticky_channels.map(fmt.channel).join(' ')})` : ''}` : 'Off', 'bell'],
      ['Our Own Ad', settings.our_ad ? 'Saved (see `/partners ourad`)' : 'Not set (add one with `/partners ourad edit:true`)', 'scroll'],
    ],
  });
}

const ourAd = (text) => ui.notice('Our Ad', text ? `Copy this and send it to partners:\n\n${text}` : 'No ad saved yet. Add one with `/partners ourad edit:true`.', { icon: 'scroll', accent: INDIGO });

// ---------- reciprocity reminder, sent by DM ----------
function reciprocityReminder(row) {
  const done = new ButtonBuilder().setCustomId(`partner:recip:${row.id}`).setLabel('They Posted It').setStyle(ButtonStyle.Success);
  return ui.card({
    icon: 'clock', title: 'Have They Posted Our Ad?', accent: INDIGO,
    description: `**${clip(row.server_name, 100)}** has had your ad for ${Math.max(1, Math.round((Date.now() - new Date(row.created_at).getTime()) / 86_400_000))} days. Check whether our ad is up in their server.\nIf it is, press the button. If not, remind them, or end the partnership with \`/partners end id:${row.id}\`.`,
    fields: [['Partnership', fmt.code(`#${row.id}`), 'ticket'], ['Their Invite', lib.inviteUrl(row.invite_code), 'link']],
    rows: [new ActionRowBuilder().addComponents(done)],
  });
}
const reciprocityDone = (row) => ui.notice('Marked As Posted', `**${clip(row.server_name, 100)}** has posted our ad. Thank you for checking.`, { icon: 'check', accent: colors.teal });

// ---------- blacklist ----------
function blacklistList(rows) {
  const description = rows.length ? rows.map((b) => `• ${fmt.code(b.server_id)} **${clip(b.name ?? 'Unknown server', 50)}**${b.reason ? `: ${clip(b.reason, 100)}` : ''}`).join('\n') : 'Nobody is blacklisted.';
  return ui.notice('Partner Blacklist', description, { icon: 'ban', accent: colors.alert });
}

// ---------- the sticky message: how to mute the channel ----------
const guideFile = () => {
  try { return new AttachmentBuilder(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'assets', 'images', MUTE_GUIDE)), { name: MUTE_GUIDE }); } catch { return null; }
};
function stickyPayload(channelId) {
  const file = guideFile();
  const card = ui.card({
    icon: 'bell', title: 'Partnerships', accent: INDIGO,
    description: [
      '> **Tired of getting pings from this channel?**', '> **__Follow the instructions below to mute it!__**', '',
      '**Instructions**', `**»** Right-click or long-press the <#${channelId}> channel.`, '**»** Select **Mute Channel**.', '**»** Choose how long you want to keep it muted.',
    ].join('\n'),
    image: file ? MUTE_GUIDE : undefined,
  });
  const payload = ui.message(card, { files: file ? [file] : [] });
  payload.allowedMentions = { parse: [] };
  return payload;
}

module.exports = { adPayload, preview, posted, ticketNotice, listCard, infoCard, setupCard, ourAd, reciprocityReminder, reciprocityDone, blacklistList, stickyPayload, late, MUTE_GUIDE };
