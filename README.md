# 肆菓 Season Flavor — 網站說明

一個純靜態網站（HTML / CSS / JS），加上一個 Google Apps Script 後端負責收單。

## 檔案結構

```
index.html            首頁（版型都在這裡，可放心手動微調）
style.css             樣式
script.js             互動邏輯：渲染商品、訂購、折扣、送單
config.js             你要填的設定（後端網址、備援信箱）
preview.html          單檔預覽版：雙擊即可看完整網站（由 build-preview.js 產生）
build-preview.js      產生 preview.html 的腳本
data/
  products.json       商品資料（單一來源，About 與甜點系列共用）
  discounts.json      折扣碼（含網紅專屬碼）
apps-script/
  Code.gs             Google Apps Script 後端（Email + Google Sheet + 折扣驗證）
images/               產品圖
```

---

## 這次施工做了什麼（四件事）

1. **訂單通知寄到信箱** — 顧客送出訂單後，後端 `MailApp` 會寄一封通知到店家信箱，並寄一封確認信給顧客。
2. **折扣碼（含網紅專屬碼）** — 在 `data/discounts.json` 設定，前端即時試算，後端 `Code.gs` 用相同碼表重新驗證金額。網紅碼會標記是哪位網紅，方便對帳。
3. **Google Sheet 自動記錄訂單** — 每筆訂單自動 append 一列到指定的 Google Sheet。
4. **產品資料拆 JSON，共用一份** — `data/products.json` 是唯一來源，首頁「About 口味牆」與「甜點系列」都讀它。改一個地方，兩區一起更新。

---

## 手動微調怎麼做（不用重跑）

版型是固定的，改動彼此不干擾：

- **改文案 / 顏色 / 間距 / 版型** → 直接改 `index.html` 和 `style.css`。
  卡片的 HTML 版型放在 `index.html` 最下方的兩個 `<template>`（`flavorCardTpl`、`productCardTpl`），
  想調卡片長相就改那裡，JS 只會把資料填進去，不會動你的結構。
- **改商品（名稱 / 價格 / 狀態 / 描述 / 換圖）** → 只改 `data/products.json`。
  `status` 填 `"available"`（現貨，可下單）或 `"upcoming"`（即將推出，不可下單）。
- **改折扣碼** → 改 `data/discounts.json`，並同步更新 `apps-script/Code.gs` 裡的 `DISCOUNTS`（後端是金額的最終依據）。

### 照片規格（已定住，不會再跑掉）

照片一致性用「兩層鎖」保證，怎麼換圖都不會歪：

1. **顯示層（CSS）**：每張產品圖都被強制放進「固定正方形框 + `object-fit: cover` + 置中」，
   不管來源照片長怎樣，框架永遠一樣。這條規則寫在 `style.css` 的 `.flavor-img img` 與 `.pf-img img`。
2. **來源層（工具）**：所有產品圖都標準化成 **800×800**，罐子以草莓為基準對齊。
   要換新照片時：
   1. 把新照片（原始檔）放進 `images_orig/`（檔名對應：`strawberry / mixed-berry / kiwi / peach`）
   2. 執行 `node normalize-jars.cjs`
   3. 它會自動縮放/置中對齊，輸出到 `images_norm/`，確認 OK 後覆蓋到 `images/`
   4. 若某張還是差一點，調 `normalize-jars.cjs` 最上面 `ADJUST` 裡該張的 `scale / dxFrac / dyFrac`

> 換句話說：**照片框架永遠固定**；就算丟一張沒對齊的新圖，跑一次工具就會回到基準，不會破版。

> **只想快速看樣子？** 直接雙擊 `preview.html` —— 它把 CSS、程式、資料、圖片
> 全部打包成一個檔，不需伺服器、不需其他檔案。
>
> 改過 `data/products.json`、`style.css` 或 `index.html` 後，
> 重跑 `node build-preview.js` 就會更新 `preview.html`。
>
> 若要預覽「正式的多檔版本」，請用本地伺服器（例如 `python3 -m http.server`）開啟整個資料夾，
> 因為瀏覽器直接用 `file://` 開單獨的 `index.html` 時無法讀取 `data/*.json`
> （此時網站會退回 `script.js` 內建的備援資料，仍可顯示、不會空白）。

---

## 後端設定（Google Apps Script）

在填好之前，網站處於「示範模式」：訂購流程都能操作，送出時會改用信箱草稿（mailto）作備援。

1. 建立一份 Google Sheet（例如「肆菓訂單」）。
2. 在該 Sheet 上方選單 **擴充功能 → Apps Script**。
3. 把 `apps-script/Code.gs` 的內容整段貼進去，覆蓋預設的 `Code.gs`。
4. 視需要修改最上方設定：
   - `NOTIFY_EMAIL`：收單通知信箱（留空 = 寄給你自己的 Google 帳號）。
   - `SHEET_ID`：留空即可（會用綁定的這份 Sheet）；若要寫到別份，填該 Sheet 的 ID。
   - `DISCOUNTS`：折扣碼碼表，需與 `data/discounts.json` 一致。
5. **部署 → 新增部署作業 → 類型選「網頁應用程式」**：
   - 執行身分：**我**
   - 誰可以存取：**任何人**
   - 按「部署」，第一次會要求授權（允許寄信與存取試算表）。
6. 複製產生的 **網頁應用程式網址**（結尾是 `/exec`）。
7. 貼到 `config.js` 的 `orderEndpoint`：

```js
window.SF_CONFIG = {
  orderEndpoint: 'https://script.google.com/macros/s/AKfycb.../exec',
  ownerEmail: 'seasonflavortw@gmail.com'
};
```

完成後，顧客送出的訂單就會：寫入 Google Sheet ＋ 寄通知信給店家 ＋ 寄確認信給顧客。

> 修改 `Code.gs` 後要重新「部署 → 管理部署作業 → 編輯 → 新版本」才會生效。

---

## 折扣碼格式

`data/discounts.json` 內每個折扣碼：

| 欄位 | 說明 |
| --- | --- |
| `code` | 折扣碼（不分大小寫） |
| `type` | `"percent"`（百分比）或 `"fixed"`（固定金額） |
| `value` | 折扣值（percent 填 10 = 打 9 折；fixed 填 50 = 折 NT$50） |
| `label` | 顯示名稱 |
| `kind` | `"general"` 或 `"influencer"` |
| `influencer` | 網紅名稱（`kind` 為 influencer 時填） |
| `minSubtotal` | 最低消費門檻（未達不套用），沒有就填 0 |
| `active` | `true` / `false` 開關 |

> 提醒：純靜態網站的折扣碼在前端原始碼看得到，這是靜態站的本質限制。
> 真正的金額計算與記錄以後端 `Code.gs` 為準，前端只是即時試算的體驗。
