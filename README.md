# Discord Server Stats

Standalone Discord voice-channel counters hosted on **Vercel**, with an independent **Cloudflare Worker** to trigger automatic updates. No GitHub Actions.

## Architecture

- **Vercel:** serves the Discord REST API updater in `api/server-stats.js` and auto-deploys on GitHub `main` pushes.
- **Cloudflare Workers:** runs the `worker/index.js` scheduled handler every 10 minutes, calling the authenticated Vercel updater.
- **Discord:** the updater creates and refreshes a `📊 SERVER STATS` category with `👥 Members` and `🟢 Online` counters using Discord's approximate counts.

## Configure Vercel (one time)

In Vercel Project Settings → Environment Variables (Production), set:

- `DISCORD_STATS_BOT_TOKEN` — Discord bot token (sensitive)
- `DISCORD_STATS_GUILD_ID` — Discord server ID
- `DISCORD_STATS_TRIGGER_SECRET` — long random bearer secret (sensitive)
- `DISCORD_STATS_CATEGORY_ID` — optional existing category ID

Invite the bot to your server with **View Channels**, **Manage Channels**, and appropriate overwrite permissions. Redeploy Vercel after changing environment variables. Manual initialization remains available with an authenticated POST to `https://discord-server-stats.vercel.app/api/server-stats`.

## Configure Cloudflare Workers Builds (one time)

In Cloudflare Workers & Pages, create a Worker from GitHub using **`paudev/discord-server-stats`**, and fill the creation form as follows:

| Field | Value |
| --- | --- |
| Project name | `discord-server-stats` (must match `wrangler.jsonc`) |
| Build command | Leave blank |
| Deploy command | `npx wrangler deploy` |
| Preview command | `npx wrangler preview` (the default; optional previews) |
| Production branch | `main` |
| Root directory (if shown) | Repository root `/` |

Click **Deploy**. The repository already includes `wrangler.jsonc` and the Worker source; **do not replace the Vercel API code with Worker code**. Cloudflare imports the separate Worker entry point specified in `wrangler.jsonc`.

After creating the Worker, go to **Settings → Variables and Secrets** and create a **Secret**:

- Name: `TRIGGER_SECRET`
- Value: the **same value** as Vercel's `DISCORD_STATS_TRIGGER_SECRET`

Save/deploy the secret. **Never paste credentials into `wrangler.jsonc` or commit them to GitHub.**

The 10-minute schedule `*/10 * * * *` is already in `wrangler.jsonc` and is deployed with the Worker. Cloudflare may take several minutes for a new Cron Trigger to become active. After setup, verify the Worker's **Observability / Logs** and its **Cron Triggers** configuration. A 401 response indicates the Cloudflare and Vercel secrets differ.

Vercel and Cloudflare Git integrations will each deploy their own entry point on new pushes to `main`. Vercel handles the API; Cloudflare handles scheduling. They are separate deployments of one repository.

## Test and health

- Vercel health: `GET https://discord-server-stats.vercel.app/api/health`
- Worker health: the Worker's `*.workers.dev` URL returns a static healthy response but does **not** run an update when visited
- Local tests: `npm test`, `npm run check`

Discord voice-channel renames have rate limits; updates are skipped when counts haven't changed. Keep the interval at 10 minutes or slower.
