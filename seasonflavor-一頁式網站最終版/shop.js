// ============================================
// 肆菓 Season Flavor — Shop & Cart
// ============================================
// 價格、庫存、折扣、運費、總額一律以伺服器（/api/cart/quote、/api/checkout）計算為準，
// 這裡算出來的數字只用來顯示。購物車在 localStorage 只存 { id, qty }。

// ─── 商品資料 ─────────────────────────────
// 後台（D1）讀不到時的備援。正常情況下整份會被 /api/products 的資料取代，
// 後台新增的商品也會出現在這裡。
let PRODUCTS = [
  { id: 'mixed-berry', name: '綜合莓果果醬', description: '深邃的果香，帶著一點點神秘的尾韻',
    price: 170, stock: 0, image: '/images/mixed-berry-jam-jar.webp', available: false, flavor: 'berry' },
  { id: 'strawberry', name: '草莓果醬', description: '溫柔的酸與甜，像是春天剛開始的感覺',
    price: 150, stock: 0, image: '/images/strawberry-jam-jar.webp', available: false, flavor: 'strawberry' },
  { id: 'peach', name: '水蜜桃果醬', description: '多汁飽滿，是夏天最讓人期待的一種甜',
    price: null, stock: 0, image: '/images/peach-jam-jar.webp', available: false, flavor: 'peach' },
  { id: 'kiwi', name: '奇異果果醬', description: '清爽帶勁的綠意，讓人精神一振的酸甜',
    price: null, stock: 0, image: '/images/kiwi-jam-jar.webp', available: false, flavor: 'kiwi' },
];

// ─── 狀態 ──────────────────────────────────
// 瀏覽器裡的購物車資料可能損壞，壞掉就當空的，不讓整支 shop.js 掛掉
let cart = (() => {
  try {
    const c = JSON.parse(localStorage.getItem('sf_cart') || '[]');
    return Array.isArray(c) ? c.filter(i => i && typeof i.id === 'string' && Number.isInteger(i.qty) && i.qty > 0)
      .map(i => ({ id: i.id, qty: Math.min(i.qty, 99) })) : [];
  } catch { return []; }
})();
// payment_method：credit_card / line_pay / ecpay_atm / ecpay_cvs / bank_transfer（apple_pay 併在信用卡，走綠界 Credit 頁）
let selectedPayment = 'credit_card';
// 各付款方式可不可用，由後台「金流控制台」設定（D1 settings），openCheckout 時向 /api/checkout-config 取得
let PAYCFG = { pay: { credit_card: true, line_pay: false, ecpay_atm: true, ecpay_cvs: true, bank_transfer: true } };
const PAY_ORDER = ['credit_card', 'line_pay', 'ecpay_atm', 'ecpay_cvs', 'bank_transfer'];
const payOn = id => !!PAYCFG.pay[id];
const ECPAY_PAY = ['credit_card', 'ecpay_atm', 'ecpay_cvs'];
let appliedDiscount = null; // 目前套用的折扣
const ERR_COLOR = '#A4573B'; // 錯誤提示色：品牌橘加深，對比 4.9:1（原 --orange 只有 2.7:1）
let shipMethod = 'home';      // 配送方式 home=宅配 / cvs=超商
let cvsBrand = '711';         // 超商品牌 711 / fm
// ─── 運費設定（要改運費就改這裡）──────────────
const SHIPPING = {
  home: { fee: 120, label: '宅配運費' },
  cvs:  { fee: 60,  label: '超商取貨運費' },
};
// 購物滿這個金額免運。設 0 代表沒有免運活動，前台就不會提到免運。
const FREE_SHIPPING_THRESHOLD = 0;

// 購物車與商品頁共用的運費說明，避免各頁 HTML 各寫一份而對不起來
function shippingNote() {
  const base = `宅配 NT$${SHIPPING.home.fee}／超商取貨 NT$${SHIPPING.cvs.fee}`;
  return FREE_SHIPPING_THRESHOLD > 0
    ? `${base}，滿 NT$${FREE_SHIPPING_THRESHOLD} 免運`
    : base;
}
const localQty = {};

// 折扣碼在後台「折扣碼」區管理（D1），由伺服器判斷

PRODUCTS.filter(p => p.available).forEach(p => { localQty[p.id] = 1; });

// ─── 讀取即時庫存（D1）──────────────────────
// 從 /api/products 取得後台（D1）的完整商品清單，整份取代 PRODUCTS。
// 讀不到就沿用檔案裡的備援，網站不會壞。
async function loadProducts() {
  try {
    const res = await fetch('/api/products', { cache: 'no-store' });
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) return;
    PRODUCTS = list.map(row => ({
      id: row.id,
      name: row.name,
      description: row.card || '',
      price: row.price != null ? Number(row.price) : null,
      stock: Number(row.stock) || 0,
      image: row.image,
      alt: row.alt || row.name,
      available: !!row.available,
      flavor: row.bg || '',
      net_weight: row.net_weight, ingredients: row.ingredients,
      shelf_life: row.shelf_life, storage: row.storage,
    }));
    PRODUCTS.forEach(p => { localQty[p.id] = localQty[p.id] || 1; });
    // 商品被隱藏或刪掉時，購物車裡的那一項也拿掉，避免結帳時找不到商品
    // 庫存變少時，購物車數量跟著降到庫存上限；賣完的拿掉，並提示客人
    const before = JSON.stringify(cart);
    cart = cart.filter(i => PRODUCTS.some(p => p.id === i.id && p.available && p.price != null && p.stock > 0));
    cart.forEach(i => { i.qty = Math.min(i.qty, PRODUCTS.find(p => p.id === i.id).stock); });
    if (JSON.stringify(cart) !== before) {
      saveCart();
      if (typeof showToast === 'function') showToast('部分商品庫存有變動，購物車數量已更新');
    }
  } catch { /* 靜默失敗，用預設值 */ }
}

// 商品資料只抓一次；其他頁面等需要（打開購物車、結帳）才抓
let productsReady = null;
const ensureProducts = () => productsReady || (productsReady = loadProducts());

