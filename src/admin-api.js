// ============================================
// 肆菓 Season Flavor — 後台管理 API（/api/admin/*）
// 所有端點皆需管理員身分
// ============================================
'use strict';

const { db, getAllSettings, setSetting } = require('./db');
const { readJson, sendJson, httpError, str, nowIso } = require('./utils');

const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'completed', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'reported', 'paid', 'refunded'];

// ---------- 儀表板 ----------
function stats(req, res) {
  const revenue = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS v FROM orders WHERE status IN ('paid','shipped','completed')
  `).get().v;
  const revenue30 = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS v FROM orders
    WHERE status IN ('paid','shipped','completed') AND created_at >= datetime('now', '-30 days')
  `).get().v;
  const byStatus = {};
  for (const row of db.prepare('SELECT status, COUNT(*) AS c FROM orders GROUP BY status').all()) {
    byStatus[row.status] = row.c;
  }
  const memberCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'member'").get().c;
  const customerCount = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
  const newMessages = db.prepare("SELECT COUNT(*) AS c FROM messages WHERE status = 'new'").get().c;
  const topProducts = db.prepare(`
    SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status != 'cancelled'
    GROUP BY oi.name ORDER BY qty DESC LIMIT 5
  `).all();
  const lowStock = db.prepare(`
    SELECT name, stock FROM products WHERE active = 1 AND badge = 'available' AND stock <= 10
    ORDER BY stock
  `).all();
  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8').all();

  sendJson(res, 200, {
    revenue, revenue30, byStatus, memberCount, customerCount, newMessages,
    topProducts, lowStock,
    recentOrders: recentOrders.map(adminOrderRow),
  });
}

// ---------- 訂單 ----------
function adminOrderRow(o) {
  return {
    id: o.id, code: o.code, customerName: o.customer_name, email: o.email, phone: o.phone,
    address: o.address, shippingMethod: o.shipping_method, shippingFee: o.shipping_fee,
    paymentMethod: o.payment_method, paymentStatus: o.payment_status, status: o.status,
    subtotal: o.subtotal, total: o.total, note: o.note, transferLast5: o.transfer_last5,
    customerId: o.customer_id, createdAt: o.created_at, updatedAt: o.updated_at,
  };
}

