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
