import { DurableObject } from 'cloudflare:workers';
import { refreshDiscordStats } from './scheduler.js';
// SQLite-backed Durable Object persists Discord's per-channel Retry-After cooldowns.
// It also serializes scheduled invocations so two concurrent ticks don't race.
export class StatsSync extends DurableObject {
  async fetch(request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (this.pending) return Response.json({ ok: true, busy: true });
    this.pending = (async () => {
      const cooldowns = await this.ctx.storage.get('cooldowns') ?? {};
      const result = await refreshDiscordStats(this.env, cooldowns);
      await this.ctx.storage.put('cooldowns', result.cooldowns);
      return result;
    })();
    try {
      const result = await this.pending;
      return Response.json({ ok: true, updated: result.updated?.length ?? 0,
        deferred: result.deferred?.length ?? 0, blocked: result.blocked?.length ?? 0,
        unchanged: result.unchanged?.length ?? 0, partial: result.partial === true });
    } finally {
      this.pending = null;
    }
  }
}
export default {
  async scheduled(_controller, env) {
    const id = env.STATS_SYNC.idFromName('default');
    const response = await env.STATS_SYNC.get(id).fetch('https://internal/tick', { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Stats scheduler failed (HTTP ${response.status})`);
    }
    const data = await response.json();
    if (data.partial || data.blocked > 0) {
      console.warn('[discord-stats-scheduler] Discord permissions blocked counter updates', JSON.stringify(data));
    } else {
      console.log('[discord-stats-scheduler]', JSON.stringify(data));
    }
  },
  fetch() {
    return new Response('Discord Server Stats scheduler is deployed.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
