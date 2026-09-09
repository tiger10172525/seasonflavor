/* ============================================================
 * 肆菓 Season Flavor — 後台訂單 API（Cloudflare Pages Function）
 * 路徑：GET / PATCH  /admin-orders
 * ------------------------------------------------------------
 * admin.html 呼叫這裡。token 藏在伺服器端環境變數，
 * 後台密碼也改由伺服器端驗證（前端不再寫死密碼與 token）。
 *
 * Cloudflare Pages 環境變數需設定：
 *   AIRTABLE_TOKEN = 你新產生的 Airtable token
 *   ADMIN_KEY      = 你自訂的後台密碼
 * ============================================================ */

const AIRTABLE_URL = 'https://api.airtable.com/v0/appG11Pb9ZmhQ2oLw/tblzKGSNUxruQGdex';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// 驗證後台密碼（由前端以 x-admin-key 標頭帶入，伺服器端比對）
function authorized(request, env) {
  const key = request.headers.get('x-admin-key');
  return !!key && !!env.ADMIN_KEY && key === env.ADMIN_KEY;
}

// 讀取訂單（支援 Airtable 分頁 offset）
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.AIRTABLE_TOKEN || !env.ADMIN_KEY) return json({ error: '伺服器未設定環境變數' }, 500);
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);

  const offset = new URL(request.url).searchParams.get('offset');
  const url = AIRTABLE_URL + (offset ? `?offset=${encodeURIComponent(offset)}` : '');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
  const data = await res.json();
  return json(data, res.status);
}

// 更新訂單狀態：body = { recordId, fields: { status } }
export async function onRequestPatch(context) {
  const { request, env } = context;
  if (!env.AIRTABLE_TOKEN || !env.ADMIN_KEY) return json({ error: '伺服器未設定環境變數' }, 500);
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!body.recordId) return json({ error: '缺少 recordId' }, 400);

  const res = await fetch(`${AIRTABLE_URL}/${body.recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: body.fields || {} }),
  });
  const data = await res.json();
  return json(data, res.status);
}
