# 肆菓 Season Flavor — 動態官網

延續原本的品牌形象網站風格，升級為完整的動態電商網站：線上訂購、會員系統、後台管理（含顧客 CRM）、SEO 整合。**零外部依賴**，只需要 Node.js 22+（使用內建 `node:sqlite`），不必 `npm install`。

## 快速開始

```bash
node server.js
# 前台：http://localhost:3000
# 後台：http://localhost:3000/admin
```

預設管理員帳號：`admin@seasonflavor.com`／密碼 `seasonflavor#2026`（**上線前請務必更改**，可用環境變數 `SF_ADMIN_EMAIL`、`SF_ADMIN_PASSWORD` 在首次啟動時自訂）。

環境變數：

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `3000` | 監聽埠 |
| `SF_DATA_DIR` | `./data` | SQLite 資料庫位置 |
| `SF_ADMIN_EMAIL` / `SF_ADMIN_PASSWORD` | 見上 | 首次啟動建立的管理員 |

## 功能總覽

### 前台
- **首頁**：延續原設計（Hero／關於／理念／品牌故事），商品區改為從 API 動態載入，聯絡表單直接寫入後台訊息匣
- **線上訂購 `/shop`**：商品列表、加入購物車（localStorage）
- **商品頁 `/products/:slug`**：伺服器渲染，含完整 meta、Open Graph、Product + BreadcrumbList JSON-LD
- **結帳 `/checkout`**：訪客或會員皆可下單；宅配（滿額免運）／自取；銀行轉帳（含匯款後五碼回報）／貨到付款
- **訂單查詢 `/order-lookup`**：訂單編號＋信箱雙重驗證查詢
- **會員**：註冊 `/register`、登入 `/login`、會員中心 `/account`（資料修改、改密碼、訂單紀錄）；會員結帳自動帶入資料，訪客訂單註冊後自動歸戶（同 email）

### 後台 `/admin`
- **總覽**：營收（總計／近 30 天）、訂單狀態統計、會員數、未讀訊息、熱賣商品、低庫存提醒
- **訂單管理**：狀態篩選與搜尋、明細檢視、訂單／付款狀態變更（取消自動回補庫存）
- **商品管理**：新增／編輯、價格庫存、上下架、「即將推出」檔位
- **顧客 CRM**：會員＋訪客自動建檔（以 email 歸戶）、累積消費與訂單數、自訂標籤、CRM 備註、完整訂單歷史
- **聯絡訊息**：官網表單訊息匣（未讀／已讀／已回覆）
- **商店設定**：網站網址、運費與免運門檻、匯款帳戶、付款方式開關

### SEO
- 每頁 title／description／canonical／Open Graph／Twitter Card
- 結構化資料：Organization、WebSite（首頁）、Product、BreadcrumbList（商品頁）
- 動態 `/sitemap.xml`（含商品頁）、`/robots.txt`（封鎖 admin／api／checkout）
- 語意化 HTML、圖片 alt、`lang="zh-Hant"`

### 付款方式擴充
付款方式以設定開關管理（`settings` 資料表），目前啟用銀行轉帳與貨到付款；LINE Pay 與信用卡欄位已預留，串接金流（如 TapPay、綠界、LINE Pay API）後在後台「商店設定」開啟即可顯示於結帳頁。

## 技術架構

```
server.js          HTTP 伺服器 + 路由（node:http）
src/
  db.js            SQLite schema + 種子資料（node:sqlite）
  password.js      scrypt 密碼雜湊
  auth.js          Session（HttpOnly Cookie）
  api.js           前台 API
  admin-api.js     後台 API（管理員限定）
  seo.js           sitemap / robots / 商品頁 SSR
templates/         商品頁 SSR 模板
public/            前台頁面與靜態資源
data/              SQLite 資料庫（gitignore，執行時自動建立）
```

安全性：scrypt 密碼雜湊、HttpOnly + SameSite Cookie、伺服器端計價與庫存檢查（交易內扣庫存防超賣）、所有輸出經 HTML escape、路徑跳脫防護、admin API 權限驗證。
