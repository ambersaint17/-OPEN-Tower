// All the level maths, kept pure so it can be tested without Discord.
const { levels } = require('../constants');

const TOTALS = levels.ladder.map((l) => l.xp);
const MAX_LEVEL = TOTALS.length;
const DAY_MS = 86_400_000;

const xpForLevel = (n) => (n <= 0 ? 0 : TOTALS[Math.min(n, MAX_LEVEL) - 1]);

function levelFromXp(xp) {
  let level = 0;
  for (const total of TOTALS) {
    if (xp >= total) level++;
    else break;
  }
  return level;
}

function progress(xp) {
  const level = levelFromXp(xp);
  const max = level >= MAX_LEVEL;
  const floor = xpForLevel(level);
  const ceiling = max ? floor : xpForLevel(level + 1);
  const needed = max ? 0 : ceiling - floor;
  return {
    level, max, floor, ceiling, needed,
    into: xp - floor,
    toNext: max ? 0 : ceiling - xp,
    fraction: max ? 1 : needed ? Math.min(1, (xp - floor) / needed) : 0,
  };
}

const titleFor = (level) => (level <= 0 ? levels.startTitle : levels.ladder[Math.min(level, MAX_LEVEL) - 1].title);

// Every perk unlocked by reaching this level, in ladder order.
const perksUpTo = (level) => levels.ladder.filter((l) => l.level <= level).flatMap((l) => l.perks);

// Perks unlocked by going from one level to another (a member can jump several at once).
const perksBetween = (from, to) => levels.ladder.filter((l) => l.level > from && l.level <= to).flatMap((l) => l.perks);

// The next level that unlocks something, or null at the top.
const nextUnlock = (level) => levels.ladder.find((l) => l.level > level) ?? null;

const perkLevel = (key) => levels.ladder.find((l) => l.perks.includes(key))?.level ?? null;

// After the daily soft cap, XP still counts but at a reduced rate.
function applySoftCap(dayXp, gain) {
  const { dailySoftCap, softCapRate } = levels.xp;
  if (dayXp >= dailySoftCap) return Math.max(1, Math.round(gain * softCapRate));
  const room = dailySoftCap - dayXp;
  return gain <= room ? gain : Math.round(room + (gain - room) * softCapRate);
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

// Moves a streak forward when a member is active on a new day. A Streak Shield forgives exactly one
// missed day, then needs a week to recharge.
function streakStep({ streak = 0, lastDay = null, shieldUsedAt = null }, today, nowMs, hasShield) {
  if (lastDay === today) return { streak, shieldUsedAt, usedShield: false };
  if (!lastDay) return { streak: 1, shieldUsedAt, usedShield: false };
  const gap = daysBetween(lastDay, today);
  if (gap === 1) return { streak: streak + 1, shieldUsedAt, usedShield: false };
  const recharged = !shieldUsedAt || nowMs - new Date(shieldUsedAt).getTime() >= levels.streak.shieldRechargeMs;
  if (gap === 2 && hasShield && recharged) return { streak: streak + 1, shieldUsedAt: new Date(nowMs), usedShield: true };
  return { streak: 1, shieldUsedAt, usedShield: false };
}

// Day 1 earns nothing extra, then +5% a day up to +25%.
const streakBonus = (streak) => Math.min(Math.max(streak - 1, 0), levels.streak.maxDays) * levels.streak.perDay;

const rollXp = (rand = Math.random) => levels.xp.min + Math.floor(rand() * (levels.xp.max - levels.xp.min + 1));

// 1 entry for everyone, +1 at level 7, +1 at level 10. Boosters double the total.
function giveawayEntries(level, booster) {
  const entries = 1 + (level >= perkLevel('giveaway') ? 1 : 0) + (level >= perkLevel('elite') ? 1 : 0);
  return booster ? entries * 2 : entries;
}

// The perk roles a member should hold: everything their level unlocks, plus the booster instant perks.
function desiredPerks(level, booster, perks) {
  const keys = new Set(perksUpTo(level));
  if (booster) for (const key of levels.booster.instant) keys.add(key);
  return [...keys].filter((key) => perks[key]?.role);
}

function estimateText(xp, perDay = 400) {
  const days = xp / perDay;
  if (days < 1) return 'under a day';
  if (days < 14) return `about ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`;
  if (days < 70) return `about ${Math.round(days / 7)} weeks`;
  return `about ${Math.round(days / 30)} months`;
}

module.exports = {
  MAX_LEVEL, xpForLevel, levelFromXp, progress, titleFor, perksUpTo, perksBetween, nextUnlock, perkLevel,
  applySoftCap, dayKey, daysBetween, streakStep, streakBonus, rollXp, giveawayEntries, desiredPerks, estimateText,
};
