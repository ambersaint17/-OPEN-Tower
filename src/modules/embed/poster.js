const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const modActions = require('../moderation/actions');
const render = require('./render');
const service = require('./service');

const HOOK_NAME = 'Tower Embeds';
const POSTABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const PERM_NAMES = new Map([
  [P.ViewChannel, 'View Channel'], [P.SendMessages, 'Send Messages'], [P.AttachFiles, 'Attach Files'], [P.ManageWebhooks, 'Manage Webhooks'],
]);

const isWebhookPost = (draft) => Boolean(draft.identity?.name);

function checkChannel(guild, channel, { webhook, files }) {
  if (!channel || !POSTABLE.includes(channel.type)) throw new modActions.ModError('Pick a text or announcement channel.');
  const need = [P.ViewChannel, P.SendMessages];
  if (files) need.push(P.AttachFiles);
  if (webhook) need.push(P.ManageWebhooks);
  const have = channel.permissionsFor(guild.members.me);
  const missing = need.filter((p) => !have?.has(p)).map((p) => PERM_NAMES.get(p));
  if (missing.length) throw new modActions.ModError(`Tower is missing ${missing.join(' and ')} in ${channel}. Fix that and try again.`);
}

function assertBuilt(built) {
  if (built.missing.length) {
    throw new modActions.ModError(`Some uploaded pictures or files are no longer available (${built.missing.join(', ')}). Upload them again with \`/embed upload\`, or remove those blocks.`);
  }
}

// Friendly text for the Discord errors a post can run into.
function explain(err) {
  if (err instanceof modActions.ModError) return err.message;
  if (err.code === 40005) return 'A file is too big for this server\'s upload limit. Use a smaller file, or a link instead.';
  if (err.code === 50013 || err.code === 50001) return 'Tower does not have permission to do that in that channel.';
  if (err.code === 10008) return 'That message no longer exists.';
  if (err.code === 50035) return `Discord rejected the message layout.\n${String(err.message).slice(0, 400)}`;
  return null;
}

async function webhookFor(channel, client) {
  const hooks = await channel.fetchWebhooks();
  return hooks.find((h) => h.applicationId === client.user.id && h.name === HOOK_NAME)
    ?? channel.createWebhook({ name: HOOK_NAME, reason: 'Tower /embed posts with a custom name and avatar' });
}

// Posts the session's embed as a brand new message. Returns { message, via }.
async function post(session, channel, client) {
  const { guild } = channel;
  const draft = session.draft;
  const built = render.build(draft, { uploads: session.uploads });
  assertBuilt(built);
  const webhook = isWebhookPost(draft);
  checkChannel(guild, channel, { webhook, files: built.files.length > 0 });

  const payload = { components: built.components, flags: built.flags, files: built.files, allowedMentions: built.allowedMentions };
  let message;
  if (webhook) {
    const hook = await webhookFor(channel, client);
    message = await hook.send({ ...payload, username: draft.identity.name, avatarURL: draft.identity.avatar || undefined, withComponents: true });
  } else {
    message = await channel.send(payload);
  }
  const via = webhook ? 'webhook' : 'tower';
  await service.recordPost({ guildId: guild.id, channelId: channel.id, messageId: message.id, via, draft, userId: session.userId });
  return { message, via };
}

// Rewrites the message the session is editing. A webhook message keeps the name and picture it was posted with.
async function update(session, guild, client) {
  const { channelId, messageId } = session.target;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  const message = await channel?.messages?.fetch(messageId).catch(() => null);
  if (!message) throw new modActions.ModError('That message no longer exists, so there is nothing to update. Use Post as new instead.');

  const built = render.build(session.draft, { uploads: session.uploads, retained: session.retained, retainedOk: true });
  assertBuilt(built);
  checkChannel(guild, channel, { webhook: false, files: built.files.length > 0 });
  const attachments = [...message.attachments.values()].filter((a) => built.keep.includes(a.name));
  const payload = { components: built.components, flags: built.flags, files: built.files, attachments, allowedMentions: built.allowedMentions };

  if (message.webhookId) {
    const hook = await message.fetchWebhook().catch(() => null);
    if (!hook || hook.applicationId !== client.user.id) throw new modActions.ModError('That message was sent by a webhook Tower does not own, so Tower cannot edit it.');
    await hook.editMessage(message.id, payload);
  } else {
    await message.edit(payload);
  }
  await service.updatePost(channelId, messageId, session.draft);
  return { message, channel };
}

const jumpUrl = (guildId, channelId, messageId) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

module.exports = { post, update, explain, checkChannel, isWebhookPost, jumpUrl, POSTABLE, HOOK_NAME };
