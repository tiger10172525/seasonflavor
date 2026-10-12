/* 肆菓擺攤 POS 的離線快取：POS 頁面與它的 JS + 商品圖片。其他請求照常走網路。 */
const CACHE = 'sf-pos-v2';
const PAGE = '/admin-pos';
const PRECACHE = [PAGE, '/admin-pos.js', '/admin-pos-v2.js'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('sf-pos-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));

const save = (req, res) => {
  if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return res;
};

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 頁面與它的 JS：有網路拿最新版，沒網路用快取
  if (PRECACHE.includes(u.pathname)) {
    e.respondWith(fetch(e.request).then((r) => save(u.pathname, r)).catch(() => caches.match(u.pathname)));
  // 圖片：先用快取
  } else if (/^\/(images|media)\//.test(u.pathname) || u.pathname === '/apple-touch-icon.png') {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => save(e.request, r))));
  }
});
