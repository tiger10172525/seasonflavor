// ============================================
// 肆菓 Season Flavor — 後台管理 SPA
// ============================================
'use strict';

// ---------- 共用 ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || '發生錯誤');
    err.status = res.status;
    throw err;
  }
  return data;
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function fmt(n) { return 'NT$ ' + Number(n).toLocaleString('zh-Hant-TW'); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString('zh-Hant-TW', { hour12: false }) : '—'; }

const ORDER_STATUS = {
  pending: '待處理', paid: '已付款', shipped: '已出貨',
  completed: '已完成', cancelled: '已取消',
};
const PAY_STATUS = { unpaid: '未付款', reported: '已回報匯款', paid: '已收款', refunded: '已退款' };
const PAY_METHOD = { bank_transfer: '銀行轉帳', cod: '貨到付款', linepay: 'LINE Pay', credit_card: '信用卡' };
const SHIP_METHOD = { home: '宅配', pickup: '自取' };

const main = document.getElementById('adminMain');

// ---------- 彈窗 ----------
const backdrop = document.getElementById('modalBackdrop');
const modalBox = document.getElementById('modalBox');
function openModal(html) {
  modalBox.innerHTML = `<button class="modal-close" onclick="closeModal()">✕</button>` + html;
  backdrop.classList.add('show');
}
function closeModal() { backdrop.classList.remove('show'); modalBox.innerHTML = ''; }
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

// ---------- 登入閘門 ----------
async function boot() {
  let user = null;
  try { ({ user } = await api('/api/me')); } catch { /* 未登入 */ }
  if (user && user.role === 'admin') {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('adminView').style.display = '';
    renderView('dashboard');
  } else {
    document.getElementById('loginView').style.display = '';
    document.getElementById('adminView').style.display = 'none';
  }
}

document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('adminLoginError');
  errBox.classList.remove('show');
  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('adminEmail').value,
        password: document.getElementById('adminPassword').value,
      },
    });
    if (user.role !== 'admin') throw new Error('此帳號沒有管理權限');
    boot();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.add('show');
  }
});

document.getElementById('adminLogout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: {} });
  location.reload();
});

// ---------- 導覽 ----------
document.getElementById('adminNav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  document.querySelectorAll('#adminNav button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderView(btn.dataset.view);
});

function renderView(view) {
  const views = {
    dashboard: renderDashboard,
    orders: renderOrders,
    products: renderProducts,
    customers: renderCustomers,
    messages: renderMessages,
    settings: renderSettings,
  };
  main.innerHTML = '<p class="muted">載入中…</p>';
  views[view]().catch((err) => {
    main.innerHTML = `<p class="muted">載入失敗：${esc(err.message)}</p>`;
  });
}

