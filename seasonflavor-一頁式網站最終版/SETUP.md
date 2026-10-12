# 肆菓 網站 — 搬到 Cloudflare Pages（安裝說明）

這包是你**完整的網站**，已經改成 **Cloudflare Pages** 原生版（不再需要 Netlify）：
- ✅ 你原本全部檔案（favicon / logo / SEO / style.css…）都保留
- ✅ 4 張對齊後的果醬照片
- ✅ 商品視窗 Gemini 寬版面（食品標示｜營養標示＋購買鈕）
- ✅ 安全版 `shop.js`、`admin.html`（Airtable 金鑰不外洩）
- ✅ `_worker.js`：後端（訂單／庫存 API），把金鑰藏在伺服器端。⚠️ 網頁拖曳上傳不支援 `functions/` 資料夾，所以改用這個單檔寫法
- ✅ `_headers`：安全標頭

你的網域本來就在 Cloudflare（只做 DNS），所以搬過去最順。以下全在 Cloudflare 操作。

---

## 安裝步驟（照順序，約 10–15 分鐘）

### 1️⃣ Airtable token（沿用現有的就好）
用現在正在跑的那把 `pat…` token 即可，不用重產。若要重產：
Airtable → 頭像 → Builder hub → Personal access tokens → Create new token
- Scopes：`data.records:read`、`data.records:write`
- Access：加入你的肆菓 base
- 複製那串 `pat…`（只顯示一次）

### 2️⃣ 建立 Cloudflare Pages 專案（直接上傳，跟 Netlify Drop 一樣）
1. 登入 **dash.cloudflare.com** → 左側 **Workers & Pages**
2. **Create application → Pages → Upload assets**（直接上傳，不用連 GitHub）
3. 專案名稱打 `seasonflavor`（或你喜歡的）→ Create project
4. 把**這整包資料夾**拖進去上傳
   > 資料夾裡一定要包含 `_worker.js` 這個檔案（在最外層），它就是
   > `/order`、`/products`、`/admin-orders`、`/admin-products` 這四支後端。
5. 按 **Deploy site**

### 3️⃣ 設定環境變數（把鑰匙藏這裡）
專案建立後：**專案 → Settings → Variables and secrets（環境變數）**
按 **Add**，加**兩個**（建議選 **Encrypt / Secret** 類型）：
| 名稱 | 值 |
|---|---|
| `AIRTABLE_TOKEN` | 你的 Airtable token（`pat…`）|
| `ADMIN_KEY` | 你自訂的後台密碼（長一點難猜；這是登入 admin.html 的密碼）|

> ⚠️ 加完環境變數要**重新部署一次**才生效（Deployments → 最新那筆 → ⋯ → Retry deployment，或重新上傳一次）。

### 3.5️⃣ 綁定 D1 資料庫（庫存管理功能要用）
庫存資料存在 Cloudflare D1（資料庫 `seasonflavor`，我已幫你建好、放好 4 筆商品）。
**專案 → Settings → Bindings（繫結）→ Add → D1 database**
| 變數名稱 | 選擇的資料庫 |
|---|---|
| `DB` | `seasonflavor` |
> 變數名稱一定要打大寫 **`DB`**。加完一樣要**重新部署一次**。
> 沒綁也不會壞：前台會用檔案內建的預設庫存，只是後台「庫存管理」會顯示「D1 未綁定」。

### 3.6️⃣ 肆菓筆記後台（文章 + 圖片上傳）

分兩件事：**資料表**（放文章）和 **R2**（放圖片）。兩件都做完才會動。

**(a) 建資料表** — Cloudflare → Workers & Pages → D1 → 點 `seasonflavor` 資料庫 → Console，
把下面整段貼上去執行一次：

