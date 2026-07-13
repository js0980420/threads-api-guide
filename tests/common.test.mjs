import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureGitignoreHasEnv, expiresAtFrom, parseArgs, saveEnvVars, shouldRefresh,
} from "../scripts/lib/threads-common.mjs";

test("parseArgs:--key value 與 boolean flag", () => {
  assert.deepEqual(
    parseArgs(["--text", "hello", "--dry-run", "--json"]),
    { text: "hello", "dry-run": true, json: true },
  );
});

test("saveEnvVars:保留既有行、更新既有 key、附加新 key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tak-"));
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, "# 註解\nOTHER=keep\nTHREADS_ACCESS_TOKEN=old\n");
  saveEnvVars(envPath, { THREADS_ACCESS_TOKEN: "new", THREADS_TOKEN_EXPIRES_AT: "2026-09-01T00:00:00.000Z" });
  const text = fs.readFileSync(envPath, "utf-8");
  assert.match(text, /^# 註解$/m);
  assert.match(text, /^OTHER=keep$/m);
  assert.match(text, /^THREADS_ACCESS_TOKEN=new$/m);
  assert.match(text, /^THREADS_TOKEN_EXPIRES_AT=2026-09-01T00:00:00\.000Z$/m);
  assert.doesNotMatch(text, /old/);
});

test("saveEnvVars:檔案不存在時建立", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tak-"));
  const envPath = path.join(dir, ".env");
  saveEnvVars(envPath, { THREADS_ACCESS_TOKEN: "t" });
  assert.match(fs.readFileSync(envPath, "utf-8"), /^THREADS_ACCESS_TOKEN=t$/m);
});

test("ensureGitignoreHasEnv:缺少時補上、已有時不動", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tak-"));
  assert.equal(ensureGitignoreHasEnv(dir).added, true);
  assert.equal(ensureGitignoreHasEnv(dir).added, false);
  assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf-8"), /^\.env$/m);
});

test("shouldRefresh:>10 天 false、<=10 天 true、缺值 true", () => {
  const now = new Date("2026-07-13T00:00:00Z");
  assert.equal(shouldRefresh("2026-09-01T00:00:00Z", now), false);
  assert.equal(shouldRefresh("2026-07-20T00:00:00Z", now), true);
  assert.equal(shouldRefresh(undefined, now), true);
});

test("expiresAtFrom:秒數轉 ISO(60 天)", () => {
  const from = new Date("2026-07-13T00:00:00.000Z");
  assert.equal(expiresAtFrom(5_184_000, from), "2026-09-11T00:00:00.000Z");
});
