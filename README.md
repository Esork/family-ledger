# family-ledger

家庭共用記帳 Web App。手機/桌面瀏覽器使用,多人共用同一本帳。

- 前端:單檔 `index.html`(原生 JS,無建置工具),部署在 GitHub Pages
- 後端:TypeScript + NestJS,API 合約見 [`backend/SPEC.md`](backend/SPEC.md)
- API 文件:Swagger UI (`/api/docs`)
- 資料庫:Prisma + SQLite(本機開發);舊 Apps Script 與 Google Sheet 實作保留於 `ledger_backend.gs`

```
Browser (GitHub Pages or local NestJS server)
   │  POST JSON (application/json or text/plain)
   ▼
NestJS action API  → Prisma → SQLite
   └── Swagger UI: /api/docs
```

## 本機啟動 NestJS 後端

請參閱 [`backend/SPEC.md`](backend/SPEC.md) 的完整規格。在 Windows PowerShell 執行:

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run db:setup
npm run start:dev
```

瀏覽 `http://127.0.0.1:3000` 使用前端,或開啟 `http://127.0.0.1:3000/api/docs` 查看 Swagger。預設邀請碼為 `family-ledger-local`,正式部署前務必更改。

若已匯入 `backend/prisma/dev.db` 的 SQL 資料,之後啟動時直接執行 `npm run start:dev`,不要再執行 `npm run db:setup`；Prisma 無法表達該 SQL 的 SQLite `COLLATE NOCASE` 與 `CHECK` 約束,重新同步 schema 可能移除這些約束。

## Repo 結構

| 檔案 | 說明 |
|---|---|
| `index.html` | 整個前端(HTML + CSS + JS) |
| `backend/` | NestJS 後端、Prisma schema、SQLite 初始化與 API 規格 |
| `ledger_backend.gs` | 舊版 Apps Script 後端(保留供參考) |

> ⚠️ 不要把資料庫匯出檔(`*.sql`、`*.csv`)提交到 repo,裡面有使用者的密碼雜湊與全部帳目。請加進 `.gitignore`。

## 舊版資料模型(Google Sheet 分頁)

日期欄位以**純文字**儲存(`yyyy-MM-dd`),避免 Sheets 自動轉型。

| 分頁 | 欄位 |
|---|---|
| `Users` | `user_id`, `username`, `password_hash`, `salt`, `display_name`, `created_at` |
| `Sessions` | `token`, `user_id`, `expires_at`(epoch ms), `display_name` |
| `Categories` | `category_id`, `name`, `type`(`expense`/`income`), `icon`, `sort` |
| `Items` | `item_id`, `category_id`, `name`, `created_by`, `use_count`, `last_used`(epoch ms) |
| `Transactions` | `tx_id`, `date`, `user_id`, `type`, `category_id`, `item_name`, `amount`, `note`, `created_at` |

- `Sessions` 需要有第 4 欄 `display_name`(後端寫入 4 個值、`auth_` 會讀它)。
- `Items` 是**全體共用**的條目清單:同分類下名稱經正規化(NFKC、小寫、去空白)後相同視為同一條目。
- `Transactions.type` 由分類決定,不信任前端傳入。
- 密碼雜湊:`SHA-256(salt + password)` 的 hex 字串。

## API

所有請求都是 `POST <exec URL>`,body 為 JSON 字串,`Content-Type: text/plain`(刻意避開 CORS preflight,Apps Script 不處理 `OPTIONS`)。

回應格式:

```json
{ "ok": true,  "data": { ... } }
{ "ok": false, "error": "error_code" }
```

| action | 參數 | 回傳 `data` | 需登入 |
|---|---|---|---|
| `register` | `username`(2–20 字), `password`(≥6), `display_name?`, `invite_code` | `{ token, expires_at, user, bootstrap, ledger }` | 否 |
| `login` | `username`, `password` | 同上 | 否 |
| `logout` | `token` | `true` | 是 |
| `me` | `token` | `{ user_id, display_name }` | 是 |
| `getBootstrap` | `token` | `{ user, categories[], items[], users[] }` | 是 |
| `getLedger` | `token`, `from?`, `to?`(`yyyy-MM-dd`,含頭尾), `offset?`, `limit?`(1–50,預設 10) | `{ rows[], has_more, summary: {income, expense, balance}, total_balance }` | 是 |
| `addTransaction` | `token`, `category_id`, `item_name?`(≤30 字), `amount`(>0), `date?`, `note?`(≤100 字) | `{ transaction, item }`(`item` 含 `is_new`) | 是 |

