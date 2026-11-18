// Everything /help can list. Visibility follows the same rules the commands enforce themselves.
const L = require('../../lib/levels');
const { isManager } = require('../../lib/qotd');
const { levels } = require('../../constants');

const SECTIONS = [
  { key: 'everyone', title: 'Everyone', icon: 'user', about: 'Commands every member can use.' },
  { key: 'perks', title: 'Level and Booster Perks', icon: 'sparkle', about: 'Unlock these by levelling up or boosting the server.' },
  { key: 'team', title: 'Community Team', icon: 'question', about: 'For the Community Engagement Team.', team: true },
  { key: 'staffmgmt', title: 'Staff Management', icon: 'staff', staffManager: true, about: 'For team heads, administrators and the owner.' },
  { key: 'rank1', title: 'Trial Moderator', icon: 'shield', level: 1, about: 'Moderation basics.' },
  { key: 'rank2', title: 'Moderator', icon: 'shield', level: 2, about: 'Added at Moderator.' },
  { key: 'rank3', title: 'Head Moderator', icon: 'staff', level: 3, about: 'Added at Head Moderator.' },
  { key: 'rank4', title: 'Administrator', icon: 'settings', level: 4, about: 'Server setup and content tools.' },
  { key: 'rank5', title: 'Owner', icon: 'key', level: 5, about: 'Owner only.' },
];

// perk: a level perk that unlocks it. booster: boosters only. Everything else is open to the section's audience.
const COMMANDS = [
  { section: 'everyone', usage: '/help', summary: 'Show the commands you can use.' },
  { section: 'everyone', usage: '/ask', summary: 'Ask the server assistant a question. Choose whether only you see the answer.' },
  { section: 'everyone', usage: '/commission mine', summary: 'See your commissions and where each one stands.' },
  { section: 'everyone', usage: '/level', summary: 'See your level, XP, streak and perks. Only you can see it.' },
  { section: 'everyone', usage: '/booster perks', summary: 'See the booster perks and where you stand.' },
  { section: 'everyone', usage: 'Giveaways', summary: 'Press Enter Giveaway on a giveaway post. Level 7 and level 10 add entries, and boosters double their total.', tip: true },

  { section: 'perks', usage: '/colour', summary: 'Pick your name colour.', perk: 'colours' },
  { section: 'perks', usage: '/qotd suggest', summary: 'Suggest a question of the day.', perk: 'qotd' },
  { section: 'perks', usage: '/booster colour', summary: 'Set your own name colour.', booster: true },
  { section: 'perks', usage: '/booster reset', summary: 'Remove your personal name colour.', booster: true },

  { section: 'team', usage: '/qotd setup | add | list | remove | now | status', summary: 'Run the daily question: schedule, queue and posting.' },

  { section: 'staffmgmt', usage: '/induct', summary: 'Offer someone a place on a staff team. They get a DM and answer with Accept or Decline.' },
  { section: 'staffmgmt', usage: '/promote', summary: 'Move someone up to the next rank of their team.' },
  { section: 'staffmgmt', usage: '/demote', summary: 'Move someone down to the previous rank.' },
  { section: 'staffmgmt', usage: '/remove', summary: 'Take someone off their staff team.' },
  { section: 'staffmgmt', usage: '/offers list | cancel', summary: 'See or withdraw offers waiting for an answer.' },
  { section: 'rank1', usage: '/roster', summary: 'Who is on each staff team, and at which rank.' },
  { section: 'rank1', usage: '/warn', summary: 'Warn a member.' },
  { section: 'rank1', usage: '/note', summary: 'Add a private note to a member.' },
  { section: 'rank1', usage: '/cases', summary: 'See a member\'s moderation history.' },
  { section: 'rank1', usage: '/case', summary: 'Edit or void a case (Head Moderator for other people\'s cases).' },
  { section: 'rank1', usage: '/timeout', summary: 'Timeout a member (the maximum grows with your rank).' },
  { section: 'rank1', usage: '/untimeout', summary: 'End a timeout early.' },
  { section: 'rank1', usage: '/modstats me', summary: 'Your own moderation numbers.' },
  { section: 'rank1', usage: '/ticketstats me', summary: 'Your tickets claimed and closed, and your rating.' },
  { section: 'rank1', usage: '/ticket add | remove | close | inactive', summary: 'Handle the ticket you are in.' },

  { section: 'rank1', usage: '/ai summarize', summary: 'Summarise the ticket you are in, when the assistant is enabled for it.' },

  { section: 'rank2', usage: '/kick', summary: 'Kick a member.' },
  { section: 'rank2', usage: '/ticket block | unblock', summary: 'Stop or allow a member opening tickets.' },
  { section: 'rank2', usage: '/giveaway verify', summary: 'Check a member against a giveaway\'s requirements.' },

  { section: 'rank3', usage: '/ban', summary: 'Ban a member.' },
  { section: 'rank3', usage: '/unban', summary: 'Unban someone.' },
  { section: 'rank3', usage: '/modstats member | team', summary: 'Other moderators\' numbers, and the whole team.' },
  { section: 'rank3', usage: '/ticketstats member | team', summary: 'Other staff\'s ticket stats, and the whole team.' },

  { section: 'rank4', usage: '/commission new | list | info | status | edit | note | paid | review | reviews', summary: 'Track commissions, update clients, and collect private reviews.' },
  { section: 'rank4', usage: '/partner', summary: 'Post a partner\'s ad: paste it, choose a ping, and it goes to the partnership channel after checks.' },
  { section: 'rank4', usage: '/partners setup | list | info | end | reciprocal | blacklist | sticky | ourad', summary: 'Set the partnership channel, track who posted our ad, blacklist servers, and keep our own ad.' },
  { section: 'rank4', usage: '/giveaway start | end | reroll | cancel | list', summary: 'Run giveaways with requirements, bonus entries and winner tickets.' },
  { section: 'rank4', usage: '/ai status | test | settings | knowledge | tickets | log', summary: 'Run the AI assistant: what it knows, its limits and where it helps.' },
  { section: 'rank4', usage: '/embed create | edit | upload | templates | delete', summary: 'Build and post custom cards, with pings, menus and webhooks.' },
  { section: 'rank4', usage: '/youtube setup | style | shorts | check | test | status', summary: 'Upload announcements.' },
  { section: 'rank4', usage: '/levels', summary: 'Adjust levels, XP rules, events and perk roles.' },
  { section: 'rank4', usage: '/verification', summary: 'Verification setup, raid mode and manual approval.' },
  { section: 'rank4', usage: '/ticket setup | panel | channels', summary: 'Set up tickets and their channels.' },
  { section: 'rank4', usage: '/logs', summary: 'Choose which events are logged, and where.' },
  { section: 'rank4', usage: '/automod status | enable | spam | mentions | links | formatting | words | word | domain | exempt | test', summary: 'Automatic moderation: removes and warns for spam, mass mentions, invites, shouting and banned words.' },
  { section: 'rank4', usage: '/dividers status | sync', summary: 'Section divider roles (PINGS, INTERESTS, LEVELS) and fixing everyone now.' },
  { section: 'rank4', usage: '/emoji', summary: 'Check or add the Tower emoji pack.' },

  { section: 'rank5', usage: '/earlyaccess', summary: 'Share an early look with Insiders and boosters.' },
];

