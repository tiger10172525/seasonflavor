/* ============================================================
 * 肆菓 Season Flavor — 後端（Cloudflare Pages 進階模式 _worker.js）
 * 網頁後台拖曳上傳不會編譯 functions/，所以後端全部合併在這一支。
 *
 * 前台頁面一律由這裡輸出完整 HTML（爬蟲不跑 JS 也看得到內文）：
 *   HTML 檔當模板，<head> 裡的 <!--SEO--> 換成 SEO 設定，
 *   內文的 <!--XXX--> 標記換成 D1 資料。
 *
 * D1 是商品、訂單、付款、庫存的唯一依據；Airtable 是營運與寄信用的副本。
 * 資料表第一次用到時自動建立（見 SCHEMA）。
 *
 * API：
 *   POST  /api/cart/quote      依 D1 重算小計、折扣、運費
 *   POST  /api/checkout        建單（D1 → Airtable），綠界付款回傳簽章表單，銀行轉帳回傳帳戶
 *   POST  /api/ecpay/notify    綠界付款成功通知（唯一入帳依據，扣庫存）
 *   POST  /api/ecpay/info      綠界 ATM／超商取號通知
 *   POST  /api/ecpay/result    刷卡後瀏覽器導回（只顯示）
 *   GET   /api/order-paid      付款是否已入帳（給 GA4 purchase）
 *   POST  /api/order-lookup    客人訂單查詢（訂單編號 + 電話）
 *   POST  /api/contact         聯絡表單 → Airtable contacts 表
 *   GET   /api/products        商品價格／庫存／規格
 *   GET   /api/health          健康檢查
 *   POST  /api/admin/login     後台登入（HttpOnly cookie session）；/logout、/session
 *   /admin-*                   後台 API，全部需要登入，改資料要帶 x-csrf
 *
 * 環境變數：ADMIN_KEY、AIRTABLE_TOKEN、ECPAY_ENV（production 才走正式金流）、
 *          ECPAY_MERCHANT_ID、ECPAY_HASH_KEY、ECPAY_HASH_IV
 *          TURNSTILE_SITE_KEY、TURNSTILE_SECRET（防機器人驗證，兩個都設才啟用）
  * ============================================================ */

const SITE  = 'https://www.seasonflavor.com';
const BRAND = '肆菓 Season Flavor';

const AIRTABLE_URL = 'https://api.airtable.com/v0/appG11Pb9ZmhQ2oLw/tblzKGSNUxruQGdex';
// 聯絡表單用表格名稱定址，不必再查一次 table ID。表格要叫 contacts。
const CONTACT_URL = 'https://api.airtable.com/v0/appG11Pb9ZmhQ2oLw/contacts';

const JOURNAL_COLS = 'id, slug, title, excerpt, body, image, date, published, updated_at';
// 後台只收這四種圖檔；副檔名與檔案內容（magic bytes）都要對得上
const UPLOAD_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX_UPLOAD = 5 * 1024 * 1024;

// ════════════════════════════════════════════════════════════
// SEO 設定：每頁的標題、描述、分享圖都在這裡改
//   title 會自動接成「title｜肆菓 Season Flavor」，整串 60 字元內
//   desc 建議 80–120 個中文字
//   crumb 是麵包屑上顯示的名字（首頁不用）
//   商品頁與文章頁的標題／描述來自 D1（後台可改），不在這裡
// ════════════════════════════════════════════════════════════
const OG_DEFAULT = '/images/season-flavor-jam-collection.jpg';
// 靜態頁面內容有改時，順手把日期改掉，sitemap 會用它當 lastmod
const PAGES_UPDATED = '2026-09-25';

const PAGES = {
  '/': {
    tpl: '/', title: '台灣手工果醬，當季水果果肉含量 80%',
    desc: '肆菓 Season Flavor 是台灣手工果醬品牌，以當季在地水果小批次熬製，果肉含量 80%，吃得到果粒。不添加防腐劑、人工色素與香料，綜合莓果、草莓、水蜜桃、奇異果四款口味，自用送禮都剛好。',
  },
  '/products/': {
    tpl: '/products', title: '果醬系列', crumb: '果醬系列',
    desc: '肆菓果醬系列共四款：綜合莓果、草莓、水蜜桃與奇異果。台灣當季水果小批次手工熬製，果肉含量 80%，吃得到果粒，不添加防腐劑、人工色素與香料。點進各口味看成分、淨重、保存方式與供應狀態。',
  },
  '/shop': {
    tpl: '/shop', title: '線上訂購', crumb: '線上訂購',
    desc: '肆菓手工果醬線上訂購，每一罐都是限量小批次製作，果肉含量 80%，吃得到果粒，售完即止。付款使用 ATM 轉帳，可選宅配到府或超商取貨，挑好口味加入購物車，把台灣當季水果的甜帶回家。',
  },
  '/about': {
    tpl: '/about', title: '品牌故事', crumb: '品牌故事',
    desc: '肆菓 Season Flavor 的品牌故事：「肆」是四季輪轉，「菓」是水果與糕菓。我們從台灣當季水果出發，小批次手工熬製果醬，不添加防腐劑、人工色素與香料，想把生活裡剛剛好的甜，好好留住。',
  },
  '/philosophy': {
    tpl: '/philosophy', title: '品牌理念', crumb: '品牌理念',
    desc: '肆菓做果醬的三個堅持：自然食材、細緻工藝、季節節奏。選用台灣當季水果，果肉含量 80%，在甜與酸之間找平衡；不追求華麗的堆疊，只在熟悉的味道裡多一點驚喜，並跟著四季推出限定風味。',
  },
  '/stories/': {
    tpl: '/journal', title: '肆菓筆記', crumb: '肆菓筆記',
    desc: '肆菓筆記記錄季節、水果與生活的片刻：台灣當季水果的風味故事、果醬的保存方式與各種吃法、手工熬煮果醬的日常。跟著四季的節奏，認識每一罐果醬背後的土地、水果與時間。',
  },
  '/faq': {
    tpl: '/faq', title: '常見問題', crumb: '常見問題',
    desc: '肆菓果醬常見問題整理：有沒有添加防腐劑、開封後怎麼保存、目前有哪些口味、在哪裡購買、適不適合當伴手禮，以及果醬怎麼搭配最好吃。購買前想知道的事，這裡一次說清楚。',
  },
  '/contact': {
    tpl: '/contact', title: '聯絡我們', crumb: '聯絡我們',
    desc: '有訂購、合作或大量送禮的需求，歡迎透過表單聯絡肆菓 Season Flavor，我們會盡快以 Email 回覆。也可以私訊 Instagram @seasonflavor_，或先看看頁面下方關於保存與購買的常見問題。',
  },
  '/terms': {
    tpl: '/terms', title: '服務條款', crumb: '服務條款',
    desc: '肆菓 Season Flavor 服務條款，說明訂購流程、ATM 轉帳付款方式、配送方式與退換貨政策。果醬屬於食品類商品，依規定不適用七日鑑賞期，下單前請先閱讀本頁內容，有任何疑問歡迎來信詢問。',
  },
  '/privacy': {
    tpl: '/privacy', title: '隱私權政策', crumb: '隱私權政策',
    desc: '肆菓 Season Flavor 隱私權政策，說明我們在訂購與聯絡表單中蒐集哪些個人資料，例如姓名、電話、Email 與地址，這些資料的使用目的，以及我們如何保護您的資料與您可以行使的權利。',
  },
  '/order-status': {
    tpl: '/order-status', title: '訂單查詢', crumb: '訂單查詢', noindex: true,
    desc: '輸入訂單編號與訂購電話，查詢肆菓 Season Flavor 訂單的付款與出貨狀態。',
  },
  '/cart': {
    tpl: '/cart', title: '購物車', crumb: '購物車', noindex: true,
    desc: '肆菓 Season Flavor 購物車。',
  },
};

// 找不到頁面時用的 404（不給收錄，也不放進 sitemap）
const NOT_FOUND = { title: '找不到這個頁面', desc: '這個頁面不存在或已經移除，請回到首頁或果醬系列看看。', noindex: true };

// 常見問題：/faq 與聯絡我們頁共用這一份，FAQPage 結構化資料也從這裡產生。
// 「有哪些口味」那題依 D1 供應狀態自動產生，不在這裡。
const FAQ = [
  ['肆菓果醬有添加防腐劑嗎？',
   '肆菓果醬不添加防腐劑、人工色素或香料。我們以台灣當季水果為主原料，果肉含量 80%，透過低溫慢煮與適當糖度保留風味，不依賴化學添加物延長保存期限。開封後請冷藏保存，2 週內食用完畢。'],
  ['在哪裡可以購買肆菓果醬？',
   '目前肆菓果醬可透過官網線上訂購。每款果醬均為限量手工製作，售完即止。若想掌握最新現貨資訊與限定口味上市消息，歡迎追蹤 Instagram @seasonflavor_，我們會在第一時間公告。'],
  ['肆菓果醬適合當伴手禮嗎？',
   '非常適合。肆菓果醬以台灣當季水果限量製作，兼具風味特色與質感包裝，適合作為彌月禮、朋友生日、節慶伴手禮或企業禮品。若有客製化需求或大量訂購，歡迎透過官網聯絡表單與我們討論。'],
  null, // ← 「有哪些口味」放這個位置
  ['果醬開封後怎麼保存？',
   '未開封常溫保存 2 個月，請放在陰涼乾燥處、避免陽光直射；開封後請冷藏，2 週內食用完畢。由於產品不含防腐劑，取用時請使用乾淨湯匙，避免水分進入影響保存品質。'],
  ['果醬怎麼吃最好？',
   '搭配吐司或餅乾是最基本的吃法，果醬的濃郁果香能讓簡單的早餐升級。也可加入原味優格或燕麥粥，增添天然甜味；調入氣泡水或茶飲，就成了一杯清爽的水果飲品。烘焙時加入蛋糕、塔皮或瑪芬也非常合適。'],
];

// 商品頁的「產品特色／付款／配送」。付款與運費要跟 shop.js 的 SHIPPING 一致。
const FEATURES = '果肉含量 80%，吃得到果粒；不添加防腐劑、人工色素與香料';
const PAYMENT  = 'ATM 轉帳（下單後 3 天內完成匯款）';
const DELIVERY = '宅配到府 NT$120，1–2 個工作天送達；超商取貨（7-ELEVEN／全家）NT$60，2–3 個工作天送達';
// 食品標示裡每款都一樣的欄位
const ORIGIN   = '台灣';
const ALLERGEN = '本產品不含常見過敏原';
const MAKER    = '肆菓 Season Flavor（手工製作）・聯絡：IG @seasonflavor_';
// 營養標示欄位（D1 nutrition 欄存 JSON，數值都是每 100 公克）
const NUTRITION = [
  ['calories', '熱量'], ['protein', '蛋白質'], ['fat', '脂肪'], ['satfat', '　飽和脂肪'],
  ['transfat', '　反式脂肪'], ['carb', '碳水化合物'], ['sugar', '　糖'], ['sodium', '鈉'],
];

// 商品頁資訊區的圖示（沿用原本商品資訊視窗的設計）
const ICON = {
  food: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 4.5h8a2 2 0 0 1 2 2V20H6V6.5a2 2 0 0 1 2-2Z" stroke-width="1.8"/><path d="M9 3h6v3H9z" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 10h6M9 14h6M9 18h4" stroke-width="1.8" stroke-linecap="round"/></svg>',
  nut: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3v7M4 3v5.2A2.8 2.8 0 0 0 6.8 11H7.2A2.8 2.8 0 0 0 10 8.2V3M7 11v10" stroke-width="1.8" stroke-linecap="round"/><path d="M16 3c2.2 0 4 2.7 4 6v3h-4V3Zm0 9v9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  natural: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.5 4.5C13 4.7 7.5 7.4 5.4 12.2c-1 2.4-.5 4.7 1 6.1 1.4 1.4 3.6 1.7 5.8.6 4.2-2.1 6.8-7.6 7.3-14.4Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20c2.2-4.4 5.4-7.4 9.6-9.6" stroke-width="1.8" stroke-linecap="round"/></svg>',
  hand: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 7.1c4.1 0 6.2 2.5 5.7 6.1-.5 3.7-3.1 6.7-5.7 6.7s-5.2-3-5.7-6.7C5.8 9.6 7.9 7.1 12 7.1Z" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 7.4C8.5 5.8 9.2 4.6 10.8 4c.2 1.2.7 2 1.2 2.7.5-.7 1-1.5 1.2-2.7 1.6.6 2.3 1.8 1.8 3.4" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.6 11.3h.01M14.3 11.3h.01M10.8 14.2h.01M13.1 16.6h.01M14.8 14.4h.01" stroke-width="2.2" stroke-linecap="round"/></svg>',
  vegan: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 20V10.5" stroke-width="1.8" stroke-linecap="round"/><path d="M12 12c-4.2 0-6.7-2.2-7-6 4.1 0 6.5 1.8 7 6Z" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10.5c.7-3.8 3.1-5.8 7-5.8-.2 3.9-2.6 6-7 5.8Z" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 7v6" stroke-width="2" stroke-linecap="round"/><path d="M12 17h.01" stroke-width="2.4" stroke-linecap="round"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.5 4.5C13 4.7 7.5 7.4 5.4 12.2c-1 2.4-.5 4.7 1 6.1 1.4 1.4 3.6 1.7 5.8.6 4.2-2.1 6.8-7.6 7.3-14.4Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20c2.2-4.4 5.4-7.4 9.6-9.6" stroke-width="1.8" stroke-linecap="round"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7" cy="18" r="1.6" stroke-width="1.8"/><circle cx="17" cy="18" r="1.6" stroke-width="1.8"/></svg>',
};

// 商品全部在 D1 products 表：名稱、圖片、文案、價格、庫存、規格，後台可新增與修改。
// 這裡只是 D1 還沒遷移或讀不到時的備援，以及原本四款的卡片底色（bg，對應 style.css 的 xxx-bg）。
const CATALOG = [
  { id: 'mixed-berry', bg: 'berry', name: '綜合莓果果醬', en: 'Mixed Berry Jam',
    image: '/images/mixed-berry-jam-jar.webp', w: 1448, h: 1086,
    alt: '肆菓綜合莓果果醬玻璃罐，深紅色果醬裡看得到莓果顆粒', card: '深邃的果香，帶著一點點神秘的尾韻' },
  { id: 'strawberry', bg: 'strawberry', name: '草莓果醬', en: 'Strawberry Jam',
    image: '/images/strawberry-jam-jar.webp', w: 1600, h: 1200,
    alt: '肆菓草莓果醬玻璃罐，旁邊擺著新鮮的台灣草莓', card: '溫柔的酸與甜，像是春天剛開始的感覺' },
  { id: 'peach', bg: 'peach', name: '水蜜桃果醬', en: 'White Peach Jam',
    image: '/images/peach-jam-jar.webp', w: 1448, h: 1086,
    alt: '肆菓水蜜桃果醬玻璃罐，淡橘色果醬帶有水蜜桃果肉', card: '多汁飽滿，是夏天最讓人期待的一種甜' },
  { id: 'kiwi', bg: 'kiwi', name: '奇異果果醬', en: 'Kiwi Jam',
    image: '/images/kiwi-jam-jar.webp', w: 1448, h: 1086,
    alt: '肆菓奇異果果醬玻璃罐，綠色果醬裡有黑色奇異果籽', card: '清爽帶勁的綠意，讓人精神一振的酸甜' },
];
// 後台可以編輯的文字欄位與數字欄位（都在 D1 products 表）
const SPEC_COLS = ['name', 'sku', 'net_weight', 'ingredients', 'shelf_life', 'storage', 'description'];
const TEXT_COLS = [...SPEC_COLS, 'en', 'image', 'alt', 'card', 'nutrition'];
const NUM_COLS  = ['image_w', 'image_h', 'sort_order', 'hidden'];
// 有 -480 / -800 縮圖的商品圖（images/ 裡的檔案）；後台上傳到 R2 的圖沒有縮圖，就只輸出原圖
const RESPONSIVE = new Set(['/images/mixed-berry-jam-jar.webp', '/images/strawberry-jam-jar.webp',
  '/images/peach-jam-jar.webp', '/images/kiwi-jam-jar.webp']);
const srcset = (p, sizes) => (RESPONSIVE.has(p.image)
  ? ` srcset="${p.image.replace('.webp', '-480.webp')} 480w, ${p.image.replace('.webp', '-800.webp')} 800w, ${p.image} ${p.w}w" sizes="${sizes}"`
  : '');
