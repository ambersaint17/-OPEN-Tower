const { SlashCommandBuilder, InteractionContextType, MessageFlags, AttachmentBuilder } = require('discord.js');
const ui = require('../ui');
const { colors } = require('../constants');
const L = require('../lib/levels');
const { renderLevelCard } = require('../lib/levelcard');
const engine = require('../modules/levels/engine');
const { evaluate } = require('../modules/levels/rules');
const views = require('../modules/levels/views');
const handlers = require('../modules/levels/handlers');
const { perks } = require('../constants');

const level = {
  data: new SlashCommandBuilder().setName('level').setDescription('See your level, XP and perks. Only you can see it.')
    .setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, member } = interaction;
    try {
      const entry = await engine.peek(guild.id, member.id);
      const prog = L.progress(entry.xp);
      const booster = Boolean(member.premiumSince);
      const event = engine.activeEvent(guild.id);
      const next = L.nextUnlock(prog.level);
      const verdict = evaluate(
        { ids: [interaction.channelId, interaction.channel?.parentId].filter(Boolean), roleIds: [...member.roles.cache.keys()] },
        await engine.configFor(guild),
      );

      let files = [];
      let imageName;
      try {
        const png = renderLevelCard({
          level: prog.level, title: L.titleFor(prog.level), xp: entry.xp, into: prog.into, needed: prog.needed,
          fraction: prog.fraction, max: prog.max, booster, streak: entry.streak,
          nextLabel: next ? `${next.perks.map((k) => perks[k].name).join(' and ').toUpperCase()}  LEVEL ${next.level}` : null,
        });
        imageName = 'level-card.png';
        files = [new AttachmentBuilder(png, { name: imageName })];
      } catch (err) {
        console.error('[/level] could not draw the card, using the text version:', err.message);
      }

      return await interaction.editReply(ui.edit(
        views.levelView({ member, entry, prog, booster, event, imageName, boosts: { channelMultiplier: verdict.ignored ? 1 : verdict.multiplier } }),
        { files },
      ));
    } catch (err) {
      console.error('[/level]', err);
      return interaction.editReply(ui.edit(ui.notice('Something Went Wrong', 'Tower hit an unexpected error. It has been logged.', { accent: colors.alert })));
    }
  },
};

const colour = {
  data: new SlashCommandBuilder().setName('colour').setDescription('Pick your name colour (unlocks with your level)')
    .setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await handlers.canUseColours(interaction.guild.id, interaction.member))) {
      return interaction.editReply(ui.edit(ui.notice('Not Unlocked Yet',
        `Name colours unlock at level ${L.perkLevel('colours')}, or straight away for server boosters. Keep chatting.`, { icon: 'lock', accent: colors.alert })));
    }
    return interaction.editReply(ui.edit(views.colourMenu()));
  },
};

module.exports = [level, colour];
