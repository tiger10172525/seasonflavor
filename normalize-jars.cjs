const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const ROOT = '/home/user/seasonflavor';
const SRC = path.join(ROOT, 'images_orig');
const OUT = path.join(ROOT, 'images_norm');
const FILES = ['strawberry.jpg', 'mixed-berry.jpg', 'kiwi.jpg', 'peach.jpg'];

const b64 = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(SRC, f)).toString('base64');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');

  // 偵測罐子的 bounding box（以彩度或暗度找出非背景區）
  async function detect(file) {
    return await page.evaluate(async (dataUri) => {
      const img = new Image();
      await new Promise(r => { img.onload = r; img.src = dataUri; });
      const W = img.naturalWidth, H = img.naturalHeight;
      const cv = document.getElementById('c'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, W, H).data;
      const colCount = new Array(W).fill(0);
      const rowCount = new Array(H).fill(0);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const r = d[i], g = d[i + 1], bb = d[i + 2];
          const mx = Math.max(r, g, bb), mn = Math.min(r, g, bb);
          const light = mx / 255;
          const sat = mx === 0 ? 0 : (mx - mn) / mx;
          // 非背景：夠彩 或 夠暗（罐蓋/玻璃）
          if (sat > 0.14 || light < 0.72) { colCount[x]++; rowCount[y]++; }
        }
      }
      const rng = (arr, min) => {
        let lo = -1, hi = -1;
        for (let i = 0; i < arr.length; i++) if (arr[i] > min) { if (lo < 0) lo = i; hi = i; }
        return [lo, hi];
      };
      const [L, R] = rng(colCount, Math.max(12, H * 0.03));
      const [T, B] = rng(rowCount, Math.max(12, W * 0.03));
      return { W, H, L, R, T, B, cx: (L + R) / 2, cy: (T + B) / 2, w: R - L, h: B - T };
    }, b64(file));
  }

  const boxes = {};
  for (const f of FILES) boxes[f] = await detect(f);
  console.log('偵測結果 (jar bbox, fraction of image):');
  for (const f of FILES) {
    const x = boxes[f];
    console.log(`  ${f.padEnd(16)} cx=${(x.cx/x.W).toFixed(3)} cy=${(x.cy/x.H).toFixed(3)} w=${(x.w/x.W).toFixed(3)} h=${(x.h/x.H).toFixed(3)}`);
  }

  // 以草莓為基準
  const base = boxes['strawberry.jpg'];
  const OUTSZ = 800;

  // 手動微調（偵測框無法完全對應肉眼看的罐身時，用這裡校正）
  // scale：相對縮放（<1 縮小）；dyFrac：垂直位移（佔輸出高度比例，+ 往下）
  const ADJUST = {
    'strawberry.jpg':  { scale: 1.00, dyFrac: 0 },
    'mixed-berry.jpg': { scale: 1.00, dyFrac: 0 },
    'kiwi.jpg':        { scale: 0.97, dyFrac: 0.045 },
    'peach.jpg':       { scale: 0.98, dyFrac: 0.045 }
  };
  const target = {
    cx: base.cx / base.W, cy: base.cy / base.H,
    h: base.h / base.H // 罐高佔輸出高度的比例
  };

  async function render(file, box) {
    const dataUri = b64(file);
    const adj = ADJUST[file] || { scale: 1, dyFrac: 0 };
    const outB64 = await page.evaluate(async (args) => {
      const { dataUri, box, target, OUTSZ, adj } = args;
      const img = new Image();
      await new Promise(r => { img.onload = r; img.src = dataUri; });
      const cv = document.getElementById('c'); cv.width = OUTSZ; cv.height = OUTSZ;
      const ctx = cv.getContext('2d');

      // 取樣左上角當背景色填滿（避免黑邊）
      const t = document.createElement('canvas'); t.width = img.naturalWidth; t.height = img.naturalHeight;
      const tctx = t.getContext('2d'); tctx.drawImage(img, 0, 0);
      const c = tctx.getImageData(2, 2, 1, 1).data;
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(0, 0, OUTSZ, OUTSZ);

      // 縮放：讓此圖罐高 = 目標罐高
      const targetJarH = target.h * OUTSZ;
      const s = (targetJarH / box.h) * adj.scale;
      // 讓罐子中心對到目標中心（含手動垂直微調）
      const dx = target.cx * OUTSZ - box.cx * s;
      const dy = target.cy * OUTSZ - box.cy * s + (adj.dyFrac || 0) * OUTSZ;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, dx, dy, img.naturalWidth * s, img.naturalHeight * s);
      return cv.toDataURL('image/jpeg', 0.92).split(',')[1];
    }, { dataUri, box, target, OUTSZ, adj });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(outB64, 'base64'));
  }

  for (const f of FILES) await render(f, boxes[f]);
  console.log('已輸出正規化圖到 images_norm/');
  await browser.close();
})();
