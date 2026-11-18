const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const { colors } = require('../constants');
const embed = require('../lib/embed');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const sessions = require('../modules/embed/session');
const editor = require('../modules/embed/editor');
const service = require('../modules/embed/service');
const handlers = require('../modules/embed/handlers');

const { fmt } = ui;
const MB = 1024 * 1024;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

const safeFileName = (name) => {
  const clean = String(name).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 60);
  return clean || 'file';
};

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new modActions.ModError(`Discord would not hand over that file (HTTP ${res.status}). Try uploading it again.`);
  return Buffer.from(await res.arrayBuffer());
}

// Removes pictures and files that are no longer on the message, so an old post can always be opened.
function dropMissingUploads(draft, present) {
  let dropped = 0; const blocks = [];
  for (const b of draft.blocks) {
    if (b.type === 'file') { if (present.has(b.upload)) blocks.push(b); else dropped++; continue; }
    if (b.type === 'image') {
      const items = b.items.filter((i) => !i.upload || present.has(i.upload));
      dropped += b.items.length - items.length;
      if (items.length) blocks.push({ ...b, items });
      continue;
    }
    if (b.type === 'section' && b.thumb?.upload && !present.has(b.thumb.upload)) { dropped++; blocks.push({ ...b, thumb: null }); continue; }
    blocks.push(b);
  }
  return { draft: { ...draft, blocks }, dropped };
}

const subs = {
  async create(interaction, ctx) {
    const name = interaction.options.getString('template');
    let draft = embed.newDraft(); let notice = null;
    if (name) {
      const tpl = await service.getTemplate(ctx.guild.id, name);
      if (!tpl) throw new modActions.ModError(`There is no template called "${name}". See them with \`/embed templates\`.`);
      draft = tpl.draft;
      notice = `Loaded template ${fmt.bold(tpl.name)}.`;
    }
    const session = sessions.create({ userId: interaction.user.id, guildId: ctx.guild.id, draft });
    session.notice = notice;
    session.ui = interaction;
    await interaction.editReply(ui.edit(editor.panel(session)));
    return handlers.openPreview(session, interaction).catch(() => {});
  },

  async edit(interaction, ctx) {
    const text = interaction.options.getString('message', true).trim();
    const link = /discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/.exec(text);
    const messageId = link ? link[3] : /^\d{17,20}$/.test(text) ? text : null;
    if (!messageId || (link && link[1] !== ctx.guild.id)) throw new modActions.ModError('Give a message link (right-click the message, Copy Message Link) or a message ID from this server.');
    const post = await service.postByMessage(messageId, ctx.guild.id);
    if (!post) throw new modActions.ModError('Tower did not post that message with `/embed`, so it cannot edit it here.');
    const channel = await ctx.guild.channels.fetch(post.channelId).catch(() => null);
    const message = await channel?.messages?.fetch(messageId).catch(() => null);
    if (!message) throw new modActions.ModError('That message no longer exists.');

    const present = new Set([...message.attachments.values()].map((a) => a.name));
    const { draft, dropped } = dropMissingUploads(post.draft, present);
    const session = sessions.create({
      userId: interaction.user.id, guildId: ctx.guild.id, draft, mode: 'edit',
      target: { channelId: channel.id, messageId, via: post.via }, retained: present,
      retainedUrls: new Map([...message.attachments.values()].map((a) => [a.name, a.url])),
    });
    session.notice = `Editing the embed in ${fmt.channel(channel.id)}. ${message.url}${dropped ? `\n${dropped} uploaded ${dropped === 1 ? 'item' : 'items'} no longer on the message ${dropped === 1 ? 'was' : 'were'} left out.` : ''}`;
    session.ui = interaction;
    await interaction.editReply(ui.edit(editor.panel(session)));
    return handlers.openPreview(session, interaction).catch(() => {});
  },

  async upload(interaction, ctx) {
    const session = sessions.forUser(interaction.user.id, ctx.guild.id);
    if (!session) throw new modActions.ModError('Open a builder first with `/embed create` (or `/embed edit`), then upload.');
    const att = interaction.options.getAttachment('file', true);
    const kind = interaction.options.getString('kind') ?? 'image';
    const limit = Math.min(ctx.guild.maximumUploadLimit ?? 10 * MB, 25 * MB);
    if (att.size > limit) throw new modActions.ModError(`That file is ${(att.size / MB).toFixed(1)} MB. This server allows ${(limit / MB).toFixed(0)} MB. Use a smaller file or a link.`);
    if (kind !== 'file' && !EXT[att.contentType?.split(';')[0]]) throw new modActions.ModError('Pictures must be PNG, JPG, GIF or WebP. Use kind "File download" for anything else.');
    if (session.uploads.size >= embed.LIMITS.uploads) throw new modActions.ModError(`A builder holds at most ${embed.LIMITS.uploads} uploads.`);

    const buffer = await download(att.url);
    const taken = (n) => session.uploads.has(n) || session.retained.has(n);
    let name;
    if (kind === 'file') {
      const base = safeFileName(att.name); const dot = base.lastIndexOf('.');
      const stem = dot > 0 ? base.slice(0, dot) : base; const ext = dot > 0 ? base.slice(dot) : '';
      name = base;
      for (let i = 2; taken(name); i++) name = `${stem}-${i}${ext}`;
    } else {
      do { name = `img-${embed.newId()}.${EXT[att.contentType.split(';')[0]]}`; } while (taken(name));
    }
    session.uploads.set(name, { buffer, size: buffer.length, contentType: att.contentType });

    const selected = session.draft.blocks[session.sel];
    if (kind === 'image' && selected?.type === 'image' && selected.items.length < embed.LIMITS.gallery) {
      handlers.commit(session, (d) => { d.blocks[session.sel].items.push({ upload: name }); });
    } else if (kind === 'image') {
      handlers.insertBlock(session, { type: 'image', items: [{ upload: name }] });
    } else if (kind === 'thumbnail') {
      handlers.insertBlock(session, { type: 'section', content: 'Edit this text', thumb: { upload: name } });
    } else {
      handlers.insertBlock(session, { type: 'file', upload: name });
    }
    const refreshed = await handlers.refreshEditor(session);
    const where = kind === 'image' && selected?.type === 'image' ? 'added to the selected gallery' : 'added as a new block';
    return interaction.editReply(ui.edit(ui.notice('Uploaded', `${fmt.code(name)} was ${where}.${refreshed ? '' : ' Your builder window is out of date, so press any button in it to refresh.'}`, { icon: 'image', accent: colors.teal })));
  },

  async templates(interaction, ctx) {
    const rows = await service.listTemplates(ctx.guild.id);
    const description = rows.length
      ? rows.map((r) => `• ${fmt.bold(r.name)}, updated ${fmt.time(r.updated_at, 'R')}`).join('\n')
      : 'No templates yet. Build an embed and press **Save template**.';
    return interaction.editReply(ui.edit(ui.notice('Embed Templates', description, { icon: 'folder', fields: [['Open One', fmt.code('/embed create template:<name>'), 'edit']] })));
  },

  async delete(interaction, ctx) {
    const name = interaction.options.getString('template', true);
    const removed = await service.deleteTemplate(ctx.guild.id, name);
    if (!removed) throw new modActions.ModError(`There is no template called "${name}".`);
    return interaction.editReply(ui.edit(ui.notice('Template Deleted', `${fmt.bold(name)} is gone. Embeds already posted are not affected.`, { icon: 'trash' })));
  },
};