const CARD_SIZES = '(max-width: 768px) 50vw, 360px';

// 網址代稱：英文小寫、數字、連字號，例如 lemon、yuzu-honey
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// 圖片改名後，舊網址 301 到新檔名（舊文章或外部連結可能還引用舊檔名）
const IMAGE_RENAMES = {
  'hero-jars.jpg': 'season-flavor-jam-jars-hero.webp',
  'products-mockup.jpg': 'season-flavor-jam-collection.webp',
  'strawberry.jpg': 'strawberry-jam-jar.webp',
  'product-mixed-berry.png': 'mixed-berry-jam-jar.webp',
  'product-peach.png': 'peach-jam-jar.webp',
  'product-kiwi.png': 'kiwi-jam-jar.webp',
  'ref-orchard-valley.jpg': 'taiwan-orchard-valley-sunset.webp',
  'ref-strawberry-field.jpg': 'taiwan-strawberry-greenhouse.webp',
  'philosophy-jars.jpg': 'handmade-jam-jars-with-berries.webp',
  'ref-jam-cooking.jpg': 'strawberry-jam-cooking-pot.webp',
  'ref-berries-bowl.jpg': 'fresh-berries-bowl.webp',
};

// 舊網址 → 新網址（301）
const REDIRECTS = {
  '/index.html': '/', '/index': '/',
  '/products': '/products/', '/products.html': '/products/',
  '/product': '/products/', '/product.html': '/products/',
  '/shop.html': '/shop',
  '/about.html': '/about', '/philosophy.html': '/philosophy',
  '/contact.html': '/contact', '/terms.html': '/terms', '/privacy.html': '/privacy',
  '/faq.html': '/faq', '/cart.html': '/cart',
  '/journal': '/stories/', '/journal.html': '/stories/', '/journal/': '/stories/',
  '/journal-post': '/stories/', '/journal-post.html': '/stories/', '/stories': '/stories/',
};

// ════════════════════════════════════════════════════════════

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 轉義 < 避免文章標題塞進 </script> 提前關掉區塊
const ldJson = (obj) =>
  `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...obj }).replace(/</g, '\\u003c')}</script>`;

const abs = (u) => (/^https?:\/\//.test(u) ? u : SITE + u);

// ── SECURITY ──
// 'unsafe-inline'：頁面內有 gtag 片段與 onclick，拿掉會壞；外部來源仍限定在下列網域
const CSP = [
  "default-src 'self'",
  // 不允許行內程式碼：只放行兩段固定內容的小腳本（GA 設定、字型載入），內容改了要重算 hash：
  //   node -e "console.log(require('crypto').createHash('sha256').update(腳本內容).digest('base64'))"
  "script-src 'self' 'sha256-JHiAVMnkimLa7hCLf6lu36cI/08QVtTYznEthC22E/U=' 'sha256-HE3wtYbi18w66pE/QED3Pc+Ach6VhMam1F3s7iknsps=' https://www.googletagmanager.com https://challenges.cloudflare.com",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
  "form-action 'self' https://payment.ecpay.com.tw https://payment-stage.ecpay.com.tw",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': CSP,
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// 前端資料錯誤（金額、庫存、欄位格式），訊息可以直接給客人看
class UserError extends Error {}

// 次數限制用的來源：IPv6 取前 64 位元（同一個 /64 可以隨意換位址，逐一計數擋不住）
const clientIp = (request) => {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!ip.includes(':')) return ip;
  // 先把 :: 展開成完整 8 段，再取前 4 段（2001:db8::a 和 2001:db8::b 要算同一個 /64）
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : ip.split(':');
  return full.slice(0, 4).map((x) => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
};

// 只收 JSON，body 上限 32KB
async function readJson(request, max = 32768) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) throw new UserError('資料格式錯誤');
  const text = await request.text();
  if (text.length > max) throw new UserError('資料太大');
  try { return JSON.parse(text); } catch { throw new UserError('資料格式錯誤'); }
}

const randomId = (len, chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') =>
  [...crypto.getRandomValues(new Uint8Array(len))].map((b) => chars[b % chars.length]).join('');

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const taipeiNow = () => new Date(Date.now() + 8 * 3600e3);   // 用 UTC 欄位讀出台北時間
const taipeiDate = () => taipeiNow().toISOString().slice(0, 10);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
  });

const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });

const redirect = (to) =>
  new Response(null, { status: 301, headers: { Location: to, ...SECURITY_HEADERS } });

// ── 商品資料（D1）──────────────────────────────────────────
// 回傳依 sort_order 排好的商品清單（不含隱藏的）。
// 沒綁 D1 或查不到時用 CATALOG，全部當作「補貨中」，網站不會壞。
async function loadProducts(env, { withHidden = false } = {}) {
  let rows = [];
  if (env.DB) {
    try { rows = (await env.DB.prepare('SELECT * FROM products').all()).results || []; }
    catch { /* 用備援 */ }
  }
  if (!rows.length) rows = CATALOG.map((c) => ({ product_id: c.id }));

  return rows.map((r) => {
    const c = CATALOG.find((x) => x.id === r.product_id) || {};
    const pick = (k) => String(r[k] ?? '').trim();
    const p = {
      id: r.product_id,
      bg: c.bg || '',
      en: pick('en') || c.en || '',
      image: pick('image') || c.image || OG_DEFAULT,
      w: Number(r.image_w) || c.w || 1200,
      h: Number(r.image_h) || c.h || 1200,
      alt: pick('alt') || c.alt || '',
      card: pick('card') || c.card || '',
      available: !!r.available,
      stock: Number(r.stock) || 0,
      price: r.price != null ? Number(r.price) : null,
      hidden: !!Number(r.hidden),
      sort: r.sort_order != null ? Number(r.sort_order) : (CATALOG.indexOf(c) + 1 || 99),
      updated: String(r.updated_at || '').slice(0, 10),
    };
    for (const k of SPEC_COLS) p[k] = pick(k);
    try { p.nutrition = JSON.parse(r.nutrition || '{}') || {}; } catch { p.nutrition = {}; }
    p.name = p.name || c.name || p.id;
    p.alt = p.alt || `${BRAND}${p.name}`;
    // 找相關文章用的關鍵字：「綜合莓果果醬」→「莓果」
    p.kw = p.name.replace(/果醬$/, '').replace(/^綜合/, '');
    return p;
  }).filter((p) => withHidden || !p.hidden).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}
// instock 可以買 / soldout 有在賣但沒貨 / upcoming 還沒上市
// 品牌故事頁「目前供應…」那句：口味與價格跟著後台 D1 走，不寫死在 about.html
function priceLine(products) {
  const list = products.filter((p) => p.available && p.price != null).map((p) => `${esc(p.name)}（NT$${p.price}）`);
  if (!list.length) return '當季手工果醬';
  return list.length === 1 ? list[0] : list.slice(0, -1).join('、') + '與' + list[list.length - 1];
}

const stateOf = (p) => (!p.available ? 'upcoming' : p.stock > 0 ? 'instock' : 'soldout');

// 診斷端點：不洩漏任何值，只回報「環境變數有沒有到後端、長度多少、綁定在不在」
async function diag(env, request) {
  const count = async (q) => { try { return (await env.DB.prepare(q).first()).n; } catch { return 'ERROR'; } };
  return json({
    d1: env.DB ? 'OK' : 'MISSING',
    r2: env.MEDIA ? 'OK' : 'MISSING',
    airtable: (env.AIRTABLE_TOKEN || '').trim() ? 'configured' : 'MISSING',
    ecpay: ecpayCfg(env, new URL(request.url).hostname)?.mode || 'disabled（未設定正式金鑰）',
    adminKey: (env.ADMIN_KEY || '').trim() ? 'configured' : 'MISSING',
    ga4: 'G-M50GS7GQC8',
    products: env.DB ? await count('SELECT count(*) AS n FROM products') : 0,
    posts: env.DB ? await count('SELECT count(*) AS n FROM journal WHERE published = 1') : 0,
    ordersUnsynced: env.DB ? await count(`SELECT count(*) AS n FROM orders WHERE airtable_status != 'synced'`) : 0,
    productsMissingIngredients: env.DB ? await count(`SELECT count(*) AS n FROM products WHERE coalesce(trim(ingredients), '') = ''`) : 0,
  });
}

// ── GET /api/products ───────────────────────────────────────
async function listProducts(env) {
  if (!env.DB) return json([]);
  const list = await loadProducts(env);
  return json(list.map((p) => ({
    id: p.id, name: p.name, available: p.available, stock: p.stock, price: p.price,
    image: p.image, alt: p.alt, card: p.card, bg: p.bg,
    net_weight: p.net_weight, ingredients: p.ingredients, shelf_life: p.shelf_life, storage: p.storage,
  })));
}

