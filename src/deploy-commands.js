const { REST, Routes } = require('discord.js');
const config = require('./config');
const { json } = require('./commands');

(async () => {
  const rest = new REST().setToken(config.token);
  const body = json();
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body });
  console.log(`Registered ${body.length} command(s) ${config.guildId ? `to guild ${config.guildId}` : 'globally'}.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
