// Pure logic for the /embed builder: the draft model, limits, parsing and counting. No Discord calls in here.
const crypto = require('node:crypto');
const { colours, colors } = require('../constants');
const { availableBanners, hasBanner } = require('../assets');

// Discord allows 40 components and 4000 characters of text in one components message.
// Components are counted generously (gallery pictures count too) so a post never fails after the confirm button.
const LIMITS = {
  components: 40, text: 4000, blocks: 25, gallery: 10, buttons: 5, menuOptions: 25,
  textBlock: 3500, label: 80, templateName: 40, templates: 50, uploads: 10, reply: 1800, replies: 4000,
};
const FOOTER_CHARS = 60;
const BANNER_KEYS = availableBanners();   // only banners that exist in assets/images
const TYPE_NAMES = { text: 'Text', separator: 'Separator', image: 'Image gallery', section: 'Text with picture', buttons: 'Buttons', menu: 'Dropdown menu', file: 'File' };

const newId = () => crypto.randomBytes(3).toString('hex');
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const newDraft = () => ({
  v: 1, accent: colors.cobalt, banner: null, footer: true, above: '', below: '', everyone: false,
  identity: { name: '', avatar: '' }, blocks: [],
});

// ---------- parsing ----------
function isHttpUrl(text) {
  try { return ['http:', 'https:'].includes(new URL(String(text)).protocol); } catch { return false; }
}

// A colour name from the palette, a hex code, or "none". undefined means "not understood".
function parseColour(input) {
  const t = String(input ?? '').trim().toLowerCase();
  if (!t) return undefined;
  if (['none', 'off', 'no'].includes(t)) return null;
  const named = colours.find((c) => c.key === t || c.label.toLowerCase() === t);
  if (named) return named.hex;
  const m = /^(?:#|0x)?([0-9a-f]{6})$/.exec(t);
  return m ? parseInt(m[1], 16) : undefined;
}

// Blank means no emoji (null), a normal or custom emoji is accepted, anything else is undefined (invalid).
function parseEmoji(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const custom = /^<(a?):(\w{2,32}):(\d{17,20})>$/.exec(t);
  if (custom) return { id: custom[3], name: custom[2], animated: Boolean(custom[1]) };
  return /^\p{Extended_Pictographic}/u.test(t) && [...t].length <= 8 ? t : undefined;
}
const emojiText = (e) => (!e ? '' : typeof e === 'string' ? e : `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`);

const yes = (text, fallback) => {
  const t = String(text ?? '').trim().toLowerCase();
  if (['yes', 'y', 'on', 'true', 'line'].includes(t)) return true;
  if (['no', 'n', 'off', 'false', 'space', 'none'].includes(t)) return false;
  return fallback;
};

// "Label | https://link | emoji" or "Label | role:Name or ID | emoji", one button per line.
function parseButtons(text) {
  const buttons = []; const errors = [];
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) errors.push('Add at least one button.');
  if (lines.length > LIMITS.buttons) errors.push(`A row holds at most ${LIMITS.buttons} buttons. Add a second Buttons block for more.`);
  lines.slice(0, LIMITS.buttons).forEach((line, i) => {
    const [label = '', target = '', emojiRaw = ''] = line.split('|').map((s) => s.trim());
    const n = `Line ${i + 1}`;
    const emoji = parseEmoji(emojiRaw);
    if (emoji === undefined) return errors.push(`${n}: "${emojiRaw}" is not an emoji.`);
    if (!label && !emoji) return errors.push(`${n}: a button needs a label or an emoji.`);
    if (label.length > LIMITS.label) return errors.push(`${n}: the label is longer than ${LIMITS.label} characters.`);
    const role = /^role:\s*(.+)$/i.exec(target);
    if (role) return buttons.push({ label, role: role[1].trim(), emoji });
    if (!isHttpUrl(target)) return errors.push(`${n}: use a link starting with https:// or write role:RoleName.`);
    return buttons.push({ label, url: target, emoji });
  });
  return { buttons, errors };
}

