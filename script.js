// ============================================
// 肆菓 Season Flavor — Scripts
// ============================================

// Nav scroll effect
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
const navLinks = document.querySelector('.nav-links');
navToggle?.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  const spans = navToggle.querySelectorAll('span');
  spans[0].style.transform = navLinks.classList.contains('open') ? 'rotate(45deg) translate(5px, 5px)' : '';
  spans[1].style.opacity = navLinks.classList.contains('open') ? '0' : '1';
  spans[2].style.transform = navLinks.classList.contains('open') ? 'rotate(-45deg) translate(5px, -5px)' : '';
});

// Close mobile nav on link click
navLinks?.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.querySelectorAll('span').forEach(s => {
      s.style.transform = '';
      s.style.opacity = '1';
    });
  });
});

// Scroll reveal (reusable so dynamically-rendered cards animate too)
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

function registerReveal(el, delayIndex = 0) {
  el.classList.add('reveal');
  if (delayIndex % 3 === 1) el.classList.add('reveal-delay-1');
  if (delayIndex % 3 === 2) el.classList.add('reveal-delay-2');
  revealObserver.observe(el);
}

document.querySelectorAll(
  '.about-grid, .about-text, .about-visual, .phil-card, .philosophy-quote, .contact-grid, .story-text'
).forEach((el, i) => registerReveal(el, i));

// Phil cards stagger
document.querySelectorAll('.phil-card').forEach((card, i) => {
  card.classList.add(`reveal-delay-${i + 1}`);
});

// ============================================
// 產品資料（單一來源）→ 渲染 About + Products 兩區
// ============================================

// file:// 直接開啟時 fetch 會失敗，這份內建資料確保網站不會空白。
// 正式來源仍是 data/products.json；有伺服器時以 JSON 為準。
const FALLBACK_PRODUCTS = {
  currency: 'NT$',
  products: [
    { id: 'strawberry', series: '草莓系列', name: '草莓果醬', status: 'available', price: 280, image: 'images/strawberry.jpg', bgClass: 'strawberry-bg', desc: '溫柔的酸與甜，像是春天剛開始的感覺' },
    { id: 'mixed-berry', series: '綜合莓果系列', name: '綜合野莓果醬', status: 'available', price: 320, image: 'images/mixed-berry.jpg', bgClass: 'berry-bg', desc: '深邃的果香，帶著一點點神秘的尾韻' },
    { id: 'kiwi', series: '奇異果系列', name: '奇異果果醬', status: 'upcoming', price: 300, image: 'images/kiwi.jpg', bgClass: 'kiwi-bg', desc: '清爽帶勁的綠意，讓人精神一振的酸甜' },
    { id: 'peach', series: '水蜜桃系列', name: '水蜜桃果醬', status: 'upcoming', price: 320, image: 'images/peach.jpg', bgClass: 'peach-bg', desc: '多汁飽滿，是夏天最讓人期待的一種甜' }
  ]
};

const STATUS_LABEL = { available: '現貨', upcoming: '即將推出' };
const STATUS_BADGE_CLASS = { available: 'available', upcoming: 'coming' };

let CURRENCY = 'NT$';
let PRODUCTS = [];
let DISCOUNTS = [];
const cart = {}; // { productId: qty }

const money = (n) => `${CURRENCY} ${Number(n).toLocaleString('en-US')}`;

async function loadJSON(path, fallback) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (err) {
    console.warn(`[肆菓] 無法載入 ${path}，改用內建資料。若在本機預覽請透過本地伺服器開啟。`, err);
    return fallback;
  }
}

function fillField(root, field, value) {
  const el = root.querySelector(`[data-field="${field}"]`);
  if (!el) return;
  if (field === 'img') {
    el.src = value;
  } else {
    el.textContent = value;
  }
}

function renderFlavorGrid() {
  const grid = document.getElementById('flavorGrid');
  const tpl = document.getElementById('flavorCardTpl');
  if (!grid || !tpl) return;
  grid.innerHTML = '';
  PRODUCTS.forEach((p) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.flavor = p.id;
    if (p.status === 'upcoming') node.classList.add('upcoming');
    const fig = node.querySelector('.flavor-img');
    if (fig && p.bgClass) fig.classList.add(p.bgClass);
    const badge = node.querySelector('.flavor-badge');
    if (badge) badge.classList.add(STATUS_BADGE_CLASS[p.status] || 'available');
    fillField(node, 'img', p.image);
    node.querySelector('[data-field="img"]')?.setAttribute('alt', p.series);
    fillField(node, 'badge', STATUS_LABEL[p.status] || '');
    fillField(node, 'series', p.series);
    grid.appendChild(node);
  });
}

