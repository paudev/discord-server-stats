import test from "node:test";
import assert from "node:assert/strict";
import scheduler, { refreshDiscordStats, VERCEL_STATS_ENDPOINT } from "../worker/index.js";

test("calls Vercel with POST and a secret Authorization header", async () => {
  let request;
  const result = await refreshDiscordStats(
    { TRIGGER_SECRET: "example-secret-123456789" },
    async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  );
  assert.equal(result, 200);
  assert.equal(request.url, VERCEL_STATS_ENDPOINT);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer example-secret-123456789");
});

test("refuses to run when Cloudflare secret is missing", async () => {
  await assert.rejects(refreshDiscordStats({}), /TRIGGER_SECRET/);
  await assert.rejects(refreshDiscordStats({ TRIGGER_SECRET: "short" }), /TRIGGER_SECRET/);
});

test("surfaces an upstream failure without leaking secret", async () => {
  await assert.rejects(
    refreshDiscordStats({ TRIGGER_SECRET: "example-secret-123456789" }, async () =>
      ({ ok: false, status: 401 })),
    (error) => error.message === "Vercel Discord stats update returned HTTP 401",
  );
});

test("fetch endpoint does not trigger a Discord refresh", async () => {
  const response = scheduler.fetch();
  assert.equal(response.status, 200);
  assert.match(await response.text(), /scheduler is deployed/);
});
