// ============================================
// 肆菓 Season Flavor — Shop & Cart
// ============================================
// 資料結構已對齊 Airtable 欄位。
// 【安全版】訂單改送到 /order（Cloudflare Pages Function），
// Airtable token 藏在伺服器端，前端不再持有金鑰。

// ─── 商品資料 ─────────────────────────────
const PRODUCTS = [
  {
    id: 'strawberry',
    name: '草莓果醬',
    description: '溫柔的酸與甜，像是春天剛開始的感覺',
    price: 150,
    stock: 20,
    image: 'images/strawberry.jpg',
    available: true,
    flavor: 'strawberry',
  },
  {
    id: 'mixed-berry',
    name: '綜合野莓果醬',
    description: '深邃的果香，帶著一點點神秘的尾韻',
    price: 170,
    stock: 15,
    image: 'images/mixed-berry.jpg',
    available: true,
    flavor: 'berry',
  },
  {
    id: 'kiwi',
    name: '奇異果果醬',
    description: '清爽帶勁的綠意，讓人精神一振的酸甜',
    price: null,
    stock: 0,
    image: 'images/kiwi.jpg',
    available: false,
    flavor: 'kiwi',
  },
  {
    id: 'peach',
    name: '水蜜桃果醬',
    description: '多汁飽滿，是夏天最讓人期待的一種甜',
    price: null,
    stock: 0,
    image: 'images/peach.jpg',
    available: false,
    flavor: 'peach',
  },
];

// ─── 狀態 ──────────────────────────────────
let cart = JSON.parse(localStorage.getItem('sf_cart') || '[]');
let selectedPayment = 'atm';
let appliedDiscount = null; // 目前套用的折扣
const localQty = {};

// ─── 折扣碼設定（要改折扣碼／網紅碼就改這裡）──────────────
// type: 'percent'（百分比，value 10 = 打 9 折）或 'fixed'（固定折 NT$）
// min: 最低消費門檻（沒有就不用寫）；influencer: 網紅名字（一般碼不用寫）
const DISCOUNT_CODES = {
  'WELCOME10': { type: 'percent', value: 10, label: '新客 9 折' },
  'SEASON50':  { type: 'fixed',   value: 50, label: '季節折 NT$50', min: 500 },
  'AMANDA':    { type: 'percent', value: 15, label: 'Amanda 專屬', influencer: 'Amanda' },
};

// ─── 食品標示（請把「（請補…）」換成實際資料）──────────────
// 每款一份；營養標示填每 100 公克的數值
const FOOD_LABELS = {
  'strawberry': {
    name: '肆菓・草莓果醬', origin: '台灣',
    ingredients: '草莓、冰糖、果膠（100% 手工製作・全素食）',
    weight: '120 公克',
    expiry: '自製造日起 2 個月（開封後請冷藏並盡快食用完畢）',
    storage: '未開封可放置陰涼處、避免陽光直射；開封後請冷藏',
    manufacturer: '肆菓 Season Flavor（手工製作）・聯絡：IG @seasonflavor_',
    nutrition: { serving: '每 100 公克', calories: '142 大卡', protein: '0.8 公克', fat: '0.2 公克', satfat: '0 公克', transfat: '0 公克', carb: '34.3 公克', sugar: '19 公克', sodium: '8 毫克' },
  },
  'mixed-berry': {
    name: '肆菓・綜合野莓果醬', origin: '台灣',
    ingredients: '草莓、藍莓、覆盆子、黑莓楊梅、冰糖、果膠（100% 手工製作・全素食）',
    weight: '120 公克',
    expiry: '自製造日起 2 個月（開封後請冷藏並盡快食用完畢）',
    storage: '未開封可放置陰涼處；開封後請冷藏',
    manufacturer: '肆菓 Season Flavor（手工製作）・聯絡：IG @seasonflavor_',
    nutrition: { serving: '每 100 公克', calories: '156 大卡', protein: '1.7 公克', fat: '0.7 公克', satfat: '0 公克', transfat: '0 公克', carb: '35.8 公克', sugar: '22 公克', sodium: '9 毫克' },
  },
  'kiwi': {
    name: '肆菓・奇異果果醬', origin: '台灣',
    ingredients: '奇異果、冰糖、果膠（100% 手工製作・全素食）',
    weight: '120 公克',
    expiry: '自製造日起 2 個月（開封後請冷藏並盡快食用完畢）',
    storage: '未開封可放置陰涼處；開封後請冷藏',
    manufacturer: '肆菓 Season Flavor（手工製作）・聯絡：IG @seasonflavor_',
    nutrition: { serving: '每 100 公克', calories: '148 大卡', protein: '0.8 公克', fat: '0.3 公克', satfat: '0 公克', transfat: '0 公克', carb: '35.8 公克', sugar: '21 公克', sodium: '（標籤未標，請補）' },
  },
  'peach': {
    name: '肆菓・水蜜桃果醬', origin: '台灣',
    ingredients: '水蜜桃、冰糖、果膠（100% 手工製作・全素食）',
    weight: '120 公克',
    expiry: '自製造日起 2 個月（開封後請冷藏並盡快食用完畢）',
    storage: '未開封可放置陰涼處；開封後請冷藏',
    manufacturer: '肆菓 Season Flavor（手工製作）・聯絡：IG @seasonflavor_',
    nutrition: { serving: '每 100 公克', calories: '146 大卡', protein: '0.9 公克', fat: '0.2 公克', satfat: '0 公克', transfat: '0 公克', carb: '35.2 公克', sugar: '26 公克', sodium: '6 毫克' },
  },
};

