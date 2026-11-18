const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { card, fmt } = require('../../ui');
const { ic, object } = require('../../emojis');
const { colors, levels, perks, colours } = require('../../constants');
const L = require('../../lib/levels');
const { anniversaryLabel } = require('./boosters');

const perkName = (key) => perks[key].name;
const perkLine = (key) => `${ic(perks[key].icon)}**${perks[key].name}:** ${perks[key].summary}`;
const num = (n) => Math.round(n).toLocaleString('en-US');
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const withEmoji = (icon) => { const e = object(icon); return e ? { emoji: e } : {}; };

// ---------- /level ----------

function levelView({ member, entry, prog, booster, event, imageName, boosts }) {
  const next = L.nextUnlock(prog.level);
  const unlocked = new Set(L.perksUpTo(prog.level));
  if (booster) for (const k of levels.booster.instant) unlocked.add(k);
  const streakBonus = Math.round(L.streakBonus(entry.streak) * 100);

  const boostLines = [
    ...(booster ? [`${ic('gem')}Booster: **x${levels.booster.multiplier}** XP`] : []),
    ...(event ? [`${ic('zap')}Event: **x${event.multiplier}** XP until ${fmt.time(event.endsAt, 'R')}`] : []),
    ...(streakBonus ? [`${ic('fire')}Streak: **+${streakBonus}%** XP`] : []),
    ...(boosts.channelMultiplier > 1 ? [`${ic('chat')}This channel: **x${boosts.channelMultiplier}** XP`] : []),
  ];

  return card({
    icon: 'level_up',
    title: `${member.displayName} | Level ${prog.level}`,
    description: `**${L.titleFor(prog.level)}**${imageName ? '' : `\n${textBar(prog.fraction)}`}`,
    image: imageName,
    blocks: [
      unlocked.size
        ? `### ${ic('check')}Your perks\n${[...unlocked].map(perkLine).join('\n')}`
        : `### ${ic('check')}Your perks\nNone yet. Send a couple of messages and your first perk unlocks.`,
    ],
    fields: [
      ['Total XP', fmt.code(num(entry.xp)), 'stats'],
      ['To Next Level', prog.max ? fmt.bold('Max level reached') : fmt.code(`${num(prog.toNext)} XP`), 'level_up'],
      ['Next Unlock', next ? `${next.perks.map(perkName).join(' and ')} at level ${next.level}` : fmt.bold('Everything unlocked'), 'gift'],
      ['Streak', entry.streak > 0 ? fmt.code(`${entry.streak} day${entry.streak === 1 ? '' : 's'}`) : fmt.code('none yet'), 'fire'],
      ...(boostLines.length ? [['XP Boosts', `\n${boostLines.join('\n')}`, 'zap']] : []),
    ],
  });
}

// The same view with a text progress bar, used if the image could not be drawn.
function textBar(fraction, width = 20) {
  const filled = Math.round(fraction * width);
  return `\`${'\u2588'.repeat(filled)}${'\u2591'.repeat(width - filled)}\` ${Math.floor(fraction * 100)}%`;
}

// ---------- level-up DM ----------

const dmButton = (guildId, on) => {
  const b = new ButtonBuilder().setCustomId(`level:dm:${guildId}:${on ? 'on' : 'off'}`)
    .setLabel(on ? 'Turn Level-Up Messages Back On' : 'Stop These Messages').setStyle(ButtonStyle.Secondary);
  const e = object(on ? 'bell' : 'mute');
  if (e) b.setEmoji(e);
  return b;
};

function levelUpDm({ guildId, guildName, from, to, entry }) {
  const prog = L.progress(entry.xp);
  const next = L.nextUnlock(to);
  const unlocked = L.perksBetween(from, to);
  return card({
    banner: 'levels', icon: 'level_up', title: `You reached level ${to}`,
    description: `**${L.titleFor(to)}** in **${guildName}**`,
    blocks: [unlocked.length ? `### ${ic('gift')}Just unlocked\n${unlocked.map(perkLine).join('\n')}` : 'Keep going, the next perk is closer than you think.'],
    fields: [
      ['Next Unlock', next ? `${next.perks.map(perkName).join(' and ')} at level ${next.level}` : fmt.bold('Everything unlocked'), 'level_up'],
      ['To Next Level', prog.max ? fmt.bold('Max level reached') : fmt.code(`${num(prog.toNext)} XP`), 'stats'],
    ],
    rows: [row(dmButton(guildId, false))],
  });
}

const dmChanged = ({ on, guildId }) => card({
  icon: on ? 'bell' : 'mute', title: on ? 'Level-Up Messages On' : 'Level-Up Messages Off', accent: colors.teal,
  description: on ? 'I will message you when you level up.' : 'I will not message you about levelling up. You can still check anytime with `/level`.',
  rows: [row(dmButton(guildId, on))],
});

// ---------- the guide panel in level-ups ----------

