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

// Scroll reveal
const revealElements = document.querySelectorAll(
  '.about-grid, .about-text, .about-visual, .phil-card, .philosophy-quote, .product-card, .contact-grid, .story-text'
);
revealElements.forEach((el, i) => {
  el.classList.add('reveal');
  if (i % 3 === 1) el.classList.add('reveal-delay-1');
  if (i % 3 === 2) el.classList.add('reveal-delay-2');
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// Phil cards stagger
document.querySelectorAll('.phil-card').forEach((card, i) => {
  card.classList.add(`reveal-delay-${i + 1}`);
});

// Product cards stagger
document.querySelectorAll('.product-card').forEach((card, i) => {
  card.classList.add(`reveal-delay-${i % 3 + 1}`);
});

// Contact form
const form = document.getElementById('contactForm');
form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = form.querySelector('button[type="submit"]');
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
});

// ============================================
// Shopping Cart
// ============================================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const cart = {
  items: {},

  add(product) {
    if (this.items[product.id]) {
      this.items[product.id].quantity++;
    } else {
      this.items[product.id] = { ...product, quantity: 1 };
    }
    this.render();
    showToast(`已加入購物車：${product.name}`);
  },

  updateQty(productId, delta) {
    if (!this.items[productId]) return;
    this.items[productId].quantity += delta;
    if (this.items[productId].quantity <= 0) delete this.items[productId];
    this.render();
  },

  total() {
    return Object.values(this.items).reduce((sum, i) => sum + i.price * i.quantity, 0);
  },

  count() {
    return Object.values(this.items).reduce((sum, i) => sum + i.quantity, 0);
  },

  render() {
    const badge = document.getElementById('cartBadge');
    const count = this.count();
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';

    const cartEmpty = document.getElementById('cartEmpty');
    const cartItemsEl = document.getElementById('cartItems');
    const cartTotalEl = document.getElementById('cartTotal');
    const checkoutBtn = document.getElementById('checkoutBtn');
    const items = Object.values(this.items);

    if (items.length === 0) {
      cartEmpty.style.display = 'block';
      cartItemsEl.innerHTML = '';
      checkoutBtn.disabled = true;
    } else {
      cartEmpty.style.display = 'none';
      cartItemsEl.innerHTML = items.map(item => `
        <div class="cart-item">
          <div class="cart-item-info">
            <span class="cart-item-name">${escapeHtml(item.name)}</span>
            <span class="cart-item-price">NT$${item.price} × ${item.quantity} = NT$${item.price * item.quantity}</span>
          </div>
          <div class="cart-item-controls">
            <button data-action="dec" data-id="${escapeHtml(item.id)}" aria-label="減少數量">−</button>
            <span>${item.quantity}</span>
            <button data-action="inc" data-id="${escapeHtml(item.id)}" aria-label="增加數量">+</button>
          </div>
        </div>
      `).join('');
      cartTotalEl.textContent = `NT$${this.total()}`;
      if (!checkoutBtn.dataset.loading) checkoutBtn.disabled = false;
    }
  },
};

// Cart drawer open/close
const cartBtn = document.getElementById('cartBtn');
const cartDrawer = document.getElementById('cartDrawer');
const cartOverlay = document.getElementById('cartOverlay');
const cartClose = document.getElementById('cartClose');

function openCart() {
  cartDrawer.classList.add('open');
  cartOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  cartDrawer.classList.remove('open');
  cartOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

cartBtn?.addEventListener('click', openCart);
cartClose?.addEventListener('click', closeCart);
cartOverlay?.addEventListener('click', closeCart);

// Cart quantity controls via event delegation
document.getElementById('cartItems')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'inc') cart.updateQty(id, 1);
  if (btn.dataset.action === 'dec') cart.updateQty(id, -1);
});

// Add to cart buttons
document.querySelectorAll('.btn-add-cart').forEach(btn => {
  btn.addEventListener('click', () => {
    cart.add({
      id: btn.dataset.id,
      name: btn.dataset.name,
      price: parseInt(btn.dataset.price, 10),
    });
    btn.textContent = '已加入 ✓';
    btn.classList.add('added');
    setTimeout(() => {
      btn.textContent = '加入購物車';
      btn.classList.remove('added');
    }, 1500);
  });
});

// LINE Pay checkout
document.getElementById('checkoutBtn')?.addEventListener('click', async () => {
  const checkoutBtn = document.getElementById('checkoutBtn');
  const items = Object.values(cart.items);

  checkoutBtn.textContent = '處理中...';
  checkoutBtn.disabled = true;
  checkoutBtn.dataset.loading = '1';

  try {
    const res = await fetch('/api/payment/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();

    if (data.paymentUrl) {
      window.location.href = data.paymentUrl;
    } else {
      showToast(data.error || '付款請求失敗，請稍後再試', 'error');
      checkoutBtn.textContent = 'LINE Pay 結帳';
      checkoutBtn.disabled = false;
      delete checkoutBtn.dataset.loading;
    }
  } catch {
    showToast('網路錯誤，請稍後再試', 'error');
    checkoutBtn.textContent = 'LINE Pay 結帳';
    checkoutBtn.disabled = false;
    delete checkoutBtn.dataset.loading;
  }
});

// Toast notification
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast${type ? ' ' + type : ''} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// Check payment result on page load
(function checkPaymentResult() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  if (payment === 'success') {
    const orderId = params.get('orderId') || '';
    showToast(`付款成功！訂單編號：${orderId}`, 'success');
    history.replaceState({}, '', '/');
  } else if (payment === 'error') {
    showToast('付款失敗或已取消，請重新嘗試', 'error');
    history.replaceState({}, '', '/');
  }
})();

// Initialize cart display
cart.render();
