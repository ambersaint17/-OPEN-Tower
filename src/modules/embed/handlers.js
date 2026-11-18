const {
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags,
} = require('discord.js');
const ui = require('../../ui');
const { colors } = require('../../constants');
const embed = require('../../lib/embed');
const { matchesChannelName } = require('../../lib/channels');
const modActions = require('../moderation/actions');
const modViews = require('../moderation/views');
const { normalize } = require('../moderation/permissions');
const logger = require('../logging/logger');
const sessions = require('./session');
const editor = require('./editor');
const render = require('./render');
const poster = require('./poster');
const service = require('./service');
const safety = require('./safety');

const { fmt } = ui;
const { ModError } = modActions;
const EPHEMERAL = MessageFlags.Ephemeral;

// ---------- small helpers ----------
const denied = (text, title) => ui.message(modViews.denied(text, title), { ephemeral: true });

// An error shown in its own private message, so the builder stays exactly as it was.
async function fail(interaction, text, title) {
  const payload = denied(text, title);
  return interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
}

const viewFor = (session) => (session.view === 'post' ? editor.postView(session) : session.view === 'confirm' ? editor.confirmView(session) : editor.panel(session));

async function show(interaction, session) {
  session.ui = interaction;
  const payload = ui.edit(viewFor(session));
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  refreshPreview(session).catch(() => {});
}

function previewPayload(session) {
  const built = render.build(session.draft, { uploads: session.uploads, retained: session.retained, retainedUrls: session.retainedUrls, preview: true });
  // An empty draft has nothing to draw, so the preview says so instead of failing.
  if (!built.components.length) {
    const empty = ui.message(ui.notice('Preview', 'Nothing to show yet. Add a block in the builder and it appears here.', { icon: 'eye' }));
    return { components: empty.components, flags: empty.flags, files: empty.files ?? [], allowedMentions: { parse: [] } };
  }
  return { components: built.components, flags: built.flags, files: built.files, allowedMentions: built.allowedMentions };
}

// Opens the live preview next to the builder, so you always see what you are making. It follows every change.
async function openPreview(session, interaction) {
  const payload = previewPayload(session);
  const sent = await interaction.followUp({ ...payload, flags: payload.flags | EPHEMERAL });
  if (sent?.id) session.preview = { editReply: (p) => interaction.webhook.editMessage(sent.id, p) };
}
// The preview message follows every change while its interaction is still valid (about 15 minutes).
async function refreshPreview(session) {
  if (!session.preview) return;
  try {
    await session.preview.editReply({ ...previewPayload(session), attachments: [] });
  } catch {
    session.preview = null;
  }
}

// Changes a copy of the draft and keeps it only if it still fits Discord's limits.
function commit(session, mutate) {
  const next = JSON.parse(JSON.stringify(session.draft));
  mutate(next);
  const v = embed.validateDraft(next);
  if (v.hard.length) throw new ModError(v.hard[0]);
  session.draft = next;
}

function insertBlock(session, block) {
  const len = session.draft.blocks.length;
  if (len >= embed.LIMITS.blocks) throw new ModError(`An embed holds at most ${embed.LIMITS.blocks} blocks.`);
  const at = session.sel >= 0 && session.sel < len ? session.sel + 1 : len;
  commit(session, (d) => { d.blocks.splice(at, 0, block); });
  session.sel = at;
}
function applyBlock(session, block) {
  const p = session.pending;
  if (p?.mode === 'edit' && session.draft.blocks[p.index]) {
    commit(session, (d) => { d.blocks[p.index] = block; });
    session.sel = p.index;
  } else insertBlock(session, block);
  session.pending = null;
}

