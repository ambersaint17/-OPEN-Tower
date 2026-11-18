require('dotenv').config();

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'DATABASE_URL', 'CAPTCHA_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  databaseUrl: process.env.DATABASE_URL,
  captchaSecret: process.env.CAPTCHA_SECRET,
  // Optional AI assistant settings. Without a key it stays off and everything else works as normal.
  // AI_API_KEY is preferred; ANTHROPIC_API_KEY is still read, whatever provider the key belongs to.
  aiApiKey: process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || null,
  aiProvider: (process.env.AI_PROVIDER || '').toLowerCase() || null,      // anthropic | openrouter | openai (normally detected from the key)
  aiBaseUrl: (process.env.AI_BASE_URL || '').replace(/\/+$/, '') || null,   // for other OpenAI-compatible services
  aiModel: process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || null,    // the exact model to use
  version: require('../package.json').version,
};
