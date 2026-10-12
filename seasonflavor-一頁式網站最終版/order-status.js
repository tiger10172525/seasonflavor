// 訂單查詢頁：訂單編號 + 電話 → /api/order-lookup。不讀 Airtable token，全部在伺服器端。
const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 導覽列購物車：這頁沒載 shop.js，只顯示數量並跳到購物車頁
try {
  const n = JSON.parse(localStorage.getItem('sf_cart') || '[]').reduce((a, i) => a + (i.qty || 0), 0);
  if ($('navCartCount')) $('navCartCount').textContent = n;
} catch {}
$('navCartBtn')?.addEventListener('click', () => { location.href = '/cart'; });

const qs = new URLSearchParams(location.search);
if (qs.get('order')) $('osId').value = qs.get('order').replace(/[^A-Za-z0-9-]/g, '');

const STATUS_CLASS = { '已付款': 'ok', '待付款': 'wait' };

async function showBank(box) {
  const b = (await fetch('/api/checkout-config').then(r => r.json()).catch(() => ({}))).bank || {};
  const rows = [['銀行名稱', b.name], ['銀行代碼', b.code], ['分行名稱', b.branch], ['戶名', b.holder], ['銀行帳號', b.account]]
    .filter(r => r[1]).map(([k, v]) => `<div class="pi-row"><span class="k">${k}</span><span class="v">${esc(v)}</span><span></span></div>`).join('');
  box.insertAdjacentHTML('beforeend', `<h4 class="pi-t">轉帳資訊</h4><div class="pi-card">${rows}</div>`);
}

$('osForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('osErr'), box = $('osResult');
  err.textContent = ''; box.hidden = true;
  const btn = e.target.querySelector('button'); btn.disabled = true;
  try {
    const res = await fetch('/api/order-lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: $('osId').value, phone: $('osPhone').value }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || '查詢失敗，請稍後再試');
    const o = out.order;
    const lines = String(o.items).split('\n').filter(Boolean).map(l => `<div class="pi-item"><div class="n">${esc(l)}</div></div>`).join('');
    box.innerHTML = `
      <div class="os-head"><div><div class="k">訂單編號</div><b>${esc(o.order_id)}</b></div>
        <span class="os-badge ${STATUS_CLASS[o.status] || ''}">${esc(o.status)}</span></div>
      <div class="os-meta">下單時間：${esc(o.created_at)}<br>付款方式：${esc(o.payment)}</div>
      <h4 class="pi-t">訂購內容</h4>${lines}
      ${o.shipping != null ? `<div class="co2-line muted"><span>運費</span><span class="r">NT$${Number(o.shipping).toLocaleString()}</span></div>` : ''}
      ${o.discount ? `<div class="co2-line disc"><span>折扣</span><span class="r">-NT$${Number(o.discount).toLocaleString()}</span></div>` : ''}
      <div class="co2-total"><span class="l">總計</span><span class="r">NT$${Number(o.total).toLocaleString()}</span></div>
      ${o.note ? `<h4 class="pi-t">備註</h4><div class="os-note">${esc(o.note)}</div>` : ''}`;
    box.hidden = false;
    if (o.status === '待付款' && o.payment.startsWith('銀行轉帳')) await showBank(box);
    if (o.status === '待付款') box.insertAdjacentHTML('beforeend', '<p class="pi-sub" style="margin-top:1rem">付款後由我們確認，約 1–3 個工作天更新狀態。有問題請 IG 私訊 @seasonflavor_。</p>');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (x) {
    err.textContent = x.message;
  } finally { btn.disabled = false; }
});

if (qs.get('order') && $('osPhone').value === '') $('osPhone').focus();
