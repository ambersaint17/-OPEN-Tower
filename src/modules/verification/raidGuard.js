const { RaidDetector } = require('../../lib/raid');
const { raid } = require('../../constants');
const { postLog } = require('../../lib/logging');
const service = require('./service');
const views = require('./views');

const detector = new RaidDetector(raid);

// Called for every non-bot join while verification is enabled.
async function onJoin(guild, settings) {
  const count = detector.record(guild.id);
  if (!detector.isRaid(count) || settings.raid_mode) return;

  const flipped = await service.setRaidMode(guild.id, true);
  if (!flipped) return;

  detector.reset(guild.id);
  const auditId = await service.logEvent({
    guildId: guild.id,
    type: 'raid_on',
    detail: { joins: count, windowMs: raid.windowMs, manual: false },
  });
  await postLog(guild, settings, views.logRaid({ on: true, trigger: views.raidTrigger(count), auditId }));
}

module.exports = { onJoin };