// ---------- @{Role}, @{Member} and #{channel} become real mentions ----------
function expandMentions(guild, text) {
  const problems = [];
  const out = String(text).replace(/([@#])\{([^}]{1,100})\}/g, (whole, sigil, name) => {
    const n = name.trim();
    if (sigil === '#') {
      const channel = guild.channels.cache.find((c) => normalize(c.name) === normalize(n)) ?? guild.channels.cache.find((c) => matchesChannelName(c.name, n));
      if (channel) return `<#${channel.id}>`;
      problems.push(`channel "${n}"`); return whole;
    }
    if (/^(everyone|here)$/i.test(n)) return `@${n.toLowerCase()}`;
    const role = safety.findRole(guild, n);
    if (role) return `<@&${role.id}>`;
    const member = guild.members.cache.find((m) => m.user.username.toLowerCase() === n.toLowerCase() || m.displayName.toLowerCase() === n.toLowerCase());
    if (member) return `<@${member.id}>`;
    problems.push(`role or member "${n}"`); return whole;
  });
  if (problems.length) throw new ModError(`Tower could not find ${problems.join(', ')}. Check the spelling, or paste the mention itself.`);
  return out;
}

// Role names in buttons and menus become IDs, after the safety check.
function resolveRole(guild, text) {
  const role = safety.findRole(guild, text);
  if (!role) throw new ModError(`There is no role called "${text}". Use its exact name or ID.`);
  const reason = safety.protectedReason(guild, role);
  if (reason) throw new ModError(reason);
  return role.id;
}
const roleLabel = (guild, id) => guild.roles.cache.get(id)?.name ?? id;

// ---------- modals ----------
function input(customId, label, { style = TextInputStyle.Short, value, placeholder, required = true, max } = {}) {
  const t = new TextInputBuilder().setCustomId(customId).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required);
  if (max) t.setMaxLength(max);
  if (value) t.setValue(String(value).slice(0, max ?? 4000));
  if (placeholder) t.setPlaceholder(placeholder.slice(0, 100));
  return t;
}
const modal = (kind, session, title, inputs) => new ModalBuilder().setCustomId(`embed:${kind}:${session.id}`).setTitle(title.slice(0, 45))
  .addComponents(inputs.map((i) => new ActionRowBuilder().addComponents(i)));
const PARA = TextInputStyle.Paragraph;
const MENTION_TIP = 'Ping with @{Role Name} or #{channel}. Markdown works.';

function openBlockModal(interaction, session, type, block) {
  const g = interaction.guild;
  switch (type) {
    case 'text':
      return interaction.showModal(modal('m_text', session, block ? 'Edit text' : 'Add text', [
        input('content', 'Text', { style: PARA, value: block?.content, max: embed.LIMITS.textBlock, placeholder: MENTION_TIP })]));
    case 'section':
      return interaction.showModal(modal('m_section', session, block ? 'Edit text with picture' : 'Add text with picture', [
        input('content', 'Text', { style: PARA, value: block?.content, max: embed.LIMITS.textBlock, placeholder: MENTION_TIP }),
        input('thumb', 'Picture link (https://...)', { value: block?.thumb?.url, required: false, max: 1000, placeholder: 'Or leave empty and use /embed upload' })]));
    case 'separator':
      return interaction.showModal(modal('m_separator', session, 'Separator', [
        input('line', 'Show a line? (yes or no)', { value: block ? (block.divider ? 'yes' : 'no') : 'yes', max: 3 }),
        input('size', 'Size (small or large)', { value: block?.size ?? 'small', max: 5 })]));
    case 'image':
      return interaction.showModal(modal('m_image', session, block ? 'Edit image gallery' : 'Add image gallery', [
        input('urls', 'Picture links, one per line', { style: PARA, value: block?.items.filter((i) => i.url).map((i) => i.url).join('\n'), max: 4000, required: !block,
          placeholder: 'https://... (up to 10). Upload files with /embed upload' })]));
    case 'buttons':
      return interaction.showModal(modal('m_buttons', session, block ? 'Edit buttons' : 'Add buttons', [
        input('lines', 'One button per line', { style: PARA, max: 2000,
          value: block?.buttons.map((b) => [b.label, b.url ?? `role:${roleLabel(g, b.roleId)}`, embed.emojiText(b.emoji)].join(' | ').replace(/ \| $/, '')).join('\n'),
          placeholder: 'Label | https://link | emoji   or   Label | role:Role Name | emoji' })]));
    case 'menu':
      return interaction.showModal(modal('m_menu', session, block ? 'Edit dropdown menu' : 'Add dropdown menu', [
        input('placeholder', 'Placeholder', { value: block?.placeholder, required: false, max: 150, placeholder: 'Choose an option' }),
        input('options', 'Options, one per line', { style: PARA, max: 2500,
          value: block?.options.map((o) => [o.label, o.description, embed.emojiText(o.emoji), o.roleId ? `role:${roleLabel(g, o.roleId)}` : ''].join(' | ').replace(/( \| )+$/, '')).join('\n'),
          placeholder: 'Label | Description | Emoji | role:Name (the last two are optional)' }),
        input('replies', 'Replies, in the same order', { style: PARA, max: embed.LIMITS.replies, value: block?.options.map((o) => o.reply).join('\n---\n'),
          placeholder: 'Reply for option 1\n---\nReply for option 2 (a line of --- separates them)' })]));
    default: return null;
  }
}