// ─── 渲染商店 ──────────────────────────────
// D1 資料塞進 innerHTML 前一律跳脫
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 商品規格區塊。成分還沒確認的口味就不列成分那行。
// 跟 _worker.js 的 specHtml 輸出一樣的內容，資料來自 D1
function specBlock(p) {
  const row = (k, v) => v ? `<div class="spec-row"><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '';
  return `
    <dl class="spec-list">
      ${row('淨重', p.net_weight)}
      <div class="spec-row"><dt>果肉含量</dt><dd>80%</dd></div>
      ${row('成分', p.ingredients)}
      ${row('保存期限', p.shelf_life)}
      ${row('保存方式', p.storage)}
    </dl>`;
}

function renderShop() {
  const grid = document.getElementById('shopGrid');
  const comingWrap = document.getElementById('shopComingSoon');
  if (!grid) return;

  // 三種狀態：可販售(有供應且有庫存) / 售完(有供應但庫存0) / 即將推出或無供應
  const sellable = PRODUCTS.filter(p => p.available && p.stock > 0);
  const soldout  = PRODUCTS.filter(p => p.available && p.stock <= 0);
  const upcoming = PRODUCTS.filter(p => !p.available);

  grid.innerHTML = sellable.map(p => `
    <div class="shop-card reveal" data-id="${esc(p.id)}">
      <div class="shop-card-img ${esc(p.flavor)}-bg">
        <img src="${esc(p.image)}" alt="${esc(p.alt || p.name)}" loading="lazy" data-hide-broken />
      </div>
      <div class="shop-card-body">
        <span class="pf-badge available">現貨</span>
        <h3 class="shop-card-name"><a href="/products/${esc(p.id)}">${esc(p.name)}</a></h3>
        <p class="shop-card-desc">${esc(p.description)}</p>
        ${specBlock(p)}
        <div class="shop-price-row">
          <span class="shop-price">NT$ ${esc(p.price)}</span>
          <span class="shop-stock-tag${p.stock <= 5 ? ' low' : ''}">
            庫存 ${p.stock} 瓶${p.stock <= 5 ? '　快售完' : ''}
          </span>
        </div>
        <div class="shop-actions">
          <div class="qty-selector">
            <button class="qty-btn" data-act="qty" data-id="${esc(p.id)}" data-d="-1" aria-label="減少 ${esc(p.name)} 數量">−</button>
            <span class="qty-num" id="qty-${esc(p.id)}">1</span>
            <button class="qty-btn" data-act="qty" data-id="${esc(p.id)}" data-d="1" aria-label="增加 ${esc(p.name)} 數量">+</button>
          </div>
          <button class="btn add-cart-btn" data-id="${esc(p.id)}" data-act="add" data-id="${esc(p.id)}">加入購物車</button>
        </div>
      </div>
    </div>
  `).join('');

  // 售完的標「售完」、無供應的標「即將推出」，一起放在下方區塊
  const others = [
    ...soldout.map(p => ({ p, label: '補貨中' })),
    ...upcoming.map(p => ({ p, label: '即將推出' })),
  ];
  if (comingWrap) {
    comingWrap.innerHTML = others.length ? `
      <div class="shop-coming-row">
        <span class="shop-coming-label">其他品項</span>
        <div class="shop-coming-cards">
          ${others.map(({ p, label }) => `
            <a class="shop-coming-card" href="/products/${esc(p.id)}">
              <div class="shop-coming-img ${esc(p.flavor)}-bg">
                <img src="${esc(p.image)}" alt="${esc(p.alt || p.name)}" loading="lazy" data-hide-broken />
                <div class="shop-coming-overlay">
                  <span class="pf-badge coming">${label}</span>
                </div>
              </div>
              <p class="shop-coming-name">${esc(p.name)}</p>
            </a>
          `).join('')}
        </div>
      </div>` : '';
  }

  // Scroll reveal for shop cards
  const shopObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); shopObs.unobserve(e.target); }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.shop-card.reveal').forEach(el => shopObs.observe(el));
}

// ─── 數量選擇 ──────────────────────────────
function changeQty(id, delta) {
  const p = PRODUCTS.find(x => x.id === id);
  localQty[id] = Math.max(1, Math.min(p.stock, (localQty[id] || 1) + delta));
  const el = document.getElementById(`qty-${id}`);
  if (el) el.textContent = localQty[id];
}

// ─── 購物車操作 ────────────────────────────
// ─── GA4 電商事件（看商品 → 加購物車 → 開始結帳 → 購買）──
function gaEvent(name, items, extra = {}) {
  if (typeof gtag !== 'function' || !items.length) return;
  gtag('event', name, {
    currency: 'TWD',
    value: items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0),
    items,
    ...extra,
  });
}
const gaItem = (p, qty) => ({ item_id: p.id, item_name: p.name, price: p.price || 0, quantity: qty });

function addToCart(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product?.available) return;
  const qty = localQty[productId] || 1;
  gaEvent('add_to_cart', [gaItem(product, qty)]);
  const existing = cart.find(i => i.id === productId);
  if (existing) {
    existing.qty = Math.min(product.stock, existing.qty + qty);
  } else {
    cart.push({ id: productId, qty });
  }
  saveCart(); updateCartUI(); openCartDrawer();

  // Button feedback
  const btn = document.querySelector(`.add-cart-btn[data-id="${productId}"]`);
  if (btn) {
    btn.textContent = '已加入 ✓';
    btn.style.cssText = 'background:var(--sage);border-color:var(--sage)';
    setTimeout(() => { btn.textContent = '加入購物車'; btn.style.cssText = ''; }, 1600);
  }
  // Toast notification
  if (typeof showToast === 'function') showToast(`${product.name} 已加入購物車`);
  // Cart badge pulse
  const badge = document.getElementById('navCartCount');
  if (badge) {
    badge.classList.remove('pulse');
    void badge.offsetWidth; // force reflow
    badge.classList.add('pulse');
    badge.addEventListener('animationend', () => badge.classList.remove('pulse'), { once: true });
  }
}

function removeFromCart(id) {
  const gone = cart.find(i => i.id === id);
  const p = PRODUCTS.find(x => x.id === id);
  if (gone && p) gaEvent('remove_from_cart', [gaItem(p, gone.qty)]);
  cart = cart.filter(i => i.id !== id);
  saveCart(); updateCartUI();
}

function adjustCartQty(id, delta) {
  const item = cart.find(i => i.id === id);
  const product = PRODUCTS.find(p => p.id === id);
  if (!item || !product) return;
  item.qty = Math.max(1, Math.min(product.stock, item.qty + delta));
  saveCart(); updateCartUI();
}

function saveCart()  { localStorage.setItem('sf_cart', JSON.stringify(cart)); }
function getTotal()  { return cart.reduce((s,i) => { const p = PRODUCTS.find(x=>x.id===i.id); return s+(p?p.price*i.qty:0); }, 0); }
function getCount()  { return cart.reduce((s,i) => s+i.qty, 0); }

// ─── 購物車 UI ─────────────────────────────
function updateCartUI() {
  const count = getCount();
  const badge = document.getElementById('navCartCount');
  if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'flex' : 'none'; }
  const hd = document.getElementById('cartItemCount');
  if (hd) hd.textContent = `(${count})`;
  const sub = document.getElementById('cartSubtotal');
  if (sub) sub.textContent = `NT$ ${getTotal().toLocaleString()}`;
  // 運費規則直接寫出來，不要讓客人等到結帳才知道
  document.querySelectorAll('.cart-shipping-note').forEach(el => { el.textContent = shippingNote(); });

  const body   = document.getElementById('cartDrawerBody');
  const footer = document.getElementById('cartDrawerFooter');
  if (!body) return;

  if (cart.length === 0) {
    body.innerHTML = `
      <div class="cart-empty">
        <svg width="52" height="52" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 8h5l4 20h18l4-16H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="20" cy="36" r="2" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="32" cy="36" r="2" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        <p>購物車是空的</p>
        <a class="btn btn-outline" href="/shop" data-act="keep-shopping">繼續選購</a>
      </div>`;
    if (footer) footer.style.display = 'none';
    return;
  }
  if (footer) footer.style.display = 'block';

  body.innerHTML = cart.map(item => {
    const p = PRODUCTS.find(x => x.id === item.id);
    if (!p) return '';
    return `
      <div class="cart-item">
        <div class="cart-item-img ${esc(p.flavor)}-bg">
          <img src="${esc(p.image)}" alt="${esc(p.name)}" data-hide-broken />
        </div>
        <div class="cart-item-info">
          <p class="cart-item-name">${esc(p.name)}</p>
          <p class="cart-item-price">NT$ ${esc(p.price)}</p>
          <div class="cart-item-qty">
            <button class="qty-btn-sm" data-act="cqty" data-id="${esc(p.id)}" data-d="-1" aria-label="減少 ${esc(p.name)} 數量">−</button>
            <span>${item.qty}</span>
            <button class="qty-btn-sm" data-act="cqty" data-id="${esc(p.id)}" data-d="1" aria-label="增加 ${esc(p.name)} 數量">+</button>
          </div>
        </div>
        <div class="cart-item-side">
          <button class="cart-remove-btn" data-act="rm" data-id="${esc(p.id)}" aria-label="移除 ${esc(p.name)}">✕</button>
          <span class="cart-item-total">NT$ ${(p.price*item.qty).toLocaleString()}</span>
        </div>
      </div>`;
  }).join('');
}

// ─── 購物車 Drawer ─────────────────────────
function openCartDrawer() {
  setInert('cartDrawer', false);
  document.getElementById('cartDrawer')?.classList.add('open');
  document.getElementById('cartOverlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  updateCartUI();
  ensureProducts().then(updateCartUI);
  focusDialog(document.getElementById('cartDrawer'));
}
function closeCartDrawer() {
  document.getElementById('cartDrawer')?.classList.remove('open');
  document.getElementById('cartOverlay')?.classList.remove('open');
  setInert('cartDrawer', true);
  document.body.style.overflow = '';
  restoreFocus();
}

// ─── 對話框鍵盤操作：Esc 關閉、Tab 鎖在框內、關閉後焦點回到原本的按鈕 ──
let dialogOpener = null;
const setInert = (id, v) => { const el = document.getElementById(id); if (el) el.inert = v; };
const openDialog = () => document.querySelector('#checkoutOverlay.open .checkout-modal') || document.querySelector('#cartDrawer.open');
function focusDialog(el) {
  if (!dialogOpener) dialogOpener = document.activeElement;
  el?.querySelector('button')?.focus();
}
function restoreFocus() {
  if (openDialog()) return;
  if (dialogOpener && document.contains(dialogOpener)) dialogOpener.focus();
  dialogOpener = null;
}
document.addEventListener('keydown', e => {
  // 付款方式卡片：Enter／空白鍵選取
  const pay = e.target.closest?.('.co2-pay');
  if (pay && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    if (!pay.classList.contains('off')) selectPay(pay.id.replace('pay_', ''));
    return;
  }
  const d = openDialog();
  if (!d) return;
  if (e.key === 'Escape') { d.id === 'cartDrawer' ? closeCartDrawer() : closeCheckout(); return; }
  if (e.key !== 'Tab') return;
  const f = [...d.querySelectorAll('a[href], button:not([disabled]), input, textarea, [tabindex="0"]')].filter(x => x.offsetParent);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!d.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
});

// ─── 結帳 Modal ────────────────────────────
async function openCheckout() {
  await ensureProducts();
  gaEvent('begin_checkout', cart.map(i => {
    const p = PRODUCTS.find(x => x.id === i.id);
    return p ? gaItem(p, i.qty) : null;
  }).filter(Boolean));
  appliedDiscount = null;
  closeCartDrawer();
  const cfg = await fetch('/api/checkout-config').then(r => r.json()).catch(() => null);
  if (cfg && cfg.pay) PAYCFG = cfg;
  renderCheckoutForm();
  tsMount(document.getElementById('coTurnstile'), PAYCFG.turnstile);
  setInert('checkoutOverlay', false);
  document.getElementById('checkoutOverlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  focusDialog(document.querySelector('.checkout-modal'));
}
function closeCheckout() {
  document.getElementById('checkoutOverlay')?.classList.remove('open');
  setInert('checkoutOverlay', true);
  document.body.style.overflow = '';
  restoreFocus();
}

function renderCheckoutForm() {
  const wrap = document.getElementById('checkoutContent');
  if (!wrap) return;
  const rows = cart.map(item => {
    const p = PRODUCTS.find(x => x.id === item.id);
    return `<div class="co2-line"><span>${esc(p.name)} × ${item.qty}</span><span class="r">NT$ ${(p.price*item.qty).toLocaleString()}</span></div>`;
  }).join('');

  const icoTruck = `<svg viewBox="0 0 24 24"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>`;
  const icoStore = `<svg viewBox="0 0 24 24"><path d="M4 9l1.5-4h13L20 9M4 9h16v2a2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0zM5 12v8h14v-8M10 20v-5h4v5"/></svg>`;
  const icoUser  = `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  const icoCard  = `<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></svg>`;
  const icoLock  = `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
  const icoBank  = `<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5M5 9v9M9.500 9v9M14.500 9v9M19 9v9M3 20h18"/></svg>`;
  const payOpt = (id, ico, title, desc, brands, off = !payOn(id)) => `
        <div class="co2-pay${off ? ' off' : ''}" id="pay_${id}" ${off ? 'aria-disabled="true" tabindex="-1"' : `data-act="pay" data-v="${id}" tabindex="0"`} role="radio" aria-checked="false">
          <span class="radio"></span><span class="pico">${ico}</span>
          <div class="pt"><div class="t">${title}</div><div class="d">${off ? (id === 'line_pay' ? '即將開放' : '暫時無法使用') : desc}</div></div>
          <span class="brands">${brands.map(b => `<img src="/images/payment-icons/${b}.svg" alt="${b}" height="22" />`).join('')}</span>
        </div>`;
  const icoDoc   = `<svg viewBox="0 0 24 24"><path d="M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1z"/><path d="M9 8h6M9 12h6"/></svg>`;

  wrap.innerHTML = `
    <div class="co-success" id="coSuccess" style="display:none">
      <div class="co-success-icon">✓</div>
      <h3>訂單已成立！</h3>
      <p class="co-order-id" id="coOrderId"></p>
      <div class="co-bank-info" id="coBankInfo"></div>
      <button class="btn" data-act="close-co">繼續逛逛</button>
    </div>

    <div id="coForm" class="co2">
      <svg class="co2-deco" viewBox="0 0 300 300" aria-hidden="true">
        <defs>
          <radialGradient id="co2p1" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#F6D9C4"/><stop offset=".6" stop-color="#EEC2A9"/><stop offset="1" stop-color="#E7B39A" stop-opacity="0"/></radialGradient>
          <radialGradient id="co2p2" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#F3CDB6"/><stop offset="1" stop-color="#E9B69C" stop-opacity="0"/></radialGradient>
          <linearGradient id="co2lf" x1="0" x2="1"><stop offset="0" stop-color="#C9CDA6"/><stop offset="1" stop-color="#A9B492" stop-opacity=".2"/></linearGradient>
        </defs>
        <circle cx="150" cy="120" r="105" fill="url(#co2p1)"/><circle cx="205" cy="200" r="70" fill="url(#co2p2)"/>
        <path d="M118 62c-30-40-80-38-96-10 22 8 52 30 96 10z" fill="url(#co2lf)"/>
      </svg>

      <!-- 配送方式 -->
      <div class="co2-sec">
        <div class="co2-sh">${icoTruck}<h3>配送方式</h3><span class="help">選擇最適合的配送方式</span></div>
        <div class="co2-choices">
          <button type="button" class="co2-opt" id="shipHome" data-act="ship" data-v="home" aria-pressed="false">
            ${icoTruck}<div><div class="t">宅配到府 <span class="fee">+ NT$${SHIPPING.home.fee}</span></div><div class="s">1–2 個工作天送達</div></div><span class="radio"></span>
          </button>
          <button type="button" class="co2-opt" id="shipCvs" data-act="ship" data-v="cvs" aria-pressed="false">
            ${icoStore}<div><div class="t">超商取貨 <span class="fee">+ NT$${SHIPPING.cvs.fee}</span></div><div class="s">2–3 個工作天送達</div></div><span class="radio"></span>
          </button>
        </div>
        <div class="co2-cvs" id="cvsBox" style="display:none">
          <div class="co2-choices">
            <button type="button" class="co2-opt center" id="brand711" data-act="cvs" data-v="711"><div class="t">7-ELEVEN</div><span class="radio"></span></button>
            <button type="button" class="co2-opt center" id="brandFm" data-act="cvs" data-v="fm"><div class="t">全家 FamilyMart</div><span class="radio"></span></button>
          </div>
          <div class="co2-row"><label for="coStore">取貨門市<span class="req" aria-hidden="true">*</span></label><input type="text" id="coStore" placeholder="例：信義門市" aria-required="true" /></div>
        </div>
      </div>

      <!-- 收件資料 -->
      <div class="co2-sec">
        <div class="co2-sh">${icoUser}<h3>收件資料</h3><span class="help">請填寫收件資訊</span></div>
        <div class="co2-row"><label for="coName">姓名<span class="req" aria-hidden="true">*</span></label><input type="text" id="coName" placeholder="收件人姓名" autocomplete="name" aria-required="true" /></div>
        <div class="co2-row"><label for="coPhone">電話<span class="req" aria-hidden="true">*</span></label><input type="tel" id="coPhone" placeholder="09xx-xxx-xxx" inputmode="tel" autocomplete="tel" aria-required="true" /></div>
        <div class="co2-row"><label for="coEmail">電子信箱<span class="req" aria-hidden="true">*</span></label><input type="email" id="coEmail" placeholder="example@email.com" inputmode="email" autocomplete="email" aria-required="true" /></div>
        <div class="co2-row" id="addrRow"><label for="coAddress">收件地址<span class="req" aria-hidden="true">*</span></label><input type="text" id="coAddress" placeholder="縣市、鄉鎮區、路名、門號" autocomplete="street-address" aria-required="true" /></div>
        <div class="co2-row top"><label for="coNote">備註 <small>(選填)</small></label><textarea id="coNote" rows="2" placeholder="如有特殊需求..."></textarea></div>
      </div>

      <!-- 付款方式 -->
      <div class="co2-sec">
        <div class="co2-sh">${icoCard}<h3>付款方式</h3><span class="help lock">${icoLock}交易由綠界科技 ECPay 安全處理</span></div>
        ${payOpt('credit_card', icoCard, '信用卡 / Apple Pay', '線上安全付款，付款完成後訂單自動確認', ['visa','mastercard','jcb','apple-pay'])}
        ${payOpt('line_pay', '<img src="/images/payment-icons/line-pay.svg" width="32" height="32" alt="LINE Pay" />', 'LINE Pay', '使用 LINE Pay 付款，快速又方便', [], !payOn('line_pay'))}
        ${payOpt('ecpay_atm', icoBank, 'ATM 虛擬帳號', '系統將產生專屬繳費帳號，付款完成後自動確認', [])}
        ${payOpt('ecpay_cvs', icoStore, '超商代碼', '取得繳費代碼後，可至支援的便利商店完成付款', ['7-eleven','familymart','hilife','okmart'])}
        ${payOpt('bank_transfer', icoBank, '銀行轉帳（一般帳戶）', '顯示本公司銀行帳號，轉帳後由系統確認（約 1–3 個工作天）', [])}
        <div class="co2-row" id="bank5Row" style="margin-top:.9rem"><label for="coBank5">匯款後五碼 <small>(選填)</small></label>
          <input type="text" id="coBank5" inputmode="numeric" maxlength="5" placeholder="例：12345（方便核對付款）" /></div>
      </div>

      <!-- 訂單明細 -->
      <div class="co2-sec last">
        <div class="co2-sh">${icoDoc}<h3>訂單明細</h3></div>
        ${rows}
        <div class="co2-disc">
          <input type="text" id="coDiscount" placeholder="折扣碼（選填）" autocomplete="off" />
          <button type="button" data-act="disc">套用</button>
        </div>
        <p class="co2-disc-msg" id="coDiscountMsg" role="status" aria-live="polite"></p>
        <div class="co2-line disc" id="coDiscountLine" style="display:none"><span id="coDiscountLabel">折扣</span><span class="r" id="coDiscountAmt">-NT$ 0</span></div>
        <div class="co2-line muted"><span id="coShipLabel">宅配運費</span><span class="r" id="coShipAmt">NT$ 0</span></div>
        <div class="co2-total"><span class="l">合計</span><span class="r" id="coTotalAmt">NT$ 0</span></div>
      </div>

      <div id="coTurnstile"></div>
      <p id="coError" class="co2-err" role="alert"></p>
      <p class="co2-legal">本產品為手工食品，恕不適用七日鑑賞期。<br>送出訂單即表示您已閱讀並同意
        <a href="/terms" target="_blank" rel="noopener">服務條款</a>與<a href="/privacy" target="_blank" rel="noopener">隱私權政策</a>。</p>
      <button class="co2-submit" id="submitOrderBtn" data-act="submit">前往付款 →</button>
      <div class="co2-foot">GOOD FRUIT　A BRIGHTER DAY</div>
    </div>`;

  selectPay('credit_card');
  setShip(shipMethod);
}

