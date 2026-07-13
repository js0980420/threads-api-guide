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
