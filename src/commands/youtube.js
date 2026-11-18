const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, ChannelType } = require('discord.js');
const ui = require('../ui');
const { colors, youtube } = require('../constants');
const yt = require('../lib/youtube');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const perkSync = require('../modules/levels/perks');
const service = require('../modules/youtube/service');
const poller = require('../modules/youtube/poller');
const views = require('../modules/youtube/views');

const TEXTUAL = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const youtubeCommand = {
  data: new SlashCommandBuilder().setName('youtube').setDescription('Connect your YouTube channel (Administrator and up)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('setup').setDescription('Connect the channel and choose where new uploads are posted')
      .addStringOption((o) => o.setName('youtube').setDescription('Channel link, @handle or channel ID').setRequired(true))
      .addChannelOption((o) => o.setName('post_channel').setDescription('Where uploads are posted (new-videos)').addChannelTypes(...TEXTUAL).setRequired(true))
      .addRoleOption((o) => o.setName('ping_role').setDescription('The role to ping (YouTube Ping)'))
      .addChannelOption((o) => o.setName('insider_channel').setDescription('Where /earlyaccess posts go').addChannelTypes(...TEXTUAL)))
    .addSubcommand((s) => s.setName('style').setDescription('Choose how uploads look')
      .addStringOption((o) => o.setName('look').setDescription('classic plays the video in chat, card shows a big thumbnail').setRequired(true)
        .addChoices({ name: 'Classic: real video player in chat', value: 'classic' }, { name: 'Card: big thumbnail and banner', value: 'card' })))
    .addSubcommand((s) => s.setName('shorts').setDescription('Post Shorts too, or only long videos')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Post Shorts').setRequired(true)))
    .addSubcommand((s) => s.setName('check').setDescription('Look for new uploads right now'))
    .addSubcommand((s) => s.setName('test').setDescription('Post your latest upload as a test, without pinging anyone'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the connection and the last check')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    const reply = (c) => interaction.editReply(ui.edit(c));
    try {
      const ctx = await modActions.contextFor(interaction, 'contentAdmin');
      const { guild } = ctx;

      if (sub === 'setup') {
        const picked = interaction.options.getChannel('post_channel', true);
        const post = await guild.channels.fetch(picked.id).catch(() => null);
        if (!post?.permissionsFor(ctx.botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          throw new modActions.ModError(`Tower cannot view and send messages in ${picked}. Give Tower's role access to that channel.`);
        }
        const input = interaction.options.getString('youtube', true).trim();
        const tip = '\nTip: paste the channel ID (it starts with UC). In YouTube Studio: Settings > Channel > Advanced settings.';
        let channelId; let feed; let noFeed = false;
        try { channelId = await yt.resolveChannelId(input); } catch (err) { throw new modActions.ModError(`${err.message}${tip}`); }
        try {
          feed = await yt.fetchFeed(channelId);
        } catch (err) {
          if (!err.notFound) throw new modActions.ModError(err.message);
          // No feed: either the ID is wrong, or the channel has no public videos yet. The channel page tells which.
          const exists = await yt.channelExists(channelId).catch(() => false);
          if (!exists) throw new modActions.ModError(`YouTube has no channel with the ID \`${channelId}\`. Check it for typos (it is case sensitive and 24 characters long).${tip}`);
          feed = { channelTitle: null, entries: [] };
          noFeed = true;
        }
        await service.saveSettings(guild.id, {
          youtubeChannelId: channelId, channelUrl: yt.channelHomeUrl(input, channelId),
          postChannelId: post.id, pingRoleId: interaction.options.getRole('ping_role')?.id, insiderChannelId: interaction.options.getChannel('insider_channel')?.id,
        });
        for (const e of feed.entries) await service.markSeen(guild.id, e.id, false); // existing videos are never announced
        await service.setPrimed(guild.id);
        return reply(ui.notice('YouTube Connected', noFeed
          ? 'The channel exists, but YouTube has no public upload feed for it yet (usually because it has no public videos). Tower will start posting as soon as the first one appears. Check `/youtube status` after a few minutes.'
          : 'New uploads will be posted automatically.', {
          icon: 'play', accent: colors.teal,
          fields: [
            ['Channel', ui.fmt.bold(feed.channelTitle ?? channelId), 'video'],
            ['Posts Go To', ui.fmt.channel(post.id), 'hash'],
            ['Existing Videos Recorded', ui.fmt.code(feed.entries.length), 'check'],
            ['Checked Every', ui.fmt.code('5 minutes'), 'clock'],
          ],
        }));
      }

      const settings = await service.getSettings(guild.id);
      if (!settings?.youtube_channel_id) throw new modActions.ModError('Run `/youtube setup` first.');

      if (sub === 'style') {
        await service.setStyle(guild.id, interaction.options.getString('look', true));
        return reply(ui.notice('Style Updated', 'The next upload will use the new look. Use `/youtube test` to preview it.', { icon: 'check', accent: colors.teal }));
      }
      if (sub === 'shorts') {
        const on = interaction.options.getBoolean('enabled', true);
        await service.setShorts(guild.id, on);
        return reply(ui.notice('Shorts Updated', on ? 'Shorts will be posted too.' : 'Only long videos will be posted.', { icon: 'check', accent: colors.teal }));
      }
      if (sub === 'check') {
        const result = await poller.pollGuild(interaction.client, settings).catch((err) => { throw new modActions.ModError(err.message); });
        if (result.busy) return reply(ui.notice('Already Checking', 'A check is running right now. Try again in a moment.', { icon: 'clock' }));
        await service.markChecked(guild.id, null);
        return reply(ui.notice('Checked', result.posted ? `Posted ${result.posted} new upload${result.posted === 1 ? '' : 's'}.` : 'No new uploads.', { icon: 'check' }));
      }
      if (sub === 'test') {
        let feed;
        try { feed = await yt.fetchFeed(settings.youtube_channel_id); } catch (err) { throw new modActions.ModError(err.message); }
        const entry = feed.entries.sort((a, b) => b.published - a.published)[0];
        if (!entry) throw new modActions.ModError('The channel has no videos yet.');
        await poller.postEntry(interaction.client, settings, entry, await yt.classify(entry), { ping: false });
        return reply(ui.notice('Test Posted', 'Your latest upload was posted without a ping.', { icon: 'check', accent: colors.teal }));
      }
      return reply(ui.notice('YouTube Status', null, {
        icon: 'info',
        fields: [
          ['Channel ID', ui.fmt.code(settings.youtube_channel_id), 'video'],
          ['Posts Go To', ui.fmt.channel(settings.post_channel_id), 'hash'],
          ['Ping Role', ui.fmt.role(settings.ping_role_id ?? youtube.defaults.pingRoleId), 'bell'],
          ['Style', ui.fmt.bold(settings.style), 'sparkle'],
          ['Shorts', ui.fmt.bold(settings.post_shorts ? 'Posted' : 'Skipped'), 'zap'],
          ['Last Check', settings.last_checked_at ? ui.fmt.time(settings.last_checked_at, 'R') : ui.fmt.code('not yet'), 'clock'],
          ['Last Problem', settings.last_error ? ui.fmt.code(settings.last_error.slice(0, 120)) : ui.fmt.code('none'), 'warning'],
        ],
      }));
    } catch (err) {
      if (err instanceof modActions.ModError) return reply(modViews.denied(err.message));
      console.error(`[/youtube ${sub}]`, err);
      return reply(modViews.denied('Tower hit an unexpected error. It has been logged.', 'Something Went Wrong'));
    }
  },
};

// Only the server owner can post early access.
const earlyAccess = {
  data: new SlashCommandBuilder().setName('earlyaccess').setDescription('Share an early look with Insiders and boosters (owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('title').setDescription('What is it?').setRequired(true).setMaxLength(150))
    .addStringOption((o) => o.setName('link').setDescription('A link to the video (a YouTube link also shows its thumbnail)'))
    .addAttachmentOption((o) => o.setName('clip').setDescription('Or upload a clip or an image'))
    .addStringOption((o) => o.setName('description').setDescription('A line or two about it').setMaxLength(400))
    .addBooleanOption((o) => o.setName('ping').setDescription('Ping the Insider role (default yes)')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild } = interaction;
    const reply = (c) => interaction.editReply(ui.edit(c));
    try {
      if (interaction.user.id !== guild.ownerId) throw new modActions.ModError('Only the server owner can post early access.');
      const link = interaction.options.getString('link')?.trim() || null;
      const upload = interaction.options.getAttachment('clip');
      if (!link && !upload) throw new modActions.ModError('Add a link or upload a clip.');
      if (link && !yt.isHttpUrl(link)) throw new modActions.ModError('The link must start with `https://`.');

      const settings = await service.getSettings(guild.id);
      const channelId = settings?.insider_channel_id ?? youtube.defaults.insiderChannelId;
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) throw new modActions.ModError('Tower cannot find the insider channel. Set it with `/youtube setup`.');

      // The Insider role is created by Tower the first time it is needed, so the ping always has someone to reach.
      const role = interaction.options.getBoolean('ping') === false ? null
        : (perkSync.findRole(guild, 'insider') ?? await perkSync.ensureRole(guild, 'insider').catch(() => null));

      await channel.send(views.buildEarlyAccess({
        title: interaction.options.getString('title', true), description: interaction.options.getString('description'),
        link, insiderRoleId: role?.id,
        clip: upload ? { name: upload.name, url: upload.url, contentType: upload.contentType } : null,
      }));
      return reply(ui.notice('Posted', `Your early access post is live in ${channel}.`, { icon: 'eye', accent: colors.teal }));
    } catch (err) {
      if (err instanceof modActions.ModError) return reply(modViews.denied(err.message));
      if (err.code === 40005) return reply(modViews.denied('That clip is too big for this server\'s upload limit. Share it as a link instead.'));
      if (err.code === 50013 || err.code === 50001) return reply(modViews.denied('Tower cannot post in the insider channel. Check its permissions there.'));
      console.error('[/earlyaccess]', err);
      return reply(modViews.denied('Tower hit an unexpected error. It has been logged.', 'Something Went Wrong'));
    }
  },
};

module.exports = [youtubeCommand, earlyAccess];
