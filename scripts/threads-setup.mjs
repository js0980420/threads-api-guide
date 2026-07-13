#!/usr/bin/env node
/**
 * scripts/threads-setup.mjs — 串接 Threads:
 * short-lived token → 換 60 天 long-lived → 驗證 /me → 寫 .env
 * 應用程式密鑰只從 .env 的 THREADS_APP_SECRET 讀取,不接受 CLI 參數或互動輸入。
 *
 * 手動前置五步(建 Meta App、拿 token)見 skills/threads-setup/SKILL.md。
 *
 * 用法:
 *   node scripts/threads-setup.mjs                      # 互動式貼短期存取權杖
 *   node scripts/threads-setup.mjs --token <SHORT> [--test-post] [--json]
 */
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  API_VERSION, api, diagnose, emit, ensureGitignoreHasEnv, exchangeToken,
  expiresAtFrom, fetchMe, findEnvFile, loadEnv, parseArgs, saveEnvVars,
} from "./lib/threads-common.mjs";

const opts = parseArgs(process.argv.slice(2));
const json = opts.json === true;
loadEnv();

let shortToken = typeof opts.token === "string" ? opts.token : "";
const secret = process.env.THREADS_APP_SECRET?.trim() ?? "";

if (opts.secret !== undefined) {
  process.exit(emit(
    { ok: false, error: "SECRET_IN_CLI_NOT_ALLOWED", action: "安全起見不接受 --secret。請由使用者親自在 .env 設定 THREADS_APP_SECRET" },
    { json },
  ));
}

if (!shortToken && json) {
  process.exit(emit(
    { ok: false, error: "MISSING_ARGS", action: "--json 模式必須提供 --token;應用程式密鑰由 .env 的 THREADS_APP_SECRET 讀取" },
    { json },
  ));
}

if (!secret) {
  process.exit(emit(
    { ok: false, error: "MISSING_APP_SECRET", action: "請由使用者親自在 .env 設定 THREADS_APP_SECRET;不要貼到終端參數、聊天或交給 AI" },
    { json },
  ));
}

if (!shortToken) {
  console.log("🔗 Threads 串接(手動前置五步見 skills/threads-setup/SKILL.md)\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  shortToken = (await rl.question("貼上短期存取權杖(取得後立即使用): ")).trim();
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

  // 3. 寫 .env,保留使用者親自設定的 THREADS_APP_SECRET
  const envPath = findEnvFile() ?? path.join(process.cwd(), ".env");
  saveEnvVars(envPath, { THREADS_ACCESS_TOKEN: longToken, THREADS_TOKEN_EXPIRES_AT: expiresAt });
  const gi = ensureGitignoreHasEnv(path.dirname(envPath));
  if (!json) {
    console.log(`3. 已更新 ${envPath}(應用程式密鑰未顯示)`);
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
