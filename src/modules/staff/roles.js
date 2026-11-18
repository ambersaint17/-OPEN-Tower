const { staff } = require('../../constants');
const { norm } = require('../../lib/staff');

const isHeaderName = (name) => name.includes('▬');

// The role with this name. The divider role (with the ▬ symbols) is never mistaken for the plain role of the same name.
const findRole = (guild, name) => [...guild.roles.cache.values()].find((r) => !r.managed && !isHeaderName(r.name) && norm(r.name) === norm(name)) ?? null;
const findHeader = (guild) => [...guild.roles.cache.values()].find((r) => isHeaderName(r.name) && norm(r.name) === norm(staff.headerName)) ?? null;

// Turns a plan of role names into real roles, and lists anything that stops it going through.
function resolve(guild, plan, member) {
  const add = []; const remove = []; const missing = []; const problems = [];
  const top = guild.members.me.roles.highest.position;
  const check = (role) => { if (role.managed || role.position >= top) problems.push(role.name); };
  for (const name of plan.add) { const r = findRole(guild, name); if (r) { add.push(r); check(r); } else missing.push(name); }
  for (const name of plan.remove) { const r = findRole(guild, name); if (r) { remove.push(r); check(r); } }
  const header = findHeader(guild);
  let headerNote = null;
  if (plan.header === 'add' || plan.header === 'remove') {
    if (!header) headerNote = `There is no divider role named "▬▬▬ ${staff.headerName.toUpperCase()} ▬▬▬", so that one was skipped.`;
    else { check(header); (plan.header === 'add' ? add : remove).push(header); }
  }
  if (member && !member.manageable) problems.push(`${member.displayName ?? 'the member'} (their highest role is above Tower's)`);
  return { add, remove, missing, problems, headerNote };
}

// Applies the change. Roles the person already has (or does not have) are left out so Discord is only asked for real changes.
async function apply(member, resolved, reason) {
  const toAdd = resolved.add.filter((r) => !member.roles.cache.has(r.id));
  const toRemove = resolved.remove.filter((r) => member.roles.cache.has(r.id));
  if (toAdd.length) await member.roles.add(toAdd, reason);
  if (toRemove.length) await member.roles.remove(toRemove, reason);
  return { added: toAdd, removed: toRemove };
}

module.exports = { findRole, findHeader, resolve, apply };
