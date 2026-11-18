const { logging } = require('../../constants');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Finds the audit-log entry that caused an event: right type, right target, very recent.
// Discord writes audit entries a moment after the event, hence the short delay first.
async function findAudit(guild, type, { targetId, channelId, delay = true } = {}) {
  try {
    if (delay) await sleep(logging.auditDelayMs);
    const logs = await guild.fetchAuditLogs({ type, limit: 8 });
    const now = Date.now();
    return (
      logs.entries.find(
        (entry) =>
          now - entry.createdTimestamp < logging.auditWindowMs &&
          (!targetId || entry.target?.id === targetId) &&
          (!channelId || entry.extra?.channel?.id === channelId),
      ) ?? null
    );
  } catch {
    return null; // missing View Audit Log permission, or the entry has not appeared
  }
}

module.exports = { findAudit, sleep };