// ─── 配送方式 ──────────────────────────────
function setShip(method) {
  shipMethod = SHIPPING[method] ? method : 'home';
  [['shipHome', 'home'], ['shipCvs', 'cvs']].forEach(([id, m]) => {
    const el = document.getElementById(id);
    el?.classList.toggle('on', shipMethod === m);
    el?.setAttribute('aria-pressed', shipMethod === m);
  });
  const cvsBox = document.getElementById('cvsBox');
  const addrRow = document.getElementById('addrRow');
  if (cvsBox) cvsBox.style.display = shipMethod === 'cvs' ? 'block' : 'none';
  if (addrRow) addrRow.style.display = shipMethod === 'home' ? 'grid' : 'none';
  setCvsBrand(cvsBrand);
  updateCheckoutTotal();
}
function setCvsBrand(brand) {
  cvsBrand = brand === 'fm' ? 'fm' : '711';
  [['brand711', '711'], ['brandFm', 'fm']].forEach(([id, b]) => {
    const el = document.getElementById(id);
    el?.classList.toggle('on', cvsBrand === b);
    el?.setAttribute('aria-pressed', cvsBrand === b);
  });
  const s = document.getElementById('coStore');
  if (s) s.placeholder = cvsBrand === '711' ? '例：信義門市（7-ELEVEN）' : '例：板橋文化門市（全家）';
}
function shippingFee() { return (SHIPPING[shipMethod] || SHIPPING.home).fee; }