function openSettingsModal(interaction, session, kind) {
  const d = session.draft;
  switch (kind) {
    case 'above':
    case 'below':
      return interaction.showModal(modal(`m_${kind}`, session, kind === 'above' ? 'Text above the card' : 'Text below the card', [
        input('content', 'Text (empty removes it)', { style: PARA, value: d[kind], required: false, max: embed.LIMITS.textBlock, placeholder: MENTION_TIP })]));
    case 'style':
      return interaction.showModal(modal('m_style', session, 'Card style', [
        input('accent', 'Side colour (none = no colour bar)', { value: d.accent === null ? 'none' : `#${d.accent.toString(16).padStart(6, '0')}`, max: 20, placeholder: 'cobalt, sky, teal, mint, amber, orange, rose, crimson, violet, silver, #hex or none' }),
        input('banner', 'Banner', { value: d.banner ?? 'none', max: 20, placeholder: embed.BANNER_KEYS.length ? `none, ${embed.BANNER_KEYS.join(', ')}` : 'none (no banner images installed)' }),
        input('footer', 'Show "Powered by" footer? (yes or no)', { value: d.footer ? 'yes' : 'no', max: 3 })]));
    case 'identity':
      return interaction.showModal(modal('m_identity', session, 'Post as', [
        input('name', 'Name (empty posts as Tower)', { value: d.identity.name, required: false, max: 80, placeholder: 'A custom name posts through a webhook' }),
        input('avatar', 'Avatar link (https://...)', { value: d.identity.avatar, required: false, max: 500 })]));
    case 'template':
      return interaction.showModal(modal('m_template', session, 'Save as template', [
        input('name', 'Template name', { max: embed.LIMITS.templateName, placeholder: 'Rules, Announcement, Giveaway...' })]));
    default: return null;
  }
}

