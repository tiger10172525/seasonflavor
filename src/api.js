// ============================================
// 肆菓 Season Flavor — 前台 API
// ============================================
'use strict';

const crypto = require('node:crypto');
const { db, getSetting } = require('./db');
const { hashPassword, verifyPassword } = require('./password');
const auth = require('./auth');
const { readJson, sendJson, httpError, isEmail, str, nowIso } = require('./utils');
const { notifyNewOrder } = require('./mail');

// ---------- CRM：以 email 建立／更新顧客主檔 ----------
function upsertCustomer({ email, name, phone, userId }) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO customers (email, name, phone, user_id, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name    = COALESCE(excluded.name, customers.name),
      phone   = COALESCE(excluded.phone, customers.phone),
      user_id = COALESCE(excluded.user_id, customers.user_id)
  `).run(email, name ?? null, phone ?? null, userId ?? null, now);
  return db.prepare('SELECT id FROM customers WHERE email = ?').get(email).id;
}

// ---------- 會員 ----------
async function register(req, res) {
  const body = await readJson(req);
  const name = str(body.name, 60);
  const email = str(body.email, 254);
  const phone = body.phone ? str(body.phone, 30) : null;
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name) throw httpError(400, '請輸入名字');
  if (!isEmail(email)) throw httpError(400, '電子信箱格式不正確');
  if (password.length < 8) throw httpError(400, '密碼至少需要 8 個字元');

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) throw httpError(409, '這個信箱已經註冊過了，請直接登入');

  const result = db.prepare(`
    INSERT INTO users (email, password_hash, name, phone, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(email, hashPassword(password), name, phone, nowIso());
  const userId = Number(result.lastInsertRowid);

  // 建立 CRM 顧客檔；同 email 的訪客紀錄會在此歸戶（user_id 補上）
  upsertCustomer({ email, name, phone, userId });

  const token = auth.createSession(userId);
  res.setHeader('Set-Cookie', auth.sessionCookie(token));
  sendJson(res, 201, { user: { id: userId, name, email, phone, role: 'member' } });
}

async function login(req, res) {
  const body = await readJson(req);
  const email = str(body.email, 254);
  const password = typeof body.password === 'string' ? body.password : '';
  const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw httpError(401, '信箱或密碼不正確');
  }
  const token = auth.createSession(user.id);
  res.setHeader('Set-Cookie', auth.sessionCookie(token));
  sendJson(res, 200, {
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
  });
}

function logout(req, res) {
  auth.destroySession(req);
  res.setHeader('Set-Cookie', auth.clearSessionCookie());
  sendJson(res, 200, { ok: true });
}

function me(req, res) {
  sendJson(res, 200, { user: auth.getUser(req) });
}

async function updateMe(req, res) {
  const user = auth.requireUser(req);
  const body = await readJson(req);
  const name = str(body.name, 60) || user.name;
  const phone = body.phone === '' ? null : (str(body.phone, 30) ?? user.phone);

  if (body.newPassword) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(String(body.currentPassword || ''), row.password_hash)) {
      throw httpError(400, '目前密碼不正確');
    }
    if (String(body.newPassword).length < 8) throw httpError(400, '新密碼至少需要 8 個字元');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword(String(body.newPassword)), user.id);
  }

  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, user.id);
  upsertCustomer({ email: user.email, name, phone, userId: user.id });
  sendJson(res, 200, { user: { ...user, name, phone } });
}

// ---------- 商品 ----------
function listProducts(req, res) {
  const rows = db.prepare(`
    SELECT id, slug, name, name_en, tagline, price, image, badge, stock
    FROM products WHERE active = 1 ORDER BY sort, id
  `).all();
  sendJson(res, 200, { products: rows });
}

function getProduct(req, res, slug) {
  const row = db.prepare(`
    SELECT id, slug, name, name_en, tagline, description, price, image, badge, stock
    FROM products WHERE slug = ? AND active = 1
  `).get(slug);
  if (!row) throw httpError(404, '找不到這項商品');
  sendJson(res, 200, { product: row });
}

