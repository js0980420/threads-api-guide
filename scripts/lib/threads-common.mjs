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