async function onModal(interaction, session, action) {
  const f = (key) => interaction.fields.getTextInputValue(key) ?? '';
  const g = interaction.guild;
  session.view = 'editor';

  switch (action) {
    case 'm_text': {
      const content = expandMentions(g, f('content').trim());
      if (!content) throw new ModError('The text cannot be empty.');
      applyBlock(session, { type: 'text', content });
      break;
    }
    case 'm_section': {
      const content = expandMentions(g, f('content').trim());
      if (!content) throw new ModError('The text cannot be empty.');
      const link = f('thumb').trim();
      if (link && !embed.isHttpUrl(link)) throw new ModError('The picture link must start with https://');
      const existing = session.pending?.mode === 'edit' ? session.draft.blocks[session.pending.index] : null;
      const thumb = link ? { url: link } : existing?.thumb?.upload ? existing.thumb : null;
      applyBlock(session, { type: 'section', content, thumb });
      break;
    }
    case 'm_separator': {
      const line = embed.yes(f('line'), null);
      const size = f('size').trim().toLowerCase();
      if (line === null) throw new ModError('For "Show a line?" answer yes or no.');
      if (!['small', 'large'].includes(size)) throw new ModError('For size answer small or large.');
      applyBlock(session, { type: 'separator', divider: line, size });
      break;
    }
    case 'm_image': {
      const urls = f('urls').split('\n').map((l) => l.trim()).filter(Boolean);
      const bad = urls.find((u) => !embed.isHttpUrl(u));
      if (bad) throw new ModError(`"${bad}" is not a link. Picture links start with https://`);
      const existing = session.pending?.mode === 'edit' ? session.draft.blocks[session.pending.index] : null;
      const items = [...urls.map((url) => ({ url })), ...(existing?.items.filter((i) => i.upload) ?? [])];
      if (!items.length) throw new ModError('Add at least one picture link.');
      if (items.length > embed.LIMITS.gallery) throw new ModError(`A gallery holds at most ${embed.LIMITS.gallery} pictures.`);
      applyBlock(session, { type: 'image', items });
      break;
    }
    case 'm_buttons': {
      const parsed = embed.parseButtons(f('lines'));
      if (parsed.errors.length) throw new ModError(parsed.errors.join('\n'));
      const buttons = parsed.buttons.map(({ role, ...rest }) => (role ? { ...rest, roleId: resolveRole(g, role) } : rest));
      applyBlock(session, { type: 'buttons', buttons });
      break;
    }
    case 'm_menu': {
      const parsed = embed.parseMenu({ placeholder: f('placeholder'), options: f('options'), replies: f('replies') });
      if (parsed.errors.length) throw new ModError(parsed.errors.join('\n'));
      const options = parsed.options.map(({ role, ...rest }) => ({ ...rest, reply: expandMentions(g, rest.reply), roleId: role ? resolveRole(g, role) : null }));
      const existing = session.pending?.mode === 'edit' ? session.draft.blocks[session.pending.index] : null;
      applyBlock(session, { type: 'menu', id: existing?.id ?? embed.newId(), placeholder: parsed.placeholder, options });
      break;
    }
    case 'm_above':
    case 'm_below': {
      const key = action === 'm_above' ? 'above' : 'below';
      const content = expandMentions(g, f('content').trim());
      commit(session, (d) => { d[key] = content; });
      break;
    }
    case 'm_style': {
      const accent = f('accent').trim() ? embed.parseColour(f('accent')) : session.draft.accent;
      if (accent === undefined) throw new ModError('Colour not understood. Use a name from the list, a hex code like #2b4fc4, or none.');
      const bannerText = f('banner').trim().toLowerCase();
      let banner = session.draft.banner;
      if (bannerText) {
        if (['none', 'off', 'no'].includes(bannerText)) banner = null;
        else if (embed.BANNER_KEYS.includes(bannerText)) banner = bannerText;
        else throw new ModError(`There is no banner called "${bannerText}". Choose from: none, ${embed.BANNER_KEYS.join(', ')}.`);
      }
      const footer = embed.yes(f('footer'), null);
      if (footer === null) throw new ModError('For the footer answer yes or no.');
      commit(session, (d) => { d.accent = accent; d.banner = banner; d.footer = footer; });
      break;
    }
    case 'm_identity': {
      const name = f('name').trim(); const avatar = f('avatar').trim();
      if (name && /discord|clyde/i.test(name)) throw new ModError('Discord does not allow "discord" or "clyde" in a webhook name.');
      if (avatar && !embed.isHttpUrl(avatar)) throw new ModError('The avatar link must start with https://');
      commit(session, (d) => { d.identity = { name, avatar: name ? avatar : '' }; });
      session.notice = name ? `Posting as ${fmt.bold(name)} through a webhook. Role buttons and menus still work.` : 'Posting as Tower.';
      break;
    }
    case 'm_template': {
      const name = f('name').trim();
      if (!name) throw new ModError('Give the template a name.');
      const exists = await service.getTemplate(g.id, name);
      if (!exists && await service.countTemplates(g.id) >= embed.LIMITS.templates) throw new ModError(`A server can hold ${embed.LIMITS.templates} templates. Delete one with \`/embed delete\`.`);
      const { draft, dropped } = embed.stripUploads(session.draft);
      await service.saveTemplate(g.id, name, draft, session.userId);
      session.notice = `${exists ? 'Updated' : 'Saved'} template ${fmt.bold(name)}.${dropped ? ` ${dropped} uploaded ${dropped === 1 ? 'item was' : 'items were'} left out, because uploads are not kept in templates.` : ''}`;
      break;
    }
    default: return null;
  }
  return show(interaction, session);
}

// ---------- menus and buttons ----------
async function onSelect(interaction, session, action) {
  const value = interaction.values[0];
  if (action === 'pick') { session.sel = Number(value); return show(interaction, session); }
  if (action === 'add') {
    if (session.draft.blocks.length >= embed.LIMITS.blocks) throw new ModError(`An embed holds at most ${embed.LIMITS.blocks} blocks.`);
    if (value === 'separator') {
      insertBlock(session, { type: 'separator', divider: true, size: 'small' });
      return show(interaction, session);
    }
    session.pending = { mode: 'add' };
    return openBlockModal(interaction, session, value, null);
  }
  return null;
}

