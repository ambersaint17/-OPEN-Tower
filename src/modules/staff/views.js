const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ui = require('../../ui');
const { colors } = require('../../constants');
const { clip } = require('../../lib/text');
const lib = require('../../lib/staff');

const { fmt } = ui;
const GOLD = 0xc48a1f;
const rankLabel = (teamKey, rankKey) => { const t = lib.teamOf(teamKey); const i = t ? lib.rankIndex(t, rankKey) : -1; return i >= 0 ? t.ranks[i].label : rankKey; };
const teamLabel = (teamKey) => lib.teamOf(teamKey)?.label ?? teamKey;

// ---------- the invitation, sent by DM ----------
function offerCard(offer, guildName) {
  const accept = new ButtonBuilder().setCustomId(`staff:accept:${offer.id}`).setLabel('Accept').setStyle(ButtonStyle.Success);
  const decline = new ButtonBuilder().setCustomId(`staff:decline:${offer.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger);
  return ui.card({
    banner: 'staff', icon: 'staff', title: 'You Have Been Selected', accent: GOLD,
    description: [
      `You have been chosen to join the **${teamLabel(offer.team)}** of **${guildName}** as **${rankLabel(offer.team, offer.rank_key)}**.`,
      offer.note ? `> ${clip(offer.note, 400).replace(/\n/g, '\n> ')}` : null,
      'Choose **Accept** to join the team, or **Decline** if it is not for you. Either way you can add a note for the team, and nothing changes until you answer.',
    ].filter(Boolean).join('\n\n'),
    fields: [
      ['Team', fmt.bold(teamLabel(offer.team)), 'staff'],
      ['Rank', fmt.bold(rankLabel(offer.team, offer.rank_key)), 'trophy'],
      ['Offered By', fmt.user(offer.offered_by), 'user'],
      ['Open Until', fmt.time(offer.expires_at, 'R'), 'clock'],
    ],
    rows: [new ActionRowBuilder().addComponents(accept, decline)],
  });
}

const accepted = (offer, guildName) => ui.card({
  banner: 'staff', icon: 'check', title: 'Welcome To The Team', accent: colors.teal,
  description: `You are now **${rankLabel(offer.team, offer.rank_key)}** of the **${teamLabel(offer.team)}** at **${guildName}**. Your roles have been given, and the team has been told. Welcome aboard!`,
  fields: [['Team', fmt.bold(teamLabel(offer.team)), 'staff'], ['Rank', fmt.bold(rankLabel(offer.team, offer.rank_key)), 'trophy']],
});
const declined = (offer) => ui.notice('Offer Declined', `You turned down the **${rankLabel(offer.team, offer.rank_key)}** position. Thank you for letting us know, and thank you for being considered.`, { icon: 'check' });
const expired = (offer) => ui.notice('Offer Expired', `The offer for **${rankLabel(offer.team, offer.rank_key)}** in the ${teamLabel(offer.team)} was not answered in time and is no longer open.`, { icon: 'clock' });
const cancelledOffer = (offer) => ui.notice('Offer Withdrawn', `The offer for **${rankLabel(offer.team, offer.rank_key)}** in the ${teamLabel(offer.team)} was withdrawn.`, { icon: 'cross' });
const failedAccept = (reason) => ui.notice('Something Went Wrong', `${reason}\nStaff have been told and will sort it out with you.`, { icon: 'warning', accent: colors.alert });

// ---------- what the person who made the offer is told ----------
function answered(offer, user, { accepted: yes, note, failed }) {
  return ui.notice(failed ? 'Offer Accepted, Roles Not Applied' : yes ? 'Offer Accepted' : 'Offer Declined',
    `${fmt.user(user.id)} ${yes ? 'accepted' : 'declined'} the **${rankLabel(offer.team, offer.rank_key)}** position in the ${teamLabel(offer.team)}.${failed ? `\n**${failed}**` : ''}${note ? `\n\nTheir note:\n> ${clip(note, 600).replace(/\n/g, '\n> ')}` : ''}`,
    { icon: failed ? 'warning' : yes ? 'check' : 'cross', accent: failed ? colors.alert : yes ? colors.teal : GOLD, fields: [['Offer', fmt.code(`#${offer.id}`), 'ticket']] });
}

// ---------- staff log and member notices ----------
const ACTION_TITLES = { induct: 'Staff Inducted', promote: 'Staff Promoted', demote: 'Staff Demoted', remove: 'Staff Removed' };
function logCard({ action, userId, byId, team, fromRank, toRank, reason, note }) {
  return ui.card({
    icon: 'staff', title: ACTION_TITLES[action], accent: action === 'remove' ? colors.alert : action === 'demote' ? GOLD : colors.teal,
    fields: [
      ['Member', fmt.user(userId), 'user'], ['By', fmt.user(byId), 'staff'], ['Team', teamLabel(team), 'hash'],
      ...(fromRank ? [['From', fromRank, 'minus']] : []), ...(toRank ? [['To', toRank, 'plus']] : []),
      ...(reason ? [['Reason', clip(reason, 400), 'scroll']] : []), ...(note ? [['Their Note', clip(note, 400), 'chat']] : []),
    ],
  });
}

function memberNotice({ action, guildName, team, fromRank, toRank, reason }) {
  const text = action === 'promote' ? `Congratulations! You have been promoted to **${toRank}** in the ${teamLabel(team)}.`
    : action === 'demote' ? `You have been moved from **${fromRank}** to **${toRank}** in the ${teamLabel(team)}.`
      : `You are no longer part of the ${teamLabel(team)} at **${guildName}**. Thank you for everything you did.`;
  return ui.notice(action === 'promote' ? 'You Have Been Promoted' : action === 'demote' ? 'Your Rank Has Changed' : 'Your Staff Role Has Ended', `${text}${reason ? `\n\n**Reason:** ${clip(reason, 400)}` : ''}`, {
    icon: action === 'promote' ? 'trophy' : 'staff', accent: action === 'promote' ? colors.teal : GOLD,
  });
}

// ---------- the actor's answers ----------
const offerSent = (offer, userId) => ui.notice('Offer Sent', `${fmt.user(userId)} was sent the offer by DM. When they answer, you will be told, and their roles are applied automatically on acceptance.`, {
  icon: 'check', accent: colors.teal,
  fields: [['Team', teamLabel(offer.team), 'staff'], ['Rank', rankLabel(offer.team, offer.rank_key), 'trophy'], ['Open Until', fmt.time(offer.expires_at, 'R'), 'clock'], ['Offer', fmt.code(`#${offer.id}`), 'ticket']],
});

function changeDone({ action, userId, team, fromRank, toRank, applied, headerNote, dmSent }) {
  const verb = { induct: 'Inducted', promote: 'Promoted', demote: 'Demoted', remove: 'Removed' }[action];
  const names = (list) => list.map((r) => fmt.role(r.id)).join(' ') || 'none';
  return ui.notice(`${verb}`, `${fmt.user(userId)} ${action === 'remove' ? 'was removed from' : 'is now on'} the ${teamLabel(team)}${toRank ? ` as **${toRank}**` : ''}.`, {
    icon: 'check', accent: colors.teal,
    fields: [
      ...(fromRank ? [['From', fromRank, 'minus']] : []), ...(toRank ? [['To', toRank, 'plus']] : []),
      ['Roles Added', names(applied.added), 'plus'], ['Roles Removed', names(applied.removed), 'minus'],
      ['They Were Told', dmSent ? 'By DM' : 'Not by DM (their DMs are closed)', 'chat'],
      ...(headerNote ? [['Note', headerNote, 'warning']] : []),
    ],
  });
}

function offersList(rows) {
  const description = rows.length
    ? rows.map((o) => `• ${fmt.code(`#${o.id}`)} ${fmt.user(o.user_id)}: **${rankLabel(o.team, o.rank_key)}**, ${teamLabel(o.team)}. Offered by ${fmt.user(o.offered_by)}, open until ${fmt.time(o.expires_at, 'R')}`).join('\n')
    : 'No offers are waiting for an answer.';
  return ui.notice('Pending Offers', description, { icon: 'staff', accent: GOLD });
}

// ---------- the roster ----------
// data: { leadership: { owner, administrators: [ids], producers: [ids] }, teams: [{ team, ranks: [{ label, ids }] }], since: Map, partial }
function rosterCard(data) {
  const line = (id) => `${fmt.user(id)}${data.since.get(id) ? ` since ${fmt.time(data.since.get(id), 'D')}` : ''}`;
  const blocks = [];
  if (data.leadership) {
    const l = data.leadership;
    blocks.push(`**Leadership**\n${[l.owner ? `Owner: ${fmt.user(l.owner)}` : null, l.administrators.length ? `Administrator: ${l.administrators.map(fmt.user).join(' ')}` : null, l.producers.length ? `Co-Owner: ${l.producers.map(fmt.user).join(' ')}` : null].filter(Boolean).join('\n') || '*Nobody*'}`);
  }
  for (const t of data.teams) {
    const total = t.ranks.reduce((n, r) => n + r.ids.length, 0);
    const body = [...t.ranks].reverse().map((r) => `**${r.label}**\n${r.ids.length ? r.ids.map(line).join('\n') : '*Nobody*'}`).join('\n');
    blocks.push(`${fmt.bold(t.team.label)} (${total})\n${body}`);
  }
  return ui.card({
    banner: 'staff', icon: 'staff', title: 'Staff Roster', accent: GOLD,
    description: clip(blocks.join('\n\n') || 'No staff found.', 3600),
    fields: data.partial ? [['Note', 'Discord limited the member list just now, so this may be missing a few people. Try again in a minute.', 'warning']] : [],
  });
}

module.exports = { offerCard, accepted, declined, expired, cancelledOffer, failedAccept, answered, logCard, memberNotice, offerSent, changeDone, offersList, rosterCard, rankLabel, teamLabel };
