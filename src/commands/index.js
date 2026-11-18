const fs = require('node:fs');
const path = require('node:path');

// Every .js file in this folder may export one command or an array of them.
// Adding a command file is all it takes: registration and routing pick it up.
const commands = new Map();
for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
  for (const command of [].concat(require(path.join(__dirname, file)))) {
    commands.set(command.data.name, command);
  }
}

const json = () => [...commands.values()].map((c) => c.data.toJSON());

module.exports = { commands, json };
