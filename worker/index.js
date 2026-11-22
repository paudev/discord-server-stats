// Cloudflare Cron Trigger. Vercel remains the only Discord API backend.
export const VERCEL_STATS_ENDPOINT =
  "https://discord-server-stats.vercel.app/api/server-stats";

export async function refreshDiscordStats(env, fetcher = globalThis.fetch) {
  const secret = env?.TRIGGER_SECRET;
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error("Configure TRIGGER_SECRET as a Cloudflare Worker secret");
  }

  const response = await fetcher(VERCEL_STATS_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    // Don't log the response body: it could contain sensitive details.
    throw new Error(`Vercel Discord stats update returned HTTP ${response.status}`);
  }

  return response.status;
}

export default {
  // Cloudflare calls this handler from the wrangler.jsonc cron schedule.
  async scheduled(_event, env) {
    await refreshDiscordStats(env);
    console.log("[discord-stats-scheduler] Server stats updated");
  },

  // Lightweight worker health check; no public manual trigger.
  fetch() {
    return new Response("Discord Server Stats scheduler is deployed.", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
