const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const config = require('../config');
const { ai, tickets, colors } = require('../constants');
const lib = require('../lib/ai');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const ticketActions = require('../modules/tickets/actions');
const service = require('../modules/ai/service');
const aiActions = require('../modules/ai/actions');
const claude = require('../modules/ai/claude');
const pool = require('../modules/ai/pool');
const handlers = require('../modules/ai/handlers');
const views = require('../modules/ai/views');

const { fmt } = ui;
const { ModError } = modActions;
const reply = (interaction, container) => interaction.editReply(ui.edit(container));
const typeChoices = Object.entries(tickets.types).map(([value, t]) => ({ name: t.label, value }));
const labelsOf = (keys) => keys.filter((k) => tickets.types[k]).map((k) => tickets.types[k].label);

async function status(interaction, ctx) {
  const [settings, knowledge, usage, ratings] = await Promise.all([
    service.settingsOrDefault(ctx.guild.id), service.listKnowledge(ctx.guild.id), service.usageFor(ctx.guild.id, lib.dayKey(), interaction.user.id), service.ratingStats(ctx.guild.id),
  ]);
  return reply(interaction, views.statusCard({ settings, keyPresent: Boolean(config.aiApiKey), knowledge, usage, ratings, ticketLabels: labelsOf(settings.ticket_types),
    engine: { provider: claude.providerNow(), models: pool.snapshot(ctx.guild.id, aiActions.modelsFor(settings)) } }));
}

const subs = {
  async settings(interaction, ctx) {
    const o = interaction.options;
    const current = await service.settingsOrDefault(ctx.guild.id);
    const next = { ...current };
    if (o.getBoolean('enabled') !== null) next.enabled = o.getBoolean('enabled');
    if (o.getString('model')) next.model = o.getString('model');
    if (o.getInteger('user_limit') !== null) next.user_daily_limit = o.getInteger('user_limit');
    if (o.getInteger('daily_tokens') !== null) next.daily_token_budget = o.getInteger('daily_tokens');
    if (o.getString('model_id') !== null) {
      const raw = o.getString('model_id').trim();
      if (raw.toLowerCase() === 'clear') next.model_id = '';
      else if (lib.validModelId(raw)) next.model_id = lib.validModelId(raw);
      else throw new ModError('That does not look like a model ID. Copy it from the model page, for example `provider/model-name:free`. Type `clear` to go back to the default.');
    }
    if (o.getString('backup_models') !== null) {
      const parsed = lib.parseModelList(o.getString('backup_models'));
      if (parsed.error) throw new ModError(parsed.error);
      next.backup_models = parsed.ids;
    }
    if (o.getString('instructions') !== null) next.instructions = o.getString('instructions').trim().toLowerCase() === 'clear' ? '' : o.getString('instructions').trim();
    if (next.enabled && !config.aiApiKey) throw new ModError('There is no API key yet. Add `AI_API_KEY` to the host settings and restart Tower, then switch the assistant on.');
    await service.saveSettings(ctx.guild.id, next);
    return status(interaction, ctx);
  },

  status,

  // Sends one tiny message to the model, so a wrong key, model or credit problem shows up straight away.
  async test(interaction, ctx) {
    const settings = await service.settingsOrDefault(ctx.guild.id);
    if (!config.aiApiKey) throw new ModError('There is no API key yet. Add `AI_API_KEY` to the host settings and restart Tower.');
    const models = aiActions.modelsFor(settings);
    const results = [];
    for (const model of models) {
      const started = Date.now();
      try {
        const out = await claude.complete({
          model, maxTokens: 30, system: [{ text: 'You are a connection test.', cache: false }],
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        });
        results.push({ model, ok: true, text: `${((Date.now() - started) / 1000).toFixed(1)}s, said ${fmt.code(out.text.slice(0, 30))}` });
      } catch (err) {
        if (!(err instanceof claude.AiError)) throw err;
        results.push({ model, ok: false, text: err.message });
      }
    }
    const working = results.filter((r) => r.ok).length;
    const lines = results.map((r, i) => `${r.ok ? '✅' : '❌'} ${i === 0 ? '**Main**' : '**Backup**'} ${fmt.code(r.model ?? 'not set')}\n${r.text}`).join('\n\n');
    const hint = results.some((r) => !r.ok && /nothing to say/.test(r.text)) ? '\n\nSome "thinking" models reply with nothing. Pick a normal chat model.' : '';
    return reply(interaction, ui.notice(working === results.length ? 'Connection Works' : working ? 'Some Models Work' : 'Connection Failed', `${lines}${hint}`, {
      icon: working ? 'check' : 'warning', accent: working === results.length ? colors.teal : colors.alert, fields: [['Service', fmt.code(claude.providerNow()), 'link']],
    }));
  },

  async tickets(interaction, ctx) {
    const type = interaction.options.getString('type', true);
    const enabled = interaction.options.getBoolean('enabled', true);
    const settings = await service.settingsOrDefault(ctx.guild.id);
    const set = new Set(settings.ticket_types);
    if (enabled) set.add(type); else set.delete(type);
    await service.saveSettings(ctx.guild.id, { ...settings, ticket_types: [...set] });
    const cfg = tickets.types[type];
    const sensitive = cfg.minLevel >= 4 ? '\n\nThese tickets are private to the owner or administrators. What is written in them will be sent to the AI provider to answer. Only keep this on if you are comfortable with that, and tell members.' : '';
    return reply(interaction, ui.notice(enabled ? 'AI Helps In These Tickets' : 'AI Switched Off For These Tickets',
      `${fmt.bold(cfg.label)} tickets: ${enabled ? 'the assistant gives a first answer and can answer the member until staff join in' : 'the assistant stays out'}.${enabled ? sensitive : ''}`,
      { icon: enabled ? 'check' : 'cross', fields: [['Now Enabled For', labelsOf([...set]).join(', ') || 'no ticket types', 'ticket']] }));
  },

  async log(interaction, ctx) {
    return reply(interaction, views.logCard(await service.recentLog(ctx.guild.id, 10)));
  },

  async summarize(interaction, ctx) {
    const ticket = await ticketActions.ticketHere(interaction);
    const settings = await service.settingsOrDefault(ctx.guild.id);
    if (!settings.ticket_types.includes(ticket.type)) throw new ModError(`The assistant is not switched on for ${tickets.types[ticket.type]?.label ?? 'this kind of'} tickets. An administrator can enable it with \`/ai tickets\`.`);
    const { messages } = await ticketActions.collectMessages(interaction.channel);
    const lines = messages.filter((m) => !m.bot && m.content?.trim()).slice(-ai.summaryMaxMessages).map((m) => `${m.authorTag}: ${m.content.replace(/\s+/g, ' ').trim()}`);
    const transcript = [`Type: ${tickets.types[ticket.type]?.label}`, `Subject: ${ticket.subject ?? ''}`, `Form details: ${ticket.form?.details ?? ''}`, '', ...lines].join('\n').slice(-ai.summaryMaxChars);
    const text = await aiActions.summarise({ guild: ctx.guild, userId: interaction.user.id, transcript });
    return reply(interaction, ui.notice('Ticket Summary', `${text}\n\n${views.NOTE}`, { icon: 'scroll' }));
  },
};

