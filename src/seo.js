// ============================================
// 肆菓 Season Flavor — SEO（sitemap / robots / 商品頁 SSR）
// ============================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { db, getSetting } = require('./db');
const { escapeHtml, sendHtml } = require('./utils');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const productTemplate = fs.readFileSync(path.join(TEMPLATE_DIR, 'product.html'), 'utf8');

function siteUrl() {
  return getSetting('site_url').replace(/\/+$/, '');
}

function sitemap(req, res) {
  const base = siteUrl();
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = [
    { loc: '', priority: '1.0', freq: 'weekly' },
    { loc: '/shop', priority: '0.9', freq: 'daily' },
    { loc: '/order-lookup', priority: '0.4', freq: 'monthly' },
    { loc: '/login', priority: '0.3', freq: 'yearly' },
    { loc: '/register', priority: '0.3', freq: 'yearly' },
  ];
  const products = db.prepare('SELECT slug, image, created_at FROM products WHERE active = 1').all();
  const urls = [
    ...staticPages.map(
      (p) =>
        `  <url><loc>${base}${p.loc}</loc><lastmod>${today}</lastmod><changefreq>${p.freq}</changefreq><priority>${p.priority}</priority></url>`
    ),
    ...products.map((p) => {
      const img = p.image ? `\n    <image:image><image:loc>${base}${escapeHtml(p.image)}</image:loc></image:image>` : '';
      return `  <url><loc>${base}/products/${escapeHtml(p.slug)}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority>${img}</url>`;
    }),
  ].join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls}\n</urlset>\n`;
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(xml);
}

function robots(req, res) {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /account',
    'Disallow: /checkout',
    '',
    `Sitemap: ${siteUrl()}/sitemap.xml`,
    '',
  ].join('\n');
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/** 商品頁伺服器渲染：完整 meta + Open Graph + Product JSON-LD */
function productPage(req, res, slug) {
  const p = db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(slug);
  if (!p) return notFound(req, res);

  const base = siteUrl();
  const url = `${base}/products/${p.slug}`;
  const image = p.image ? `${base}${p.image}` : `${base}/images/strawberry.jpg`;
  const available = p.badge === 'available' && p.stock > 0;
  const desc = (p.tagline || p.description || '肆菓手工果醬').slice(0, 150);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: [image],
    description: p.description || p.tagline || '',
    sku: p.slug,
    brand: { '@type': 'Brand', name: '肆菓 Season Flavor' },
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'TWD',
      price: String(p.price),
      availability: available ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder',
      seller: { '@type': 'Organization', name: '肆菓 Season Flavor' },
    },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: base },
      { '@type': 'ListItem', position: 2, name: '線上訂購', item: `${base}/shop` },
      { '@type': 'ListItem', position: 3, name: p.name, item: url },
    ],
  };

  const html = productTemplate
    .replaceAll('{{TITLE}}', escapeHtml(`${p.name} ${p.name_en ? `${p.name_en} ` : ''}｜肆菓 Season Flavor`))
    .replaceAll('{{META_DESC}}', escapeHtml(desc))
    .replaceAll('{{CANONICAL}}', escapeHtml(url))
    .replaceAll('{{OG_IMAGE}}', escapeHtml(image))
    .replaceAll('{{JSON_LD}}', JSON.stringify(jsonLd))
    .replaceAll('{{BREADCRUMB_LD}}', JSON.stringify(breadcrumb))
    .replaceAll('{{NAME}}', escapeHtml(p.name))
    .replaceAll('{{NAME_EN}}', escapeHtml(p.name_en || ''))
    .replaceAll('{{TAGLINE}}', escapeHtml(p.tagline || ''))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(p.description || ''))
    .replaceAll('{{PRICE}}', String(p.price))
    .replaceAll('{{IMAGE}}', escapeHtml(p.image || ''))
    .replaceAll('{{PRODUCT_ID}}', String(p.id))
    .replaceAll('{{BADGE_CLASS}}', available ? 'available' : 'coming')
    .replaceAll('{{BADGE_TEXT}}', available ? '現貨' : '即將推出')
    .replaceAll('{{BUY_DISABLED}}', available ? '' : 'disabled')
    .replaceAll('{{BUY_TEXT}}', available ? '加入購物車' : '即將推出，敬請期待');

  sendHtml(res, 200, html);
}

function notFound(req, res) {
  const html = `<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>找不到頁面｜肆菓 Season Flavor</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="/css/style.css"></head>
<body style="display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">
<div><p class="section-label">404</p><h1 class="section-title">這一頁好像融化了</h1>
<p class="body-text">找不到您要的頁面，回首頁看看當季的甜吧。</p>
<a class="btn" href="/">回到首頁</a></div></body></html>`;
  sendHtml(res, 404, html);
}

module.exports = { sitemap, robots, productPage, notFound };
