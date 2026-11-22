# Discord Server Stats

A standalone Discord member and online-count voice-channel counter service deployed automatically by Vercel from `main`. This project is completely separate from the P2E Discord bot.

## Features

- Creates a `📊 SERVER STATS` category with locked voice-channel counters:
  - `👥 Members: 2,021`
  - `🟢 Online: 374`
- Uses Discord's approximate REST API counts; no persistent Discord Gateway process is needed.
- Counter voice channels are visible but not joinable by `@everyone`.
- Only renames a counter when its name needs to change.
- Exposes an authenticated Vercel endpoint to update counters on demand.

## Automatic deployment

This repository is connected to the **discord-server-stats** Vercel project. **Pushing to `main` automatically builds and deploys it.** No GitHub Actions deployment workflow is required.

Deployment and updating Discord counters are separate operations. **Deploying the service does not start a persistent background timer or periodically update Discord.** This repository intentionally contains no GitHub Actions workflow or scheduled job.

## Configure Vercel

In Vercel Project Settings → Environment Variables, set these for **Production**:

- `DISCORD_STATS_BOT_TOKEN` — bot token from https://discord.com/developers/applications (sensitive)
- `DISCORD_STATS_GUILD_ID` — Discord server ID
- `DISCORD_STATS_TRIGGER_SECRET` — a private, long random string for authenticating updates (sensitive)
- `DISCORD_STATS_CATEGORY_ID` — optional pre-existing category ID

Invite the bot to your server with the necessary channel-management permissions. Enable Discord Developer Mode to copy the server ID.

Redeploy after changing environment variables so the production deployment uses the updated configuration.

## Endpoints

- `GET /api/health` — shows whether the service has Discord credentials configured.
- `POST /api/server-stats` — creates or updates the counter channels.

To invoke the update endpoint, make an authenticated request:

```bash
curl -X POST "https://discord-server-stats.vercel.app/api/server-stats" \
  -H "Authorization: Bearer YOUR_DISCORD_STATS_TRIGGER_SECRET"
```

This returns HTTP 401 without a valid bearer token and HTTP 503 when mandatory configuration is missing.

**For continuous updating:** Vercel Hobby's built-in cron schedule supports daily frequency, not every 10 minutes. A separate scheduler or always-running process is needed for more frequent updates; this repository does not install one by default.

## Development

```sh
npm test
npm run check
```

Never commit Discord bot tokens or trigger secrets to GitHub.