// Options: "Label | Description | Emoji | role:Name" per line. Replies: one per option, split by a line of ---.
function parseMenu({ placeholder, options, replies }) {
  const errors = []; const out = [];
  const lines = String(options ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const texts = String(replies ?? '').split(/^\s*---\s*$/m).map((t) => t.trim());
  if (!lines.length) errors.push('Add at least one option.');
  if (lines.length > LIMITS.menuOptions) errors.push(`A menu holds at most ${LIMITS.menuOptions} options.`);
  if (String(replies ?? '').length > LIMITS.replies) errors.push(`The replies are longer than ${LIMITS.replies} characters in total.`);
  const given = texts.filter(Boolean).length ? texts : [];
  if (given.length > lines.length) errors.push(`There are ${given.length} replies for ${lines.length} options. Separate replies with a line of ---.`);
  lines.slice(0, LIMITS.menuOptions).forEach((line, i) => {
    const [label = '', description = '', emojiRaw = '', roleRaw = ''] = line.split('|').map((s) => s.trim());
    const n = `Option ${i + 1}`;
    const emoji = parseEmoji(emojiRaw);
    const role = /^role:\s*(.+)$/i.exec(roleRaw);
    const reply = given[i] ?? '';
    if (!label) return errors.push(`${n}: it needs a label.`);
    if (label.length > 100) return errors.push(`${n}: the label is longer than 100 characters.`);
    if (description.length > 100) return errors.push(`${n}: the description is longer than 100 characters.`);
    if (emoji === undefined) return errors.push(`${n}: "${emojiRaw}" is not an emoji.`);
    if (roleRaw && !role) return errors.push(`${n}: the fourth part must look like role:RoleName.`);
    if (reply.length > LIMITS.reply) return errors.push(`${n}: its reply is longer than ${LIMITS.reply} characters.`);
    if (!reply && !role) return errors.push(`${n}: it needs a reply, a role, or both.`);
    return out.push({ label, description, emoji, reply, role: role ? role[1].trim() : null });
  });
  if (String(placeholder ?? '').length > 150) errors.push('The placeholder is longer than 150 characters.');
  return { placeholder: String(placeholder ?? '').trim() || 'Choose an option', options: out, errors };
}

// ---------- draft model ----------
function cleanMedia(m) {
  if (m?.url && isHttpUrl(m.url)) return { url: m.url.slice(0, 1000) };
  if (typeof m?.upload === 'string' && m.upload) return { upload: m.upload.slice(0, 120) };
  return null;
}
const cleanEmoji = (e) => (typeof e === 'string' ? e.slice(0, 16) : e?.id ? { id: String(e.id), name: String(e.name ?? 'e'), animated: Boolean(e.animated) } : null);

function cleanBlock(b) {
  switch (b?.type) {
    case 'text': return str(b.content, LIMITS.textBlock) ? { type: 'text', content: str(b.content, LIMITS.textBlock) } : null;
    case 'separator': return { type: 'separator', divider: b.divider !== false, size: b.size === 'large' ? 'large' : 'small' };
    case 'image': {
      const items = (Array.isArray(b.items) ? b.items : []).map(cleanMedia).filter(Boolean).slice(0, LIMITS.gallery);
      return items.length ? { type: 'image', items } : null;
    }
    case 'section': return str(b.content, LIMITS.textBlock) ? { type: 'section', content: str(b.content, LIMITS.textBlock), thumb: cleanMedia(b.thumb) } : null;
    case 'file': return typeof b.upload === 'string' && b.upload ? { type: 'file', upload: b.upload.slice(0, 120) } : null;
    case 'buttons': {
      const buttons = (Array.isArray(b.buttons) ? b.buttons : []).slice(0, LIMITS.buttons).map((x) => {
        const base = { label: str(x?.label, LIMITS.label), emoji: cleanEmoji(x?.emoji) };
        if (x?.url && isHttpUrl(x.url)) return { ...base, url: x.url.slice(0, 1000) };
        if (x?.roleId) return { ...base, roleId: String(x.roleId) };
        return null;
      }).filter((x) => x && (x.label || x.emoji));
      return buttons.length ? { type: 'buttons', buttons } : null;
    }
    case 'menu': {
      const options = (Array.isArray(b.options) ? b.options : []).slice(0, LIMITS.menuOptions).map((o) => ({
        label: str(o?.label, 100), description: str(o?.description, 100), emoji: cleanEmoji(o?.emoji),
        reply: str(o?.reply, LIMITS.reply), roleId: o?.roleId ? String(o.roleId) : null,
      })).filter((o) => o.label);
      return options.length ? { type: 'menu', id: /^[0-9a-f]{6}$/.test(b.id) ? b.id : newId(), placeholder: str(b.placeholder, 150) || 'Choose an option', options } : null;
    }
    default: return null;
  }
}

// Anything read back from the database is rebuilt field by field, so an old or damaged row can never crash the builder.
function sanitizeDraft(raw) {
  const d = newDraft();
  if (!raw || typeof raw !== 'object') return d;
  d.accent = raw.accent === null ? null : Number.isInteger(raw.accent) ? raw.accent : d.accent;
  d.banner = hasBanner(raw.banner) ? raw.banner : null;
  d.footer = raw.footer !== false;
  d.above = str(raw.above, LIMITS.textBlock);
  d.below = str(raw.below, LIMITS.textBlock);
  d.everyone = raw.everyone === true;
  d.identity = { name: str(raw.identity?.name, 80), avatar: isHttpUrl(raw.identity?.avatar) ? raw.identity.avatar.slice(0, 500) : '' };
  d.blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).slice(0, LIMITS.blocks).map(cleanBlock).filter(Boolean);
  return d;
}