function renderProductsGrid() {
  const grid = document.getElementById('productsGrid');
  const tpl = document.getElementById('productCardTpl');
  if (!grid || !tpl) return;
  grid.innerHTML = '';
  PRODUCTS.forEach((p, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.flavor = p.id;
    if (p.status === 'upcoming') node.classList.add('upcoming');
    const img = node.querySelector('.pf-img');
    if (img && p.bgClass) img.classList.add(p.bgClass);
    const badge = node.querySelector('.pf-badge');
    if (badge) badge.classList.add(STATUS_BADGE_CLASS[p.status] || 'available');
    fillField(node, 'img', p.image);
    node.querySelector('[data-field="img"]')?.setAttribute('alt', p.name);
    fillField(node, 'badge', STATUS_LABEL[p.status] || '');
    fillField(node, 'name', p.name);
    fillField(node, 'desc', p.desc);

    const orderBtn = node.querySelector('[data-add-order]');
    if (orderBtn) {
      if (p.status === 'available') {
        orderBtn.addEventListener('click', () => {
          addToCart(p.id, 1);
          openOrder();
        });
      } else {
        orderBtn.remove();
      }
    }
    grid.appendChild(node);
    registerReveal(node, i);
  });
}

// ============================================
// 訂購 / 購物車 / 折扣
// ============================================
function addToCart(id, delta) {
  const next = (cart[id] || 0) + delta;
  if (next <= 0) delete cart[id];
  else cart[id] = next;
}

function findProduct(id) {
  return PRODUCTS.find((p) => p.id === id);
}

function renderOrderItems() {
  const wrap = document.getElementById('orderItems');
  if (!wrap) return;
  const orderable = PRODUCTS.filter((p) => p.status === 'available');
  wrap.innerHTML = '';
  orderable.forEach((p) => {
    const qty = cart[p.id] || 0;
    const row = document.createElement('div');
    row.className = 'oi-row';
    row.innerHTML = `
      <div class="oi-info">
        <span class="oi-name">${p.name}</span>
        <span class="oi-price">${money(p.price)}</span>
      </div>
      <div class="oi-qty">
        <button type="button" class="oi-btn" data-dec aria-label="減少">−</button>
        <span class="oi-count">${qty}</span>
        <button type="button" class="oi-btn" data-inc aria-label="增加">+</button>
      </div>`;
    row.querySelector('[data-dec]').addEventListener('click', () => { addToCart(p.id, -1); renderOrderItems(); recalc(); });
    row.querySelector('[data-inc]').addEventListener('click', () => { addToCart(p.id, 1); renderOrderItems(); recalc(); });
    wrap.appendChild(row);
  });
}

let appliedDiscount = null; // { code, label, kind, influencer, amount }

function subtotal() {
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const p = findProduct(id);
    return sum + (p ? p.price * qty : 0);
  }, 0);
}

function computeDiscount(code, sub) {
  if (!code) return null;
  const norm = code.trim().toUpperCase();
  const d = DISCOUNTS.find((x) => x.code.toUpperCase() === norm && x.active !== false);
  if (!d) return { error: '折扣碼無效' };
  if (sub < (d.minSubtotal || 0)) {
    return { error: `此折扣碼需滿 ${money(d.minSubtotal)} 才能使用` };
  }
  const amount = d.type === 'percent'
    ? Math.round(sub * d.value / 100)
    : Math.min(d.value, sub);
  return {
    code: d.code, label: d.label, kind: d.kind || 'general',
    influencer: d.influencer || '', amount
  };
}

function recalc() {
  const sub = subtotal();
  document.getElementById('sumSubtotal').textContent = money(sub);

  // 若已套用折扣，金額隨數量變動重算（可能因未達門檻而失效）
  if (appliedDiscount) {
    const re = computeDiscount(appliedDiscount.code, sub);
    appliedDiscount = re && !re.error ? re : null;
    if (!appliedDiscount) setCodeMsg('折扣碼因金額變動已失效', false);
  }

  const row = document.getElementById('sumDiscountRow');
  if (appliedDiscount) {
    row.hidden = false;
    document.getElementById('sumDiscountLabel').textContent =
      `折扣（${appliedDiscount.label}）`;
    document.getElementById('sumDiscount').textContent = `-${money(appliedDiscount.amount)}`;
  } else {
    row.hidden = true;
  }

  const total = Math.max(0, sub - (appliedDiscount ? appliedDiscount.amount : 0));
  document.getElementById('sumTotal').textContent = money(total);
}

function setCodeMsg(msg, ok) {
  const el = document.getElementById('codeMsg');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
  el.classList.toggle('ok', !!ok);
  el.classList.toggle('err', msg && !ok);
}

// Modal open/close
const modal = document.getElementById('orderModal');
function openOrder() {
  renderOrderItems();
  recalc();
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeOrder() {
  modal.hidden = true;
  document.body.style.overflow = '';
}
document.querySelectorAll('[data-open-order]').forEach((el) => {
  el.addEventListener('click', (e) => { e.preventDefault(); openOrder(); });
});
document.querySelectorAll('[data-close-order]').forEach((el) => {
  el.addEventListener('click', closeOrder);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal && !modal.hidden) closeOrder();
});

