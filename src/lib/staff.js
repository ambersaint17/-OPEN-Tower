// Pure rules for staff management: ladders, who may do what, and which roles change. No Discord calls in here.
const { staff } = require('../constants');

const norm = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const TEAMS = staff.teams.map((t) => ({ ...t, ranks: t.ranks.map((r) => ({ ...r, label: r.role })) }));
const teamOf = (key) => TEAMS.find((t) => t.key === key) ?? null;
const rankIndex = (team, key) => team.ranks.findIndex((r) => r.key === key || norm(r.role) === norm(key));

// Which team and rank a person holds, judged from their role names. The highest one wins if they somehow hold several.
function profileOf(roleNames) {
  const names = new Set(roleNames.map(norm));
  let best = null;
  for (const team of TEAMS) {
    team.ranks.forEach((rank, index) => {
      if (names.has(norm(rank.role)) && (!best || index > best.index)) best = { team: team.key, index, rank };
    });
  }
  return best;
}
const isOnTeam = (roleNames) => profileOf(roleNames) !== null;

// What a person is allowed to manage.
//   owner / admin  every team, every rank, including head
//   head           only their own team, and only ranks below their own
//   null           nothing
function authority(roleNames, { isOwner = false, isAdmin = false } = {}) {
  if (isOwner) return { kind: 'owner' };
  const names = new Set(roleNames.map(norm));
  if (isAdmin || staff.leadershipRoles.some((r) => names.has(norm(r)))) return { kind: 'admin' };
  const mine = profileOf(roleNames);
  if (mine && mine.index === teamOf(mine.team).ranks.length - 1) return { kind: 'head', team: mine.team, index: mine.index };
  return null;
}

// The highest rank index this person may hand out in a team (-1 means none).
function maxGrant(auth, teamKey) {
  const team = teamOf(teamKey);
  if (!auth || !team) return -1;
  if (auth.kind === 'owner' || auth.kind === 'admin') return team.ranks.length - 1;
  return auth.team === teamKey ? auth.index - 1 : -1;
}
const canGrant = (auth, teamKey, index) => index >= 0 && index <= maxGrant(auth, teamKey);

// May this person act on someone who already holds a rank? Heads only on people below them in their own team.
function canActOn(auth, target) {
  if (!auth || !target) return false;
  if (auth.kind === 'owner' || auth.kind === 'admin') return true;
  return auth.team === target.team && target.index < auth.index;
}

// ---------- the decisions, each returning { ok } or { error } ----------
function decideInduct({ auth, teamKey, rankKey, targetProfile }) {
  const team = teamOf(teamKey);
  if (!auth) return { error: 'Only team heads, administrators and the owner can induct staff.' };
  if (!team) return { error: 'That team does not exist.' };
  const index = rankIndex(team, rankKey);
  if (index < 0) return { error: `${team.label} has no rank called "${rankKey}".` };
  if (targetProfile) return { error: 'That person is already on a staff team. Use `/promote` or `/demote` instead.' };
  if (!canGrant(auth, teamKey, index)) {
    return { error: auth.kind === 'head' && auth.team !== teamKey ? `You lead a different team. You can only induct into your own.` : `You can only give ranks below your own. ${team.ranks[index].label} needs an administrator or the owner.` };
  }
  return { ok: true, team, index, rank: team.ranks[index] };
}

function decideChange({ action, auth, targetProfile }) {
  if (!auth) return { error: 'Only team heads, administrators and the owner can do that.' };
  if (!targetProfile) return { error: 'That person is not on a staff team.' };
  const team = teamOf(targetProfile.team);
  if (!canActOn(auth, targetProfile)) {
    return { error: auth.kind === 'head' && auth.team !== targetProfile.team ? 'They are on a different team.' : 'You can only manage people ranked below you.' };
  }
  const from = targetProfile.index;
  if (action === 'remove') return { ok: true, team, from, fromRank: team.ranks[from] };
  const to = action === 'promote' ? from + 1 : from - 1;
  if (action === 'promote' && to >= team.ranks.length) return { error: `They are already ${team.ranks[from].label}, the top rank of ${team.label}.` };
  if (action === 'demote' && to < 0) return { error: `They are already ${team.ranks[from].label}, the lowest rank. Use \`/remove\` to take them off the team.` };
  if (action === 'promote' && !canGrant(auth, targetProfile.team, to)) return { error: `Only an administrator or the owner can make someone ${team.ranks[to].label}.` };
  return { ok: true, team, from, to, fromRank: team.ranks[from], toRank: team.ranks[to] };
}

// ---------- which roles change ----------
// Returns role names to add and to remove. `keepStaff` is true when the person also holds a leadership role, so the Staff role stays.
function rolePlan({ action, team, fromIndex, toIndex, keepStaff = false }) {
  const t = typeof team === 'string' ? teamOf(team) : team;
  const staffRoles = [staff.staffRole];
  if (action === 'induct') return { add: [t.teamRole, t.ranks[toIndex].role, ...staffRoles], remove: [], header: 'add' };
  if (action === 'remove') {
    return { add: [], remove: [t.ranks[fromIndex].role, t.teamRole, ...(keepStaff ? [] : staffRoles)], header: keepStaff ? 'keep' : 'remove' };
  }
  return { add: [t.ranks[toIndex].role, t.teamRole, ...staffRoles], remove: [t.ranks[fromIndex].role], header: 'add' };
}
const holdsLeadership = (roleNames) => roleNames.some((n) => staff.leadershipRoles.some((r) => norm(r) === norm(n)));

module.exports = {
  TEAMS, teamOf, rankIndex, profileOf, isOnTeam, authority, maxGrant, canGrant, canActOn, decideInduct, decideChange, rolePlan, holdsLeadership, norm, staff,
};
