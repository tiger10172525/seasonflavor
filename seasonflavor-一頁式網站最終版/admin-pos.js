/* 資料全部存在這台裝置（localStorage），有網路時自動送到 /admin-pos-sync：
 * 寫入 Airtable 訂單（後台「訂單管理」看得到）並扣 D1 庫存。
 * 同一筆重送伺服器會去重，不會重複記帳。 */
const LS = { products: 'sf_pos_products', custom: 'sf_pos_custom', sales: 'sf_pos_sales', key: 'sf_pos_key' };
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'NT$' + Number(n).toLocaleString();
const today = () => new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });

let products = load(LS.products, []);
let custom = load(LS.custom, []);   // 擺攤專用品項：只存在這台裝置，不扣庫存
const findItem = (id) => products.find((x) => x.id === id) || custom.find((x) => x.id === id);
let sales = load(LS.sales, []);
let cart = {};              // { productId: qty }
let payment = '現金';
let syncing = false;

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

// 顯示庫存 = 上次抓到的庫存 − 還沒同步的銷售
function stockOf(id) {
  const p = products.find((x) => x.id === id);
  const used = sales.filter((s) => !s.synced).flatMap((s) => s.items).filter((i) => i.id === id).reduce((n, i) => n + i.qty, 0);
  return (p ? p.stock : 0) - used;
}

function renderGrid() {
  $('grid').innerHTML = (products.length ? '' : '<p class="empty">還沒有官網商品資料。請先連上網路打開一次這一頁。</p>') +
    products.concat(custom).map((p) => `
    <button class="prod" data-id="${esc(p.id)}">
      ${cart[p.id] ? `<span class="n">${cart[p.id]}</span>` : ''}
      ${p.custom ? `<span class="del" data-del="${esc(p.id)}">✕</span><span class="ph">${esc(p.name.slice(0, 1))}</span>`
                 : `<img src="${esc(p.image)}" alt="" loading="lazy" />`}
      <b>${esc(p.name)}</b>
      <span>${money(p.price)} ・ ${p.custom ? '擺攤專用' : '庫存 ' + stockOf(p.id)}</span>
    </button>`).join('') +
    '<button class="prod add" data-add="1"><span class="ph">＋</span><b>新增品項</b></button>';
}

function cartTotal() {
  return Object.entries(cart).reduce((s, [id, q]) => s + (findItem(id)?.price || 0) * q, 0);
}

function renderCart() {
  const ids = Object.keys(cart);
  $('cart').innerHTML = ids.length ? ids.map((id) => {
    const p = findItem(id);
    return `<div class="line">
      <span class="nm">${esc(p.name)}</span>
      <button class="qty" data-dec="${esc(id)}">−</button>
      <span class="q">${cart[id]}</span>
      <button class="qty" data-inc="${esc(id)}">+</button>
      <span class="sub">${money(p.price * cart[id])}</span>
    </div>`;
  }).join('') : '<p class="empty">點商品加入本單</p>';
  const total = cartTotal();
  $('total').textContent = money(total);
  $('payBtn').disabled = !total;
  $('cashBox').style.display = payment === '現金' ? '' : 'none';
  renderChange();
  renderGrid();
}

function renderChange() {
  const cash = Number($('cash').value), total = cartTotal(), el = $('change');
  if (!cash || !total) { el.textContent = ''; el.className = 'change'; return; }
  const diff = cash - total;
  el.className = 'change' + (diff < 0 ? ' short' : '');
  el.innerHTML = diff < 0 ? `還差 <b>${money(-diff)}</b>` : `找零 <b>${money(diff)}</b>`;
}

function renderSales() {
  const d = today();
  const list = sales.filter((s) => s.day === d);
  const sum = (arr) => arr.reduce((n, s) => n + s.total, 0);
  const jars = list.flatMap((s) => s.items).reduce((n, i) => n + i.qty, 0);
  $('stats').innerHTML = `
    <div>營業額<b>${money(sum(list))}</b></div>
    <div>筆數 / 罐數<b>${list.length} / ${jars}</b></div>
    <div>現金<b>${money(sum(list.filter((s) => s.payment === '現金')))}</b></div>
    <div>轉帳 / LINE Pay<b>${money(sum(list.filter((s) => s.payment !== '現金')))}</b></div>`;
  $('sales').innerHTML = list.slice().reverse().map((s) => `
    <div class="sale">
      <span class="t">${s.time}</span>
      <span class="d">${esc(s.items.map((i) => i.name.replace(/果醬$/, '') + '×' + i.qty).join('、'))}<br>${money(s.total)} ・ ${esc(s.payment)}</span>
      ${s.synced ? '<span class="ok">已同步</span>' : `<button data-undo="${esc(s.id)}">刪除</button>`}
    </div>`).join('') || '<p class="empty">今天還沒有銷售</p>';

  const n = sales.filter((s) => !s.synced).length;
  $('pending').textContent = n ? `待同步 ${n} 筆` : '已全部同步';
  $('pending').className = 'badge' + (n ? ' wait' : '');
}

function renderNet() {
  $('net').textContent = navigator.onLine ? '線上' : '離線';
  $('net').className = 'badge' + (navigator.onLine ? '' : ' off');
}

function checkout() {
  const total = cartTotal();
  if (!total) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  sales.push({
    id: `POS${stamp}-${Math.random().toString(36).slice(2, 5)}`,
    created_at: now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    day: today(),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    items: Object.entries(cart).map(([id, qty]) => {
      const p = findItem(id);
      return { id, name: p.name, price: p.price, qty };
    }),
    total, payment, synced: false,
  });
  store(LS.sales, sales);
  cart = {}; $('cash').value = '';
  renderCart(); renderSales();
  toast(`已結帳 ${money(total)}`);
  sync();
}