function guidePanel() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('level:guide')
    .setPlaceholder('Choose a level to see what it unlocks')
    .addOptions([
      { label: 'How it works', value: 'how', description: 'How you earn XP and what counts', ...withEmoji('info') },
      ...levels.ladder.map((l) => ({
        label: `Level ${l.level} | ${l.title}`, value: `l${l.level}`,
        description: `Unlocks: ${l.perks.map(perkName).join(' and ')}`.slice(0, 100), ...withEmoji(perks[l.perks[0]].icon),
      })),
      { label: 'XP boosts', value: 'xp', description: 'Streaks, events and the question bonus', ...withEmoji('zap') },
      { label: 'Booster perks', value: 'boosters', description: 'Everything server boosters get', ...withEmoji('gem') },
    ]);
  return card({
    banner: 'levels',
    icon: 'level_up',
    title: 'Levels and Perks',
    description:
      'Chat and take part to earn XP, and unlock perks as you level up. Pick a level from the menu to see what it gives you.\n' +
      `Check your own progress anywhere with ${fmt.code('/level')}. Only you can see it.`,
    blocks: [levels.ladder.map((l) => `**${l.level}**  ${ic(perks[l.perks[0]].icon)}${l.perks.map(perkName).join(' and ')}`).join('\n')],
    rows: [row(menu)],
  });
}

function levelDetail(n) {
  const l = levels.ladder[n - 1];
  const previous = levels.ladder[n - 2]?.xp ?? 0;
  return card({
    banner: 'levels',
    icon: perks[l.perks[0]].icon,
    title: `Level ${l.level} | ${l.title}`,
    description: l.perks.map((k) => `### ${ic(perks[k].icon)}${perks[k].name}\n${perks[k].detail}`).join('\n'),
    fields: [
      ['XP Needed', fmt.code(`${num(l.xp)} total`), 'stats'],
      ['From Level Before', fmt.code(`${num(l.xp - previous)} XP`), 'level_up'],
      ['Typical Time', `${L.estimateText(l.xp)} of regular chatting`, 'clock'],
    ],
  });
}

const detail = {
  how: () => card({
    banner: 'levels', icon: 'info', title: 'How It Works',
    description: [
      `${ic('chat')}Chat in the community channels. Each message is worth ${levels.xp.min} to ${levels.xp.max} XP.`,
      `${ic('clock')}One message a minute counts, so spamming does not help. Very short and repeated messages earn nothing.`,
      `${ic('lock')}XP is not earned in the Important category, media, creations, bot, staff, log or ticket channels.`,
      `${ic('level_up')}The first level takes about two messages. Later levels take longer each time.`,
      `${ic('shield')}Only your XP total is kept. Tower never stores what you write.`,
      `${ic('leave')}If you leave the server, your XP is deleted straight away.`,
    ].join('\n'),
  }),
  xp: () => card({
    banner: 'levels', icon: 'zap', title: 'XP Boosts',
    description: [
      `### ${ic('fire')}Streaks`,
      `Chat on consecutive days for up to **+${levels.streak.maxDays * levels.streak.perDay * 100}%** XP. The Streak Shield (level ${L.perkLevel('shield')}) forgives one missed day.`,
      `### ${ic('party')}Double XP weekends`,
      'Staff switch these on for special occasions. Everyone earns more while they last.',
      `### ${ic('gem')}Boosting`,
      `Server boosters earn **x${levels.booster.multiplier}** XP all the time.`,
    ].join('\n'),
  }),
  boosters: () => card({
    banner: 'boost', icon: 'gem', title: 'Booster Perks', accent: colors.cobalt,
    description: [
      `${ic('zap')}**x${levels.booster.multiplier} XP** on everything you earn`,
      `${ic('unlock')}**Instant perks:** ${levels.booster.instant.map(perkName).join(', ')}, the moment you boost`,
      `${ic('eye')}**Early access** to videos and previews, the same as the Insider perk`,
      `${ic('sparkle')}**Your own name colour** with ${fmt.code('/booster colour')}, any colour you like`,
      `${ic('gift')}**Double giveaway entries**`,
      `${ic('medal')}**Anniversary roles** for ${levels.booster.anniversaryMonths.map(anniversaryLabel).join(', ')} of boosting`,
      `${ic('heart')}Booster-only emojis, and our thanks`,
    ].join('\n'),
  }),
};

const guideTopic = (value) => (value.startsWith('l') ? levelDetail(Number(value.slice(1))) : detail[value]());

// ---------- name colours ----------

function colourMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('level:colour')
    .setPlaceholder('Choose your name colour')
    .addOptions([
      ...colours.map((c) => ({ label: c.label, value: c.key, description: `#${c.hex.toString(16).padStart(6, '0')}` })),
      { label: 'No colour', value: 'none', description: 'Go back to the default' },
    ]);
  return card({
    icon: 'sparkle', title: 'Name Colour',
    description: 'Pick a colour for your name. You can change it whenever you like.',
    rows: [row(menu)],
  });
}

