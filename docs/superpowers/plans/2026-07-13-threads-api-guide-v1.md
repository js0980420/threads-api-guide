# threads-api-guide v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立開源的 Threads 官方 API 串接工具:三支零依賴 Node 腳本(setup / publish / refresh)+ 兩份 SKILL.md + 繁中 README,讓任何使用者透過自己的 AI 在 10 分鐘內完成串接並發出第一篇文。

**Architecture:** 共用邏輯抽到 `scripts/lib/threads-common.mjs`(env 讀寫、API 呼叫、錯誤診斷),三支腳本是薄殼。錯誤診斷(`diagnose()`)把 Meta 錯誤碼反查回 setup 手動步驟,是核心差異化。純函式與 CLI 皆以 `node --test` 測試,網路呼叫以注入 `fetchImpl` stub 測試,CLI 以 spawn + `--dry-run`/無網路路徑測試。

**Tech Stack:** Node ≥ 18.17(內建 fetch、node:test),ESM `.mjs`,零 runtime 依賴。

**Spec:** `docs/superpowers/specs/2026-07-13-threads-agent-kit-design.md`(同 repo)

## Global Constraints

- 零 runtime 依賴;只用 node: 內建模組;Node `>=18.17`
- 所有腳本支援 `--json`:最後一行輸出單行 JSON;成功 `{"ok":true,...}` exit 0,失敗 `{"ok":false,"error":"<CODE>","action":"<下一步指引>"}` exit 1
- App Secret 永不寫入任何檔案;`.env` 只存 `THREADS_ACCESS_TOKEN` 與 `THREADS_TOKEN_EXPIRES_AT`
- API base:`https://graph.threads.net`,版本路徑 `v1.0`
- 文件、使用者訊息、commit 一律繁體中文;commit 遵循 Conventional Commits
- 每個 commit 訊息結尾加:`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- repo 根目錄:`/home/js0980420/projects/threads-api-guide`(所有指令在此執行)
- publish 單次執行只發一篇,不做批次

---

### Task 1: 專案腳手架

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `LICENSE`

**Interfaces:**
- Produces: `npm test` = `node --test tests/`;後續所有任務以此跑測試

- [ ] **Step 1: 建立 package.json**

```json
{
  "name": "threads-api-guide",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18.17" },
  "scripts": {
    "test": "node --test tests/",
    "setup": "node scripts/threads-setup.mjs",
    "publish:threads": "node scripts/threads-publish.mjs",
    "refresh": "node scripts/threads-refresh-token.mjs"
  }
}
```

- [ ] **Step 2: 建立 .gitignore**

```
.env
node_modules/
```

- [ ] **Step 3: 建立 .env.example**

```
# 由 scripts/threads-setup.mjs 自動產生,不用手填
# App Secret 不會儲存在這裡(用完即棄)
THREADS_ACCESS_TOKEN=
THREADS_TOKEN_EXPIRES_AT=
```

- [ ] **Step 4: 建立 LICENSE(MIT)**

MIT License 全文,Copyright (c) 2026 js0980420。

- [ ] **Step 5: 驗證 + Commit**

Run: `node --test tests/ 2>&1 | tail -1` → 目前無 tests 目錄,允許報「找不到」;`node -e "console.log(JSON.parse(require('fs').readFileSync('package.json')).name)"` → `threads-api-guide`

```bash
git add package.json .gitignore .env.example LICENSE
git commit -m "chore: 專案腳手架(zero-dep Node、MIT)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 共用工具 — 純函式層

**Files:**
- Create: `scripts/lib/threads-common.mjs`(本任務只含純函式部分)
- Test: `tests/common.test.mjs`

**Interfaces:**
- Produces(後續任務依賴的精確簽名):
  - `parseArgs(argv: string[]) → {[key]: string | true}`
  - `emit(result: object, {json?: boolean}) → 0|1`(json 模式印單行 JSON;回傳 exit code)
  - `findEnvFile(startDir?) → string|null`(從 startDir 往上找 `.env`)
  - `loadEnv(startDir?) → string|null`(載入且不覆蓋既有 process.env;回傳 envPath)
  - `saveEnvVars(envPath: string, vars: object) → void`(合併寫入:保留既有行與註解,更新或附加)
  - `ensureGitignoreHasEnv(dir: string) → {added: boolean}`
  - `expiresAtFrom(expiresInSeconds: number, from?: Date) → string`(ISO)
  - `daysUntil(expiresAtIso: string, now?: Date) → number`
  - `REFRESH_THRESHOLD_DAYS = 10`
  - `shouldRefresh(expiresAtIso?: string, now?: Date) → boolean`(缺值→true)
  - `sleep(ms) → Promise<void>`

- [ ] **Step 1: 寫失敗測試**

`tests/common.test.mjs`:

```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../scripts/lib/threads-common.mjs'`

- [ ] **Step 3: 實作純函式層**

`scripts/lib/threads-common.mjs`:

```js
/**
 * scripts/lib/threads-common.mjs
 * threads-api-guide 三支腳本共用的零依賴工具。
 */
import fs from "node:fs";
import path from "node:path";

export const GRAPH = "https://graph.threads.net";
export const API_VERSION = "v1.0";
export const REFRESH_THRESHOLD_DAYS = 10;

// ---------- CLI ----------
export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i++;
    }
  }
  return opts;
}

/** json 模式印單行 JSON(最後一行);回傳 exit code。人類模式由腳本自行印訊息。 */
export function emit(result, { json = false } = {}) {
  if (json) console.log(JSON.stringify(result));
  return result.ok ? 0 : 1;
}

// ---------- .env ----------
export function findEnvFile(startDir = process.cwd()) {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadEnv(startDir = process.cwd()) {
  const envPath = findEnvFile(startDir);
  if (!envPath) return null;
  const text = fs.readFileSync(envPath, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
  return envPath;
}

/** 合併寫入 .env:保留既有行(含註解),更新既有 key,附加新 key。 */
export function saveEnvVars(envPath, vars) {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
  const lines = existing.length ? existing.split("\n") : [];
  const pending = new Map(Object.entries(vars));
  const out = lines.map((line) => {
    const eq = line.indexOf("=");
    if (eq === -1 || line.trim().startsWith("#")) return line;
    const key = line.slice(0, eq).trim();
    if (pending.has(key)) {
      const value = pending.get(key);
      pending.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [key, value] of pending) out.push(`${key}=${value}`);
  fs.writeFileSync(envPath, out.join("\n") + "\n");
}

/** 確保 dir/.gitignore 排除 .env;無 .gitignore 時建立。 */
export function ensureGitignoreHasEnv(dir) {
  const giPath = path.join(dir, ".gitignore");
  const text = fs.existsSync(giPath) ? fs.readFileSync(giPath, "utf-8") : "";
  const has = text.split("\n").some((l) => {
    const t = l.trim();
    return t === ".env" || t === "/.env" || t === "*.env" || t === ".env*";
  });
  if (has) return { added: false };
  const next = text.length && !text.endsWith("\n") ? text + "\n.env\n" : text + ".env\n";
  fs.writeFileSync(giPath, next);
  return { added: true };
}

// ---------- Token 時效 ----------
export function expiresAtFrom(expiresInSeconds, from = new Date()) {
  return new Date(from.getTime() + expiresInSeconds * 1000).toISOString();
}

export function daysUntil(expiresAtIso, now = new Date()) {
  return (new Date(expiresAtIso).getTime() - now.getTime()) / 86_400_000;
}

export function shouldRefresh(expiresAtIso, now = new Date()) {
  if (!expiresAtIso) return true; // 沒記到期日 → 保守起見換一次順便補上
  return daysUntil(expiresAtIso, now) <= REFRESH_THRESHOLD_DAYS;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/threads-common.mjs tests/common.test.mjs
git commit -m "feat: 共用工具純函式層(args/env/gitignore/token 時效)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 共用工具 — API 層與錯誤診斷

**Files:**
- Modify: `scripts/lib/threads-common.mjs`(附加到檔尾)
- Test: `tests/api.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `GRAPH`, `API_VERSION`, `sleep`
- Produces:
  - `class ThreadsApiError extends Error` — 屬性 `status: number`, `body: string`, `meta: {code?, subcode?, type?, message?, fbtrace_id?}`
  - `api({method, path, params?, token?, fetchImpl?, retryDelayMs?}) → Promise<object>`(5xx 與網路錯誤重試 ×3;4xx 直接丟 ThreadsApiError)
  - `exchangeToken({shortToken, secret, fetchImpl?}) → Promise<{access_token, expires_in}>`
  - `refreshToken({token, fetchImpl?}) → Promise<{access_token, expires_in}>`
  - `fetchMe({token, fetchImpl?}) → Promise<{id, username}>`
  - `headCheck(url, {fetchImpl?}) → Promise<{ok, status, contentType, error?}>`
  - `diagnose(err, {phase?: "setup"|"publish"|"refresh"}) → {error: string, action: string, step?: number}`

- [ ] **Step 1: 寫失敗測試**

`tests/api.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ThreadsApiError, api, diagnose, headCheck } from "../scripts/lib/threads-common.mjs";

test("api:5xx 重試後成功", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 3) return new Response("oops", { status: 500 });
    return new Response(JSON.stringify({ id: "1" }), { status: 200 });
  };
  const out = await api({ method: "GET", path: "v1.0/me", token: "t", fetchImpl, retryDelayMs: 1 });
  assert.deepEqual(out, { id: "1" });
  assert.equal(calls, 3);
});

test("api:4xx 不重試,丟 ThreadsApiError 帶 meta", async () => {
  let calls = 0;
  const body = JSON.stringify({ error: { message: "Failed to decode", code: 190, type: "OAuthException" } });
  const fetchImpl = async () => { calls++; return new Response(body, { status: 400 }); };
  await assert.rejects(
    api({ method: "GET", path: "v1.0/me", token: "t", fetchImpl, retryDelayMs: 1 }),
    (err) => err instanceof ThreadsApiError && err.meta.code === 190 && err.status === 400,
  );
  assert.equal(calls, 1);
});

test("headCheck:HEAD 被 405 拒絕時退回 Range GET", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.method);
    if (init.method === "HEAD") return new Response(null, { status: 405 });
    return new Response("x", { status: 206, headers: { "content-type": "video/mp4" } });
  };
  const r = await headCheck("https://cdn.example.com/a.mp4", { fetchImpl });
  assert.deepEqual(seen, ["HEAD", "GET"]);
  assert.equal(r.ok, true);
  assert.equal(r.contentType, "video/mp4");
});

test("headCheck:網路錯誤回 ok:false 不丟例外", async () => {
  const fetchImpl = async () => { throw new Error("ENOTFOUND"); };
  const r = await headCheck("https://nope.example.com/a.mp4", { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
});

test("diagnose:code 190 → TOKEN_INVALID_OR_EXPIRED(step 5)", () => {
  const err = new ThreadsApiError("x", { status: 400, body: "", meta: { code: 190, message: "Failed to decode" } });
  const d = diagnose(err, { phase: "setup" });
  assert.equal(d.error, "TOKEN_INVALID_OR_EXPIRED");
  assert.equal(d.step, 5);
});

test("diagnose:scope 錯誤 → MISSING_SCOPE(step 2)", () => {
  const err = new ThreadsApiError("x", { status: 403, body: "", meta: { code: 10, message: "(#10) Permission denied" } });
  assert.equal(diagnose(err).error, "MISSING_SCOPE");
});

test("diagnose:未知錯誤 → UNKNOWN + 指向排查章節", () => {
  const d = diagnose(new Error("boom"));
  assert.equal(d.error, "UNKNOWN");
  assert.match(d.action, /threads-publishing-rules/);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test`
Expected: FAIL — `api is not exported` / `ThreadsApiError is not exported`

- [ ] **Step 3: 實作 API 層(附加到 threads-common.mjs 檔尾)**