```sql
CREATE TABLE IF NOT EXISTS journal (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  excerpt    TEXT,
  body       TEXT,
  image      TEXT,
  date       TEXT,
  published  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

**(b) 建 R2 儲存桶並綁定** — 圖片存這裡。
1. 左側 **R2** → **Create bucket** → 名稱打 `seasonflavor-media` → 建立
   （不用開 Public Access，圖片是經由 `/media/...` 這條路由送出來的）
2. 回到 Pages 專案 → **Settings → Bindings → Add → R2 bucket**

| 變數名稱 | 選擇的儲存桶 |
|---|---|
| `MEDIA` | `seasonflavor-media` |

> 變數名稱一定要打大寫 **`MEDIA`**。加完要**重新部署一次**。

**(c) 怎麼用**：開 `你的網址/admin.html` → 登入 → 中間的「肆菓筆記」區塊
- **新增文章**：填標題、一行描述、日期、內文，上傳封面圖，勾「發佈到網站」→ 儲存
- **內文分段**：空一行就是換一段
- **頂部主視覺**：那一塊獨立上傳，會顯示在 journal.html 標題上方；按「移除主視覺」就不顯示
- 文章網址是 `你的網址/journal/文章編號`，標題與 og:image 由伺服器寫進 HTML，搜尋引擎讀得到
- 圖片單張上限 5MB，接受 jpg / png / webp / avif / gif

> 沒建資料表或沒綁 R2 也不會壞：前台 journal.html 會顯示內建的三篇預設內容，
> 後台則會直接告訴你「D1 未綁定」或「R2 未綁定」。

### 3.7️⃣ Airtable 加 `email` 欄位（選做）

下單時顧客填的信箱，現在會單獨送一份到 Airtable 的 `email` 欄位（原本只混在 `note` 裡）。

做法：Airtable → `orders` 表 → 最右邊 `+` → 欄位名稱打 **`email`**（小寫，要完全一致）→ 型別選 **Email** 或 **Single line text** → 建立。

> **不加也不會壞。** 表裡沒有這個欄位時 Airtable 會退件，`_worker.js` 會自動拿掉 `email` 重送一次，訂單照樣成立。加了就自動開始寫入。
> 舊訂單的 `email` 欄位會是空的，信箱仍在 `note` 裡（格式為 `Email: xxx@yyy`）。

寄給店家的新訂單通知信由 Airtable Automations 處理，收件人固定，不受這個欄位影響。

### 3.8️⃣ 商品資料搬進 D1（2026-09-25 已執行完成，不用再做）

商品的名稱、圖片、文案、價格、庫存、成分、淨重、保存期限、營養標示全部在 D1 `products` 表。
後台「商品與庫存」可以直接改，也可以按「新增商品」上架新品（上傳圖片、填文案與價格），
儲存後商品頁 `/products/<網址代稱>`、果醬系列、線上訂購、sitemap 會自動更新，不用重新部署。

- 網址代稱只能用英文小寫、數字、連字號（例如 `lemon`），建立後不能改
- 不賣的商品把狀態改成「隱藏」，不要刪除，舊訂單才對得起來

如果換了新的 D1 資料庫，要先補欄位：

```sql
ALTER TABLE products ADD COLUMN name TEXT;
ALTER TABLE products ADD COLUMN en TEXT;
ALTER TABLE products ADD COLUMN sku TEXT;
ALTER TABLE products ADD COLUMN description TEXT;
ALTER TABLE products ADD COLUMN card TEXT;
ALTER TABLE products ADD COLUMN image TEXT;
ALTER TABLE products ADD COLUMN image_w INTEGER;
ALTER TABLE products ADD COLUMN image_h INTEGER;
ALTER TABLE products ADD COLUMN alt TEXT;
ALTER TABLE products ADD COLUMN net_weight TEXT;
ALTER TABLE products ADD COLUMN ingredients TEXT;
ALTER TABLE products ADD COLUMN shelf_life TEXT;
ALTER TABLE products ADD COLUMN storage TEXT;
ALTER TABLE products ADD COLUMN sort_order INTEGER;
ALTER TABLE products ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN nutrition TEXT;
```

### 3.9️⃣ SEO 文案在哪裡改

每頁的標題、描述、分享圖集中在 `_worker.js` 最上面的 `PAGES`；常見問題在同一個檔案的 `FAQ`。
商品頁和文章頁的標題／描述來自後台（D1），在後台改。

### 3.10 擺攤 POS（手機／iPad 離線結帳）

網址：`https://www.seasonflavor.com/admin-pos`

1. **第一次要連網**：用 Safari 打開上面網址 → 分享 → **加入主畫面**。之後都從主畫面的「肆菓 POS」圖示開。
   > 主畫面 App 和 Safari 的資料是分開的，結帳紀錄存在哪邊就要從哪邊開，不要混用。
