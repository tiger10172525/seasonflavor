  // 登入：密碼只送一次到 /api/admin/login，伺服器回 HttpOnly cookie（8 小時）。
  // 之後每個會改資料的請求帶 x-csrf；密碼不存在瀏覽器裡。
  const API = '/admin-orders';
  let CSRF = '';
  sessionStorage.removeItem('sf_admin_key');   // 清掉舊版存在瀏覽器的密碼

  let allOrders    = [];
  let activeFilter = 'all';
  let salesChart   = null;
  let chartPeriod  = 'day';

  // ── 登入 ──────────────────────────────────────
  async function login() {
    const pw = document.getElementById('pwInput').value;
    const errEl = document.getElementById('loginError');
    if (!pw) return;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: pw }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { errEl.textContent = out.error || '伺服器錯誤，請稍後再試'; errEl.style.display = 'block'; return; }
      CSRF = out.csrf;
      document.getElementById('pwInput').value = '';
      errEl.style.display = 'none';
      showAdmin();
    } catch (e) {
      errEl.textContent = '連線失敗，請檢查網路';
      errEl.style.display = 'block';
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST', headers: { 'x-csrf': CSRF } }).catch(() => {});
    location.reload();
  }

  async function logoutAll() {
    if (!confirm('確定要登出所有裝置（包含收銀 POS）？')) return;
    await fetch('/api/admin/logout-all', { method: 'POST', headers: { 'x-csrf': CSRF } }).catch(() => {});
    location.reload();
  }

  function showAdmin() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminScreen').style.display = 'block';
    loadOrders();
    loadInventory();
    loadJournal();
    loadPay();
    loadDiscounts();
    loadStats();
  }

  // ── 總覽卡片 ──────────────────────────────
  async function loadStats() {
    try {
      const res = await fetch('/admin-stats', { headers: { 'x-csrf': CSRF } });
      if (!res.ok) return;
      const s = await res.json();
      const $ = id => document.getElementById(id);
      $('bToday').textContent = 'NT$ ' + s.today.toLocaleString(); $('bTodayN').textContent = s.todayCount + ' 筆已付款';
      $('bMonth').textContent = 'NT$ ' + s.month.toLocaleString(); $('bMonthN').textContent = s.monthCount + ' 筆已付款';
      $('bShip').textContent = s.toShip;
      $('bLow').innerHTML = s.low.length ? s.low.map(p => `<span>${jEsc(p.name)}<b>剩 ${jEsc(p.stock)} 瓶</b></span>`).join('') : '<span>庫存都充足</span>';
      const max = Math.max(1, ...s.top.map(t => t.qty));
      $('bTop').innerHTML = s.top.length ? s.top.map(t => `<div class="r"><span>${jEsc(t.name)}</span><div class="bar"><i data-w="${Math.round(t.qty / max * 100)}"></i></div><b>${jEsc(t.qty)} 瓶</b></div>`).join('') : '<span style="font-size:.85rem;color:var(--b-ink2)">近 30 天還沒有已付款訂單</span>';
      requestAnimationFrame(() => document.querySelectorAll('#bTop i').forEach(i => { i.style.width = i.dataset.w + '%'; }));
    } catch {}
  }

  // ── 訂單詳情側欄 ──────────────────────────
  async function openOrder(id) {
    const body = document.getElementById('odBody');
    document.getElementById('odTitle').textContent = id;
    body.innerHTML = '<div class="loading"><div class="spinner"></div>載入中…</div>';
    document.getElementById('odPanel').classList.add('open'); document.getElementById('odMask').classList.add('open');
    try {
      const res = await fetch('/admin-order-detail?id=' + encodeURIComponent(id), { headers: { 'x-csrf': CSRF } });
      const o = await res.json();
      if (!res.ok) { body.innerHTML = `<p>${jEsc(o.error || '讀取失敗')}</p>`; return; }
      const row = (k, v) => v || v === 0 ? `<div class="od-row"><span>${jEsc(k)}</span><b>${jEsc(v)}</b></div>` : '';
      body.innerHTML = `
        <div class="od-sec"><h4>狀態</h4>${row('目前狀態', o.status)}${row('付款方式', o.payment)}${row('繳費資訊', o.payment_info)}</div>
        <div class="od-sec"><h4>品項</h4>${o.items.map(i => row(`${i.product_name} × ${i.qty}`, 'NT$ ' + i.line_total.toLocaleString())).join('')}
          ${row('運費', 'NT$ ' + o.shipping)}${o.discount ? row('折扣' + (o.coupon ? '（' + o.coupon + '）' : ''), '-NT$ ' + o.discount) : ''}${row('合計', 'NT$ ' + o.total.toLocaleString())}</div>
        <div class="od-sec"><h4>收件</h4>${row('姓名', o.name)}${row('電話', o.phone)}${row('Email', o.email)}${row('配送', o.ship)}${row('備註', o.note)}</div>
        <div class="od-sec"><h4>時間軸</h4><div class="od-tl">
          <div>建立訂單　${jEsc(o.created_at)}</div>
          ${o.events.map(e => `<div>綠界回報 ${jEsc(e.code === '1' ? '付款成功' : e.code === '2' || e.code === '10100073' ? '取號成功' : '代碼 ' + e.code)}　${jEsc(e.at)}</div>`).join('')}
          ${o.paid_at ? `<div>確認付款　${jEsc(o.paid_at)}</div>` : ''}
          <div>最後更新（${jEsc(o.status)}）　${jEsc(o.updated_at)}</div></div></div>`;
    } catch { body.innerHTML = '<p>讀取失敗，請稍後再試</p>'; }
  }
  function closeOrder() {
    document.getElementById('odPanel').classList.remove('open'); document.getElementById('odMask').classList.remove('open');
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOrder(); });

  document.getElementById('pwInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });

  // 已登入（cookie 還有效）就直接進後台。等整段 script 跑完再載入，否則下面的 const 還沒宣告
  document.addEventListener('DOMContentLoaded', async () => {
    const r = await fetch('/api/admin/session').then(x => x.json()).catch(() => ({}));
    if (r.ok) { CSRF = r.csrf; showAdmin(); }
  });

  // ── 商品與庫存（D1）────────────────────────────
  // 商品全部存在 D1 products 表，前台商品頁、果醬系列、線上訂購、sitemap 都從這裡讀
  const INV_API = '/admin-products';
  // [欄位, 標題, 輸入框類型]
  const PRODUCT_FIELDS = [
    ['name', '商品名稱', 'text'], ['en', '英文名稱', 'text'],
    ['card', '卡片短文案（一句話）', 'text'],
    ['description', '商品介紹（也是 Google 搜尋結果的摘要，建議 80–120 字）', 'area'],
    ['ingredients', '成分', 'area'], ['net_weight', '淨重', 'text'],
    ['shelf_life', '保存期限', 'text'], ['storage', '保存方法', 'text'],
    ['sku', 'SKU（商品編號）', 'text'],
    ['alt', '圖片說明（描述圖片內容，給 Google 與看不到圖的人）', 'text'],
    ['sort_order', '排序（數字小的排前面）', 'number'],
  ];
  // 營養標示（每 100 公克），存成 D1 nutrition 欄的 JSON
  const NUTRITION_FIELDS = [
    ['calories', '熱量'], ['protein', '蛋白質'], ['fat', '脂肪'], ['satfat', '飽和脂肪'],
    ['transfat', '反式脂肪'], ['carb', '碳水化合物'], ['sugar', '糖'], ['sodium', '鈉'],
  ];
  let inventory = [];

  async function loadInventory() {
    const wrap = document.getElementById('invWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="loading"><div class="spinner"></div>載入中…</div>';
    try {
      const res = await fetch(INV_API, { headers: { 'x-csrf': CSRF } });
      if (!res.ok) {
        wrap.innerHTML = '<p style="color:#c0392b;padding:1rem;line-height:1.7">商品載入失敗（' + res.status +
          '）。<br>若顯示「D1 未綁定」，請到 Pages → Settings → Bindings 新增 D1 綁定（變數名稱 <b>DB</b> → 資料庫 seasonflavor）後重新部署。</p>';
        return;
      }
      inventory = await res.json();
      renderInventory();
    } catch (e) {
      wrap.innerHTML = '<p style="color:#c0392b;padding:1rem">連線失敗，請檢查網路</p>';
    }
  }

  const invStatus = (r) => Number(r.hidden) ? 'hidden'
    : !r.available ? 'upcoming' : ((Number(r.stock) || 0) > 0 ? 'instock' : 'soldout');

  function statusSelect(key, st) {
    const opt = (v, label) => '<option value="' + v + '"' + (st === v ? ' selected' : '') + '>' + label + '</option>';
    return '<select id="inv-status-' + key + '">' +
      opt('instock', '現貨供應') + opt('soldout', '暫無現貨（補貨中）') +
      opt('upcoming', '即將推出') + opt('hidden', '隱藏（網站上不顯示）') + '</select>';
  }

  // 圖片 + 文案 + 規格欄位；key 是商品 id，新增表單用 'new'
  function productFieldsHtml(rawKey, r) {
    const key = jEsc(rawKey);
    const img = r.image || '';
    const inp = 'width:100%;padding:.35rem;margin-top:.2rem';
    return '<div style="display:grid;grid-template-columns:140px 1fr;gap:1rem;align-items:start;margin-top:.6rem">' +
      '<div style="font-size:.78rem;color:#7A6A52">商品圖片' +
        '<img id="inv-img-' + key + '" src="' + jEsc(img) + '" alt="" style="width:140px;height:140px;object-fit:cover;border-radius:8px;background:#F2EDE4;margin:.3rem 0' + (img ? '' : ';opacity:.3') + '">' +
        '<input type="file" accept="image/jpeg,image/png,image/webp" data-change="pickProductImage" data-arg="' + jEsc(JSON.stringify(rawKey)) + '" style="font-size:.72rem;width:140px">' +
        '<input type="hidden" id="inv-image-' + key + '" value="' + jEsc(img) + '">' +
        '<input type="hidden" id="inv-image_w-' + key + '" value="' + jEsc(r.image_w) + '">' +
        '<input type="hidden" id="inv-image_h-' + key + '" value="' + jEsc(r.image_h) + '">' +
        '<span id="inv-imgmsg-' + key + '" style="display:block;font-size:.72rem"></span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.6rem">' +
      PRODUCT_FIELDS.map(([k, label, type]) =>
        '<label style="font-size:.78rem;color:#7A6A52">' + label +
        (type === 'area'
          ? '<textarea id="inv-' + k + '-' + key + '" rows="3" style="' + inp + '">' + jEsc(r[k]) + '</textarea>'
          : '<input id="inv-' + k + '-' + key + '" type="' + type + '" value="' + jEsc(r[k]) + '" style="' + inp + '">') +
        '</label>').join('') +
      '</div></div>' +
      '<div style="margin-top:.8rem;font-size:.78rem;color:#7A6A52">營養標示（每 100 公克，含單位，例如「142 大卡」「0.8 公克」「8 毫克」）' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.5rem;margin-top:.3rem">' +
      NUTRITION_FIELDS.map(([k, label]) => {
        let n = {};
        try { n = JSON.parse(r.nutrition || '{}') || {}; } catch {}
        return '<label>' + label + '<input id="inv-n-' + k + '-' + key + '" value="' + jEsc(n[k]) + '" style="' + inp + '"></label>';
      }).join('') +
      '</div></div>';
  }

  function renderInventory() {
    const wrap = document.getElementById('invWrap');
    if (!Array.isArray(inventory) || !inventory.length) {
      wrap.innerHTML = '<p style="padding:1rem">尚無商品資料，按上面的「新增商品」建立第一個。</p>';
      return;
    }
    const cell = 'padding:.4rem .5rem;font-size:.9rem';
    wrap.innerHTML =
      '<table style="width:100%;border-collapse:collapse;min-width:560px">' +
      '<tr style="text-align:left;color:#7A6A52;font-size:.8rem">' +
        '<th style="' + cell + '">商品</th><th style="' + cell + '">供應狀態</th>' +
        '<th style="' + cell + '">現貨數量</th><th style="' + cell + '">價格 NT$</th>' +
        '<th style="' + cell + '"></th></tr>' +
      inventory.map(r => {
        const name = r.name || r.id;
        return '<tr style="border-top:1px solid #F2EDE4">' +
          '<td style="' + cell + ';font-weight:600;color:#2C2417">' + jEsc(name) +
            '<div style="font-weight:400;font-size:.72rem;color:#7A6A52">/products/' + jEsc(r.id) + '</div></td>' +
          '<td style="' + cell + '">' + statusSelect(jEsc(r.id), invStatus(r)) + '</td>' +
          '<td style="' + cell + '"><input type="number" id="inv-st-' + jEsc(r.id) + '" value="' + jEsc(r.stock || 0) + '" min="0" style="width:70px;padding:.3rem"></td>' +
          '<td style="' + cell + '"><input type="number" id="inv-pr-' + jEsc(r.id) + '" value="' + jEsc(r.price != null ? r.price : '') + '" min="0" placeholder="—" style="width:80px;padding:.3rem"></td>' +
          '<td style="' + cell + '"><button class="refresh-btn" data-action="saveInventory" data-arg="' + jEsc(JSON.stringify(r.id)) + '">儲存</button> ' +
            '<span id="inv-msg-' + jEsc(r.id) + '" style="font-size:.8rem;color:#8B9E6E"></span></td>' +
        '</tr>' +
        '<tr><td colspan="5" style="padding:0 .5rem .9rem"><details><summary style="cursor:pointer;font-size:.82rem;color:#7A6A52">編輯圖片、文案與規格</summary>' +
          productFieldsHtml(r.id, r) +
          '<p style="font-size:.75rem;color:#7A6A52;margin-top:.5rem">改完一樣按上面的「儲存」。空白的規格欄位，前台商品頁會顯示「資料整理中」。</p>' +
        '</details></td></tr>';
      }).join('') +
      '</table>' +
      '<p style="font-size:.78rem;color:#7A6A52;padding:.6rem .8rem;line-height:1.7">' +
      '「現貨供應」＝前台可購買（記得填數量）；「暫無現貨」＝顯示補貨中、不能買；「即將推出」＝顯示即將推出；「隱藏」＝網站上完全不出現。改完按儲存，前台重新整理就生效。</p>';
  }

  // 選圖 → 讀尺寸（前台要寫 width/height 避免版面跳動）→ 上傳 R2
  async function pickProductImage(input, key) {
    const file = input.files && input.files[0];
    if (!file) return;
    const msg = document.getElementById('inv-imgmsg-' + key);
    msg.textContent = '上傳中…'; msg.style.color = '#7A6A52';
    try {
      const bmp = await createImageBitmap(file);
      const url = await uploadImage(file);
      document.getElementById('inv-image-' + key).value = url;
      document.getElementById('inv-image_w-' + key).value = bmp.width;
      document.getElementById('inv-image_h-' + key).value = bmp.height;
      const img = document.getElementById('inv-img-' + key);
      img.src = url; img.style.opacity = '';
      msg.textContent = '已上傳，記得按儲存'; msg.style.color = '#8B9E6E';
    } catch (e) {
      msg.textContent = e.message || '上傳失敗'; msg.style.color = '#c0392b';
    }
    input.value = '';
  }

  // 讀表單：狀態下拉推回 available / stock / hidden
  //   現貨供應 → available=1, stock=填入的數量
  //   暫無現貨 → available=1, stock=0（顯示補貨中）
  //   即將推出 → available=0, stock=0
  //   隱藏     → 其他照舊，只是網站上不顯示
  function collectProduct(key) {
    const $ = (id) => document.getElementById(id);
    const status = $('inv-status-' + key).value;
    const data = { hidden: status === 'hidden' ? 1 : 0 };
    let stock = Number($('inv-st-' + key).value) || 0;
    const row = inventory.find(r => r.id === key) || {};
    if (status === 'upcoming')     { data.available = false; stock = 0; }
    else if (status === 'soldout') { data.available = true;  stock = 0; }
    else if (status === 'instock') { data.available = true; }
    else                           { data.available = !!row.available; }
    data.stock = stock;
    const pr = $('inv-pr-' + key).value;
    data.price = pr === '' ? null : Number(pr);
    for (const [k] of PRODUCT_FIELDS) data[k] = $('inv-' + k + '-' + key).value;
    for (const k of ['image', 'image_w', 'image_h']) data[k] = $('inv-' + k + '-' + key).value;
    const n = {};
    for (const [k] of NUTRITION_FIELDS) { const v = $('inv-n-' + k + '-' + key).value.trim(); if (v) n[k] = v; }
    data.nutrition = JSON.stringify(n);
    return data;
  }

  async function saveInventory(id) {
    const msg = document.getElementById('inv-msg-' + id);
    msg.textContent = '儲存中…'; msg.style.color = '#7A6A52';
    try {
      const res = await fetch(INV_API, {
        method: 'PATCH',
        headers: { 'x-csrf': CSRF, 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ id }, collectProduct(id))),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok) { msg.textContent = '已儲存 ✓'; msg.style.color = '#8B9E6E'; setTimeout(() => { msg.textContent = ''; }, 2500); }
      else { msg.textContent = out.error || ('失敗 (' + res.status + ')'); msg.style.color = '#c0392b'; }
    } catch { msg.textContent = '連線失敗'; msg.style.color = '#c0392b'; }
  }

  function toggleNewProduct() {
    const box = document.getElementById('invNew');
    if (!box.hidden) { box.hidden = true; return; }
    const cell = 'font-size:.78rem;color:#7A6A52';
    box.innerHTML =
      '<h3 style="font-size:1rem;margin-bottom:.6rem">新增商品</h3>' +
      '<div style="display:flex;flex-wrap:wrap;gap:.8rem;align-items:end">' +
        '<label style="' + cell + '">網址代稱（英文小寫，建立後不能改）<br>' +
          '<span style="color:#2C2417">/products/</span><input id="inv-id-new" placeholder="lemon" style="width:140px;padding:.35rem"></label>' +
        '<label style="' + cell + '">供應狀態<br>' + statusSelect('new', 'upcoming') + '</label>' +
        '<label style="' + cell + '">現貨數量<br><input type="number" id="inv-st-new" value="0" min="0" style="width:80px;padding:.35rem"></label>' +
        '<label style="' + cell + '">價格 NT$<br><input type="number" id="inv-pr-new" min="0" placeholder="—" style="width:90px;padding:.35rem"></label>' +
      '</div>' +
      productFieldsHtml('new', { net_weight: '240g', shelf_life: '常溫 2 個月（未開封）',
        storage: '未開封常溫保存 2 個月；開封後請冷藏，2 週內食用完畢。',
        sort_order: (inventory.length || 0) + 1 }) +
      '<div style="margin-top:.8rem;display:flex;gap:.6rem;align-items:center">' +
        '<button class="refresh-btn" data-action="createProduct">建立商品</button>' +
        '<button class="refresh-btn" data-action="toggleNewProduct">取消</button>' +
        '<span id="inv-msg-new" style="font-size:.8rem"></span>' +
      '</div>';
    box.hidden = false;
  }

  async function createProduct() {
    const msg = document.getElementById('inv-msg-new');
    const id = document.getElementById('inv-id-new').value.trim().toLowerCase();
    const data = Object.assign({ id }, collectProduct('new'));
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) { msg.textContent = '網址代稱只能用英文小寫、數字與連字號，例如 lemon'; msg.style.color = '#c0392b'; return; }
    if (!data.name.trim()) { msg.textContent = '請填商品名稱'; msg.style.color = '#c0392b'; return; }
    if (!data.image) { msg.textContent = '請先上傳商品圖片'; msg.style.color = '#c0392b'; return; }
    msg.textContent = '建立中…'; msg.style.color = '#7A6A52';
    try {
      const res = await fetch(INV_API, {
        method: 'POST',
        headers: { 'x-csrf': CSRF, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { msg.textContent = out.error || ('失敗 (' + res.status + ')'); msg.style.color = '#c0392b'; return; }
      document.getElementById('invNew').hidden = true;
      loadInventory();
    } catch { msg.textContent = '連線失敗'; msg.style.color = '#c0392b'; }
  }

  // ── 載入訂單 ──────────────────────────────────
  // ── 肆菓筆記（D1 journal + R2 圖片）──────────────
  const JOURNAL_API  = '/admin-journal';
  const SETTINGS_API = '/admin-settings';
  const UPLOAD_API   = '/admin-upload';

  let journalPosts = [];
  let editingId    = null;   // null = 新文章
  let editingImage = '';
  let heroImage    = '';

  const jEsc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function jStatus(id, msg, kind) {
    const el = document.getElementById(id);
    el.textContent = msg || '';
    el.className = 'jstatus' + (kind ? ' ' + kind : '');
  }

  // 檔案直接當 body 送；檔名走標頭，非 ASCII 要先 encode 否則瀏覽器會擋
  async function uploadImage(file) {
    const res = await fetch(UPLOAD_API, {
      method: 'POST',
      headers: { 'x-csrf': CSRF, 'x-filename': encodeURIComponent(file.name) },
      body: file,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || ('上傳失敗（' + res.status + '）'));
    return out.url;
  }

  async function loadJournal() {
    const wrap = document.getElementById('journalWrap');
    wrap.innerHTML = '<div class="loading"><div class="spinner"></div>載入中…</div>';
    try {
      const res = await fetch(JOURNAL_API, { headers: { 'x-csrf': CSRF } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      journalPosts = Array.isArray(data) ? data : [];
      renderJournal();
    } catch (e) {
      wrap.innerHTML = '<div class="jstatus err">讀取失敗：' + jEsc(e.message || e) + '</div>';
    }
    loadHero();
  }

  function renderJournal() {
    const wrap = document.getElementById('journalWrap');
    if (!journalPosts.length) {
      wrap.innerHTML = '<div class="jhint">還沒有文章。按上面的「新增文章」開始寫第一篇。</div>';
      return;
    }
    wrap.innerHTML =
      '<table style="width:100%;border-collapse:collapse">' +
      '<thead><tr>' +
        '<th style="text-align:left;padding:8px;font-size:.75rem;color:#888">封面</th>' +
        '<th style="text-align:left;padding:8px;font-size:.75rem;color:#888">標題</th>' +
        '<th style="text-align:left;padding:8px;font-size:.75rem;color:#888">日期</th>' +
        '<th style="text-align:left;padding:8px;font-size:.75rem;color:#888">狀態</th>' +
        '<th style="text-align:right;padding:8px;font-size:.75rem;color:#888">操作</th>' +
      '</tr></thead><tbody>' +
      journalPosts.map(p =>
        '<tr style="border-top:1px solid var(--border)">' +
          '<td style="padding:8px">' +
            (p.image ? '<img src="' + jEsc(p.image) + '" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px">' : '—') +
          '</td>' +
          '<td style="padding:8px;font-size:.9rem">' + jEsc(p.title) +
            '<br><small style="color:#888">/stories/' + jEsc(p.slug || p.id) + '</small></td>' +
          '<td style="padding:8px;font-size:.85rem;color:#888">' + jEsc(p.date || '') + '</td>' +
          '<td style="padding:8px;font-size:.8rem;color:' + (p.published ? 'var(--sage)' : 'var(--muted)') + '">' +
            (p.published ? '已發佈' : '草稿') + '</td>' +
          '<td style="padding:8px;text-align:right;white-space:nowrap">' +
            '<button class="refresh-btn" data-action="editPost" data-arg="' + jEsc(JSON.stringify(p.id)) + '">編輯</button> ' +
            '<button class="jdel" data-action="deletePost" data-arg="' + jEsc(JSON.stringify(p.id)) + '">刪除</button>' +
          '</td>' +
        '</tr>').join('') +
      '</tbody></table>';
  }

  function fillEditor(p) {
    document.getElementById('fTitle').value     = p.title || '';
    document.getElementById('fSlug').value      = p.slug || '';
    document.getElementById('fExcerpt').value   = p.excerpt || '';
    document.getElementById('fBody').value      = p.body || '';
    document.getElementById('fDate').value      = p.date || new Date().toISOString().slice(0, 10);
    document.getElementById('fPublished').checked = p.published == null ? true : !!p.published;
    editingImage = p.image || '';
    showPostImage();
    document.getElementById('fImgFile').value = '';
    jStatus('editorStatus', '');
    document.getElementById('postEditor').hidden = false;
    document.getElementById('postEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function showPostImage() {
    const img = document.getElementById('fImgPreview');
    img.src = editingImage;
    img.hidden = !editingImage;
  }

  function newPost()  { editingId = null; fillEditor({}); }
  function editPost(id) {
    const p = journalPosts.find(x => x.id === id);
    if (!p) return;
    editingId = id;
    fillEditor(p);
  }
  function closeEditor() { document.getElementById('postEditor').hidden = true; }
  function clearPostImage() { editingImage = ''; showPostImage(); document.getElementById('fImgFile').value = ''; }

  async function pickPostImage(input) {
    const file = input.files?.[0];
    if (!file) return;
    jStatus('editorStatus', '圖片上傳中…');
    try {
      editingImage = await uploadImage(file);
      showPostImage();
      jStatus('editorStatus', '圖片已上傳，記得按儲存', 'ok');
    } catch (e) {
      jStatus('editorStatus', String(e.message || e), 'err');
    }
  }

  async function savePost() {
    const btn = document.getElementById('saveBtn');
    const payload = {
      title:     document.getElementById('fTitle').value.trim(),
      slug:      document.getElementById('fSlug').value.trim().toLowerCase(),
      excerpt:   document.getElementById('fExcerpt').value.trim(),
      body:      document.getElementById('fBody').value,
      image:     editingImage,
      date:      document.getElementById('fDate').value,
      published: document.getElementById('fPublished').checked,
    };
    if (!payload.title) { jStatus('editorStatus', '標題不能空白', 'err'); return; }
    if (payload.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(payload.slug)) { jStatus('editorStatus', '網址名稱只能用英文小寫、數字與連字號', 'err'); return; }
    if (editingId != null) payload.id = editingId;

    btn.disabled = true;
    jStatus('editorStatus', '儲存中…');
    try {
      const res = await fetch(JOURNAL_API, {
        method: editingId != null ? 'PATCH' : 'POST',
        headers: { 'x-csrf': CSRF, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const out = await res.json();
      if (!res.ok || !out.ok) throw new Error(out.error || res.status);
      jStatus('editorStatus', '已儲存', 'ok');
      closeEditor();
      loadJournal();
    } catch (e) {
      jStatus('editorStatus', '儲存失敗：' + (e.message || e), 'err');
    }
    btn.disabled = false;
  }

  async function deletePost(id) {
    const p = journalPosts.find(x => x.id === id);
    if (!confirm('確定刪除「' + (p?.title || id) + '」？刪除後無法復原。')) return;
    try {
      const res = await fetch(JOURNAL_API + '?id=' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { 'x-csrf': CSRF },
      });
      const out = await res.json();
      if (!res.ok || !out.ok) throw new Error(out.error || res.status);
      if (editingId === id) closeEditor();
      loadJournal();
    } catch (e) {
      alert('刪除失敗：' + (e.message || e));
    }
  }


  // ── 金流控制台（D1 settings：pay_<id>=on/off、bank_*）──────
  const PAY_ITEMS = [
    ['credit_card',   '信用卡 / Apple Pay', '綠界，付款完成自動確認'],
    ['line_pay',      'LINE Pay',           '尚未串接 API，前台固定顯示「即將開放」，不能開'],
    ['ecpay_atm',     'ATM 虛擬帳號',       '綠界，客人取得專屬帳號，付款完成自動確認'],
    ['ecpay_cvs',     '超商代碼',           '綠界，客人取得繳費代碼到超商付款'],
    ['bank_transfer', '銀行轉帳（一般帳戶）', '顯示下方公司帳號，人工對帳'],
  ];
  const BANK_FIELDS = [['bank_name','銀行名稱'],['bank_code','銀行代碼'],['bank_branch','分行名稱'],['bank_holder','戶名'],['bank_account','銀行帳號']];
  let paySettings = {};

  async function loadPay() {
    const box = document.getElementById('payPanel');
    try {
      const res = await fetch(SETTINGS_API, { headers: { 'x-csrf': CSRF } });
      paySettings = await res.json();
      if (!res.ok) throw new Error(paySettings.error || res.status);
      renderPay();
    } catch (e) {
      box.innerHTML = '<div class="jstatus err">讀取失敗：' + jEsc(e.message || e) + '</div>';
    }
  }

  function renderPay() {
    const rows = PAY_ITEMS.map(([id, name, hint]) => {
      const locked = id === 'line_pay';
      const on = !locked && paySettings['pay_' + id] !== 'off';
      return `<label style="display:flex;align-items:center;gap:.8rem;padding:.7rem .3rem;border-bottom:1px solid #eee;${locked ? 'opacity:.6' : 'cursor:pointer'}">
        <input type="checkbox" aria-label="${jEsc(name)} 開關" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''} data-change="togglePay" data-arg="${jEsc(JSON.stringify(id))}" style="width:20px;height:20px;accent-color:#7E9268">
        <span style="flex:1"><b>${name}</b><br><small style="color:#888">${hint}</small></span>
        <span style="font-size:.8rem;color:${on ? '#7E9268' : '#B5674A'}">${on ? '開放中' : (locked ? '即將開放' : '已停用')}</span>
      </label>`;
    }).join('');
    const bank = BANK_FIELDS.map(([k, label]) =>
      `<label style="display:block;font-size:.8rem;color:#666;margin-top:.6rem">${label}
        <input id="pay_${k}" value="${jEsc(paySettings[k] || '')}" style="display:block;width:100%;padding:.5rem;border:1px solid #ddd;border-radius:6px;font-size:.9rem"></label>`).join('');
    document.getElementById('payPanel').innerHTML = `
      <p class="jhint" style="margin:0 0 .4rem">勾選 = 前台客人可以選；取消勾選 = 卡片仍顯示但變灰、按不下去（並顯示「暫時無法使用」）。切換後立即生效。</p>
      ${rows}
      <h3 style="font-size:1rem;margin:1.2rem 0 0">銀行轉帳帳戶</h3>
      ${bank}
      <div style="margin-top:.9rem;display:flex;align-items:center;gap:.8rem">
        <button class="refresh-btn" data-action="saveBank">儲存帳戶</button><span class="jstatus" id="payStatus"></span>
      </div>`;
  }

  async function paySave(obj) {
    const res = await fetch(SETTINGS_API, {
      method: 'PATCH',
      headers: { 'x-csrf': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || res.status);
    Object.assign(paySettings, obj);
  }

  async function togglePay(id, box) {
    try { await paySave({ ['pay_' + id]: box.checked ? 'on' : 'off' }); renderPay(); }
    catch (e) { box.checked = !box.checked; alert('儲存失敗：' + (e.message || e)); }
  }

  async function saveBank() {
    const obj = Object.fromEntries(BANK_FIELDS.map(([k]) => [k, document.getElementById('pay_' + k).value.trim()]));
    try { await paySave(obj); jStatus('payStatus', '已儲存', 'ok'); }
    catch (e) { jStatus('payStatus', '儲存失敗：' + (e.message || e), 'err'); }
  }

  // ── 折扣碼（D1 discount_codes）：結帳時由伺服器判斷，這裡改完立即生效 ──
  let discounts = [];
  const DISC_COLS = 'padding:.5rem;font-size:.82rem;border-bottom:1px solid #eee;text-align:left';

  async function loadDiscounts() {
    const box = document.getElementById('discPanel');
    try {
      const res = await fetch('/admin-discounts');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      discounts = data;
      renderDiscounts();
    } catch (e) {
      box.innerHTML = '<div class="jstatus err">讀取失敗：' + jEsc(e.message || e) + '</div>';
    }
  }

  function renderDiscounts() {
    const rows = discounts.map((d, i) => `<tr>
      <td style="${DISC_COLS}"><b>${jEsc(d.code)}</b>${d.influencer ? '<br><small style="color:#888">網紅：' + jEsc(d.influencer) + '</small>' : ''}</td>
      <td style="${DISC_COLS}">${jEsc(d.type === 'percentage' ? d.value + '% OFF' : '折 NT$' + d.value)}</td>
      <td style="${DISC_COLS}">${d.min_order ? '滿 NT$' + jEsc(d.min_order) : '—'}</td>
      <td style="${DISC_COLS}">${jEsc(d.starts_at || '')}${d.starts_at || d.ends_at ? ' ～ ' : '不限'}${jEsc(d.ends_at || '')}</td>
      <td style="${DISC_COLS}">${jEsc(d.usage_count)}${d.usage_limit ? ' / ' + jEsc(d.usage_limit) : ''}</td>
      <td style="${DISC_COLS}"><label style="cursor:pointer"><input type="checkbox" ${d.enabled ? 'checked' : ''} data-change="toggleDiscount" data-arg="${i}" style="accent-color:#7E9268"> ${d.enabled ? '啟用' : '停用'}</label></td>
      <td style="${DISC_COLS}"><button class="refresh-btn" data-action="editDiscount" data-arg="${i}">編輯</button></td></tr>`).join('');
    document.getElementById('discPanel').innerHTML = `
      <table style="width:100%;border-collapse:collapse;min-width:620px">
        <thead><tr>${['折扣碼', '折扣', '門檻', '期間', '已使用', '狀態', ''].map(h => `<th style="${DISC_COLS};color:#888;font-weight:500">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="padding:1rem;color:#888">還沒有折扣碼</td></tr>'}</tbody>
      </table>
      <h3 style="font-size:.95rem;margin:1.2rem 0 .4rem" id="discFormTitle">新增折扣碼</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.6rem">
        ${[['dCode', '折扣碼（英文數字）', 'text'], ['dValue', '數值', 'number'], ['dMin', '最低消費（選填）', 'number'],
           ['dStart', '開始日（選填）', 'date'], ['dEnd', '結束日（選填）', 'date'], ['dLimit', '使用上限（選填）', 'number'],
           ['dInfluencer', '網紅名字（選填）', 'text']].map(([id, label, type]) =>
          `<label style="font-size:.78rem;color:#666">${label}<input id="${id}" type="${type}" style="display:block;width:100%;padding:.45rem;border:1px solid #ddd;border-radius:6px;font-size:.9rem"></label>`).join('')}
        <label style="font-size:.78rem;color:#666">類型<select id="dType" style="display:block;width:100%;padding:.45rem;border:1px solid #ddd;border-radius:6px;font-size:.9rem">
          <option value="percentage">百分比（10 = 9 折）</option><option value="fixed">固定金額（NT$）</option></select></label>
      </div>
      <div style="margin-top:.8rem;display:flex;gap:.8rem;align-items:center">
        <button class="refresh-btn" data-action="saveDiscount">儲存折扣碼</button><span class="jstatus" id="discStatus"></span>
      </div>`;
  }

  function editDiscount(i) {
    const d = discounts[i];
    const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
    set('dCode', d.code); set('dValue', d.value); set('dMin', d.min_order || ''); set('dStart', d.starts_at);
    set('dEnd', d.ends_at); set('dLimit', d.usage_limit); set('dInfluencer', d.influencer); set('dType', d.type);
    document.getElementById('discFormTitle').textContent = '編輯折扣碼 ' + d.code;
    document.getElementById('dCode').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function postDiscount(body) {
    const res = await fetch('/admin-discounts', {
      method: 'POST', headers: { 'x-csrf': CSRF, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || res.status);
  }

  async function saveDiscount() {
    const v = id => document.getElementById(id).value.trim();
    const old = discounts.find(d => d.code === v('dCode').toUpperCase());
    try {
      await postDiscount({ code: v('dCode'), type: v('dType'), value: v('dValue'), min_order: v('dMin'),
        starts_at: v('dStart'), ends_at: v('dEnd'), usage_limit: v('dLimit'), influencer: v('dInfluencer'),
        enabled: old ? !!old.enabled : true });
      await loadDiscounts();
      jStatus('discStatus', '已儲存', 'ok');
    } catch (e) { jStatus('discStatus', '儲存失敗：' + (e.message || e), 'err'); }
  }

  async function toggleDiscount(i, box) {
    const d = discounts[i];
    try { await postDiscount({ ...d, enabled: box.checked }); await loadDiscounts(); }
    catch (e) { box.checked = !box.checked; alert('儲存失敗：' + (e.message || e)); }
  }

  // ── 頁面頂部主視覺 ──────────────────────────────
  async function loadHero() {
    try {
      const res = await fetch(SETTINGS_API, { headers: { 'x-csrf': CSRF } });
      const s = await res.json();
      if (!res.ok) throw new Error(s.error || res.status);
      heroImage = s.journal_hero || '';
      showHero();
      jStatus('heroStatus', '');
    } catch (e) {
      jStatus('heroStatus', '讀取失敗：' + (e.message || e), 'err');
    }
  }

  function showHero() {
    const img = document.getElementById('heroPreview');
    img.src = heroImage;
    img.hidden = !heroImage;
  }

  async function saveHero(url) {
    const res = await fetch(SETTINGS_API, {
      method: 'PATCH',
      headers: { 'x-csrf': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ journal_hero: url }),
    });
    const out = await res.json();
    if (!res.ok || !out.ok) throw new Error(out.error || res.status);
  }

  async function pickHero(input) {
    const file = input.files?.[0];
    if (!file) return;
    jStatus('heroStatus', '上傳中…');
    try {
      heroImage = await uploadImage(file);
      await saveHero(heroImage);
      showHero();
      jStatus('heroStatus', '主視覺已更新', 'ok');
    } catch (e) {
      jStatus('heroStatus', String(e.message || e), 'err');
    }
    input.value = '';
  }

  async function clearHero() {
    try {
      await saveHero('');
      heroImage = '';
      showHero();
      jStatus('heroStatus', '已移除主視覺', 'ok');
    } catch (e) {
      jStatus('heroStatus', String(e.message || e), 'err');
    }
  }

  async function loadOrders() {
    document.getElementById('tableWrap').innerHTML =
      '<div class="loading"><div class="spinner"></div>載入中…</div>';

    try {
      let records = [];
      let offset  = null;

      do {
        const url = API + (offset ? `?offset=${encodeURIComponent(offset)}` : '');
        const res = await fetch(url, { headers: { 'x-csrf': CSRF } });
        if (res.status === 401) { sessionStorage.removeItem('sf_admin_key'); location.reload(); return; }
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || data.error);
        if (!offset) document.getElementById('syncWarn').hidden = !data.unsynced;
        if (!offset && data.unsynced) document.getElementById('syncWarn').textContent =
          `有 ${data.unsynced} 筆訂單還沒同步到 Airtable（訂單已存在網站資料庫，不會遺失）。重新整理會再試一次；一直失敗請檢查 AIRTABLE_TOKEN。`;
        records = records.concat(data.records || []);
        offset  = data.offset;
      } while (offset);

      // 用真正的「時間」排序（新→舊）。
      // 舊版拿日期字串直接比會出錯：字串比較會把 9/9 判成比 9/12 大，
      // 導致新訂單被壓到舊訂單下面、不在最上面。
      allOrders = records.sort((a, b) => {
        const da = parseCreatedAt(a.fields.created_at);
        const db = parseCreatedAt(b.fields.created_at);
        const va = da ? da.getTime() : 0;
        const vb = db ? db.getTime() : 0;
        if (vb !== va) return vb - va;
        // 時間相同或都解析不出來時，退回用字串比，維持穩定排序
        return (b.fields.created_at || '').localeCompare(a.fields.created_at || '');
      });

      updateStats();
      renderChart();
      renderTable();
    } catch (err) {
      document.getElementById('tableWrap').innerHTML =
        `<div class="empty-state"><p>⚠️ 載入失敗：${jEsc(err.message)}</p></div>`;
    }
  }

  // ── 統計 ──────────────────────────────────────
  function updateStats() {
    const f = allOrders.map(r => r.fields);
    document.getElementById('statTotal').textContent   = f.length;
    document.getElementById('statPending').textContent = f.filter(x => x.status === '待付款').length;
    document.getElementById('statPaid').textContent    = f.filter(x => x.status === '已付款').length;
    const revenue = f.filter(x => ['已付款','已出貨','完成'].includes(x.status))
                     .reduce((s, x) => s + (x.total || 0), 0);
    document.getElementById('statRevenue').textContent = `NT$ ${revenue.toLocaleString()}`;
  }

  // ── 圖表 ──────────────────────────────────────
  function parseCreatedAt(str) {
    if (!str) return null;
    const isPM = str.includes('下午');
    const cleaned = str.replace('下午','').replace('上午','').trim().replace(/\//g, '-');
    const d = new Date(cleaned);
    if (isNaN(d)) return null;
    if (isPM && d.getHours() < 12) d.setHours(d.getHours() + 12);
    return d;
  }

  function setChartPeriod(period, btn) {
    chartPeriod = period;
    document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderChart();
  }

  function renderChart() {
    const paid = allOrders.filter(r => ['已付款','已出貨','完成'].includes(r.fields.status));
    const groups = {};

    paid.forEach(r => {
      const d = parseCreatedAt(r.fields.created_at);
      if (!d) return;
      let key;
      if (chartPeriod === 'day') {
        key = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
      } else if (chartPeriod === 'week') {
        const w = new Date(d);
        w.setDate(w.getDate() - w.getDay());
        key = `${w.getFullYear()}/${w.getMonth()+1}/${w.getDate()}`;
      } else {
        key = `${d.getFullYear()}/${d.getMonth()+1}`;
      }
      if (!groups[key]) groups[key] = { revenue: 0, orders: 0 };
      groups[key].revenue += r.fields.total || 0;
      groups[key].orders  += 1;
    });

    const labels   = Object.keys(groups).sort();
    const revenues = labels.map(k => groups[k].revenue);
    const counts   = labels.map(k => groups[k].orders);

    const ctx = document.getElementById('salesChart').getContext('2d');
    if (salesChart) salesChart.destroy();

    salesChart = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: '營收 NT$',
            data: revenues,
            backgroundColor: 'rgba(200,119,58,0.65)',
            borderColor: 'rgba(200,119,58,1)',
            borderWidth: 1,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: '訂單數',
            data: counts,
            borderColor: 'rgba(122,158,126,1)',
            backgroundColor: 'rgba(122,158,126,0.1)',
            borderWidth: 2,
            pointRadius: 4,
            tension: 0.3,
            yAxisID: 'y1',
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y:  {
            position: 'left',
            ticks: { callback: v => 'NT$' + v.toLocaleString() },
            grid: { color: '#f0ede9' }
          },
          y1: {
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { stepSize: 1 }
          },
          x: { grid: { color: '#f0ede9' } }
        },
        plugins: {
          legend: { position: 'top', labels: { font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => ctx.dataset.label === '營收 NT$'
                ? ` NT$ ${ctx.parsed.y.toLocaleString()}`
                : ` ${ctx.parsed.y} 筆`
            }
          }
        }
      }
    });
  }

  // ── 回頭客偵測 ────────────────────────────────
  function buildPhoneMap() {
    const map = {};
    allOrders.forEach(r => {
      const p = r.fields.phone;
      if (p) map[p] = (map[p] || 0) + 1;
    });
    return map;
  }

  // ── 篩選 ──────────────────────────────────────
  function setFilter(filter, btn) {
    activeFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderTable();
  }

  // ── 渲染表格 ──────────────────────────────────
  function renderTable() {
    const filtered = activeFilter === 'all'
      ? allOrders
      : allOrders.filter(r => r.fields.status === activeFilter);

    if (filtered.length === 0) {
      document.getElementById('tableWrap').innerHTML =
        '<div class="empty-state"><p>目前沒有訂單</p></div>';
      return;
    }

    const phoneMap = buildPhoneMap();

    const rows = filtered.map(r => {
      const f = r.fields;
      const email      = getEmailFromNote(f.note);
      const cleanNote  = getCleanNote(f.note);
      const isReturning = (phoneMap[f.phone] || 0) > 1;
      const mailtoHref = email
        ? 'mailto:' + encodeURIComponent(email) +
          '?subject=' + encodeURIComponent(`【肆菓 Season Flavor】訂單確認 ${f.order_id}`) +
          '&body=' + encodeURIComponent(`您好 ${f.name || ''}，\n\n感謝您的訂購！\n\n訂單編號：${f.order_id}\n商品：${(f.items||'').replace(/\n/g,' | ')}\n金額：NT$ ${f.total || 0}\n\n請於 3 天內完成 ATM 轉帳，轉帳後請截圖傳至 IG @seasonflavor_ 。\n\n肆菓 Season Flavor`)
        : '';

      return `
        <tr class="${isReturning ? 'returning-customer' : ''}">
          <td>
            ${f.order_id ? `<button type="button" class="order-id order-link" data-action="openOrder" data-arg="${jEsc(JSON.stringify(f.order_id))}" title="查看訂單詳情">${jEsc(f.order_id)}</button>` : '—'}<br>
            <span style="font-size:.76rem;color:var(--muted)">${jEsc(f.created_at || '')}</span>
          </td>
          <td>
            <strong>${jEsc(f.name || '—')}</strong>${isReturning ? '<span class="returning-badge">回頭客</span>' : ''}<br>
            <span style="font-size:.8rem;color:var(--muted)">${jEsc(f.phone || '')}</span><br>
            ${email ? `<a href="${jEsc(mailtoHref)}" style="font-size:.76rem;color:var(--orange);text-decoration:none" title="寄信給客戶">✉ ${jEsc(email)}</a>` : ''}
          </td>
          <td class="items-cell">${jEsc(f.items || '—')}</td>
          <td class="total-cell">NT$ ${jEsc((f.total || 0).toLocaleString())}</td>
          <td>${jEsc(f.payment || '—')}</td>
          <td>
            <select class="status-select" data-change="updateStatus" data-arg="${jEsc(JSON.stringify(r.id))}">
              ${['待付款','已付款','已出貨','完成','已取消','已退款'].map(s =>
                `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`
              ).join('')}
            </select>
          </td>
          <td class="note-cell">
            ${jEsc(f.address || '')}
            ${cleanNote ? '<br><span style="color:var(--muted)">' + jEsc(cleanNote) + '</span>' : ''}
          </td>
        </tr>`;
    }).join('');

    document.getElementById('tableWrap').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>訂單編號 / 時間</th>
            <th>客戶</th>
            <th>商品</th>
            <th>金額</th>
            <th>付款方式</th>
            <th>狀態</th>
            <th>地址 / 備註</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ── 解析 Email ────────────────────────────────
  function getEmailFromNote(note) {
    if (!note) return '';
    const m = note.match(/Email:\s*([^\n]+)/);
    return m ? m[1].trim() : '';
  }
  function getCleanNote(note) {
    if (!note) return '';
    return note.replace(/Email:[^\n]*\n?/, '').trim();
  }

  // ── 匯出 CSV ──────────────────────────────────
  function exportCSV() {
    if (allOrders.length === 0) { alert('目前沒有訂單可匯出'); return; }
    const target = activeFilter === 'all' ? allOrders : allOrders.filter(r => r.fields.status === activeFilter);
    const headers = ['訂單編號','時間','姓名','電話','Email','回頭客','商品明細','金額(NT$)','付款方式','狀態','收件地址','備註'];
    const phoneMap = buildPhoneMap();
    const esc = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const rows = target.map(r => {
      const f = r.fields;
      return [
        f.order_id || '',
        f.created_at || '',
        f.name || '',
        f.phone || '',
        getEmailFromNote(f.note),
        (phoneMap[f.phone] || 0) > 1 ? '是' : '',
        (f.items || '').replace(/\n/g, ' | '),
        f.total || 0,
        f.payment || '',
        f.status || '',
        f.address || '',
        getCleanNote(f.note),
      ].map(esc).join(',');
    });
    const csv = '﻿' + [headers.map(esc).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `肆菓訂單_${activeFilter === 'all' ? '全部' : activeFilter}_${new Date().toLocaleDateString('zh-TW').replace(/\//g,'-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── 更新狀態 ──────────────────────────────────
  async function updateStatus(recordId, newStatus) {
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'x-csrf': CSRF, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, fields: { status: newStatus } }),
      });
      if (res.status === 401) { location.reload(); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '更新失敗');
      const rec = allOrders.find(r => r.id === recordId);
      if (rec) rec.fields.status = newStatus;
      updateStats();
      renderChart();
    } catch (err) {
      alert('狀態更新失敗：' + (err.message || err));
      renderTable();   // 下拉選單回到原本的狀態
    }
  }

  // ── 事件委派（CSP 不允許 inline onclick/onchange）──────────
  // data-action = 點擊、data-change = 變更；data-arg 是 JSON（保留數字／字串型別）
  const arg = el => JSON.parse(el.dataset.arg);
  const CLICK = {
    login, logout, logoutAll, toggleNewProduct, loadInventory, loadPay, loadDiscounts, newPost, loadJournal,
    clearHero, clearPostImage, closeEditor, savePost, exportCSV, loadOrders, createProduct, saveBank, saveDiscount,
    setChartPeriod: el => setChartPeriod(arg(el), el),
    setFilter:      el => setFilter(arg(el), el),
    saveInventory:  el => saveInventory(arg(el)),
    editPost:       el => editPost(arg(el)),
    deletePost:     el => deletePost(arg(el)),
    editDiscount:   el => editDiscount(arg(el)),
    openOrder:      el => openOrder(arg(el)),
    closeOrder,
  };
  const CHANGE = {
    pickHero, pickPostImage,
    pickProductImage: el => pickProductImage(el, arg(el)),
    togglePay:        el => togglePay(arg(el), el),
    toggleDiscount:   el => toggleDiscount(arg(el), el),
    updateStatus:     el => updateStatus(arg(el), el.value),
  };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el && CLICK[el.dataset.action]) CLICK[el.dataset.action](el);
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (el && CHANGE[el.dataset.change]) CHANGE[el.dataset.change](el);
  });

// ── Bento 後台：進場動畫、數字跳動、側邊欄目前位置 ──
(() => {
  const body = document.querySelector('.admin-body');
  if (body) body.classList.add('b-in');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 統計數字從 0 跳到目標值（只處理純數字，NT$ 也支援）
  const animate = (el) => {
    const m = el.textContent.match(/^(\D*)([\d,]+)(\D*)$/);
    if (!m || reduce || el.dataset.counting || el.dataset.shown === el.textContent) return;
    const target = Number(m[2].replace(/,/g, ''));
    if (!target) return;
    el.dataset.counting = '1';
    const t0 = performance.now(), dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = m[1] + Math.round(target * e).toLocaleString() + m[3];
      if (k < 1) requestAnimationFrame(step); else { el.dataset.shown = el.textContent; delete el.dataset.counting; }
    };
    requestAnimationFrame(step);
  };
  document.querySelectorAll('.stat-value').forEach((el) => {
    new MutationObserver(() => animate(el)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  // 每個區塊是獨立的一頁：側邊欄切換，只顯示目前這頁（網址 #products 這類，可直接分享或重新整理停在同一頁）
  const views = {};
  let cur = null;
  [...(body?.children || [])].forEach((el) => {
    if (el.id && el.id.startsWith('sec-')) cur = el.id;
    if (cur) (views[cur] = views[cur] || []).push(el);
  });
  const links = [...document.querySelectorAll('.bnav a')];
  const show = (id) => {
    if (!views[id]) id = 'sec-dash';
    for (const [k, els] of Object.entries(views)) els.forEach((el) => el.classList.toggle('b-off', k !== id));
    links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + id));
    // 換頁時重播進場動畫
    body.classList.remove('b-in'); void body.offsetWidth; body.classList.add('b-in');
    window.scrollTo(0, 0);
  };
  links.forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const id = a.getAttribute('href').slice(1);
    history.replaceState(null, '', '#' + id.replace('sec-', ''));
    show(id);
  }));
  show('sec-' + (location.hash.slice(1) || 'dash'));
})();
