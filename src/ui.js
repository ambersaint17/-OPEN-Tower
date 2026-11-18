const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  FileBuilder,
  MessageFlags,
} = require('discord.js');
const { colors, brand } = require('./constants');
const { ic } = require('./emojis');
const { bannerFile, bannerName, hasBanner } = require('./assets');

const V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;

// Cards that show the banner image. Whatever sends them must also upload the file,
// so message() and edit() add it automatically instead of trusting every caller to remember.
const bannered = new WeakMap(); // container -> banner key
const withBanner = (container, files = []) => {
  const key = bannered.get(container);
  return key && !files.some((f) => f?.name === bannerName(key)) ? [...files, bannerFile(key)] : files;   // bannered only holds banners that exist
};

const galleryUrl = (url) => new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url));
const galleryUrls = (urls) => new MediaGalleryBuilder().addItems(...urls.map((u) => new MediaGalleryItemBuilder().setURL(u)));

const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const gallery = (...names) =>
  new MediaGalleryBuilder().addItems(...names.map((n) => new MediaGalleryItemBuilder().setURL(`attachment://${n}`)));

// Small formatting helpers shared by every card.
const fmt = {
  code: (value) => `\`${value}\``,
  bold: (value) => `**${value}**`,
  user: (id) => `<@${id}>`,
  role: (id) => `<@&${id}>`,
  channel: (id) => `<#${id}>`,
  time: (date, style = 'F') => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`,
};

// The Tower look:
//   [banner]  title  divider  body  [captcha image]  [blocks]  key/value lines  [buttons]  divider  footer
//
//   icon       key of an emoji shown before the title
//   banner     key of a feature banner (brand, verification, tickets, moderation, levels, boost), shown at the top
//   image      attachment name of an image shown under the body (the captcha)
//   imageUrl   a picture from a web address, such as a YouTube thumbnail
//   images     several attachment names shown as a gallery (deleted images in the media log)
//   file       attachment name of a file shown as a download (bulk delete transcripts)
//   thumbnail  URL shown top-right next to the title (member avatars in logs)
//   blocks     extra text blocks, each separated by a divider
//   fields     [label, value, iconKey?] lines
function card({
  title, icon, description, fields = [], blocks = [], banner, image, imageUrl, imageUrls = [], images = [], file, thumbnail, rows = [],
  accent = colors.cobalt,
}) {
  const container = new ContainerBuilder().setAccentColor(accent);
  if (banner && hasBanner(banner)) {
    bannered.set(container, banner);
    container.addMediaGalleryComponents(gallery(bannerName(banner)));
  }

  const heading = `## ${icon ? ic(icon) : ''}${title}`;
  if (thumbnail) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(text(heading))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail));
    if (description) section.addTextDisplayComponents(text(description));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(text(heading));
    container.addSeparatorComponents(divider());
    if (description) container.addTextDisplayComponents(text(description));
  }

  if (image) container.addMediaGalleryComponents(gallery(image));
  if (imageUrl) container.addMediaGalleryComponents(galleryUrl(imageUrl));
  if (imageUrls.length) container.addMediaGalleryComponents(galleryUrls(imageUrls));
  if (images.length) container.addMediaGalleryComponents(gallery(...images));
  if (file) container.addFileComponents(new FileBuilder().setURL(`attachment://${file}`));

  for (const block of blocks) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(text(block));
  }

  if (fields.length) {
    if (thumbnail) container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(
      text(fields.map(([label, value, iconKey]) => `${iconKey ? ic(iconKey) : ''}${label}: ${value}`).join('\n')),
    );
  }

  for (const row of rows) container.addActionRowComponents(row);

  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(text(`-# Powered by: **${brand.name}**${brand.emoji ? ` ${brand.emoji}` : ''}`));
  return container;
}

// New message (channel.send, reply). Add ephemeral:true for private replies.
function message(container, { ephemeral = false, files } = {}) {
  const payload = { components: [container], flags: ephemeral ? V2 | EPHEMERAL : V2 };
  const all = withBanner(container, files);
  if (all.length) payload.files = all;
  return payload;
}

// Edit an existing message (editReply, update). Clears older attachments so a
// retired captcha image never lingers on a message.
function edit(container, { files } = {}) {
  const payload = { components: [container], flags: V2, attachments: [] };
  const all = withBanner(container, files);
  if (all.length) payload.files = all;
  return payload;
}

// Quick card for plain notices and errors.
function notice(title, description, { fields, accent, icon } = {}) {
  return card({ title, icon, description, fields, accent });
}

module.exports = { V2, EPHEMERAL, fmt, card, message, edit, notice };