// viewer: { level (staff rank 0-5), roleNames, memberLevel (XP level), booster }
function viewerState(viewer) {
  return { ...viewer, qotdManager: isManager(viewer.roleNames ?? [], viewer.level ?? 0) };
}

// How one command looks to this person: 'open', 'unlocked', or { locked: 'why' }.
function stateOf(cmd, v) {
  if (cmd.booster) return v.booster ? 'unlocked' : { locked: 'Server boosters only' };
  if (cmd.perk) {
    const instant = v.booster && levels.booster.instant.includes(cmd.perk);
    if (instant || v.memberLevel >= L.perkLevel(cmd.perk)) return 'unlocked';
    return { locked: `Unlocks at level ${L.perkLevel(cmd.perk)}` };
  }
  if (cmd.section === 'perks') return 'unlocked';
  return 'open';
}

// The sections this person can see, each with its commands.
function visibleSections(viewer) {
  const v = viewerState(viewer);
  return SECTIONS.filter((s) => {
    if (s.team) return v.qotdManager;
    if (s.staffManager) return v.staffManager;
    if (s.level) return v.level >= s.level;
    return true;
  }).map((s) => ({ ...s, commands: COMMANDS.filter((c) => c.section === s.key).map((c) => ({ ...c, state: stateOf(c, v) })) }));
}

const nameOf = (usage) => usage.split(' ')[0];

module.exports = { SECTIONS, COMMANDS, visibleSections, viewerState, nameOf };