```js
// ---------- API ----------
export class ThreadsApiError extends Error {
  constructor(message, { status, body, meta }) {
    super(message);
    this.name = "ThreadsApiError";
    this.status = status;
    this.body = body;
    this.meta = meta ?? {};
  }
}

/**
 * 呼叫 graph.threads.net。5xx 與網路層錯誤重試 ×3(間隔遞增),4xx 直接丟。
 * fetchImpl / retryDelayMs 為測試注入用。
 */
export async function api({ method, path: pathSeg, params = {}, token, fetchImpl = fetch, retryDelayMs = 1000 }) {
  const url = new URL(`${GRAPH}/${pathSeg}`);
  if (token) url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    let resp;
    try {
      resp = await fetchImpl(url, { method });
    } catch (err) {
      lastErr = err;
      await sleep(retryDelayMs * (attempt + 1));
      continue;
    }
    const text = await resp.text();
    if (resp.ok) return JSON.parse(text);
    let meta = {};
    try { meta = JSON.parse(text).error ?? {}; } catch { /* body 非 JSON */ }
    const apiErr = new ThreadsApiError(
      `Threads API ${method} ${pathSeg} → HTTP ${resp.status}: ${meta.message ?? text.slice(0, 300)}`,
      { status: resp.status, body: text, meta },
    );
    if (resp.status >= 500 && attempt < 2) {
      lastErr = apiErr;
      await sleep(retryDelayMs * (attempt + 1));
      continue;
    }
    throw apiErr;
  }
  throw lastErr;
}

// ---------- 高階 API ----------
export function exchangeToken({ shortToken, secret, fetchImpl }) {
  return api({
    method: "GET",
    path: "access_token",
    params: { grant_type: "th_exchange_token", client_secret: secret, access_token: shortToken },
    fetchImpl,
  });
}

export function refreshToken({ token, fetchImpl }) {
  return api({
    method: "GET",
    path: "refresh_access_token",
    params: { grant_type: "th_refresh_token", access_token: token },
    fetchImpl,
  });
}

export function fetchMe({ token, fetchImpl }) {
  return api({ method: "GET", path: `${API_VERSION}/me`, params: { fields: "id,username" }, token, fetchImpl });
}

/** 發佈前媒體 URL 預檢:HEAD,被拒(405/403)時退回 Range GET。 */
export async function headCheck(url, { fetchImpl = fetch } = {}) {
  try {
    let resp = await fetchImpl(url, { method: "HEAD", redirect: "follow" });
    if (resp.status === 405 || resp.status === 403) {
      resp = await fetchImpl(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow" });
    }
    return {
      ok: resp.ok || resp.status === 206,
      status: resp.status,
      contentType: resp.headers.get("content-type") ?? "",
    };
  } catch (err) {
    return { ok: false, status: 0, contentType: "", error: err.message };
  }
}

// ---------- 錯誤診斷(核心差異化)----------
/**
 * 把 Meta 錯誤反查回 setup 手動步驟 / 修復動作。
 * 回傳 {error, action, step?}(機器可讀,給 --json 與呼叫端 AI)。
 * pattern 依實戰紀錄,Task 10 E2E 實測逐一確認並校正。
 */
export function diagnose(err, { phase } = {}) {
  const meta = err instanceof ThreadsApiError ? err.meta : {};
  const msg = `${meta.message ?? err.message ?? ""}`.toLowerCase();
  const code = meta.code;

  if (code === 190 || msg.includes("failed to decode") || msg.includes("session has expired") || msg.includes("cannot parse access token")) {
    return {
      error: "TOKEN_INVALID_OR_EXPIRED",
      step: 5,
      action: phase === "setup"
        ? "short-lived token 無效:確認 1 小時內取得、複製完整、且來自同一個 App(skills/threads-setup 步驟 5)"
        : "token 過期或無效。重跑 node scripts/threads-setup.mjs(重新取得 short-lived token,見 skills/threads-setup 步驟 5)",
    };
  }
  if (code === 10 || msg.includes("permission") || msg.includes("scope")) {
    return {
      error: "MISSING_SCOPE",
      step: 2,
      action: "App 缺少 threads_content_publish 權限:回 Meta 後台 Threads use case 勾選(skills/threads-setup 步驟 2),重新取 token",
    };
  }
  if (msg.includes("application does not have permission") || msg.includes("not authorized") || (msg.includes("user") && msg.includes("cannot be accessed"))) {
    return {
      error: "TESTER_NOT_ACCEPTED",
      step: 4,
      action: "Threads 帳號尚未接受 Tester 邀請:到 Threads App 設定 → 帳號 → 網站權限 接受邀請(skills/threads-setup 步驟 4)",
    };
  }
  if (code === 4 || code === 17 || code === 32 || msg.includes("rate limit") || msg.includes("too many")) {
    return {
      error: "RATE_LIMITED",
      action: "觸發速率限制:等 1 小時再試。正常單篇發文不會遇到,若常遇到請檢查是否有排程重複執行",
    };
  }
  return {
    error: "UNKNOWN",
    action: "未知錯誤:依 skills/threads-publishing-rules 第 6 節 ERROR=UNKNOWN 排查流程逐步定位(先試純文字 → 再試已知通的媒體 URL)",
  };
}
```

注意:`diagnose` 的 MISSING_SCOPE 分支必須放在 TESTER_NOT_ACCEPTED 之前?不——`permission` 字樣兩者都可能含。順序:190 → scope(code 10 優先)→ tester → rate → unknown,與上方程式碼一致即可;實測(Task 10)若發現誤分類再調整 pattern 與對應測試。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test`
Expected: PASS(13 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/threads-common.mjs tests/api.test.mjs
git commit -m "feat: API 層(retry/exchange/refresh/headCheck)與錯誤診斷 diagnose

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: threads-publish.mjs

**Files:**
- Create: `scripts/threads-publish.mjs`
- Test: `tests/cli-publish.test.mjs`

**Interfaces:**
- Consumes: Task 2/3 的 `parseArgs, emit, loadEnv, saveEnvVars, shouldRefresh, expiresAtFrom, api, refreshToken, headCheck, diagnose, sleep, API_VERSION`
- Produces: CLI — `node scripts/threads-publish.mjs [--text "..."] [--image <URL>] [--video <URL>] [--dry-run] [--json]`;成功 JSON `{ok:true, id, permalink}`;dry-run JSON `{ok:true, dryRun:true, request:{path, params}}`

- [ ] **Step 1: 寫失敗測試**

`tests/cli-publish.test.mjs`:

```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test`
Expected: FAIL — 找不到 `scripts/threads-publish.mjs`(spawn 後 status 非 0 且無 JSON)

- [ ] **Step 3: 實作**

`scripts/threads-publish.mjs`:

```js
#!/usr/bin/env node
/**
 * scripts/threads-publish.mjs — 發一篇 Threads(text / image / video)
 *
 * 用法:
 *   node scripts/threads-publish.mjs --text "貼文文字"
 *   node scripts/threads-publish.mjs --image <公開HTTPS URL> [--text "caption"]
 *   node scripts/threads-publish.mjs --video <公開HTTPS URL> [--text "caption"]
 *   加 --dry-run 只印請求不發送;加 --json 最後一行輸出機器可讀結果
 *
 * 媒體限制與踩坑:skills/threads-publishing-rules
 * token 剩 <10 天時自動續期(無感,不需 cron)。單次執行只發一篇。
 */
import {
  API_VERSION, api, diagnose, emit, expiresAtFrom, headCheck,
  loadEnv, parseArgs, refreshToken, saveEnvVars, shouldRefresh, sleep,
} from "./lib/threads-common.mjs";

const opts = parseArgs(process.argv.slice(2));
const json = opts.json === true;
const dryRun = opts["dry-run"] === true;

const text = typeof opts.text === "string" ? opts.text : "";
const imageUrl = typeof opts.image === "string" ? opts.image : "";
const videoUrl = typeof opts.video === "string" ? opts.video : "";

function fail(result) {
  if (!json) console.error(`❌ ${result.action ?? result.error}`);
  process.exit(emit({ ok: false, ...result }, { json }));
}

