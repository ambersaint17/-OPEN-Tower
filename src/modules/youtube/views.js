const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ui = require('../../ui');
const { card, fmt } = require('../../ui');
const { ic, object } = require('../../emojis');
const { youtube, brand } = require('../../constants');
const { watchUrl, shortUrl, summarise, pickHype, videoIdFromUrl, thumbnailFor } = require('../../lib/youtube');
const { clip, quote } = require('../../lib/text');

const RED = 0xff1744;
const EARLY = 0x5b4fd1; // indigo, to match the early access banner

function link(url, label, icon) {
  const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label);
  const emoji = icon && object(icon);
  if (emoji) b.setEmoji(emoji);
  return b;
}

const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const channelBase = (settings) => (settings?.channel_url ?? youtube.channelUrl).replace(/\/+$/, '');

// The post for a new upload. "classic" is a normal message, so Discord shows YouTube's own player
// right in the chat. "card" is a styled card with a big thumbnail instead (cards cannot play video).
function buildPost({ entry, isShort, settings, ping = true }) {
  const role = ping ? (settings?.ping_role_id ?? youtube.defaults.pingRoleId) : null;
  const base = channelBase(settings);
  const url = isShort ? shortUrl(entry.id) : watchUrl(entry.id);
  const hype = pickHype(isShort ? 'short' : 'video');
  const summary = summarise(entry.description);
  const allowedMentions = { roles: role ? [role] : [] };
  const buttons = row(
    link(url, isShort ? 'Watch The Short' : 'Watch Full Video', 'play'),
    link(`${base}?sub_confirmation=1`, 'Subscribe', 'bell'),
    link(`${base}/${isShort ? 'shorts' : 'videos'}`, isShort ? 'More Shorts' : 'All Videos', 'video'),
  );

  if (settings?.style === 'card') {
    const container = card({
      banner: 'youtube',
      icon: isShort ? 'zap' : 'play',
      title: clip(entry.title, 150),
      accent: RED,
      imageUrl: entry.thumbnail ?? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
      description: [role ? `<@&${role}>` : '', summary ? quote(summary, 200) : '', `**${hype}**`].filter(Boolean).join('\n'),
      fields: [
        ['Published', fmt.time(entry.published || Date.now(), 'R'), 'calendar'],
        ['Format', fmt.bold(isShort ? 'Short' : 'Video'), 'video'],
      ],
      rows: [buttons],
    });
    return { ...ui.message(container), allowedMentions };
  }

  const content = [
    role ? `<@&${role}>` : '',
    `## ${brand.emoji ? `${brand.emoji} ` : ''}${isShort ? 'NEW SHORT' : 'NEW VIDEO'}`,
    `# ${clip(entry.title, 150)}`,
    summary ? quote(summary, 200) : '',
    `${ic('play')}**${hype}**`,
    url, // on its own line, so Discord unfurls the real video player
  ].filter(Boolean).join('\n');
  return { content, components: [buttons], allowedMentions };
}

// The file name an uploaded clip gets inside the card. Always plain ASCII, so attachment:// links cannot break.
function clipName(name = '') {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(String(name)) || [])[1];
  return `early-access.${(ext ?? 'bin').toLowerCase()}`;
}

// Early access, posted by the owner for Insiders and boosters. Like every Tower message it is a V2 card:
// banner, title, divider, details, the picture (a YouTube thumbnail or an uploaded image) or the uploaded
// file, a "Watch Early" button and the footer. Cards cannot play video, so a clip is shown as a file.
//   clip: { name, url, contentType }   an uploaded attachment, or omitted when only a link is given
function buildEarlyAccess({ title, description, link: url, insiderRoleId, clip: upload, now = Date.now() }) {
  const videoId = url ? videoIdFromUrl(url) : null;
  const file = upload ? clipName(upload.name) : null;
  const isImage = Boolean(upload?.contentType?.startsWith('image/'));

  const container = card({
    banner: 'earlyaccess',
    icon: 'eye',
    title: clip(title, 150),
    accent: EARLY,
    description: [
      insiderRoleId ? `<@&${insiderRoleId}>` : '',
      description ? quote(description, 400) : '',
      `${ic('lock')}Please keep this inside the server until it goes public.`,
    ].filter(Boolean).join('\n'),
    imageUrl: !isImage && videoId ? thumbnailFor(videoId) : undefined,
    image: isImage ? file : undefined,
    file: upload && !isImage ? file : undefined,
    fields: [['Shared', fmt.time(now, 'R'), 'clock']],
    rows: url ? [row(link(url, 'Watch Early', 'eye'))] : [],
  });

  const payload = {
    ...ui.message(container, { files: upload ? [{ attachment: upload.url, name: file }] : undefined }),
    allowedMentions: { roles: insiderRoleId ? [insiderRoleId] : [] },
  };
  return payload;
}

module.exports = { buildPost, buildEarlyAccess, clipName };
