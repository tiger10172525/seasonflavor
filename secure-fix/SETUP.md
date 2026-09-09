# 肆菓 資安修復 — 安裝說明（Cloudflare Pages）

這包會把 **Airtable 金鑰從前端搬到伺服器端**，訪客再也看不到你的 token；
後台密碼也改由伺服器驗證。你的購物車、結帳、後台功能完全不變。

## 這包有什麼

```
functions/
  order.js          ← 建立訂單的伺服器端中介（前台用）
  admin-orders.js   ← 後台讀取/更新訂單的中介（後台用）
shop.js             ← 已改：不再含 token，改呼叫 /order
admin.html          ← 已改：不再含 token 與寫死密碼，改呼叫 /admin-orders
```

---

## 安裝步驟（照順序做，約 10 分鐘）

### 1️⃣ 產生新的 Airtable token
1. 到 Airtable → 右上頭像 → **Builder hub → Personal access tokens**
2. **Create new token**，權限勾：
   - Scopes：`data.records:read`、`data.records:write`
   - Access：加入你的 base（appG11Pb9…）
3. 複製產生的新 token（`pat…` 開頭）—— 先貼在記事本，等下用
4. **舊的那把先不要刪**，等整個部署好、測試成功後再回來刪

### 2️⃣ 把檔案放進你的網站資料夾
在你平常上傳的那個網站資料夾裡：
- 把整個 **`functions/`** 資料夾放進去（跟 `index.html` 同一層）
- 用這包的 **`shop.js`** 覆蓋舊的
- 用這包的 **`admin.html`** 覆蓋舊的
- 其他檔案（index.html、style.css、favicon…）**都不動**

放好後資料夾長這樣：
```
你的網站/
├── index.html
├── shop.js          ← 換成新的
├── admin.html       ← 換成新的
├── style.css
├── functions/       ← 新增這個資料夾
│   ├── order.js
│   └── admin-orders.js
├── images/
├── favicon-*.png ...（原本的全部保留）
```

### 3️⃣ 在 Cloudflare 設定「環境變數」（把鑰匙藏這裡）
1. Cloudflare 儀表板 → **Workers & Pages** → 點你的網站專案
2. **Settings → Environment variables**（環境變數）→ Production
3. 新增兩個變數：
   | 名稱 | 值 |
   |---|---|
   | `AIRTABLE_TOKEN` | 你第 1 步產生的**新** token |
   | `ADMIN_KEY` | 你自訂的後台密碼（例如一組長一點的密碼） |
4. 存檔

> 這兩個值只存在 Cloudflare 伺服器端，不會出現在網頁原始碼裡。

### 4️⃣ 重新上傳網站
把整個資料夾（含新的 `functions/`）用你平常的方式**拖上去部署**。
Cloudflare Pages 會自動把 `functions/` 變成 `/order` 和 `/admin-orders` 兩個網址。

### 5️⃣ 測試
- **前台**：到網站下一筆測試訂單 → 到 Airtable 看有沒有新增那筆
- **後台**：開 `你的網址/admin.html` → 輸入你在 `ADMIN_KEY` 設的密碼 → 訂單列表要正常載入
- 用瀏覽器「檢視原始碼」看 `shop.js`、`admin.html` → **應該再也找不到 `pat…` token**

### 6️⃣ 收尾：刪掉舊 token
測試都正常後，回 Airtable **把舊的那把 token 刪除**。完成！🎉

---

## 常見問題

**Q：後台密碼現在是什麼？**
A：你在 `ADMIN_KEY` 設的那個。舊的 `87101725` 已作廢。

**Q：下單失敗 / 後台載入失敗？**
A：多半是環境變數沒設好或名稱打錯。確認 `AIRTABLE_TOKEN`、`ADMIN_KEY` 兩個名稱完全一致，且新 token 權限有勾 read + write，然後重新部署一次。

**Q：這樣就完全安全了嗎？**
A：token 已經藏到伺服器端，這是最關鍵的一步。後台密碼改為伺服器驗證、頁面也加了 `noindex`（不被搜尋引擎收錄）。若要再升級，可再加 Cloudflare Access 對 admin.html 做登入保護。

---

## 之後要加的（等這步穩定後再做）
- 折扣碼
- 下單後自動寄通知信給你（建議用 Airtable 內建的「自動化」寄信，最簡單，不用寫程式）