// ---------- 總覽 ----------
async function renderDashboard() {
  const s = await api('/api/admin/stats');
  main.innerHTML = `
    <h1 class="admin-title">總覽</h1>
    <div class="stat-grid">
      <div class="stat-card"><div class="label">總營收（已付款）</div><div class="value">${fmt(s.revenue)}</div><div class="sub">近 30 天 ${fmt(s.revenue30)}</div></div>
      <div class="stat-card"><div class="label">待處理訂單</div><div class="value">${s.byStatus.pending || 0}</div><div class="sub">已出貨 ${s.byStatus.shipped || 0}・已完成 ${s.byStatus.completed || 0}</div></div>
      <div class="stat-card"><div class="label">會員數</div><div class="value">${s.memberCount}</div><div class="sub">顧客資料 ${s.customerCount} 筆</div></div>
      <div class="stat-card"><div class="label">未讀訊息</div><div class="value">${s.newMessages}</div><div class="sub">聯絡表單</div></div>
    </div>
    <div class="panel">
      <h3>最新訂單</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>訂單編號</th><th>顧客</th><th>金額</th><th>付款</th><th>狀態</th><th>時間</th></tr></thead>
        <tbody>
          ${s.recentOrders.map((o) => `
            <tr>
              <td>${esc(o.code)}</td>
              <td>${esc(o.customerName)}</td>
              <td>${fmt(o.total)}</td>
              <td><span class="pill ${o.paymentStatus}">${PAY_STATUS[o.paymentStatus]}</span></td>
              <td><span class="pill ${o.status}">${ORDER_STATUS[o.status]}</span></td>
              <td class="muted">${fmtDate(o.createdAt)}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">還沒有訂單</td></tr>'}
        </tbody>
      </table></div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
      <div class="panel">
        <h3>熱賣商品</h3>
        <table class="table">
          <thead><tr><th>商品</th><th class="right">銷量</th><th class="right">營收</th></tr></thead>
          <tbody>
            ${s.topProducts.map((p) => `<tr><td>${esc(p.name)}</td><td class="right">${p.qty}</td><td class="right">${fmt(p.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">尚無銷售資料</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="panel">
        <h3>低庫存提醒（≤ 10）</h3>
        <table class="table">
          <thead><tr><th>商品</th><th class="right">剩餘庫存</th></tr></thead>
          <tbody>
            ${s.lowStock.map((p) => `<tr><td>${esc(p.name)}</td><td class="right">${p.stock}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">庫存都很充足</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ---------- 訂單管理 ----------
async function renderOrders() {
  main.innerHTML = `
    <h1 class="admin-title">訂單管理</h1>
    <div class="toolbar">
      <select id="orderStatusFilter">
        <option value="">全部狀態</option>
        ${Object.entries(ORDER_STATUS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <input type="search" id="orderSearch" placeholder="搜尋編號 / 姓名 / 信箱 / 電話" style="flex: 1; max-width: 320px;" />
    </div>
    <div class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>訂單編號</th><th>顧客</th><th>金額</th><th>付款方式</th><th>付款</th><th>狀態</th><th>時間</th></tr></thead>
      <tbody id="orderRows"></tbody>
    </table></div></div>`;

  async function load() {
    const status = document.getElementById('orderStatusFilter').value;
    const q = document.getElementById('orderSearch').value.trim();
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    const { orders } = await api('/api/admin/orders?' + params);
    document.getElementById('orderRows').innerHTML = orders.map((o) => `
      <tr class="clickable" data-order="${o.id}">
        <td>${esc(o.code)}</td>
        <td>${esc(o.customerName)}<br /><span class="muted">${esc(o.email)}</span></td>
        <td>${fmt(o.total)}</td>
        <td>${PAY_METHOD[o.paymentMethod] || esc(o.paymentMethod)}</td>
        <td><span class="pill ${o.paymentStatus}">${PAY_STATUS[o.paymentStatus]}</span></td>
        <td><span class="pill ${o.status}">${ORDER_STATUS[o.status]}</span></td>
        <td class="muted">${fmtDate(o.createdAt)}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">沒有符合的訂單</td></tr>';
  }

  document.getElementById('orderStatusFilter').addEventListener('change', load);
  let searchTimer;
  document.getElementById('orderSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 300);
  });
  document.getElementById('orderRows').addEventListener('click', (e) => {
    const row = e.target.closest('[data-order]');
    if (row) openOrderModal(Number(row.dataset.order), load);
  });
  await load();
}

async function openOrderModal(id, onUpdate) {
  const { order: o } = await api(`/api/admin/orders/${id}`);
  openModal(`
    <h3>訂單 ${esc(o.code)}</h3>
    <div class="aerror" id="orderModalError"></div>
    <p class="muted" style="margin-bottom: 1rem;">
      ${esc(o.customerName)}・${esc(o.phone)}・${esc(o.email)}<br />
      ${SHIP_METHOD[o.shippingMethod]}${o.address ? '：' + esc(o.address) : ''}<br />
      下單時間：${fmtDate(o.createdAt)}
      ${o.note ? `<br />備註：${esc(o.note)}` : ''}
      ${o.transferLast5 ? `<br /><strong>匯款後五碼：${esc(o.transferLast5)}</strong>` : ''}
    </p>
    <table class="table" style="margin-bottom: 1.25rem;">
      <thead><tr><th>品項</th><th class="right">單價</th><th class="right">數量</th><th class="right">小計</th></tr></thead>
      <tbody>
        ${o.items.map((it) => `<tr><td>${esc(it.name)}</td><td class="right">${fmt(it.price)}</td><td class="right">${it.qty}</td><td class="right">${fmt(it.price * it.qty)}</td></tr>`).join('')}
        <tr><td colspan="3" class="right muted">運費</td><td class="right">${fmt(o.shippingFee)}</td></tr>
        <tr><td colspan="3" class="right"><strong>合計</strong></td><td class="right"><strong>${fmt(o.total)}</strong></td></tr>
      </tbody>
    </table>
    <div class="afield-row">
      <div class="afield">
        <label>訂單狀態</label>
        <select id="modalOrderStatus">
          ${Object.entries(ORDER_STATUS).map(([v, l]) => `<option value="${v}" ${v === o.status ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="afield">
        <label>付款狀態（${PAY_METHOD[o.paymentMethod] || o.paymentMethod}）</label>
        <select id="modalPayStatus">
          ${Object.entries(PAY_STATUS).map(([v, l]) => `<option value="${v}" ${v === o.paymentStatus ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <button class="abtn" id="saveOrderBtn">儲存變更</button>
  `);
  document.getElementById('saveOrderBtn').addEventListener('click', async () => {
    const errBox = document.getElementById('orderModalError');
    errBox.classList.remove('show');
    try {
      await api(`/api/admin/orders/${id}`, {
        method: 'PUT',
        body: {
          status: document.getElementById('modalOrderStatus').value,
          paymentStatus: document.getElementById('modalPayStatus').value,
        },
      });
      closeModal();
      onUpdate?.();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('show');
    }
  });
}

// ---------- 商品管理 ----------
async function renderProducts() {
  main.innerHTML = `
    <h1 class="admin-title">商品管理</h1>
    <div class="toolbar">
      <button class="abtn" id="newProductBtn">＋ 新增商品</button>
    </div>
    <div class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>商品</th><th>網址代稱</th><th class="right">價格</th><th class="right">庫存</th><th>狀態</th><th>上架</th><th></th></tr></thead>
      <tbody id="productRows"></tbody>
    </table></div></div>`;

  let products = [];
  async function load() {
    ({ products } = await api('/api/admin/products'));
    document.getElementById('productRows').innerHTML = products.map((p) => `
      <tr>
        <td>${esc(p.name)}<br /><span class="muted">${esc(p.name_en || '')}</span></td>
        <td class="muted">${esc(p.slug)}</td>
        <td class="right">${fmt(p.price)}</td>
        <td class="right">${p.stock}</td>
        <td><span class="pill ${p.badge === 'available' ? 'paid' : 'pending'}">${p.badge === 'available' ? '現貨' : '即將推出'}</span></td>
        <td>${p.active ? '✓' : '<span class="muted">已下架</span>'}</td>
        <td class="right"><button class="abtn small ghost" data-edit="${p.id}">編輯</button></td>
      </tr>`).join('');
  }

  function productModal(p) {
    openModal(`
      <h3>${p ? '編輯商品' : '新增商品'}</h3>
      <div class="aerror" id="productModalError"></div>
      <div class="afield-row">
        <div class="afield"><label>商品名稱 *</label><input id="pmName" value="${esc(p?.name || '')}" /></div>
        <div class="afield"><label>英文名稱</label><input id="pmNameEn" value="${esc(p?.name_en || '')}" /></div>
      </div>
      <div class="afield-row">
        <div class="afield"><label>網址代稱 *（小寫英數與 -）</label><input id="pmSlug" value="${esc(p?.slug || '')}" placeholder="strawberry-jam" /></div>
        <div class="afield"><label>圖片路徑</label><input id="pmImage" value="${esc(p?.image || '')}" placeholder="/images/strawberry.jpg" /></div>
      </div>
      <div class="afield"><label>一句話介紹</label><input id="pmTagline" value="${esc(p?.tagline || '')}" /></div>
      <div class="afield"><label>完整介紹（商品頁顯示）</label><textarea id="pmDesc" rows="4">${esc(p?.description || '')}</textarea></div>
      <div class="afield-row">
        <div class="afield"><label>價格（NT$）*</label><input id="pmPrice" type="number" min="0" value="${p?.price ?? ''}" /></div>
        <div class="afield"><label>庫存 *</label><input id="pmStock" type="number" min="0" value="${p?.stock ?? 0}" /></div>
      </div>
      <div class="afield-row">
        <div class="afield">
          <label>販售狀態</label>
          <select id="pmBadge">
            <option value="available" ${p?.badge === 'available' || !p ? 'selected' : ''}>現貨販售</option>
            <option value="coming" ${p?.badge === 'coming' ? 'selected' : ''}>即將推出（不可購買）</option>
          </select>
        </div>
        <div class="afield">
          <label>上架</label>
          <select id="pmActive">
            <option value="1" ${(p?.active ?? 1) ? 'selected' : ''}>上架中</option>
            <option value="0" ${p && !p.active ? 'selected' : ''}>下架（前台隱藏）</option>
          </select>
        </div>
      </div>
      <div class="afield"><label>排序（數字小在前）</label><input id="pmSort" type="number" value="${p?.sort ?? 0}" /></div>
      <button class="abtn" id="saveProductBtn">${p ? '儲存變更' : '建立商品'}</button>
    `);
    document.getElementById('saveProductBtn').addEventListener('click', async () => {
      const errBox = document.getElementById('productModalError');
      errBox.classList.remove('show');
      const body = {
        name: document.getElementById('pmName').value,
        nameEn: document.getElementById('pmNameEn').value,
        slug: document.getElementById('pmSlug').value,
        image: document.getElementById('pmImage').value,
        tagline: document.getElementById('pmTagline').value,
        description: document.getElementById('pmDesc').value,
        price: document.getElementById('pmPrice').value,
        stock: document.getElementById('pmStock').value,
        badge: document.getElementById('pmBadge').value,
        active: document.getElementById('pmActive').value === '1',
        sort: document.getElementById('pmSort').value,
      };
      try {
        if (p) await api(`/api/admin/products/${p.id}`, { method: 'PUT', body });
        else await api('/api/admin/products', { method: 'POST', body });
        closeModal();
        load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.add('show');
      }
    });
  }

  document.getElementById('newProductBtn').addEventListener('click', () => productModal(null));
  document.getElementById('productRows').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit]');
    if (btn) productModal(products.find((p) => p.id === Number(btn.dataset.edit)));
  });
  await load();
}

// ---------- 顧客 CRM ----------
async function renderCustomers() {
  main.innerHTML = `
    <h1 class="admin-title">顧客 CRM</h1>
    <div class="toolbar">
      <input type="search" id="customerSearch" placeholder="搜尋姓名 / 信箱 / 電話" style="flex: 1; max-width: 320px;" />
    </div>
    <div class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>顧客</th><th>身分</th><th>標籤</th><th class="right">訂單數</th><th class="right">累積消費</th><th>最近下單</th></tr></thead>
      <tbody id="customerRows"></tbody>
    </table></div></div>`;

  async function load() {
    const q = document.getElementById('customerSearch').value.trim();
    const { customers } = await api('/api/admin/customers' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    document.getElementById('customerRows').innerHTML = customers.map((c) => `
      <tr class="clickable" data-customer="${c.id}">
        <td>${esc(c.name || '—')}<br /><span class="muted">${esc(c.email)}</span></td>
        <td>${c.isMember ? '<span class="pill paid">會員</span>' : '<span class="pill">訪客</span>'}</td>
        <td>${c.tags.map((t) => `<span class="pill tag">${esc(t)}</span>`).join('') || '<span class="muted">—</span>'}</td>
        <td class="right">${c.orderCount}</td>
        <td class="right">${fmt(c.totalSpent)}</td>
        <td class="muted">${c.lastOrderAt ? fmtDate(c.lastOrderAt) : '—'}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">沒有顧客資料</td></tr>';
  }

  let searchTimer;
  document.getElementById('customerSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 300);
  });
  document.getElementById('customerRows').addEventListener('click', (e) => {
    const row = e.target.closest('[data-customer]');
    if (row) openCustomerModal(Number(row.dataset.customer), load);
  });
  await load();
}

async function openCustomerModal(id, onUpdate) {
  const { customer: c, orders, notes } = await api(`/api/admin/customers/${id}`);
  openModal(`
    <h3>${esc(c.name || c.email)}</h3>
    <p class="muted" style="margin-bottom: 1rem;">
      ${esc(c.email)}${c.phone ? '・' + esc(c.phone) : ''}・${c.isMember ? '會員' : '訪客'}・
      建檔 ${fmtDate(c.createdAt)}<br />
      累計 ${c.orderCount} 筆訂單，共 ${fmt(c.totalSpent)}
    </p>

    <div class="afield">
      <label>顧客標籤（逗號分隔，例如：VIP, 回購客, 喜歡草莓）</label>
      <div style="display: flex; gap: 0.5rem;">
        <input id="cmTags" value="${esc(c.tags.join(', '))}" style="flex: 1;" />
        <button class="abtn small" id="saveTagsBtn">儲存</button>
      </div>
    </div>

    <h3 style="margin-top: 1.25rem;">CRM 備註</h3>
    <div class="afield">
      <div style="display: flex; gap: 0.5rem;">
        <input id="cmNewNote" placeholder="例如：對草莓過敏 / 上次客訴已處理 / VIP 優先出貨" style="flex: 1;" />
        <button class="abtn small" id="addNoteBtn">新增</button>
      </div>
    </div>
    <div id="cmNotes">
      ${notes.map((n) => `
        <div class="note-item">
          ${esc(n.body)}
          <div class="note-meta">${esc(n.author)}・${fmtDate(n.createdAt)}
            <button class="abtn small ghost" data-delnote="${n.id}" style="margin-left: 0.5rem;">刪除</button>
          </div>
        </div>`).join('') || '<p class="muted">還沒有備註</p>'}
    </div>

    <h3 style="margin-top: 1.25rem;">訂單紀錄</h3>
    <table class="table">
      <thead><tr><th>編號</th><th class="right">金額</th><th>狀態</th><th>時間</th></tr></thead>
      <tbody>
        ${orders.map((o) => `
          <tr><td>${esc(o.code)}</td><td class="right">${fmt(o.total)}</td>
          <td><span class="pill ${o.status}">${ORDER_STATUS[o.status]}</span></td>
          <td class="muted">${fmtDate(o.createdAt)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">沒有訂單</td></tr>'}
      </tbody>
    </table>
  `);

  document.getElementById('saveTagsBtn').addEventListener('click', async () => {
    const tags = document.getElementById('cmTags').value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    await api(`/api/admin/customers/${id}/tags`, { method: 'PUT', body: { tags } });
    onUpdate?.();
  });
  document.getElementById('addNoteBtn').addEventListener('click', async () => {
    const body = document.getElementById('cmNewNote').value.trim();
    if (!body) return;
    await api(`/api/admin/customers/${id}/notes`, { method: 'POST', body: { body } });
    openCustomerModal(id, onUpdate);
  });
  document.getElementById('cmNotes').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delnote]');
    if (!btn) return;
    await api(`/api/admin/customers/${id}/notes/${btn.dataset.delnote}`, { method: 'DELETE' });
    openCustomerModal(id, onUpdate);
  });
}

// ---------- 聯絡訊息 ----------
async function renderMessages() {
  main.innerHTML = `
    <h1 class="admin-title">聯絡訊息</h1>
    <div class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>寄件人</th><th>內容</th><th>狀態</th><th>時間</th><th></th></tr></thead>
      <tbody id="messageRows"></tbody>
    </table></div></div>`;

  const STATUS = { new: '未讀', read: '已讀', replied: '已回覆' };
  async function load() {
    const { messages } = await api('/api/admin/messages');
    document.getElementById('messageRows').innerHTML = messages.map((msg) => `
      <tr>
        <td>${esc(msg.name)}<br /><span class="muted">${esc(msg.email)}</span></td>
        <td style="max-width: 360px; white-space: pre-wrap;">${esc(msg.body)}</td>
        <td><span class="pill ${msg.status}">${STATUS[msg.status]}</span></td>
        <td class="muted">${fmtDate(msg.createdAt)}</td>
        <td class="right" style="white-space: nowrap;">
          ${msg.status === 'new' ? `<button class="abtn small ghost" data-msg="${msg.id}" data-status="read">標為已讀</button>` : ''}
          ${msg.status !== 'replied' ? `<button class="abtn small" data-msg="${msg.id}" data-status="replied">標為已回覆</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">沒有訊息</td></tr>';
  }

  document.getElementById('messageRows').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-msg]');
    if (!btn) return;
    await api(`/api/admin/messages/${btn.dataset.msg}`, { method: 'PUT', body: { status: btn.dataset.status } });
    load();
  });
  await load();
}

// ---------- 商店設定 ----------
async function renderSettings() {
  const { settings: s } = await api('/api/admin/settings');
  const check = (key) => (s[key] === '1' ? 'checked' : '');
  main.innerHTML = `
    <h1 class="admin-title">商店設定</h1>
    <div class="panel" style="max-width: 640px;">
      <div class="aerror" id="settingsError"></div>
      <h3>網站</h3>
      <div class="afield"><label>網站網址（SEO canonical / sitemap 用）</label><input id="stSiteUrl" value="${esc(s.site_url)}" /></div>

      <h3 style="margin-top: 1.5rem;">運費</h3>
      <div class="afield-row">
        <div class="afield"><label>宅配運費（NT$）</label><input id="stShipFee" type="number" min="0" value="${esc(s.shipping_fee_home)}" /></div>
        <div class="afield"><label>免運門檻（NT$）</label><input id="stFreeThreshold" type="number" min="0" value="${esc(s.free_shipping_threshold)}" /></div>
      </div>
      <div class="afield"><label>自取說明</label><input id="stPickup" value="${esc(s.pickup_info)}" /></div>

      <h3 style="margin-top: 1.5rem;">匯款資訊</h3>
      <div class="afield"><label>銀行</label><input id="stBankName" value="${esc(s.bank_name)}" /></div>
      <div class="afield-row">
        <div class="afield"><label>帳號</label><input id="stBankAccount" value="${esc(s.bank_account)}" /></div>
        <div class="afield"><label>戶名</label><input id="stBankHolder" value="${esc(s.bank_holder)}" /></div>
      </div>

      <h3 style="margin-top: 1.5rem;">付款方式</h3>
      <div class="afield"><label><input type="checkbox" id="stPayBank" ${check('payment_bank_transfer')} /> 銀行轉帳</label></div>
      <div class="afield"><label><input type="checkbox" id="stPayCod" ${check('payment_cod')} /> 貨到付款</label></div>
      <div class="afield"><label><input type="checkbox" id="stPayLinepay" ${check('payment_linepay')} /> LINE Pay（金流串接完成後再開啟）</label></div>
      <div class="afield"><label><input type="checkbox" id="stPayCard" ${check('payment_credit_card')} /> 信用卡（金流串接完成後再開啟）</label></div>

      <button class="abtn" id="saveSettingsBtn">儲存設定</button>
      <span class="muted" id="settingsSaved" style="display: none; margin-left: 0.75rem; color: var(--sage);">已儲存 ✓</span>
    </div>`;

  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const errBox = document.getElementById('settingsError');
    const saved = document.getElementById('settingsSaved');
    errBox.classList.remove('show');
    saved.style.display = 'none';
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: {
          site_url: document.getElementById('stSiteUrl').value,
          shipping_fee_home: document.getElementById('stShipFee').value,
          free_shipping_threshold: document.getElementById('stFreeThreshold').value,
          pickup_info: document.getElementById('stPickup').value,
          bank_name: document.getElementById('stBankName').value,
          bank_account: document.getElementById('stBankAccount').value,
          bank_holder: document.getElementById('stBankHolder').value,
          payment_bank_transfer: document.getElementById('stPayBank').checked ? '1' : '0',
          payment_cod: document.getElementById('stPayCod').checked ? '1' : '0',
          payment_linepay: document.getElementById('stPayLinepay').checked ? '1' : '0',
          payment_credit_card: document.getElementById('stPayCard').checked ? '1' : '0',
        },
      });
      saved.style.display = '';
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('show');
    }
  });
}

boot();
