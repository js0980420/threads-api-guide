---
name: threads-setup
description: 引導使用者從零串接 Threads 官方 API — 建 Meta App、設定 Threads use case、取得 short-lived token,再交給 threads-setup.mjs 自動換 60 天 long-lived token、驗證、寫入 .env。使用者說「幫我接 Threads」時,AI 先讀這份再開工。
---

# Threads 串接引導(給 AI 的操作手冊)

最後校對日期:2026-07-13。Meta 後台會依帳號、語言與灰度發布顯示不同版本。以下一律使用繁體中文後台實際顯示的名稱;只有 API、權限代碼與指令等技術名稱保留英文。

## 你(AI)的工作方式

- 一次只給使用者**一個步驟**,等他回報結果再給下一步
- 每一步先說「目前頁面標題」與「要按的中文名稱」;不要一次貼完整五步叫使用者自己找,也不要自行把後台名稱翻成英文
- 每步附官方連結作 fallback
- 找不到按鈕時,先請使用者上傳**目前整個瀏覽器內容區**的截圖,不要靠猜測繼續帶路
- 安全紅線:應用程式密鑰與存取權杖是機密。應用程式密鑰由使用者親自在 `.env` 填入;AI 不得要求使用者貼到對話或終端參數,也不得讀取、顯示或回傳 `.env` 內容
- 絕不建議任何非官方 API 或瀏覽器自動化登入(封號風險)

## 截圖協作規則

AI 無法直接看到使用者已登入的 Meta 私人後台。只有在使用者主動上傳截圖後,才能依該畫面指出位置。

1. 請使用者截「整個內容區」,保留左側導覽列、頁面標題與右上角;不要只截單一按鈕
2. 上傳前遮住存取權杖、應用程式密鑰、電子郵件、電話與不想公開的帳號資料。**若存取權杖或應用程式密鑰已入鏡,先停止處理並請使用者撤銷/重設該憑證**
3. 看圖後先用文字回覆「點左側/右上/頁面中段的『中文名稱』」
4. 執行環境若支援圖片編輯,回傳一張標註版:用紅框圈出目標、箭頭指向、只標一個編號 `1`;不得重繪或生成貌似真實的 Meta 後台假截圖
5. 若無法回傳標註圖片,改用相對位置描述。不要宣稱已看到未上傳的畫面

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

## 手動五步(使用者在瀏覽器完成,AI 逐步引導)

### 步驟 1:建立 Meta 應用程式
- 開 https://developers.facebook.com/apps/ → 右上「建立應用程式」
- 若畫面先問使用案例:選「存取 Threads API」。若沒有這張卡片,選「其他」,後續再加入使用案例
- 若畫面詢問應用程式類型:選「商業」
- 在「詳細資料」輸入應用程式名稱(例:`my-threads-bot`)與聯絡電子郵件,再按「建立應用程式」
- 完成判斷:看到新應用程式的「應用程式主控板」
- 官方文件:https://developers.facebook.com/docs/development/create-an-app/

### 步驟 2:加入 Threads 使用案例並勾選權限
- 若建立應用程式時已選 Threads:在「應用程式主控板」找到「存取 Threads API」,按「自訂」或「設定」
- 若尚未加入:左側或主畫面找「使用案例」→「新增使用案例」→「存取 Threads API」
- 進入 Threads API 後確認需要的權限:
  - `threads_basic`(必要)
  - `threads_content_publish`(發文用)
- 開發模式下只替自己的測試人員測試時,不需要先送「應用程式審查」
- 完成判斷:左側導覽列或使用案例頁面看得到「Threads API」
- 官方文件:https://developers.facebook.com/docs/threads/get-started

### 步驟 3:把自己加為 Threads 測試人員
- 左側「應用程式角色」→「角色」
- 在「Threads 測試人員」區塊按「新增 Threads 測試人員」;若介面只顯示「新增人員」,就按該按鈕
- 輸入自己的 Threads 使用者名稱,再按「提交」
- 某些新版介面會把入口放在「Threads API」→「設定」的「使用者權杖產生器」附近;找不到就請使用者上傳整頁截圖
- 完成判斷:帳號出現在「Threads 測試人員」清單,狀態可能仍顯示「待回覆」

### 步驟 4:到 Threads 接受邀請(最容易漏!)
- Threads 手機應用程式:個人檔案 → 右上選單(☰)→「帳號」→「網站權限」→「邀請」→ 接受該應用程式
- 網頁版若選單名稱不同,優先用手機應用程式完成
- 沒做這步,步驟 5 取得存取權杖或之後驗證都會失敗
- 完成判斷:邀請不再是待處理狀態;回 Meta 後台重新整理後可產生權杖

### 步驟 5:取得短期存取權杖與應用程式密鑰
- 回「應用程式主控板」→ 左側「Threads API」→「設定」
- 找「使用者權杖產生器」,在自己的 Threads 帳號右側按「產生權杖」,依授權視窗確認
- 複製短期存取權杖——**它是密碼,不要貼進對話或截圖;取得後立即執行下一段腳本**
- 應用程式密鑰:左側「應用程式設定」→「基本資料」→「應用程式密鑰」→「顯示」
- 若後台沒有「使用者權杖產生器」,先確認步驟 3、4 的測試人員邀請已接受;仍無入口才把「圖形 API 測試工具」當備援,不要當主流程

## 自動段:跑腳本

先請使用者**親自在編輯器**開啟 `.env`,填入下列欄位。AI 不得開啟或檢查填寫後的 `.env`:

```dotenv
THREADS_APP_SECRET=使用者自行貼上
```

```bash
node scripts/threads-setup.mjs                # 互動式(人類自己貼)
# 不接受 --secret;避免密鑰出現在 shell history、程序列表或 AI 工具紀錄
```

成功輸出(--json):`{"ok":true,"username":"...","expiresAt":"...","envPath":"..."}`

腳本做的事:從 `.env` 讀取應用程式密鑰 → 換 60 天 long-lived token → `GET /me` 驗證 → 更新 `.env` 的存取權杖與到期日 → 可選發測試文。全程不顯示應用程式密鑰。

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
