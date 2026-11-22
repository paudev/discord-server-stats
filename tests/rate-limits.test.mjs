import test from 'node:test';
import assert from 'node:assert/strict';
import { updateServerStats } from '../src/server-stats.js';
import { refreshDiscordStats } from '../worker/scheduler.js';

const guildId = '123456789012345678';
const categoryId = '223456789012345678';
const memberId = '323456789012345678';
const onlineId = '423456789012345678';
const FIXED_NOW = 1700000000000;
const channels = [
  { id: categoryId, type: 4, name: '📊 SERVER STATS' },
  { id: memberId, type: 2, parent_id: categoryId, name: '👥 Members: 2,000' },
  { id: onlineId, type: 2, parent_id: categoryId, name: '🟢 Online: 300' },
];

function fetchFixture(reply) {
  const calls = [];
  async function fetcher(url, options) {
    const path = new URL(url).pathname.replace(/^\/api\/v10/, '');
    calls.push({ path, method: options.method });
    let res;
    if (path === `/guilds/${guildId}`) res = { body: { approximate_member_count: 2021, approximate_presence_count: 374 } };
    else if (path === `/guilds/${guildId}/channels`) res = { body: channels };
    else if (options.method === 'PATCH') res = reply?.(path) ?? { body: { id: path.split('/').at(-1) } };
    else throw new Error(`unexpected request: ${path}`);
    const headers = new Map(Object.entries(res.headers || {}));
    return { ok: !res.status || res.status < 400, status: res.status || 200,
      headers: { get: name => headers.get(name) ?? null }, json: async () => res.body ?? {} };
  }
  return { fetcher, calls };
}
const common = { token: 'dummy', guildId, now: () => FIXED_NOW };

test('checks both counters while deferring a cooldown-limited channel', async () => {
  const { fetcher, calls } = fetchFixture();
  const res = await updateServerStats({ ...common, fetcher, cooldowns: { [memberId]: FIXED_NOW + 120000 } });
  assert.equal(res.members, 2021);
  assert.equal(res.online, 374);
  assert.deepEqual(res.updated.map(x => x.counter), ['online']);
  assert.deepEqual(res.deferred.map(x => x.counter), ['members']);
  assert.equal(res.deferred[0].retryAfterSeconds, 120);
  assert.deepEqual(calls.filter(x => x.method === 'PATCH').map(x => x.path), [`/channels/${onlineId}`]);
});

test('persists Discord Retry-After after a 429 and lets other channels update', async () => {
  const { fetcher, calls } = fetchFixture(path => path.endsWith(memberId) ?
    { status: 429, headers: { 'retry-after': '89.25' }, body: { retry_after: 89.25, global: false } } : {});
  const first = await updateServerStats({ ...common, fetcher });
  assert.equal(first.deferred.length, 1);
  assert.equal(first.updated.length, 1);
  assert.equal(first.cooldowns[memberId], FIXED_NOW + 89250);
  const second = await updateServerStats({ ...common, fetcher, cooldowns: first.cooldowns, now: () => FIXED_NOW + 60000 });
  assert.equal(second.deferred[0].retryAfterSeconds, 30);
  assert.equal(calls.filter(x => x.path === `/channels/${memberId}`).length, 1);
});

test('honors Discord reset-after after successful rename with exhausted bucket', async () => {
  const { fetcher } = fetchFixture(path => path.endsWith(memberId) ?
    { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '300.5' } } : {});
  const res = await updateServerStats({ ...common, fetcher });
  assert.equal(res.updated.length, 2);
  assert.equal(res.cooldowns[memberId], FIXED_NOW + 300500);
});

test('honors a global 429 without writing remaining channels', async () => {
  const { fetcher, calls } = fetchFixture(path => path.endsWith(memberId) ?
    { status: 429, body: { global: true, retry_after: 45 } } : {});
  const res = await updateServerStats({ ...common, fetcher });
  assert.equal(res.updated.length, 0);
  assert.equal(res.deferred.length, 2);
  assert.equal(res.cooldowns._global, FIXED_NOW + 45000);
  assert.equal(calls.filter(x => x.method === 'PATCH').length, 1);
});

test('expired cooldowns resume updates', async () => {
  const { fetcher, calls } = fetchFixture();
  const res = await updateServerStats({ ...common, fetcher, cooldowns: { [memberId]: FIXED_NOW - 1 } });
  assert.equal(res.updated.length, 2);
  assert.equal(calls.filter(x => x.method === 'PATCH').length, 2);
});

test('global GET 429 stops follow-up requests', async () => {
  const calls = [];
  const res = await updateServerStats({ ...common, fetcher: async url => {
    calls.push(url);
    return { status: 429, ok: false, headers: { get: () => null },
      json: async () => ({ retry_after: 70, global: true }) };
  } });
  assert.equal(calls.length, 1);
  assert.equal(res.skippedGlobal, true);
  assert.equal(res.cooldowns._global, FIXED_NOW + 70000);
});

test('Worker sends and returns persisted backoff state', async () => {
  let data;
  const response = await refreshDiscordStats({ TRIGGER_SECRET: 'example-secret-123456789' }, { [memberId]: 500 }, async (_url, init) => {
    data = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ ok: true, cooldowns: { [memberId]: 600 }, updated: [] }) };
  });
  assert.deepEqual(data, { cooldowns: { [memberId]: 500 } });
  assert.equal(response.cooldowns[memberId], 600);
});

test('Discord 403 on one channel is reported as blocked rather than crashing the whole refresh', async () => {
  const { fetcher, calls } = fetchFixture(path => path.endsWith(memberId)
    ? { status: 403, body: { code: 50013, message: 'Missing Permissions' } }
    : {});
  const res = await updateServerStats({ ...common, fetcher });
  assert.equal(res.members, 2021);
  assert.equal(res.partial, true);
  assert.deepEqual(res.blocked.map(item => item.counter), ['members']);
  assert.equal(res.blocked[0].discordCode, 50013);
  assert.equal(res.blocked[0].channelId, memberId);
  assert.equal(res.updated.length, 1);
  assert.equal(res.cooldowns[memberId], FIXED_NOW + 300000);
  assert.equal(calls.filter(item => item.method === 'PATCH').length, 2);
});

test('permission denied channel is not retried at each one-minute scheduled tick', async () => {
  const { fetcher, calls } = fetchFixture(path => path.endsWith(memberId)
    ? { status: 403, body: { code: 50013 } }
    : {});
  const first = await updateServerStats({ ...common, fetcher });
  const second = await updateServerStats({
    ...common, fetcher, now: () => FIXED_NOW + 60000, cooldowns: first.cooldowns,
  });
  assert.equal(second.blocked.length, 0);
  assert.equal(second.deferred[0].counter, 'members');
  assert.equal(second.deferred[0].retryAfterSeconds, 240);
  assert.equal(calls.filter(item => item.path === `/channels/${memberId}`).length, 1);
});

test('corrected Discord permissions allow another rename after cooldown', async () => {
  let denied = true;
  const { fetcher } = fetchFixture(path => path.endsWith(memberId) && denied
    ? { status: 403, body: { code: 50013 } }
    : {});
  const first = await updateServerStats({ ...common, fetcher });
  denied = false;
  const second = await updateServerStats({
    ...common, fetcher, now: () => FIXED_NOW + 300001, cooldowns: first.cooldowns,
  });
  assert.equal(second.blocked.length, 0);
  assert.equal(second.partial, false);
  assert.ok(second.updated.some(item => item.counter === 'members'));
});
