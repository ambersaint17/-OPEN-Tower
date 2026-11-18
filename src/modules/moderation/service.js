const sql = require('../../db');
const { moderation } = require('../../constants');

const DAY = 24 * 60 * 60 * 1000;

// Atomically takes the next case number for the server and stores the case.
async function createCase({
  guildId, type, user, moderator, reason, durationMs = null, expiresAt = null, dmStatus = 'skipped', source = 'command',
}) {
  return sql.begin(async (tx) => {
    const [counter] = await tx`
      insert into mod_counters (guild_id, last_case) values (${guildId}, 1)
      on conflict (guild_id) do update set last_case = mod_counters.last_case + 1
      returning last_case`;
    const [row] = await tx`
      insert into mod_cases
        (guild_id, case_number, type, user_id, user_tag, moderator_id, moderator_tag, reason, duration_ms, expires_at, dm_status, source)
      values
        (${guildId}, ${counter.last_case}, ${type}, ${user.id}, ${user.tag ?? user.username}, ${moderator.id},
         ${moderator.tag ?? moderator.username}, ${reason}, ${durationMs}, ${expiresAt}, ${dmStatus}, ${source})
      returning *`;
    return row;
  });
}

async function setDmStatus(id, dmStatus) {
  await sql`update mod_cases set dm_status = ${dmStatus} where id = ${id}`;
}

async function getCase(guildId, number) {
  const [row] = await sql`select * from mod_cases where guild_id = ${guildId} and case_number = ${number}`;
  return row ?? null;
}

async function listCases(guildId, userId, limit = 10) {
  return sql`
    select * from mod_cases where guild_id = ${guildId} and user_id = ${userId}
    order by created_at desc limit ${limit}`;
}

async function countCases(guildId, userId) {
  const [row] = await sql`select count(*)::int as n from mod_cases where guild_id = ${guildId} and user_id = ${userId}`;
  return row.n;
}

async function countActiveWarns(guildId, userId, days = moderation.escalation.windowDays) {
  const since = new Date(Date.now() - days * DAY);
  const [row] = await sql`
    select count(*)::int as n from mod_cases
    where guild_id = ${guildId} and user_id = ${userId} and type = 'warn' and not voided and created_at >= ${since}`;
  return row.n;
}

async function editReason(guildId, number, reason) {
  const [row] = await sql`
    update mod_cases set reason = ${reason}, edited_at = now()
    where guild_id = ${guildId} and case_number = ${number} returning *`;
  return row ?? null;
}

async function voidCase(guildId, number, byId, reason) {
  const [row] = await sql`
    update mod_cases set voided = true, voided_by = ${byId}, voided_reason = ${reason}, voided_at = now()
    where guild_id = ${guildId} and case_number = ${number} and not voided returning *`;
  return row ?? null;
}

// ---------- moderator statistics ----------

async function moderatorStats(guildId, moderatorId) {
  const now = Date.now();
  const d7 = new Date(now - 7 * DAY);
  const d30 = new Date(now - 30 * DAY);
  const rows = await sql`
    select type,
           count(*)::int as total,
           count(*) filter (where created_at >= ${d7})::int as d7,
           count(*) filter (where created_at >= ${d30})::int as d30
    from mod_cases
    where guild_id = ${guildId} and moderator_id = ${moderatorId} and not voided
    group by type`;
  const [last] = await sql`
    select case_number, type, created_at from mod_cases
    where guild_id = ${guildId} and moderator_id = ${moderatorId} and not voided
    order by created_at desc limit 1`;
  const [voided] = await sql`
    select count(*)::int as n from mod_cases where guild_id = ${guildId} and moderator_id = ${moderatorId} and voided`;
  const [first] = await sql`
    select created_at from mod_cases where guild_id = ${guildId} and moderator_id = ${moderatorId} and not voided
    order by created_at asc limit 1`;
  return { rows, last: last ?? null, voided: voided.n, firstAt: first?.created_at ?? null };
}

async function teamStats(guildId, days = 30) {
  const since = new Date(Date.now() - days * DAY);
  return sql`
    select moderator_id,
           max(moderator_tag) as tag,
           count(*) filter (where type = 'warn')::int as warns,
           count(*) filter (where type = 'timeout')::int as timeouts,
           count(*) filter (where type = 'kick')::int as kicks,
           count(*) filter (where type = 'ban')::int as bans,
           count(*)::int as total
    from mod_cases
    where guild_id = ${guildId} and not voided and created_at >= ${since}
    group by moderator_id
    order by count(*) desc
    limit 15`;
}

module.exports = {
  createCase, setDmStatus, getCase, listCases, countCases, countActiveWarns,
  editReason, voidCase, moderatorStats, teamStats,
};
