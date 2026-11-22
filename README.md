# Discord Server Stats

A standalone Discord server counter bot. Vercel provides the authenticated Discord API; a Cloudflare Worker checks the server **once per minute**. This is independent of the P2E Discord bot, with no GitHub Actions workflow.

## Architecture

- **Vercel** (`api/server-stats.js`): Fetches approximate member/online counts from Discord. It only renames a counter when its value has changed and the channel is not in a Discord cooldown.
- **Cloudflare Worker** (`worker/index.js`): Cron `* * * * *` (once per minute), calls Vercel with the secret already configured in Cloudflare.
- **Durable Object** (`StatsSync`): Persists per-channel Discord rate-limit cooldown timestamps so later scheduled checks skip blocked renames. Its SQLite backend is available within Cloudflare Workers Free plan limits. No separate database setup is needed; Wrangler creates the namespace on deployment.

### One-minute checks are not guaranteed one-minute channel renames

Discord enforces its own channel-name update limits. Vercel interprets `429` / `Retry-After` and `X-RateLimit-*` headers. If a channel is cooling down, its update is **deferred** (not retried immediately), while other counters may still update. The Worker keeps checking every minute and attempts the newest count once the cooldown expires. `ok: true` with a nonempty `deferred` array means the check succeeded but Discord blocked some renames temporarily.

## Setup

Cloudflare Workers Builds should be connected to the `main` branch of `paudev/discord-server-stats`:

- **Build command:** leave empty
- **Deploy command:** `npx wrangler deploy`
- **Root directory:** `/`

Wrangler configuration is in `wrangler.jsonc`, including the `StatsSync` SQLite Durable Object binding and migration. Pushing to `main` deploys Vercel and, if Cloudflare Git Builds is connected and enabled, the Worker.

Store `TRIGGER_SECRET` as a **Cloudflare Worker secret**. It must equal the Vercel `DISCORD_STATS_TRIGGER_SECRET`. Do not put credentials in source code or Wrangler configuration.

The Vercel production project needs `DISCORD_STATS_BOT_TOKEN`, `DISCORD_STATS_GUILD_ID`, and `DISCORD_STATS_TRIGGER_SECRET` (plus optional `DISCORD_STATS_CATEGORY_ID`). The bot needs Discord channel-management permissions. The default category is `📊 SERVER STATS` with `👥 Members` and `🟢 Online` voice-channel counters.

## Endpoints

- `GET https://discord-server-stats.vercel.app/api/health` — reports whether required Vercel configuration is present.
- `POST https://discord-server-stats.vercel.app/api/server-stats` — manually triggers a check using the `Authorization: Bearer ...` header. A successful request returns `updated`, `unchanged`, `created`, and `deferred`, plus rate-limit cooldown data for the Worker.
- The Cloudflare Worker HTTP endpoint is a static health message and does **not** trigger a Discord update.

## Development

```sh
npm test
npm run check
```

The test suite covers rate-limit handling, per-channel cooldowns, global cooldowns, and Worker-to-Vercel payloads.