const ARROW_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const submitLabel = () => {
  const total = `NT$${(getTotal() - (appliedDiscount ? appliedDiscount.amount : 0) + shippingFee()).toLocaleString()}`;
  return (selectedPayment === 'bank_transfer' ? `確認訂購 ${total} ` : `前往付款 ${total} `) + ARROW_SVG;
};

function selectPay(method) {
  if (!payOn(method)) method = PAY_ORDER.find(payOn) || '';   // 停用的選項按不下去；全部停用就沒有選中項
  selectedPayment = method;
  PAY_ORDER.forEach(id => {
    const el = document.getElementById('pay_' + id);
    el?.classList.toggle('on', id === selectedPayment);
    el?.setAttribute('aria-checked', id === selectedPayment);
  });
  const b5 = document.getElementById('bank5Row');
  if (b5) b5.style.display = selectedPayment === 'bank_transfer' ? '' : 'none';
  const btn = document.getElementById('submitOrderBtn');
  if (btn && !btn.disabled) btn.innerHTML = submitLabel();
}

// ─── 折扣碼 ────────────────────────────────
// 折扣碼交給伺服器判斷（/api/cart/quote），前端只顯示結果
async function applyDiscount() {
  const input = document.getElementById('coDiscount');
  const msg = document.getElementById('coDiscountMsg');
  const code = input ? input.value.trim() : '';
  appliedDiscount = null;
  if (msg) msg.textContent = '';
  if (code) {
    try {
      const res = await fetch('/api/cart/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart.map(i => ({ product_id: i.id, qty: i.qty })), shipping_method: shipMethod, coupon: code }),
      });
      const q = await res.json().catch(() => ({}));
      if (!res.ok || !q.ok) throw new Error(q.error || '暫時無法確認折扣碼');
      if (q.coupon_error) throw new Error(q.coupon_error);
      appliedDiscount = { code: q.coupon.code, label: q.coupon.label, influencer: q.coupon.influencer, amount: q.discount };
      const tag = q.coupon.influencer ? `（網紅：${q.coupon.influencer}）` : '';
      if (msg) { msg.textContent = `已套用 ${q.coupon.code} ${q.coupon.label}${tag}，折抵 NT$${q.discount}`; msg.style.color = '#5E7048'; }
    } catch (e) {
      if (msg) { msg.textContent = e.message; msg.style.color = ERR_COLOR; }
    }
  }
  updateCheckoutTotal();
}

