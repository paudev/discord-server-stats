# Discord Server Stats

Standalone Discord member and online-count voice channel counters, deployed to Vercel. This project is **separate** from the P2E Discord bot.

## Features

- Automatically creates a `📊 SERVER STATS` category with voice-channel counters:
  - `👥 Members: 2,021`
  - `🟢 Online: 374`
- Uses the Discord REST API's approximate server counts without requiring an always-connected gateway bot.
- Sets new counter voice channels to visible but not joinable by @everyone.
- Updates only when the count has changed.
- GitHub Actions workflow runs approximately every 10 minutes; scheduling delays and Discord channel rate limits may apply.
- Authenticated Vercel endpoint for manual or external updates.

## GitHub Actions setup (recommended for automatic updates)

1. Create a Discord bot in [Discord Developer Portal](https://discord.com/developers/applications). Invite it with **View Channels**, **Manage Channels** and **Manage Roles** permissions.
2. Enable Developer Mode in Discord and copy the **Server ID** from the server context menu.
3. In this repository, open **Settings → Secrets and variables → Actions**.
   - Add **secret** `DISCORD_STATS_BOT_TOKEN` with your Discord bot token.
   - Add **variable** `DISCORD_STATS_GUILD_ID` with your Discord Server ID.
   - Optionally set **variable** `DISCORD_STATS_CATEGORY_ID` to the ID of a pre-existing category.
4. Go to **Actions → Discord server stats → Run workflow**. On the first run, the category and counters are created if necessary.
5. The scheduled workflow is disabled until `DISCORD_STATS_GUILD_ID` is set.

## Vercel API (optional)

`GET /api/health` reports whether the application has bot credentials configured.

`POST /api/server-stats` triggers one update. Configure the following Vercel Production environment variables:

- `DISCORD_STATS_BOT_TOKEN`: your Discord bot token
- `DISCORD_STATS_GUILD_ID`: your Discord Server ID
- `DISCORD_STATS_TRIGGER_SECRET`: random secret used as a bearer token
- `DISCORD_STATS_CATEGORY_ID`: optional existing category ID

Call the endpoint with `Authorization: Bearer <DISCORD_STATS_TRIGGER_SECRET>`. The endpoint returns 405 for GET; it requires POST.

**Note:** Vercel Hobby Cron cannot run at 10-minute intervals. For recurring updates, use the included GitHub Actions schedule instead. The GitHub workflow uses the Discord REST API directly; it does not depend on Vercel credentials or its endpoint.

## Tests

```sh
npm test
npm run check
```

Never commit Discord bot tokens or trigger secrets to the repository.
