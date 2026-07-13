import { test } from "node:test";
import assert from "node:assert/strict";
import { runScript } from "./cli-publish.test.mjs";

test("setup --json 缺 --token → MISSING_ARGS(不進互動模式)", () => {
  const r = runScript("threads-setup.mjs", ["--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "MISSING_ARGS");
});

test("setup 從環境取得密鑰;未設定 → MISSING_APP_SECRET", () => {
  const r = runScript("threads-setup.mjs", ["--json", "--token", "abc"]);
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "MISSING_APP_SECRET");
});

test("setup 禁止用 --secret 傳入密鑰", () => {
  const r = runScript("threads-setup.mjs", ["--json", "--token", "abc", "--secret", "unsafe"]);
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "SECRET_IN_CLI_NOT_ALLOWED");
});
