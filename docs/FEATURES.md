# Tower: feature guide

Every feature, command and option. For installing Tower, see the [README](../README.md).

Every message is a Discord Components V2 card (the YouTube `classic` style is the one deliberate exception, so Discord can show the real video player).

## Commands
- Members: `/help`, `/ask`, `/level`, `/colour`, `/booster colour`, `/qotd suggest`. `/help` shows only what the person can use, by staff rank, level and booster status.
- Giveaways: staff run `/giveaway start|end|reroll|cancel|list` (Administrator and up) and `/giveaway verify` (Moderator and up)
- Staff: `/warn /timeout /untimeout /kick /ban /unban /note /cases /case /modstats /ticket /ticketstats`
- Administrator and up: `/verification`, `/logs`, `/levels`, `/youtube setup|style|shorts|check|test|status`, `/emoji`
- Community Engagement Team: `/qotd setup|add|list|remove|now|status`
- Administrator and up: `/embed create|edit|upload|templates|delete` (the card builder, see below)
- Server owner only: `/earlyaccess`

## YouTube
`/youtube setup youtube:@yourchannel post_channel:#new-videos ping_role:@YouTube`
If the handle cannot be resolved, paste the channel ID (starts with `UC`) instead.
`/earlyaccess title:... link:<YouTube link>` posts a card with the video thumbnail and a Watch Early button.
Or upload an image or clip with `clip:`. Clips show as a file in the card, because cards cannot play video.

## Embed builder
`/embed create` opens a private builder. Add blocks (text, text with picture, separator, image gallery, buttons, dropdown menu),
move them up and down, set the colour and banner, add text above or below the card, preview, then post to any channel.
- Ping with `@{Role Name}`, `@{Member}` and `#{channel}` anywhere in text. `@everyone` only goes out if switched on.
- "Post as" with a name and avatar posts through a webhook; leave it empty to post as Tower.
- Buttons can be links or `role:Name` buttons. A dropdown menu answers each option privately and can also give a role.
- Role buttons and menu roles can never give staff, admin, verification or level-earned roles.
- `/embed upload` adds pictures or files from your device. Templates keep links but not uploads.
- `/embed edit message:<link>` reopens any embed Tower posted.

## Giveaways
`/giveaway start prize:<text> duration:2d winners:2` posts a card with an **Enter Giveaway** button.
- Requirements (all optional, combine freely): `required_xp`, `required_level`, `required_role`, `booster_only`, `min_days`.
- Bonus entries come from the perks: 1 entry for everyone, +1 at level 7, +1 at level 10, and Server Boosters double their total.
- Requirements are checked when someone enters and again at the draw. Anyone who left the server is skipped.
- Winners get a congratulation message in the channel (with their pings) and a DM. It explains the next steps and has an
  **Open Claim Ticket** button that opens the normal General Support form, already filled in. `/giveaway verify` shows staff
  whether a member meets the requirements.
- `ping_role` pings a role with the post, `winner_note` adds a line to the winner message, `claim_hours` sets the claim window.
- `/giveaway reroll replace:@user` replaces a winner who did not claim.

## AI assistant
Needs `AI_API_KEY` in the host settings (`ANTHROPIC_API_KEY` is still read too). The service is detected from the key: `sk-or-...` is OpenRouter (it has free models), `sk-ant-...` is Anthropic. Other OpenAI-compatible services (Groq, Gemini, ...) work with `AI_BASE_URL`. The model is chosen in Discord with `/ai settings model_id:<id>` (or with `AI_MODEL` on the host); on OpenRouter it defaults to `openrouter/auto`. `/ai test` checks that the key and model work. Without a key it stays off and nothing else changes.
If the model cannot be reached or is out of credit, `/ask` answers with the closest entry of the knowledge instead.
- `/ai knowledge add|edit|view|remove|list|upload` is what it knows (rules, FAQs, services, policies). Only this knowledge is used to answer.
- `/ai settings` switches it on, picks the model (Haiku is fast and cheap, Sonnet is smarter), and sets the daily limits.
- `/ask question:... private:true|false` lets members ask privately (default) or in public. Answers carry Helpful / Not helpful buttons and a link to tickets.
- `/ai tickets type:... enabled:true` lets it give a first answer in that ticket type and keep answering the member until staff join in. It never answers in a ticket type that was not switched on, and `Talk to a human` is always there.
- `/ai summarize` (inside a ticket) gives staff a short summary of it.
- It cannot moderate, give roles or promise anything, cannot ping, and treats what members write as data, not instructions.
- Questions from `/ask` are kept for 30 days for staff to review (`/ai log`). Ticket conversations are never stored.
- Whatever is asked, and what is written in an enabled ticket, is sent to the AI provider. Tell your members.