// ---------- 結帳設定 ----------
function publicConfig(req, res) {
  sendJson(res, 200, {
    shippingFeeHome: Number(getSetting('shipping_fee_home')),
    freeShippingThreshold: Number(getSetting('free_shipping_threshold')),
    pickupInfo: getSetting('pickup_info'),
    paymentMethods: [
      { id: 'bank_transfer', name: '銀行轉帳（ATM／網銀）', enabled: getSetting('payment_bank_transfer') === '1' },
      { id: 'cod', name: '貨到付款', enabled: getSetting('payment_cod') === '1' },
      { id: 'linepay', name: 'LINE Pay', enabled: getSetting('payment_linepay') === '1' },
      { id: 'credit_card', name: '信用卡', enabled: getSetting('payment_credit_card') === '1' },
    ],
  });
}

// ---------- 訂單 ----------
function orderCode() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  // 撞號時重試，避免 UNIQUE 衝突讓下單失敗
  const exists = db.prepare('SELECT 1 FROM orders WHERE code = ?');
  for (let i = 0; i < 10; i++) {
    const code = `SF${ymd}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    if (!exists.get(code)) return code;
  }
  return `SF${ymd}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

const ENABLED_PAYMENT_KEYS = {
  bank_transfer: 'payment_bank_transfer',
  cod: 'payment_cod',
  linepay: 'payment_linepay',
  credit_card: 'payment_credit_card',
};

async function createOrder(req, res) {
  const body = await readJson(req);
  const user = auth.getUser(req);

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 || items.length > 50) throw httpError(400, '購物車是空的');

  const c = body.customer || {};
  const name = str(c.name, 60);
  const email = str(c.email, 254);
  const phone = str(c.phone, 30);
  if (!name) throw httpError(400, '請輸入收件人姓名');
  if (!isEmail(email)) throw httpError(400, '電子信箱格式不正確');
  if (!phone) throw httpError(400, '請輸入聯絡電話');

  const shippingMethod = body.shippingMethod === 'pickup' ? 'pickup' : 'home';
  const address = shippingMethod === 'home' ? str(c.address, 200) : (str(c.address, 200) || '');
  if (shippingMethod === 'home' && !address) throw httpError(400, '宅配請填寫收件地址');

  const paymentMethod = String(body.paymentMethod || '');
  const settingKey = ENABLED_PAYMENT_KEYS[paymentMethod];
  if (!settingKey || getSetting(settingKey) !== '1') throw httpError(400, '付款方式無效');

  // 驗證商品與庫存、由伺服器端計價
  const getProductStmt = db.prepare(
    'SELECT id, name, price, stock, badge, active FROM products WHERE id = ?'
  );
  const lines = [];
  let subtotal = 0;
  for (const item of items) {
    const qty = Number.parseInt(item.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw httpError(400, '商品數量不正確');
    const p = getProductStmt.get(Number(item.id));
    if (!p || !p.active || p.badge !== 'available') throw httpError(400, '有商品目前無法訂購，請更新購物車');
    if (p.stock < qty) throw httpError(409, `「${p.name}」庫存不足（剩 ${p.stock} 件）`);
    lines.push({ productId: p.id, name: p.name, price: p.price, qty });
    subtotal += p.price * qty;
  }

  const freeThreshold = Number(getSetting('free_shipping_threshold'));
  const homeFee = Number(getSetting('shipping_fee_home'));
  const shippingFee = shippingMethod === 'pickup' ? 0 : (subtotal >= freeThreshold ? 0 : homeFee);
  const total = subtotal + shippingFee;
  const note = body.note ? str(body.note, 500) : null;

  const now = nowIso();
  const customerId = upsertCustomer({ email, name, phone, userId: user?.id ?? null });

  let code;
  db.exec('BEGIN');
  try {
    // 再次扣庫存（含檢查），避免並發超賣
    const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
    for (const line of lines) {
      const r = dec.run(line.qty, line.productId, line.qty);
      if (r.changes === 0) throw httpError(409, `「${line.name}」庫存不足，請調整數量`);
    }
    code = orderCode();
    const orderResult = db.prepare(`
      INSERT INTO orders (code, customer_id, user_id, customer_name, email, phone, address,
        shipping_method, shipping_fee, payment_method, subtotal, total, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(code, customerId, user?.id ?? null, name, email, phone, address,
      shippingMethod, shippingFee, paymentMethod, subtotal, total, note, now, now);
    const orderId = Number(orderResult.lastInsertRowid);
    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)'
    );
    for (const line of lines) insertItem.run(orderId, line.productId, line.name, line.price, line.qty);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const payload = { order: { code, subtotal, shippingFee, total, paymentMethod, status: 'pending' } };
  if (paymentMethod === 'bank_transfer') {
    payload.order.bankInfo = {
      bankName: getSetting('bank_name'),
      account: getSetting('bank_account'),
      holder: getSetting('bank_holder'),
    };
  }
  sendJson(res, 201, payload);

  notifyNewOrder({
    code, customerName: name, email, phone, address,
    shippingMethod, shippingFee, paymentMethod, subtotal, total, note, items: lines,
  });
}

function serializeOrder(order) {
  const items = db.prepare(
    'SELECT name, price, qty FROM order_items WHERE order_id = ? ORDER BY id'
  ).all(order.id);
  return {
    code: order.code,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    shippingMethod: order.shipping_method,
    shippingFee: order.shipping_fee,
    subtotal: order.subtotal,
    total: order.total,
    createdAt: order.created_at,
    items,
  };
}

/** 訪客查詢訂單（需訂單編號 + email 雙重比對） */
function lookupOrder(req, res, query) {
  const code = str(query.get('code'), 30);
  const email = str(query.get('email'), 254);
  if (!code || !email) throw httpError(400, '請輸入訂單編號與訂購時的電子信箱');
  const order = db.prepare('SELECT * FROM orders WHERE code = ? AND email = ? COLLATE NOCASE')
    .get(code, email);
  if (!order) throw httpError(404, '查無此訂單，請確認編號與信箱');
  const out = serializeOrder(order);
  if (order.payment_method === 'bank_transfer' && order.payment_status === 'unpaid') {
    out.bankInfo = {
      bankName: getSetting('bank_name'),
      account: getSetting('bank_account'),
      holder: getSetting('bank_holder'),
    };
  }
  sendJson(res, 200, { order: out });
}

/** 回報轉帳後五碼 */
async function reportTransfer(req, res, code) {
  const body = await readJson(req);
  const email = str(body.email, 254);
  const last5 = str(body.last5, 5);
  if (!email || !last5 || !/^\d{5}$/.test(last5)) throw httpError(400, '請輸入正確的帳號後五碼');
  const order = db.prepare('SELECT * FROM orders WHERE code = ? AND email = ? COLLATE NOCASE')
    .get(str(code, 30), email);
  if (!order) throw httpError(404, '查無此訂單');
  if (order.payment_method !== 'bank_transfer') throw httpError(400, '此訂單不是轉帳付款');
  if (order.payment_status === 'paid') throw httpError(400, '此訂單已確認收款');
  db.prepare(`
    UPDATE orders SET transfer_last5 = ?, payment_status = 'reported', updated_at = ? WHERE id = ?
  `).run(last5, nowIso(), order.id);
  sendJson(res, 200, { ok: true, message: '已收到您的匯款回報，確認後會寄出商品' });
}

/** 會員訂單列表 */
function myOrders(req, res) {
  const user = auth.requireUser(req);
  const rows = db.prepare(`
    SELECT * FROM orders WHERE user_id = ? OR email = ? COLLATE NOCASE
    ORDER BY created_at DESC LIMIT 100
  `).all(user.id, user.email);
  sendJson(res, 200, { orders: rows.map(serializeOrder) });
}

// ---------- 聯絡表單 ----------
async function contact(req, res) {
  const body = await readJson(req);
  const name = str(body.name, 60);
  const email = str(body.email, 254);
  const message = str(body.message, 2000);
  if (!name || !isEmail(email) || !message) throw httpError(400, '請完整填寫表單');
  db.prepare('INSERT INTO messages (name, email, body, created_at) VALUES (?, ?, ?, ?)')
    .run(name, email, message, nowIso());
  sendJson(res, 201, { ok: true });
}

module.exports = {
  register, login, logout, me, updateMe,
  listProducts, getProduct, publicConfig,
  createOrder, lookupOrder, reportTransfer, myOrders,
  contact, upsertCustomer,
};
