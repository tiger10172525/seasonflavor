// ============================================
// 肆菓 Season Flavor — 資料庫（node:sqlite，零外部依賴）
// ============================================
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./password');

const DATA_DIR = process.env.SF_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'seasonflavor.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'member',  -- member | admin
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  name_en     TEXT,
  tagline     TEXT,                -- 一句話風味描述
  description TEXT,                -- 完整介紹（商品頁）
  price       INTEGER NOT NULL,    -- 新台幣，整數
  image       TEXT,
  badge       TEXT NOT NULL DEFAULT 'available',  -- available | coming
  stock       INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- CRM 顧客主檔：會員與訪客訂購都會建立（以 email 為鍵）
CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name       TEXT,
  phone      TEXT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tags       TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name   TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL,
  address         TEXT,
  shipping_method TEXT NOT NULL,   -- home | pickup
  shipping_fee    INTEGER NOT NULL DEFAULT 0,
  payment_method  TEXT NOT NULL,   -- bank_transfer | cod
  payment_status  TEXT NOT NULL DEFAULT 'unpaid',  -- unpaid | reported | paid | refunded
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | paid | shipped | completed | cancelled
  subtotal        INTEGER NOT NULL,
  total           INTEGER NOT NULL,
  note            TEXT,
  transfer_last5  TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  price      INTEGER NOT NULL,
  qty        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new',  -- new | read | replied
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_email   ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_oid ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_notes_customer ON customer_notes(customer_id);
`);

// ---------- 設定 ----------
const DEFAULT_SETTINGS = {
  site_url: 'https://www.seasonflavor.com',
  shipping_fee_home: '120',
  free_shipping_threshold: '1500',
  bank_name: '國泰世華銀行 (013)',
  bank_account: '000-1234-567890',
  bank_holder: '肆菓工作室',
  pickup_info: '台北市（私訊 IG 約定面交時間地點）',
  // 付款方式開關：之後接金流（LINE Pay / 信用卡）時直接在後台打開
  payment_bank_transfer: '1',
  payment_cod: '1',
  payment_linepay: '0',
  payment_credit_card: '0',
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? null);
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function getAllSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    out[row.key] = row.value;
  }
  return out;
}

// ---------- 種子資料 ----------
function seed() {
  const now = new Date().toISOString();

  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (productCount === 0) {
    const insert = db.prepare(`
      INSERT INTO products (slug, name, name_en, tagline, description, price, image, badge, stock, active, sort, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insert.run(
      'strawberry-jam', '草莓果醬', 'Strawberry Jam',
      '溫柔的酸與甜，像是春天剛開始的感覺',
      '嚴選台灣大湖草莓，低溫慢熬，保留果肉的纖維與香氣。不額外添加色素與香精，甜度刻意收斂，抹在吐司上、拌進優格裡，都是剛剛好的春天。每罐 220g，開封後請冷藏並於兩週內食用完畢。',
      320, '/images/strawberry.jpg', 'available', 50, 1, now
    );
    insert.run(
      'mixed-berry-jam', '綜合野莓果醬', 'Mixed Berry Jam',
      '深邃的果香，帶著一點點神秘的尾韻',
      '藍莓、覆盆子與黑莓的三重奏，酸香層次分明。果皮的微澀讓尾韻多了一點神秘感，配上貝果與奶油乳酪是我們私心的最愛。每罐 220g，開封後請冷藏並於兩週內食用完畢。',
      340, '/images/mixed-berry.jpg', 'available', 50, 2, now
    );
    insert.run(
      'kiwi-jam', '奇異果果醬', 'Kiwi Jam',
      '清爽帶勁的綠意，讓人精神一振的酸甜',
      '黃金奇異果與綠奇異果各半，保留細小籽粒的口感。明亮的酸甜像初夏的風，加進氣泡水就是一杯自家果茶。季節限定，敬請期待。',
      320, '/images/kiwi.jpg', 'coming', 0, 3, now
    );
    insert.run(
      'peach-jam', '水蜜桃果醬', 'White Peach Jam',
      '多汁飽滿，是夏天最讓人期待的一種甜',
      '拉拉山水蜜桃手工去皮切瓣，輕熬至果香釋放。香氣濃郁卻不甜膩，淋在香草冰淇淋上是夏天的儀式感。季節限定，敬請期待。',
      360, '/images/peach.jpg', 'coming', 0, 4, now
    );
  }

  const adminEmail = process.env.SF_ADMIN_EMAIL || 'admin@seasonflavor.com';
  const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!adminExists) {
    const adminPassword = process.env.SF_ADMIN_PASSWORD || 'seasonflavor#2026';
    db.prepare(`
      INSERT INTO users (email, password_hash, name, role, created_at)
      VALUES (?, ?, ?, 'admin', ?)
    `).run(adminEmail, hashPassword(adminPassword), '肆菓管理員', now);
    console.log(`[db] 已建立預設管理員帳號：${adminEmail}（請盡快更改密碼）`);
  }
}

seed();

module.exports = { db, getSetting, setSetting, getAllSettings };
