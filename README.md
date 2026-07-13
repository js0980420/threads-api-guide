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

| 情景 | 訊號 | 處置 |
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