- `getLedger`:`rows` 依日期新到舊(同日後記的在前);`summary` 是 `from~to` 區間統計;`total_balance` 是**全部帳目**的收入減支出。
- `login` / `register` 會一併回傳 `bootstrap` 與第一頁 `ledger`,省一次來回。

錯誤碼:`unknown_action`, `unauthorized`, `invalid_credentials`, `username_taken`, `username_length`, `password_too_short`, `bad_invite_code`, `bad_date`, `bad_amount`, `bad_category`。

## 後端行為

- **Session**:隨機 token(兩個 UUID 去掉連字號),效期 30 天,存在 `Sessions`。
- **快取**(`CacheService`):
  - `s_<token>` → 使用者資訊,6 小時
  - `ledger_version` + `ledger_<ver>_<from>_<to>_<offset>_<limit>` → `getLedger` 結果,1 小時
  - `addTransaction` 與 `onEdit`(手動改 Sheet)會更新 `ledger_version`,使舊的帳目快取全部失效
  - `CATEGORIES_CACHE`:全域變數,只在同一個執行實例內有效
- **寫入互斥**:`register`、`logout`、`addTransaction` 使用 `LockService.getScriptLock()`。
- 時區固定 `Asia/Taipei`(`TZ` 常數)。

## 前端行為

- 狀態集中在全域物件 `S`(token、分類/條目、目前篩選區間、已載入列、offset、統計)。
- token 存 `localStorage`(key `t`);頁面載入時有 token 就呼叫 `getBootstrap` + `getLedger`。
- 等待伺服器回應時顯示全螢幕遮罩(`run()`);列表捲動載入(`IntersectionObserver`)則使用列表底部的小 spinner。
- 預設篩選區間為本月,也可指定日期範圍。新增帳目後在本地更新統計與列表,不重新請求。
- 所有插入 HTML 的動態文字都經過 `esc()`。

## 舊版 Apps Script 部署

1. 建立 Google Sheet,依「資料模型」建立 5 個分頁與表頭(`Sessions` 4 欄)。repo 內沒有初始化腳本。
2. 擴充功能 → Apps Script,貼上 `ledger_backend.gs`。
3. 專案設定 → 指令碼屬性,新增 `INVITE_CODE`。
4. 部署 → 網頁應用程式,執行身分「我」,存取權「所有人」。之後每次改程式要「管理部署作業 → 新版本」才會生效,網址不變。
5. 把 `/exec` 網址填入 `index.html` 的 `API` 常數。
6. 將 repo 的 `main` 分支開啟 GitHub Pages。

## 舊版已知問題 / 待辦

- 沒有修改或刪除帳目的 API,更正錯誤只能直接改 Sheet。
- 沒有修改密碼功能。
- 登入沒有次數限制;密碼使用單輪加鹽 SHA-256(速度快,不耐離線破解)。
- `Sessions` 過期資料不會清除;快取最多讓過期 session 多活 6 小時。
- 登入頁文字顯示「暫不開放註冊」,但點擊後仍會切到註冊表單,後端也仍接受帶邀請碼的註冊。
- `getLedger` 快取未命中時會讀整張 `Transactions`(O(n)),幾千筆內沒問題。
- 金額用浮點數儲存,後端以 `round(x*100)/100` 處理;若要嚴謹可改為整數(分)。
- 分類與條目只能直接編輯 Sheet 管理。
- Android(Pixel)上登入欄位長按空白鍵切換輸入法時鍵盤會消失,尚未找到原因。

## 本機資料

- `backend/prisma/dev.db` 是本機資料庫，不要提交 DB 或匯出檔；帳號與帳目資料屬敏感資訊。
- 本機 DB 與舊 Google Sheet 尚未自動同步或匯入；首次啟動需以邀請碼註冊新帳號。
- API 保留舊 action 合約；在本機 NestJS 提供的網頁使用時，前端會呼叫同源 API。GitHub Pages 仍使用原 Apps Script URL。