// Apply discount code
document.getElementById('applyCode')?.addEventListener('click', () => {
  const code = document.getElementById('ordCode').value;
  if (!code.trim()) { appliedDiscount = null; setCodeMsg('', false); recalc(); return; }
  const res = computeDiscount(code, subtotal());
  if (res && res.error) {
    appliedDiscount = null;
    setCodeMsg(res.error, false);
  } else if (res) {
    appliedDiscount = res;
    const tag = res.kind === 'influencer' ? `（網紅專屬：${res.influencer}）` : '';
    setCodeMsg(`已套用 ${res.label}${tag}，折抵 ${money(res.amount)}`, true);
  }
  recalc();
});

// Submit order
document.getElementById('submitOrder')?.addEventListener('click', submitOrder);

function setStatus(msg, kind) {
  const el = document.getElementById('orderStatus');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = 'order-status' + (kind ? ' ' + kind : '');
}

async function submitOrder() {
  const name = document.getElementById('ordName').value.trim();
  const email = document.getElementById('ordEmail').value.trim();
  const phone = document.getElementById('ordPhone').value.trim();
  const note = document.getElementById('ordNote').value.trim();

  const items = Object.entries(cart).map(([id, qty]) => {
    const p = findProduct(id);
    return { id, name: p.name, price: p.price, qty };
  });

  if (!items.length) { setStatus('請至少選擇一項商品', 'err'); return; }
  if (!name || !email) { setStatus('請填寫姓名與 Email', 'err'); return; }

  const payload = {
    type: 'order', name, email, phone, note,
    items,
    code: appliedDiscount ? appliedDiscount.code : '',
    // 金額僅供參考，後端會以自己的碼表重算
    subtotal: subtotal(),
    discount: appliedDiscount ? appliedDiscount.amount : 0
  };

  const endpoint = (window.SF_CONFIG && window.SF_CONFIG.orderEndpoint) || '';
  const btn = document.getElementById('submitOrder');

  if (!endpoint) {
    // 示範模式：尚未接後端 → 用信箱草稿備援
    mailtoFallback(payload);
    setStatus('線上收單尚未啟用，已為您開啟信箱草稿作為備援。', 'err');
    return;
  }

  btn.disabled = true;
  btn.textContent = '送出中…';
  setStatus('', '');
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      // 用 text/plain 避免 CORS 預檢，Apps Script 端 JSON.parse 仍可解析
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      setStatus(`訂單已送出！訂單編號 ${data.orderId}，確認信已寄到 ${email}。`, 'ok');
      Object.keys(cart).forEach((k) => delete cart[k]);
      appliedDiscount = null;
      document.getElementById('ordCode').value = '';
      setCodeMsg('', false);
      renderOrderItems();
      recalc();
    } else {
      setStatus('送出失敗：' + (data.error || '請稍後再試'), 'err');
    }
  } catch (err) {
    console.error(err);
    setStatus('送出失敗，請檢查網路後再試，或改用信箱與我們聯絡。', 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '送出訂單';
  }
}

function mailtoFallback(payload) {
  const to = (window.SF_CONFIG && window.SF_CONFIG.ownerEmail) || '';
  const lines = payload.items.map((it) => `${it.name} x${it.qty} (${money(it.price)})`).join('\n');
  const body =
    `姓名：${payload.name}\nEmail：${payload.email}\n電話：${payload.phone || '—'}\n\n` +
    `品項：\n${lines}\n\n` +
    (payload.code ? `折扣碼：${payload.code}\n` : '') +
    `小計：${money(payload.subtotal)}\n備註：${payload.note || '—'}`;
  const url = `mailto:${to}?subject=${encodeURIComponent('肆菓訂單 - ' + payload.name)}&body=${encodeURIComponent(body)}`;
  window.location.href = url;
}

// ============================================
// 初始化
// ============================================
(async function init() {
  let pData, dData;
  if (window.SF_INLINE_DATA) {
    // 單檔預覽版：資料已內嵌，不需 fetch
    pData = window.SF_INLINE_DATA.products || FALLBACK_PRODUCTS;
    dData = window.SF_INLINE_DATA.discounts || { codes: [] };
  } else {
    [pData, dData] = await Promise.all([
      loadJSON('data/products.json', FALLBACK_PRODUCTS),
      loadJSON('data/discounts.json', { codes: [] })
    ]);
  }
  CURRENCY = pData.currency || 'NT$';
  PRODUCTS = pData.products || [];
  DISCOUNTS = dData.codes || [];
  renderFlavorGrid();
  renderProductsGrid();
})();

// ============================================
// Contact form → 走同一個後端（type=contact），未設定則維持原本體驗
// ============================================
const form = document.getElementById('contactForm');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = form.querySelector('button[type="submit"]');
  const endpoint = (window.SF_CONFIG && window.SF_CONFIG.orderEndpoint) || '';
  const done = () => {
    btn.textContent = '訊息已送出 ✓';
    btn.style.background = 'var(--sage)';
    btn.style.borderColor = 'var(--sage)';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = '送出訊息';
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.disabled = false;
      form.reset();
    }, 3000);
  };

  if (!endpoint) { done(); return; }

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        type: 'contact',
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        message: document.getElementById('message').value
      })
    });
  } catch (err) {
    console.warn('聯絡訊息送出失敗', err);
  }
  done();
});