// ── /admin-orders ───────────────────────────────────────────
// 列表仍讀 Airtable（含改版前的舊訂單與擺攤銷售）；改狀態時 D1 有這筆就照狀態機改 D1，再同步回 Airtable
async function adminOrders(request, env, url) {
  const denied = await adminAuth(request, env); if (denied) return denied;
  const token = (env.AIRTABLE_TOKEN || '').trim();
  if (!token) return json({ error: '伺服器未設定 AIRTABLE_TOKEN' }, 500);

  if (request.method === 'GET') {
    const offset = url.searchParams.get('offset');
    let unsynced = 0;
    if (!offset && env.DB) {
      // 打開後台時順便重送之前同步失敗的訂單
      const { results } = await env.DB.prepare(`SELECT order_id FROM orders WHERE airtable_status != 'synced' ORDER BY created_at LIMIT 10`).all();
      for (const r of results || []) await syncAirtable(env, r.order_id);
      unsynced = (await env.DB.prepare(`SELECT count(*) AS n FROM orders WHERE airtable_status != 'synced'`).first()).n;
    }
    const res = await fetch(AIRTABLE_URL + (offset ? `?offset=${encodeURIComponent(offset)}` : ''), {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 密碼已通過驗證；Airtable 若回錯，不要把它的 401 原樣傳回，否則前端會誤判成「密碼錯誤」
    if (!res.ok) return json({ error: 'Airtable 連線失敗（請檢查 AIRTABLE_TOKEN 是否完整）：' + (await res.text()), unsynced }, 502);
    return json({ ...(await res.json()), unsynced });
  }
  if (request.method === 'PATCH') {
    const body = await readJson(request);
    const recordId = String(body.recordId || '');
    const label = String(body.fields?.status || '');
    if (!/^rec[A-Za-z0-9]{14}$/.test(recordId) || !label) return json({ error: '資料格式錯誤' }, 400);
    const auth = { Authorization: `Bearer ${token}` };
    const rec = await fetch(`${AIRTABLE_URL}/${recordId}`, { headers: auth }).then((r) => (r.ok ? r.json() : null));
    const o = rec?.fields?.order_id && env.DB
      ? await env.DB.prepare('SELECT * FROM orders WHERE order_id = ?').bind(String(rec.fields.order_id)).first() : null;
    if (o) {
      const target = LABEL_STATUS[label];
      if (!target) return json({ error: `不支援的狀態「${label}」` }, 400);
      const r = await setStatus(env, o, target);
      if (!r.ok) return json({ error: r.error }, 409);
      await syncAirtable(env, o.order_id);
      return json({ ok: true });
    }
    // 改版前的舊訂單、擺攤銷售：只在 Airtable，只允許改狀態
    const res = await fetch(`${AIRTABLE_URL}/${recordId}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { status: label }, typecast: true }),
    });
    return json(await res.json(), res.status);
  }
  return json({ error: 'method not allowed' }, 405);
}

// ── POST /admin-pos-sync ────────────────────────────────────
// 擺攤 POS（admin-pos.html）離線結帳的銷售，回家連網後送來這裡：
//   新的銷售 → 記進 D1 pos_sales 並扣商品庫存 → 寫進 Airtable 訂單（status 完成）
// 同一筆重送不會重複：pos_sales 以 id 去重，airtable 欄位記錄是否已寫進 Airtable。
async function posSync(request, env) {
  const denied = await adminAuth(request, env); if (denied) return denied;
  const token = (env.AIRTABLE_TOKEN || '').trim();
  if (!token || !env.DB) return json({ ok: false, error: '伺服器未設定 AIRTABLE_TOKEN 或 D1' }, 500);
  let sales;
  try { sales = (await request.json()).sales; } catch { return json({ ok: false, error: '資料格式錯誤' }, 400); }
  if (!Array.isArray(sales) || !sales.length || sales.length > 10) return json({ ok: false, error: '一次送 1–10 筆' }, 400);

  const rows = [];
  for (const s of sales) {
    const id = String(s?.id || '');
    const items = (Array.isArray(s?.items) ? s.items : []).map((i) => ({
      id: String(i?.id || ''), name: String(i?.name || '').slice(0, 50),
      price: Number(i?.price) || 0, qty: Number(i?.qty),
    })).filter((i) => i.id && Number.isInteger(i.qty) && i.qty > 0 && i.qty < 1000);
    if (!/^POS[\w-]{6,40}$/.test(id) || !items.length) return json({ ok: false, error: '銷售資料格式錯誤：' + id }, 400);
    rows.push({
      id, items,
      total: Math.round(Number(s.total)) || 0,
      payment: String(s.payment || '現金').slice(0, 20),
      created_at: String(s.created_at || '').slice(0, 40),
    });
  }

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pos_sales (
    id TEXT PRIMARY KEY, created_at TEXT, items TEXT, total INTEGER, payment TEXT,
    airtable INTEGER NOT NULL DEFAULT 0)`).run();

  // 第一次收到的銷售才扣庫存
  for (const r of rows) {
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO pos_sales (id, created_at, items, total, payment) VALUES (?, ?, ?, ?, ?)')
      .bind(r.id, r.created_at, JSON.stringify(r.items), r.total, r.payment).run();
    if (ins.meta.changes) {
      await env.DB.batch(r.items.map((i) =>
        env.DB.prepare('UPDATE products SET stock = MAX(stock - ?, 0) WHERE product_id = ?').bind(i.qty, i.id)));
    }
  }

  // 還沒寫進 Airtable 的一次送出（Airtable 一次上限 10 筆）
  const ids = rows.map((r) => r.id);
  const { results } = await env.DB.prepare(`SELECT id FROM pos_sales WHERE airtable = 0 AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all();
  const todo = rows.filter((r) => results.some((x) => x.id === r.id));
  if (todo.length) {
    const res = await fetch(AIRTABLE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // typecast：payment 若是單選欄位，沒有的選項（擺攤-現金）會自動建立
      body: JSON.stringify({
        typecast: true,
        records: todo.map((r) => ({ fields: {
          order_id: r.id,
          name: '擺攤現場',
          items: r.items.map((i) => `${i.name} ×${i.qty}  NT$${(i.price * i.qty).toLocaleString()}`).join('\n'),
          total: r.total,
          payment: '擺攤-' + r.payment,
          status: '完成',
          created_at: r.created_at,
          note: 'POS 擺攤結帳',
        } })),
      }),
    });
    if (!res.ok) return json({ ok: false, error: 'Airtable: ' + (await res.text()) }, 502);
    await env.DB.prepare(`UPDATE pos_sales SET airtable = 1 WHERE id IN (${todo.map(() => '?').join(',')})`)
      .bind(...todo.map((r) => r.id)).run();
  }
  return json({ ok: true, synced: ids });
}

// ── /admin-products ─────────────────────────────────────────
// 從後台送來的欄位挑出可以寫進 D1 的部分
// 圖片網址只收站內 /images/、/media/ 或 https://，不能有引號、空白、角括號
const SAFE_IMG = /^(\/images\/|\/media\/|https:\/\/)[^\s"'<>\\]{1,500}$/;
const checkImg = (v) => { if (v && !SAFE_IMG.test(v)) throw new UserError('圖片網址格式不正確（只接受 /images/、/media/ 或 https:// 開頭）'); return v; };

function productFields(body) {
  const f = {};
  if ('available' in body) f.available = body.available ? 1 : 0;
  if ('stock' in body) f.stock = Math.max(0, Number(body.stock) || 0);
  if ('price' in body) f.price = (body.price === '' || body.price == null) ? null : Number(body.price);
  for (const k of TEXT_COLS) if (typeof body[k] === 'string') f[k] = body[k].trim();
  if ('image' in f) checkImg(f.image);
  for (const k of NUM_COLS) if (k in body && body[k] !== '') f[k] = Number(body[k]) || 0;
  return f;
}
const d1Error = (err) => {
  console.error('D1:', String(err));
  return json({ error: /no such column/i.test(String(err)) ? 'D1 還沒加商品欄位，請先照 SETUP.md 3.8 執行 SQL' : '資料庫錯誤，請稍後再試' }, 500);
};

async function adminProducts(request, env) {
  const denied = await adminAuth(request, env); if (denied) return denied;
  if (!env.DB) return json({ error: 'D1 未綁定（請在 Pages → Settings → Bindings 加 DB）' }, 500);

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT *, product_id AS id FROM products').all();
    const order = (r) => (r.sort_order != null ? Number(r.sort_order) : 99);
    return json((results || []).sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id)));
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: '缺少 id' }, 400);
  const f = productFields(body);

  // 新增商品
  if (request.method === 'POST') {
    if (!SLUG_RE.test(id)) return json({ error: '網址代稱只能用英文小寫、數字與連字號，例如 lemon 或 yuzu-honey' }, 400);
    if (!f.name) return json({ error: '缺少商品名稱' }, 400);
    const exists = await env.DB.prepare('SELECT 1 FROM products WHERE product_id = ?').bind(id).first();
    if (exists) return json({ error: `網址代稱「${id}」已經有商品在用` }, 409);
    const cols = Object.keys(f);
    try {
      await env.DB
        .prepare(`INSERT INTO products (product_id, ${cols.join(', ')}, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, datetime('now'))`)
        .bind(id, ...Object.values(f)).run();
    } catch (err) { return d1Error(err); }
    return json({ ok: true, id });
  }

  // 修改：只更新有送的欄位，舊版後台只送價格庫存也不會把其他資料清空
  if (request.method === 'PATCH') {
    const cols = Object.keys(f);
    if (!cols.length) return json({ error: '沒有要更新的欄位' }, 400);
    try {
      await env.DB
        .prepare(`UPDATE products SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE product_id = ?`)
        .bind(...Object.values(f), id).run();
    } catch (err) { return d1Error(err); }
    return json({ ok: true, id });
  }
  return json({ error: 'method not allowed' }, 405);
}

// ── /api/journal ────────────────────────────────────────────
// 前台讀已發佈的筆記；id 省略時回整份清單
async function apiJournal(env, id) {
  if (!env.DB) return json([]);
  try {
    if (id) {
      const row = await env.DB
        .prepare(`SELECT ${JOURNAL_COLS} FROM journal WHERE id = ? AND published = 1`)
        .bind(id).first();
      return row ? json(row) : json({ error: 'not found' }, 404);
    }
    return json(await loadPosts(env));
  } catch { return json([]); }
}

async function loadPosts(env) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB
      .prepare(`SELECT ${JOURNAL_COLS} FROM journal WHERE published = 1 ORDER BY date DESC, id DESC`).all();
    return results || [];
  } catch { return []; }
}

async function loadSettings(env) {
  if (!env.DB) return {};
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries((results || []).map((r) => [r.key, r.value]));
  } catch { return {}; }
}

// ── /admin-journal ──────────────────────────────────────────
async function adminJournal(request, env, url) {
  const denied = await adminAuth(request, env); if (denied) return denied;
  if (!env.DB) return json({ error: 'D1 未綁定（請在 Pages → Settings → Bindings 加 DB）' }, 500);

  if (request.method === 'GET') {
    const { results } = await env.DB
      .prepare(`SELECT ${JOURNAL_COLS} FROM journal ORDER BY date DESC, id DESC`).all();
    return json(results || []);
  }

  if (request.method === 'DELETE') {
    const id = Number(url.searchParams.get('id'));
    if (!id) return json({ error: '缺少 id' }, 400);
    await env.DB.prepare('DELETE FROM journal WHERE id = ?').bind(id).run();
    return json({ ok: true, id });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const f = {
    title:     String(body.title || '').trim(),
    excerpt:   String(body.excerpt || '').trim(),
    body:      String(body.body || ''),
    image:     checkImg(String(body.image || '').trim()),
    date:      String(body.date || '').trim() || new Date().toISOString().slice(0, 10),
    published: body.published ? 1 : 0,
    slug:      String(body.slug || '').trim().toLowerCase() || null,
  };
  if (!f.title) return json({ error: '缺少標題' }, 400);
  if (f.slug && !SLUG_RE.test(f.slug)) return json({ error: '網址名稱只能用英文小寫、數字與連字號，例如 strawberry-season' }, 400);
  if (f.slug) {
    const dup = await env.DB.prepare('SELECT id FROM journal WHERE slug = ? AND id != ?').bind(f.slug, Number(body.id) || 0).first();
    if (dup) return json({ error: `網址名稱「${f.slug}」已經有文章在用` }, 409);
  }

  if (request.method === 'POST') {
    const res = await env.DB
      .prepare("INSERT INTO journal (title, excerpt, body, image, date, published, slug, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))")
      .bind(f.title, f.excerpt, f.body, f.image, f.date, f.published, f.slug).run();
    return json({ ok: true, id: res.meta?.last_row_id });
  }
  if (request.method === 'PATCH') {
    if (!body.id) return json({ error: '缺少 id' }, 400);
    await env.DB
      .prepare("UPDATE journal SET title = ?, excerpt = ?, body = ?, image = ?, date = ?, published = ?, slug = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(f.title, f.excerpt, f.body, f.image, f.date, f.published, f.slug, body.id).run();
    return json({ ok: true, id: body.id });
  }
  return json({ error: 'method not allowed' }, 405);
}

// ── /admin-settings ─────────────────────────────────────────
async function adminSettings(request, env) {
  const denied = await adminAuth(request, env); if (denied) return denied;
  if (!env.DB) return json({ error: 'D1 未綁定（請在 Pages → Settings → Bindings 加 DB）' }, 500);

  if (request.method === 'GET') return json(await loadSettings(env));
  if (request.method === 'PATCH') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)').run();
    const SETTING_KEYS = /^(journal_hero|pay_(credit_card|line_pay|ecpay_atm|ecpay_cvs|bank_transfer)|bank_(name|code|branch|holder|account))$/;
    for (const [k, v] of Object.entries(body)) {
      if (!SETTING_KEYS.test(k)) return json({ error: '不認得的設定：' + String(k).slice(0, 40) }, 400);
      if (k === 'journal_hero') checkImg(String(v ?? '').trim());
      if (String(v ?? '').length > 500) return json({ error: '設定內容太長' }, 400);
    }
    for (const [k, v] of Object.entries(body)) {
      await env.DB
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind(String(k), String(v ?? '')).run();
    }
    return json({ ok: true });
  }
  return json({ error: 'method not allowed' }, 405);
}

// ── POST /admin-upload ──────────────────────────────────────
// 原始位元組直接當 body 送上來，檔名放 x-filename 標頭（不解析 multipart）
// 副檔名與檔案開頭的格式標記都要是 jpg／png／webp；存檔用隨機檔名，不沿用原檔名
function sniffImage(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return '';
}

async function adminUpload(request, env) {
  const denied = await adminAuth(request, env); if (denied) return denied;
  if (!env.MEDIA) return json({ error: 'R2 未綁定（請在 Pages → Settings → Bindings 加 MEDIA）' }, 500);
  if (Number(request.headers.get('content-length') || 0) > MAX_UPLOAD) return json({ error: '檔案超過 5MB，請先壓縮再上傳' }, 413);

  let name = request.headers.get('x-filename') || '';
  try { name = decodeURIComponent(name); } catch { /* 沒編碼過就照用 */ }
  const ext = (name.split(/[\\/]/).pop().split('.').pop() || '').toLowerCase();
  if (!UPLOAD_MIME[ext]) return json({ error: '只接受 jpg / png / webp' }, 400);

  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ error: '檔案是空的' }, 400);
  if (buf.byteLength > MAX_UPLOAD) return json({ error: '檔案超過 5MB，請先壓縮再上傳' }, 413);
  const mime = sniffImage(buf);
  if (!mime || mime !== UPLOAD_MIME[ext]) return json({ error: '檔案內容不是有效的 jpg / png / webp 圖片' }, 400);

  const key = `uploads/${crypto.randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: mime } });
  return json({ ok: true, url: '/media/' + key });
}

// ── GET /media/<key> ────────────────────────────────────────
async function serveMedia(env, key) {
  if (!env.MEDIA) return new Response('R2 未綁定', { status: 500 });
  if (!/^uploads\/[A-Za-z0-9._-]{1,200}$/.test(key) || key.includes('..')) return new Response('not found', { status: 404 });
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  const headers = new Headers(SECURITY_HEADERS);
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}

// Cloudflare Turnstile（防機器人）：設了 TURNSTILE_SECRET 才驗證；沒設時放行（設定前網站照常運作）
async function turnstileOk(env, token, request) {
  const secret = (env.TURNSTILE_SECRET || '').trim();
  if (!secret) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  body.append('remoteip', request.headers.get('CF-Connecting-IP') || '');
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    return !!(await r.json()).success;
  } catch { return false; }
}
const TS_FAIL = () => json({ ok: false, error: '安全驗證沒有通過，請重新整理頁面後再試' }, 403);

// ── GET /admin-order-detail?id= — 後台訂單詳情側欄（D1；改版前的舊單回 404）
async function adminOrderDetail(request, env, url) {
  const denied = await adminAuth(request, env); if (denied) return denied;
  const id = String(url.searchParams.get('id') || '').toUpperCase();
  if (!/^[A-Z0-9-]{1,30}$/.test(id) || !env.DB) return json({ error: 'not found' }, 404);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE order_id = ?').bind(id).first();
  if (!o) return json({ error: '這筆是改版前的舊訂單，只有 Airtable 資料' }, 404);
  const items = (await env.DB.prepare('SELECT product_name, unit_price, qty, line_total FROM order_items WHERE order_id = ? ORDER BY id').bind(id).all()).results || [];
  const events = (await env.DB.prepare('SELECT rtn_code, amount, created_at FROM payment_events WHERE order_id = ? ORDER BY id').bind(id).all()).results || [];
  return json({
    order_id: o.order_id, status: STATUS_LABEL[o.status] || o.status, name: o.name, phone: o.phone, email: o.email,
    ship: shipLine(o), subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, total: o.total, coupon: o.coupon_code,
    payment: PAY_LABEL[o.payment_method] || o.payment_method, payment_info: paymentInfoText(o), note: o.note,
    created_at: fmtTaipei(o.created_at), paid_at: o.paid_at ? fmtTaipei(o.paid_at) : '', updated_at: fmtTaipei(o.updated_at),
    inventory: o.inventory_status, items,
    events: events.map((e) => ({ code: e.rtn_code, amount: e.amount, at: fmtTaipei(e.created_at) })),
  });
}

// ── GET /admin-stats — 總覽卡片：今日／本月營收、待出貨、低庫存、熱銷（台北時間）
async function adminStats(request, env) {
  const denied = await adminAuth(request, env); if (denied) return denied;
  if (!env.DB) return json({ error: 'D1 未綁定' }, 500);
  const paid = `status IN (${PAID_STATES.map(() => '?').join(', ')})`;
  const sum = (since) => env.DB.prepare(`SELECT coalesce(sum(total), 0) n, count(*) c FROM orders WHERE ${paid} AND date(paid_at, '+8 hours') >= ${since}`).bind(...PAID_STATES).first();
  const [today, month, toShip, low, top] = await Promise.all([
    sum("date('now', '+8 hours')"),
    sum("date('now', '+8 hours', 'start of month')"),
    env.DB.prepare(`SELECT count(*) n FROM orders WHERE status IN ('paid', 'processing', 'paid_stock_conflict')`).first(),
    env.DB.prepare('SELECT name, stock FROM products WHERE available = 1 AND coalesce(hidden, 0) = 0 AND stock <= 5 ORDER BY stock').all(),
    env.DB.prepare(`SELECT i.product_name name, sum(i.qty) qty FROM order_items i JOIN orders o ON o.order_id = i.order_id
      WHERE o.${paid} AND o.paid_at >= datetime('now', '-30 days') GROUP BY i.product_name ORDER BY qty DESC LIMIT 5`).bind(...PAID_STATES).all(),
  ]);
  return json({ today: today.n, todayCount: today.c, month: month.n, monthCount: month.c, toShip: toShip.n,
    low: low.results || [], top: top.results || [] });
}

// ── POST /api/contact ───────────────────────────────────────
// 聯絡表單寫進 Airtable 的 contacts 表。表格不存在時照實回報，不假裝成功。
async function createContact(request, env) {
  const token = (env.AIRTABLE_TOKEN || '').trim();
  if (!token) { console.error('contact: AIRTABLE_TOKEN missing'); return json({ ok: false, error: '送出失敗，請稍後再試' }, 500); }

  if (await limited(env, 'contact:' + clientIp(request), 5, 600)) return json({ ok: false, error: '送出次數太多，請稍後再試' }, 429);
  const data = await readJson(request, 16384);
  if (!(await turnstileOk(env, data.turnstile, request))) return TS_FAIL();

  const fields = {
    name:       String(data.name || '').trim().slice(0, 100),
    email:      String(data.email || '').trim().slice(0, 200),
    message:    String(data.message || '').trim().slice(0, 5000),
    status:     '未回覆',
    created_at: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
  };
  if (!fields.name || !fields.message) return json({ ok: false, error: '缺少名字或訊息' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return json({ ok: false, error: 'Email 格式不正確' }, 400);

  try {
    const res = await fetch(CONTACT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) { console.error('contact: Airtable', res.status); return json({ ok: false, error: '送出失敗，請稍後再試' }, 502); }
    return json({ ok: true });
  } catch (err) {
    console.error('contact:', err.message);
    return json({ ok: false, error: '送出失敗，請稍後再試' }, 502);
  }
}

// ════════════════════════════════════════════════════════════
// 頁面輸出
// ════════════════════════════════════════════════════════════

// 讀模板。Pages 可能把 /x.html 轉址成 /x，跟著轉址走最多兩次。
async function asset(request, env, path) {
  let res = await env.ASSETS.fetch(new URL(path, request.url));
  for (let i = 0; i < 2 && res.status >= 300 && res.status < 400 && res.headers.get('location'); i++) {
    res = await env.ASSETS.fetch(new URL(res.headers.get('location'), request.url));
  }
  return res;
}

// <head> 裡的 title、description、canonical、Open Graph、Twitter、JSON-LD
function seoHead({ path, title, desc, image, noindex, type = 'website', ld = [] }) {
  const url = SITE + path;
  const full = `${title}｜${BRAND}`;
  const img = abs(image || OG_DEFAULT);
  return [
    `<title>${esc(full)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    noindex ? '<meta name="robots" content="noindex, follow" />' : `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${esc(full)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:image" content="${esc(img)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:locale" content="zh_TW" />`,
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(full)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="twitter:image" content="${esc(img)}" />`,
    ...ld.map(ldJson),
  ].join('\n  ');
}

// items: [[名稱, 路徑], ...]，首頁自動加在最前面
const breadcrumb = (items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [['首頁', '/'], ...items].map(([name, path], i) => ({
    '@type': 'ListItem', position: i + 1, name, item: SITE + path,
  })),
});

const ORG = {
  '@type': 'Organization',
  '@id': SITE + '/#organization',
  name: BRAND,
  url: SITE + '/',
  logo: SITE + '/favicon-512.png',
  description: '台灣手工果醬品牌，以當季在地水果小批次製作，果肉含量 80%，不添加防腐劑、人工色素與香料。',
  sameAs: ['https://www.instagram.com/seasonflavor_/'],
};

// 讀模板、換 SEO 區塊與內文標記
async function render(request, env, tpl, head, parts = {}, status = 200) {
  const res = await asset(request, env, tpl);
  if (!res.ok) return res;
  let out = (await res.text()).replace(/<!--SEO-->[\s\S]*?<!--\/SEO-->/, () => head);
  for (const [k, v] of Object.entries(parts)) {
    out = out.replace(new RegExp(`<!--${k}-->[\\s\\S]*?<!--\\/${k}-->`), () => v);
  }
  return html(out, status);
}

// 404 頁：模板 404.html，回 HTTP 404
function notFound(request, env) {
  const url = new URL(request.url);
  return render(request, env, '/404', seoHead({ path: url.pathname, ...NOT_FOUND }), {}, 404);
}

// 一般頁面：SEO 設定 + 麵包屑
function pageHead(path, extraLd = []) {
  const pg = PAGES[path];
  const ld = [...extraLd];
  if (path !== '/' && !pg.noindex) ld.push(breadcrumb([[pg.crumb, path]]));
  return seoHead({ path, ...pg, ld });
}

// ── 常見問題 ──
function faqItems(products) {
  const sell = products.filter((p) => stateOf(p) === 'instock').map((p) => p.name);
  const soon = products.filter((p) => stateOf(p) !== 'instock').map((p) => p.name);
  const flavors = ['肆菓目前有哪些口味？',
    `肆菓共有${products.map((p) => p.name).join('、')}等 ${products.length} 款口味，都以台灣當季水果手工熬製，果肉含量 80%，吃得到果粒。` +
    (sell.length ? `目前現貨供應${sell.join('、')}。` : '目前暫無現貨。') +
    (soon.length ? `${soon.join('、')}為季節限定，補貨與上市消息會在 Instagram 公告。` : '')];
  return FAQ.map((q) => q || flavors);
}
const faqHtml = (items) => items.map(([q, a], i) => `
        <details class="faq-item reveal${i % 4 ? ' reveal-delay-' + (i % 4) : ''}">
          <summary class="faq-question">${esc(q)}</summary>
          <div class="faq-answer">
            <p>${esc(a)}</p>
          </div>
        </details>`).join('\n');
const faqLd = (items) => ({
  '@type': 'FAQPage',
  mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

// ── 果醬系列卡片（/products/ 與商品頁的「其他口味」）──
function flavorCards(products) {
  const label = { instock: ['available', '現貨'], soldout: ['coming', '補貨中'], upcoming: ['coming', '即將推出'] };
  return products.map((p) => {
    const st = stateOf(p);
    return `
        <a class="pf-card${st === 'instock' ? '' : ' upcoming'}" href="/products/${p.id}">
          <div class="pf-img ${p.bg}-bg">
            <img src="${esc(p.image)}"${srcset(p, CARD_SIZES)} alt="${esc(p.alt)}" loading="lazy" decoding="async" width="${p.w}" height="${p.h}" />
          </div>
          <div class="pf-info">
            <span class="pf-badge ${label[st][0]}">${label[st][1]}</span>
            <h3>${esc(p.name)}</h3>
            <p>${esc(p.card)}</p>
          </div>
        </a>`;
  }).join('');
}

// ── 線上訂購卡片（/shop）──
// 伺服器端先輸出，shop.js 載入後用 /api/products 重繪並接手數量與購物車互動
function specHtml(p) {
  const row = (k, v) => (v ? `<div class="spec-row"><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
  return `<dl class="spec-list">
          ${row('淨重', p.net_weight)}
          <div class="spec-row"><dt>果肉含量</dt><dd>80%</dd></div>
          ${row('成分', p.ingredients)}
          ${row('保存期限', p.shelf_life)}
          ${row('保存方式', p.storage)}
        </dl>`;
}

function shopCards(products) {
  const sellable = products.filter((p) => stateOf(p) === 'instock');
  const others   = products.filter((p) => stateOf(p) !== 'instock');
  const grid = sellable.map((p) => `
      <div class="shop-card reveal visible" data-id="${p.id}">
        <div class="shop-card-img ${p.bg}-bg">
          <img src="${esc(p.image)}"${srcset(p, CARD_SIZES)} alt="${esc(p.alt)}" width="${p.w}" height="${p.h}" />
        </div>
        <div class="shop-card-body">
          <span class="pf-badge available">現貨</span>
          <h3 class="shop-card-name"><a href="/products/${p.id}">${esc(p.name)}</a></h3>
          <p class="shop-card-desc">${esc(p.card)}</p>
          ${specHtml(p)}
          <div class="shop-price-row">
            <span class="shop-price">NT$ ${p.price}</span>
            <span class="shop-stock-tag${p.stock <= 5 ? ' low' : ''}">庫存 ${p.stock} 瓶</span>
          </div>
        </div>
      </div>`).join('');

  const coming = others.length ? `
      <div class="shop-coming-row">
        <span class="shop-coming-label">其他品項</span>
        <div class="shop-coming-cards">
          ${others.map((p) => `
            <a class="shop-coming-card" href="/products/${p.id}">
              <div class="shop-coming-img ${p.bg}-bg">
                <img src="${esc(p.image)}"${srcset(p, CARD_SIZES)} alt="${esc(p.alt)}" loading="lazy" decoding="async" width="${p.w}" height="${p.h}" />
                <div class="shop-coming-overlay">
                  <span class="pf-badge coming">${stateOf(p) === 'soldout' ? '補貨中' : '即將推出'}</span>
                </div>
              </div>
              <p class="shop-coming-name">${esc(p.name)}</p>
            </a>`).join('')}
        </div>
      </div>` : '';

  return `<div class="shop-grid" id="shopGrid">${grid}</div>
      <div id="shopComingSoon">${coming}</div>`;
}

// ── 商品頁 /products/<id> ──
// 沒有 D1 資料的欄位顯示「資料整理中」，並留 TODO 註解方便搜尋
function productBody(p, products, posts) {
  const st = stateOf(p);
  const row = (k, v) => `<tr><td>${k}</td><td>${v
    ? esc(v) : `資料整理中<!-- TODO: 到後台「商品與庫存 → 編輯」補上${k} -->`}</td></tr>`;
  const n = p.nutrition || {};
  const grams = parseFloat(p.net_weight);
  const nutrition = NUTRITION.some(([k]) => n[k]) ? `
            <p class="nutri-serv">每一份量 100 公克${grams ? `，本包裝含 ${Math.round(grams / 10) / 10} 份（淨重 ${esc(p.net_weight)}）` : ''}</p>
            <table class="nutri">
              <tr><th></th><th>每份</th><th>每 100 公克</th></tr>
              ${NUTRITION.map(([k, label]) => `<tr><td>${label}</td><td>${esc(n[k] || '—')}</td><td>${esc(n[k] || '—')}</td></tr>`).join('')}
            </table>` : `
            <p class="nutri-serv">營養標示整理中<!-- TODO: 到後台「商品與庫存 → 編輯」填營養標示 --></p>`;

  const buy = st === 'instock' ? `
          <p class="pd-price">NT$ ${p.price}</p>
          <div class="shop-actions">
            <div class="qty-selector">
              <button class="qty-btn" data-act="qty" data-id="${esc(p.id)}" data-d="-1" aria-label="減少">−</button>
              <span class="qty-num" id="qty-${p.id}">1</span>
              <button class="qty-btn" data-act="qty" data-id="${esc(p.id)}" data-d="1" aria-label="增加">+</button>
            </div>
            <button class="btn add-cart-btn" data-id="${p.id}" data-act="add" data-id="${esc(p.id)}">加入購物車</button>
          </div>
          <p class="pd-note">庫存 ${p.stock} 瓶，限量手工製作，售完即止</p>` : `
          ${p.price != null ? `<p class="pd-price">NT$ ${p.price}</p>` : ''}
          <button class="btn pd-wait" disabled>預購／補貨中</button>
          <p class="pd-note">補貨與上市消息會在 <a href="https://www.instagram.com/seasonflavor_/" target="_blank" rel="noopener">Instagram @seasonflavor_</a> 第一時間公告</p>`;

  // 相關文章：標題或內文提到這款水果的優先，不夠三篇用最新的補
  const hit = posts.filter((a) => `${a.title}${a.excerpt}${a.body}`.includes(p.kw));
  const related = [...hit, ...posts.filter((a) => !hit.includes(a))].slice(0, 3);
  const others = products.filter((o) => o.id !== p.id);

  return `
  <section class="section page-section pd">
    <div class="container">
      <nav class="pd-crumbs" aria-label="麵包屑">
        <a href="/">首頁</a><span aria-hidden="true">/</span><a href="/products/">果醬系列</a><span aria-hidden="true">/</span><span aria-current="page">${esc(p.name)}</span>
      </nav>
      <div class="pd-grid">
        <div class="pd-img ${p.bg}-bg">
          <img src="${esc(p.image)}"${srcset(p, '(max-width: 768px) 100vw, 50vw')} alt="${esc(p.alt)}" width="${p.w}" height="${p.h}" fetchpriority="high" />
        </div>
        <div class="pd-info">
          <span class="pf-badge ${st === 'instock' ? 'available' : 'coming'}">${st === 'instock' ? '現貨' : '預購／補貨中'}</span>
          <h1 class="pd-title">${esc(p.name)}</h1>
          <p class="pd-en">${esc(p.en)}</p>
          <p class="body-text pd-desc">${esc(p.description || p.card)}</p>
          ${buy}
          <div class="pm2 pd-feats">
            <div class="feats">
              <div><div class="ic">${ICON.natural}</div><div class="t">100% 天然食材</div><div class="s">無人工添加</div></div>
              <div><div class="ic">${ICON.hand}</div><div class="t">手工製作</div><div class="s">用心熬煮</div></div>
              <div><div class="ic">${ICON.vegan}</div><div class="t">全素可食</div><div class="s">純粹美味</div></div>
            </div>
          </div>
        </div>
      </div>

      <div class="pm2 pd-pm2">
        <div class="cols">
          <section class="sec">
            <div class="sh"><span class="ic o">${ICON.food}</span><div><h2 class="zh">食品標示</h2><div class="en">FOOD LABELING</div></div></div>
            <table>
              ${row('品名', `肆菓・${p.name}`)}
              ${p.ingredients ? row('成分', p.ingredients) : '<!-- TODO: 成分未填，到後台補上後這列會自動出現 -->'}
              ${row('淨重', p.net_weight)}
              ${row('產品特色', FEATURES)}
              ${row('原產地', ORIGIN)}
              ${row('保存期限', p.shelf_life)}
              ${row('保存方式', p.storage)}
              ${row('過敏原資訊', ALLERGEN)}
              ${row('廠商資訊', MAKER)}
            </table>
          </section>
          <section class="sec">
            <div class="sh"><span class="ic g">${ICON.nut}</span><div><h2 class="zh">營養標示</h2><div class="en">NUTRITION FACTS</div></div></div>
            ${nutrition}
          </section>
        </div>
        <div class="notes">
          <div class="nc warn"><span class="note-ico">${ICON.warn}</span><b>貼心提醒</b>本產品為天然食材製作，顏色與風味可能因季節略有不同，屬正常現象，請安心食用。</div>
          <div class="nc food"><span class="note-ico">${ICON.leaf}</span><b>本產品為食品</b>依《通訊交易解除權合理例外情事適用準則》屬易腐敗、保存期限較短之商品，恕不適用七日猶豫期（鑑賞期）。</div>
        </div>
        <section class="sec pd-buyinfo">
          <div class="sh"><span class="ic o">${ICON.truck}</span><div><h2 class="zh">付款與配送</h2><div class="en">PAYMENT &amp; DELIVERY</div></div></div>
          <table>
            ${row('付款方式', PAYMENT)}
            ${row('配送方式', DELIVERY)}
          </table>
        </section>
      </div>

      <div class="pd-section">
        <h2 class="pd-h2">相關文章</h2>
        ${related.length ? `<ul class="pd-links">${related.map((a) =>
          `<li><a href="${postPath(a)}">${esc(a.title)}</a>${a.excerpt ? `<span>${esc(a.excerpt)}</span>` : ''}</li>`).join('')}</ul>`
          : '<p class="body-text">文章整理中，先到 <a href="/stories/">肆菓筆記</a> 看看。</p>'}
      </div>

      <div class="pd-section">
        <h2 class="pd-h2">其他口味</h2>
        <div class="products-flavors pd-others">${flavorCards(others)}</div>
      </div>
    </div>
  </section>`;
}

function productLd(p) {
  const url = `${SITE}/products/${p.id}`;
  // Google 規定 Product 要有 offers（且 offers 要有 price）／review／aggregateRating 其一；
  // 後台沒填價格的口味就不輸出 Product，避免結構化資料報錯。缺貨或即將推出只要有價格就會輸出。
  // 沒有評價資料，不放 rating。
  if (p.price == null) return [];
  return [{
    '@type': 'Product',
    '@id': url + '#product',
    name: p.name,
    image: [abs(p.image)],
    description: p.description || p.card,
    ...(p.sku ? { sku: p.sku } : {}),
    brand: { '@type': 'Brand', name: BRAND },
    offers: {
      '@type': 'Offer',
      url,
      price: String(p.price),
      priceCurrency: 'TWD',
      availability: 'https://schema.org/' + { instock: 'InStock', soldout: 'OutOfStock', upcoming: 'PreOrder' }[stateOf(p)],
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: BRAND },
      shippingDetails: Object.entries(SHIPPING_FEE).map(([, fee]) => ({
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: String(fee), currency: 'TWD' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'TW' },
      })),
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'TW',
        returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
        merchantReturnLink: SITE + '/terms',
      },
    },
  }];
}

async function productPage(request, env, id) {
  const [products, posts] = await Promise.all([loadProducts(env), loadPosts(env)]);
  const p = products.find((x) => x.id === id);
  if (!p) return notFound(request, env);
  const path = `/products/${p.id}`;
  const head = seoHead({
    path, title: p.name, type: 'product', image: p.image,
    desc: p.description || `${p.name}，${p.card}。${FEATURES}。`,
    ld: [...productLd(p), breadcrumb([['果醬系列', '/products/'], [p.name, path]])],
  });
  return render(request, env, '/product', head, { PRODUCT: productBody(p, products, posts) });
}

// ── 肆菓筆記 ──
// 有網址名稱就用 /stories/<slug>，沒有就用編號
const postPath = (p) => `/stories/${p.slug || p.id}`;
const postDate = (d) => (d ? `<time datetime="${esc(d)}">${esc(d).replace(/-/g, '.')}</time>` : '');

function storyList(posts) {
  return `<div class="journal-list" id="journalList">${posts.map((p, i) => `
        <a class="journal-item reveal${i % 3 ? ' reveal-delay-' + (i % 3) : ''}" href="${postPath(p)}">
          <div class="journal-thumb">
            ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" width="600" height="600"${i < 3 ? '' : ' loading="lazy"'} />` : ''}
          </div>
          <div class="journal-meta">
            <h3>${esc(p.title)}</h3>
            <p>${esc(p.excerpt || '')}</p>
            ${postDate(p.date)}
          </div>
        </a>`).join('')}
      </div>`;
}

async function storiesPage(request, env) {
  const [posts, settings] = await Promise.all([loadPosts(env), loadSettings(env)]);
  const parts = {};
  // 後台沒有文章時保留模板裡的預設內容
  if (posts.length) parts.JOURNAL = storyList(posts);
  if (settings.journal_hero) {
    parts.HERO = `<figure class="journal-hero" id="journalHero">
        <img id="journalHeroImg" src="${esc(settings.journal_hero)}" alt="肆菓筆記主視覺：台灣當季水果與手工果醬" width="2100" height="900" fetchpriority="high" />
      </figure>`;
  }
  return render(request, env, '/journal', pageHead('/stories/'), parts);
}

async function storyPage(request, env, key) {
  let post = null;
  if (env.DB) {
    try {
      post = await env.DB
        .prepare(`SELECT ${JOURNAL_COLS} FROM journal WHERE ${/^\d+$/.test(key) ? 'id' : 'slug'} = ? AND published = 1`).bind(key).first();
    } catch { /* D1 掛掉時照 404 處理 */ }
  }
  if (!post) return notFound(request, env);

  const path = postPath(post);
  // 舊的數字網址 301 到網址名稱
  if (path !== `/stories/${key}`) return redirect(path + new URL(request.url).search);
  const desc = post.excerpt || String(post.body || '').replace(/\s+/g, ' ').slice(0, 110) || post.title;
  const img = post.image ? abs(post.image) : '';
  // 內文還沒寫的文章先不給收錄（空頁會被當成低品質內容），補上內文後自動解除
  const empty = !String(post.body || '').trim();
  const head = seoHead({
    path, title: post.title, desc, type: 'article', image: post.image || undefined, noindex: empty,
    ld: [
      {
        '@type': 'Article',
        headline: post.title,
        description: desc,
        image: [img || abs(OG_DEFAULT)],
        ...(post.date ? { datePublished: post.date } : {}),
        // 修改日：後台最後儲存時間（UTC），沒有就用發佈日
        ...(post.updated_at || post.date ? { dateModified: post.updated_at ? post.updated_at.replace(' ', 'T') + 'Z' : post.date } : {}),
        inLanguage: 'zh-Hant-TW',
        // TODO: 創辦人頁（/about/founder）做好後改成 Person，url 指到那頁
        author: { '@type': 'Organization', name: BRAND, url: SITE + '/about' },
        publisher: { '@type': 'Organization', name: BRAND, logo: { '@type': 'ImageObject', url: SITE + '/favicon-512.png' } },
        mainEntityOfPage: { '@type': 'WebPage', '@id': SITE + path },
      },
      breadcrumb([['肆菓筆記', '/stories/'], [post.title, path]]),
    ],
  });

  // 內文存純文字，空行分段
  const body = String(post.body || '').split(/\n{2,}/).filter((s) => s.trim())
    .map((t) => `<p>${esc(t.trim())}</p>`).join('\n        ');
  const content = `<h1 class="post-title">${esc(post.title)}</h1>
      ${post.excerpt ? `<p class="post-sub">${esc(post.excerpt)}</p>` : ''}
      ${post.date ? `<time class="post-date" datetime="${esc(post.date)}">${esc(post.date).replace(/-/g, '.')}</time>` : ''}
      ${post.image ? `<figure class="post-hero"><img src="${esc(post.image)}" alt="${esc(post.title)}" width="1600" height="1000" fetchpriority="high" /></figure>` : ''}
      <div class="post-body">
        ${body}
      </div>`;
  return render(request, env, '/journal-post', head, { POST: content });
}

// ── 首頁、線上訂購、常見問題、聯絡 ──
async function homePage(request, env) {
  const ld = [
    { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: BRAND, inLanguage: 'zh-Hant-TW', publisher: { '@id': SITE + '/#organization' } },
    ORG,
  ];
  return render(request, env, '/', pageHead('/', ld));
}

async function shopPage(request, env) {
  const products = await loadProducts(env);
  // 沒綁 D1 就不預先輸出卡片，交給 shop.js 用內建預設值渲染
  const parts = env.DB ? { SHOP: shopCards(products) } : {};
  return render(request, env, '/shop', pageHead('/shop'), parts);
}

async function faqPage(request, env, path) {
  const items = faqItems(await loadProducts(env));
  const ld = path === '/faq' ? [faqLd(items)] : [];
  return render(request, env, PAGES[path].tpl, pageHead(path, ld), { FAQLIST: faqHtml(items) });
}

// ── GET /sitemap.xml ────────────────────────────────────────
// 頁面、商品、文章全部在這裡產生；新增商品或文章不用手動更新
async function sitemap(env) {
  const [products, posts] = await Promise.all([loadProducts(env), loadPosts(env)]);
  const url = (path, lastmod, priority) => `  <url>
    <loc>${SITE}${path}</loc>${lastmod ? `
    <lastmod>${esc(lastmod)}</lastmod>` : ''}
    <priority>${priority}</priority>
  </url>`;
  const newest = (a, b) => (a > b ? a : b);
  const prodMod = products.reduce((m, p) => newest(m, p.updated), PAGES_UPDATED);
  const postMod = posts.reduce((m, p) => newest(m, p.date || ''), PAGES_UPDATED);
  const rows = [
    ...Object.entries(PAGES).filter(([, pg]) => !pg.noindex).map(([path]) => url(path,
      path === '/products/' || path === '/shop' ? prodMod : path === '/stories/' ? postMod : PAGES_UPDATED,
      path === '/' ? '1.0' : ['/terms', '/privacy'].includes(path) ? '0.3' : '0.7')),
    ...products.map((p) => url(`/products/${p.id}`, newest(p.updated, PAGES_UPDATED), '0.9')),
    ...posts.filter((p) => String(p.body || '').trim()).map((p) => url(postPath(p), p.date, '0.6')),
  ];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.join('\n')}
</urlset>
`, { headers: { 'Content-Type': 'application/xml; charset=utf-8', ...SECURITY_HEADERS } });
}

// ── GET /llms.txt ───────────────────────────────────────────
// 靜態 llms.txt 為底，價格段與 FAQ 換成 D1 現值，末尾補上文章清單給 AI 檢索
async function llmsTxt(request, env) {
  const res = await asset(request, env, '/llms.txt');
  let text = await res.text();
  const headers = { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS };
  const stateTxt = { instock: '現貨供應中', soldout: '補貨中', upcoming: '即將推出' };

  if (env.DB) {
    const products = await loadProducts(env);
    const section = ['## 現有產品與價格', ''].concat(products.map((p) => [
      `### ${p.name}（${p.en}）`,
      `- 商品頁：${SITE}/products/${p.id}`,
      `- 價格：${p.price != null ? `NT$${p.price}` : '尚未公布'}`,
      `- 狀態：${stateTxt[stateOf(p)]}`,
      p.net_weight ? `- 淨重：${p.net_weight}` : '',
      p.ingredients ? `- 成分：${p.ingredients}` : '',
      `- 風味描述：${p.card}`,
      `- 果肉含量：80%，吃得到果粒`,
      `- 不含：防腐劑、人工色素、人工香料`,
    ].filter(Boolean).join('\n') + '\n')).join('\n');
    text = text.replace(/## 現有產品與價格[\s\S]*?(?=\n## )/, () => section);

    // 常見問題裡也寫了價格，一併換掉，否則同一份檔案會自相矛盾
    const onSale = products.filter((p) => stateOf(p) === 'instock' && p.price != null);
    const soon   = products.filter((p) => stateOf(p) !== 'instock');
    text = text
      .replace(/(\*\*肆菓果醬多少錢？\*\*\n).*/, () =>
        `**肆菓果醬多少錢？**\n${onSale.length ? `${onSale.map((p) => `${p.name} NT$${p.price}`).join('、')}。每款均為限量手工製作。` : '目前無現貨供應，新品上架請見官網果醬系列頁。'}`)
      .replace(/(\*\*肆菓目前有哪些口味？\*\*\n).*/, () =>
        `**肆菓目前有哪些口味？**\n${onSale.length ? `目前現貨供應${onSale.map((p) => `${p.name}（NT$${p.price}）`).join('、')}。` : '目前無現貨供應。'}${soon.length ? `${soon.map((p) => p.name).join('、')}為季節限定口味，補貨中或即將推出。` : ''}`);
  }

  const posts = await loadPosts(env);
  if (!posts.length) return new Response(text, { headers });
  const list = posts.map((p) =>
    `- [${p.title}](${SITE}${postPath(p)})${p.date ? `（${p.date}）` : ''}${p.excerpt ? '：' + p.excerpt : ''}`
  ).join('\n');
  return new Response(`${text.trimEnd()}\n\n## 肆菓筆記文章\n\n${list}\n`, { headers });
}

