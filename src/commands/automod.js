const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const { colors, automod: cfg } = require('../constants');
const lib = require('../lib/automod');
const { allow } = require('../lib/guard');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const service = require('../modules/automod/service');
const automod = require('../modules/automod');

const { fmt } = ui;
const { ModError } = modActions;
const { LIMITS } = lib;
const reply = (interaction, container) => interaction.editReply(ui.edit(container));
const clone = (x) => JSON.parse(JSON.stringify(x));
const on = (v) => (v ? 'On' : 'Off');

const spamText = (s) => (s.enabled ? `${s.messages} messages in ${s.seconds}s, or ${s.duplicates} repeats in ${s.duplicateSeconds}s` : 'Off');
const linksText = (l) => (l.mode === 'off' ? 'Off' : l.mode === 'invites'
  ? `Other servers' invites${l.exemptLevel ? `, except level ${l.exemptLevel}+` : ''}`
  : `Invites and any link not on the ${l.allowedDomains.length} allowed domains${l.exemptLevel ? `, except level ${l.exemptLevel}+` : ''}`);
const formatText = (f) => (f.enabled ? `Caps ${f.capsPercent}%+ (${f.capsMinLetters}+ letters), over ${f.emojiMax} emoji${f.zalgo ? ', distorted text' : ''}` : 'Off');

async function statusCard(interaction, settings) {
  const [words, warns] = await Promise.all([service.getWords(interaction.guildId), service.recentWarns(interaction.guildId).catch(() => 0)]);
  const c = settings.config;
  const canDelete = interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages);
  const exempt = [...settings.exemptChannels.map(fmt.channel), ...settings.exemptRoles.map(fmt.role)];
  const problems = [];
  if (!canDelete) problems.push('**Tower needs the Manage Messages permission** to remove messages.');
  if (!settings.enabled) problems.push('AutoMod is **off**. Turn it on with `/automod enable`.');
  return ui.notice('AutoMod', problems.join('\n') || 'Every rule below removes the message and gives a warning, which counts toward escalation. Staff are never touched.', {
    icon: 'shield', accent: settings.enabled && canDelete ? colors.teal : colors.cobalt,
    fields: [
      ['Status', fmt.bold(on(settings.enabled)), 'check'],
      ['Spam And Flooding', spamText(c.spam), 'clock'],
      ['Mass Mentions', c.mentions.enabled ? `More than ${c.mentions.max} people or roles` : 'Off', 'bell'],
      ['Links', linksText(c.links), 'link'],
      ['Formatting', formatText(c.formatting), 'sparkle'],
      ['Banned Words', c.words.enabled ? `${words.length} ${words.length === 1 ? 'word' : 'words'}` : 'Off', 'ban'],
      ['Exempt', exempt.length ? exempt.join(' ') : 'No channels or roles', 'lock'],
      ['Warnings In 7 Days', fmt.code(warns), 'warning'],
    ],
  });
}

const optional = (o, name, kind) => (kind === 'bool' ? o.getBoolean(name) : o.getInteger(name));
const changed = (...values) => values.some((v) => v !== null);

const subs = {
  async status(interaction, settings) { return reply(interaction, await statusCard(interaction, settings)); },

  async enable(interaction, settings) {
    settings.enabled = interaction.options.getBoolean('enabled', true);
    await service.saveSettings(interaction.guildId, settings);
    return reply(interaction, await statusCard(interaction, settings));
  },

  async spam(interaction, settings) {
    const o = interaction.options; const s = settings.config.spam;
    const [en, m, sec, dup] = [optional(o, 'enabled', 'bool'), optional(o, 'messages'), optional(o, 'seconds'), optional(o, 'repeats')];
    if (changed(en, m, sec, dup)) {
      if (en !== null) s.enabled = en; if (m !== null) s.messages = m; if (sec !== null) s.seconds = sec; if (dup !== null) s.duplicates = dup;
      await service.saveSettings(interaction.guildId, settings);
    }
    return reply(interaction, await statusCard(interaction, settings));
  },

  async mentions(interaction, settings) {
    const o = interaction.options; const s = settings.config.mentions;
    const [en, max] = [optional(o, 'enabled', 'bool'), optional(o, 'max')];
    if (changed(en, max)) { if (en !== null) s.enabled = en; if (max !== null) s.max = max; await service.saveSettings(interaction.guildId, settings); }
    return reply(interaction, await statusCard(interaction, settings));
  },

  async links(interaction, settings) {
    const o = interaction.options; const s = settings.config.links;
    const mode = o.getString('mode'); const level = optional(o, 'exempt_level');
    if (changed(mode, level)) { if (mode !== null) s.mode = mode; if (level !== null) s.exemptLevel = level; await service.saveSettings(interaction.guildId, settings); }
    return reply(interaction, await statusCard(interaction, settings));
  },

  async formatting(interaction, settings) {
    const o = interaction.options; const s = settings.config.formatting;
    const [en, caps, emoji, zalgo] = [optional(o, 'enabled', 'bool'), optional(o, 'caps_percent'), optional(o, 'emoji_max'), optional(o, 'zalgo', 'bool')];
    if (changed(en, caps, emoji, zalgo)) {
      if (en !== null) s.enabled = en; if (caps !== null) s.capsPercent = caps; if (emoji !== null) s.emojiMax = emoji; if (zalgo !== null) s.zalgo = zalgo;
      await service.saveSettings(interaction.guildId, settings);
    }
    return reply(interaction, await statusCard(interaction, settings));
  },

  async words(interaction, settings) {
    const en = interaction.options.getBoolean('enabled');
    if (en !== null) { settings.config.words.enabled = en; await service.saveSettings(interaction.guildId, settings); }
    return reply(interaction, await statusCard(interaction, settings));
  },

  async test(interaction, settings) {
    const text = interaction.options.getString('text', true);
    const hit = await automod.dryRun(text, settings, await service.getWords(interaction.guildId));
    return reply(interaction, ui.notice(hit ? 'Would Be Removed' : 'Would Be Allowed', hit ? `This would be removed for ${hit.label}, and the person would get a warning.` : 'None of the content rules match. Spam is judged by timing, so it cannot be tested here.', {
      icon: hit ? 'warning' : 'check', accent: hit ? colors.alert : colors.teal,
      fields: [['Rule', hit ? fmt.code(hit.rule) : 'none', 'shield'], ['AutoMod Is', settings.enabled ? 'On' : 'Off (nothing is removed until it is switched on)', 'check']],
    }));
  },
};