## Commissions
`/commission new title:<what> price:<text> deadline:5d` (run inside the client's ticket to link it) tracks a commission and tells the client.
`/commission status` moves it along (Quoted, Accepted, In Progress, In Review, Delivered, Completed, On Hold, Cancelled) and updates the client in their ticket or by DM.
Completing it sends the client a **Leave A Review** button by DM: what they ordered, a rating out of 5, what went well and what could be better.
Reviews are posted privately to the review channel (set `COMMISSION_REVIEW_CHANNEL_ID`, or name a channel `commission-reviews`) and also saved, so `/commission reviews` shows them and your average.
`/commission note` keeps private notes, `/commission paid` tracks payment, and deadlines are reminded to whoever created the commission.

## Partnerships
`/partners setup channel:#partnerships` sets where ads go (`min_members` flags small servers, `partner_role` is given to each partner's representative). Then `/partner` opens a form: paste the whole ad, with the ping chosen in the command (none, @here, @everyone, or a role).
Tower reads the invite in the ad, checks it is valid, permanent and not age-restricted, shows the real server name and member count, flags banned words and servers that are already partners, and removes any pings hidden in the pasted text. A clean ad with a quiet ping posts straight away; anything with a warning, and every @everyone or @here, waits for a Post button.
Run inside a partnership ticket, it links the ticket, makes the opener the representative, and tells them in the ticket when the ad is live. Pictures: send up to 3 with `/partner image:`, or paste picture links in the ad. Uploads and Discord's own links are copied so they never expire, and other links are shown as they are. The invite link in the ad is replaced by the **Join** button (`keep_link:true` keeps it in the text too).
The partnership channel keeps a "how to mute this channel" message with a step-by-step picture at the bottom, replaced whenever something new is posted (`/partners sticky` turns it on or off and adds channels).
Reciprocity: Tower reminds whoever posted an ad, after 3 days and every 3 days after, to check that the partner posted ours, with a button to record it (`/partners reciprocal`). `/partners list` shows who has and who is overdue. Blacklist: `/partners blacklist add|remove|list`, or `/partners end blacklist:true`, blocks a server by its ID, whatever invite it uses.
`/partners list|info|end` manage the registry (ending removes the ad and the Partner role), and `/partners ourad` keeps our own ad to hand to partners.

## Staff management
`/induct member team rank [message]` sends the person a DM with **Accept** and **Decline**. Either one opens a short form with an optional note. On acceptance Tower gives the team role, the rank role, **Staff** and the staff header, then tells whoever made the offer (with the note) and logs it in the staff log channel (a channel named `staff-logs`, or any channel you pick with `/logs channel`; until one is found it uses `server-logs`). Offers expire after 7 days.
`/promote`, `/demote` and `/remove` move people along the ladder, change the roles, and tell the person by DM. `/roster` lists each team by rank (staff only), and `/offers list|cancel` shows or withdraws pending offers.
Teams and ladders are in `src/constants.js` under `staff` (override them in `tower.config.json`). Heads manage only their own team and only ranks below their own. Administrators, Executive Producers and the owner manage everything, including making heads. Tower's role must sit above every role involved.

## AutoMod
`/automod enable enabled:true` switches it on; `/automod status` shows every rule. A message that breaks a rule is removed and the member gets a warning, which is recorded as a normal case (source: AutoMod) and counts toward escalation. Staff, administrators and anyone with Manage Messages are never touched.
- **Spam:** 6 messages in 8 seconds, or the same message 3 times in 30 seconds. The whole burst is removed with one warning.
- **Mass mentions:** more than 5 people or roles in one message.
- **Links:** other servers' invites by default (your own server's invite is always fine). `/automod links mode:all` also removes any link not on the allowed domain list (`/automod domain add|remove|list`), and `exempt_level` lets trusted levels post links.
- **Formatting:** too many capitals, too many emoji, and distorted "zalgo" text. Hindi, Thai and other scripts are never flagged.
- **Banned words:** `/automod word add|remove|list`. Whole words only, so nothing like "assistant" is caught. Stretched letters and number swaps are caught, and `*word*` matches inside words.
- `/automod exempt add|remove` ignores channels, categories and roles. `/automod test text:...` shows what would happen to some text without removing anything.
- Tower needs **Manage Messages**. Edits are checked too. Ticket channels are never scanned.

## Divider roles
Anyone who holds a role from a section (pings, interests, level perks) automatically holds that section's divider, such as `▬▬▬ PINGS ▬▬▬`, and loses it when they hold none. This follows onboarding and everything else that gives roles.
`/dividers status` shows what Tower found, and `/dividers sync` fixes everyone who already has roles. Sections and role names live under `dividers` (override them in `tower.config.json`).

## Booster colour roles
A booster's personal colour role is kept directly above the Server Booster role, so the colour actually shows. Existing ones are corrected at startup and when someone boosts.

## Tests
`npm test` (no `.env` or database needed).