async function refreshProducts() {
  if (!navigator.onLine) return;
  try {
    const res = await fetch('/api/products', { cache: 'no-store' });
    if (!res.ok) return;
    const list = (await res.json()).filter((p) => p.price != null);
    if (!list.length) return;
    products = list.map(({ id, name, price, image, stock }) => ({ id, name, price, image, stock }));
    store(LS.products, products);
    renderCart();
  } catch { /* 離線就用上次的 */ }
}

localStorage.removeItem(LS.key);   // 清掉舊版存在這台裝置的密碼

async function posLogin(manual) {
  const r = await fetch('/api/admin/session').then((x) => x.json()).catch(() => ({}));
  if (r.ok) return r.csrf;
  if (!manual) return '';   // 自動同步不要跳視窗打斷結帳
  const key = (prompt('輸入後台密碼') || '').trim();
  if (!key) return '';
  const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) throw new Error(out.error || '登入失敗');
  return out.csrf;
}

async function sync(manual) {
  if (syncing) return;
  if (!navigator.onLine) { if (manual) toast('目前離線，連上網路後會自動同步'); return; }
  const pending = sales.filter((s) => !s.synced);
  if (!pending.length) { if (manual) toast('沒有待同步的銷售'); refreshProducts(); return; }

  // 後台登入用 cookie session（8 小時）；過期才請你輸入一次密碼
  let csrf = '';
  try { csrf = await posLogin(manual); } catch (e) { toast(e.message); return; }
  if (!csrf) return;

  syncing = true; $('syncBtn').textContent = '同步中…';
  try {
    for (let i = 0; i < pending.length; i += 10) {
      const batch = pending.slice(i, i + 10);
      const res = await fetch('/admin-pos-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf': csrf },
        body: JSON.stringify({ sales: batch.map(({ id, created_at, items, total, payment }) => ({ id, created_at, items, total, payment })) }),
      });
      if (res.status === 401 || res.status === 403) throw new Error('登入已過期，請按「同步」重新登入');
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error || '同步失敗（' + res.status + '）');
      for (const s of sales) if (out.synced.includes(s.id)) s.synced = true;
      store(LS.sales, sales);
    }
    toast(`已同步 ${pending.length} 筆到後台`);
    await refreshProducts();
  } catch (e) {
    toast(e.message || '同步失敗，稍後會再試');
  } finally {
    syncing = false; $('syncBtn').textContent = '同步';
    renderSales(); renderGrid();
  }
}

// ── 事件 ──
$('grid').addEventListener('click', (e) => {
  const del = e.target.dataset.del;
  if (del) {
    const c = custom.find((x) => x.id === del);
    if (c && confirm(`刪除品項「${c.name}」？`)) {
      custom = custom.filter((x) => x !== c); store(LS.custom, custom);
      delete cart[del]; renderCart();
    }
    return;
  }
  if (e.target.closest('[data-add]')) {
    const name = (prompt('品項名稱（例如：禮盒組、試吃包）') || '').trim().slice(0, 30);
    if (!name) return;
    const price = Math.round(Number(prompt(`「${name}」的價格（NT$）`)));
    if (!(price > 0)) { toast('價格要是大於 0 的數字'); return; }
    custom.push({ id: 'c-' + Date.now().toString(36), name, price, custom: true });
    store(LS.custom, custom); renderGrid();
    return;
  }
  const b = e.target.closest('[data-id]'); if (!b) return;
  cart[b.dataset.id] = (cart[b.dataset.id] || 0) + 1;
  renderCart();
});
$('cart').addEventListener('click', (e) => {
  const inc = e.target.dataset.inc, dec = e.target.dataset.dec;
  if (inc) cart[inc]++;
  if (dec && --cart[dec] <= 0) delete cart[dec];
  renderCart();
});
$('payment').addEventListener('click', (e) => {
  const p = e.target.dataset.p; if (!p) return;
  payment = p;
  for (const b of $('payment').children) b.classList.toggle('on', b === e.target);
  renderCart();
});
$('cashBox').addEventListener('click', (e) => {
  const c = e.target.dataset.cash; if (!c) return;
  $('cash').value = c === 'exact' ? cartTotal() : c;
  renderChange();
});
$('cash').addEventListener('input', renderChange);
$('payBtn').addEventListener('click', checkout);
$('clearBtn').addEventListener('click', () => { cart = {}; $('cash').value = ''; renderCart(); });
$('syncBtn').addEventListener('click', () => sync(true));
$('sales').addEventListener('click', (e) => {
  const id = e.target.dataset.undo; if (!id) return;
  const s = sales.find((x) => x.id === id);
  if (!s || s.synced || !confirm(`刪除這筆 ${money(s.total)} 的銷售？`)) return;
  sales = sales.filter((x) => x !== s);
  store(LS.sales, sales);
  renderSales(); renderGrid();
});
addEventListener('online', () => { renderNet(); sync(); });
addEventListener('offline', renderNet);
setInterval(sync, 60000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/admin-pos-sw.js', { scope: '/admin-pos' });
// 要求瀏覽器不要自動清掉這裡的資料
navigator.storage?.persist?.();

renderNet(); renderCart(); renderSales();
refreshProducts().then(() => sync());
