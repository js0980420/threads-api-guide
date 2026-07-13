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