async function knowledge(interaction, ctx, sub) {
  const guildId = ctx.guild.id;
  if (sub === 'list') return reply(interaction, views.knowledgeList(await service.listKnowledge(guildId)));
  const title = interaction.options.getString('title');
  if (sub === 'view') {
    const entry = await service.getKnowledge(guildId, title);
    if (!entry) throw new ModError(`There is no entry called "${title}".`);
    return reply(interaction, ui.notice(entry.title, entry.content.slice(0, 3500), { icon: 'scroll' }));
  }
  if (sub === 'remove') {
    if (!(await service.deleteKnowledge(guildId, title))) throw new ModError(`There is no entry called "${title}".`);
    return reply(interaction, ui.notice('Entry Removed', `**${title}** was removed. The assistant no longer knows it.`, { icon: 'trash' }));
  }
  if (sub === 'upload') {
    const file = interaction.options.getAttachment('file', true);
    if (!/\.(txt|md|markdown|csv)$/i.test(file.name) && !/^text\//.test(file.contentType ?? '')) throw new ModError('Upload a plain text file (.txt or .md).');
    if (file.size > 150_000) throw new ModError('That file is too large. Keep it under 150 KB, or split it.');
    const res = await fetch(file.url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new ModError('Discord would not hand over that file. Try uploading it again.');
    const parts = lib.splitText(await res.text());
    if (!parts.length) throw new ModError('That file is empty.');
    const base = (interaction.options.getString('title') ?? file.name.replace(/\.[^.]+$/, '')).trim().slice(0, 70);
    for (const [i, part] of parts.entries()) {
      await handlers.storeKnowledge({ guildId, userId: interaction.user.id, title: parts.length > 1 ? `${base} (${i + 1}/${parts.length})` : base, content: part });
    }
    return reply(interaction, ui.notice('File Imported', `Saved **${base}** as ${parts.length} ${parts.length === 1 ? 'entry' : 'entries'}.`, { icon: 'check' }));
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder().setName('ai').setDescription('Manage the AI assistant (Administrator and up)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('status').setDescription('Is it on, what does it know, how much was used today'))
    .addSubcommand((s) => s.setName('test').setDescription('Check that the key and model work'))
    .addSubcommand((s) => s.setName('settings').setDescription('Switch it on or off and set its limits')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the assistant on or off'))
      .addStringOption((o) => o.setName('model').setDescription('Anthropic keys only: fast and cheap, or smarter (other services use AI_MODEL)').addChoices({ name: 'Haiku (fast, cheap)', value: 'haiku' }, { name: 'Sonnet (smarter)', value: 'sonnet' }))
      .addIntegerOption((o) => o.setName('user_limit').setDescription('Questions per member per day').setMinValue(1).setMaxValue(500))
      .addIntegerOption((o) => o.setName('daily_tokens').setDescription('Whole-server limit per day, in tokens').setMinValue(10_000).setMaxValue(10_000_000))
      .addStringOption((o) => o.setName('model_id').setDescription('The exact model ID, e.g. provider/model-name:free. Type clear to reset.').setMaxLength(120))
      .addStringOption((o) => o.setName('backup_models').setDescription('Up to 3 backup model IDs, used when the main one runs out. Type clear to remove.').setMaxLength(400))
      .addStringOption((o) => o.setName('instructions').setDescription('Tone and extra rules. Type clear to remove them.').setMaxLength(1500)))
    .addSubcommandGroup((g) => g.setName('knowledge').setDescription('What the assistant knows')
      .addSubcommand((s) => s.setName('add').setDescription('Add something it should know'))
      .addSubcommand((s) => s.setName('edit').setDescription('Change an entry').addStringOption((o) => o.setName('title').setDescription('Which entry').setRequired(true).setAutocomplete(true)))
      .addSubcommand((s) => s.setName('view').setDescription('Read an entry').addStringOption((o) => o.setName('title').setDescription('Which entry').setRequired(true).setAutocomplete(true)))
      .addSubcommand((s) => s.setName('remove').setDescription('Delete an entry').addStringOption((o) => o.setName('title').setDescription('Which entry').setRequired(true).setAutocomplete(true)))
      .addSubcommand((s) => s.setName('list').setDescription('Everything it knows'))
      .addSubcommand((s) => s.setName('upload').setDescription('Import a .txt or .md file')
        .addAttachmentOption((o) => o.setName('file').setDescription('The text file').setRequired(true))
        .addStringOption((o) => o.setName('title').setDescription('Name for the entry (default: the file name)').setMaxLength(70))))
    .addSubcommand((s) => s.setName('tickets').setDescription('Choose which ticket types the assistant helps in')
      .addStringOption((o) => o.setName('type').setDescription('Ticket type').setRequired(true).addChoices(...typeChoices))
      .addBooleanOption((o) => o.setName('enabled').setDescription('Help in these tickets?').setRequired(true)))
    .addSubcommand((s) => s.setName('log').setDescription('Recent questions and how they were rated'))
    .addSubcommand((s) => s.setName('summarize').setDescription('Summarise this ticket for staff (inside a ticket)')),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const modal = group === 'knowledge' && (sub === 'add' || sub === 'edit');
    // Forms must open before anything is deferred.
    if (!modal) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const ctx = await modActions.contextFor(interaction, sub === 'summarize' ? 'aiSummarize' : 'aiAdmin');
      if (modal) {
        if (sub === 'add') return await interaction.showModal(handlers.knowledgeModal(null));
        const entry = await service.getKnowledge(ctx.guild.id, interaction.options.getString('title', true));
        if (!entry) throw new ModError('There is no entry with that title.');
        return await interaction.showModal(handlers.knowledgeModal(entry));
      }
      return await (group === 'knowledge' ? knowledge(interaction, ctx, sub) : subs[sub](interaction, ctx));
    } catch (err) {
      const known = err instanceof ModError || err instanceof claude.AiError;
      if (!known) throw err;
      const card = modViews.denied(err.message);
      return interaction.deferred || interaction.replied ? interaction.editReply(ui.edit(card)) : interaction.reply(ui.message(card, { ephemeral: true }));
    }
  },

  async autocomplete(interaction) {
    try {
      const typed = interaction.options.getFocused().toLowerCase();
      const rows = await service.listKnowledge(interaction.guildId);
      await interaction.respond(rows.filter((r) => r.title.toLowerCase().includes(typed)).slice(0, 25).map((r) => ({ name: r.title.slice(0, 100), value: r.title })));
    } catch {
      await interaction.respond([]).catch(() => {});
    }
  },
};
