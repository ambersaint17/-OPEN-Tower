// Pure logic for section divider roles. Works on plain objects, so it is easy to test.
const norm = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A role "belongs" to a section when its name is, starts with or ends with one of the section's role names.
const nameMatches = (roleName, wanted) => {
  const r = norm(roleName);
  return wanted.some((w) => { const k = norm(w); return r === k || r.startsWith(k) || r.endsWith(k); });
};

// guildRoles: [{ id, name, managed }]    memberRoleIds: Set or array
// groups: [{ key, dividerNames: [...], matches: (role) => boolean }]
// Returns what to add and remove so the member holds a section's divider exactly when they hold one of its roles.
function plan({ guildRoles, memberRoleIds, groups }) {
  const held = memberRoleIds instanceof Set ? memberRoleIds : new Set(memberRoleIds);
  const dividerNorms = new Set(groups.flatMap((g) => g.dividerNames.map(norm)));
  const isDivider = (r) => r.name.includes('▬') || dividerNorms.has(norm(r.name));

  const add = []; const remove = []; const missing = [];
  for (const group of groups) {
    const wanted = new Set(group.dividerNames.map(norm));
    const divider = guildRoles.find((r) => !r.managed && wanted.has(norm(r.name)));
    if (!divider) { missing.push(group.key); continue; }
    const hasSectionRole = guildRoles.some((r) => r.id !== divider.id && !r.managed && !isDivider(r) && group.matches(r) && held.has(r.id));
    const holdsDivider = held.has(divider.id);
    if (hasSectionRole && !holdsDivider) add.push(divider.id);
    else if (!hasSectionRole && holdsDivider) remove.push(divider.id);
  }
  return { add, remove, missing };
}

module.exports = { norm, nameMatches, plan };
