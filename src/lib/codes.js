const crypto = require('node:crypto');

// No I, L, O, S, Z, B, 0, 1, 2, 5, 8 : the usual look-alikes are left out on purpose.
const CHARSET = 'ACDEFGHJKMNPRTUVWXY34679';

function generateCode(length) {
  let out = '';
  for (let i = 0; i < length; i++) out += CHARSET[crypto.randomInt(CHARSET.length)];
  return out;
}

function normalize(input) {
  return String(input).trim().toUpperCase().replace(/[\s-]/g, '');
}

function hashCode(secret, guildId, userId, code) {
  return crypto.createHmac('sha256', secret).update(`${guildId}:${userId}:${code}`).digest('hex');
}

function matches(secret, guildId, userId, input, storedHash) {
  const candidate = Buffer.from(hashCode(secret, guildId, userId, normalize(input)), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

module.exports = { CHARSET, generateCode, normalize, hashCode, matches };
