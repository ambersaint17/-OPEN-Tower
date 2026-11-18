const ui = require('../../ui');
const { qotd } = require('../../constants');
const { threadName, isManager } = require('../../lib/qotd');
const { levelOf } = require('../tickets/actions');
const service = require('./service');
const views = require('./views');

const canManage = (guild, member) =>
  isManager([...member.roles.cache.values()].map((r) => r.name), levelOf(guild, member));

const sendAlert = async (guild, settings, container) => {
  if (!settings.alert_channel_id) return;
  const ch = await guild.channels.fetch(settings.alert_channel_id).catch(() => null);
  await ch?.send({ ...ui.message(container), allowedMentions: { parse: [] } }).catch(() => {});
};

// Posts the next question, opens its thread, and locks yesterday's thread.
async function postNext(guild, settings) {
  const question = await service.nextQuestion(guild.id);
  if (!question) { await sendAlert(guild, settings, views.empty()); return null; }

  const channel = await guild.channels.fetch(settings.channel_id).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('The question channel no longer exists, or Tower cannot see it.');

  if (settings.last_thread_id) {
    const old = await guild.channels.fetch(settings.last_thread_id).catch(() => null);
    if (old?.isThread()) { await old.setLocked(true).catch(() => {}); await old.setArchived(true).catch(() => {}); }
  }

  const number = await service.nextNumber(guild.id);
  const message = await channel.send({
    ...ui.message(views.questionCard({
      number, question: question.question, kind: question.kind, optionA: question.option_a, optionB: question.option_b,
      pingRoleId: settings.ping_role_id, suggestedBy: question.suggested_by,
    })),
    allowedMentions: { roles: settings.ping_role_id ? [settings.ping_role_id] : [] },
  });
  const thread = await message.startThread({ name: threadName(number, question.question), autoArchiveDuration: qotd.archiveMinutes });
  if (question.kind === 'choice') { await message.react('\uD83C\uDD70\uFE0F').catch(() => {}); await message.react('\uD83C\uDD71\uFE0F').catch(() => {}); }

  await service.markPosted(question.id, number, message.id, thread.id);
  await service.setLastThread(guild.id, thread.id);
  const left = await service.queuedCount(guild.id);
  if (left < qotd.lowQueue) await sendAlert(guild, settings, views.lowQueue(left));
  return { number, message, thread };
}

module.exports = { canManage, postNext, sendAlert };
