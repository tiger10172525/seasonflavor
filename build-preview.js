#!/usr/bin/env node
/* ============================================================
 * 產生「單檔可雙擊」預覽版：build-preview.js
 * ------------------------------------------------------------
 * 把 index.html + style.css + script.js + data/*.json + images/*
 * 全部塞進一個獨立檔 preview.html，雙擊即可看到完整網站，
 * 不需本地伺服器、不需其他檔案。
 *
 * 用法：node build-preview.js
 * 改過 products.json / style.css / index.html 後，重跑一次即可。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');
const css = read('style.css');
const js = read('script.js');
const configJs = read('config.js');
const products = JSON.parse(read('data/products.json'));
const discounts = JSON.parse(read('data/discounts.json'));

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
function toDataURI(relPath) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return relPath; // 找不到圖就維持原路徑
  const ext = path.extname(abs).toLowerCase();
  const b64 = fs.readFileSync(abs).toString('base64');
  return `data:${MIME[ext] || 'application/octet-stream'};base64,${b64}`;
}

// 產品圖 → 內嵌 data URI
products.products.forEach((p) => { if (p.image) p.image = toDataURI(p.image); });

const inlineData =
  '<script>\n' +
  configJs + '\n' +
  'window.SF_INLINE_DATA = {\n' +
  '  products: ' + JSON.stringify(products) + ',\n' +
  '  discounts: ' + JSON.stringify(discounts) + '\n' +
  '};\n' +
  '</script>';

// 注意：用函式形式的 replacer，避免 CSS/JS 內的 $ 被當成特殊樣式（如 $&、${}）
let out = html
  // 移除外部 CSS 連結，改為內嵌
  .replace(/[ \t]*<link rel="stylesheet" href="style\.css"[^>]*>\n?/,
           () => '  <style>\n' + css + '\n  </style>\n')
  // 移除 products-mockup（無法內嵌，且非必要）
  .replace(/[ \t]*<img src="images\/products-mockup\.jpg"[\s\S]*?\/>\n?/, () => '')
  // 移除外部 config.js / script.js，改為內嵌資料 + 程式
  .replace(/[ \t]*<script src="config\.js"><\/script>\n?/, () => '')
  .replace(/[ \t]*<script src="script\.js"><\/script>\n?/,
           () => inlineData + '\n  <script>\n' + js + '\n  </script>\n');

const outPath = path.join(root, 'preview.html');
fs.writeFileSync(outPath, out);
console.log('已產生 preview.html（' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' KB）');
