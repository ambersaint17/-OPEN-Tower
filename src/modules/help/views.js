const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const ui = require('../../ui');
const { ic } = require('../../emojis');
const { rankLabel } = require('../moderation/permissions');
const { nameOf } = require('./catalog');

const { fmt } = ui;
const OVERVIEW = 'overview';

const tag = (state) => (state && state.locked ? ` ${ic('lock')}*${state.locked}*` : '');
const line = (c) => (c.tip ? `**${c.usage}**: ${c.summary}` : `${fmt.code(c.usage)}: ${c.summary}${tag(c.state)}`);

// One line per section listing just the command names, so a long list stays readable at a glance.
function overviewText(sections) {
  return sections.map((s) => {
    const names = [...new Set(s.commands.filter((c) => !c.tip).map((c) => nameOf(c.usage)))];
    const shown = names.map((n) => {
      const locked = s.commands.filter((c) => nameOf(c.usage) === n).every((c) => c.state && c.state.locked);
      return locked ? `${fmt.code(n)} ${ic('lock')}` : fmt.code(n);
    });
    return `${ic(s.icon)}**${s.title}**\n${shown.length ? shown.join('  ') : '*Giveaways, by button*'}`;
  }).join('\n\n');
}

function helpCard(sections, viewer, selected = OVERVIEW) {
  const section = sections.find((s) => s.key === selected);
  const rank = viewer.level > 0 ? rankLabel(viewer.level) : null;
  const intro = rank ? `You are **${rank}**, so you also see the staff tools you can use.` : 'These are the commands you can use. More unlock as you level up.';

  const description = section
    ? `${ic(section.icon)}**${section.title}**\n${section.about}\n\n${section.commands.map(line).join('\n')}`
    : `${intro}\n\n${overviewText(sections)}`;

  const select = new StringSelectMenuBuilder().setCustomId('help:view').setPlaceholder('See the details of a section')
    .addOptions([
      { label: 'Overview', value: OVERVIEW, description: 'Every command you can use', default: !section },
      ...sections.map((s) => ({ label: s.title, value: s.key, description: `${s.commands.length} ${s.commands.length === 1 ? 'item' : 'items'}`.slice(0, 100), default: section?.key === s.key })),
    ]);
  return ui.card({ banner: 'brand', icon: 'question', title: 'Tower Help', description, rows: [new ActionRowBuilder().addComponents(select)] });
}

module.exports = { helpCard, overviewText, OVERVIEW };
