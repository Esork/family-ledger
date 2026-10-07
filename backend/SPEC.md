# 家庭記帳後端規格

## 1. 目的與範圍

以 TypeScript、NestJS、Swagger 與 Prisma 建立可在本機執行的家庭共用記帳後端。API 沿用既有單頁前端及 Apps Script 的 action 合約；SQLite 作為本機資料庫。此版本涵蓋註冊、登入、登出、使用者資訊、初始化資料、帳目查詢與新增，不包含修改/刪除帳目、密碼變更或分類管理。

## 2. 執行與入口

- 預設監聽 `127.0.0.1:3000`；首頁提供現有 `index.html`。
- 健康檢查：`GET /health`。
- Swagger UI：`GET /api/docs`；OpenAPI JSON：`GET /api/docs-json`。
- action API：`POST /`，接受 `application/json` 及舊前端所用的 `text/plain` JSON。
- SQLite 預設檔案：`backend/prisma/dev.db`；正式/共用部署須另行設定安全的 `DATABASE_URL`、`HOST`、`INVITE_CODE` 和 CORS origins。
- 預設邀請碼 `family-ledger-local` 僅供本機開發；請勿用於對外部署。

## 3. 相容性與回應格式

成功時 HTTP 200：

```json
{ "ok": true, "data": {} }
```

失敗時使用適當的 4xx/5xx HTTP 狀態碼，並維持前端可辨識的格式：

```json
{ "ok": false, "error": "error_code" }
```

保留 action 名稱、欄位名稱、主要回應形狀及錯誤碼，以便前端切換到本機網址。token 存於前端 `localStorage`，以請求 body 傳送。

| Action | 必要欄位 | 說明 |
|---|---|---|
| `register` | `username`, `password`, `invite_code` | 可選 `display_name`；建立帳號與 30 天 session，連同初始化資料及第一頁帳目回傳。 |
| `login` | `username`, `password` | 驗證帳密、建立 session，回傳同註冊的初始化資料。 |
| `logout` | `token` | 刪除有效 session，回傳 `true`。 |
| `me` | `token` | 回傳 `{ user_id, display_name }`。 |
| `getBootstrap` | `token` | 回傳 `{ user, categories[], items[], users[] }`。 |
| `getLedger` | `token` | 可選 `from`, `to`, `offset`, `limit`；日期含頭尾，預設全期間、offset 0、limit 10，limit 限制 1–50。 |
| `addTransaction` | `token`, `category_id`, `amount` | 可選 `item_name`, `date`, `note`；回傳 `{ transaction, item }`。 |

### 帳目查詢規則

- 帳目依日期新到舊排序，同日依建立時間新到舊；採 offset 分頁，`has_more` 表示是否還有下一頁。
- `summary` 是指定日期範圍的收入、支出與淨額；`total_balance` 是所有日期的收入減支出。
- 資料庫依匯入 SQL 以 `REAL` 儲存元；API 新增金額限制為精確至分，回傳時四捨五入至小數兩位。
- 日期使用 `yyyy-MM-dd` 字串；預設新增日期及 `created_at` 顯示採 `Asia/Taipei`。
- `type` 只由資料庫分類決定，不接受客戶端覆寫。
- 條目為全體共用；新增時以分類及 NFKC、小寫、移除空白後的名稱尋找既有條目，找到時增加 `use_count`。

## 4. 驗證與錯誤

帳號長度 2–20 字，密碼至少 6 字，帳號比對不區分大小寫。密碼沿用 Apps Script 的 `SHA-256(salt + password)` 格式，保持既有使用者資料相容；此格式不適用於新的公開服務部署，後續應規劃可遷移的慢速密碼雜湊。session 使用隨機 256-bit token，效期 30 天；SQLite 以 epoch 秒儲存期限，API 的 `expires_at` 仍回傳 epoch 毫秒。每次受保護請求都檢查資料庫中的 session 與期限，登出立即撤銷。

新增帳目要求有效日期、正數金額（精確至分）、存在的分類；條目最多 30 字、備註最多 100 字。分類與新增帳目寫入、條目使用次數更新均在資料庫交易中完成。

API 錯誤碼：`unknown_action`、`invalid_request`、`unauthorized`、`invalid_credentials`、`username_taken`、`username_length`、`password_too_short`、`bad_invite_code`、`bad_date`、`bad_amount`、`bad_category`、`bad_request`、`not_found`、`request_failed`、`internal_error`。

## 5. 資料表

Prisma schema 對應 `family-ledger-1791349792475.sql` 的 `users`、`sessions`、`categories`、`items`、`transactions` 結構；帳目金額以 `REAL` 儲存，日期與時間欄位沿用 SQL 的文字格式。由於 Prisma 的 SQLite `Int` 是 32 位元，匯入時需將 SQL 中毫秒格式的 `last_used` 及既有 session 到期時間轉成 epoch 秒，API 的 `expires_at` 輸出則維持毫秒。匯入資料庫時須保留 SQL 定義的外鍵、索引及 SQLite 約束。`npm run db:setup` 只同步 schema 並執行 12 個預設分類的 upsert，不會匯入此 SQL 檔案。

## 6. 本機啟動

在 `backend` 目錄：

```powershell
Copy-Item .env.example .env
npm install
npm run db:setup
npm run start:dev
```

SQL 匯入已建立並填入目前的 `dev.db`；之後啟動此資料庫時，直接執行 `npm run start:dev`，不要再執行 `npm run db:setup` 或 `prisma db push`。Prisma schema 無法表達 SQL 的 `COLLATE NOCASE` 與 `CHECK` 約束，重新 push 可能移除這些 SQLite 約束，並讓大小寫不同的既有帳號無法登入。

開啟 `http://127.0.0.1:3000` 使用現有前端，或前往 `http://127.0.0.1:3000/api/docs` 查看及操作 API。若使用其他前端 origin，將其加入 `.env` 的 `CORS_ORIGINS`（逗號分隔），然後重啟伺服器。
