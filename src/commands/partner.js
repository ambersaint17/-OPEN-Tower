const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const ui = require('../ui');
const modActions = require('../modules/moderation/actions');
const modViews = require('../modules/moderation/views');
const ticketService = require('../modules/tickets/service');
const service = require('../modules/partner/service');
const actions = require('../modules/partner/actions');
const handlers = require('../modules/partner/handlers');

const { ModError } = modActions;

module.exports = {
  data: new SlashCommandBuilder().setName('partner').setDescription('Post a partner\'s advertisement (Administrator and up)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('ping').setDescription('Who to ping (default: nobody)').addChoices({ name: 'No ping', value: 'none' }, { name: '@here', value: 'here' }, { name: '@everyone', value: 'everyone' }))
    .addRoleOption((o) => o.setName('role').setDescription('Ping this role instead'))
    .addUserOption((o) => o.setName('rep').setDescription('The partner\'s representative (default: whoever opened this ticket)'))
    .addAttachmentOption((o) => o.setName('image').setDescription('A picture for the ad (PNG, JPG, GIF or WebP)'))
    .addAttachmentOption((o) => o.setName('image2').setDescription('A second picture'))
    .addAttachmentOption((o) => o.setName('image3').setDescription('A third picture'))
    .addBooleanOption((o) => o.setName('keep_link').setDescription('Keep the invite link in the text as well as the Join button (default: no)'))
    .addStringOption((o) => o.setName('style').setDescription('How the ad looks').addChoices({ name: 'Card with a Join button (default)', value: 'card' }, { name: 'Plain text, exactly as pasted', value: 'plain' })),

  // The form has to open before anything is deferred, so errors here are shown as a normal private reply.
  async execute(interaction) {
    try {
      const ctx = await modActions.contextFor(interaction, 'partnerManage');
      const settings = await service.getSettings(ctx.guild.id);
      await actions.resolveChannel(ctx.guild, settings);               // fail now, not after the ad was pasted
      const ticket = await ticketService.byChannel(interaction.channelId).catch(() => null);
      const role = interaction.options.getRole('role');
      if (role && role.id === ctx.guild.id) throw new ModError('Use the ping option for @everyone.');
      const token = actions.holdForm({
        userId: interaction.user.id, ping: interaction.options.getString('ping') ?? 'none', roleId: role?.id ?? null,
        repId: interaction.options.getUser('rep')?.id ?? ticket?.opener_id ?? null, style: interaction.options.getString('style') ?? 'card', ticketChannelId: ticket?.channel_id ?? null,
        keepLink: interaction.options.getBoolean('keep_link') === true,
        attachments: ['image', 'image2', 'image3'].map((n) => interaction.options.getAttachment(n)).filter(Boolean).map((a) => ({ url: a.url, name: a.name, size: a.size, contentType: a.contentType })),
      });
      return await interaction.showModal(handlers.adModal(token));
    } catch (err) {
      if (!(err instanceof ModError)) throw err;
      return interaction.reply(ui.message(modViews.denied(err.message), { ephemeral: true }));
    }
  },
};