2. 連網狀態下按右上「同步」→ 輸入後台密碼（ADMIN_KEY），只要輸入一次。
3. 擺攤時沒網路也能結帳。紀錄存在這台裝置上，右上會顯示「待同步 N 筆」。
4. 回家連上網，打開 App 就會自動同步（或手動按「同步」）：
   - 寫進 Airtable 訂單，後台「訂單管理」看得到（訂單編號 `POS…`、付款方式 `擺攤-現金` 等、狀態「完成」）
   - 自動扣 D1 商品庫存
   - 同一筆重送不會重複記帳（D1 `pos_sales` 表去重，第一次同步時自動建立）

> ⚠️ 還沒同步前**不要清除 Safari 資料或刪掉主畫面 App**，未同步的紀錄會一起消失。
> 擺攤專用品項（禮盒組、試吃包…）：POS 商品區最後一格「新增品項」，填名稱和價格。只存在這台裝置、不上官網、不扣庫存；左上 ✕ 可刪除。
> 商品價格改了要連網打開一次 POS，才會抓到新價格。只顯示有設定價格的商品。

### 4️⃣ 綁你的網域（把 seasonflavor.com 指到這個 Pages）
**專案 → Custom domains → Set up a custom domain** → 輸入 `www.seasonflavor.com`（和 `seasonflavor.com`）
因為 DNS 已經在 Cloudflare，它會**自動幫你建好 DNS 記錄**，按確認即可，幾分鐘生效。
（等 Pages 測好再切網域，避免中途斷線。）

### 5️⃣ 測試
- **前台**：到 `專案.pages.dev` 下一筆測試訂單 → 到 Airtable 看有沒有新增
- **後台**：開 `你的網址/admin.html` → 輸入 `ADMIN_KEY` 的密碼 → 訂單要正常載入
- 「檢視原始碼」看 `shop.js`、`admin.html` → **找不到 `pat…` token** 就對了

### 6️⃣ 收尾
- 網域切到 Cloudflare Pages、測試都正常後 → **Netlify 那邊的網站可以停用/刪除了**
- 若剛剛有重產 token，回 Airtable 把舊 token 刪掉

---

## 常見問題

**Q：/order 出現 404 或下單失敗？**
A：確認 `_worker.js` 有在上傳資料夾的最外層；環境變數 `AIRTABLE_TOKEN`、`ADMIN_KEY` 名稱完全一致；改完環境變數有**重新部署**。

**Q：後台載入失敗（unauthorized / 500）？**
A：多半是 `ADMIN_KEY` 沒設或打錯，或改了環境變數沒重部署。

**Q：這樣就安全了嗎？**
A：token 藏在伺服器端（最關鍵），後台密碼由伺服器驗證，admin 頁也有 `noindex`。要再升級可用 Cloudflare Access 再鎖 admin.html。

---

## 之後可再加
- Cloudflare AI 客服問答（下一步要做的）
- 下單後自動寄通知信（最簡單：用 Airtable 內建「自動化」在新訂單時寄信）

## 3.10 結帳付款設定

- **後台「金流控制台」**：勾選開關各付款方式、填銀行轉帳帳戶，存在 D1 `settings`（`pay_<方式>` = on/off、`bank_*`），不用改程式。停用的方式前台仍顯示但變灰不能點，伺服器端也會擋。
- 一般銀行轉帳帳戶（也可直接用 SQL）：D1 `settings` 表加 key `bank_name`、`bank_code`、`bank_branch`、`bank_holder`、`bank_account`（沒填的欄位不顯示；沒設就用 `_worker.js` 的 `BANK_DEFAULT`）。
  例：`INSERT INTO settings (key,value) VALUES ('bank_branch','仁愛分行') ON CONFLICT(key) DO UPDATE SET value=excluded.value;`
- LINE Pay：`_worker.js` 的 `LINE_PAY_BACKEND = false`，後端串好前不要改 true（後台開關也會鎖住）。
- 綠界正式環境：Pages 環境變數 `ECPAY_ENV=production` 加上 `ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV`，四個都設才啟用。**少任何一個，正式站的信用卡／ATM／超商代碼會停用（顯示「暫時無法使用」），只剩銀行轉帳**；綠界測試帳號只在本機 localhost 使用，避免有人用公開的測試金鑰偽造付款。
- 綠界後台要允許 ATM、超商代碼付款方式，取號通知網址 `/api/ecpay/info`、付款通知 `/api/ecpay/notify`。
- 付款品牌 SVG 在 `images/payment-icons/`，為簡化示意版，上線前請換官方素材。
- 訂單查詢頁 `/order-status`：客人輸入「訂單編號 + 訂購電話」查狀態（不給收錄、不放 sitemap）。狀態來自 Airtable 訂單的 status 欄，你在後台改狀態，客人就看得到。