async function onChannel(interaction, session) {
  const channel = interaction.channels.first();
  const found = channel && await interaction.guild.channels.fetch(channel.id).catch(() => null);
  poster.checkChannel(interaction.guild, found, { webhook: poster.isWebhookPost(session.draft), files: session.uploads.size > 0 || Boolean(session.draft.banner) });
  session.pickedChannelId = found.id;
  session.view = 'confirm';
  return show(interaction, session);
}

async function logPost(guild, session, channel, message, verb) {
  await logger.log(guild, 'server', () => ui.notice(`Embed ${verb}`, `Built with ${fmt.code('/embed')}.`, {
    icon: 'edit',
    fields: [['By', fmt.user(session.userId), 'user'], ['Channel', fmt.channel(channel.id), 'hash'], ['Message', poster.jumpUrl(guild.id, channel.id, message.id), 'link']],
  }), { actorId: session.userId, detail: { embed: verb.toLowerCase(), channelId: channel.id, messageId: message.id } });
}

async function onButton(interaction, session, action) {
  const d = session.draft;
  const blocks = d.blocks;
  const has = session.sel >= 0 && session.sel < blocks.length;
  const swap = (delta) => {
    const to = session.sel + delta;
    if (!has || to < 0 || to >= blocks.length) return;
    commit(session, (x) => { [x.blocks[session.sel], x.blocks[to]] = [x.blocks[to], x.blocks[session.sel]]; });
    session.sel = to;
  };

  switch (action) {
    case 'up': swap(-1); return show(interaction, session);
    case 'down': swap(1); return show(interaction, session);
    case 'edit': {
      if (!has) return show(interaction, session);
      const block = blocks[session.sel];
      if (block.type === 'file') throw new ModError('Files cannot be edited. Delete the block and upload the file again.');
      session.pending = { mode: 'edit', index: session.sel };
      return openBlockModal(interaction, session, block.type, block);
    }
    case 'dup': {
      if (!has) return show(interaction, session);
      const copy = JSON.parse(JSON.stringify(blocks[session.sel]));
      if (copy.type === 'menu') copy.id = embed.newId();
      insertBlock(session, copy);
      return show(interaction, session);
    }
    case 'del': {
      if (has) {
        commit(session, (x) => { x.blocks.splice(session.sel, 1); });
        session.sel = Math.min(session.sel, session.draft.blocks.length - 1);
      }
      return show(interaction, session);
    }
    case 'above': case 'below': case 'style': case 'identity': case 'template':
      return openSettingsModal(interaction, session, action);
    case 'pings':
      d.everyone = !d.everyone;
      return show(interaction, session);
    case 'preview': {
      const payload = previewPayload(session);
      if (session.preview) {
        try { await session.preview.editReply({ ...payload, attachments: [] }); return interaction.deferUpdate(); } catch { session.preview = null; }
      }
      await interaction.reply({ ...payload, flags: payload.flags | EPHEMERAL });
      session.preview = interaction;
      return null;
    }
    case 'post': {
      const v = embed.validateDraft(d);
      if (v.soft.length) throw new ModError(v.soft[0]);
      session.view = 'post';
      return show(interaction, session);
    }
    case 'back':
      session.view = 'editor';
      return show(interaction, session);
    case 'confirm': {
      if (!session.pickedChannelId) throw new ModError('Pick a channel first.');
      await interaction.deferUpdate();
      const channel = await interaction.guild.channels.fetch(session.pickedChannelId).catch(() => null);
      let result;
      try { result = await poster.post(session, channel, interaction.client); } catch (err) {
        session.view = 'editor';
        const text = poster.explain(err);
        if (!text) throw err;
        session.notice = `${text}`;
        return show(interaction, session);
      }
      session.mode = 'edit';
      session.target = { channelId: channel.id, messageId: result.message.id, via: result.via };
      session.view = 'editor';
      session.notice = `Posted in ${fmt.channel(channel.id)}${result.via === 'webhook' ? ' as a webhook' : ''}. ${poster.jumpUrl(interaction.guild.id, channel.id, result.message.id)}\nFurther changes use "Update message".`;
      await logPost(interaction.guild, session, channel, result.message, 'Posted');
      return show(interaction, session);
    }
    case 'update': {
      const v = embed.validateDraft(d);
      if (v.soft.length) throw new ModError(v.soft[0]);
      await interaction.deferUpdate();
      try {
        const { message, channel } = await poster.update(session, interaction.guild, interaction.client);
        session.notice = `Message updated. ${poster.jumpUrl(interaction.guild.id, channel.id, message.id)}`;
        await logPost(interaction.guild, session, channel, message, 'Updated');
      } catch (err) {
        const text = poster.explain(err);
        if (!text) throw err;
        session.notice = text;
      }
      return show(interaction, session);
    }
    case 'close': {
      sessions.remove(session.id);
      return interaction.update(ui.edit(ui.notice('Builder Closed', 'Nothing more will change. Start again with `/embed create`, or `/embed edit` to change a posted embed.', { icon: 'check' })));
    }
    default: return null;
  }
}

