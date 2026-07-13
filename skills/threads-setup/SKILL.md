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
