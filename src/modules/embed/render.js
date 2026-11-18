const {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder,
  SectionBuilder, ThumbnailBuilder, FileBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const ui = require('../../ui');
const { brand } = require('../../constants');
const { bannerFile, bannerName, hasBanner } = require('../../assets');
const embed = require('../../lib/embed');

const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = (line = true, large = false) => new SeparatorBuilder().setDivider(line).setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

// Turns a draft into a message payload.
//   uploads   Map(name -> { buffer }) pictures and files uploaded in this editing session (sent as attachments)
//   retained  Set(names) attachments that already sit on the message being edited
//   retainedUrls  Map(name -> address) of those attachments, so a preview can show them
//   retainedOk  true only when editing that message in place; a new message cannot reuse them
//   preview   interactive parts are shown disabled and nothing can ping
// Returns { components, flags, files, allowedMentions, keep, missing } where keep lists retained attachments still in use.
function build(draft, { uploads = new Map(), retained = new Set(), retainedOk = false, retainedUrls = new Map(), preview = false } = {}) {
  const files = []; const keep = new Set(); const missing = new Set();

  const urlOf = (media) => {
    if (!media) return null;
    if (media.url) return media.url;
    if (uploads.has(media.upload)) {
      if (!files.some((f) => f.name === media.upload)) files.push({ attachment: uploads.get(media.upload).buffer, name: media.upload });
      return `attachment://${media.upload}`;
    }
    if (preview && retainedUrls.has(media.upload)) return retainedUrls.get(media.upload); // the live picture on the original message
    if (retainedOk && retained.has(media.upload)) { keep.add(media.upload); return `attachment://${media.upload}`; }
    missing.add(media.upload);
    return null;
  };

  const hasBody = draft.blocks.length > 0 || Boolean(draft.banner);
  const container = new ContainerBuilder();
  if (draft.accent !== null && draft.accent !== undefined) container.setAccentColor(draft.accent);

  if (draft.banner && hasBanner(draft.banner)) {
    files.push(bannerFile(draft.banner));
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${bannerName(draft.banner)}`)));
  }

  for (const b of draft.blocks) {
    switch (b.type) {
      case 'text': container.addTextDisplayComponents(text(b.content)); break;
      case 'separator': container.addSeparatorComponents(divider(b.divider, b.size === 'large')); break;
      case 'image': {
        const urls = b.items.map(urlOf).filter(Boolean);
        if (urls.length) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(urls.map((u) => new MediaGalleryItemBuilder().setURL(u))));
        break;
      }
      case 'section': {
        const thumb = urlOf(b.thumb);
        if (thumb) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(b.content)).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb)));
        else container.addTextDisplayComponents(text(b.content));
        break;
      }
      case 'file': {
        const url = urlOf({ upload: b.upload });
        if (url) container.addFileComponents(new FileBuilder().setURL(url));
        break;
      }
      case 'buttons': {
        const row = new ActionRowBuilder();
        for (const x of b.buttons) {
          const button = new ButtonBuilder();
          if (x.label) button.setLabel(x.label);
          if (x.emoji) button.setEmoji(x.emoji);
          if (x.url) button.setStyle(ButtonStyle.Link).setURL(x.url);
          else button.setStyle(ButtonStyle.Secondary).setCustomId(`embed:role:${x.roleId}`).setDisabled(preview);
          row.addComponents(button);
        }
        container.addActionRowComponents(row);
        break;
      }
      case 'menu': {
        const select = new StringSelectMenuBuilder().setCustomId(`embed:menu:${b.id}`).setPlaceholder(b.placeholder).setDisabled(preview)
          .addOptions(b.options.map((o, i) => {
            const option = { label: o.label, value: String(i) };
            if (o.description) option.description = o.description;
            if (o.emoji) option.emoji = o.emoji;
            return option;
          }));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
        break;
      }
      default: break;
    }
  }

  if (hasBody && draft.footer) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(text(`-# Powered by: **${brand.name}**${brand.emoji ? ` ${brand.emoji}` : ''}`));
  }

  // Text outside the card is a plain text block above or below it. A components message cannot carry a normal "content" line.
  const components = [];
  if (draft.above) components.push(text(draft.above));
  if (hasBody) components.push(container);
  if (draft.below) components.push(text(draft.below));

  return {
    components, flags: ui.V2, files, keep: [...keep], missing: [...missing],
    allowedMentions: preview ? { parse: [] } : embed.allowedMentionsFor(draft),
  };
}

module.exports = { build };