## 3.11 2026-10 改版：訂單改存 D1、後台登入、折扣碼

**部署後不用手動跑 SQL**：`orders`、`order_items`、`payment_events`、`discount_codes`、`rate_limits`、`admin_sessions` 會在網站第一次被打開時自動建立；`journal` 表自動補 `slug` 欄位。

**環境變數（Pages → Settings → Variables and Secrets，Production）**
| 名稱 | 值 |
|---|---|
| `ECPAY_ENV` | `production`（沒設或填其他值 = 正式站停用線上付款，只剩銀行轉帳） |
| `ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV` | 綠界廠商專區 → 系統設定 → 系統介接設定 |
| `ADMIN_KEY` | 後台密碼，建議 16 字以上 |
| `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET` | 防機器人驗證，見 3.12（兩個都要設） |
四個綠界變數都對了才會走正式金流。改完要重新部署。

**訂單資料流**
- 客人下單 → 先存 D1（不會遺失）→ 再寫一份到 Airtable（觸發寄信自動化）。
- Airtable 寫入失敗時，後台訂單區上方會顯示「有 N 筆還沒同步」，打開後台會自動重送。
- 訂單編號格式 `SF261001-A7K29Q`；送給綠界的編號是去掉連字號的 `SF261001A7K29Q`。
- 付款成功（綠界通知）才扣庫存。庫存不夠時訂單仍標記已付款，備註最上面寫「付款完成但庫存不足，請人工處理」。
- 銀行轉帳：在後台把狀態改成「已付款」時才扣庫存、才算折扣碼使用次數。
- 後台改狀態有規則：例如「完成」不能改回「待付款」，不允許時會跳出原因。
- Airtable 的「狀態」欄可能多出「已取消」「已退款」「付款失敗」選項（自動建立）。如果有用狀態觸發的自動化，請確認不會誤寄。

**後台登入**
- 密碼只在登入時送一次，之後用 8 小時的登入憑證，重新整理不用再輸入。
- 同一個網路 15 分鐘內錯 10 次會暫停登入 15 分鐘。
- 擺攤收銀頁同步時，如果登入過期會請你輸入一次密碼。

**折扣碼**：後台「折扣碼」區可新增、修改、停用，可設門檻、期間、使用上限、網紅名字。

**肆菓筆記網址**：後台編輯文章時填「網址名稱」（例如 `strawberry-season`），網址變成 `/stories/strawberry-season`；舊的 `/stories/1` 會自動 301 轉過去。

**圖片上傳**：只收 jpg / png / webp、5MB 以內，會檢查檔案內容，存檔用隨機檔名。

### 3.12 防機器人驗證（Cloudflare Turnstile）

結帳與聯絡表單會用 Turnstile 擋機器人灌單。一般客人看不到，只有可疑流量才會跳出驗證。

1. Cloudflare 後台 → **Turnstile** → **Add widget**
2. Widget name：`seasonflavor`；Hostname：`www.seasonflavor.com`（可再加 `seasonflavor.com`）；Widget Mode：**Managed** → 建立
3. 會拿到兩組值：**Site Key**（公開）與 **Secret Key**（機密）
4. Pages 專案 → Settings → Variables and Secrets（Production）新增：
   - `TURNSTILE_SITE_KEY` = Site Key（類型 Text）
   - `TURNSTILE_SECRET` = Secret Key（類型 **Secret**）
5. 重新部署一次才會生效

> 兩個都沒設時不驗證，網站照常運作；只設一個會出問題，請兩個一起設。

### 3.13 庫存預留與訂單逾期

- 下單當下就先扣庫存（預留），不會超賣
- 沒付款的訂單自動逾期並把庫存補回：信用卡 2 小時，ATM／超商代碼／銀行轉帳 4 天
- 逾期後才收到款（例如晚到的轉帳）：後台把訂單改成「已付款」即可，系統會重新扣庫存；庫存不夠會標成「已付款（庫存不足）」