async function wordGroup(interaction, sub) {
  const id = interaction.guildId;
  if (sub === 'list') {
    const words = await service.getWords(id);
    return reply(interaction, ui.notice('Banned Words', words.length ? words.map((w) => fmt.code(w)).join('  ').slice(0, 3500) : 'No words yet. Add one with `/automod word add`.', {
      icon: 'ban', fields: [['Total', fmt.code(words.length), 'stats'], ['How They Match', 'Whole words only, even when letters are stretched or swapped for numbers. Use `*word*` to match inside other words.', 'search']],
    }));
  }
  const word = interaction.options.getString('word', true).trim();
  if (sub === 'add') {
    if (word.replace(/\*/g, '').length < 2 || word.length > 60) throw new ModError('A banned word must be between 2 and 60 characters.');
    if ((await service.getWords(id)).length >= cfg.maxWords) throw new ModError(`The list holds at most ${cfg.maxWords} words.`);
    const added = await service.addWord(id, word, interaction.user.id);
    return reply(interaction, ui.notice(added ? 'Word Added' : 'Already On The List', `${fmt.code(word)} ${added ? 'is now banned.' : 'was already banned.'}`, { icon: added ? 'check' : 'warning' }));
  }
  const removed = await service.removeWord(id, word);
  if (!removed) throw new ModError(`${word} is not on the list.`);
  return reply(interaction, ui.notice('Word Removed', `${fmt.code(word)} is allowed again.`, { icon: 'check' }));
}

async function domainGroup(interaction, sub, settings) {
  const links = settings.config.links;
  if (sub === 'list') {
    return reply(interaction, ui.notice('Allowed Domains', `${links.allowedDomains.map((d) => fmt.code(d)).join('  ') || 'None.'}\n\nThese only matter when links are set to **all**. Subdomains are allowed too.`, { icon: 'link' }));
  }
  const domain = lib.cleanDomain(interaction.options.getString('domain', true));
  if (!domain) throw new ModError('That does not look like a domain. Use something like `youtube.com`.');
  if (sub === 'add') {
    if (links.allowedDomains.length >= cfg.maxDomains) throw new ModError(`The list holds at most ${cfg.maxDomains} domains.`);
    if (!links.allowedDomains.includes(domain)) links.allowedDomains.push(domain);
  } else {
    if (!links.allowedDomains.includes(domain)) throw new ModError(`${domain} is not on the list.`);
    links.allowedDomains = links.allowedDomains.filter((d) => d !== domain);
  }
  await service.saveSettings(interaction.guildId, settings);
  return reply(interaction, ui.notice(sub === 'add' ? 'Domain Allowed' : 'Domain Removed', `${fmt.code(domain)} ${sub === 'add' ? 'is allowed in links.' : 'is no longer allowed.'}`, { icon: 'check' }));
}