function updateCheckoutTotal() {
  const subtotal = getTotal();
  const amt = appliedDiscount ? appliedDiscount.amount : 0;
  const line = document.getElementById('coDiscountLine');
  if (line) {
    line.style.display = appliedDiscount ? 'flex' : 'none';
    const lbl = document.getElementById('coDiscountLabel');
    const a = document.getElementById('coDiscountAmt');
    if (appliedDiscount && lbl) lbl.textContent = `折扣（${appliedDiscount.label}）`;
    if (a) a.textContent = `-NT$ ${amt.toLocaleString()}`;
  }
  const fee = shippingFee();
  const sl = document.getElementById('coShipLabel');
  const sa = document.getElementById('coShipAmt');
  if (sl) sl.textContent = (SHIPPING[shipMethod] || SHIPPING.home).label;
  if (sa) sa.textContent = `NT$ ${fee.toLocaleString()}`;
  const tot = document.getElementById('coTotalAmt');
  if (tot) tot.textContent = `NT$ ${(subtotal - amt + fee).toLocaleString()}`;
  const sb = document.getElementById('submitOrderBtn');
  if (sb && !sb.disabled) sb.innerHTML = submitLabel();
}

// ─── 送出訂單：全部送到 /api/checkout，金額由伺服器重算 ──
async function submitOrder() {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const showErr = (m) => { const e = document.getElementById('coError'); if (e) { e.textContent = m; e.style.display = 'block'; } };
  const e0 = document.getElementById('coError'); if (e0) e0.style.display = 'none';
  if (!selectedPayment) { showErr('目前暫停線上付款，請 IG 私訊 @seasonflavor_ 協助下單。'); return; }

  // 先在前端擋明顯填錯的欄位；伺服器會再檢查一次
  let firstBad = '', firstEl = null;
  // 填錯的欄位：框線變色、標記 aria-invalid，游標移到第一個錯誤欄位
  const mark = (id, bad, msg) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.borderColor = bad ? ERR_COLOR : '';
    el.setAttribute('aria-invalid', bad);
    if (bad && !firstBad) { firstBad = msg; firstEl = el; }
  };
  ['coName', 'coPhone', 'coEmail', shipMethod === 'cvs' ? 'coStore' : 'coAddress'].forEach(id => mark(id, !val(id), '請填寫所有必填欄位'));
  if (val('coEmail') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('coEmail'))) mark('coEmail', true, 'Email 格式不正確，請確認（例：name@example.com）');
  if (val('coPhone') && !/^09\d{8}$/.test(val('coPhone').replace(/[-\s]/g, ''))) mark('coPhone', true, '手機號碼格式不正確（請填 09 開頭共 10 碼）');
  if (shipMethod === 'home' && val('coAddress') && val('coAddress').length < 5) mark('coAddress', true, '收件地址請填完整（縣市、路名、門號）');
  if (firstBad) { showErr(firstBad); firstEl?.focus(); return; }

  const btn = document.getElementById('submitOrderBtn');
  if (btn) { btn.disabled = true; btn.textContent = '送出中…'; }
  const turnstileToken = await tsToken();
  if (TS.key && !turnstileToken) {
    showErr('正在進行安全驗證，請完成上方驗證後再按一次。');
    if (btn) { btn.disabled = false; btn.innerHTML = submitLabel(); }
    return;
  }
  gaEvent('add_payment_info', cart.map(i => { const p = PRODUCTS.find(x => x.id === i.id); return p ? gaItem(p, i.qty) : null; }).filter(Boolean), { payment_type: selectedPayment });

  let out;
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: selectedPayment,
        items: cart.map(i => ({ product_id: i.id, qty: i.qty })),
        coupon: appliedDiscount ? appliedDiscount.code : '',
        name: val('coName'), phone: val('coPhone'), email: val('coEmail'),
        ship: shipMethod, cvs_brand: cvsBrand, store: val('coStore'), address: val('coAddress'),
        note: val('coNote'), bank5: val('coBank5'), turnstile: turnstileToken,
      }),
    });
    out = await res.json().catch(() => ({}));
    // 4xx 帶 error 是客人可以自己改的原因（庫存不足、欄位錯誤），直接顯示；其他算系統問題
    tsReset();   // 驗證碼只能用一次
    if (!res.ok || !out.ok) throw Object.assign(new Error(out.error || ''), { show: res.status < 500 && !!out.error });
  } catch (err) {
    // 送單失敗：不清購物車、不顯示成功，不給客人看技術字串
    showErr(err.show ? err.message : '系統忙碌中，訂單沒有送出。請稍後再試，或 IG 私訊 @seasonflavor_ 協助下單。');
    if (btn) { btn.disabled = false; btn.innerHTML = submitLabel(); }
    return;
  }

  // 綠界：瀏覽器 POST 到綠界付款頁
  if (out.action) {
    try { sessionStorage.setItem('sf_ga_' + out.order_id, JSON.stringify(out.ga || {})); } catch {}
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = out.action;
    Object.entries(out.params).forEach(([k, v]) => {
      const inp = document.createElement('input');
      inp.type = 'hidden'; inp.name = k; inp.value = v;
      form.appendChild(inp);
    });
    document.body.appendChild(form);
    // 客人從綠界按「上一頁」回來時（bfcache 還原），按鈕要恢復可按
    addEventListener('pageshow', e => { if (e.persisted && btn) { btn.disabled = false; btn.innerHTML = submitLabel(); } }, { once: true });
    form.submit();
    return;
  }

  // 銀行轉帳：訂單已成立（待付款）。GA4 purchase 等人工確認收款後才算，這裡不送
  cart = []; saveCart(); updateCartUI();
  showBankInfo(out);
}

