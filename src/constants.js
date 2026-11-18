// Pure tuning values. No environment access here so this file stays unit-testable.
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;


// Giveaways. Entry bonuses for levels and boosters live in lib/levels.js (giveawayEntries).
const giveaways = {
  tickMs: 15_000,                       // how often Tower looks for giveaways that are due
  minDurationMs: 60_000, maxDurationMs: 30 * 24 * 60 * 60 * 1000,
  maxWinners: 20, maxActive: 10,
  defaultClaimHours: 48,
  countRefreshMs: 12_000,               // the entry counter on the card updates at most this often
  claimTicketType: 'support',           // "General Support" in the ticket panel
  ticketChannelNames: ['tickets', 'ticket', 'support', 'open-a-ticket', 'create-a-ticket', 'help-desk'],
};


// The AI assistant. The model names are Anthropic's; set ANTHROPIC_MODEL to force a different one.
const ai = {
  models: { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5' },
  maxTokens: { ask: 700, ticket: 500, summary: 800 },
  askMaxChars: 1000,                    // longest question
  maxKnowledgeChars: 40_000,            // everything the assistant is told, in total
  entryMaxChars: 8000, maxEntries: 60,
  userCooldownMs: 10_000,               // between two /ask from the same person
  ticketMaxReplies: 3, ticketCooldownMs: 8000,
  historyTurns: 3, historyTtlMs: 15 * 60 * 1000,
  logRetentionDays: 30,
  summaryMaxChars: 14_000, summaryMaxMessages: 150,
  requestTimeoutMs: 45_000,
};


// Commissions. Reviews are posted to a private staff channel and also saved in the database.
const commissions = {
  reviewChannelId: process.env.COMMISSION_REVIEW_CHANNEL_ID || null,   // where finished reviews are posted privately (optional: they are always saved and shown by /commission reviews)
  reminderTickMs: 30 * 60 * 1000,                 // how often deadlines are checked
  reminderLeadMs: 48 * 60 * 60 * 1000,            // remind when a deadline is this close, or has passed
  reminderEveryMs: 24 * 60 * 60 * 1000,           // and then at most once a day
  maxNotes: 50, maxHistory: 100,
  maxOpen: 100,
};


// Section divider roles (the "▬▬▬ PINGS ▬▬▬" kind). A member who holds any role of a section automatically holds that section's divider.
// Dividers are found by name (symbols and capitals are ignored), roles by name too. Add or rename sections here.
const dividers = {
  syncDelayMs: 1500,                    // wait this long after a role change, so a burst (like onboarding) is handled once
  groups: [
    { key: 'pings', dividerNames: ['Pings', 'Ping Roles', 'Notifications'], roles: ['Announcement', 'YouTube', 'Updates', 'Giveaway', 'QOTD', 'Event Ping'] },
    { key: 'interests', dividerNames: ['Interests', 'Hobbies'], roles: ['Reading', 'Music', 'Sports', 'Gaming', 'Cooking', 'Coding', 'Studying'] },
    { key: 'levels', dividerNames: ['Levels'], levelPerkRoles: true },     // the level perk roles and name colours
  ],
};


// AutoMod. The rules themselves (limits and switches) are stored per server and changed with /automod.
const automod = {
  warnCooldownMs: 60_000,               // one warning per person per minute, however many messages a burst contained
  noticeCooldownMs: 15_000,             // and at most one "message removed" notice per person every 15 seconds
  noticeSeconds: 8,                     // the notice deletes itself after this long
  maxWords: 300, maxDomains: 100,
  inviteCacheMs: 10 * 60 * 1000,
  trackerKeepMs: 60_000,
  settingsCacheMs: 30_000,
};


// Staff teams. Each team has a ladder from the lowest rank to its head, and roles are found by name.
// Heads manage their own team below their rank, administrators and the owner manage everything. Add a team here and the commands pick it up.
const staff = {
  staffRole: 'Staff',                   // everyone on a team also holds this role...
  headerName: 'Staff',                  // ...and the divider role with this name (the one with the ▬▬▬ symbols)
  leadershipRoles: ['Administrator', 'Co-Owner'],
  offerDays: 7,                         // how long an invitation stays open
  tickMs: 30 * 60 * 1000,
  teams: [
    { key: 'moderation', label: 'Moderation Team', teamRole: 'Moderation Team',
      ranks: [{ key: 'trial', role: 'Trial Moderator' }, { key: 'moderator', role: 'Moderator' }, { key: 'head', role: 'Head Moderator' }] },
    { key: 'community', label: 'Community Engagement Team', teamRole: 'Community Engagement Team',
      ranks: [{ key: 'trial', role: 'Trial Agent' }, { key: 'agent', role: 'Community Agent' }, { key: 'head', role: 'Head of Community' }] },
  ],
};


// Partnerships. The channel is set with /partners setup; the names here are only used to find one when none was chosen.
const partners = {
  channelNames: ['partnerships', 'partners', 'partner'],
  roleName: 'Partner',                  // optional role for a partner's representative
  adMax: 3200,                          // longest ad (a message holds 4000 characters of text in total)
  plainMax: 1900,                       // longest ad when posted as plain text
  pendingMinutes: 15,                   // how long a preview waits for the Post button
  maxImages: 4, maxImageBytes: 8 * 1024 * 1024,
  reciprocity: { firstReminderDays: 3, repeatDays: 3, graceDays: 7, tickMs: 6 * 60 * 60 * 1000 },
  sticky: { debounceMs: 4000 },
};

module.exports = {
  partners,
  staff,
  automod,
  dividers,
  commissions,
  ai,
  giveaways,
  // Cobalt and teal come straight from the panel banner. Red is reserved for alerts.
  colors: {
    cobalt: 0x2b4fc4,
    teal: 0x2a8c99,
    alert: 0xb3261e,
  },

  // Shown in the footer of every card. Change it with BOT_NAME (and optionally BRAND_EMOJI, a custom emoji
  // such as <:name:123456789>) in your .env, or edit it here.
  brand: {
    name: process.env.BOT_NAME || 'Tower',
    emoji: process.env.BRAND_EMOJI || '',
  },

  // Editable perks shown in the booster thank-you card.
  boost: {
    perks: [
      'The **Server Booster** role, shown with its own colour in the member list',
      'Our sincere thanks for helping the server grow',
    ],
  },

  logging: {
    // Recent messages kept in memory only, so deleted and edited text can be shown.
    // Nothing from this cache is ever written to the database.
    messageCache: { max: Number(process.env.MESSAGE_CACHE_MAX) || 1500, ttlMs: 3 * 60 * MINUTE },   // lower MESSAGE_CACHE_MAX on very small hosts
    eventRetentionDays: 30,       // log_events rows (no message text) older than this are pruned
    auditDelayMs: 1500,           // Discord's audit log lags a moment behind the event
    auditWindowMs: 8000,          // how recent an audit entry must be to count as the cause
    mediaMaxFiles: 4,             // deleted images re-uploaded to the media log
    mediaMaxBytes: 8 * 1024 * 1024,
    channelRefreshMs: 10 * MINUTE,
  },

  // Each log type finds its channel by name. "channel" is the trailing word(s) of the channel name.
  logTypes: {
    join:          { channel: 'join-logs',           label: 'Member joins' },
    leave:         { channel: 'leave-logs',          label: 'Member leaves' },
    kick:          { channel: 'kick-logs',           label: 'Kicks' },
    ban:           { channel: 'ban-logs',            label: 'Bans' },
    unban:         { channel: 'unban-logs',          label: 'Unbans' },
    memberUpdate:  { channel: 'member-update-logs',  label: 'Nickname and boost changes' },
    role:          { channel: 'role-logs',           label: 'Role changes' },
    mod:           { channel: 'mod-logs',            label: 'Timeouts and moderation' },
    messageEdit:   { channel: 'message-edit-logs',   label: 'Message edits' },
    messageDelete: { channel: 'message-delete-logs', label: 'Message deletes' },
    bulkDelete:    { channel: 'bulk-delete-logs',    label: 'Bulk deletes' },
    media:         { channel: 'media-logs',          label: 'Deleted images' },
    voice:         { channel: 'vc-logs',             label: 'Voice activity' },
    server:        { channel: 'server-logs',         label: 'Channel and server changes' },
    invite:        { channel: 'invite-logs',         label: 'Invites' },
    webhook:       { channel: 'webhook-logs',        label: 'Webhooks' },
    bot:           { channel: 'bot-logs',            label: 'Bots added' },
    automod:       { channel: 'automod-logs',        label: 'AutoMod actions' },
    staff:         { channel: 'staff-logs',          label: 'Staff changes' },
    cases:         { channel: 'mod-cases',          label: 'Moderation cases' },
    levels:        { channel: 'level-logs',         label: 'Manual level changes' },
  },

  moderation: {
    // Staff ranks, matched against role names (case and punctuation ignored).
    ranks: [
      { role: 'Trial Moderator', level: 1 },
      { role: 'Moderator', level: 2 },
      { role: 'Head Moderator', level: 3 },
      { role: 'Administrator', level: 4 },
      { role: 'Co-Owner', level: 4 },
    ],
    // Longest timeout each level may give, in milliseconds (Discord's own cap is 28 days).
    maxTimeoutMs: { 1: 60 * MINUTE, 2: 24 * 60 * MINUTE, 3: 28 * DAY, 4: 28 * DAY, 5: 28 * DAY },
    // Lowest level that may use each action.
    actionLevel: {
      warn: 1, note: 1, cases: 1, timeout: 1, untimeout: 1, modstats: 1,
      kick: 2,
      ban: 3, unban: 3, voidCase: 3, editAnyCase: 3, statsOthers: 3, statsTeam: 3,
      levelsAdmin: 4, contentAdmin: 4, embedAdmin: 4, giveawayManage: 4, giveawayVerify: 2, emojiAdmin: 4, logsAdmin: 4, verificationAdmin: 4, aiAdmin: 4, aiSummarize: 1, commissionManage: 4, dividersAdmin: 4, automodAdmin: 4, partnerManage: 4, ticketstats: 1, ticketBlock: 2, ticketStatsOthers: 3, ticketStatsTeam: 3, ticketSetup: 4,
    },
    escalation: { warns: 3, windowDays: 30 }, // suggest review at this many active warnings
    banConfirmMs: 60_000,                      // how long the ban confirmation button stays valid
    reasonMax: 400,
    appealText: 'If you believe this was a mistake, contact the staff team through modmail.',
  },

  tickets: {
    maxOpenPerMember: 2,
    cooldownMs: 10 * MINUTE,               // wait after a ticket closes before opening another
    inactiveHintMs: 48 * 60 * MINUTE,      // staff are reminded after the member has been silent this long
    closedKeepMs: 24 * 60 * MINUTE,        // closed channels stay (locked) this long. 0 deletes immediately
    transcriptMaxMessages: 3000,
    transcriptMaxBytes: 8 * 1024 * 1024,
    schedulerMs: 60_000,
    categoryLimit: 50,                     // Discord's cap on channels in one category
    // Choices for /ticket inactive.
    inactiveChoices: [
      { name: '6 hours', value: 6 * 60 * MINUTE },
      { name: '12 hours', value: 12 * 60 * MINUTE },
      { name: '1 day', value: 24 * 60 * MINUTE },
      { name: '2 days', value: 48 * 60 * MINUTE },
      { name: '3 days', value: 72 * 60 * MINUTE },
      { name: '7 days', value: 7 * DAY },
    ],
    // minLevel uses the moderation ranks: 2 Moderator and up, 4 Administrator and up, 5 the owner only.
    types: {
      support:     { label: 'General Support',          description: 'Questions and help from our moderators',          icon: 'question', minLevel: 2, pingRole: 'Moderator',     summary: 'Request' },
      report:      { label: 'Report a Member',          description: 'Report a member or a rule break',                 icon: 'flag',     minLevel: 2, pingRole: 'Moderator',     summary: 'Complaint' },
      services:    { label: 'Services and Commissions', description: 'Commissions and business, handled by the owner',  icon: 'code',     minLevel: 5, pingOwner: true,          summary: 'Request' },
      partnership: { label: 'Partnership',              description: 'Partner with us, reviewed by administrators',     icon: 'link',     minLevel: 4, pingRole: 'Administrator', summary: 'Proposal' },
      application: { label: 'Staff Application',        description: 'Apply for a staff position',                      icon: 'staff',    minLevel: 4, pingRole: 'Administrator', summary: 'Application' },
    },
  },

  levels: {
    // XP per counted message, and the rules that keep it fair.
    xp: { min: 15, max: 25, cooldownMs: 60_000, minLength: 4, dailySoftCap: 400, softCapRate: 0.25 },
    // Chatting several days in a row adds a small bonus: +5% per day of streak, up to +25%.
    streak: { perDay: 0.05, maxDays: 5, shieldRechargeMs: 7 * DAY },
    flushMs: 45_000,            // active members are written to the database in batches
    idleMs: 30 * MINUTE,        // members who stop chatting leave memory after this
    booster: {
      multiplier: 1.25,
      // Perks a booster has the moment they boost, whatever their level.
      instant: ['reactions', 'emojis', 'nickname', 'images', 'insider', 'colours'],
      anniversaryMonths: [1, 3, 6, 12],
    },
    // Cumulative XP needed for each level. Level 1 is two messages; level 10 is about 75 days for
    // someone sending around 20 counted messages a day.
    ladder: [
      { level: 1,  xp: 40, title: 'Cadet',           perks: ['reactions'] },
      { level: 2,  xp: 140, title: 'Airman',          perks: ['emojis'] },
      { level: 3,  xp: 470, title: 'Wingman',         perks: ['nickname'] },
      { level: 4,  xp: 1200, title: 'Navigator',       perks: ['images'] },
      { level: 5,  xp: 2560, title: 'Pilot',           perks: ['voice'] },
      { level: 6,  xp: 4820, title: 'Flight Lead',     perks: ['colours'] },
      { level: 7,  xp: 8310, title: 'Captain',         perks: ['giveaway'] },
      { level: 8,  xp: 13380, title: 'Squadron Leader', perks: ['shield', 'qotd'] },
      { level: 9,  xp: 20430, title: 'Commander',       perks: ['insider'] },
      { level: 10, xp: 29890, title: 'Ace',             perks: ['elite'] },
    ],
    startTitle: 'Passenger',
  },

  // Perks with a "role" are delivered through a Discord role (that is how Discord permissions work).
  // Perks without one are rules Tower applies itself. "aliases" are the names Tower looks for first,
  // so it uses the roles you already made. "create" roles are made by Tower if they do not exist.
  perks: {
    reactions: { name: 'Reactions', icon: 'heart',     summary: 'Add reactions to messages',
      detail: 'React to any message with any emoji, so you can join in on the conversation without a reply.',
      role: { aliases: ['Reaction', 'Reactions'], permissions: ['AddReactions'] } },
    emojis:    { name: 'Emojis',    icon: 'party',     summary: 'Use emojis and stickers from other servers',
      detail: 'Use external emojis and stickers in your messages.',
      role: { aliases: ['Emoji', 'Emojis'], permissions: ['UseExternalEmojis', 'UseExternalStickers'] } },
    nickname:  { name: 'Nickname',  icon: 'edit',      summary: 'Change your own nickname',
      detail: 'Set your own nickname in the server.',
      role: { aliases: ['Nickname', 'Nicknames'], permissions: ['ChangeNickname'] } },
    images:    { name: 'Images',    icon: 'image',     summary: 'Send images, files and link previews',
      detail: 'Attach images and files, and have your links show a preview.',
      role: { aliases: ['Images', 'Image'], permissions: ['AttachFiles', 'EmbedLinks'] } },
    voice:     { name: 'Voice',     icon: 'headphones', summary: 'Join voice channels and go live',
      detail: 'Join voice channels, speak, share your screen and stream. Until you unlock this you can listen to nothing, so get chatting.',
      role: { name: 'Voice', aliases: ['Voice', 'Voice Chat'], permissions: ['Connect', 'Speak', 'Stream', 'UseVAD'], create: true } },
    colours:   { name: 'Name Colours', icon: 'sparkle', summary: 'Pick your name colour',
      detail: 'Run `/colour` anywhere and choose a name colour from the palette. Change it whenever you like.' },
    giveaway:  { name: 'Giveaway Bonus', icon: 'gift', summary: 'An extra entry in every giveaway',
      detail: 'You get one extra entry in giveaways. Reach level 10 for another.' },
    shield:    { name: 'Streak Shield', icon: 'shield', summary: 'Miss a day without losing your streak',
      detail: 'If you miss a day, your streak survives. The shield recharges after a week.' },
    qotd:      { name: 'Question Suggestions', icon: 'question', summary: 'Suggest the daily question',
      detail: 'Suggest a question for the question of the day. The best ones get picked.' },
    insider:   { name: 'Insider', icon: 'eye', summary: 'Early access to videos and previews',
      detail: 'See new videos, updates and behind-the-scenes previews before everyone else. Server boosters have this access too.',
      role: { name: 'Insider', aliases: ['Insider'], permissions: [], create: true, colour: 0x2b4fc4 } },
    elite:     { name: 'Elite', icon: 'crown', summary: 'The top role, shown above everyone',
      detail: 'A standout Elite role, shown separately in the member list. You also get a third giveaway entry, and you can request a custom emoji and be considered for a shoutout.',
      role: { name: 'Elite', aliases: ['Elite'], permissions: [], create: true, hoist: true, colour: 0xf2a24a } },
  },

  // Name colours for /colour. Each becomes a role on first use.
  colours: [
    { key: 'cobalt', label: 'Cobalt', hex: 0x2b4fc4 }, { key: 'sky', label: 'Sky', hex: 0x4aa3ff },
    { key: 'teal', label: 'Teal', hex: 0x2a8c99 },     { key: 'mint', label: 'Mint', hex: 0x3ddc97 },
    { key: 'amber', label: 'Amber', hex: 0xf2a24a },   { key: 'orange', label: 'Orange', hex: 0xff7a45 },
    { key: 'rose', label: 'Rose', hex: 0xff5c8a },     { key: 'crimson', label: 'Crimson', hex: 0xd6324a },
    { key: 'violet', label: 'Violet', hex: 0x8b5cf6 }, { key: 'silver', label: 'Silver', hex: 0xb8c0cc },
  ],

  youtube: {
    pollMs: 5 * MINUTE,
    maxAgeMs: 3 * DAY,                 // a video older than this is never posted, even if Tower missed it
    channelUrl: '',
    // Used when the setting has not been saved yet.
    defaults: { pingRoleId: null, insiderChannelId: null },
    hype: {
      video: ['Fresh out of the editor.', 'Just dropped. Be one of the first to watch.', 'New upload. Grab a snack and press play.',
        'Hot off the press, and made for you.', 'Drop what you are doing, this one is new.'],
      short: ['Quick one. Under a minute.', 'Fresh short. Blink and you will miss it.', 'A new short just landed.', 'Short, sharp and brand new.'],
    },
  },

  qotd: {
    // Community Engagement Team roles (and Administrator and up) can manage the daily question.
    managerRoles: ['Trial Agent', 'Community Agent', 'Head of Community', 'Community Engagement Team'],
    archiveMinutes: 1440,
    lowQueue: 3,                       // warn staff when fewer than this many questions are left
    maxLength: 300,
  },


  // Raid mode trips when this many members join inside the window.
  raid: { threshold: 10, windowMs: 10_000 },

  verification: {
    maxStrikes: 3,              // failed sessions before the member is removed
    strikeResetMs: DAY,         // strikes older than this are forgotten
    maxRefreshes: 3,            // "New Code" presses per session
    highRiskAccountAgeMs: 7 * DAY,
    elevatedAccountAgeMs: 30 * DAY,
    staleSessionCleanupMs: 10 * MINUTE,
  },

  // Captcha difficulty by risk tier.
  tiers: {
    1: { label: 'Standard', length: 5, lines: 4,  dots: 90,  rotation: 0.2,  wave: 3, attempts: 3, ttlMs: 2 * MINUTE, cooldownMs: 5 * MINUTE },
    2: { label: 'Elevated', length: 6, lines: 7,  dots: 150, rotation: 0.32, wave: 5, attempts: 3, ttlMs: 3 * MINUTE, cooldownMs: 10 * MINUTE },
    3: { label: 'High',     length: 7, lines: 11, dots: 230, rotation: 0.42, wave: 7, attempts: 2, ttlMs: 3 * MINUTE, cooldownMs: 30 * MINUTE },
  },
};

// ---------------------------------------------------------------------------------------------------------
// Optional overrides. Copy tower.config.example.json to tower.config.json and change only what you need
// (role names, ticket types, level titles, colours...). It is merged on top of the defaults above, so you
// never have to edit this file and updates to Tower will not collide with your settings.
// Objects are merged key by key; arrays and values are replaced. Set TOWER_CONFIG to use another path.
// ---------------------------------------------------------------------------------------------------------
const fs = require('node:fs');
const path = require('node:path');

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(target, source, trail = '') {
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('_')) continue;                                  // "_comment" keys are ignored
    if (isPlain(value) && isPlain(target[key])) merge(target[key], value, `${trail}${key}.`);
    else if (key in target || trail) target[key] = value;
    else console.warn(`[config] tower.config.json: unknown setting "${trail}${key}" was ignored`);
  }
}

const overridePath = process.env.TOWER_CONFIG || path.join(__dirname, '..', 'tower.config.json');
if (fs.existsSync(overridePath)) {
  try {
    merge(module.exports, JSON.parse(fs.readFileSync(overridePath, 'utf8')));
    console.log(`[config] loaded ${path.basename(overridePath)}`);
  } catch (err) {
    console.error(`[config] could not read ${overridePath}: ${err.message}. Using the defaults.`);
  }
}
