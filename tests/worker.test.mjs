import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshDiscordStats, VERCEL_STATS_ENDPOINT } from '../worker/scheduler.js';

test('sends stored cooldowns to Vercel over authenticated POST', async () => {
  const secret = 'example-secret-123456789';
  let request;
  const result = await refreshDiscordStats({ TRIGGER_SECRET: secret }, { '323456789012345678': 1000 }, async (url, opts) => {
    request = { url, opts };
    return { ok: true, status: 200, json: async () => ({ ok: true, updated: [], deferred: [], cooldowns: {} }) };
  });
  assert.equal(request.url, VERCEL_STATS_ENDPOINT);
  assert.equal(request.opts.method, 'POST');
  assert.equal(request.opts.headers.Authorization, `Bearer ${secret}`);
  assert.deepEqual(JSON.parse(request.opts.body), { cooldowns: { '323456789012345678': 1000 } });
  assert.deepEqual(result.cooldowns, {});
});

test('rejects a missing or short Worker secret', async () => {
  await assert.rejects(refreshDiscordStats({}), /TRIGGER_SECRET/);
  await assert.rejects(refreshDiscordStats({ TRIGGER_SECRET: 'short' }), /TRIGGER_SECRET/);
});

test('reports Vercel failure without leaking credentials', async () => {
  await assert.rejects(
    refreshDiscordStats({ TRIGGER_SECRET: 'example-secret-123456789' }, {}, async () => ({ ok: false, status: 401 })),
    error => error.message === 'Vercel Discord stats update returned HTTP 401',
  );
});

test('rejects malformed successful upstream response', async () => {
  await assert.rejects(
    refreshDiscordStats({ TRIGGER_SECRET: 'example-secret-123456789' }, {}, async () =>
      ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
    /invalid stats response/,
  );
});
