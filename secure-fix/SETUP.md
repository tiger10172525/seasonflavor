# 肆菓 網站更新 — 安裝說明（Netlify）

這包是你**完整的網站**，已經把改動都併好：
- ✅ 你原本全部檔案（favicon / logo / SEO / style.css…）都保留
- ✅ 4 張對齊後的果醬照片
- ✅ 安全版 `shop.js`、`admin.html`（Airtable 金鑰不再外洩）
- ✅ `netlify/functions/`：把金鑰藏在伺服器端的中介

你的網站放在 **Netlify**（Cloudflare 只管你的網域）。以下在 Netlify 操作。

---

## 安裝步驟（照順序，約 10 分鐘）

### 1️⃣ 產生新的 Airtable token（你已做過）
如果還沒：Airtable → 頭像 → Builder hub → Personal access tokens → Create new token
- Scopes：`data.records:read`、`data.records:write`
- Access：加入你的肆菓 base
- 複製那串 `pat…`（只顯示一次）

### 2️⃣ 在 Netlify 設定環境變數（把鑰匙藏這裡）
1. 登入 **app.netlify.com** → 點你的網站
2. **Site configuration（或 Site settings）→ Environment variables**
3. 按 **Add a variable**，加**兩個**：
   | Key | Value |
   |---|---|
   | `AIRTABLE_TOKEN` | 你新產生的 Airtable token |
   | `ADMIN_KEY` | 你自訂的後台密碼（長一點難猜；這就是以後登入 admin.html 的密碼）|
4. 存檔

### 3️⃣ 上傳整包網站
把這個資料夾**整包**用你平常的方式拖到 Netlify 部署（Deploys → 拖曳上傳）。
> 資料夾裡要包含 `netlify/` 這個資料夾（裡面是 functions），Netlify 會自動把它變成 `/order` 和 `/admin-orders` 兩個中介。

### 4️⃣ 測試
- **前台**：到網站下一筆測試訂單 → 到 Airtable 看有沒有新增那筆
- **後台**：開 `你的網址/admin.html` → 輸入你在 `ADMIN_KEY` 設的密碼 → 訂單要正常載入
- 用瀏覽器「檢視原始碼」看 `shop.js`、`admin.html` → **應該再也找不到 `pat…` token**

### 5️⃣ 收尾：刪掉舊 token
測試都正常後，回 Airtable **把舊的那把 token 刪除**。完成！🎉

---

## 常見問題

**Q：後台密碼現在是什麼？**
A：你在 `ADMIN_KEY` 設的那個。舊的密碼已作廢。

**Q：下單失敗 / 後台載入失敗（unauthorized 或 500）？**
A：多半是環境變數沒設好。確認 Netlify 上 `AIRTABLE_TOKEN`、`ADMIN_KEY` 兩個名稱完全一致，新 token 權限有 read + write，然後 **重新部署一次**（環境變數改了要重部署才生效）。

**Q：/order 出現 404？**
A：確認 `netlify.toml` 和 `netlify/functions/` 資料夾都有一起上傳。

**Q：這樣就安全了嗎？**
A：token 已藏到伺服器端（最關鍵）。後台密碼改為伺服器驗證、admin 頁也加了 `noindex`。若要再升級，可用 Netlify 的密碼保護（Site protection）再鎖 admin.html。

---

## 之後可再加（等這步穩定後）
- 折扣碼
- 下單後自動寄通知信給你（最簡單：用 Airtable 內建「自動化」在新訂單時寄信，不用寫程式）