function listOrders(req, res, query) {
  const status = query.get('status');
  const q = str(query.get('q'), 100);
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (status && ORDER_STATUSES.includes(status)) { sql += ' AND status = ?'; params.push(status); }
  if (q) {
    sql += ' AND (code LIKE ? OR customer_name LIKE ? OR email LIKE ? OR phone LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  const rows = db.prepare(sql).all(...params);
  sendJson(res, 200, { orders: rows.map(adminOrderRow) });
}

function getOrder(req, res, id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
  if (!order) throw httpError(404, '找不到訂單');
  const items = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?').all(order.id);
  sendJson(res, 200, { order: { ...adminOrderRow(order), items } });
}

async function updateOrder(req, res, id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
  if (!order) throw httpError(404, '找不到訂單');
  const body = await readJson(req);

  const status = body.status ?? order.status;
  const paymentStatus = body.paymentStatus ?? order.payment_status;
  if (!ORDER_STATUSES.includes(status)) throw httpError(400, '訂單狀態無效');
  if (!PAYMENT_STATUSES.includes(paymentStatus)) throw httpError(400, '付款狀態無效');

  // 取消訂單時回補庫存（只回補一次）
  if (status === 'cancelled' && order.status !== 'cancelled') {
    const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(order.id);
    const inc = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
    for (const it of items) if (it.product_id) inc.run(it.qty, it.product_id);
  }

  db.prepare('UPDATE orders SET status = ?, payment_status = ?, updated_at = ? WHERE id = ?')
    .run(status, paymentStatus, nowIso(), order.id);
  getOrder(req, res, order.id);
}

// ---------- 商品 ----------
function listAllProducts(req, res) {
  const rows = db.prepare('SELECT * FROM products ORDER BY sort, id').all();
  sendJson(res, 200, { products: rows });
}

function productFields(body, existing = {}) {
  const name = str(body.name, 100) ?? existing.name;
  const slug = str(body.slug, 100) ?? existing.slug;
  const price = body.price !== undefined ? Number.parseInt(body.price, 10) : existing.price;
  const stock = body.stock !== undefined ? Number.parseInt(body.stock, 10) : existing.stock;
  if (!name) throw httpError(400, '請輸入商品名稱');
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw httpError(400, '網址代稱只能包含小寫英文、數字與連字號');
  if (!Number.isInteger(price) || price < 0) throw httpError(400, '價格不正確');
  if (!Number.isInteger(stock) || stock < 0) throw httpError(400, '庫存不正確');
  const badge = ['available', 'coming'].includes(body.badge) ? body.badge : (existing.badge || 'available');
  return {
    name, slug, price, stock, badge,
    name_en: body.nameEn !== undefined ? (str(body.nameEn, 100) || null) : (existing.name_en ?? null),
    tagline: body.tagline !== undefined ? (str(body.tagline, 200) || null) : (existing.tagline ?? null),
    description: body.description !== undefined ? (str(body.description, 3000) || null) : (existing.description ?? null),
    image: body.image !== undefined ? (str(body.image, 300) || null) : (existing.image ?? null),
    active: body.active !== undefined ? (body.active ? 1 : 0) : (existing.active ?? 1),
    sort: body.sort !== undefined ? (Number.parseInt(body.sort, 10) || 0) : (existing.sort ?? 0),
  };
}

async function createProduct(req, res) {
  const body = await readJson(req);
  const f = productFields(body);
  const dupe = db.prepare('SELECT id FROM products WHERE slug = ?').get(f.slug);
  if (dupe) throw httpError(409, '這個網址代稱已被使用');
  const r = db.prepare(`
    INSERT INTO products (slug, name, name_en, tagline, description, price, image, badge, stock, active, sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(f.slug, f.name, f.name_en, f.tagline, f.description, f.price, f.image, f.badge, f.stock, f.active, f.sort, nowIso());
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(r.lastInsertRowid));
  sendJson(res, 201, { product: row });
}

async function updateProduct(req, res, id) {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id));
  if (!existing) throw httpError(404, '找不到商品');
  const body = await readJson(req);
  const f = productFields(body, existing);
  const dupe = db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').get(f.slug, existing.id);
  if (dupe) throw httpError(409, '這個網址代稱已被使用');
  db.prepare(`
    UPDATE products SET slug=?, name=?, name_en=?, tagline=?, description=?, price=?, image=?, badge=?, stock=?, active=?, sort=?
    WHERE id = ?
  `).run(f.slug, f.name, f.name_en, f.tagline, f.description, f.price, f.image, f.badge, f.stock, f.active, f.sort, existing.id);
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id);
  sendJson(res, 200, { product: row });
}

// ---------- 顧客 CRM ----------
const CUSTOMER_AGG = `
  SELECT c.*,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelled') AS order_count,
    (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelled') AS total_spent,
    (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at
  FROM customers c
`;

function customerRow(c) {
  let tags = [];
  try { tags = JSON.parse(c.tags || '[]'); } catch { /* 容錯：壞資料視為無標籤 */ }
  return {
    id: c.id, email: c.email, name: c.name, phone: c.phone, userId: c.user_id,
    isMember: c.user_id != null, tags,
    orderCount: c.order_count ?? 0, totalSpent: c.total_spent ?? 0,
    lastOrderAt: c.last_order_at ?? null, createdAt: c.created_at,
  };
}

function listCustomers(req, res, query) {
  const q = str(query.get('q'), 100);
  let sql = CUSTOMER_AGG;
  const params = [];
  if (q) {
    sql += ' WHERE c.email LIKE ? OR c.name LIKE ? OR c.phone LIKE ?';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY total_spent DESC, c.created_at DESC LIMIT 200';
  const rows = db.prepare(sql).all(...params);
  sendJson(res, 200, { customers: rows.map(customerRow) });
}

function getCustomer(req, res, id) {
  const c = db.prepare(`${CUSTOMER_AGG} WHERE c.id = ?`).get(Number(id));
  if (!c) throw httpError(404, '找不到顧客');
  const orders = db.prepare(
    'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(c.id).map(adminOrderRow);
  const notes = db.prepare(
    'SELECT id, author, body, created_at AS createdAt FROM customer_notes WHERE customer_id = ? ORDER BY created_at DESC'
  ).all(c.id);
  sendJson(res, 200, { customer: customerRow(c), orders, notes });
}

async function updateCustomerTags(req, res, id) {
  const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(Number(id));
  if (!c) throw httpError(404, '找不到顧客');
  const body = await readJson(req);
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => str(t, 30)).filter(Boolean).slice(0, 20)
    : [];
  db.prepare('UPDATE customers SET tags = ? WHERE id = ?').run(JSON.stringify(tags), c.id);
  sendJson(res, 200, { tags });
}

async function addCustomerNote(req, res, id, adminUser) {
  const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(Number(id));
  if (!c) throw httpError(404, '找不到顧客');
  const body = await readJson(req);
  const text = str(body.body, 2000);
  if (!text) throw httpError(400, '請輸入備註內容');
  const r = db.prepare(
    'INSERT INTO customer_notes (customer_id, author, body, created_at) VALUES (?, ?, ?, ?)'
  ).run(c.id, adminUser.name, text, nowIso());
  sendJson(res, 201, {
    note: { id: Number(r.lastInsertRowid), author: adminUser.name, body: text, createdAt: nowIso() },
  });
}

function deleteCustomerNote(req, res, id, noteId) {
  const r = db.prepare('DELETE FROM customer_notes WHERE id = ? AND customer_id = ?')
    .run(Number(noteId), Number(id));
  if (r.changes === 0) throw httpError(404, '找不到備註');
  sendJson(res, 200, { ok: true });
}

// ---------- 聯絡訊息 ----------
function listMessages(req, res) {
  const rows = db.prepare(
    'SELECT id, name, email, body, status, created_at AS createdAt FROM messages ORDER BY created_at DESC LIMIT 200'
  ).all();
  sendJson(res, 200, { messages: rows });
}

async function updateMessage(req, res, id) {
  const body = await readJson(req);
  const status = ['new', 'read', 'replied'].includes(body.status) ? body.status : null;
  if (!status) throw httpError(400, '狀態無效');
  const r = db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, Number(id));
  if (r.changes === 0) throw httpError(404, '找不到訊息');
  sendJson(res, 200, { ok: true });
}

// ---------- 設定 ----------
const EDITABLE_SETTINGS = [
  'site_url', 'shipping_fee_home', 'free_shipping_threshold',
  'bank_name', 'bank_account', 'bank_holder', 'pickup_info',
  'payment_bank_transfer', 'payment_cod', 'payment_linepay', 'payment_credit_card',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'notify_email',
];

function getSettings(req, res) {
  sendJson(res, 200, { settings: getAllSettings() });
}

async function updateSettings(req, res) {
  const body = await readJson(req);
  for (const key of EDITABLE_SETTINGS) {
    if (body[key] !== undefined) setSetting(key, String(body[key]).slice(0, 500));
  }
  sendJson(res, 200, { settings: getAllSettings() });
}

module.exports = {
  stats,
  listOrders, getOrder, updateOrder,
  listAllProducts, createProduct, updateProduct,
  listCustomers, getCustomer, updateCustomerTags, addCustomerNote, deleteCustomerNote,
  listMessages, updateMessage,
  getSettings, updateSettings,
};