async function exemptGroup(interaction, sub, settings) {
  const channel = interaction.options.getChannel('channel'); const role = interaction.options.getRole('role');
  if (!channel && !role) throw new ModError('Choose a channel, a role, or both.');
  const toggle = (list, id) => (sub === 'add' ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  if (channel) settings.exemptChannels = toggle(settings.exemptChannels, channel.id);
  if (role) settings.exemptRoles = toggle(settings.exemptRoles, role.id);
  await service.saveSettings(interaction.guildId, settings);
  return reply(interaction, await statusCard(interaction, settings));
}

module.exports = {
  data: new SlashCommandBuilder().setName('automod').setDescription('Automatic moderation: spam, mentions, links, formatting and banned words (Administrator and up)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('status').setDescription('What is on, what each rule allows, and any problems'))
    .addSubcommand((s) => s.setName('enable').setDescription('Switch AutoMod on or off').addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('spam').setDescription('Flooding and repeated messages')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Turn this rule on or off'))
      .addIntegerOption((o) => o.setName('messages').setDescription('Messages that count as flooding').setMinValue(LIMITS.spam.messages[0]).setMaxValue(LIMITS.spam.messages[1]))
      .addIntegerOption((o) => o.setName('seconds').setDescription('...sent within this many seconds').setMinValue(LIMITS.spam.seconds[0]).setMaxValue(LIMITS.spam.seconds[1]))
      .addIntegerOption((o) => o.setName('repeats').setDescription('Identical messages that count as spam').setMinValue(LIMITS.spam.duplicates[0]).setMaxValue(LIMITS.spam.duplicates[1])))
    .addSubcommand((s) => s.setName('mentions').setDescription('Mass mentions')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Turn this rule on or off'))
      .addIntegerOption((o) => o.setName('max').setDescription('The most people and roles one message may mention').setMinValue(LIMITS.mentions.max[0]).setMaxValue(LIMITS.mentions.max[1])))
    .addSubcommand((s) => s.setName('links').setDescription('Invites and links')
      .addStringOption((o) => o.setName('mode').setDescription('What to remove').addChoices({ name: 'Off', value: 'off' }, { name: 'Other servers\' invites only', value: 'invites' }, { name: 'Invites and any link not on the allowed list', value: 'all' }))
      .addIntegerOption((o) => o.setName('exempt_level').setDescription('Members at this level or higher may post links (0 = nobody)').setMinValue(LIMITS.links.exemptLevel[0]).setMaxValue(LIMITS.links.exemptLevel[1])))
    .addSubcommand((s) => s.setName('formatting').setDescription('Capital letters, emoji spam and distorted text')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Turn this rule on or off'))
      .addIntegerOption((o) => o.setName('caps_percent').setDescription('How much of a message may be capitals').setMinValue(LIMITS.formatting.capsPercent[0]).setMaxValue(LIMITS.formatting.capsPercent[1]))
      .addIntegerOption((o) => o.setName('emoji_max').setDescription('The most emoji one message may have').setMinValue(LIMITS.formatting.emojiMax[0]).setMaxValue(LIMITS.formatting.emojiMax[1]))
      .addBooleanOption((o) => o.setName('zalgo').setDescription('Remove distorted "zalgo" text')))
    .addSubcommand((s) => s.setName('words').setDescription('Turn the banned words list on or off').addBooleanOption((o) => o.setName('enabled').setDescription('On or off')))
    .addSubcommand((s) => s.setName('test').setDescription('See what AutoMod would do with some text, without removing anything').addStringOption((o) => o.setName('text').setDescription('The text to check').setRequired(true).setMaxLength(1000)))
    .addSubcommandGroup((g) => g.setName('word').setDescription('The banned words')
      .addSubcommand((s) => s.setName('add').setDescription('Ban a word or phrase (use *word* to match inside words)').addStringOption((o) => o.setName('word').setDescription('The word or phrase').setRequired(true).setMaxLength(60)))
      .addSubcommand((s) => s.setName('remove').setDescription('Allow a word again').addStringOption((o) => o.setName('word').setDescription('The word or phrase').setRequired(true).setMaxLength(60)))
      .addSubcommand((s) => s.setName('list').setDescription('Every banned word')))
    .addSubcommandGroup((g) => g.setName('domain').setDescription('Domains that may be linked when links are set to all')
      .addSubcommand((s) => s.setName('add').setDescription('Allow a domain').addStringOption((o) => o.setName('domain').setDescription('For example youtube.com').setRequired(true).setMaxLength(100)))
      .addSubcommand((s) => s.setName('remove').setDescription('Stop allowing a domain').addStringOption((o) => o.setName('domain').setDescription('For example youtube.com').setRequired(true).setMaxLength(100)))
      .addSubcommand((s) => s.setName('list').setDescription('The allowed domains')))
    .addSubcommandGroup((g) => g.setName('exempt').setDescription('Channels and roles AutoMod ignores')
      .addSubcommand((s) => s.setName('add').setDescription('Ignore a channel, a category or a role')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel or category')).addRoleOption((o) => o.setName('role').setDescription('Role')))
      .addSubcommand((s) => s.setName('remove').setDescription('Stop ignoring a channel, a category or a role')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel or category')).addRoleOption((o) => o.setName('role').setDescription('Role')))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await allow(interaction, 'automodAdmin'))) return null;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    try {
      if (group === 'word') return await wordGroup(interaction, sub);
      const settings = clone(await service.getSettings(interaction.guildId));       // a copy, so nothing changes until it is saved
      if (group === 'domain') return await domainGroup(interaction, sub, settings);
      if (group === 'exempt') return await exemptGroup(interaction, sub, settings);
      return await subs[sub](interaction, settings);
    } catch (err) {
      if (!(err instanceof ModError)) throw err;
      return interaction.editReply(ui.edit(modViews.denied(err.message)));
    }
  },
};
