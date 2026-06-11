// ============================================
// 肆菓 Season Flavor — 共用前台邏輯（購物車 / 會員狀態 / Toast）
// ============================================
'use strict';

// ---------- 購物車（localStorage） ----------
const Cart = {
  KEY: 'sf_cart',
  read() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; }
    catch { return {}; }
  },
  write(cart) {
    localStorage.setItem(this.KEY, JSON.stringify(cart));
    updateCartBadge();
  },
  add(productId, qty = 1) {
    const cart = this.read();
    const id = String(productId);
    cart[id] = Math.min((cart[id] || 0) + qty, 99);
    this.write(cart);
  },
  setQty(productId, qty) {
    const cart = this.read();
    const id = String(productId);
    if (qty <= 0) delete cart[id];
    else cart[id] = Math.min(qty, 99);
    this.write(cart);
  },
  remove(productId) { this.setQty(productId, 0); },
  clear() { this.write({}); },
  count() {
    return Object.values(this.read()).reduce((sum, q) => sum + q, 0);
  },
  /** 轉成 API 需要的 items 陣列 */
  toItems() {
    return Object.entries(this.read()).map(([id, qty]) => ({ id: Number(id), qty }));
  },
};

function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (!badge) return;
  const n = Cart.count();
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.classList.toggle('show', n > 0);
}

// ---------- API helper ----------
async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || '發生錯誤，請稍後再試');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- 會員狀態（更新導覽列） ----------
async function refreshAuthState() {
  const link = document.getElementById('authLink');
  if (!link) return null;
  try {
    const { user } = await apiFetch('/api/me');
    if (user) {
      link.href = user.role === 'admin' ? '/admin' : '/account';
      link.querySelector('.nav-action-label').textContent =
        user.role === 'admin' ? '後台' : user.name;
      return user;
    }
  } catch { /* 視為未登入 */ }
  link.href = '/login';
  link.querySelector('.nav-action-label').textContent = '登入';
  return null;
}

// ---------- Toast ----------
let toastTimer = null;
function showToast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- 金額格式 ----------
function formatPrice(n) {
  return 'NT$ ' + Number(n).toLocaleString('zh-Hant-TW');
}

function escapeText(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  refreshAuthState();
});