// ── GET /pricing.md ─────────────────────────────────────────
// 給 AI 代理讀的價格檔。有 D1 就整份重生，沒有就送檔案裡的靜態版本。
async function pricingMd(request, env) {
  const headers = { 'Content-Type': 'text/markdown; charset=utf-8', ...SECURITY_HEADERS };
  if (!env.DB) {
    const res = await asset(request, env, '/pricing.md');
    return new Response(res.body, { headers });
  }
  const products = await loadProducts(env);
  const stateTxt = { instock: '現貨供應中', soldout: '補貨中', upcoming: '即將推出' };
  const body = products.map((p) => [
    `## ${p.name}（${p.en}）`,
    '',
    `- 商品頁：${SITE}/products/${p.id}`,
    `- 價格：${p.price != null ? 'NT$' + p.price : '尚未公布'}`,
    `- 供應狀態：${stateTxt[stateOf(p)]}`,
    ...(p.net_weight ? [`- 淨重：${p.net_weight}`] : []),
    ...(p.ingredients ? [`- 成分：${p.ingredients}`] : []),
    `- 風味：${p.card}`,
    `- 不含：防腐劑、人工色素、人工香料`,
    '',
  ].join('\n')).join('\n');

  return new Response(`# 價格 — ${BRAND}

台灣手工果醬品牌。以當季在地水果小批次手工熬製，果肉含量 80%，不添加防腐劑、人工色素與人工香料。

- 官方網站：${SITE}/
- 線上訂購：${SITE}/shop
- 幣別：新台幣（TWD）
- 價格單位：每罐
- 資料來源：後台庫存系統即時產生

${body}
## 訂購與運費

- 訂購方式：官網線上訂購（${SITE}/shop）
- 付款方式：${PAYMENT}
- 配送方式：${DELIVERY}
- 退換貨：食品類商品不適用七日鑑賞期，詳見 ${SITE}/terms

## 注意事項

- 每款果醬為小批次手工製作，售完即止，不大量囤貨生產。
- 價格與供應狀態以官網商品頁為準。
`, { headers });
}

