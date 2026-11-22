// Pure scheduler logic, so it can be tested with Node without Cloudflare runtime.
export const VERCEL_STATS_ENDPOINT =
  'https://discord-server-stats.vercel.app/api/server-stats';
export async function refreshDiscordStats(env, cooldowns = {}, fetcher = globalThis.fetch) {
  const secret = env?.TRIGGER_SECRET;
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('Configure TRIGGER_SECRET as a Cloudflare Worker secret');
  }
  const response = await fetcher(VERCEL_STATS_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cooldowns }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Vercel Discord stats update returned HTTP ${response.status}`);
  }
  const result = await response.json();
  if (result?.ok !== true || !result.cooldowns || typeof result.cooldowns !== 'object' || Array.isArray(result.cooldowns)) {
    throw new Error('Vercel returned an invalid stats response');
  }
  return result;
}
