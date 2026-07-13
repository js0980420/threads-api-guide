# threads-api-guide 設計文件

日期:2026-07-13
狀態:設計已核准,待實作規劃
定位:開源工具 — 「AI Skill + 腳本包」,讓任何使用者(透過自己的 AI 助手)安全串接 Threads 官方 API 並自動發佈內容。

## 背景與目標

作者在 Hyperframes / Remotion 兩個專案中各自維護一份 Threads 發佈腳本,並累積了完整的實戰踩坑紀錄(`threads-publishing-rules` skill)。本專案將這些已驗證的知識產品化為獨立開源 repo,目標使用者是「想讓自己的 AI 幫忙自動發 Threads」的開發者/創作者。

**成功標準**:使用者對自己的 AI 說「幫我接 Threads」,AI 讀 SKILL.md 後引導完成串接,10 分鐘內發出第一篇測試文;之後只要兩個月內有發文,token 永不過期、全程無需人工維護。

## 核心安全架構(不可妥協的前提)

- **只走官方 Graph API**(`graph.threads.net`),絕不使用非官方 API 或瀏覽器自動化。
- **每個使用者自建自己的 Meta App**,token 存在自己電腦的 `.env`。沒有共用 App、沒有中心化服務——任何使用者濫用都不會波及其他人。
- 單次執行只發一篇,不提供批次連發,降低觸發 spam 風控的可能。
- README 包含一段「為什麼這樣做不會被封號」說明(官方 API、自有 App、頻率上限),兼作使用者信心與教學影片素材。

## 範圍

**v1 包含**:Threads 平台;串接(setup)、發佈(text / image / video,媒體走自備公開 HTTPS URL)、token 自動續期。

**v1 不包含(記入 README roadmap)**:

- 媒體自動上傳(local file → R2/S3)— 引入雲端憑證依賴,v1 以文件提供「已實測可用的免費 host 清單」替代
- 串文/回覆(`--reply-to`)
- Carousel 多圖
- 完整 OAuth redirect server(方案 B)
- Instagram / Facebook 粉專

## Repo 結構

```
threads-api-guide/                      # GitHub: js0980420/threads-api-guide
├── skills/
│   ├── threads-setup/SKILL.md          # 串接引導(給 AI 讀)
│   └── threads-publishing-rules/SKILL.md  # 現有踩坑 skill 開源化
├── scripts/
│   ├── threads-setup.mjs
│   ├── threads-publish.mjs
│   └── threads-refresh-token.mjs
├── .env.example
├── .gitignore                          # 內含 .env
└── README.md                           # 繁中:是什麼、30 秒上手、錯誤速查表、FAQ、roadmap
```

- 發佈方式:獨立 GitHub repo,使用者以 `npx skills add js0980420/threads-api-guide` 裝進既有專案,或整包 clone。
- 腳本零依賴、純 Node ≥ 18(內建 fetch),與作者現有腳本同風格。
- 文件與 SKILL.md 以繁體中文為主,程式碼註解可中英混用。

## 串接流程(threads-setup)

### 手動段(SKILL.md 引導 AI 帶使用者完成)

1. developers.facebook.com 建立 App(類型 Other → Business)
2. 加入 Threads use case,勾選 `threads_basic` + `threads_content_publish`
3. App 角色中將自己的 Threads 帳號加為 Threads Tester
4. 到 Threads App 的「網站權限」**接受邀請**(最易遺漏,SKILL.md 特別標示)
5. 從 Graph API Explorer 取得 short-lived token,連同 App Secret 貼給腳本

### 自動段(threads-setup.mjs)

- 互動式輸入,或 `--token` / `--secret` 參數(方便 AI 代跑)
- short-lived → exchange 為 60 天 long-lived(此步需要 App Secret)
- `GET /me?fields=id,username` 驗證,顯示「✅ 已連接 @帳號」
- 寫入 `.env`:`THREADS_ACCESS_TOKEN`、`THREADS_TOKEN_EXPIRES_AT`(ISO 格式)
- **不儲存 App Secret**(見安全設計)
- 寫入前檢查 `.gitignore` 是否排除 `.env`,沒有則自動補上並提示
- 詢問是否發一篇測試文驗證 publish scope

### 失敗自動診斷(核心差異化功能)

五個手動步驟各有特徵錯誤。setup 腳本將 Meta 錯誤碼**反查回對應的手動步驟**,例如:

