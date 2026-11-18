const { MessageCache } = require('./messageCache');
const { logging } = require('../../constants');

// One shared cache for every message event.
module.exports = { messageCache: new MessageCache(logging.messageCache) };
