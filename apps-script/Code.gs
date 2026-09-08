/* ============================================================
 * 肆菓 Season Flavor — 訂單後端 (Google Apps Script Web App)
 * ------------------------------------------------------------
 * 功能：
 *   1. 收單通知寄到信箱 (NOTIFY_EMAIL)，並寄一封確認信給顧客
 *   2. 每筆訂單自動寫入 Google Sheet
 *   3. 後端重新驗證折扣碼（含網紅專屬碼），金額以後端計算為準
 *
 * 佈署步驟見專案根目錄 README.md。
 * ============================================================ */

// ── 設定 ──────────────────────────────────────────────────
// 收單通知信箱（店家）。留空則寄給目前的 Apps Script 帳號。
var NOTIFY_EMAIL = 'seasonflavortw@gmail.com';
// 訂單要寫入的試算表 ID（網址 /d/ 與 /edit 之間那段）。
// 留空則自動使用「與此指令碼綁定的試算表」的第一個工作表。
var SHEET_ID = '';
var SHEET_NAME = '訂單';
var BRAND = '肆菓 Season Flavor';

// 折扣碼碼表 —— 必須與前端 data/discounts.json 一致（後端為金額的最終依據）
var DISCOUNTS = {
  'WELCOME10': { type: 'percent', value: 10, label: '新客歡迎碼', kind: 'general', influencer: '', active: true, minSubtotal: 0 },
  'SEASON50':  { type: 'fixed',   value: 50, label: '季節限定折抵', kind: 'general', influencer: '', active: true, minSubtotal: 500 },
  'AMANDA15':  { type: 'percent', value: 15, label: 'Amanda 專屬碼', kind: 'influencer', influencer: 'Amanda', active: true, minSubtotal: 0 },
  'FOODIE20':  { type: 'percent', value: 20, label: '美食部落客專屬碼', kind: 'influencer', influencer: 'Foodie Diary', active: true, minSubtotal: 800 }
};

// ── 進入點 ────────────────────────────────────────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.type === 'contact') {
      return handleContact_(data);
    }
    return handleOrder_(data);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, service: BRAND + ' order endpoint' });
}

// ── 訂單處理 ──────────────────────────────────────────────
function handleOrder_(data) {
  var items = (data.items || []).filter(function (it) { return it && it.qty > 0; });
  if (!items.length) return json_({ ok: false, error: '訂單沒有品項' });
  if (!data.name || !data.email) return json_({ ok: false, error: '缺少姓名或 Email' });

  // 後端重算金額（不信任前端傳來的價格/總額）
  var subtotal = 0;
  var lines = items.map(function (it) {
    var price = Number(it.price) || 0;
    var qty = Math.max(0, parseInt(it.qty, 10) || 0);
    var amount = price * qty;
    subtotal += amount;
    return { name: it.name, price: price, qty: qty, amount: amount };
  });

  var applied = validateDiscount_(data.code, subtotal);
  var discount = applied.amount;
  var total = Math.max(0, subtotal - discount);

  var orderId = 'SF' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmmss');
  var itemsText = lines.map(function (l) {
    return '· ' + l.name + ' × ' + l.qty + '（NT$ ' + l.price + '）= NT$ ' + l.amount;
  }).join('\n');

  // 1) 寫入 Google Sheet
  writeRow_([
    new Date(), orderId, data.name, data.email, data.phone || '',
    lines.map(function (l) { return l.name + '×' + l.qty; }).join('、'),
    subtotal,
    applied.code || '',
    applied.influencer || '',
    discount,
    total,
    data.note || ''
  ]);

  // 2) 通知店家
  var owner = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  var ownerBody =
    '收到一筆新訂單！\n\n' +
    '訂單編號：' + orderId + '\n' +
    '姓名：' + data.name + '\n' +
    'Email：' + data.email + '\n' +
    '電話：' + (data.phone || '—') + '\n\n' +
    '品項：\n' + itemsText + '\n\n' +
    '小計：NT$ ' + subtotal + '\n' +
    (applied.code
      ? '折扣碼：' + applied.code + '（' + applied.label + (applied.influencer ? ' / 網紅：' + applied.influencer : '') + '）  -NT$ ' + discount + '\n'
      : '折扣碼：無\n') +
    '應付總額：NT$ ' + total + '\n\n' +
    '備註：' + (data.note || '—');
  MailApp.sendEmail(owner, '【' + BRAND + '】新訂單 ' + orderId, ownerBody);

  // 3) 寄確認信給顧客
  try {
    var custBody =
      data.name + ' 您好，\n\n' +
      '謝謝您在「' + BRAND + '」的訂購，以下是您的訂單明細：\n\n' +
      '訂單編號：' + orderId + '\n' +
      itemsText + '\n\n' +
      '小計：NT$ ' + subtotal + '\n' +
      (applied.code ? '折扣（' + applied.code + '）：-NT$ ' + discount + '\n' : '') +
      '應付總額：NT$ ' + total + '\n\n' +
      '我們會盡快與您聯絡確認出貨事宜。\n\n' + BRAND;
    MailApp.sendEmail(data.email, '【' + BRAND + '】訂單確認 ' + orderId, custBody);
  } catch (mailErr) {
    // 顧客信箱寄送失敗不影響訂單成立
  }

  return json_({
    ok: true,
    orderId: orderId,
    subtotal: subtotal,
    discount: discount,
    total: total,
    appliedCode: applied.code || null
  });
}

// ── 聯絡表單 ──────────────────────────────────────────────
function handleContact_(data) {
  var owner = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(
    owner,
    '【' + BRAND + '】網站聯絡訊息',
    '姓名：' + (data.name || '') + '\nEmail：' + (data.email || '') + '\n\n訊息：\n' + (data.message || '')
  );
  return json_({ ok: true });
}

// ── 折扣驗證（後端為準）────────────────────────────────────
function validateDiscount_(rawCode, subtotal) {
  var empty = { code: '', label: '', kind: '', influencer: '', amount: 0 };
  if (!rawCode) return empty;
  var code = String(rawCode).trim().toUpperCase();
  var d = DISCOUNTS[code];
  if (!d || !d.active) return empty;
  if (subtotal < (d.minSubtotal || 0)) return empty;
  var amount = d.type === 'percent'
    ? Math.round(subtotal * d.value / 100)
    : Math.min(d.value, subtotal);
  return {
    code: code, label: d.label, kind: d.kind,
    influencer: d.influencer || '', amount: amount
  };
}

// ── 試算表寫入 ────────────────────────────────────────────
function writeRow_(row) {
  var sheet = getSheet_();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      '時間', '訂單編號', '姓名', 'Email', '電話', '品項',
      '小計', '折扣碼', '網紅', '折扣金額', '總額', '備註'
    ]);
  }
  sheet.appendRow(row);
}

function getSheet_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('找不到試算表：請設定 SHEET_ID，或把此指令碼綁定到一份 Google Sheet。');
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

// ── 工具 ──────────────────────────────────────────────────
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
