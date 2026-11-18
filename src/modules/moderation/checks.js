// Safety rules that apply to every action. Returns an error message, or null when the action is allowed.
// moderator and target are GuildMembers (target may be null for people not in the server).
function checkTarget({ action, moderator, target, targetUser, botMember, ownerId, needsBotRank = true }) {
  if (targetUser.id === moderator.id) return `You cannot ${action} yourself.`;
  if (targetUser.id === botMember.id) return `You cannot ${action} Tower.`;
  if (targetUser.bot) return `You cannot ${action} a bot.`;
  if (targetUser.id === ownerId) return `You cannot ${action} the server owner.`;

  if (target) {
    const isOwner = moderator.id === ownerId;
    if (!isOwner && target.roles.highest.position >= moderator.roles.highest.position) {
      return `You cannot ${action} someone with the same or a higher role than you.`;
    }
    if (needsBotRank && target.roles.highest.position >= botMember.roles.highest.position) {
      return 'Tower\'s role is not high enough to act on that member. Move Tower\'s role above theirs in Server Settings > Roles.';
    }
  }
  return null;
}

module.exports = { checkTarget };
