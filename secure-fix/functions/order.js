/* ============================================================
 * 肆菓 Season Flavor — 建立訂單（Cloudflare Pages Function）
 * 路徑：POST /order
 * ------------------------------------------------------------
 * 前台 shop.js 呼叫這裡，由伺服器端用「藏在環境變數的 token」
 * 寫入 Airtable。token 不再出現在任何前端檔案。
 *
 * Cloudflare Pages 環境變數需設定：
 *   AIRTABLE_TOKEN = 你新產生的 Airtable token
 * ============================================================ */

const AIRTABLE_URL = 'https://api.airtable.com/v0/appG11Pb9ZmhQ2oLw/tblzKGSNUxruQGdex';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.AIRTABLE_TOKEN) return json({ ok: false, error: '伺服器未設定 AIRTABLE_TOKEN' }, 500);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: '資料格式錯誤' }, 400);
  }

  // 只挑允許的欄位，狀態一律由伺服器設為「待付款」
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
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const t = await res.text();
      return json({ ok: false, error: 'Airtable: ' + t }, 502);
    }
    return json({ ok: true, order_id: fields.order_id });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 502);
  }
}
