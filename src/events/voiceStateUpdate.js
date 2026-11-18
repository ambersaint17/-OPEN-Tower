const { Events } = require('discord.js');
const { log } = require('../modules/logging/logger');
const views = require('../modules/logging/views');
const { fmt } = require('../ui');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    if (oldState.channelId === newState.channelId) return; // mute, deafen and stream changes are ignored
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    let title, icon, fields;
    if (!oldState.channelId) {
      [title, icon, fields] = ['Joined Voice', 'headphones', [['Channel', fmt.channel(newState.channelId), 'mic']]];
    } else if (!newState.channelId) {
      [title, icon, fields] = ['Left Voice', 'leave', [['Channel', fmt.channel(oldState.channelId), 'mic']]];
    } else {
      [title, icon, fields] = ['Moved Voice Channel', 'arrow_right', [
        ['From', fmt.channel(oldState.channelId), 'mic'],
        ['To', fmt.channel(newState.channelId), 'mic'],
      ]];
    }

    await log(newState.guild, 'voice', (id) => views.entry({
      id, icon, title,
      thumbnail: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
      fields: [['Member', views.tag(member.user), 'user'], ...fields],
    }), { targetId: member.id, detail: { from: oldState.channelId, to: newState.channelId } });
  },
};
