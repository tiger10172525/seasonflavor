// ============================================
// 肆菓 Season Flavor — 主伺服器（零外部依賴）
// 啟動：node server.js（預設 http://localhost:3000）
// ============================================
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { sendJson } = require('./src/utils');
const auth = require('./src/auth');
const api = require('./src/api');
const adminApi = require('./src/admin-api');
const seo = require('./src/seo');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// 乾淨網址 → 靜態頁面
const PAGE_ROUTES = {
  '/': 'index.html',
  '/shop': 'shop.html',
  '/checkout': 'checkout.html',
  '/login': 'login.html',
  '/register': 'register.html',
  '/account': 'account.html',
  '/order-lookup': 'order-lookup.html',
  '/admin': 'admin.html',
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const isAsset = ext !== '.html';
  fs.readFile(filePath, (err, data) => {
    if (err) return seo.notFound(null, res);
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': isAsset ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const m = req.method;

  // ---------- SEO ----------
  if (m === 'GET' && p === '/sitemap.xml') return seo.sitemap(req, res);
  if (m === 'GET' && p === '/robots.txt') return seo.robots(req, res);
  const productMatch = p.match(/^\/products\/([a-z0-9-]+)$/);
  if (m === 'GET' && productMatch) return seo.productPage(req, res, productMatch[1]);

  // ---------- 前台 API ----------
  if (p.startsWith('/api/')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (m === 'POST' && p === '/api/auth/register') return api.register(req, res);
    if (m === 'POST' && p === '/api/auth/login') return api.login(req, res);
    if (m === 'POST' && p === '/api/auth/logout') return api.logout(req, res);
    if (m === 'GET' && p === '/api/me') return api.me(req, res);
    if (m === 'PUT' && p === '/api/me') return api.updateMe(req, res);

    if (m === 'GET' && p === '/api/products') return api.listProducts(req, res);
    const apiProduct = p.match(/^\/api\/products\/([a-z0-9-]+)$/);
    if (m === 'GET' && apiProduct) return api.getProduct(req, res, apiProduct[1]);

    if (m === 'GET' && p === '/api/config') return api.publicConfig(req, res);
    if (m === 'POST' && p === '/api/orders') return api.createOrder(req, res);
    if (m === 'GET' && p === '/api/orders/lookup') return api.lookupOrder(req, res, url.searchParams);
    const transferMatch = p.match(/^\/api\/orders\/([A-Z0-9-]+)\/report-transfer$/);
    if (m === 'POST' && transferMatch) return api.reportTransfer(req, res, transferMatch[1]);
    if (m === 'GET' && p === '/api/my/orders') return api.myOrders(req, res);
    if (m === 'POST' && p === '/api/contact') return api.contact(req, res);

    // ---------- 後台 API ----------
    if (p.startsWith('/api/admin/')) {
      const adminUser = auth.requireAdmin(req);

      if (m === 'GET' && p === '/api/admin/stats') return adminApi.stats(req, res);

      if (m === 'GET' && p === '/api/admin/orders') return adminApi.listOrders(req, res, url.searchParams);
      const orderId = p.match(/^\/api\/admin\/orders\/(\d+)$/);
      if (orderId && m === 'GET') return adminApi.getOrder(req, res, orderId[1]);
      if (orderId && m === 'PUT') return adminApi.updateOrder(req, res, orderId[1]);

      if (m === 'GET' && p === '/api/admin/products') return adminApi.listAllProducts(req, res);
      if (m === 'POST' && p === '/api/admin/products') return adminApi.createProduct(req, res);
      const prodId = p.match(/^\/api\/admin\/products\/(\d+)$/);
      if (prodId && m === 'PUT') return adminApi.updateProduct(req, res, prodId[1]);

      if (m === 'GET' && p === '/api/admin/customers') return adminApi.listCustomers(req, res, url.searchParams);
      const custId = p.match(/^\/api\/admin\/customers\/(\d+)$/);
      if (custId && m === 'GET') return adminApi.getCustomer(req, res, custId[1]);
      const custTags = p.match(/^\/api\/admin\/customers\/(\d+)\/tags$/);
      if (custTags && m === 'PUT') return adminApi.updateCustomerTags(req, res, custTags[1]);
      const custNotes = p.match(/^\/api\/admin\/customers\/(\d+)\/notes$/);
      if (custNotes && m === 'POST') return adminApi.addCustomerNote(req, res, custNotes[1], adminUser);
      const custNote = p.match(/^\/api\/admin\/customers\/(\d+)\/notes\/(\d+)$/);
      if (custNote && m === 'DELETE') return adminApi.deleteCustomerNote(req, res, custNote[1], custNote[2]);

      if (m === 'GET' && p === '/api/admin/messages') return adminApi.listMessages(req, res);
      const msgId = p.match(/^\/api\/admin\/messages\/(\d+)$/);
      if (msgId && m === 'PUT') return adminApi.updateMessage(req, res, msgId[1]);

      if (m === 'GET' && p === '/api/admin/settings') return adminApi.getSettings(req, res);
      if (m === 'PUT' && p === '/api/admin/settings') return adminApi.updateSettings(req, res);
    }

    return sendJson(res, 404, { error: '找不到此 API 端點' });
  }

  // ---------- 頁面與靜態檔 ----------
  if (m !== 'GET' && m !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  if (PAGE_ROUTES[p]) return serveStatic(res, path.join(PUBLIC_DIR, PAGE_ROUTES[p]));

  // 靜態檔案（防路徑跳脫）
  const safePath = path.normalize(path.join(PUBLIC_DIR, p));
  if (safePath.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
    return serveStatic(res, safePath);
  }

  return seo.notFound(req, res);
}

const server = http.createServer((req, res) => {
  Promise.resolve(route(req, res)).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[server]', err);
    if (!res.headersSent) {
      sendJson(res, status, { error: status >= 500 ? '伺服器發生錯誤，請稍後再試' : err.message });
    } else {
      res.end();
    }
  });
});

server.listen(PORT, () => {
  console.log(`肆菓 Season Flavor 已啟動：http://localhost:${PORT}`);
  console.log(`後台管理：http://localhost:${PORT}/admin`);
});
