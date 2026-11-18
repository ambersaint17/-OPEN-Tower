<div align="center">

# Tower

**An open-source Discord bot for running a real community.**
Verification, moderation, tickets, levels, giveaways, logging, staff tools and more, all in one bot you host yourself.

Node.js 20+ · discord.js 14 · Components V2 · Postgres (Supabase) · MIT licensed

</div>

---

## What you get

| | |
| --- | --- |
| **Safety** | Captcha verification with raid mode, AutoMod, warnings/timeouts/kicks/bans with case history, full server logging |
| **Support** | Tickets with transcripts, ratings and inactivity auto-close, an optional AI assistant, commissions and reviews |
| **Community** | Levels, XP and perks, giveaways, question of the day, YouTube announcements, booster and divider roles, partnerships |
| **Staff** | Offers, promotions, demotions, rosters, an embed builder and a role-aware `/help` |

Every message Tower sends is a Components V2 card. It is multi-server ready, has **no hardcoded IDs**, ships with **no custom images** (banners are optional), and is tuned to run on small free hosts. 300 automated tests cover it. Every command and option is described in the [feature guide](docs/FEATURES.md).

> Tower started as the bot for one Discord server and was cleaned up so anyone can run it. Your data stays in **your** database, and nothing is sent anywhere except to Discord (and to an AI provider, only if you turn the assistant on).

---

## Setup tutorial

Allow about 20 minutes. You need three things: a Discord bot, a free Supabase database, and somewhere to run it.

### Step 1: Create the Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**. Name it.
2. Copy the **Application ID** (General Information page). This is your `CLIENT_ID`.
3. Open the **Bot** tab and click **Reset Token**. Copy it. This is your `DISCORD_TOKEN`. Treat it like a password and never post it.
4. On the same tab, under **Privileged Gateway Intents**, turn on **Server Members Intent** and **Message Content Intent**. Leave Presence off.
5. Open **OAuth2 → URL Generator**. Tick the scopes **bot** and **applications.commands**, then the permission **Administrator** (the simplest option; Tower creates roles, manages channels and moderates members). Open the generated URL and add the bot to your server.

### Step 2: Create a Supabase database

