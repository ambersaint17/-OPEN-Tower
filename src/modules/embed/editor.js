const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
} = require('discord.js');
const ui = require('../../ui');
const { ic, object } = require('../../emojis');
const { colors } = require('../../constants');
const embed = require('../../lib/embed');
const poster = require('./poster');

const { fmt } = ui;
const id = (action, session) => `embed:${action}:${session.id}`;

// An application emoji when Tower has one for the key, otherwise a plain symbol.
function button(customId, label, { style = ButtonStyle.Secondary, emoji, disabled = false } = {}) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
}
const iconOf = (key) => { try { return object(key); } catch { return undefined; } };

function pingsText(draft) {
  const m = embed.mentionsOf(draft);
  const parts = [...m.roles.map(fmt.role), ...m.users.map(fmt.user)];
  if (draft.everyone) parts.push('`@everyone / @here allowed`');
  else if (m.everyone) parts.push('`@everyone written but switched off`');
  return parts.length ? parts.join(' ') : '`nobody`';
}

function outline(session) {
  const d = session.draft;
  const lines = [];
  lines.push(`${ic('chat')}**Above the card:** ${d.above ? embed.snippet(d.above, 60) : '*nothing*'}`);
  if (!d.blocks.length) lines.push('*The card is empty. Use "Add a block" below.*');
  d.blocks.forEach((b, i) => lines.push(`${i === session.sel ? '**▶**' : '•'} **${i + 1}.** ${embed.blockSummary(b)}`));
  lines.push(`${ic('chat')}**Below the card:** ${d.below ? embed.snippet(d.below, 60) : '*nothing*'}`);
  return lines.join('\n');
}

// The main screen: what the embed contains, its size, and every control.
function panel(session) {
  const d = session.draft;
  const v = embed.validateDraft(d);
  const hasSel = session.sel >= 0 && session.sel < d.blocks.length;
  const editing = session.mode === 'edit';

  const addMenu = new StringSelectMenuBuilder().setCustomId(id('add', session)).setPlaceholder('Add a block (goes after the selected one)')
    .addOptions([
      { label: 'Text', value: 'text', description: 'Formatted text. Roles and users can be pinged here.' },
      { label: 'Text with picture', value: 'section', description: 'Text with a small picture at the side.' },
      { label: 'Separator', value: 'separator', description: 'A line or an empty gap.' },
      { label: 'Image gallery', value: 'image', description: 'One or more pictures from links.' },
      { label: 'Buttons', value: 'buttons', description: 'Link buttons, or buttons that give a role.' },
      { label: 'Dropdown menu', value: 'menu', description: 'A "choose from" menu that answers privately.' },
    ]);
  const rows = [new ActionRowBuilder().addComponents(addMenu)];

  if (d.blocks.length) {
    const pick = new StringSelectMenuBuilder().setCustomId(id('pick', session)).setPlaceholder('Select a block to change');
    pick.addOptions(d.blocks.map((b, i) => ({ label: embed.pickLabel(b, i), value: String(i), description: embed.blockSummary(b).slice(0, 100), default: i === session.sel })));
    rows.push(new ActionRowBuilder().addComponents(pick));
  }

  rows.push(new ActionRowBuilder().addComponents(
    button(id('up', session), 'Up', { emoji: '⬆️', disabled: !hasSel || session.sel === 0 }),
    button(id('down', session), 'Down', { emoji: '⬇️', disabled: !hasSel || session.sel === d.blocks.length - 1 }),
    button(id('edit', session), 'Edit', { emoji: iconOf('edit'), disabled: !hasSel }),
    button(id('dup', session), 'Duplicate', { emoji: iconOf('plus'), disabled: !hasSel }),
    button(id('del', session), 'Delete', { emoji: iconOf('trash'), style: ButtonStyle.Danger, disabled: !hasSel }),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    button(id('above', session), 'Text above'),
    button(id('below', session), 'Text below'),
    button(id('style', session), 'Style', { emoji: iconOf('sparkle') }),
    button(id('identity', session), 'Post as'),
    button(id('pings', session), d.everyone ? '@everyone: on' : '@everyone: off', { style: d.everyone ? ButtonStyle.Danger : ButtonStyle.Secondary }),
  ));
  const last = [button(id('preview', session), 'Preview', { emoji: iconOf('eye') })];
  if (editing) {
    last.push(button(id('update', session), 'Update message', { style: ButtonStyle.Success, emoji: iconOf('check'), disabled: v.soft.length > 0 }));
    last.push(button(id('post', session), 'Post as new', { disabled: v.soft.length > 0 }));
  } else {
    last.push(button(id('post', session), 'Post', { style: ButtonStyle.Success, emoji: iconOf('check'), disabled: v.soft.length > 0 }));
  }
  last.push(button(id('template', session), 'Save template'), button(id('close', session), 'Close'));
  rows.push(new ActionRowBuilder().addComponents(last));

  const description = [session.notice, outline(session), '-# Upload pictures and files with `/embed upload`. Close ends this builder, so post or save first.']
    .filter(Boolean).join('\n\n');
  const fields = [
    ['Posts As', d.identity.name ? `${fmt.bold(d.identity.name)} (webhook)` : fmt.bold('Tower'), 'user'],
    ['Size', fmt.code(`${v.components}/${embed.LIMITS.components} components, ${v.chars}/${embed.LIMITS.text} characters`), 'stats'],
    ['Pings', pingsText(d), 'bell'],
    ['Mode', editing ? 'Editing a posted message' : 'New post', 'edit'],
  ];
  session.notice = null;
  return ui.card({ icon: 'edit', title: 'Embed Builder', description, fields, rows, banner: 'brand' });
}

// Step 2 of posting: choose where it goes.
function postView(session) {
  const select = new ChannelSelectMenuBuilder().setCustomId(id('channel', session)).setPlaceholder('Choose the channel to post in')
    .setChannelTypes(...poster.POSTABLE).setMinValues(1).setMaxValues(1);
  return ui.card({
    icon: 'edit', title: 'Where Should It Go?', description: 'Pick a channel. You will see a summary to confirm before anything is posted.',
    rows: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(button(id('back', session), 'Back'))],
  });
}

// Step 3: summary and confirm.
function confirmView(session) {
  const d = session.draft;
  const v = embed.validateDraft(d);
  return ui.card({
    icon: 'warning', title: 'Ready To Post', accent: colors.cobalt,
    description: 'This goes out the moment you confirm. Check who gets pinged.',
    fields: [
      ['Channel', fmt.channel(session.pickedChannelId), 'hash'],
      ['Posts As', d.identity.name ? `${fmt.bold(d.identity.name)} (webhook)` : fmt.bold('Tower'), 'user'],
      ['Pings', pingsText(d), 'bell'],
      ['Size', fmt.code(`${v.components}/${embed.LIMITS.components} components`), 'stats'],
    ],
    rows: [new ActionRowBuilder().addComponents(
      button(id('confirm', session), 'Post now', { style: ButtonStyle.Success, emoji: iconOf('check') }),
      button(id('post', session), 'Choose another channel'),
      button(id('back', session), 'Back'),
    )],
  });
}

module.exports = { panel, postView, confirmView, outline };
