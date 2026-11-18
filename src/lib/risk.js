const { verification } = require('../constants');

// Accounts under 7 days get the hardest captcha (tier 3).
// Accounts under 30 days, or with no custom avatar, get tier 2. Everyone else tier 1.
function assessAccount(user, now = Date.now()) {
  const ageMs = now - user.createdTimestamp;
  const factors = [];
  let tier = 1;

  if (ageMs < verification.highRiskAccountAgeMs) {
    tier = 3;
    factors.push('Account under 7 days old');
  } else if (ageMs < verification.elevatedAccountAgeMs) {
    tier = Math.max(tier, 2);
    factors.push('Account under 30 days old');
  }

  if (!user.avatar) {
    tier = Math.max(tier, 2);
    factors.push('No custom avatar');
  }

  return { tier, ageMs, factors };
}

module.exports = { assessAccount };