if (!text && !imageUrl && !videoUrl) {
  fail({ error: "MISSING_CONTENT", action: "至少提供 --text、--image <URL> 或 --video <URL> 其中之一" });
}
if (imageUrl && videoUrl) {
  fail({ error: "CONFLICTING_MEDIA", action: "--image 與 --video 只能擇一(carousel 在 v2 roadmap)" });
}
const mediaUrl = imageUrl || videoUrl;
if (mediaUrl && !/^https:\/\//.test(mediaUrl)) {
  fail({ error: "MEDIA_URL_NOT_HTTPS", action: "媒體 URL 必須是公開 HTTPS(Meta server 不抓 http)" });
}

const mediaType = videoUrl ? "VIDEO" : imageUrl ? "IMAGE" : "TEXT";
const createParams = { media_type: mediaType };
if (text) createParams.text = text;
if (imageUrl) createParams.image_url = imageUrl;
if (videoUrl) createParams.video_url = videoUrl;

if (dryRun) {
  if (!json) {
    console.log("🔎 dry-run:將送出以下請求(未實際呼叫)");
    console.log(`   POST ${API_VERSION}/me/threads ${JSON.stringify(createParams)}`);
    console.log(mediaType === "TEXT"
      ? `   → POST ${API_VERSION}/me/threads_publish`
      : `   → 輪詢 status=FINISHED → POST ${API_VERSION}/me/threads_publish`);
  }
  process.exit(emit(
    { ok: true, dryRun: true, request: { path: `${API_VERSION}/me/threads`, params: createParams } },
    { json },
  ));
}

const envPath = loadEnv();
let token = process.env.THREADS_ACCESS_TOKEN;
if (!token) {
  fail({ error: "MISSING_TOKEN", action: "找不到 THREADS_ACCESS_TOKEN:先執行 node scripts/threads-setup.mjs 完成串接(引導見 skills/threads-setup)" });
}

// 無感續期:剩 <10 天自動 refresh(失敗不擋發文,token 還沒過期)
try {
  if (shouldRefresh(process.env.THREADS_TOKEN_EXPIRES_AT)) {
    const refreshed = await refreshToken({ token });
    token = refreshed.access_token;
    if (envPath) {
      saveEnvVars(envPath, {
        THREADS_ACCESS_TOKEN: token,
        THREADS_TOKEN_EXPIRES_AT: expiresAtFrom(refreshed.expires_in),
      });
    }
    if (!json) console.log("🔄 token 已自動續期 60 天");
  }
} catch (err) {
  if (!json) console.warn(`⚠️ 自動續期失敗(先繼續用現有 token 發文):${err.message}`);
}

