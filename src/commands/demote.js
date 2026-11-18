const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { ModError } = require('../modules/moderation/actions');
const actions = require('../modules/staff/actions');
const views = require('../modules/staff/views');
const { run, reply } = require('../modules/staff/command');

const TEXT = {
  promote: 'Promote someone to the next rank of their staff team',
  demote: 'Move someone down to the previous rank of their staff team',
  remove: 'Take someone off their staff team',
};

module.exports = {
  data: new SlashCommandBuilder().setName('demote').setDescription(TEXT.demote)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('member').setDescription('The staff member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why (they see it, and it goes in the staff log)').setMaxLength(400))
    .addBooleanOption((o) => o.setName('notify').setDescription('Tell them by DM (default: yes)')),

  async execute(interaction) {
    return run(interaction, async (actor) => {
      const target = interaction.options.getMember('member');
      if (!target) throw new ModError('That person is not in the server.');
      const result = await actions.change({
        client: interaction.client, guild: interaction.guild, actor, target, action: 'demote',
        reason: interaction.options.getString('reason') ?? '', notify: interaction.options.getBoolean('notify') !== false,
      });
      return reply(interaction, views.changeDone({ action: 'demote', userId: target.id, ...result, applied: result.applied }));
    });
  },
};
