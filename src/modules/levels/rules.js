const { logTypes } = require('../../constants');
const { matchesChannelName } = require('../../lib/channels');

// Where XP is NOT earned unless staff say otherwise. Everything here is found by structure and
// channel names, not by category names, because decorative category names cannot be matched.
const IGNORED_CHANNEL_NAMES = ['media', 'creations', 'bot-commands', 'level-ups'];
const IMPORTANT_MARKERS = ['rules', 'announcements'];           // the category holding these is "Important"
const VERIFICATION_MARKERS = ['verify', 'verify-guide'];
const STAFF_MARKERS = ['staff-chat', 'mod-chat', 'admin-chat', 'cet-chat'];

// channels: [{ id, name, parentId }]  (categories are not listed; parentId points at them)
// Returns Maps of id -> why it is ignored, for channels and for whole categories.
function computeDefaults(channels) {
  const out = { channels: new Map(), categories: new Map() };
  const hit = (name, wanted) => wanted.some((w) => matchesChannelName(name, w));
  const logNames = Object.values(logTypes).map((t) => t.channel);

  for (const c of channels) {
    if (hit(c.name, IGNORED_CHANNEL_NAMES)) out.channels.set(c.id, 'default: spam and showcase channels');
    if (hit(c.name, logNames)) {
      out.channels.set(c.id, 'default: log channel');
      if (c.parentId) out.categories.set(c.parentId, 'default: log category');
    }
    if (c.parentId && hit(c.name, IMPORTANT_MARKERS)) out.categories.set(c.parentId, 'default: Important category (staff post here)');
    if (c.parentId && hit(c.name, VERIFICATION_MARKERS)) out.categories.set(c.parentId, 'default: verification category');
    if (c.parentId && hit(c.name, STAFF_MARKERS)) out.categories.set(c.parentId, 'default: staff category');
  }
  return out;
}

// state: {
//   explicit:    Map(id -> 'ignore' | 'allow')      channels and categories staff configured
//   defaults:    { channels, categories }           from computeDefaults
//   ignoredRoles: Set(roleId)
//   channelMultipliers: Map(id -> number), roleMultipliers: Map(roleId -> number)
// }
// ctx: { ids: [channelId, parentChannelId?, categoryId?]  (most specific first), roleIds: [] }
function evaluate(ctx, state) {
  for (const roleId of ctx.roleIds) {
    if (state.ignoredRoles.has(roleId)) return { ignored: true, reason: 'role', multiplier: 1 };
  }

  let ignored = null;
  for (const id of ctx.ids) {                       // the most specific staff rule decides
    const mode = state.explicit.get(id);
    if (mode) { ignored = mode === 'ignore'; break; }
  }
  if (ignored === null) {
    ignored = ctx.ids.some((id) => state.defaults.channels.has(id) || state.defaults.categories.has(id));
  }
  if (ignored) return { ignored: true, reason: 'channel', multiplier: 1 };

  const channelMult = ctx.ids.map((id) => state.channelMultipliers.get(id)).find((m) => m !== undefined) ?? 1;
  const roleMult = Math.max(1, ...ctx.roleIds.map((r) => state.roleMultipliers.get(r) ?? 1));
  return { ignored: false, reason: null, multiplier: channelMult * roleMult };
}

module.exports = { computeDefaults, evaluate, IGNORED_CHANNEL_NAMES };