try {
  // 0. 媒體 URL 預檢:1 秒抓出「URL 不是公開可達」這個頭號死因
  if (mediaUrl) {
    const head = await headCheck(mediaUrl);
    if (!head.ok) {
      fail({
        error: "MEDIA_URL_UNREACHABLE",
        action: `媒體 URL 無法公開存取(HTTP ${head.status}${head.error ? ` / ${head.error}` : ""})。確認無痕視窗打得開、bucket/CDN 為公開。已知通/不通的 host 清單:skills/threads-publishing-rules 第 4 節`,
      });
    }
    if (!json) console.log(`✓ 媒體 URL 預檢通過(${head.status} ${head.contentType})`);
  }

  // 1. create container
  if (!json) console.log("1. 建立 container...");
  const created = await api({ method: "POST", path: `${API_VERSION}/me/threads`, params: createParams, token });
  const creationId = created.id;
  if (!json) console.log(`   ✓ creation_id = ${creationId}`);

  // 2. 輪詢(text 沒有 processing 階段,跳過)
  if (mediaType !== "TEXT") {
    const maxAttempts = mediaType === "VIDEO" ? 60 : 12; // video 5min / image 1min
    if (!json) console.log("2. 等 Meta 處理媒體...");
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(5000);
      const s = await api({ method: "GET", path: creationId, params: { fields: "status,error_message" }, token });
      if (!json) process.stdout.write(`   [${i + 1}/${maxAttempts}] status=${s.status}        \r`);
      if (s.status === "FINISHED") break;
      if (s.status === "ERROR" || s.status === "EXPIRED") {
        fail({
          error: "MEDIA_PROCESSING_FAILED",
          detail: s.error_message ?? s.status,
          action: "媒體處理失敗:多半是 mp4 規格(color range / pix_fmt)或 host 問題,照 skills/threads-publishing-rules 第 5、6 節排查",
        });
      }
      if (i === maxAttempts - 1) {
        fail({
          error: "MEDIA_PROCESSING_TIMEOUT",
          creationId,
          action: `等超過 ${maxAttempts * 5} 秒仍在處理:稍後再重跑一次,或檢查檔案大小是否過大`,
        });
      }
    }
    if (!json) console.log("\n   ✓ 處理完成");
  }

  // 3. publish
  if (!json) console.log("3. 正式發佈...");
  const published = await api({
    method: "POST",
    path: `${API_VERSION}/me/threads_publish`,
    params: { creation_id: creationId },
    token,
  });

  let permalink = null;
  try {
    const detail = await api({ method: "GET", path: published.id, params: { fields: "permalink" }, token });
    permalink = detail.permalink ?? null;
  } catch { /* permalink 拿不到不影響發佈成功 */ }

  if (!json) console.log(`\n🎉 發佈成功!${permalink ?? `thread id = ${published.id}`}`);
  process.exit(emit({ ok: true, id: published.id, permalink }, { json }));
} catch (err) {
  const d = diagnose(err, { phase: "publish" });
  if (!json) console.error(`\n❌ ${err.message}\n→ ${d.action}`);
  process.exit(emit({ ok: false, ...d, detail: err.message }, { json }));
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test`
Expected: PASS(18 tests)

- [ ] **Step 5: dry-run 手動煙霧測試**

Run: `node scripts/threads-publish.mjs --dry-run --text "hello" --video https://example.com/a.mp4 --json`
Expected: 最後一行 `{"ok":true,"dryRun":true,"request":{"path":"v1.0/me/threads","params":{"media_type":"VIDEO","text":"hello","video_url":"https://example.com/a.mp4"}}}`,exit 0

- [ ] **Step 6: Commit**

```bash
git add scripts/threads-publish.mjs tests/cli-publish.test.mjs
git commit -m "feat: threads-publish 三段式發佈(預檢/無感續期/dry-run/json)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: threads-refresh-token.mjs

**Files:**
- Create: `scripts/threads-refresh-token.mjs`
- Test: `tests/cli-refresh.test.mjs`

**Interfaces:**
- Consumes: Task 2/3 的 `parseArgs, emit, loadEnv, saveEnvVars, daysUntil, expiresAtFrom, refreshToken, diagnose, REFRESH_THRESHOLD_DAYS`;Task 4 測試檔的 `runScript`(從 `./cli-publish.test.mjs` import)
- Produces: CLI — `node scripts/threads-refresh-token.mjs [--force] [--json]`;JSON `{ok:true, refreshed:boolean, expiresAt?, daysLeft?}`

- [ ] **Step 1: 寫失敗測試**

`tests/cli-refresh.test.mjs`:

```js
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
```

注意:`runScript` 需要從 `cli-publish.test.mjs` export(Task 4 已寫成 `export function runScript`)。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test`
Expected: FAIL — 找不到 `scripts/threads-refresh-token.mjs`

- [ ] **Step 3: 實作**

`scripts/threads-refresh-token.mjs`:

```js
#!/usr/bin/env node
/**
 * scripts/threads-refresh-token.mjs — 手動續期 long-lived token(再 60 天)
 *
 * 平常不用跑:threads-publish.mjs 發文時剩 <10 天會自動續期。
 * 這支是「超過兩個月沒發文」的救援工具。refresh 不需要 App Secret。
 *
 * 用法:node scripts/threads-refresh-token.mjs [--force] [--json]
 */
import {
  REFRESH_THRESHOLD_DAYS, daysUntil, diagnose, emit, expiresAtFrom,
  loadEnv, parseArgs, refreshToken, saveEnvVars,
} from "./lib/threads-common.mjs";

const opts = parseArgs(process.argv.slice(2));
const json = opts.json === true;
const force = opts.force === true;

const envPath = loadEnv();
const token = process.env.THREADS_ACCESS_TOKEN;
if (!token) {
  if (!json) console.error("❌ 找不到 THREADS_ACCESS_TOKEN:先執行 node scripts/threads-setup.mjs");
  process.exit(emit(
    { ok: false, error: "MISSING_TOKEN", action: "先執行 node scripts/threads-setup.mjs 完成串接(引導見 skills/threads-setup)" },
    { json },
  ));
}

const expiresAt = process.env.THREADS_TOKEN_EXPIRES_AT || null;
const daysLeft = expiresAt ? Math.floor(daysUntil(expiresAt)) : null;

if (daysLeft !== null && daysLeft < 0) {
  if (!json) console.error(`❌ token 已於 ${expiresAt} 過期,無法 refresh`);
  process.exit(emit(
    { ok: false, error: "TOKEN_EXPIRED", action: "token 已過期無法續期:重跑 node scripts/threads-setup.mjs 重新串接(skills/threads-setup 步驟 5)" },
    { json },
  ));
}

if (daysLeft !== null && daysLeft > REFRESH_THRESHOLD_DAYS && !force) {
  if (!json) console.log(`✓ token 還有 ${daysLeft} 天(到期 ${expiresAt}),還不用換。要強制續期加 --force`);
  process.exit(emit({ ok: true, refreshed: false, daysLeft, expiresAt }, { json }));
}

try {
  const refreshed = await refreshToken({ token });
  const newExpiresAt = expiresAtFrom(refreshed.expires_in);
  if (envPath) {
    saveEnvVars(envPath, {
      THREADS_ACCESS_TOKEN: refreshed.access_token,
      THREADS_TOKEN_EXPIRES_AT: newExpiresAt,
    });
  }
  if (!json) console.log(`🔄 已續期,新到期日:${newExpiresAt}`);
  process.exit(emit({ ok: true, refreshed: true, expiresAt: newExpiresAt }, { json }));
} catch (err) {
  const d = diagnose(err, { phase: "refresh" });
  if (!json) console.error(`❌ ${err.message}\n→ ${d.action}`);
  process.exit(emit({ ok: false, ...d, detail: err.message }, { json }));
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test`
Expected: PASS(21 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/threads-refresh-token.mjs tests/cli-refresh.test.mjs
git commit -m "feat: threads-refresh-token 手動續期救援工具

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: threads-setup.mjs

**Files:**
- Create: `scripts/threads-setup.mjs`
- Test: `tests/cli-setup.test.mjs`

**Interfaces:**
- Consumes: Task 2/3 的 `parseArgs, emit, findEnvFile, saveEnvVars, ensureGitignoreHasEnv, expiresAtFrom, exchangeToken, fetchMe, api, diagnose, API_VERSION`;`runScript`(from `./cli-publish.test.mjs`)
- Produces: CLI — `node scripts/threads-setup.mjs [--token <SHORT>] [--secret <SECRET>] [--test-post] [--json]`;成功 JSON `{ok:true, username, userId, expiresAt, envPath, testPermalink}`

- [ ] **Step 1: 寫失敗測試**

`tests/cli-setup.test.mjs`:

```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test`
Expected: FAIL — 找不到 `scripts/threads-setup.mjs`

- [ ] **Step 3: 實作**

`scripts/threads-setup.mjs`:

```js
#!/usr/bin/env node
/**
 * scripts/threads-setup.mjs — 串接 Threads:
 * short-lived token → 換 60 天 long-lived → 驗證 /me → 寫 .env(不存 App Secret)
 *
 * 手動前置五步(建 Meta App、拿 token)見 skills/threads-setup/SKILL.md。
 *
 * 用法:
 *   node scripts/threads-setup.mjs                      # 互動式貼 token / secret
 *   node scripts/threads-setup.mjs --token <SHORT> --secret <SECRET> [--test-post] [--json]
 */
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  API_VERSION, api, diagnose, emit, ensureGitignoreHasEnv, exchangeToken,
  expiresAtFrom, fetchMe, findEnvFile, parseArgs, saveEnvVars,
} from "./lib/threads-common.mjs";

const opts = parseArgs(process.argv.slice(2));
const json = opts.json === true;

let shortToken = typeof opts.token === "string" ? opts.token : "";
let secret = typeof opts.secret === "string" ? opts.secret : "";

if ((!shortToken || !secret) && json) {
  process.exit(emit(
    { ok: false, error: "MISSING_ARGS", action: "--json 模式必須同時提供 --token 與 --secret(互動式輸入僅限人類模式)" },
    { json },
  ));
}

if (!shortToken || !secret) {
  console.log("🔗 Threads 串接(手動前置五步見 skills/threads-setup/SKILL.md)\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  if (!shortToken) shortToken = (await rl.question("貼上 short-lived token(取得後 1 小時內有效): ")).trim();
  if (!secret) secret = (await rl.question("貼上 App Secret(只用來換 token,不會儲存): ")).trim();
  rl.close();
}

try {
  // 1. short-lived → long-lived(60 天)
  if (!json) console.log("\n1. 交換 60 天 long-lived token...");
  const exchanged = await exchangeToken({ shortToken, secret });
  const longToken = exchanged.access_token;
  const expiresAt = expiresAtFrom(exchanged.expires_in);
  if (!json) console.log(`   ✓ 到期日:${expiresAt}(發文時會自動續期)`);

  // 2. 驗證 /me
  if (!json) console.log("2. 驗證帳號...");
  const me = await fetchMe({ token: longToken });
  if (!json) console.log(`   ✅ 已連接 @${me.username}(id=${me.id})`);

  // 3. 寫 .env(App Secret 用完即棄,不落地)
  const envPath = findEnvFile() ?? path.join(process.cwd(), ".env");
  saveEnvVars(envPath, { THREADS_ACCESS_TOKEN: longToken, THREADS_TOKEN_EXPIRES_AT: expiresAt });
  const gi = ensureGitignoreHasEnv(path.dirname(envPath));
  if (!json) {
    console.log(`3. 已寫入 ${envPath}(App Secret 未儲存)`);
    if (gi.added) console.log("   ✓ 已自動在 .gitignore 加入 .env");
  }

  // 4. 測試發文(--test-post,或互動詢問)
  let testPost = opts["test-post"] === true;
  if (!testPost && !json && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    testPost = /^y/i.test((await rl.question("要發一篇測試文驗證發佈權限嗎?(y/N) ")).trim());
    rl.close();
  }
  let testPermalink = null;
  if (testPost) {
    const created = await api({
      method: "POST",
      path: `${API_VERSION}/me/threads`,
      params: { media_type: "TEXT", text: "threads-api-guide 串接成功 ✅" },
      token: longToken,
    });
    const published = await api({
      method: "POST",
      path: `${API_VERSION}/me/threads_publish`,
      params: { creation_id: created.id },
      token: longToken,
    });
    try {
      const detail = await api({ method: "GET", path: published.id, params: { fields: "permalink" }, token: longToken });
      testPermalink = detail.permalink ?? null;
    } catch { /* permalink 拿不到不影響 */ }
    if (!json) console.log(`   🎉 測試文已發佈:${testPermalink ?? published.id}`);
  }

  if (!json) console.log("\n完成!之後用 node scripts/threads-publish.mjs 發文,token 會自動續期。");
  process.exit(emit(
    { ok: true, username: me.username, userId: me.id, expiresAt, envPath, testPermalink },
    { json },
  ));
} catch (err) {
  const d = diagnose(err, { phase: "setup" });
  if (!json) console.error(`\n❌ ${err.message}\n→ ${d.action}`);
  process.exit(emit({ ok: false, ...d, detail: err.message }, { json }));
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test`
Expected: PASS(23 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/threads-setup.mjs tests/cli-setup.test.mjs
git commit -m "feat: threads-setup 串接腳本(換 token/驗證/寫 env/測試文)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: skills/threads-publishing-rules(踩坑 skill 開源化)

**Files:**
- Create: `skills/threads-publishing-rules/SKILL.md`(複製 + 兩處編輯)

**Interfaces:**
- Consumes: 源檔 `/home/js0980420/projects/Hyperframes/.claude/skills/threads-publishing-rules/SKILL.md`(291 行,實戰驗證的平台知識)
- Produces: 錯誤訊息與 SKILL.md 中引用的「skills/threads-publishing-rules 第 4/5/6 節」章節結構(§4 URL 要求、§5 Video mp4 規格、§6 ERROR=UNKNOWN 排查)——複製時不得改動章節編號

- [ ] **Step 1: 複製源檔**

```bash
mkdir -p skills/threads-publishing-rules
cp /home/js0980420/projects/Hyperframes/.claude/skills/threads-publishing-rules/SKILL.md skills/threads-publishing-rules/SKILL.md
```

- [ ] **Step 2: 改掉專案特定引用(第 280 行)**

用 Edit 把:

```
實作範例見本專案 `scripts/publish-threads.mjs`。
```

改成:

```
實作範例見本 repo `scripts/threads-publish.mjs`(§11 的架構即其實作,並加上媒體 URL 預檢與 token 無感續期)。
```

- [ ] **Step 3: 檔頭補「最後實測日期」**

在 frontmatter 結束(第二個 `---`)之後、`# Threads Publishing API 完整限制與排查指南` 標題之前不動,在標題下方第一段(「這份是基於實戰一整天的踩坑紀錄…」)末尾補一行:

```
最後實測日期:2026-06(Meta 行為若與描述不符,以官方文件為準:https://developers.facebook.com/docs/threads)
```

- [ ] **Step 4: 驗證無殘留專案引用**

Run: `grep -n "本專案\|Hyperframes\|publish-threads.mjs" skills/threads-publishing-rules/SKILL.md`
Expected: 無輸出(「Remotion / OBS」作為錄影軟體舉例的行保留,那是通用知識)

Run: `grep -c "^## " skills/threads-publishing-rules/SKILL.md`
Expected: `12`(12 個章節完整保留)

- [ ] **Step 5: Commit**

```bash
git add skills/threads-publishing-rules/SKILL.md
git commit -m "docs: 開源化 threads-publishing-rules 踩坑 skill

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: skills/threads-setup/SKILL.md(串接引導)

**Files:**
- Create: `skills/threads-setup/SKILL.md`

**Interfaces:**
- Consumes: Task 6 的 CLI 介面(`--token/--secret/--test-post/--json`)、Task 3 `diagnose` 的 error 代碼(TOKEN_INVALID_OR_EXPIRED / MISSING_SCOPE / TESTER_NOT_ACCEPTED / RATE_LIMITED / UNKNOWN)——表格必須與程式碼一致

- [ ] **Step 1: 寫入完整內容**

`skills/threads-setup/SKILL.md`:

````markdown
---
name: threads-setup
description: 引導使用者從零串接 Threads 官方 API — 建 Meta App、設定 Threads use case、取得 short-lived token,再交給 threads-setup.mjs 自動換 60 天 long-lived token、驗證、寫入 .env。使用者說「幫我接 Threads」時,AI 先讀這份再開工。
---

# Threads 串接引導(給 AI 的操作手冊)

最後實測日期:2026-07-13。Meta 後台 UI 會改版:以「意圖」找對應功能,找不到時請使用者描述眼前畫面再對照,不要逐字堅持本文的按鈕名稱。

## 你(AI)的工作方式

- 一次只給使用者**一個步驟**,等他回報結果再給下一步
- 每步附官方連結作 fallback
- 安全紅線:App Secret 與 token 是機密——提醒使用者不要貼到公開場合;本工具**不會**把 App Secret 存檔(.env 只存 long-lived token 與到期日)
- 絕不建議任何非官方 API 或瀏覽器自動化登入(封號風險)

## 前置:取得腳本與環境

- 需求:Node ≥ 18.17(`node --version` 檢查)
- 使用者專案裡若還沒有腳本,從 repo 取得:

```bash
git clone https://github.com/js0980420/threads-api-guide   # 整包
# 或只抓四支腳本進既有專案(lib/ 相對路徑必須保留):
mkdir -p scripts/lib
BASE=https://raw.githubusercontent.com/js0980420/threads-api-guide/main/scripts
curl -fsSL -o scripts/lib/threads-common.mjs $BASE/lib/threads-common.mjs
curl -fsSL -o scripts/threads-setup.mjs $BASE/threads-setup.mjs
curl -fsSL -o scripts/threads-publish.mjs $BASE/threads-publish.mjs
curl -fsSL -o scripts/threads-refresh-token.mjs $BASE/threads-refresh-token.mjs
```

## 手動五步(使用者在瀏覽器完成,你逐步引導)

### 步驟 1:建立 Meta App
- 開 https://developers.facebook.com/apps/ → 建立應用程式(Create App)
- 用途選「其他 / Other」→ 類型選「商業 / Business」,名稱隨意(例:my-threads-bot)
- 官方文件:https://developers.facebook.com/docs/development/create-an-app/

### 步驟 2:加入 Threads use case 並勾權限
- App Dashboard 找「新增使用案例 / Add use cases」→ 加入「存取 Threads API / Access the Threads API」
- 進該 use case 的自訂(Customize)確認勾選兩個權限:
  - `threads_basic`(必要)
  - `threads_content_publish`(發文用)
- 官方文件:https://developers.facebook.com/docs/threads/get-started

### 步驟 3:把自己加為 Threads Tester
- App 左側「應用程式角色 / App roles」→ 新增人員(Add People)→ 角色選「Threads 測試人員 / Threads Tester」
- 填使用者自己的 Threads 帳號 username

### 步驟 4:到 Threads 接受邀請(最容易漏!)
- 手機 Threads app 或 threads.net → 設定 → 帳號 → **網站權限(Website permissions)** → 邀請 → 接受
- 沒做這步,步驟 5 拿 token 或之後驗證都會失敗

### 步驟 5:取得 short-lived token 與 App Secret
- Graph API Explorer:https://developers.facebook.com/tools/explorer/
  - 右上 Meta 應用程式選剛建的 App → User Token → 勾 `threads_basic` + `threads_content_publish` → Generate Access Token(會跳 Threads 授權視窗)
  - 複製 token——**1 小時內有效,拿到就馬上進下一步**
- App Secret:App Dashboard → 應用程式設定(App settings)→ 基本(Basic)→ 應用程式密鑰(App Secret)→ 顯示並複製

## 自動段:跑腳本

```bash
node scripts/threads-setup.mjs                # 互動式(人類自己貼)
# 或使用者把 token/secret 給你之後由你代跑:
node scripts/threads-setup.mjs --token <SHORT> --secret <SECRET> --test-post --json
```

成功輸出(--json):`{"ok":true,"username":"...","expiresAt":"...","envPath":"..."}`

腳本做的事:換 60 天 long-lived token → `GET /me` 驗證 → 寫 `.env`(自動確保 `.gitignore` 排除)→ 可選發測試文。App Secret 用完即棄。

## 失敗排查(--json 的 error 欄位 ↔ 手動步驟)

| error | 意義 | 回到 |
|---|---|---|
| `TOKEN_INVALID_OR_EXPIRED` | token 貼錯/超過 1 小時/不是這個 App 的 | 步驟 5 重拿 |
| `MISSING_SCOPE` | 權限沒勾到 | 步驟 2 |
| `TESTER_NOT_ACCEPTED` | 沒接受 Tester 邀請 | 步驟 4(確認步驟 3 有做) |
| `RATE_LIMITED` | 太頻繁 | 等 1 小時 |
| `UNKNOWN` | 其他 | skills/threads-publishing-rules 第 6 節排查流程 |

## 串接完成後

- 發文:`node scripts/threads-publish.mjs --text "..."`;媒體用公開 HTTPS URL:`--image <URL>` / `--video <URL>`
- token 會在發文時自動續期(剩 <10 天觸發);超過兩個月沒發文才需要 `node scripts/threads-refresh-token.mjs`
- 發佈的完整限制、mp4 規格、host 清單、排錯:**skills/threads-publishing-rules**
````

- [ ] **Step 2: 驗證與程式碼一致**

Run: `grep -o "TOKEN_INVALID_OR_EXPIRED\|MISSING_SCOPE\|TESTER_NOT_ACCEPTED\|RATE_LIMITED" skills/threads-setup/SKILL.md | sort -u`
Expected: 四個代碼都出現,且與 `scripts/lib/threads-common.mjs` 的 `diagnose()` 回傳值逐字相同

Run: `grep -n "threads-setup.mjs --token" skills/threads-setup/SKILL.md`
Expected: 出現,flag 拼寫與 Task 6 實作一致(`--token/--secret/--test-post/--json`)

- [ ] **Step 3: Commit**

```bash
git add skills/threads-setup/SKILL.md
git commit -m "docs: threads-setup 串接引導 skill(五步手動+自動段+錯誤反查)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: README.md(繁中)

**Files:**
- Modify: `README.md`(現況只有 GitHub 產生的一行 `# threads-api-guide`,整檔覆寫)

**Interfaces:**
- Consumes: 三支腳本的 CLI 介面(Task 4/5/6)、spec 的錯誤處理總表

- [ ] **Step 1: 覆寫 README.md**

````markdown
# threads-api-guide

讓你的 AI(Claude Code、Cursor⋯任何 agent)安全串接 **Threads 官方 API**,自動發文。

- **官方 API + 你自己的 Meta App + token 只存你電腦** — 不經過任何第三方服務
- **AI 引導串接**:對你的 AI 說「幫我接 Threads,照 skills/threads-setup 做」,10 分鐘發出第一篇
- **token 無感續期**:發文時自動 refresh,兩個月內有發文就永不過期,不用 cron
- **錯誤為 AI 設計**:`--json` 輸出 `error` + `action`,AI 拿到就知道下一步(哪一步做漏了、去哪排查)
- **零依賴**:純 Node ≥ 18.17,三支 `.mjs`,沒有 node_modules

## 30 秒上手

```bash
git clone https://github.com/js0980420/threads-api-guide
cd threads-api-guide

# 1. 照 skills/threads-setup/SKILL.md 完成五個手動步驟(建 Meta App、拿 token)
#    建議直接讓你的 AI 讀該文件來引導你
# 2. 串接(換 60 天 token、驗證、寫 .env):
node scripts/threads-setup.mjs
# 3. 發文:
node scripts/threads-publish.mjs --text "hello threads"
node scripts/threads-publish.mjs --video https://cdn.example.com/a.mp4 --text "caption"
```

也可以只把 `scripts/` 四支檔案複製進你既有的專案(路徑結構保持 `scripts/lib/`)。

## 為什麼這樣做不會被封號

會被 Meta 處置的是:非官方 API、瀏覽器自動化登入、共用別人的 App 授權、高頻 spam。本工具的架構把這些全部排除:

1. **只走官方 Graph API**(`graph.threads.net`),Meta 明文支援的發佈端點
2. **每個使用者自建自己的 Meta App**——沒有中心化服務,不會因為別人濫用而連坐
3. **單次執行只發一篇**,官方額度(250 posts/24h)遠在正常使用之上
4. token 走官方 OAuth 生命週期(60 天 long-lived + 官方 refresh 端點)

## 指令

| 指令 | 作用 | 主要參數 |
|---|---|---|
| `node scripts/threads-setup.mjs` | 串接:換 token → 驗證 → 寫 .env | `--token` `--secret` `--test-post` `--json` |
| `node scripts/threads-publish.mjs` | 發一篇(text/image/video) | `--text` `--image <URL>` `--video <URL>` `--dry-run` `--json` |
| `node scripts/threads-refresh-token.mjs` | 手動續期(救援用,平常自動) | `--force` `--json` |

媒體檔案需要**公開 HTTPS URL**(Meta server 主動抓取,不收 binary 上傳)。已實測可用/不可用的 host 清單見 [skills/threads-publishing-rules](skills/threads-publishing-rules/SKILL.md) 第 4 節。

## 錯誤速查表

| 情境 | 訊號 | 處置 |
|---|---|---|
| token 過期/貼錯 | `TOKEN_INVALID_OR_EXPIRED`(code 190) | 未過期會自動 refresh;過期則重跑 setup |
| 權限沒勾 | `MISSING_SCOPE` | Meta 後台 use case 勾 `threads_content_publish` |
| 沒接受 Tester 邀請 | `TESTER_NOT_ACCEPTED` | Threads App → 設定 → 帳號 → 網站權限 → 接受 |
| 媒體 URL 打不開 | `MEDIA_URL_UNREACHABLE`(發送前 1 秒攔下) | 換公開 host,見 publishing-rules §4 |
| 媒體處理失敗 | `MEDIA_PROCESSING_FAILED` | 多半是 mp4 color range/pix_fmt,見 publishing-rules §5 |

## 驗證你的串接

1. `node scripts/threads-setup.mjs --test-post` → 顯示 `✅ 已連接 @你的帳號` 並發出測試文
2. `node scripts/threads-publish.mjs --dry-run --text hi --json` → `{"ok":true,"dryRun":true,...}`
3. 開發者:`npm test`(node:test,無網路、無 token 需求)

## Skills(給 AI 的知識庫)

- [`skills/threads-setup`](skills/threads-setup/SKILL.md) — 串接引導:五步手動流程 + 腳本自動段 + 錯誤反查表
- [`skills/threads-publishing-rules`](skills/threads-publishing-rules/SKILL.md) — 實戰踩坑:token 生命週期、mp4 規格、host 清單、ERROR=UNKNOWN 排查

## Roadmap(v2)

- 媒體自動上傳(local file → R2/S3 再發佈)
- 串文回覆(`--reply-to`)、carousel 多圖
- 完整 OAuth redirect 流程(免手動貼 token)
- Instagram / Facebook 粉專

## License

MIT
````

- [ ] **Step 2: 驗證連結與指令拼寫**

Run: `grep -n "threads-publish.mjs --dry-run" README.md && ls skills/threads-setup/SKILL.md skills/threads-publishing-rules/SKILL.md`
Expected: 兩個 skill 檔案都存在,指令與實作一致

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: 繁中 README(上手/安全說明/指令/錯誤速查/roadmap)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: E2E 實測與發佈(作者親跑,不可由 subagent 代跑網路段)

**Files:**
- Modify: 視實測結果,可能修 `scripts/lib/threads-common.mjs` 的 `diagnose` pattern 與 `tests/api.test.mjs`
- Modify: `skills/threads-setup/SKILL.md`(視 Meta 後台實況校正措辭)

**Interfaces:**
- Consumes: 全部前述產出;需要一個真實 Meta App 與 Threads 帳號

- [ ] **Step 1: 全套自動測試最後確認**

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 2: 以全新 Meta App 走一遍 SKILL.md(這同時是教學影片腳本驗證)**

依 `skills/threads-setup/SKILL.md` 五步 + `node scripts/threads-setup.mjs --test-post`:
- 記錄每一步後台實際畫面用語,與 SKILL.md 不符處直接修文件
- 成功標準:`✅ 已連接 @帳號` + 測試文出現在 Threads

- [ ] **Step 3: 錯誤路徑實測(校正 diagnose)**

故意製造三種錯誤,記下 Meta 實際回傳的 message,若與 `diagnose()` pattern 不符 → 更新 pattern + 對應測試:
- 貼一個過期/亂改的 short-lived token → 應得 `TOKEN_INVALID_OR_EXPIRED`
- 只勾 `threads_basic` 不勾 publish → setup `--test-post` 應得 `MISSING_SCOPE`
- (可選)未接受邀請的帳號 → 應得 `TESTER_NOT_ACCEPTED`

- [ ] **Step 4: 媒體發佈實測**

- `node scripts/threads-publish.mjs --image <已知通的公開 URL> --text "image test"` → 成功拿 permalink
- `node scripts/threads-publish.mjs --video <私有/不存在的 URL>` → 1 秒內 `MEDIA_URL_UNREACHABLE`(預檢生效)

- [ ] **Step 5: 收尾 Commit + Push**

```bash
git add -A
git commit -m "fix: 依 E2E 實測校正錯誤 pattern 與引導文案

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

(若 Step 2–4 無需任何修改則略過 commit,直接 push 既有 commits。)

---

## Self-Review 紀錄

- **Spec coverage**:安全架構→Task 4(單篇)/Task 6(secret 不落地)/README;串接五步→Task 8;失敗診斷→Task 3+10;無感續期→Task 4;媒體預檢→Task 3/4;`--json`/`--dry-run`→Task 4/5/6;抗改版→Task 8 檔頭與工作方式;錯誤速查表→Task 9;v2 roadmap→Task 9。無缺口。
- **Type consistency**:`runScript` 由 `tests/cli-publish.test.mjs` export,Task 5/6 引用同名;`diagnose` 錯誤代碼在 Task 3 程式碼、Task 8 表格、Task 9 速查表逐字一致;env 變數名 `THREADS_ACCESS_TOKEN`/`THREADS_TOKEN_EXPIRES_AT` 全文一致。
- **已知留白(非 placeholder)**:`diagnose` 的 TESTER_NOT_ACCEPTED pattern 標註「以實測為準」,由 Task 10 Step 3 專責校正——這是刻意的實測閉環,不是未完成項。