// ════════════════════════════════════════════════════════════
// SCHEMA — D1 資料表第一次用到時自動建立，不必手動跑 SQL
// D1 是訂單、付款、庫存的唯一依據；Airtable 只是營運與寄信用的副本
// ════════════════════════════════════════════════════════════
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, excerpt TEXT, body TEXT, image TEXT, date TEXT,
    published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    merchant_trade_no TEXT UNIQUE,
    name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT,
    shipping_method TEXT NOT NULL, store_brand TEXT, store_name TEXT, address TEXT,
    subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, shipping INTEGER NOT NULL, total INTEGER NOT NULL,
    coupon_code TEXT, payment_method TEXT NOT NULL, payment_provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_payment',
    inventory_status TEXT NOT NULL DEFAULT 'not_deducted',
    payment_info TEXT, note TEXT,
    airtable_id TEXT, airtable_status TEXT NOT NULL DEFAULT 'sync_pending', airtable_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS orders_sync ON orders(airtable_status)`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL,
    product_id TEXT NOT NULL, product_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL, qty INTEGER NOT NULL, line_total INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id)`,
  `CREATE TABLE IF NOT EXISTS payment_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, provider TEXT NOT NULL,
    trade_no TEXT, merchant_trade_no TEXT, rtn_code TEXT, amount INTEGER, raw_payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (provider, merchant_trade_no, rtn_code))`,
  `CREATE TABLE IF NOT EXISTS discount_codes (
    code TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
    value INTEGER NOT NULL, min_order INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
    influencer TEXT, starts_at TEXT, ends_at TEXT,
    usage_limit INTEGER, usage_count INTEGER NOT NULL DEFAULT 0, per_customer_limit INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  // 預設折扣碼只在表是空的時候放進去，後台停用或修改後不會被蓋回來
  `INSERT INTO discount_codes (code, type, value, min_order, influencer)
    SELECT 'WELCOME10', 'percentage', 10, 0, NULL WHERE NOT EXISTS (SELECT 1 FROM discount_codes)
    UNION ALL SELECT 'SEASON50', 'fixed', 50, 500, NULL WHERE NOT EXISTS (SELECT 1 FROM discount_codes)
    UNION ALL SELECT 'AMANDA', 'percentage', 15, 0, 'Amanda' WHERE NOT EXISTS (SELECT 1 FROM discount_codes)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
];