// ---------- role buttons and dropdown menus (used by everyone) ----------
async function toggleRole(interaction, roleId) {
  const { guild, member } = interaction;
  const role = guild.roles.cache.get(roleId);
  const reason = safety.protectedReason(guild, role);
  if (reason) return { ok: false, text: reason };
  if (member.roles.cache.some((r) => normalize(r.name) === 'unverified')) return { ok: false, text: 'Verify yourself first, then try again.' };
  const holds = member.roles.cache.has(role.id);
  try {
    if (holds) await member.roles.remove(role, 'Embed role button'); else await member.roles.add(role, 'Embed role button');
  } catch {
    return { ok: false, text: 'Tower could not change your roles. Ask a staff member to check its permissions.' };
  }
  return { ok: true, text: `${holds ? 'Removed' : 'Added'} ${fmt.role(role.id)}` };
}

async function roleButton(interaction, roleId) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const r = await toggleRole(interaction, roleId);
  return interaction.editReply(ui.edit(r.ok ? ui.notice('Role Updated', r.text, { icon: 'check', accent: colors.teal }) : modViews.denied(r.text)));
}

async function menuPick(interaction, blockId) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const post = await service.postByMessage(interaction.message.id, interaction.guildId);
  const block = post?.draft.blocks.find((b) => b.type === 'menu' && b.id === blockId);
  const option = block?.options[Number(interaction.values[0])];
  if (!option) return interaction.editReply(ui.edit(modViews.denied('This menu is no longer available.')));
  const fields = [];
  if (option.roleId) {
    const r = await toggleRole(interaction, option.roleId);
    fields.push([r.ok ? 'Role' : 'Role Not Changed', r.text, r.ok ? 'check' : 'warning']);
  }
  return interaction.editReply(ui.edit(ui.card({ icon: 'scroll', title: option.label, description: option.reply || undefined, fields })));
}

// ---------- entry point ----------
async function handle(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  if (action === 'role') return roleButton(interaction, arg);
  if (action === 'menu') return menuPick(interaction, arg);

  const session = sessions.get(arg);
  if (!session) return interaction.reply(denied('This builder has expired or was closed. Start again with `/embed create`, or `/embed edit` for a posted embed.', 'Builder Expired'));
  if (session.userId !== interaction.user.id) return interaction.reply(denied('This builder belongs to someone else. Start your own with `/embed create`.'));

  try {
    await modActions.contextFor(interaction, 'embedAdmin');
    if (interaction.isModalSubmit()) return await onModal(interaction, session, action);
    if (interaction.isStringSelectMenu()) return await onSelect(interaction, session, action);
    if (interaction.isChannelSelectMenu()) return await onChannel(interaction, session);
    return await onButton(interaction, session, action);
  } catch (err) {
    if (err instanceof ModError) return fail(interaction, err.message);
    const text = poster.explain(err);
    if (text) return fail(interaction, text);
    throw err;
  }
}

// Redraws the builder from outside an interaction on it (for example after /embed upload). Best effort.
async function refreshEditor(session) {
  try { await session.ui?.editReply(ui.edit(viewFor(session))); } catch { return false; }
  refreshPreview(session).catch(() => {});
  return true;
}

module.exports = { handle, show, commit, openPreview, expandMentions, resolveRole, insertBlock, refreshPreview, refreshEditor };
