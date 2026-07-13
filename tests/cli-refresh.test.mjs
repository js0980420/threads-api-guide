import { test } from "node:test";
import assert from "node:assert/strict";
import { runScript } from "./cli-publish.test.mjs";

test("refresh:無 token → MISSING_TOKEN", () => {
  const r = runScript("threads-refresh-token.mjs", ["--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "MISSING_TOKEN");
});

test("refresh:距到期 >10 天 → refreshed:false,不打網路", () => {
  const r = runScript("threads-refresh-token.mjs", ["--json"], {
    THREADS_ACCESS_TOKEN: "fake",
    THREADS_TOKEN_EXPIRES_AT: new Date(Date.now() + 50 * 86_400_000).toISOString(),
  });
  assert.equal(r.status, 0);
  assert.equal(r.lastJson.ok, true);
  assert.equal(r.lastJson.refreshed, false);
  assert.ok(r.lastJson.daysLeft > 40);
});

test("refresh:已過期 → TOKEN_EXPIRED 指向重跑 setup", () => {
  const r = runScript("threads-refresh-token.mjs", ["--json"], {
    THREADS_ACCESS_TOKEN: "fake",
    THREADS_TOKEN_EXPIRES_AT: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "TOKEN_EXPIRED");
  assert.match(r.lastJson.action, /threads-setup/);
});