// ---------- staff ----------

function adminChange({ userId, before, after, byId, action }) {
  return card({
    icon: 'level_up', title: `Level ${action}`,
    fields: [
      ['Member', fmt.user(userId), 'user'],
      ['Level', `${fmt.code(before.level)} to ${fmt.code(after.level)}`, 'level_up'],
      ['XP', `${fmt.code(num(before.xp))} to ${fmt.code(num(after.xp))}`, 'stats'],
      ['By', fmt.user(byId), 'staff'],
    ],
  });
}

function configView({ state, defaults, event, guild }) {
  const ids = (m, fmtFn) => (m.size ? [...m.keys()].slice(0, 12).map(fmtFn).join(' ') : fmt.code('none'));
  const rules = state.rows ?? [];
  const staff = (kind, mode) => rules.filter((r) => r.kind === kind && r.mode === mode);
  const list = (arr, fmtFn) => (arr.length ? arr.slice(0, 12).map((r) => fmtFn(r.target_id)).join(' ') : fmt.code('none'));
  const mults = [...state.channelMultipliers].map(([id, m]) => `${fmt.channel(id)} x${m}`).concat([...state.roleMultipliers].map(([id, m]) => `${fmt.role(id)} x${m}`));
  return card({
    icon: 'settings', title: 'Level Settings',
    fields: [
      ['Ignored By Default, Channels', ids(defaults.channels, fmt.channel), 'lock'],
      ['Ignored By Default, Categories', ids(defaults.categories, fmt.channel), 'folder'],
      ['Ignored By Staff, Channels', list(staff('channel', 'ignore'), fmt.channel), 'ban'],
      ['Allowed By Staff', list(staff('channel', 'allow'), fmt.channel), 'check'],
      ['Ignored Roles', list(staff('role', 'ignore'), fmt.role), 'staff'],
      ['Multipliers', mults.length ? mults.slice(0, 12).join(' ') : fmt.code('none'), 'zap'],
      ['Timed Event', event ? `x${event.multiplier} until ${fmt.time(event.endsAt, 'R')}` : fmt.code('none running'), 'party'],
    ],
  });
}

function syncView({ preview, applied, result }) {
  const lines = (result.sample ?? []).map((s) => `${fmt.user(s.id)}${s.add.length ? ` +${s.add.join(', ')}` : ''}${s.remove.length ? ` -${s.remove.join(', ')}` : ''}`);
  return card({
    icon: 'check', title: applied ? 'Perks Synced' : 'Sync Preview', accent: applied ? colors.teal : colors.cobalt,
    description: lines.length ? lines.join('\n') : 'Everyone already has the right perk roles.',
    fields: [
      ['Members Affected', fmt.code(result.members), 'users'],
      ['Roles To Add', fmt.code(result.add), 'plus'],
      ['Roles To Remove', fmt.code(result.remove), 'minus'],
      ...(result.rolesToCreate.length ? [['Roles To Create', result.rolesToCreate.map(fmt.code).join(' '), 'sparkle']] : []),
      ['Applied', fmt.bold(applied ? 'Yes' : 'No, preview only. Run again with apply:true'), 'info'],
    ],
  });
}

function auditView(rows) {
  const problems = rows.filter((r) => r.issues.length);
  const lines = rows.map((r) => {
    if (!r.issues.length) return `${ic('check')}**${r.name}:** set up correctly`;
    return r.issues.map((i) => i.type === 'everyone'
      ? `${ic('warning')}**${r.name}:** @everyone can already ${i.perms.map(fmt.code).join(', ')}, so it is not a perk`
      : `${ic('warning')}**${r.name}:** the role ${r.role ? fmt.role(r.role.id) : ''} lacks ${i.perms.map(fmt.code).join(', ')}`).join('\n');
  });
  return card({
    icon: 'shield', title: 'Perk Check', accent: problems.length ? colors.alert : colors.teal,
    description: lines.join('\n'),
    blocks: [problems.length
      ? 'Turn those permissions off for @everyone in Server Settings > Roles. Missing role permissions can be added with `/levels check fix:true`.'
      : 'Every perk is gated properly.'],
  });
}

function eventView({ multiplier, endsAt, started }) {
  return card({
    icon: 'party', title: started ? `${multiplier}x XP Event Started` : 'XP Event Ended', accent: started ? colors.teal : colors.cobalt,
    description: started ? `Everyone earns **${multiplier}x** XP until ${fmt.time(endsAt, 'F')}.` : 'XP is back to normal.',
    fields: started ? [['Ends', fmt.time(endsAt, 'R'), 'clock']] : [],
  });
}

module.exports = {
  levelUpDm, dmChanged, levelView, textBar, guidePanel, guideTopic, colourMenu, adminChange, configView, syncView, auditView, eventView,
};
