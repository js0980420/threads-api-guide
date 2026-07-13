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