function showBankInfo(o) {
  const b = o.bank || {};
  const row = (k, v, extra = '') => v ? `<div class="pi-row"><span class="k">${k}</span><span class="v">${esc(v)}</span>${extra}</div>` : '';
  const acct = String(b.account || '').replace(/(\d{4})(?=\d)/g, '$1 ');
  const items = (o.items || []).map(i => `<div class="pi-item">${i.image ? `<img src="${esc(i.image)}" alt="" width="52" height="52" />` : ''}<div><div class="n">${esc(i.name)}</div><div class="q">NT$${i.price.toLocaleString()} × ${i.qty}</div></div><span class="r">NT$${(i.price * i.qty).toLocaleString()}</span></div>`).join('');
  const step = (n, t) => `<div class="pi-step"><span>${n}</span>${t}</div>`;
  document.getElementById('coForm').style.display = 'none';
  const box = document.getElementById('coSuccess');
  box.style.display = 'block';
  box.className = 'co-success pi';
  box.innerHTML = `
    <h3 class="pi-h">銀行轉帳付款資訊</h3>
    <p class="pi-sub">訂單編號 ${esc(o.order_id)}｜請於 3 天內完成轉帳，確認後會更新訂單狀態</p>
    <div class="pi-card">
      ${row('銀行名稱', b.name)}${row('銀行代碼', b.code)}${row('分行名稱', b.branch)}${row('戶名', b.holder)}
      ${row('銀行帳號', acct, '<button type="button" class="pi-copy" id="piCopy">複製帳號</button>')}
    </div>
    <div class="pi-warn"><b>請於 ${esc(o.deadline)} 前完成轉帳</b><br>轉帳金額 NT$${o.total.toLocaleString()}。轉帳後由我們確認收款，約 1–3 個工作天。</div>
    <h4 class="pi-t">訂單資訊</h4>
    ${items}
    <div class="co2-line muted"><span>運費</span><span class="r">NT$${o.shipping.toLocaleString()}</span></div>
    ${o.discount ? `<div class="co2-line disc"><span>折扣</span><span class="r">-NT$${o.discount.toLocaleString()}</span></div>` : ''}
    <div class="co2-total"><span class="l">應付金額</span><span class="r">NT$${o.total.toLocaleString()}</span></div>
    <h4 class="pi-t">轉帳完成後</h4>
    ${step(1, '於您的網銀或 ATM 完成轉帳')}${step(2, '我們進行對帳（約 1–3 個工作天）')}${step(3, '確認後會寄送訂單確認 Email')}
    <a class="co2-submit ghost" href="/order-status?order=${encodeURIComponent(o.order_id)}">查看訂單</a>
    <button type="button" class="pi-link" data-act="close-co">繼續逛逛</button>`;
  document.getElementById('piCopy')?.addEventListener('click', e => {
    navigator.clipboard?.writeText(String(b.account || '')).then(() => { e.target.textContent = '已複製'; });
  });
}

