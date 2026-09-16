# Razzle Dazzle 本機帳本

這台店用 Mac 是唯一記帳來源。每筆變更先以 SQLite 交易寫入本機資料庫及修改紀錄；完成後才回報儲存成功。Chrome 的 localStorage 與 Google Sheets 不再是主帳本，雲端回應不會自動匯入或覆蓋本機資料。

## 執行方式

前端專案位於 `vendor-ledger/`。安裝 Node 套件並執行 `pnpm build`。執行服務需要 Python 3.9 以上，無額外 Python 套件。

```sh
cd vendor-ledger
pnpm install
pnpm build
python3 local_service/install_macos.py --script-url '現有 Apps Script /exec 網址'
```

安裝目錄：`~/Library/Application Support/RazzleDazzleLedger/`。

- `ledger.sqlite3`：主帳本與修改歷程。不要在服務運行時直接複製 SQLite 檔；請使用 App 的「下載完整備份」。
- `backups/`：不可變的完整 JSON 備份。
- `config.json`：私密的備份憑證與來源 ID；**不得提交至 Git、傳給第三方或放在公開網站**。
- `runtime/`：背景服務與編譯後前端。
- `~/Library/LaunchAgents/com.razzledazzle.vendor-ledger.plist`：登入後常駐，Chrome 關閉時仍會備份。Mac 關機或使用者登出時不會執行，下次登入啟動後補做。

本機網址為 `http://127.0.0.1:8769/`，只監聽 loopback，拒絕其他 Origin／Host 的 API 要求。Vercel 網站只提供開啟本機帳本的入口，不再提供記帳功能。

## 首次移轉與雲端設定

1. 先保全 Chrome 原檔，在副本中擷取最新的貨款與營收 JSON，核對 ID、筆數和欄位。不要用雲端舊資料覆蓋本機資料。
2. 建立 `{"format":"razzle-ledger-v1","records":{"ledger":[...],"revenue":[...]}}` 檔，執行 `server.py --data-dir '安裝目錄' --import-file '移轉檔'`。已初始化的資料庫會拒絕再次匯入；以後必須走明確的還原流程。
3. 將 `apps-script/Code.gs` 和 `apps-script/LocalBackups.gs` 部署到原本綁定 Google Sheets 的 Apps Script 專案，保留既有部署 URL。
4. Script Properties 的 `LOCAL_BACKUP_TOKEN` 對應本機 config 的 `backupToken`，`LOCAL_PRIMARY_SOURCE` 對應 `sourceId`。
5. 驗證實際上傳、SHA-256 和獨立讀回後，設定 `LOCAL_PRIMARY_ACTIVE=true`，停止舊版寫入。原本的貨款／營收試算表保留歷史資料；新資料存放在「本機帳本備份」工作表。
6. 確認所有帳本分頁沒有未儲存表單後切換至本機入口，避免繼續在舊版輸入。

## 備份與還原

背景服务在每次本機修改後嘗試完整備份；失敗每五分鐘重試。只有上傳成功且獨立讀回的完整 JSON 完全相符，才顯示雲端已核對。舊版本的成功確認不會把更新後的記錄誤標為已備份。

每天台北時間 04:00 額外產生不可覆寫的每日版本；錯過時保存啟動當時的帳本，建立時間會如實記錄，不虛構關機期間的歷史快照。每日版本保留 90 天，未成功上傳的本機備份不清除。初次移轉與還原前的安全副本另行保留。

「查看備份／還原」可選擇本機或雲端版本。選擇雲端版本只會下載並預覽；確認還原後，系統才替換主帳本，且先保存目前版本。預覽後若又有新記錄，還原會中止並要求重新預覽。清除 Chrome 資料不會刪除本機 SQLite 帳本。

若整台 Mac 損壞，需從 Apps Script 的私密 Script Properties 取得原來源 ID／備份憑證，在替代 Mac 建立相同 config，再經 App 明確選擇雲端版本還原。不要把恢復憑證保存在公開 GitHub。

## 驗證

```sh
python3 -m unittest discover -s local_service -v
node --test apps-script/LocalBackups.test.cjs src/ledgerStorage.test.mjs
pnpm build
```

測試使用隔離資料庫和模擬雲端，涵蓋本機持久化、舊分頁衝突、重複提交、刪除歷程、排程補做、上傳讀回、還原保護、跨網站寫入拒絕、完整／不完整雲端備份重試與驗證。
