const { SlashCommandBuilder, InteractionContextType, MessageFlags, ChannelType } = require('discord.js');
const ui = require('../ui');
const { colors, qotd } = require('../constants');
const L = require('../lib/levels');
const { parseOffset } = require('../lib/qotd');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const engine = require('../modules/levels/engine');
const service = require('../modules/qotd/service');
const actions = require('../modules/qotd/actions');
const views = require('../modules/qotd/views');

const data = new SlashCommandBuilder().setName('qotd').setDescription('The question of the day')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('setup').setDescription('Set where and when the daily question is posted')
    .addChannelOption((o) => o.setName('channel').setDescription('The qotd channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addIntegerOption((o) => o.setName('hour').setDescription('Hour, 0 to 23').setRequired(true).setMinValue(0).setMaxValue(23))
    .addIntegerOption((o) => o.setName('minute').setDescription('Minute, 0 to 59').setRequired(true).setMinValue(0).setMaxValue(59))
    .addStringOption((o) => o.setName('timezone').setDescription('Offset from UTC, like +05:30 for India').setRequired(true))
    .addRoleOption((o) => o.setName('ping_role').setDescription('The role to ping (QOTD Ping)'))
    .addChannelOption((o) => o.setName('alert_channel').setDescription('Where staff get queue warnings and suggestions').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) => s.setName('add').setDescription('Add a question to the queue')
    .addStringOption((o) => o.setName('question').setDescription('The question').setRequired(true).setMaxLength(qotd.maxLength))
    .addStringOption((o) => o.setName('type').setDescription('Open answers, or this or that').addChoices({ name: 'Open question', value: 'open' }, { name: 'This or that', value: 'choice' }))
    .addStringOption((o) => o.setName('option_a').setDescription('First choice (this or that)').setMaxLength(80))
    .addStringOption((o) => o.setName('option_b').setDescription('Second choice (this or that)').setMaxLength(80)))
  .addSubcommand((s) => s.setName('list').setDescription('Show the next questions in the queue'))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove a question from the queue')
    .addIntegerOption((o) => o.setName('id').setDescription('The number shown in /qotd list').setRequired(true).setMinValue(1)))
  .addSubcommand((s) => s.setName('now').setDescription('Post the next question right now'))
  .addSubcommand((s) => s.setName('status').setDescription('Show the settings and queue size'))
  .addSubcommand((s) => s.setName('suggest').setDescription('Suggest a question for the community (unlocks at level 8)')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(qotd.maxLength)));

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { guild, member } = interaction;
  const sub = interaction.options.getSubcommand();
  const reply = (c) => interaction.editReply(ui.edit(c));
  const ok = (title, text) => ui.notice(title, text, { icon: 'check', accent: colors.teal });
  try {
    const manager = actions.canManage(guild, member);
    const settings = await service.getSettings(guild.id);

    if (sub === 'suggest') {
      const unlocked = manager || (await engine.peek(guild.id, member.id)).level >= L.perkLevel('qotd');
      if (!unlocked) throw new modActions.ModError(`Question suggestions unlock at level ${L.perkLevel('qotd')}. Keep chatting.`);
      if (!settings?.alert_channel_id) throw new modActions.ModError('Suggestions are not set up yet. Ask staff to set an alert channel.');
      if ((await service.pendingCount(guild.id, member.id)) >= 3) throw new modActions.ModError('You already have 3 suggestions waiting. Give the team a little time.');
      const row = await service.createSuggestion(guild.id, member.id, interaction.options.getString('question', true));
      const channel = await guild.channels.fetch(settings.alert_channel_id).catch(() => null);
      const sent = await channel?.send({ ...ui.message(views.suggestionCard({ id: row.id, userId: member.id, question: row.question })), allowedMentions: { parse: [] } });
      if (sent) await service.setSuggestionMessage(row.id, sent.id);
      return reply(ok('Suggestion Sent', 'Thank you. The team will take a look, and if it is picked it will be credited to you.'));
    }

    if (!manager) throw new modActions.ModError('Only the Community Engagement Team can manage the daily question.');

    if (sub === 'setup') {
      const offset = parseOffset(interaction.options.getString('timezone', true));
      if (offset === null) throw new modActions.ModError('Use a UTC offset like `+05:30`, `-4` or `0`.');
      const channel = interaction.options.getChannel('channel', true);
      await service.saveSettings(guild.id, {
        channelId: channel.id, hour: interaction.options.getInteger('hour', true), minute: interaction.options.getInteger('minute', true),
        offsetMin: offset, pingRoleId: interaction.options.getRole('ping_role')?.id, alertChannelId: interaction.options.getChannel('alert_channel')?.id,
      });
      return reply(views.status({ settings: await service.getSettings(guild.id), queued: await service.queuedCount(guild.id) }));
    }

    if (!settings?.channel_id) throw new modActions.ModError('Run `/qotd setup` first.');

    if (sub === 'add') {
      const kind = interaction.options.getString('type') ?? 'open';
      const a = interaction.options.getString('option_a');
      const b = interaction.options.getString('option_b');
      if (kind === 'choice' && (!a || !b)) throw new modActions.ModError('A this or that question needs both option_a and option_b.');
      const row = await service.addQuestion({ guildId: guild.id, question: interaction.options.getString('question', true), kind, optionA: a, optionB: b, addedBy: member.id });
      return reply(ok('Question Added', `Added as ${ui.fmt.code(`#${row.id}`)}. There are now **${await service.queuedCount(guild.id)}** in the queue.`));
    }
    if (sub === 'list') return reply(views.queueList(await service.queue(guild.id)));
    if (sub === 'remove') {
      const removed = await service.removeQuestion(guild.id, interaction.options.getInteger('id', true));
      if (!removed) throw new modActions.ModError('There is no queued question with that number.');
      return reply(ok('Question Removed', 'It is no longer in the queue.'));
    }
    if (sub === 'now') {
      const posted = await actions.postNext(guild, settings);
      if (!posted) throw new modActions.ModError('The queue is empty. Add a question first.');
      return reply(ok('Posted', `Question #${posted.number} is live, with its thread.`));
    }
    return reply(views.status({ settings, queued: await service.queuedCount(guild.id) }));
  } catch (err) {
    if (err instanceof modActions.ModError) return reply(modViews.denied(err.message));
    console.error(`[/qotd ${sub}]`, err);
    return reply(modViews.denied('Tower hit an unexpected error. It has been logged.', 'Something Went Wrong'));
  }
}

module.exports = { data, execute };