let schemaReady = null;
function ensureSchema(env) {
  if (!env.DB) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
      // 舊表補欄位：已經有了會報錯，忽略即可
      for (const q of ['ALTER TABLE journal ADD COLUMN slug TEXT', 'ALTER TABLE journal ADD COLUMN updated_at TEXT',
        'CREATE UNIQUE INDEX IF NOT EXISTS journal_slug ON journal(slug)']) {
        try { await env.DB.prepare(q).run(); } catch { /* 已存在，或 journal 表還沒建立 */ }
      }
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// 次數限制：bucket 在 sec 秒內超過 limit 次就回 true
async function limited(env, bucket, limit, sec, peek = false) {
  if (!env.DB) return false;
  const now = Math.floor(Date.now() / 1000);
  if (peek) {
    const r = await env.DB.prepare('SELECT count FROM rate_limits WHERE bucket = ? AND reset_at >= ?').bind(bucket, now).first();
    return !!r && r.count >= limit;
  }
  const row = await env.DB.prepare(`INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET
      count = CASE WHEN reset_at < ? THEN 1 ELSE count + 1 END,
      reset_at = CASE WHEN reset_at < ? THEN excluded.reset_at ELSE reset_at END
    RETURNING count`).bind(bucket, now + sec, now, now).first();
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(now).run();
  return row.count > limit;
}

// ════════════════════════════════════════════════════════════
// ADMIN AUTH — 密碼只在登入時送一次，之後用 HttpOnly cookie session（8 小時）
// 會改資料的請求另外要帶 x-csrf 標頭
// ════════════════════════════════════════════════════════════
const SESSION_COOKIE = 'sf_admin';
const SESSION_SEC = 8 * 3600;
const sessionToken = (request) => ((request.headers.get('cookie') || '').match(/(?:^|;\s*)sf_admin=([A-Za-z0-9]{20,})/) || [])[1];

async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256hex(String(a)), sha256hex(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function adminSession(request, env) {
  const token = sessionToken(request);
  if (!token || !env.DB) return null;
  await ensureSchema(env);
  return env.DB.prepare('SELECT csrf FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256hex(token), Math.floor(Date.now() / 1000)).first();
}

async function adminAuth(request, env) {
  if (!(env.ADMIN_KEY || '').trim()) return json({ error: '伺服器未設定 ADMIN_KEY' }, 500);
  const s = await adminSession(request, env);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!['GET', 'HEAD'].includes(request.method) && !(await sameSecret(request.headers.get('x-csrf') || '', s.csrf))) {
    return json({ error: '請重新整理頁面後再試' }, 403);
  }
  return null;
}

async function adminLogin(request, env) {
  const stored = (env.ADMIN_KEY || '').trim();
  if (!stored || !env.DB) return json({ ok: false, error: '伺服器未設定 ADMIN_KEY 或 D1' }, 500);
  await ensureSchema(env);
  if (await limited(env, 'login:' + clientIp(request), 10, 900)) {
    return json({ ok: false, error: '嘗試太多次，請 15 分鐘後再試' }, 429);
  }
  const d = await readJson(request, 2048);
  if (!(await sameSecret(String(d.key || '').trim(), stored))) return json({ ok: false, error: '密碼錯誤，請再試一次' }, 401);
  const token = randomId(40, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
  const csrf = randomId(32);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO admin_sessions (token_hash, csrf, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256hex(token), csrf, now + SESSION_SEC),
  ]);
  const res = json({ ok: true, csrf });
  res.headers.append('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SEC}`);
  return res;
}

async function adminLogout(request, env) {
  if (sessionToken(request)) { const denied = await adminAuth(request, env); if (denied && denied.status === 403) return denied; }
  const token = sessionToken(request);
  if (token && env.DB) await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256hex(token)).run();
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return res;
}

// POST /api/admin/logout-all — 登出所有裝置（電腦、收銀 POS 全部要重新登入）。懷疑密碼或裝置外流時用
async function adminLogoutAll(request, env) {
  const denied = await adminAuth(request, env); if (denied) return denied;
  await env.DB.prepare('DELETE FROM admin_sessions').run();
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return res;
}

// ════════════════════════════════════════════════════════════
// CART / QUOTE / COUPONS — 金額一律由伺服器依 D1 算，前端只負責顯示
// ════════════════════════════════════════════════════════════
const SHIPPING_FEE = { home: 120, cvs: 60 };
const CVS_BRANDS = { '711': '7-ELEVEN', fm: '全家 FamilyMart' };

const couponLabel = (dc) => (dc.type === 'percentage' ? `${dc.value}% OFF` : `折 NT$${dc.value}`);

async function findCoupon(env, raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return null;
  const bad = { error: '折扣碼無效或已過期' };
  if (!/^[A-Z0-9_-]{2,30}$/.test(code)) return bad;
  const dc = await env.DB.prepare('SELECT * FROM discount_codes WHERE code = ?').bind(code).first();
  const today = taipeiDate();
  if (!dc || !dc.enabled || (dc.starts_at && today < dc.starts_at) || (dc.ends_at && today > dc.ends_at) ||
      (dc.usage_limit && dc.usage_count >= dc.usage_limit)) return bad;
  return dc;
}

// d: { items: [{ product_id, qty }], shipping_method, coupon }
async function quote(env, d) {
  const products = await loadProducts(env);
  const items = Array.isArray(d.items) ? d.items : [];
  if (!items.length) throw new UserError('購物車是空的');
  if (items.length > 20) throw new UserError('品項太多');
  // 同一個商品分成好幾列送來時先合併，庫存與數量上限才不會被繞過
  const merged = new Map();
  for (const c of items) {
    const id = String(c?.product_id ?? c?.id ?? ''), qty = Math.floor(Number(c?.qty));
    merged.set(id, (merged.get(id) || 0) + (qty > 0 ? qty : NaN));
  }
  const lines = [];
  let subtotal = 0;
  for (const [id, qty] of merged) {
    const p = products.find((x) => x.id === id);
    if (!p || stateOf(p) !== 'instock' || p.price == null || !(qty > 0) || qty > 99) {
      throw new UserError('商品資料有誤，請重新整理後再試');
    }
    if (p.stock < qty) throw new UserError(`${p.name} 庫存不足（剩 ${p.stock} 瓶）`);
    lines.push({ p, qty });
    subtotal += p.price * qty;
  }
  const ship = d.shipping_method === 'cvs' ? 'cvs' : 'home';
  let discount = 0, coupon = null, couponError = '';
  if (d.coupon) {
    if (d.ip && await limited(env, 'coupon-fail:' + d.ip, 10, 3600, true)) throw new UserError('折扣碼嘗試次數太多，請稍後再試');
    const dc = await findCoupon(env, d.coupon);
    if (dc?.error) { couponError = dc.error; if (d.ip) await limited(env, 'coupon-fail:' + d.ip, 10, 3600); }
    else if (dc && subtotal < dc.min_order) couponError = `此折扣碼需滿 NT$${dc.min_order}`;
    else if (dc) {
      coupon = dc;
      discount = dc.type === 'percentage' ? Math.round(subtotal * dc.value / 100) : Math.min(dc.value, subtotal);
    }
  }
  const shipping = SHIPPING_FEE[ship];
  return { lines, subtotal, discount, shipping, total: subtotal - discount + shipping, ship, coupon, couponError };
}

// POST /api/cart/quote
async function cartQuote(request, env) {
  if (await limited(env, 'quote:' + clientIp(request), 60, 600)) return json({ ok: false, error: '操作太頻繁，請稍後再試' }, 429);
  const q = await quote(env, { ...(await readJson(request)), ip: clientIp(request) });
  return json({
    ok: true, subtotal: q.subtotal, discount: q.discount, shipping: q.shipping, total: q.total,
    coupon: q.coupon ? { code: q.coupon.code, label: couponLabel(q.coupon), influencer: q.coupon.influencer || '' } : null,
    coupon_error: q.couponError,
  });
}

// /admin-discounts：GET 列表、POST 新增或修改
async function adminDiscounts(request, env) {
  const denied = await adminAuth(request, env); if (denied) return denied;
  if (request.method === 'GET') {
    return json((await env.DB.prepare('SELECT * FROM discount_codes ORDER BY created_at').all()).results || []);
  }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const d = await readJson(request);
  const code = String(d.code || '').trim().toUpperCase();
  const type = d.type === 'fixed' ? 'fixed' : 'percentage';
  const value = Math.floor(Number(d.value));
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const intOrNull = (v) => (v === '' || v == null ? null : Math.max(0, Math.floor(Number(v)) || 0));
  if (!/^[A-Z0-9_-]{2,30}$/.test(code)) throw new UserError('折扣碼只能用英文、數字、底線、連字號（2–30 字）');
  if (!(value > 0) || (type === 'percentage' && value > 90)) throw new UserError('折扣數值不正確（百分比 1–90，固定金額需大於 0）');
  await env.DB.prepare(`INSERT INTO discount_codes (code, type, value, min_order, enabled, influencer, starts_at, ends_at, usage_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET type = excluded.type, value = excluded.value, min_order = excluded.min_order,
        enabled = excluded.enabled, influencer = excluded.influencer, starts_at = excluded.starts_at,
        ends_at = excluded.ends_at, usage_limit = excluded.usage_limit, updated_at = datetime('now')`)
    .bind(code, type, value, intOrNull(d.min_order) || 0, d.enabled === false ? 0 : 1,
      String(d.influencer || '').trim().slice(0, 40) || null, date(d.starts_at), date(d.ends_at), intOrNull(d.usage_limit))
    .run();
  return json({ ok: true, code });
}

// ════════════════════════════════════════════════════════════
// ORDERS — 狀態機、建立訂單、扣庫存
// ════════════════════════════════════════════════════════════
// payment_method：credit_card / line_pay / ecpay_atm / ecpay_cvs / bank_transfer
// apple_pay 併在「信用卡 / Apple Pay」：綠界 Credit 付款頁同時提供 Apple Pay
const PAY_IDS = ['credit_card', 'line_pay', 'ecpay_atm', 'ecpay_cvs', 'bank_transfer'];
const LINE_PAY_BACKEND = false;   // LINE Pay API 尚未串接；改 true 之前後台也不能開
// 金流控制台：D1 settings 的 pay_<id> = 'off' 就停用，沒設 = 啟用
const payEnabled = (st, id) => (id === 'line_pay' ? LINE_PAY_BACKEND && st.pay_line_pay !== 'off' : PAY_IDS.includes(id) && st['pay_' + id] !== 'off');
const PAY_LABEL = {
  credit_card: '信用卡 / Apple Pay（綠界）', line_pay: 'LINE Pay',
  ecpay_atm: 'ATM 虛擬帳號（綠界）', ecpay_cvs: '超商代碼（綠界）', bank_transfer: '銀行轉帳（一般帳戶）',
};

// 狀態 → Airtable／後台／客人看到的中文
const STATUS_LABEL = {
  pending_payment: '待付款', payment_info_received: '待付款', payment_failed: '付款失敗',
  paid: '已付款', processing: '已付款', paid_stock_conflict: '已付款',
  shipped: '已出貨', completed: '完成', cancelled: '已取消', expired: '已取消', refunded: '已退款',
};
// 後台下拉選單的中文 → 狀態
const LABEL_STATUS = { 待付款: 'pending_payment', 已付款: 'paid', 已出貨: 'shipped', 完成: 'completed', 已取消: 'cancelled', 已退款: 'refunded' };
// 允許的狀態轉換；沒列的一律拒絕（例如「完成」不能退回「待付款」）
const NEXT_STATUS = {
  pending_payment: ['payment_info_received', 'paid', 'payment_failed', 'cancelled', 'expired'],
  payment_info_received: ['paid', 'cancelled', 'expired'],
  payment_failed: ['paid', 'cancelled', 'expired'],
  expired: ['paid', 'cancelled'],
  paid: ['processing', 'shipped', 'cancelled', 'refunded'],
  paid_stock_conflict: ['processing', 'shipped', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['completed', 'refunded'],
  completed: ['refunded'],
};
const PAID_STATES = ['paid', 'processing', 'paid_stock_conflict', 'shipped', 'completed'];

// D1 存 UTC（datetime('now')），顯示用台北時間
const fmtTaipei = (utc) => new Date(String(utc).replace(' ', 'T') + 'Z').toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

const parseInfo = (o) => { try { return JSON.parse(o.payment_info || '{}') || {}; } catch { return {}; } };

function paymentInfoText(o) {
  const i = parseInfo(o);
  return [
    i.type === 'atm' ? `ATM 虛擬帳號: 銀行代碼 ${i.bank_code} 帳號 ${i.account} 期限 ${i.expire}` : '',
    i.type === 'cvs' ? `超商繳費代碼: ${i.payment_no} 期限 ${i.expire}` : '',
    i.trade_no ? `綠界交易編號: ${i.trade_no}` : '',
  ].filter(Boolean).join('\n');
}

const shipLine = (o) => (o.shipping_method === 'cvs'
  ? `配送方式: 超商取貨（${o.store_brand}）門市: ${o.store_name}  運費 NT$${o.shipping}`
  : `配送方式: 宅配到府  運費 NT$${o.shipping}`);

// Airtable 備註欄（給營運看，含 Email 與匯款後五碼）
const orderNote = (o) => [
  o.status === 'paid_stock_conflict' ? '【付款完成但庫存不足，請人工處理】' : '',
  shipLine(o), o.email ? `Email: ${o.email}` : '',
  o.coupon_code ? `折扣碼: ${o.coupon_code} -NT$${o.discount}` : '',
  paymentInfoText(o), o.note || '',
].filter(Boolean).join('\n');

const newOrderId = () => `SF${taipeiDate().slice(2).replace(/-/g, '')}-${randomId(6)}`;

// 檢查客人填的資料
function checkCustomer(d) {
  const t = (v, n) => String(v ?? '').trim().slice(0, n);
  const c = {
    name: t(d.name, 50), phone: String(d.phone ?? '').replace(/[-\s]/g, ''), email: t(d.email, 200),
    ship: d.ship === 'cvs' ? 'cvs' : 'home',
    brand: CVS_BRANDS[d.cvs_brand] ? d.cvs_brand : '', store: t(d.store, 60),
    address: t(d.address, 200), note: t(d.note, 500),
    bank5: String(d.bank5 ?? '').replace(/\D/g, '').slice(0, 5),
  };
  if (!c.name) throw new UserError('請填寫姓名');
  if (!/^09\d{8}$/.test(c.phone)) throw new UserError('手機號碼格式不正確（請填 09 開頭共 10 碼）');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new UserError('Email 格式不正確');
  if (c.ship === 'cvs' && (!c.brand || !c.store)) throw new UserError('請選擇超商並填寫取貨門市');
  if (c.ship === 'home' && c.address.length < 5) throw new UserError('請填寫完整收件地址');
  return c;
}

async function insertOrder(env, c, q, method) {
  const id = newOrderId();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO orders (order_id, merchant_trade_no, name, phone, email, shipping_method, store_brand, store_name,
        address, subtotal, discount, shipping, total, coupon_code, payment_method, payment_provider, note, inventory_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved')`)
      .bind(id, id.replace('-', ''), c.name, c.phone, c.email, c.ship,
        c.ship === 'cvs' ? CVS_BRANDS[c.brand] : null, c.ship === 'cvs' ? c.store : null, c.ship === 'home' ? c.address : null,
        q.subtotal, q.discount, q.shipping, q.total, q.coupon ? q.coupon.code : null,
        method, method === 'bank_transfer' ? 'manual' : 'ecpay',
        [c.bank5 ? `匯款帳號後五碼: ${c.bank5}` : '', c.note].filter(Boolean).join('\n') || null),
    ...q.lines.map(({ p, qty }) => env.DB
      .prepare('INSERT INTO order_items (order_id, product_id, product_name, unit_price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, p.id, p.name, p.price, qty, p.price * qty)),
  ]);
  return id;
}

// ── 庫存預留：下單當下就扣（條件式，不會變負數），取消／逾期補回，付款時不再重扣 ──
// 避免多人同時下單、付款後才發現缺貨（超賣）
const stockStmt = (env, sign, i) => env.DB.prepare(sign < 0
  ? `UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE product_id = ? AND stock >= ?`
  : `UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE product_id = ?`)
  .bind(...(sign < 0 ? [i.qty, i.product_id, i.qty] : [i.qty, i.product_id]));

// 回傳庫存不足的商品名稱；不足時已扣的會補回去
async function reserveStock(env, lines) {
  const items = lines.map(({ p, qty }) => ({ product_id: p.id, qty }));
  const res = await env.DB.batch(items.map((i) => stockStmt(env, -1, i)));
  const bad = res.findIndex((r) => !r.meta.changes);
  if (bad < 0) return '';
  const done = items.filter((_, k) => res[k].meta.changes);
  if (done.length) await env.DB.batch(done.map((i) => stockStmt(env, 1, i)));
  return lines[bad].p.name;
}
const restockLines = (env, lines) => env.DB.batch(lines.map(({ p, qty }) => stockStmt(env, 1, { product_id: p.id, qty })));

// 取消或逾期：預留的庫存補回（只補一次）
async function releaseStock(env, orderId) {
  const upd = await env.DB.prepare(`UPDATE orders SET inventory_status = 'released' WHERE order_id = ? AND inventory_status = 'reserved'`).bind(orderId).run();
  if (!upd.meta.changes) return;
  const items = (await env.DB.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').bind(orderId).all()).results || [];
  if (items.length) await env.DB.batch(items.map((i) => stockStmt(env, 1, i)));
}

// 沒付款的訂單自動逾期並補回庫存：信用卡 2 小時，ATM／超商代碼／銀行轉帳 4 天（繳費期限 3 天再寬限 1 天）
// Pages 沒有排程，所以在結帳、商品列表、後台等請求時順便檢查，每個執行個體最多每分鐘一次
let lastExpireSweep = 0;
async function expireStale(env) {
  if (!env.DB || Date.now() - lastExpireSweep < 60000) return;
  lastExpireSweep = Date.now();
  try {
  const { results } = await env.DB.prepare(`UPDATE orders SET status = 'expired', updated_at = datetime('now')
      WHERE status IN ('pending_payment', 'payment_info_received', 'payment_failed') AND (
        (payment_method = 'credit_card' AND created_at < datetime('now', '-2 hours')) OR
        (payment_method != 'credit_card' AND created_at < datetime('now', '-4 days')))
      RETURNING order_id`).all();
  // 已逾期／取消但庫存還在預留的（含上次掃到一半中斷的），每次補 10 張，避免超過子請求上限
  const stuck = (await env.DB.prepare(`SELECT order_id FROM orders WHERE status IN ('expired', 'cancelled') AND inventory_status = 'reserved' LIMIT 10`).all()).results || [];
  for (const r of stuck) await releaseStock(env, r.order_id);
  for (const r of (results || []).slice(0, 5)) await syncAirtable(env, r.order_id);
  } catch (err) { console.error('expireStale:', err.message); }   // 掃描失敗不影響結帳與商品列表
}

// 標記已付款並扣庫存。只有從未付款狀態轉過來的那一次會成功，重複通知不會重複扣
async function markPaid(env, orderId, tradeNo = '') {
  const upd = await env.DB.prepare(`UPDATE orders SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now'),
      payment_info = CASE WHEN ? = '' THEN payment_info ELSE json_set(coalesce(payment_info, '{}'), '$.trade_no', ?) END
      WHERE order_id = ? AND status IN ('pending_payment', 'payment_info_received', 'payment_failed', 'expired')`)
    .bind(tradeNo, tradeNo, orderId).run();
  if (!upd.meta.changes) return false;

  const o = await env.DB.prepare('SELECT coupon_code, inventory_status FROM orders WHERE order_id = ?').bind(orderId).first();
  const couponUse = o?.coupon_code ? [env.DB.prepare('UPDATE discount_codes SET usage_count = usage_count + 1 WHERE code = ?').bind(o.coupon_code)] : [];
  if (o?.inventory_status === 'reserved') {
    // 下單時已預留，直接轉成已扣（條件式：同時被逾期掃描補回庫存的話，改走下面重新扣庫存）
    const r = await env.DB.prepare(`UPDATE orders SET inventory_status = 'deducted' WHERE order_id = ? AND inventory_status = 'reserved'`).bind(orderId).run();
    if (r.meta.changes) { if (couponUse.length) await env.DB.batch(couponUse); return true; }
  }
  // 改版前的舊單，或逾期時已補回庫存的單：現在才扣
  const items = (await env.DB.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').bind(orderId).all()).results || [];
  // 條件式扣庫存：庫存不夠的那一列不會被改，不會變負數
  const res = await env.DB.batch(items.map((i) => env.DB
    .prepare(`UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE product_id = ? AND stock >= ?`)
    .bind(i.qty, i.product_id, i.qty)));
  const short = res.some((r) => !r.meta.changes);
  // 庫存不足不取消客人的付款，改成 paid_stock_conflict 讓後台人工處理
  await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET inventory_status = ?, status = CASE WHEN ? THEN 'paid_stock_conflict' ELSE status END WHERE order_id = ?`)
      .bind(short ? 'conflict' : 'deducted', short ? 1 : 0, orderId),
    ...couponUse,
  ]);
  return true;
}

async function setStatus(env, o, target) {
  if (o.status === target || (STATUS_LABEL[o.status] === STATUS_LABEL[target] && PAID_STATES.includes(o.status))) return { ok: true };
  if (!(NEXT_STATUS[o.status] || []).includes(target)) {
    return { ok: false, error: `訂單目前是「${STATUS_LABEL[o.status]}」，不能改成「${STATUS_LABEL[target]}」` };
  }
  if (target === 'paid') return (await markPaid(env, o.order_id)) ? { ok: true } : { ok: false, error: '訂單狀態剛被更新，請重新整理' };
  const r = await env.DB.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE order_id = ? AND status = ?`)
    .bind(target, o.order_id, o.status).run();
  if (!r.meta.changes) return { ok: false, error: '訂單狀態剛被更新，請重新整理' };
  if (target === 'cancelled' || target === 'expired') await releaseStock(env, o.order_id);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════
// AIRTABLE — 訂單副本。失敗不影響 D1 訂單，記成 error，後台打開時會自動重送
// ════════════════════════════════════════════════════════════
async function airtableWrite(token, recordId, fields) {
  const send = (f) => fetch(recordId ? `${AIRTABLE_URL}/${recordId}` : AIRTABLE_URL, {
    method: recordId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: f, typecast: true }),
  });
  let res = await send(fields);
  if (!res.ok) {
    const err = await res.text();
    // Airtable 表還沒加 email 欄位時會整筆退件：拿掉 email 重送一次，不要讓客人下不了單
    if (!/Unknown field name/i.test(err) || !('email' in fields)) throw new Error('Airtable: ' + err);
    const { email, ...rest } = fields;
    res = await send(rest);
    if (!res.ok) throw new Error('Airtable HTTP ' + res.status);   // 不存回應內容（可能夾帶客人個資）
  }
  return (await res.json()).id;
}

async function syncAirtable(env, orderId) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE order_id = ?').bind(orderId).first();
  if (!o) return;
  try {
    const token = (env.AIRTABLE_TOKEN || '').trim();
    if (!token) throw new Error('伺服器未設定 AIRTABLE_TOKEN');
    const items = (await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').bind(orderId).all()).results || [];
    const id = await airtableWrite(token, o.airtable_id, {
      order_id: o.order_id, name: o.name, phone: o.phone, email: o.email || '',
      address: o.shipping_method === 'cvs' ? `超商取貨｜${o.store_brand}｜${o.store_name}` : o.address,
      items: items.map((i) => `${i.product_name} ×${i.qty}  NT$${i.line_total.toLocaleString()}`).join('\n'),
      total: o.total, payment: PAY_LABEL[o.payment_method] || o.payment_method,
      status: STATUS_LABEL[o.status] || o.status, created_at: fmtTaipei(o.created_at), note: orderNote(o),
    });
    await env.DB.prepare(`UPDATE orders SET airtable_id = ?, airtable_status = 'synced', airtable_error = NULL WHERE order_id = ?`)
      .bind(id, orderId).run();
  } catch (err) {
    await env.DB.prepare(`UPDATE orders SET airtable_status = 'error', airtable_error = ? WHERE order_id = ?`)
      .bind(String(err).slice(0, 500), orderId).run();
  }
}

// ════════════════════════════════════════════════════════════
// CHECKOUT — POST /api/checkout：所有付款方式共用的建單入口
// ════════════════════════════════════════════════════════════
// 一般銀行轉帳（人工對帳）帳戶。D1 settings 有 bank_* 就用 D1，沒有用這裡的預設
const BANK_DEFAULT = { name: '中國信託', code: '822', branch: '', holder: '', account: '668530075772' };
async function bankInfo(env) {
  const s = await loadSettings(env);
  const b = { ...BANK_DEFAULT };
  for (const k of Object.keys(b)) if (s['bank_' + k]) b[k] = s['bank_' + k];
  return b;
}

async function checkout(request, env, url) {
  if (!env.DB) return json({ ok: false, error: '系統維護中，請稍後再試' }, 503);
  if (await limited(env, 'checkout:' + clientIp(request), 20, 600)) return json({ ok: false, error: '操作太頻繁，請稍後再試' }, 429);
  const d = await readJson(request);
  if (!(await turnstileOk(env, d.turnstile, request))) return TS_FAIL();
  const method = String(d.method || '');
  if (!payEnabled(await loadSettings(env), method)) throw new UserError('此付款方式目前暫停使用，請改用其他付款方式');
  const cfg = method === 'bank_transfer' ? null : ecpayCfg(env, url.hostname);
  if (method !== 'bank_transfer' && !cfg) throw new UserError('線上付款暫停中，請改用銀行轉帳');
  const c = checkCustomer(d);
  // 同一支電話 1 小時最多 5 張單（擋換 IP 灌單）
  if (await limited(env, 'checkout-phone:' + c.phone, 5, 3600, true)) return json({ ok: false, error: '同一支電話下單次數太多，請稍後再試或 IG 私訊我們' }, 429);
  const q = await quote(env, { items: d.items, shipping_method: c.ship, coupon: d.coupon, ip: clientIp(request) });
  if (q.couponError) throw new UserError(q.couponError);

  const short = await reserveStock(env, q.lines);
  if (short) throw new UserError(`${short} 庫存不足，請重新整理後再試`);
  let orderId;
  try { orderId = await insertOrder(env, c, q, method); } catch (err) { await restockLines(env, q.lines); throw err; }
  // 折扣碼名額：已付款的單＋3 天內還沒付款的單都算佔名額；超過總量或每人上限就撤銷這張單
  if (q.coupon && (q.coupon.usage_limit || q.coupon.per_customer_limit)) {
    const held = `coupon_code = ? AND (status IN (${PAID_STATES.map(() => '?').join(', ')})
      OR (status IN ('pending_payment', 'payment_info_received') AND created_at > datetime('now', '-3 days')))`;
    const total = (await env.DB.prepare(`SELECT COUNT(*) n FROM orders WHERE ${held}`).bind(q.coupon.code, ...PAID_STATES).first()).n;
    const mine = (await env.DB.prepare(`SELECT COUNT(*) n FROM orders WHERE phone = ? AND ${held}`).bind(c.phone, q.coupon.code, ...PAID_STATES).first()).n;
    if ((q.coupon.usage_limit && total > q.coupon.usage_limit) || (q.coupon.per_customer_limit && mine > q.coupon.per_customer_limit)) {
      await env.DB.batch([env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(orderId),
        env.DB.prepare('DELETE FROM orders WHERE order_id = ?').bind(orderId)]);
      await restockLines(env, q.lines);
      throw new UserError('此折扣碼已達使用上限');
    }
  }
  await limited(env, 'checkout-phone:' + c.phone, 5, 3600);   // 成功建單才計入電話額度（庫存不足、折扣碼錯不算）
  await syncAirtable(env, orderId);   // 失敗只記錄；訂單已在 D1

  if (method === 'bank_transfer') {
    const due = new Date(taipeiNow().getTime() + 3 * 864e5).toISOString().slice(0, 10).replace(/-/g, '/');
    return json({
      ok: true, order_id: orderId, subtotal: q.subtotal, discount: q.discount, shipping: q.shipping, total: q.total,
      items: q.lines.map(({ p, qty }) => ({ id: p.id, name: p.name, price: p.price, qty, image: p.image })),
      bank: await bankInfo(env), deadline: `${due} 23:59`,
    });
  }
  const params = ecpayParams(cfg, url.origin, orderId, q, method);
  params.CheckMacValue = await ecpayCmv(params, cfg.key, cfg.iv);
  // ga：付款完成導回時送 GA4 purchase 用（只給下單的這個瀏覽器）
  const ga = { total: q.total, items: q.lines.map(({ p, qty }) => ({ item_id: p.id, item_name: p.name, price: p.price, quantity: qty })) };
  return json({ ok: true, order_id: orderId, action: cfg.host + '/Cashier/AioCheckOut/V5', params, ga });
}

// GET /api/order-paid?order=… — 付款完成導回時，前端確認伺服器已入帳才送 GA4 purchase
async function orderPaid(request, env, url) {
  if (await limited(env, 'paid:' + clientIp(request), 30, 600)) return json({ paid: false }, 429);
  const id = String(url.searchParams.get('order') || '').toUpperCase();
  if (!/^SF[0-9A-Z-]{6,20}$/.test(id) || !env.DB) return json({ paid: false });
  // 只回「有沒有付款」：任何人拿到訂單編號都看不到金額與品項（GA 用的資料在結帳當下已交給瀏覽器）
  const o = await env.DB.prepare('SELECT status FROM orders WHERE order_id = ?').bind(id).first();
  return json({ paid: !!o && PAID_STATES.includes(o.status) });
}

// ════════════════════════════════════════════════════════════
// ECPAY — 綠界 AIO（信用卡 / Apple Pay、ATM、超商代碼）
// 流程：/api/checkout 建單並簽章 → 瀏覽器 POST 到綠界
//   → /api/ecpay/info   ATM／超商取號（客人還沒付款）
//   → /api/ecpay/notify 付款成功（唯一的入帳依據）
//   → /api/ecpay/result 瀏覽器導回（只顯示，不入帳）
// ECPAY_ENV = production 且三個金鑰都設，才走正式環境；其他情況一律用綠界公開測試帳號
// ════════════════════════════════════════════════════════════
const ECPAY_CHOOSE = {
  credit_card: { pay: 'Credit' },
  ecpay_atm: { pay: 'ATM', extra: { ExpireDate: 3 } },
  ecpay_cvs: { pay: 'CVS', extra: { StoreExpireDate: 4320 } },
};

// 沒有正式金鑰時回 null：正式站一律停用綠界（避免任何人用公開的測試金鑰偽造付款通知），只有本機開發可用測試帳號
function ecpayCfg(env, host = '') {
  const id = (env.ECPAY_MERCHANT_ID || '').trim();
  const key = (env.ECPAY_HASH_KEY || '').trim();
  const iv = (env.ECPAY_HASH_IV || '').trim();
  if ((env.ECPAY_ENV || '').trim() === 'production' && id && key && iv) {
    return { id, key, iv, host: 'https://payment.ecpay.com.tw', mode: 'production' };
  }
  if (!isLocal(host)) return null;
  return { id: '3002607', key: 'pwFHCqoQZGmho4w6', iv: 'EkRm7iFT261dpevs', host: 'https://payment-stage.ecpay.com.tw', mode: 'test' };
}

function ecpayParams(cfg, origin, orderId, q, method) {
  const m = ECPAY_CHOOSE[method];
  const params = {
    MerchantID: cfg.id,
    MerchantTradeNo: orderId.replace('-', ''),   // 綠界只收英數 20 字內
    MerchantTradeDate: taipeiNow().toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/'),
    PaymentType: 'aio',
    TotalAmount: q.total,
    TradeDesc: 'Season Flavor',
    ItemName: q.lines.map(({ p, qty }) => `${p.name} x${qty}`).join('#').slice(0, 400),
    ReturnURL: origin + '/api/ecpay/notify',
    ClientBackURL: origin + '/shop',
    ChoosePayment: m.pay,
    EncryptType: 1,
    ...(m.extra || {}),
  };
  if (m.pay === 'Credit') params.OrderResultURL = origin + '/api/ecpay/result';
  else {
    params.PaymentInfoURL = origin + '/api/ecpay/info';
    params.ClientRedirectURL = origin + `/shop?pay=info&order=${orderId}`;
  }
  return params;
}

// CheckMacValue（SHA256）。encodeURIComponent 與 PHP urlencode 的差異只有 %20、~、'
async function ecpayCmv(params, key, iv) {
  const body = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const enc = encodeURIComponent(`HashKey=${key}&${body}&HashIV=${iv}`)
    .replace(/%20/g, '+').replace(/~/g, '%7e').replace(/'/g, '%27').toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(enc));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function ecpayForm(request, env) {
  const f = Object.fromEntries((await request.formData()).entries());
  const cfg = ecpayCfg(env, new URL(request.url).hostname);
  // 簽章要對、商店代號也要是我們的（測試金鑰是公開共用的，只比簽章不夠）
  const ok = !!cfg && typeof f.CheckMacValue === 'string' && f.MerchantID === cfg.id &&
    await sameSecret(f.CheckMacValue.toUpperCase(), await ecpayCmv(f, cfg.key, cfg.iv));
  return { f, ok };
}

const findByTradeNo = (env, mtn) => (env.DB && /^[A-Za-z0-9]{1,20}$/.test(mtn || '')
  ? env.DB.prepare('SELECT * FROM orders WHERE merchant_trade_no = ?').bind(mtn).first()
  : null);

// 每一筆綠界通知都留紀錄；同一訂單同一 RtnCode 只記一次
const logPayment = (env, orderId, f) => env.DB.prepare(`INSERT OR IGNORE INTO payment_events
    (order_id, provider, trade_no, merchant_trade_no, rtn_code, amount, raw_payload) VALUES (?, 'ecpay', ?, ?, ?, ?, ?)`)
  .bind(orderId, f.TradeNo || null, f.MerchantTradeNo, String(f.RtnCode), Number(f.TradeAmt) || null, JSON.stringify(f)).run();

// POST /api/ecpay/notify — 綠界 server-to-server，必須回 1|OK（回別的綠界會重送）
async function ecpayNotify(request, env) {
  const { f, ok } = await ecpayForm(request, env);
  if (!ok) return new Response('0|CheckMacValue error', { status: 400 });
  await ensureSchema(env);
  const o = await findByTradeNo(env, f.MerchantTradeNo);
  if (!o) return legacyNotify(env, f);
  if (o.payment_provider !== 'ecpay') return new Response('0|order not ecpay', { status: 400 });
  await logPayment(env, o.order_id, f);
  // 只有真實付款成功才入帳；模擬付款（SimulatePaid=1）不算
  if (String(f.RtnCode) === '1' && f.SimulatePaid !== '1') {
    if (Number(f.TradeAmt) !== o.total) {
      const msg = `綠界回報金額 NT$${f.TradeAmt} 與訂單金額不符，未標記付款，請人工確認`;
      await env.DB.prepare(`UPDATE orders SET note = CASE WHEN coalesce(note, '') = '' THEN ? ELSE note || char(10) || ? END
          WHERE order_id = ? AND instr(coalesce(note, ''), ?) = 0`)
        .bind(msg, msg, o.order_id, msg).run();
    } else {
      const paid = await markPaid(env, o.order_id, String(f.TradeNo || ''));
      // 訂單已取消／逾期卻收到款：不改狀態，但寫備註讓後台看得到
      if (!paid && !PAID_STATES.includes(o.status)) {
        const msg = `綠界已收款 NT$${f.TradeAmt}，但訂單狀態為「${STATUS_LABEL[o.status] || o.status}」，請人工處理（退款或恢復訂單）`;
        await env.DB.prepare(`UPDATE orders SET note = CASE WHEN coalesce(note, '') = '' THEN ? ELSE note || char(10) || ? END,
            updated_at = datetime('now') WHERE order_id = ? AND instr(coalesce(note, ''), ?) = 0`)
          .bind(msg, msg, o.order_id, msg).run();
      }
    }
    await syncAirtable(env, o.order_id);
  }
  return new Response('1|OK');
}

// POST /api/ecpay/info — ATM／超商取號成功（RtnCode 2 或 10100073 不是錯誤，是客人還沒付款）
async function ecpayInfo(request, env) {
  const { f, ok } = await ecpayForm(request, env);
  if (!ok) return new Response('0|CheckMacValue error', { status: 400 });
  await ensureSchema(env);
  const o = await findByTradeNo(env, f.MerchantTradeNo);
  if (!o) return legacyInfo(env, f);
  if (o.payment_provider !== 'ecpay') return new Response('0|order not ecpay', { status: 400 });
  await logPayment(env, o.order_id, f);
  const rc = String(f.RtnCode);
  if (rc === '2' || rc === '10100073') {
    const info = rc === '2'
      ? { type: 'atm', bank_code: f.BankCode, account: f.vAccount, expire: f.ExpireDate }
      : { type: 'cvs', payment_no: f.PaymentNo, expire: f.ExpireDate };
    await env.DB.prepare(`UPDATE orders SET payment_info = ?, updated_at = datetime('now'),
        status = CASE WHEN status = 'pending_payment' THEN 'payment_info_received' ELSE status END
        WHERE order_id = ? AND status IN ('pending_payment', 'payment_info_received')`)
      .bind(JSON.stringify(info), o.order_id).run();
    await syncAirtable(env, o.order_id);
  }
  return new Response('1|OK');
}

// POST /api/ecpay/result — 刷卡後瀏覽器被綠界 POST 回來 → 轉回商店頁。只顯示，入帳看 notify
async function ecpayResult(request, env) {
  const { f, ok } = await ecpayForm(request, env);
  const o = ok ? await findByTradeNo(env, f.MerchantTradeNo) : null;
  const paid = (o && PAID_STATES.includes(o.status)) || (ok && String(f.RtnCode) === '1');
  const order = o ? o.order_id : String(f.MerchantTradeNo || '').replace(/[^A-Za-z0-9]/g, '');
  return new Response(null, {
    status: 303,
    headers: { Location: `/shop?pay=${paid ? 'ok' : 'fail'}&order=${encodeURIComponent(order)}`, ...SECURITY_HEADERS },
  });
}

// ── 舊訂單（改版前建立、只在 Airtable）的綠界通知與查詢，維持原本做法 ──
async function airtableFind(env, orderId) {
  const q = `${AIRTABLE_URL}?maxRecords=1&filterByFormula=${encodeURIComponent(`{order_id}='${orderId}'`)}`;
  const res = await fetch(q, { headers: { Authorization: `Bearer ${(env.AIRTABLE_TOKEN || '').trim()}` } });
  if (!res.ok) throw new Error('airtable');
  return (await res.json()).records?.[0] || null;
}
async function airtablePatch(env, id, fields) {
  const res = await fetch(`${AIRTABLE_URL}/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${(env.AIRTABLE_TOKEN || '').trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error('airtable');
}

async function legacyNotify(env, f) {
  if (String(f.RtnCode) !== '1' || f.SimulatePaid === '1' || !/^[A-Za-z0-9]{1,20}$/.test(f.MerchantTradeNo || '')) return new Response('1|OK');
  try {
    const rec = await airtableFind(env, f.MerchantTradeNo);
    if (!rec || rec.fields.status === '已付款' || Number(rec.fields.total) !== Number(f.TradeAmt)) return new Response('1|OK');
    await airtablePatch(env, rec.id, { status: '已付款', note: [rec.fields.note, `綠界交易編號: ${f.TradeNo}`].filter(Boolean).join('\n') });
  } catch { return new Response('0|error', { status: 500 }); }
  return new Response('1|OK');
}

async function legacyInfo(env, f) {
  const rc = String(f.RtnCode);
  if ((rc !== '2' && rc !== '10100073') || !/^[A-Za-z0-9]{1,20}$/.test(f.MerchantTradeNo || '')) return new Response('1|OK');
  const info = rc === '2'
    ? `ATM 虛擬帳號: 銀行代碼 ${f.BankCode} 帳號 ${f.vAccount} 期限 ${f.ExpireDate}`
    : `超商繳費代碼: ${f.PaymentNo} 期限 ${f.ExpireDate}`;
  try {
    const rec = await airtableFind(env, f.MerchantTradeNo);
    if (rec && !String(rec.fields.note || '').includes(info)) {
      await airtablePatch(env, rec.id, { note: [rec.fields.note, info].filter(Boolean).join('\n') });
    }
  } catch { return new Response('0|error', { status: 500 }); }
  return new Response('1|OK');
}

// ════════════════════════════════════════════════════════════
// 訂單查詢 POST /api/order-lookup：訂單編號 + 訂購電話都對才回資料
// 查不到一律同一句，不透露訂單是否存在；不回 Email、地址
// ════════════════════════════════════════════════════════════
async function orderLookup(request, env) {
  const d = await readJson(request, 2048);
  // 客人從綠界複製的編號沒有「-」（MerchantTradeNo），補回來
  const id = String(d.order_id || '').trim().toUpperCase().replace(/^(SF\d{6})([A-Z0-9]{6})$/, '$1-$2');
  const phone = String(d.phone || '').replace(/\D/g, '');
  const miss = () => json({ ok: false, error: '查無訂單，請確認訂單編號與訂購電話' }, 404);
  // 次數限制：每個 IP 10 次／10 分鐘；同一張訂單同一個 IP 5 次／10 分鐘；
  // 同一張訂單不分來源 30 次／小時（擋多 IP 猜電話，但別人亂試 5 次不會鎖住真正的客人）
  if (!/^[A-Z0-9-]{1,24}$/.test(id) || phone.length < 8) return miss();
  const ip = clientIp(request), oid = id;
  if (await limited(env, 'lookup-ip:' + ip, 10, 600) ||
      (id && await limited(env, 'lookup-order-ip:' + oid + ':' + ip, 5, 600)) ||
      (id && await limited(env, 'lookup-order:' + oid, 30, 3600))) {
    return json({ ok: false, error: '查詢次數太多，請 10 分鐘後再試' }, 429);
  }
  if (!/^[A-Z0-9-]{1,24}$/.test(id) || phone.length < 8) return miss();

  const o = env.DB ? await env.DB.prepare('SELECT * FROM orders WHERE order_id = ?').bind(id).first() : null;
  if (o) {
    if (o.phone.replace(/\D/g, '') !== phone) return miss();
    const items = (await env.DB.prepare('SELECT product_name, qty, line_total FROM order_items WHERE order_id = ? ORDER BY id').bind(id).all()).results || [];
    return json({ ok: true, order: {
      order_id: o.order_id, status: STATUS_LABEL[o.status] || o.status, payment: PAY_LABEL[o.payment_method] || o.payment_method,
      total: o.total, created_at: fmtTaipei(o.created_at), shipping: o.shipping, discount: o.discount,
      items: items.map((i) => `${i.product_name} ×${i.qty}  NT$${i.line_total.toLocaleString()}`).join('\n'),
      note: [shipLine(o), paymentInfoText(o)].filter(Boolean).join('\n'),
    } });
  }

  // 改版前的訂單只在 Airtable
  if (!(env.AIRTABLE_TOKEN || '').trim()) return miss();
  let f;
  try { f = (await airtableFind(env, id))?.fields; } catch { return json({ ok: false, error: '系統暫時無法查詢' }, 502); }
  if (!f || String(f.phone || '').replace(/\D/g, '') !== phone) return miss();
  const note = String(f.note || '').split('\n').filter((l) => l && !/Email: |^匯款帳號後五碼/.test(l)).join('\n');
  return json({ ok: true, order: {
    order_id: f.order_id, status: f.status || '待付款', payment: f.payment || '', total: f.total || 0,
    items: f.items || '', created_at: f.created_at || '', note,
  } });
}

// ════════════════════════════════════════════════════════════
// ERROR HANDLING
// ════════════════════════════════════════════════════════════
async function serverError(request, env) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) {
    return json({ ok: false, error: '系統暫時發生問題，請稍後再試' }, 500);
  }
  try {
    return await render(request, env, '/500', seoHead({ path: url.pathname, title: '系統暫時發生問題', desc: '請稍後重新整理再試一次。', noindex: true }), {}, 500);
  } catch {
    return html('<!doctype html><meta charset="utf-8"><title>系統暫時發生問題｜肆菓 Season Flavor</title><meta name="robots" content="noindex"><p>系統暫時發生問題，請稍後再試。</p>', 500);
  }
}

// ════════════════════════════════════════════════════════════
// ROUTING
// ════════════════════════════════════════════════════════════
const isLocal = (host) => ['localhost', '127.0.0.1'].includes(host);
const POST_ONLY = () => json({ ok: false, error: 'method not allowed' }, 405);

async function route(request, env) {
  const url = new URL(request.url);
  const p = url.pathname;
  const GET = request.method === 'GET' || request.method === 'HEAD';
  const POST = request.method === 'POST';

  // 主網域統一成 https://www.seasonflavor.com（只轉 GET，綠界回呼等 POST 不轉）
  if (GET && !isLocal(url.hostname) &&
      (url.hostname === 'seasonflavor.com' || /^[^.]+\.pages\.dev$/.test(url.hostname) || url.protocol === 'http:')) {
    return redirect(SITE + p + url.search);
  }

  // 資料表第一次用到時自動建立；靜態檔（有副檔名）不需要
  if (!/\.[a-z0-9]+$/i.test(p) || p === '/sitemap.xml' || p === '/llms.txt') await ensureSchema(env).catch(() => {});

  // 健康檢查：只回 ok，不透露任何設定
  if (p === '/api/health') return json({ status: 'ok' });
  if (p === '/diag') {
    if (!isLocal(url.hostname) && await adminAuth(request, env)) return notFound(request, env);
    return diag(env, request);
  }

  // 後台登入
  if (p === '/api/admin/login')   return POST ? adminLogin(request, env) : POST_ONLY();
  if (p === '/api/admin/logout')  return POST ? adminLogout(request, env) : POST_ONLY();
  if (p === '/api/admin/logout-all') return POST ? adminLogoutAll(request, env) : POST_ONLY();
  if (p === '/api/admin/session') {
    const s = await adminSession(request, env);
    return s ? json({ ok: true, csrf: s.csrf }) : json({ ok: false }, 401);
  }

  // 結帳與金流
  if (['/api/checkout', '/api/cart/quote', '/api/products', '/admin-orders', '/admin-products'].includes(p)) await expireStale(env);
  if (p === '/api/cart/quote')    return POST ? cartQuote(request, env) : POST_ONLY();
  if (p === '/api/checkout')      return POST ? checkout(request, env, url) : POST_ONLY();
  if (p === '/api/order-paid')    return GET ? orderPaid(request, env, url) : POST_ONLY();
  if (p === '/api/order-lookup')  return POST ? orderLookup(request, env) : POST_ONLY();
  if (p === '/api/ecpay/notify' && POST) return ecpayNotify(request, env);
  if (p === '/api/ecpay/info' && POST)   return ecpayInfo(request, env);
  if (p === '/api/ecpay/result' && POST) return ecpayResult(request, env);
  if (p === '/api/checkout-config' && GET) {
    const st = await loadSettings(env);
    const ecpayOn = !!ecpayCfg(env, url.hostname);
    return json({ turnstile: (env.TURNSTILE_SITE_KEY || '').trim(), bank: await bankInfo(env), pay: Object.fromEntries(PAY_IDS.map((id) => [id, payEnabled(st, id) && (id === 'bank_transfer' || ecpayOn)])) });
  }
  // 改版前的結帳入口：舊頁面快取還在時請客人重新整理
  if (p === '/order' || p === '/api/ecpay/create') return json({ ok: false, error: '網站已更新，請重新整理頁面後再結帳' }, 410);

  if (p === '/api/contact')      return POST ? createContact(request, env) : POST_ONLY();
  if (p === '/api/products')     return GET ? listProducts(env) : POST_ONLY();
  // 舊版 shop.js 用 /products 當 API；瀏覽器導覽（accept 帶 text/html）才轉址到新頁面
  if (p === '/products' && GET && !(request.headers.get('accept') || '').includes('text/html')) return listProducts(env);
  if (p === '/api/journal')      return GET ? apiJournal(env) : POST_ONLY();
  if (p.startsWith('/api/journal/')) return GET ? apiJournal(env, p.slice(13)) : POST_ONLY();
  if (p === '/api/settings')     return GET ? json(await loadSettings(env)) : POST_ONLY();
  if (p.startsWith('/api/'))     return json({ ok: false, error: 'not found' }, 404);

  // 後台 API（全部要登入）
  if (p === '/admin-orders')     return adminOrders(request, env, url);
  if (p === '/admin-order-detail' && GET) return adminOrderDetail(request, env, url);
  if (p === '/admin-stats' && GET)        return adminStats(request, env);
  if (p === '/admin-products')   return adminProducts(request, env);
  if (p === '/admin-discounts')  return adminDiscounts(request, env);
  if (p === '/admin-pos-sync')   return POST ? posSync(request, env) : POST_ONLY();
  if (p === '/admin-journal')    return adminJournal(request, env, url);
  if (p === '/admin-settings')   return adminSettings(request, env);
  if (p === '/admin-upload')     return POST ? adminUpload(request, env) : POST_ONLY();
  if (p.startsWith('/media/'))   return GET ? serveMedia(env, decodeURIComponent(p.slice(7))) : POST_ONLY();

  // 舊網址 301
  const qs = url.search;
  if (REDIRECTS[p]) return redirect(REDIRECTS[p] + qs);
  if (p === '/404' || p === '/404.html' || p === '/500' || p === '/500.html') return notFound(request, env);
  const oldPost = p.match(/^\/journal\/(\d+)\/?$/);
  if (oldPost) return redirect(`/stories/${oldPost[1]}${qs}`);
  const oldImg = p.match(/^\/images\/([^/]+)$/);
  if (oldImg && IMAGE_RENAMES[oldImg[1]]) return redirect(`/images/${IMAGE_RENAMES[oldImg[1]]}`);
  // 結尾多一個斜線的內頁（/about/、/products/kiwi/）統一成沒斜線
  if (p.startsWith('//')) return notFound(request, env);   // //evil.com/ 去掉結尾斜線會變成站外轉址
  if (p.length > 1 && p.endsWith('/') && !PAGES[p]) return redirect(p.slice(0, -1) + qs);

  // 頁面
  if (GET) {
    if (p === '/')           return homePage(request, env);
    if (p === '/shop')       return shopPage(request, env);
    if (p === '/products/')  return render(request, env, '/products', pageHead('/products/'), { FLAVORS: flavorCards(await loadProducts(env)) });
    const prod = p.match(/^\/products\/([a-z0-9-]+)$/);
    if (prod)                return productPage(request, env, prod[1]);
    if (p === '/stories/')   return storiesPage(request, env);
    const story = p.match(/^\/stories\/(\d+|[a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (story)               return storyPage(request, env, story[1]);
    if (p === '/faq' || p === '/contact') return faqPage(request, env, p);
    if (p === '/about')      return render(request, env, PAGES[p].tpl, pageHead(p), { PRICES: priceLine(await loadProducts(env)) });
    if (PAGES[p])            return render(request, env, PAGES[p].tpl, pageHead(p));

    if (p === '/sitemap.xml') return sitemap(env);
    if (p === '/llms.txt')    return llmsTxt(request, env);
    if (p === '/pricing.md')  return pricingMd(request, env);
  }

  // 內部文件（SETUP.md 等）和隱藏資料夾不對外公開
  // 先解碼再判斷（/SETUP%2emd、/%2eDS_Store 這類編碼寫法也要擋）；任一段以 . 開頭的路徑都不公開
  let dp; try { dp = decodeURIComponent(p); } catch { return notFound(request, env); }
  if ((/\.md$/i.test(dp) && dp !== '/pricing.md') || /(^|\/)\./.test(dp)) return notFound(request, env);

  // 其他 → 靜態檔案；找不到的一律回真正的 404，不回首頁（避免軟 404）
  const res = await env.ASSETS.fetch(request);
  if (res.status === 404 && GET) return notFound(request, env);
  const out = new Response(res.body, res);
  // 瀏覽器快取：圖片 30 天（換圖請改檔名）；CSS／JS 10 分鐘（部署後最多 10 分鐘全部換新）
  if (res.ok && /^\/images\/|\.(webp|jpe?g|png|svg|ico|woff2?)$/i.test(p)) out.headers.set('Cache-Control', 'public, max-age=2592000');
  else if (res.ok && /\.(css|js)$/i.test(p) && !/^\/admin/.test(p)) out.headers.set('Cache-Control', 'public, max-age=600');
  // 後台與收銀頁不給搜尋引擎收錄
  if (/^\/admin/.test(p)) out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return out;
}

// 公開頁面（HTML）在 Cloudflare 邊緣快取 60 秒，同一分鐘內的訪客不用重組頁面、不查資料庫。
// 後台改的商品、文章最多 1 分鐘後出現在前台；結帳金額與庫存一律在伺服器重算，不受快取影響
// ⚠ 快取不分使用者：公開頁面不能放「依登入狀態或 cookie 變化」的內容，否則會被快取給別人看
const EDGE_TTL = 60;
const edgeCacheable = (request) => {
  if (request.method !== 'GET' || typeof caches === 'undefined') return false;
  const u = new URL(request.url);
  return !u.search && !/^\/(api|admin|cart|order-status|diag|media)/.test(u.pathname);
};

export default {
  async fetch(request, env, ctx) {
    const useCache = edgeCacheable(request);
    if (useCache) {
      const hit = await caches.default.match(request);
      if (hit) return hit;
    }
    let res;
    try {
      res = await route(request, env);
    } catch (err) {
      if (err instanceof UserError) res = json({ ok: false, error: err.message }, 400);
      else {
        console.error(err);   // 只進 Cloudflare 日誌，不回給瀏覽器
        res = await serverError(request, env);
      }
    }
    // 所有回應補上安全標頭
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
    if (useCache && out.status === 200 && (out.headers.get('Content-Type') || '').startsWith('text/html') && !out.headers.has('Set-Cookie')) {
      const copy = out.clone();
      copy.headers.set('Cache-Control', `public, max-age=${EDGE_TTL}`);
      ctx?.waitUntil?.(caches.default.put(request, copy));
    }
    return out;
  },
};