// 綠界付款導回後，向伺服器確認「真的已入帳」才送 GA4 purchase；同一筆訂單只送一次
async function trackPurchase(orderId) {
  if (!orderId || typeof gtag !== 'function') return;
  let sent = [];
  try { sent = JSON.parse(localStorage.getItem('sf_ga_purchase') || '[]'); } catch {}
  if (sent.includes(orderId)) return;
  for (let i = 0; i < 4; i++) {   // 綠界通知可能比瀏覽器晚幾秒到
    const r = await fetch('/api/order-paid?order=' + encodeURIComponent(orderId)).then(x => x.json()).catch(() => ({}));
    if (r.paid) {
      // 金額與品項用結帳當下存在這個分頁的資料；伺服器只回答有沒有付款
      let ga = null;
      try { ga = JSON.parse(sessionStorage.getItem('sf_ga_' + orderId) || 'null'); } catch {}
      if (!ga || !Array.isArray(ga.items)) return;
      gtag('event', 'purchase', { transaction_id: orderId, value: ga.total, currency: 'TWD', items: ga.items });
      try { sessionStorage.removeItem('sf_ga_' + orderId); } catch {}
      try { localStorage.setItem('sf_ga_purchase', JSON.stringify([...sent, orderId].slice(-20))); } catch {}
      return;
    }
    await new Promise(res => setTimeout(res, 2500));
  }
}

