/* ============================================================
 * 肆菓 Season Flavor — 建立訂單（Netlify Function）
 * 前台 shop.js 呼叫 /order（netlify.toml 轉到這裡），
 * 由伺服器端用環境變數 AIRTABLE_TOKEN 寫入 Airtable。
 * token 不再出現在任何前端檔案。
 *
 * Netlify 環境變數需設定：AIRTABLE_TOKEN
 * ============================================================ */

const AIRTABLE_URL = 'https://api.airtable.com/v0/appG11Pb9ZmhQ2oLw/tblzKGSNUxruQGdex';

const json = (obj, statusCode = 200) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return json({ ok: false, error: '伺服器未設定 AIRTABLE_TOKEN' }, 500);

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return json({ ok: false, error: '資料格式錯誤' }, 400); }

  const fields = {
    order_id:   String(data.order_id || ''),
    name:       String(data.name || ''),
    phone:      String(data.phone || ''),
    address:    String(data.address || ''),
    items:      String(data.items || ''),
    total:      Number(data.total) || 0,
    payment:    String(data.payment || 'ATM 轉帳'),
    status:     '待付款',
    created_at: String(data.created_at || new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })),
    note:       String(data.note || ''),
  };

  if (!fields.name || !fields.phone) return json({ ok: false, error: '缺少姓名或電話' }, 400);

  try {
    const res = await fetch(AIRTABLE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) return json({ ok: false, error: 'Airtable: ' + (await res.text()) }, 502);
    return json({ ok: true, order_id: fields.order_id });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 502);
  }
};