1. Sign up at [supabase.com](https://supabase.com) and create a **New project**. Choose a region near where you will host the bot and set a **database password**. Save it.
2. When the project is ready, open **SQL Editor → New query**.
3. Open [`sql/000_full_schema.sql`](sql/000_full_schema.sql) from this repository, copy the whole file, paste it into the editor and press **Run**. You should see "Success". (It is safe to run again.)
4. Click **Connect** at the top of the dashboard and copy the **Session pooler** connection string. It looks like `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-region.pooler.supabase.com:5432/postgres`. Put your real password in place of `[YOUR-PASSWORD]`. This is your `DATABASE_URL`.
   - Use the **Session pooler** string, not "Direct connection" (that one needs IPv6, which most free hosts lack).
   - If your password contains `@ : / # ?` or spaces, URL-encode it (`@` becomes `%40`), or simply reset it to letters and numbers.
5. You do not need to touch Row Level Security. Tower connects as the database owner, and the tables are locked against the public API on purpose.

> Supabase pauses free projects that stay unused for a while. Tower talks to the database constantly, so an online bot keeps it awake, but check Supabase's current free-plan terms.

### Step 3: Configure Tower

```bash
git clone https://github.com/YOUR-USERNAME/tower.git
cd tower
npm install
cp .env.example .env
```

Open `.env` and fill in the four required values:

| Variable | Where it comes from |
| --- | --- |
| `DISCORD_TOKEN` | Step 1.3 |
| `CLIENT_ID` | Step 1.2 |
| `DATABASE_URL` | Step 2.4 |
| `CAPTCHA_SECRET` | Any long random text. Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Put your test server's ID in `GUILD_ID` while you set things up, so commands appear instantly. Everything else in `.env.example` is optional and explained there.

### Step 4: Start Tower

```bash
npm start              # or: npm run start:lowmem on a small host
```

On startup Tower registers its slash commands by itself (instantly in `GUILD_ID`'s server, or everywhere if you left it empty) and uploads its UI icons as application emojis. Give it a few seconds, then type `/` in your server. You can also register the commands manually with `npm run deploy`.

### Step 5: Set up your server

Run these in your server as an administrator:

1. **Put Tower's role high enough.** In *Server Settings → Roles*, drag Tower's role above every role it needs to manage (verification roles, perk roles, staff ranks).
2. **Verification:** create an "Unverified" role and a "Verified" role, then run `/verification setup` and choose a verify channel, a log channel and those two roles. Tower posts the captcha panel. Your server's real channels should only be visible to the Verified role.
3. **Tickets:** create a channel category for tickets, a staff channel for new-ticket alerts and a transcripts channel, then run `/ticket setup`.
4. **Staff ranks:** moderation permissions follow role *names*. Create roles called `Trial Moderator`, `Moderator`, `Head Moderator`, `Administrator` and `Co-Owner` (any you want to use), or use your own names via [`tower.config.json`](#customising).
5. **Logging:** create channels with these names and Tower finds them on its own: `join-logs`, `leave-logs`, `kick-logs`, `ban-logs`, `unban-logs`, `member-update-logs`, `role-logs`, `mod-logs`, `message-edit-logs`, `message-delete-logs`, `bulk-delete-logs`, `media-logs`, `vc-logs`, `server-logs`, `invite-logs`, `webhook-logs`, `bot-logs`, `automod-logs`, `staff-logs`, `mod-cases` and `level-logs`. Make only the ones you want, then use `/logs status` to see the result and `/logs refresh` after renaming a channel.
6. **Optional:** `/levels check`, `/automod`, `/qotd`, `/giveaway`, `/youtube setup`, `/partner setup`, and `/emoji sync` (adds Tower's emoji pack to your server). `/help` shows each person only the commands they can use.

The [feature guide](docs/FEATURES.md) lists every command and what it does.

---

## Hosting for free (or nearly)

Tower is a long-running process, not a website, and it only needs outbound internet access. It fits on small machines: about 150 to 250 MB of memory in normal use.

| Where | Notes |
| --- | --- |
| **Your own PC or a Raspberry Pi** | The easiest. `npm start`, keep it running (use `pm2` to restart it on a crash: `npm i -g pm2 && pm2 start npm --name tower -- run start:lowmem`). |
| **A free VPS** (for example Oracle Cloud's always-free tier) | Best uptime for free, if you can get one. Install Node 20+, clone, `pm2`. |
| **Bot-hosting panels** (Pterodactyl-style hosts) | Upload the files, set the start command to `npm run start:lowmem`, add your variables in the panel. |
| **Docker hosts** (Fly.io, Koyeb, Railway, Render...) | Use the included `Dockerfile`. If the host insists on a web port, it sets `PORT` and Tower answers a tiny health check automatically. |

Free plans and their limits change often, so read the host's current terms. Two things to watch: hosts that **sleep** idle web services will disconnect the bot (choose a worker-style plan, or ping the health URL), and memory under about 256 MB is tight. If you are short on RAM:

```env
MESSAGE_CACHE_MAX=500
CAPTCHA_POOL_SIZE=0
DB_POOL_MAX=2
```

Never commit your `.env` file. It is already in `.gitignore`.

---

## Customising

You do not need to edit the code.

- **Name and emoji:** set `BOT_NAME` and `BRAND_EMOJI` in `.env`.
- **Roles, ranks, ticket types, level titles, colours:** copy `tower.config.example.json` to `tower.config.json` and change what you want. It is merged over the defaults, so you only list what differs. (All the defaults are in [`src/constants.js`](src/constants.js).)
- **Banners:** Tower ships without images. To add some, follow [`assets/images/README.md`](assets/images/README.md).
- **AI assistant:** put an `AI_API_KEY` in `.env` (OpenRouter has free models) and use `/ask`. Leave it empty to keep AI off.
- **Commission reviews:** set `COMMISSION_REVIEW_CHANNEL_ID`, or make a channel named `commission-reviews`.

---

## Updating

```bash
git pull
npm install
```

Restart Tower afterwards; it re-registers its commands on startup.

If a release adds database tables, it adds a new file under `sql/`. Run that file in the Supabase SQL Editor (or just re-run `sql/000_full_schema.sql`, which is safe to repeat).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Slash commands do not show | Look for `[commands] registration failed` in the console. Check the bot was invited with the `applications.commands` scope. With `GUILD_ID` set they appear instantly in that server; without it, global commands can take a while. `npm run deploy` registers them manually. |
| `Used disallowed intents` | Turn on Server Members and Message Content intents (Step 1.4). |
| Database errors or `ENOTFOUND` | Use the **Session pooler** string, check the password (and URL-encoding), and make sure you ran the SQL in Step 2.3. |
| "Missing permissions" or roles not given | Move Tower's role above the roles it manages and check the role names. |
| Bot keeps restarting on a small host | Use `npm run start:lowmem` and the low-memory settings above. |
| Captcha shows no letters | The font file `assets/fonts/captcha.ttf` must be present. |

Still stuck? Open an [issue](../../issues) with the console output (remove your token first).

## Development

```bash
npm test      # 300 tests; no .env or database needed
```

Pull requests are welcome. Please keep new features free of hardcoded IDs and names, and add tests.

## License

[MIT](LICENSE). Use it, change it, run it for your community.