module.exports = {
  data: new SlashCommandBuilder().setName('embed').setDescription('Build and post custom cards (Administrator and up)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('create').setDescription('Open the embed builder')
      .addStringOption((o) => o.setName('template').setDescription('Start from a saved template').setAutocomplete(true)))
    .addSubcommand((s) => s.setName('edit').setDescription('Change an embed Tower already posted')
      .addStringOption((o) => o.setName('message').setDescription('Message link or message ID').setRequired(true)))
    .addSubcommand((s) => s.setName('upload').setDescription('Add a picture or file to your open builder')
      .addAttachmentOption((o) => o.setName('file').setDescription('The picture or file').setRequired(true))
      .addStringOption((o) => o.setName('kind').setDescription('How it is used (default: image gallery)')
        .addChoices({ name: 'Image gallery', value: 'image' }, { name: 'Picture beside text', value: 'thumbnail' }, { name: 'File download', value: 'file' })))
    .addSubcommand((s) => s.setName('templates').setDescription('List saved templates'))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a saved template')
      .addStringOption((o) => o.setName('template').setDescription('Template name').setRequired(true).setAutocomplete(true))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const ctx = await modActions.contextFor(interaction, 'embedAdmin');
      return await subs[interaction.options.getSubcommand()](interaction, ctx);
    } catch (err) {
      if (err instanceof modActions.ModError) return interaction.editReply(ui.edit(modViews.denied(err.message)));
      throw err;
    }
  },

  async autocomplete(interaction) {
    try {
      const typed = interaction.options.getFocused().toLowerCase();
      const rows = await service.listTemplates(interaction.guildId);
      await interaction.respond(rows.filter((r) => r.name.toLowerCase().includes(typed)).slice(0, 25).map((r) => ({ name: r.name.slice(0, 100), value: r.name })));
    } catch {
      await interaction.respond([]).catch(() => {});
    }
  },
};
