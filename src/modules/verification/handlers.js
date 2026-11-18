const {
  ActionRowBuilder, AttachmentBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const ui = require('../../ui');
const service = require('./service');
const views = require('./views');
const { postLog } = require('../../lib/logging');
const { tiers, verification } = require('../../constants');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionIdFrom = (customId) => {
  const id = customId.split(':')[2];
  return UUID.test(id) ? id : null;
};

const avatarOf = (user) => user.displayAvatarURL({ extension: 'png', size: 256 });

// ---- "Help" button on the public panel ----
async function onHelp(interaction) {
  return interaction.reply(ui.message(views.help(), { ephemeral: true }));
}

// Builds the message edit that shows a (new) captcha.
function challengePayload({ session, png, filename }, note) {
  const file = new AttachmentBuilder(png, { name: filename });
  return ui.edit(views.challenge({ session, filename, note }), { files: [file] });
}

// ---- "Verify" button on the public panel ----
// This is the moment a member is waiting for, so everything slow is kept out of it: the settings are cached, the member
// comes with the interaction (no lookup), the captcha is usually already drawn, and the two database reads run together.
async function onStart(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { guild, user } = interaction;

  const settings = await service.getSettings(guild.id);
  if (!settings?.verification_enabled) return interaction.editReply(ui.edit(views.notEnabled()));

  const member = interaction.member;
  if (member.roles.cache.has(settings.verified_role_id)) return interaction.editReply(ui.edit(views.alreadyVerified()));
  if (settings.raid_mode) return interaction.editReply(ui.edit(views.paused()));

  const [state, challenge] = await Promise.all([service.getState(guild.id, user.id), service.issueChallenge(guild, user)]);
  if (state.lockedUntil && state.lockedUntil.getTime() > Date.now()) {
    await service.deleteSession(guild.id, user.id).catch(() => {});      // a locked member gets no code
    return interaction.editReply(ui.edit(views.locked(state.lockedUntil)));
  }
  return interaction.editReply(challengePayload(challenge));
}

// ---- "New Code" button ----
async function onRefresh(interaction) {
  await interaction.deferUpdate();
  const { guild, user } = interaction;
  const sessionId = sessionIdFrom(interaction.customId);
  const current = sessionId && (await service.getSession(sessionId, user.id));

  if (!current || current.expires_at.getTime() <= Date.now()) {
    return interaction.editReply(ui.edit(views.expired()));
  }
  if (current.refreshes >= verification.maxRefreshes) {
    return interaction.followUp({
      ...ui.message(ui.notice('No New Codes Left', 'You have used all your new codes. Enter the code shown, or wait for it to expire.'), { ephemeral: true }),
    });
  }

  const challenge = await service.issueChallenge(guild, user, { refresh: true });
  return interaction.editReply(challengePayload(challenge));
}

// ---- "Enter Code" button opens the modal ----
async function onEnter(interaction) {
  const sessionId = sessionIdFrom(interaction.customId);
  if (!sessionId) return interaction.reply({ ...ui.message(views.expired(), { ephemeral: true }) });

  const input = new TextInputBuilder()
    .setCustomId('code')
    .setLabel('Enter the characters from the image')
    .setStyle(TextInputStyle.Short)
    .setMinLength(4)
    .setMaxLength(10)
    .setRequired(true);

  const modal = new ModalBuilder()
    .setCustomId(`verify:submit:${sessionId}`)
    .setTitle('Verification')
    .addComponents(new ActionRowBuilder().addComponents(input));

  return interaction.showModal(modal);
}

// ---- modal submit: the actual check ----
async function onSubmit(interaction) {
  const fromMessage = interaction.isFromMessage();
  if (fromMessage) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { guild, user } = interaction;
  const sessionId = sessionIdFrom(interaction.customId);
  const input = interaction.fields.getTextInputValue('code');

  const settings = await service.getSettings(guild.id);
  if (!settings?.verification_enabled) return interaction.editReply(ui.edit(views.notEnabled()));
  if (settings.raid_mode) return interaction.editReply(ui.edit(views.paused()));

  const session = sessionId && (await service.consumeAttempt(sessionId, user.id));
  if (!session) return interaction.editReply(ui.edit(views.expired()));

  const tierNumber = session.tier;
  const tier = tiers[tierNumber];

  // Correct code.
  if (service.codeMatches(guild.id, user.id, input, session)) {
    const member = interaction.member;
    let role;
    try {
      role = await service.grantVerified(member, settings);
    } catch (err) {
      console.error('[verify] could not grant role:', err.message);
      return interaction.editReply(
        ui.edit(ui.notice('Something Went Wrong', 'Your code was correct, but the role could not be assigned. Please contact staff.')),
      );
    }

    const attemptsUsed = tier.attempts - session.attempts_left;
    const [, , verificationId] = await Promise.all([
      service.deleteSession(guild.id, user.id),
      service.clearState(guild.id, user.id),
      service.logEvent({ guildId: guild.id, userId: user.id, type: 'completed', tier: tierNumber, attempts: attemptsUsed }),
    ]);
    // The member is told first. The staff log is posted afterwards, so it never makes anyone wait.
    const done = interaction.editReply(ui.edit(views.success({ verificationId, member, guild })));
    postLog(guild, settings, views.logCompleted({
      userId: user.id, avatarUrl: avatarOf(user), createdAt: user.createdAt, tierNumber,
      attemptsUsed, verifiedRoleId: role.id, verificationId,
    })).catch((err) => console.error('[verify] log:', err.message));
    return done;
  }

  // Wrong code, attempts remain: show a fresh captcha, keep the attempt count.
  if (session.attempts_left > 0) {
    const challenge = await service.issueChallenge(guild, user);
    return interaction.editReply(challengePayload(challenge, 'Incorrect code. Try again.'));
  }

  // Wrong code, out of attempts: strike, cooldown, and removal after repeated strikes.
  await service.deleteSession(guild.id, user.id);
  const strike = await service.registerStrike(guild.id, user.id, tier.cooldownMs);
  const auditId = await service.logEvent({
    guildId: guild.id, userId: user.id, type: 'lockout', tier: tierNumber, attempts: tier.attempts,
    detail: { strikes: strike.strikes },
  });
  await postLog(guild, settings, views.logLockout({
    userId: user.id, avatarUrl: avatarOf(user), tierNumber, strikes: strike.strikes,
    lockedUntil: strike.lockedUntil, auditId,
  }));

  if (strike.strikes >= verification.maxStrikes) {
    let kicked = false;
    try {
      const member = await guild.members.fetch(user.id);
      await member.kick('Tower: repeated failed verification');
      kicked = true;
    } catch (err) {
      console.error('[verify] kick failed:', err.message);
    }
    const kickId = await service.logEvent({
      guildId: guild.id, userId: user.id, type: kicked ? 'kicked' : 'kick_failed', tier: tierNumber,
      detail: { strikes: strike.strikes },
    });
    await postLog(guild, settings, views.logRemoved({
      userId: user.id, avatarUrl: avatarOf(user), strikes: strike.strikes, auditId: kickId, kicked,
    }));
    return interaction.editReply(ui.edit(kicked ? views.removed() : views.locked(strike.lockedUntil)));
  }

  return interaction.editReply(ui.edit(views.locked(strike.lockedUntil)));
}

// Router for every customId that starts with "verify:".
async function handle(interaction) {
  const action = interaction.customId.split(':')[1];
  if (interaction.isButton()) {
    if (action === 'start') return onStart(interaction);
    if (action === 'refresh') return onRefresh(interaction);
    if (action === 'enter') return onEnter(interaction);
    if (action === 'help') return onHelp(interaction);
  }
  if (interaction.isModalSubmit() && action === 'submit') return onSubmit(interaction);
}

module.exports = { handle };