// ---------- counting and validation ----------
function blockComponents(b) {
  switch (b.type) {
    case 'image': return 1 + b.items.length;
    case 'section': return b.thumb ? 3 : 1;
    case 'buttons': return 1 + b.buttons.length;
    case 'menu': return 2;
    default: return 1;
  }
}
function countComponents(d) {
  const hasBody = d.blocks.length > 0 || Boolean(d.banner);
  let n = hasBody ? 1 + (d.banner ? 2 : 0) + (d.footer ? 2 : 0) : 0;
  for (const b of d.blocks) n += blockComponents(b);
  return n + (d.above ? 1 : 0) + (d.below ? 1 : 0);
}
function countText(d) {
  const hasBody = d.blocks.length > 0 || Boolean(d.banner);
  let n = (d.above?.length ?? 0) + (d.below?.length ?? 0) + (hasBody && d.footer ? FOOTER_CHARS : 0);
  for (const b of d.blocks) if (b.type === 'text' || b.type === 'section') n += b.content.length;
  return n;
}
// hard = a change that must be refused. soft = something to fix before posting.
function validateDraft(d) {
  const hard = []; const soft = [];
  const components = countComponents(d); const chars = countText(d);
  if (d.blocks.length > LIMITS.blocks) hard.push(`An embed holds at most ${LIMITS.blocks} blocks.`);
  if (components > LIMITS.components) hard.push(`That is too much for one message: ${components} of ${LIMITS.components} components. Remove something first.`);
  if (chars > LIMITS.text) hard.push(`That is too much text for one message: ${chars} of ${LIMITS.text} characters.`);
  if (!d.blocks.length && !d.above && !d.below && !d.banner) soft.push('Add at least one block before posting.');
  return { hard, soft, components, chars };
}

// ---------- mentions ----------
function textsOf(d) {
  return [d.above, d.below, ...d.blocks.filter((b) => b.type === 'text' || b.type === 'section').map((b) => b.content)].filter(Boolean);
}
function mentionsOf(d) {
  const roles = new Set(); const users = new Set(); let everyone = false;
  for (const t of textsOf(d)) {
    for (const m of t.matchAll(/<@&(\d{17,20})>/g)) roles.add(m[1]);
    for (const m of t.matchAll(/<@!?(\d{17,20})>/g)) users.add(m[1]);
    if (/@everyone|@here/.test(t)) everyone = true;
  }
  return { roles: [...roles], users: [...users], everyone };
}
// Only what is written in the embed can ping, and @everyone/@here only when switched on in the builder.
function allowedMentionsFor(d) {
  const m = mentionsOf(d);
  return { parse: d.everyone ? ['everyone'] : [], roles: m.roles, users: m.users };
}

// ---------- editing helpers ----------
const snippet = (text, max = 38) => {
  const t = String(text ?? '').replace(/[`*_~|>#]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || '(empty)';
};
function blockSummary(b) {
  switch (b.type) {
    case 'text': return `Text: ${snippet(b.content)}`;
    case 'separator': return `Separator (${b.divider ? 'line' : 'space only'}, ${b.size})`;
    case 'image': return `Image gallery (${b.items.length} ${b.items.length === 1 ? 'picture' : 'pictures'})`;
    case 'section': return `Text with picture: ${snippet(b.content, 28)}${b.thumb ? '' : ' (no picture)'}`;
    case 'buttons': return `Buttons: ${snippet(b.buttons.map((x) => x.label || '(emoji)').join(', '), 30)}`;
    case 'menu': return `Dropdown menu (${b.options.length} ${b.options.length === 1 ? 'option' : 'options'})`;
    case 'file': return `File: ${b.upload}`;
    default: return b.type;
  }
}
const pickLabel = (b, i) => `${i + 1}. ${TYPE_NAMES[b.type] ?? b.type}`.slice(0, 100);

function uploadNamesUsed(d) {
  const names = new Set();
  for (const b of d.blocks) {
    if (b.type === 'image') b.items.forEach((i) => i.upload && names.add(i.upload));
    if (b.type === 'section' && b.thumb?.upload) names.add(b.thumb.upload);
    if (b.type === 'file') names.add(b.upload);
  }
  return names;
}
// Uploaded pictures live in the editor's memory, so a template keeps only what points at a web address.
function stripUploads(d) {
  const copy = JSON.parse(JSON.stringify(d)); let dropped = 0; const blocks = [];
  for (const b of copy.blocks) {
    if (b.type === 'file') { dropped++; continue; }
    if (b.type === 'image') {
      const keep = b.items.filter((i) => !i.upload); dropped += b.items.length - keep.length;
      if (!keep.length) continue;
      b.items = keep;
    }
    if (b.type === 'section' && b.thumb?.upload) { b.thumb = null; dropped++; }
    blocks.push(b);
  }
  copy.blocks = blocks;
  return { draft: copy, dropped };
}

module.exports = {
  LIMITS, BANNER_KEYS, TYPE_NAMES, newId, newDraft, sanitizeDraft, isHttpUrl, parseColour, parseEmoji, emojiText, yes,
  parseButtons, parseMenu, blockComponents, countComponents, countText, validateDraft, mentionsOf, allowedMentionsFor,
  snippet, blockSummary, pickLabel, uploadNamesUsed, stripUploads,
};
