const ui = require('../../ui');

// A private message when someone levels up, with a button to switch these off.
// views is loaded here, not at the top, to avoid a circular import with the engine.
async function levelUp(member, from, to, entry) {
  if (entry.dm === false) return;
  const views = require('./views');
  await member.user.send(ui.message(views.levelUpDm({
    guildId: member.guild.id, guildName: member.guild.name, from, to, entry,
  }))).catch(() => {}); // closed DMs are fine
}

module.exports = { levelUp };