- token 驗證失敗且訊息含特定 pattern → 「通常代表尚未在 Threads App 接受 Tester 邀請 → 回到步驟 4」
- scope 不足 → 「use case 權限未勾選 → 回到步驟 2」
- `Failed to decode` / code 190 → token 過期或貼錯 app 的 token → 回到步驟 5

錯誤碼對照表以實戰紀錄為基礎,實作階段逐一實測補齊。

## 發佈(threads-publish.mjs)

改自 Remotion 專案已實戰的 `publish-threads.mjs`:

- 參數:`--text`(純文字)、`--image <URL>`、`--video <URL>`(可搭配 `--text` 作 caption)
- 三段式流程:create container → 輪詢 status(video 上限 5 分鐘)→ publish → 輸出 permalink
- 文字發佈跳過輪詢(無 processing 階段)
- **媒體 URL 預檢**:create container 前先對 URL 發 HEAD 請求驗證 200 + content-type,把「等 3 分鐘拿到 ERROR=UNKNOWN」變成「1 秒內明確報 URL 不通」
- **無感 token 續期**:每次執行先檢查 `THREADS_TOKEN_EXPIRES_AT`,剩餘 < 10 天即自動 refresh 並改寫 `.env`,再繼續發文(refresh 不需 App Secret)
- `--dry-run`:印出將送出的請求內容但不實際呼叫,供無副作用驗證
- 單次執行僅發一篇

## Token 續期(threads-refresh-token.mjs)

- 定位:救援工具(超過兩個月沒發文的使用者手動執行),主要續期路徑是 publish 時的無感自動 refresh
- 檢查 `THREADS_TOKEN_EXPIRES_AT`,距過期 > 10 天提示「還不用換」,可 `--force`
- 呼叫 `refresh_access_token`(grant_type=th_refresh_token,無需 App Secret)→ 改寫 `.env`
- token 已過期時無法 refresh → 明確指引重跑 setup

## 輸出與錯誤設計(為 AI 而設計)

本工具的主要操作者是使用者的 AI,因此:

- 三支腳本皆支援 `--json`:最後一行輸出單行 JSON
  - 成功:`{"ok":true,"id":"...","permalink":"..."}`
  - 失敗:`{"ok":false,"error":"TOKEN_EXPIRED","action":"重新執行 threads-setup.mjs,參考 skills/threads-setup"}`
- 每種已知錯誤附機器可讀的 `error` 代碼與 `action` 指引,讓呼叫端 AI 能自我修復,而非把原始 OAuthException 轉呈使用者
- 人類可讀模式(預設)維持現有腳本的 emoji + 中文訊息風格

## 安全設計

- `.env` 一律在 `.gitignore`;setup 自動檢查補上
- **App Secret 不落地**:exchange 用完即棄。refresh 不需要 secret,重跑 setup 的人回 Meta 後台再複製即可。`.env` 僅存 token 與到期日
- SKILL.md 明文警告:App Secret 與 token 不貼到任何公開場合;不將自己的 App 分享給他人授權(每人自建 App)
- 頻率保險:單次單篇;README 說明官方頻率上限(Threads 250 posts/24h)與正常使用的距離

## SKILL.md 抗 Meta 改版設計

- 引導以「意圖」描述(「找到 Use cases 區塊」)而非按鈕位置
- 每步附官方文件連結作 fallback
- 檔頭標註「最後實測日期」
- 指示 AI:使用者找不到對應畫面時,請對方描述眼前畫面再對照調整,而非逐字堅持步驟文字

## 驗證方式

- 作者以全新 Meta App 從零走完 SKILL.md 流程實測(過程同時是教學影片腳本)
- `--dry-run` 驗證參數組裝;`--json` 輸出可供簡單 smoke test 斷言
- README 驗證清單:setup 後 `/me` 通 → 測試文通 → (到期前)自動 refresh 通

## 錯誤處理總表(README 速查表雛形)

| 情境 | 訊號 | 處置 |
|---|---|---|
| token 過期/貼錯 | code 190 `Failed to decode` | 剩餘天數 > 0 → 自動 refresh;否則指引重跑 setup |
| 未接受 Tester 邀請 | /me 驗證失敗(pattern 實測補齊) | 指回手動步驟 4 |
| scope 未勾 | publish 權限錯誤 | 指回手動步驟 2 |
| 媒體 URL 不可達 | 預檢 HEAD 非 200 | 立即報錯,不進 container 流程 |
| 媒體格式不符 | 輪詢得 `ERROR` + error_message | 轉印 error_message + 指向 publishing-rules 排查章節 |
