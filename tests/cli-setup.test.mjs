import { test } from "node:test";
import assert from "node:assert/strict";
import { runScript } from "./cli-publish.test.mjs";

test("setup --json 缺 --token/--secret → MISSING_ARGS(不進互動模式)", () => {
  const r = runScript("threads-setup.mjs", ["--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "MISSING_ARGS");
});

test("setup --json 只給 --token 也算缺 → MISSING_ARGS", () => {
  const r = runScript("threads-setup.mjs", ["--json", "--token", "abc"]);
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "MISSING_ARGS");
});
