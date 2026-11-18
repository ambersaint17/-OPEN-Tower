const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, ChannelType } = require('discord.js');
const ui = require('../ui');
const { colors, levels } = require('../constants');
const L = require('../lib/levels');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const logger = require('../modules/logging/logger');
const service = require('../modules/levels/service');
const engine = require('../modules/levels/engine');
const perkSync = require('../modules/levels/perks');
const views = require('../modules/levels/views');

const HOUR = 3_600_000;
const memberOption = (o) => o.setName('user').setDescription('The member').setRequired(true);

const data = new SlashCommandBuilder()
  .setName('levels')
  .setDescription('Manage levels (Administrator and up)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('add').setDescription('Give a member levels')
    .addUserOption(memberOption).addIntegerOption((o) => o.setName('levels').setDescription('How many').setRequired(true).setMinValue(1).setMaxValue(L.MAX_LEVEL)))
  .addSubcommand((s) => s.setName('remove').setDescription('Take levels away from a member')
    .addUserOption(memberOption).addIntegerOption((o) => o.setName('levels').setDescription('How many').setRequired(true).setMinValue(1).setMaxValue(L.MAX_LEVEL)))
  .addSubcommand((s) => s.setName('set').setDescription('Set a member to an exact level')
    .addUserOption(memberOption).addIntegerOption((o) => o.setName('level').setDescription('The level').setRequired(true).setMinValue(0).setMaxValue(L.MAX_LEVEL)))
  .addSubcommand((s) => s.setName('reset').setDescription('Reset a member to zero').addUserOption(memberOption))
  .addSubcommand((s) => s.setName('ignore').setDescription('Stop XP in a channel, category or forum, or for a role')
    .addChannelOption((o) => o.setName('channel').setDescription('A channel, category or forum'))
    .addRoleOption((o) => o.setName('role').setDescription('A role whose members earn no XP')))
  .addSubcommand((s) => s.setName('unignore').setDescription('Allow XP again, even where it is ignored by default')
    .addChannelOption((o) => o.setName('channel').setDescription('A channel, category or forum'))
    .addRoleOption((o) => o.setName('role').setDescription('A role')))
  .addSubcommand((s) => s.setName('multiplier').setDescription('Make a channel or role earn more or less XP (1 clears it)')
    .addNumberOption((o) => o.setName('value').setDescription('For example 1.5').setRequired(true).setMinValue(0.1).setMaxValue(5))
    .addChannelOption((o) => o.setName('channel').setDescription('A channel, category or forum'))
    .addRoleOption((o) => o.setName('role').setDescription('A role')))
  .addSubcommand((s) => s.setName('config').setDescription('Show every level setting in one place'))
  .addSubcommand((s) => s.setName('sync').setDescription('Re-check everyone\'s perk roles (preview first)')
    .addBooleanOption((o) => o.setName('apply').setDescription('Make the changes. Without this it is only a preview'))
    .addBooleanOption((o) => o.setName('remove_extra').setDescription('Also remove perk roles people have not earned')))
  .addSubcommand((s) => s.setName('check').setDescription('Check that perks are gated properly by role permissions')
    .addBooleanOption((o) => o.setName('fix').setDescription('Add missing permissions to the perk roles')))
  .addSubcommand((s) => s.setName('panel').setDescription('Post the levels guide with its menu')
    .addChannelOption((o) => o.setName('channel').setDescription('Usually level-ups').addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .addSubcommandGroup((g) => g.setName('event').setDescription('Double XP weekends and other timed boosts')
    .addSubcommand((s) => s.setName('start').setDescription('Start a timed XP boost')
      .addNumberOption((o) => o.setName('multiplier').setDescription('How much extra XP').setRequired(true)
        .addChoices({ name: '1.5x', value: 1.5 }, { name: '2x (double XP)', value: 2 }, { name: '3x', value: 3 }))
      .addIntegerOption((o) => o.setName('duration').setDescription('How long it lasts').setRequired(true)
        .addChoices({ name: '6 hours', value: 6 * HOUR }, { name: '12 hours', value: 12 * HOUR }, { name: '1 day', value: 24 * HOUR },
          { name: '2 days (a weekend)', value: 48 * HOUR }, { name: '3 days', value: 72 * HOUR }))
      .addChannelOption((o) => o.setName('announce_in').setDescription('Post a notice in this channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('stop').setDescription('End the current boost now'))
    .addSubcommand((s) => s.setName('status').setDescription('Is a boost running?')));

const targetOf = (interaction) => {
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');
  if (!channel && !role) throw new modActions.ModError('Pick a channel, category, forum or role.');
  return { channel, role };
};

async function changeMember(interaction, ctx, sub) {
  const { guild } = ctx;
  const user = interaction.options.getUser('user', true);
  if (user.bot) throw new modActions.ModError('Bots do not have levels.');
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) throw new modActions.ModError('That user is not in this server.');

  const current = await engine.peek(guild.id, user.id);
  const before = { level: current.level, xp: current.xp };
  let result;
  if (sub === 'add') result = await engine.shiftLevels(guild, user.id, interaction.options.getInteger('levels', true), before);
  else if (sub === 'remove') result = await engine.shiftLevels(guild, user.id, -interaction.options.getInteger('levels', true), before);
  else if (sub === 'set') result = await engine.setXp(guild, user.id, L.xpForLevel(interaction.options.getInteger('level', true)));
  else {
    result = await engine.setXp(guild, user.id, 0);
    Object.assign(result.entry, { streak: 0, lastDay: null, dirty: true });
  }

  const after = { level: result.entry.level, xp: result.entry.xp };
  const action = { add: 'Added', remove: 'Removed', set: 'Set', reset: 'Reset' }[sub];
  await logger.log(guild, 'levels', () => views.adminChange({ userId: user.id, before, after, byId: interaction.user.id, action }), {
    actorId: interaction.user.id, targetId: user.id, detail: { action: sub, from: before.level, to: after.level },
  });
  const changes = [...(result.sync?.added.map((n) => `+${n}`) ?? []), ...(result.sync?.removed.map((n) => `-${n}`) ?? [])];
  return ui.notice(`Level ${action}`, `${ui.fmt.user(user.id)} is now level **${after.level}**.`, {
    icon: 'check', accent: colors.teal,
    fields: [
      ['Level', `${ui.fmt.code(before.level)} to ${ui.fmt.code(after.level)}`, 'level_up'],
      ['Perk Roles', changes.length ? changes.map(ui.fmt.code).join(' ') : ui.fmt.code('no change'), 'sparkle'],
    ],
  });
}

async function ruleChange(interaction, ctx, sub) {
  const { guild } = ctx;
  const { channel, role } = targetOf(interaction);
  const state = await engine.configFor(guild);
  const isDefault = (id) => state.defaults.channels.has(id) || state.defaults.categories.has(id);
  const done = [];

  if (sub === 'multiplier') {
    const value = interaction.options.getNumber('value', true);
    for (const [kind, t] of [['channel', channel], ['role', role]]) {
      if (!t) continue;
      if (value === 1) await service.clearRule(guild.id, t.id, ['multiplier']);
      else await service.setRule(guild.id, kind, t.id, 'multiplier', value);
      done.push(`${kind === 'role' ? ui.fmt.role(t.id) : ui.fmt.channel(t.id)} x${value}`);
    }
  } else if (sub === 'ignore') {
    if (channel) { await service.setRule(guild.id, 'channel', channel.id, 'ignore'); done.push(ui.fmt.channel(channel.id)); }
    if (role) { await service.setRule(guild.id, 'role', role.id, 'ignore'); done.push(ui.fmt.role(role.id)); }
  } else {
    if (channel) {
      await service.clearRule(guild.id, channel.id, ['ignore', 'allow']);
      if (isDefault(channel.id)) await service.setRule(guild.id, 'channel', channel.id, 'allow'); // beats the default
      done.push(ui.fmt.channel(channel.id));
    }
    if (role) { await service.clearRule(guild.id, role.id, ['ignore']); done.push(ui.fmt.role(role.id)); }
  }
  await engine.refreshConfig(guild);
  const verb = { ignore: 'now earns no XP', unignore: 'earns XP again', multiplier: 'updated' }[sub];
  return ui.notice('Level Settings Updated', `${done.join(', ')} ${verb}.`, { icon: 'check', accent: colors.teal });
}

async function sync(interaction, ctx) {
  const { guild } = ctx;
  const apply = interaction.options.getBoolean('apply') ?? false;
  const removeExtra = interaction.options.getBoolean('remove_extra') ?? false;
  await engine.flush();
  const [members, xp] = await Promise.all([guild.members.fetch(), service.allXp(guild.id)]);
  const levelOf = (id) => L.levelFromXp(xp.get(id) ?? 0);
  const result = perkSync.previewGuild(guild, members.values(), levelOf, { removeExtra });
  if (apply) {
    for (const member of members.values()) {
      if (member.user.bot) continue;
      await perkSync.syncMember(member, levelOf(member.id), { remove: removeExtra }).catch((err) => console.error('[sync]', err.message));
    }
  }
  return views.syncView({ applied: apply, result });
}

async function check(interaction, ctx) {
  const { guild } = ctx;
  let rows = perkSync.auditGuild(guild);
  if (interaction.options.getBoolean('fix')) {
    for (const r of rows) if (r.role && r.issues.some((i) => i.type === 'role')) await perkSync.fixRolePermissions(r.role, r.key);
    rows = perkSync.auditGuild(guild);
  }
  return views.auditView(rows);
}

async function panel(interaction, ctx) {
  const { guild } = ctx;
  const channel = interaction.options.getChannel('channel', true);
  if (!channel.permissionsFor(ctx.botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    throw new modActions.ModError(`Tower cannot view and send messages in ${channel}.`);
  }
  const settings = await service.getSettings(guild.id);
  let existing = null;
  if (settings?.panel_message_id && settings.panel_channel_id === channel.id) {
    existing = await channel.messages.fetch({ message: settings.panel_message_id, force: true }).catch(() => null);
  }
  let sent = null;
  if (existing) {
    try { sent = await existing.edit(ui.edit(views.guidePanel())); } catch (err) { if (err.code !== 10008) throw err; }
  }
  if (!sent) sent = await channel.send(ui.message(views.guidePanel()));
  await service.savePanel(guild.id, channel.id, sent.id);
  return ui.notice('Guide Posted', `The levels guide is live in ${channel}.`, { icon: 'check', accent: colors.teal });
}

async function event(interaction, ctx) {
  const { guild } = ctx;
  const sub = interaction.options.getSubcommand();
  if (sub === 'status') {
    await engine.loadEvent(guild.id);
    const e = engine.activeEvent(guild.id);
    return ui.notice('XP Event', e ? `**${e.multiplier}x** XP is running until ${ui.fmt.time(e.endsAt, 'F')}.` : 'No event is running.', { icon: 'party' });
  }
  if (sub === 'stop') {
    await service.stopEvents(guild.id);
    await engine.loadEvent(guild.id);
    return views.eventView({ started: false });
  }
  const multiplier = interaction.options.getNumber('multiplier', true);
  const endsAt = new Date(Date.now() + interaction.options.getInteger('duration', true));
  await service.startEvent(guild.id, multiplier, endsAt, interaction.user.id);
  await engine.loadEvent(guild.id);
  const view = views.eventView({ multiplier, endsAt, started: true });
  const announce = interaction.options.getChannel('announce_in');
  if (announce) await announce.send({ ...ui.message(view), allowedMentions: { parse: [] } }).catch(() => {});
  return view;
}

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const reply = (container) => interaction.editReply(ui.edit(container));
  try {
    const ctx = await modActions.contextFor(interaction, 'levelsAdmin');
    if (group === 'event') return await reply(await event(interaction, ctx));
    if (['add', 'remove', 'set', 'reset'].includes(sub)) return await reply(await changeMember(interaction, ctx, sub));
    if (['ignore', 'unignore', 'multiplier'].includes(sub)) return await reply(await ruleChange(interaction, ctx, sub));
    if (sub === 'sync') return await reply(await sync(interaction, ctx));
    if (sub === 'check') return await reply(await check(interaction, ctx));
    if (sub === 'panel') return await reply(await panel(interaction, ctx));
    if (sub === 'config') {
      await engine.loadEvent(ctx.guild.id);
      const state = await engine.refreshConfig(ctx.guild);
      return await reply(views.configView({ state, defaults: state.defaults, event: engine.activeEvent(ctx.guild.id), guild: ctx.guild }));
    }
  } catch (err) {
    if (err instanceof modActions.ModError) return reply(modViews.denied(err.message));
    console.error(`[/levels ${sub}]`, err);
    return reply(modViews.denied('Tower hit an unexpected error. It has been logged.', 'Something Went Wrong'));
  }
  return undefined;
}

module.exports = { data, execute };
