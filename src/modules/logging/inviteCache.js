// Remembers how many times each invite was used, so a join can be matched to the
// invite whose counter went up. Memory only. Two joins in the same instant can be
// misattributed, and vanity URLs are not tracked.
const uses = new Map(); // guildId -> Map(code -> { uses, inviterId })

const toMap = (invites) =>
  new Map([...invites.values()].map((i) => [i.code, { uses: i.uses ?? 0, inviterId: i.inviter?.id ?? null }]));

async function snapshot(guild) {
  try {
    uses.set(guild.id, toMap(await guild.invites.fetch()));
  } catch (err) {
    console.warn(`[invites] cannot read invites for ${guild.name}: ${err.message}`);
  }
}

async function findUsed(guild) {
  const before = uses.get(guild.id) ?? new Map();
  let invites;
  try {
    invites = await guild.invites.fetch();
  } catch {
    return null;
  }
  let found = null;
  for (const invite of invites.values()) {
    if ((invite.uses ?? 0) > (before.get(invite.code)?.uses ?? 0)) {
      found = { code: invite.code, inviterId: invite.inviter?.id ?? null, uses: invite.uses ?? 0 };
      break;
    }
  }
  uses.set(guild.id, toMap(invites));
  return found;
}

function onCreate(invite) {
  const map = uses.get(invite.guild.id) ?? new Map();
  map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
  uses.set(invite.guild.id, map);
}

const onDelete = (invite) => uses.get(invite.guild.id)?.delete(invite.code);

module.exports = { snapshot, findUsed, onCreate, onDelete };