// ─── 初始化 ────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 綠界付款完成導回：/shop?pay=ok|fail&order=SFxxxx（僅顯示用，入帳以綠界 server 通知為準）
  const ret = new URLSearchParams(location.search);
  if (['ok', 'fail', 'info'].includes(ret.get('pay'))) {
    const ok = ret.get('pay') !== 'fail';
    if (ok) { cart = []; saveCart(); }
    const bar = document.createElement('div');
    bar.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9999;padding:1rem 1.2rem;text-align:center;color:#fff;font-size:.95rem;background:${ok ? 'var(--sage,#7A8B6F)' : 'var(--orange,#C8743F)'}`;
    const order = /^SF\d{6}-?[A-Z0-9]{6}$/i.test(ret.get('order') || '') ? ret.get('order') : '';
    bar.textContent = ret.get('pay') === 'info'
      ? `已取得繳費資訊，訂單編號 ${order}。請於期限內完成繳費，付款確認後我們會盡快出貨。`
      : ok
      ? `付款完成，訂單編號 ${order}。確認入帳後我們會盡快為您出貨。`
      : '付款未完成，購物車已保留，可重新結帳或改用銀行轉帳。';
    bar.setAttribute('role', 'status');
    // 有訂單編號就附上查詢連結（ATM／超商的繳費帳號、代碼在那裡看得到）
    if (ok && order) {
      const a = document.createElement('a');
      a.href = '/order-status?order=' + encodeURIComponent(order);
      a.textContent = ret.get('pay') === 'info' ? '查看繳費資訊' : '查看訂單';
      a.style.cssText = 'color:#fff;text-decoration:underline;margin-left:.5em;white-space:nowrap';
      bar.appendChild(a);
    }
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), ret.get('pay') === 'info' ? 60000 : 12000);
    if (ret.get('pay') === 'ok') trackPurchase(order);
    history.replaceState(null, '', location.pathname);
  }
  // 商品相關頁面先抓 D1 即時庫存再渲染；首頁、關於等頁面只顯示購物車數量，不用等商品資料
  if (/^\/(shop|products|cart)/.test(location.pathname)) {
    await ensureProducts();
    renderShop();
  }
  updateCartUI();

  // 商品頁 /products/<id>：送 GA4 看商品事件
  const viewing = location.pathname.match(/^\/products\/([a-z0-9-]+)$/);
  const viewed = viewing && PRODUCTS.find(p => p.id === viewing[1]);
  if (viewed) gaEvent('view_item', [gaItem(viewed, 1)]);
  // 商品列表（線上訂購、果醬系列）
  if (location.pathname === '/shop' || location.pathname === '/products/') {
    gaEvent('view_item_list', PRODUCTS.filter(p => p.price != null).map(p => gaItem(p, 1)), { item_list_name: location.pathname === '/shop' ? '線上訂購' : '果醬系列' });
  }

  // 購物車、結帳視窗的對話框語意（每頁 HTML 都有一份，在這裡統一補）
  const drawer = document.getElementById('cartDrawer');
  if (drawer) { drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-label', '購物車'); drawer.inert = true; }
  const modal = document.querySelector('.checkout-modal');
  if (modal) { modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', '確認訂單'); setInert('checkoutOverlay', true); }
  document.getElementById('cartDrawerClose')?.setAttribute('aria-label', '關閉購物車');
  document.getElementById('checkoutCloseBtn')?.setAttribute('aria-label', '關閉結帳');

  document.getElementById('navCartBtn')?.addEventListener('click', openCartDrawer);
  document.getElementById('cartDrawerClose')?.addEventListener('click', closeCartDrawer);
  document.getElementById('cartOverlay')?.addEventListener('click', closeCartDrawer);
  document.getElementById('goCheckoutBtn')?.addEventListener('click', openCheckout);
  document.getElementById('checkoutCloseBtn')?.addEventListener('click', closeCheckout);
  document.getElementById('checkoutOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'checkoutOverlay') closeCheckout();
  });
});

// ─── Cloudflare Turnstile（防機器人）──────────
// 後台設了 TURNSTILE_SITE_KEY 才啟用。用「需要時才出現」模式：一般客人看不到，可疑流量才會跳出驗證
const TS = { key: '', id: null, token: '', loading: null };
function tsLoad() {
  return TS.loading || (TS.loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.addEventListener('load', resolve);
    s.addEventListener('error', () => { TS.loading = null; reject(new Error('turnstile')); });
    document.head.appendChild(s);
  }));
}
async function tsMount(box, key) {
  if (key) TS.key = key;
  if (!TS.key || !box) return;
  try { await tsLoad(); } catch { return; }
  if (TS.id !== null) { try { turnstile.remove(TS.id); } catch {} }
  TS.token = '';
  TS.id = turnstile.render(box, {
    sitekey: TS.key, appearance: 'interaction-only', language: 'zh-tw',
    callback: (t) => { TS.token = t; },
    'expired-callback': () => { TS.token = ''; },
    'error-callback': () => { TS.token = ''; },
  });
}
// 等驗證完成（最多 10 秒）；沒啟用時回空字串
async function tsToken() {
  if (!TS.key) return '';
  for (let i = 0; i < 40 && !TS.token; i++) await new Promise((r) => setTimeout(r, 250));
  return TS.token;
}
function tsReset() {
  TS.token = '';
  if (TS.id !== null && window.turnstile) { try { turnstile.reset(TS.id); } catch {} }
}

// ─── 按鈕事件：一律用 data-act 委派，不用 onclick 屬性（網站安全政策 CSP 不允許行內程式碼）──
const ACTIONS = {
  qty: (el) => changeQty(el.dataset.id, Number(el.dataset.d)),
  add: (el) => addToCart(el.dataset.id),
  cqty: (el) => adjustCartQty(el.dataset.id, Number(el.dataset.d)),
  rm: (el) => removeFromCart(el.dataset.id),
  'close-co': () => closeCheckout(),
  ship: (el) => setShip(el.dataset.v),
  cvs: (el) => setCvsBrand(el.dataset.v),
  disc: () => applyDiscount(),
  submit: () => submitOrder(),
  pay: (el) => selectPay(el.dataset.v),
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  // 購物車空的時候「繼續選購」：有抽屜就關抽屜，沒有就照連結走
  if (el.dataset.act === 'keep-shopping') {
    if (document.getElementById('cartDrawer')) { e.preventDefault(); closeCartDrawer(); }
    return;
  }
  if (ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el);
});
// 匯款後五碼只留數字
document.addEventListener('input', (e) => {
  if (e.target.id === 'coBank5') e.target.value = e.target.value.replace(/[^0-9]/g, '');
});
// 商品圖載入失敗就隱藏（取代 onerror 屬性）
document.addEventListener('error', (e) => {
  if (e.target.matches?.('img[data-hide-broken]')) e.target.style.opacity = '0';
}, true);
