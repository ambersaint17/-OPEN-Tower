const { PermissionFlagsBits: P } = require('discord.js');
const { normalize, levelFor } = require('../moderation/permissions');
const perkSync = require('../levels/perks');

// A button or menu option can hand out a role to anyone. These roles must never be handed out that way.
const DANGEROUS = [
  P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.ManageMessages, P.ManageWebhooks, P.ManageNicknames,
  P.KickMembers, P.BanMembers, P.ModerateMembers, P.MentionEveryone, P.ManageGuildExpressions, P.ViewAuditLog,
];
const VERIFICATION_NAMES = new Set(['member', 'unverified']);

// Returns the reason a role cannot be given by a button or menu, or null when it is fine.
function protectedReason(guild, role) {
  if (!role) return 'That role does not exist.';
  if (role.id === guild.id) return '@everyone cannot be given.';
  if (role.managed) return `${role.name} is managed by an integration and cannot be given.`;
  if (role.position >= guild.members.me.roles.highest.position) return `${role.name} is above Tower's role, so Tower cannot give it.`;
  if (role.permissions.any(DANGEROUS)) return `${role.name} has staff or admin permissions, so it can never be given by a button.`;
  if (levelFor([role.name]) > 0) return `${role.name} is a staff rank.`;
  if (VERIFICATION_NAMES.has(normalize(role.name))) return `${role.name} is part of verification and cannot be given this way.`;
  const earned = perkSync.roleKeys.some((key) => perkSync.findRole(guild, key)?.id === role.id);
  if (earned) return `${role.name} is earned through levels, so it cannot be given by a button.`;
  return null;
}

// By ID or by name (capitals and spacing ignored).
function findRole(guild, text) {
  const t = String(text).trim();
  if (/^\d{17,20}$/.test(t)) return guild.roles.cache.get(t) ?? null;
  const wanted = normalize(t);
  return guild.roles.cache.find((r) => r.id !== guild.id && normalize(r.name) === wanted) ?? null;
}

module.exports = { protectedReason, findRole, DANGEROUS };
