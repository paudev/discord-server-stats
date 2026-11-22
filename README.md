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

## Discord channel permissions and HTTP 403

If the Cloudflare Worker reports a Vercel 502 and Vercel logs show `Discord PATCH /channels/... failed (HTTP 403)`, the bot cannot rename a counter voice channel. In **Discord → Edit Category → SERVER STATS → Permissions**, explicitly give the **Server Stats bot** **View Channel** and **Manage Channels**. Check the permissions of both **Members** and **Online** voice channels as well; they may override the category.

The Vercel API now reports denied rename attempts as `ok: true, partial: true` with a `blocked` array and channel IDs. The Cloudflare Worker logs a warning rather than failing the scheduled invocation. A blocked channel is checked again after a five-minute backoff; the other counter can continue updating. A manual authenticated POST without previously supplied cooldown data checks immediately after you fix the permissions. This does not bypass Discord permissions or guarantee every-minute channel renames.

### Locked voice channels need an explicit bot exception

Discord can implicitly deny **Manage Channels** when **Connect** is denied on a voice channel. Newly created counters now explicitly give the bot member **View Channel, Connect, Manage Channels**, while denying Connect to `@everyone`. For existing counters that were created without the exception, grant these three permissions to the **bot itself** under each existing counter voice channel's **Edit Channel → Permissions**. The bot cannot automatically repair a channel it no longer has permission to access; a manual permission change is necessary. Discord error code `50001` means Missing Access (different from `50013` Missing Permissions).

### Read-only live endpoint

`GET https://discord-server-stats.vercel.app/api/stats` with `Authorization: Bearer <DISCORD_STATS_TRIGGER_SECRET>` returns the approximate Discord member/online counts and compares each existing counter channel name against the expected value. This endpoint does not rename channels or consume a scheduled update. It is protected by the same trigger secret as `POST /api/server-stats` and never returns credentials.
