import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 在空 tmp cwd 執行腳本,環境先剝除所有 THREADS_* 再套 overrides;回傳最後一行 JSON。 */
export function runScript(name, args, envOverrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tak-cli-"));
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("THREADS_")),
  );
  const res = spawnSync(process.execPath, [path.join(repoRoot, "scripts", name), ...args], {
    cwd: tmp,
    env: { ...cleanEnv, ...envOverrides },
    encoding: "utf-8",
    timeout: 15_000,
  });
  const lines = (res.stdout ?? "").trim().split("\n").filter(Boolean);
  let lastJson = null;
  try { lastJson = JSON.parse(lines[lines.length - 1]); } catch { /* 非 JSON 輸出 */ }
  return { ...res, lastJson };
}

test("publish --dry-run --json:不需 token,輸出請求計畫", () => {
  const r = runScript("threads-publish.mjs", ["--dry-run", "--text", "hi", "--json"]);
  assert.equal(r.status, 0);
  assert.equal(r.lastJson.ok, true);
  assert.equal(r.lastJson.dryRun, true);
  assert.equal(r.lastJson.request.params.media_type, "TEXT");
  assert.equal(r.lastJson.request.params.text, "hi");
});

test("publish 無內容 → MISSING_CONTENT", () => {
  const r = runScript("threads-publish.mjs", ["--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "MISSING_CONTENT");
});

test("publish --image 與 --video 衝突 → CONFLICTING_MEDIA", () => {
  const r = runScript("threads-publish.mjs", ["--image", "https://a/b.jpg", "--video", "https://a/b.mp4", "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "CONFLICTING_MEDIA");
});

test("publish 媒體 http(非 https)→ MEDIA_URL_NOT_HTTPS", () => {
  const r = runScript("threads-publish.mjs", ["--video", "http://a/b.mp4", "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "MEDIA_URL_NOT_HTTPS");
});

test("publish 無 token → MISSING_TOKEN", () => {
  const r = runScript("threads-publish.mjs", ["--text", "hi", "--json"]);
  assert.equal(r.status, 1);
  assert.equal(r.lastJson.error, "MISSING_TOKEN");
});