PRODUCTS.filter(p => p.available).forEach(p => { localQty[p.id] = 1; });

// ─── 渲染商店 ──────────────────────────────
function renderShop() {
  const grid = document.getElementById('shopGrid');
  const comingWrap = document.getElementById('shopComingSoon');
  if (!grid) return;

  const available = PRODUCTS.filter(p => p.available);
  const upcoming  = PRODUCTS.filter(p => !p.available);

  grid.innerHTML = available.map(p => `
    <div class="shop-card reveal" data-id="${p.id}">
      <div class="shop-card-img ${p.flavor}-bg">
        <img src="${p.image}" alt="${p.name}" loading="lazy" onerror="this.style.opacity='0'" />
      </div>
      <div class="shop-card-body">
        <span class="pf-badge available">現貨</span>
        <h3 class="shop-card-name">${p.name}</h3>
        <p class="shop-card-desc">${p.description}</p>
        <div class="shop-price-row">
          <span class="shop-price">NT$ ${p.price}</span>
          <span class="shop-stock-tag${p.stock <= 5 ? ' low' : ''}">
            庫存 ${p.stock} 瓶${p.stock <= 5 ? '　快售完' : ''}
          </span>
        </div>
        <div class="shop-actions">
          <div class="qty-selector">
            <button class="qty-btn" onclick="changeQty('${p.id}',-1)" aria-label="減少">−</button>
            <span class="qty-num" id="qty-${p.id}">1</span>
            <button class="qty-btn" onclick="changeQty('${p.id}',1)" aria-label="增加">+</button>
          </div>
          <button class="btn add-cart-btn" data-id="${p.id}" onclick="addToCart('${p.id}')">加入購物車</button>
        </div>
      </div>
    </div>
  `).join('');

  if (comingWrap && upcoming.length) {
    comingWrap.innerHTML = `
      <div class="shop-coming-row">
        <span class="shop-coming-label">即將推出</span>
        <div class="shop-coming-cards">
          ${upcoming.map(p => `
            <div class="shop-coming-card">
              <div class="shop-coming-img ${p.flavor}-bg">
                <img src="${p.image}" alt="${p.name}" loading="lazy" onerror="this.style.opacity='0'" />
                <div class="shop-coming-overlay">
                  <span class="pf-badge coming">即將推出</span>
                </div>
              </div>
              <p class="shop-coming-name">${p.name}</p>
            </div>
          `).join('')}
        </div>
      </div>`;
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
function addToCart(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product?.available) return;
  const qty = localQty[productId] || 1;
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
        <button class="btn btn-outline" onclick="closeCartDrawer()">繼續選購</button>
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
        <div class="cart-item-img ${p.flavor}-bg">
          <img src="${p.image}" alt="${p.name}" onerror="this.style.opacity='0'" />
        </div>
        <div class="cart-item-info">
          <p class="cart-item-name">${p.name}</p>
          <p class="cart-item-price">NT$ ${p.price}</p>
          <div class="cart-item-qty">
            <button class="qty-btn-sm" onclick="adjustCartQty('${p.id}',-1)">−</button>
            <span>${item.qty}</span>
            <button class="qty-btn-sm" onclick="adjustCartQty('${p.id}',1)">+</button>
          </div>
        </div>
        <div class="cart-item-side">
          <button class="cart-remove-btn" onclick="removeFromCart('${p.id}')" aria-label="移除">✕</button>
          <span class="cart-item-total">NT$ ${(p.price*item.qty).toLocaleString()}</span>
        </div>
      </div>`;
  }).join('');
}

// ─── 購物車 Drawer ─────────────────────────
function openCartDrawer() {
  document.getElementById('cartDrawer')?.classList.add('open');
  document.getElementById('cartOverlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  updateCartUI();
}
function closeCartDrawer() {
  document.getElementById('cartDrawer')?.classList.remove('open');
  document.getElementById('cartOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── 結帳 Modal ────────────────────────────
function openCheckout() {
  appliedDiscount = null;
  closeCartDrawer();
  renderCheckoutForm();
  document.getElementById('checkoutOverlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeCheckout() {
  document.getElementById('checkoutOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── 商品資訊 Modal（點甜點系列卡片彈出，含食品標示）──
function openProductModal(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  const L = FOOD_LABELS[id] || {};
  const n = L.nutrition || {};
  const nutriBlock = n.serving ? `
    <h4 class="co-section-title">營養標示（${n.serving}）</h4>
    <table class="pm-label">
      <tr><td>熱量</td><td>${n.calories || '—'}</td></tr>
      <tr><td>蛋白質</td><td>${n.protein || '—'}</td></tr>
      <tr><td>脂肪</td><td>${n.fat || '—'}</td></tr>
      <tr><td>　飽和脂肪</td><td>${n.satfat || '—'}</td></tr>
      <tr><td>　反式脂肪</td><td>${n.transfat || '—'}</td></tr>
      <tr><td>碳水化合物</td><td>${n.carb || '—'}</td></tr>
      <tr><td>　糖</td><td>${n.sugar || '—'}</td></tr>
      <tr><td>鈉</td><td>${n.sodium || '—'}</td></tr>
    </table>` : '';

  document.getElementById('productContent').innerHTML = `
    <div class="pm-top">
      <div class="pm-img ${p.flavor}-bg"><img src="${p.image}" alt="${p.name}" onerror="this.style.opacity='0'"></div>
      <div class="pm-head">
        <span class="pf-badge ${p.available ? 'available' : 'coming'}">${p.available ? '現貨' : '即將推出'}</span>
        <h3>${p.name}</h3>
        <p class="pm-desc">${p.description}</p>
        ${p.available ? `<p class="pm-price">NT$ ${p.price}</p>` : ''}
      </div>
    </div>
    <h4 class="co-section-title">食品標示</h4>
    <table class="pm-label">
      <tr><td>品名</td><td>${L.name || p.name}</td></tr>
      <tr><td>成分</td><td>${L.ingredients || '—'}</td></tr>
      <tr><td>淨重</td><td>${L.weight || '—'}</td></tr>
      <tr><td>原產地</td><td>${L.origin || '台灣'}</td></tr>
      <tr><td>保存期限</td><td>${L.expiry || '—'}</td></tr>
      <tr><td>保存方式</td><td>${L.storage || '—'}</td></tr>
      <tr><td>廠商資訊</td><td>${L.manufacturer || '—'}</td></tr>
    </table>
    ${nutriBlock}
    <p class="pm-note">本產品為食品，依《通訊交易解除權合理例外情事適用準則》屬易腐敗、保存期限較短之商品，恕不適用七日猶豫期（鑑賞期）。</p>
    ${p.available
      ? `<button class="btn btn-full" onclick="addToCart('${p.id}'); closeProductModal();">加入購物車</button>`
      : `<button class="btn btn-full" disabled style="opacity:.6;cursor:not-allowed">即將推出</button>`}
  `;
  document.getElementById('productOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeProductModal() {
  document.getElementById('productOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function renderCheckoutForm() {
  const wrap = document.getElementById('checkoutContent');
  if (!wrap) return;
  const rows = cart.map(item => {
    const p = PRODUCTS.find(x => x.id === item.id);
    return `<div class="co-row"><span>${p.name} × ${item.qty}</span><span>NT$ ${(p.price*item.qty).toLocaleString()}</span></div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="co-success" id="coSuccess" style="display:none">
      <div class="co-success-icon">✓</div>
      <h3>訂單已成立！</h3>
      <p class="co-order-id" id="coOrderId"></p>
      <div class="co-bank-info" id="coBankInfo"></div>
      <button class="btn" onclick="closeCheckout()">繼續逛逛</button>
    </div>

    <div id="coForm">
      <div class="co-section">
        <h4 class="co-section-title">訂單明細</h4>
        ${rows}
        <div style="display:flex;gap:.5rem;margin:.7rem 0 .3rem">
          <input type="text" id="coDiscount" placeholder="折扣碼（選填）" autocomplete="off"
                 style="flex:1;padding:.55rem .8rem;border:1.5px solid var(--cream-dark);border-radius:8px;background:var(--cream);font-size:.85rem;color:var(--text);outline:none" />
          <button type="button" class="btn btn-outline" style="padding:.45rem 1.1rem" onclick="applyDiscount()">套用</button>
        </div>
        <p id="coDiscountMsg" style="font-size:.78rem;margin:0 0 .4rem;min-height:1em"></p>
        <div class="co-row" id="coDiscountLine" style="display:none;color:var(--sage)">
          <span id="coDiscountLabel">折扣</span><span id="coDiscountAmt">-NT$ 0</span>
        </div>
        <div class="co-row co-total"><span>合計</span><span id="coTotalAmt">NT$ ${getTotal().toLocaleString()}</span></div>
      </div>

      <div class="co-section">
        <h4 class="co-section-title">收件資料</h4>
        <div class="form-group"><label>姓名</label><input type="text" id="coName" placeholder="收件人姓名" /></div>
        <div class="co-form-row">
          <div class="form-group"><label>電話</label><input type="tel" id="coPhone" placeholder="09xx-xxx-xxx" /></div>
          <div class="form-group"><label>電子信箱</label><input type="email" id="coEmail" placeholder="example@email.com" /></div>
        </div>
        <div class="form-group"><label>收件地址</label><input type="text" id="coAddress" placeholder="縣市、鄉鎮區、路名、門號" /></div>
        <div class="form-group"><label>備註（選填）</label><textarea id="coNote" rows="2" placeholder="如有特殊需求..."></textarea></div>
      </div>

      <div class="co-section">
        <h4 class="co-section-title">付款方式</h4>
        <div class="payment-pills">
          <button class="pay-pill active" data-m="atm" onclick="selectPay('atm')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 10h20" stroke="currentColor" stroke-width="1.5"/></svg>
            ATM 轉帳
          </button>
          <button class="pay-pill" data-m="credit" onclick="selectPay('credit')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 10h20M6 15h4" stroke="currentColor" stroke-width="1.5"/></svg>
            信用卡
          </button>
          <button class="pay-pill" data-m="linepay" onclick="selectPay('linepay')">LINE Pay</button>
          <button class="pay-pill" data-m="jkos" onclick="selectPay('jkos')">街口支付</button>
          <button class="pay-pill" data-m="cvs" onclick="selectPay('cvs')">超商代碼</button>
        </div>
        <div class="pay-info" id="payInfo"></div>
        <div class="form-group" style="margin-top:.85rem">
          <label>匯款帳號後五碼（方便核對付款）</label>
          <input type="text" id="coBank5" inputmode="numeric" maxlength="5" placeholder="例：12345"
                 oninput="this.value=this.value.replace(/[^0-9]/g,'')" />
        </div>
      </div>

      <p id="coError" style="color:var(--orange);font-size:.82rem;margin-bottom:.6rem;display:none"></p>
      <p style="font-size:.72rem;color:var(--text-light);line-height:1.6;margin-bottom:.7rem">
        本產品為手工食品，恕不適用七日鑑賞期。送出訂單即表示您已閱讀並同意
        <a href="terms.html" target="_blank" style="color:var(--orange)">服務條款</a>與
        <a href="privacy.html" target="_blank" style="color:var(--orange)">隱私權政策</a>。
      </p>
      <button class="btn btn-full" id="submitOrderBtn" onclick="submitOrder()">確認訂購</button>
    </div>`;

  selectPay('atm');
}

function selectPay(method) {
  selectedPayment = method;
  document.querySelectorAll('.pay-pill').forEach(b => b.classList.toggle('active', b.dataset.m === method));
  const el = document.getElementById('payInfo');
  if (!el) return;
  const msgs = {
    atm:     `<div class="pay-detail">確認訂購後將顯示匯款資訊，請於 <strong>3 天內</strong>完成轉帳，並截圖傳送至 IG <strong>@seasonflavor_</strong> 確認付款。</div>`,
    credit:  `<div class="pay-coming">💳 信用卡付款即將開放，目前請選擇 ATM 轉帳</div>`,
    linepay: `<div class="pay-coming">💚 LINE Pay 即將開放，目前請選擇 ATM 轉帳</div>`,
    jkos:    `<div class="pay-coming">街口支付即將開放，目前請選擇 ATM 轉帳</div>`,
    cvs:     `<div class="pay-coming">🏪 超商代碼付款即將開放，目前請選擇 ATM 轉帳</div>`,
  };
  el.innerHTML = msgs[method] || '';
}

// ─── 折扣碼 ────────────────────────────────
function computeDiscount(rawCode, subtotal) {
  if (!rawCode) return null;
  const code = rawCode.trim().toUpperCase();
  const d = DISCOUNT_CODES[code];
  if (!d) return { error: '折扣碼無效' };
  if (subtotal < (d.min || 0)) return { error: `此折扣碼需滿 NT$${d.min}` };
  const amount = d.type === 'percent'
    ? Math.round(subtotal * d.value / 100)
    : Math.min(d.value, subtotal);
  return { code, label: d.label, influencer: d.influencer || '', amount };
}

function applyDiscount() {
  const input = document.getElementById('coDiscount');
  const msg = document.getElementById('coDiscountMsg');
  const code = input ? input.value : '';
  if (!code.trim()) {
    appliedDiscount = null;
    if (msg) msg.textContent = '';
    updateCheckoutTotal();
    return;
  }
  const res = computeDiscount(code, getTotal());
  if (res && res.error) {
    appliedDiscount = null;
    if (msg) { msg.textContent = res.error; msg.style.color = 'var(--orange)'; }
  } else if (res) {
    appliedDiscount = res;
    const tag = res.influencer ? `（網紅：${res.influencer}）` : '';
    if (msg) { msg.textContent = `已套用 ${res.label}${tag}，折抵 NT$${res.amount}`; msg.style.color = 'var(--sage)'; }
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
  const tot = document.getElementById('coTotalAmt');
  if (tot) tot.textContent = `NT$ ${(subtotal - amt).toLocaleString()}`;
}

// ─── 送出訂單（安全版：改送到 /order，token 在伺服器端）──
async function submitOrder() {
  const name    = document.getElementById('coName')?.value.trim();
  const phone   = document.getElementById('coPhone')?.value.trim();
  const email   = document.getElementById('coEmail')?.value.trim();
  const address = document.getElementById('coAddress')?.value.trim();
  const note    = document.getElementById('coNote')?.value.trim();

  // 驗證：必填 + 格式（擋亂填）
  const showErr = (m) => { const e = document.getElementById('coError'); if (e) { e.textContent = m; e.style.display = 'block'; } };
  const clearErr = () => { const e = document.getElementById('coError'); if (e) e.style.display = 'none'; };
  clearErr();
  let firstBad = '';
  ['coName','coPhone','coEmail','coAddress'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value.trim()) { el.style.borderColor = 'var(--orange)'; if (!firstBad) firstBad = '請填寫所有必填欄位'; }
    else if (el) el.style.borderColor = '';
  });
  // Email 格式
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    document.getElementById('coEmail').style.borderColor = 'var(--orange)';
    if (!firstBad) firstBad = 'Email 格式不正確，請確認（例：name@example.com）';
  }
  // 台灣手機：09 開頭共 10 碼（允許 - 或空白）
  const phoneDigits = (phone || '').replace(/[-\s]/g, '');
  if (phone && !/^09\d{8}$/.test(phoneDigits)) {
    document.getElementById('coPhone').style.borderColor = 'var(--orange)';
    if (!firstBad) firstBad = '手機號碼格式不正確（請填 09 開頭共 10 碼）';
  }
  if (firstBad) { showErr(firstBad); return; }

  if (selectedPayment !== 'atm') {
    selectPay('atm');
    const info = document.getElementById('payInfo');
    if (info) info.innerHTML += `<p style="color:var(--orange);margin-top:.5rem;font-size:.8rem">請選擇 ATM 轉帳完成訂購</p>`;
    return;
  }

  const btn = document.getElementById('submitOrderBtn');
  if (btn) { btn.disabled = true; btn.textContent = '送出中…'; }

  const orderId = 'SF' + Date.now().toString().slice(-8);

  const itemsText = cart.map(i => {
    const p = PRODUCTS.find(x => x.id === i.id);
    return `${p.name} ×${i.qty}  NT$${(p.price * i.qty).toLocaleString()}`;
  }).join('\n');

  const subtotal = getTotal();
  const discount = appliedDiscount ? Math.min(appliedDiscount.amount, subtotal) : 0;
  const finalTotal = subtotal - discount;
  const bank5 = (document.getElementById('coBank5')?.value || '').trim();
  const discountNote = appliedDiscount ? `折扣碼: ${appliedDiscount.code} -NT$${discount}` : '';
  const bank5Note = bank5 ? `匯款帳號後五碼: ${bank5}` : '';
  const noteWithEmail = [email ? `Email: ${email}` : '', bank5Note, discountNote, note].filter(Boolean).join('\n');

  // POST 訂單至 /order（Cloudflare Pages Function）→ 由伺服器端寫入 Airtable
  try {
    const res = await fetch('/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id:   orderId,
        name:       name,
        phone:      phone,
        address:    address,
        items:      itemsText,
        total:      finalTotal,
        payment:    'ATM 轉帳',
        created_at: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
        note:       noteWithEmail,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || ('HTTP ' + res.status));
  } catch (err) {
    console.error('訂單送出失敗:', err);
    // 即使送出失敗，仍繼續本地備份並顯示成功（你可從 IG 私訊聯繫）
  }

  // 本地備份
  const order = {
    orderId, name, phone, email, address, note,
    items: cart.map(i => { const p = PRODUCTS.find(x=>x.id===i.id); return {id:i.id, name:p.name, price:p.price, qty:i.qty}; }),
    total: finalTotal,
    paymentMethod: selectedPayment,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  const orders = JSON.parse(localStorage.getItem('sf_orders') || '[]');
  orders.push(order);
  localStorage.setItem('sf_orders', JSON.stringify(orders));

  // 清空購物車
  cart = []; saveCart(); updateCartUI();

  // 顯示成功畫面
  document.getElementById('coForm').style.display = 'none';
  const success = document.getElementById('coSuccess');
  success.style.display = 'block';
  document.getElementById('coOrderId').textContent = `訂單編號：${orderId}`;
  document.getElementById('coBankInfo').innerHTML = `
    <p>請於 3 天內完成 ATM 轉帳：</p>
    <table>
      <tr><td>銀行</td><td>（請填入您的銀行名稱）</td></tr>
      <tr><td>帳號</td><td>（請填入您的帳號）</td></tr>
      <tr><td>戶名</td><td>（請填入您的姓名）</td></tr>
      <tr><td>金額</td><td><strong>NT$ ${order.total.toLocaleString()}</strong></td></tr>
    </table>
    <p>完成後請截圖傳至 IG <a href="https://www.instagram.com/seasonflavor_/" target="_blank">@seasonflavor_</a></p>
  `;
}

// ─── 初始化 ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderShop();
  updateCartUI();

  document.getElementById('navCartBtn')?.addEventListener('click', openCartDrawer);
  document.getElementById('cartDrawerClose')?.addEventListener('click', closeCartDrawer);
  document.getElementById('cartOverlay')?.addEventListener('click', closeCartDrawer);
  document.getElementById('goCheckoutBtn')?.addEventListener('click', openCheckout);
  document.getElementById('checkoutCloseBtn')?.addEventListener('click', closeCheckout);
  document.getElementById('checkoutOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'checkoutOverlay') closeCheckout();
  });

  // 甜點系列卡片 → 點擊開商品資訊（第二個購買入口 + 食品標示）
  const flavorMap = { 'strawberry-bg': 'strawberry', 'berry-bg': 'mixed-berry', 'kiwi-bg': 'kiwi', 'peach-bg': 'peach' };
  document.querySelectorAll('.products-flavors .pf-card').forEach(card => {
    const img = card.querySelector('.pf-img');
    if (!img) return;
    const cls = [...img.classList].find(c => flavorMap[c]);
    const id = flavorMap[cls];
    if (!id) return;
    card.style.cursor = 'pointer';
    card.title = '點我看商品資訊';
    card.addEventListener('click', () => openProductModal(id));
  });
  document.getElementById('productCloseBtn')?.addEventListener('click', closeProductModal);
  document.getElementById('productOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'productOverlay') closeProductModal();
  });
});
