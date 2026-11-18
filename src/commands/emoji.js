const fs = require('node:fs');
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const { allow } = require('../lib/guard');
const emojis = require('../emojis');
const { colors } = require('../constants');

const data = new SlashCommandBuilder()
  .setName('emoji')
  .setDescription('Manage the Tower emoji pack')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('status').setDescription('Show emoji counts and free server slots'))
  .addSubcommand((s) => s.setName('sync').setDescription('Add the Tower emoji pack to this server'));

const reply = (interaction, container) => interaction.editReply(ui.edit(container));
const list = (names) => (names.length ? names.map((n) => `\`${n}\``).join(' ') : '`none`');

async function status(interaction) {
  const { guild } = interaction;
  const existing = await guild.emojis.fetch();
  const limit = emojis.serverEmojiLimit(guild.premiumTier);
  const used = existing.filter((x) => !x.animated).size;
  const ours = existing.filter((x) => x.name.startsWith(emojis.PREFIX)).size;
  return reply(interaction, ui.notice('Emoji Status', null, {
    icon: 'star',
    fields: [
      ['Tower Emojis Loaded', ui.fmt.code(`${emojis.loadedCount()}/${emojis.UI_KEYS.length}`), 'check'],
      ['Server Slots Used', ui.fmt.code(`${used}/${limit}`), 'hash'],
      ['Tower Emojis In Server', ui.fmt.code(`${ours}/${emojis.SERVER_KEYS.length}`), 'verified'],
    ],
  }));
}

async function sync(interaction) {
  const { guild } = interaction;
  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.CreateGuildExpressions)) {
    return reply(interaction, ui.notice('Missing Permission',
      'Tower needs the **Create Expressions** permission. Turn it on for Tower\'s role in Server Settings > Roles, then run this again.',
      { accent: colors.alert, icon: 'warning' }));
  }

  const existing = await guild.emojis.fetch();
  const limit = emojis.serverEmojiLimit(guild.premiumTier);
  let free = limit - existing.filter((x) => !x.animated).size;

  const added = [];
  const present = [];
  const noSpace = [];
  const failed = [];

  for (const key of emojis.SERVER_KEYS) {
    const name = emojis.nameFor(key);
    if (existing.some((x) => x.name === name)) { present.push(key); continue; }
    if (free <= 0) { noSpace.push(key); continue; }
    if (!fs.existsSync(emojis.fileFor(key))) { failed.push(key); continue; }
    try {
      await guild.emojis.create({ attachment: emojis.fileFor(key), name, reason: 'Tower emoji pack' });
      added.push(key);
      free--;
    } catch (err) {
      console.error(`[emoji] could not add ${name}:`, err.message);
      failed.push(key);
    }
  }

  return reply(interaction, ui.notice('Emoji Sync Complete',
    noSpace.length ? 'The server ran out of emoji slots. Remove unused emojis or boost the server, then run sync again.' : null,
    {
      icon: 'star',
      fields: [
        ['Added', ui.fmt.code(added.length), 'check'],
        ['Already There', ui.fmt.code(present.length), 'verified'],
        ['No Free Slots', noSpace.length ? list(noSpace.slice(0, 12)) + (noSpace.length > 12 ? ` +${noSpace.length - 12} more` : '') : ui.fmt.code(0), 'warning'],
        ['Failed', ui.fmt.code(failed.length), 'cross'],
        ['Slots Left', ui.fmt.code(Math.max(free, 0)), 'hash'],
      ],
    }));
}

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await allow(interaction, 'emojiAdmin'))) return null;
  try {
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') return await status(interaction);
    if (sub === 'sync') return await sync(interaction);
  } catch (err) {
    console.error('[/emoji]', err);
    return reply(interaction, ui.notice('Something Went Wrong', 'Tower hit an unexpected error. It has been logged.', { accent: colors.alert }));
  }
}

module.exports = { data, execute };
