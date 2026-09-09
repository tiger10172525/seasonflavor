/* ============================================================
 * 肆菓 Season Flavor — 後台訂單 API（Netlify Function）
 * admin.html 呼叫 /admin-orders（netlify.toml 轉到這裡）。
 * token 藏在伺服器端 AIRTABLE_TOKEN，後台密碼由 ADMIN_KEY 驗證。
 *
 * Netlify 環境變數需設定：AIRTABLE_TOKEN、ADMIN_KEY
 * ============================================================ */

const AIRTABLE_URL = 'https://api.airtable.com/v0/appG11Pb9ZmhQ2oLw/tblzKGSNUxruQGdex';

const json = (obj, statusCode = 200) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  const token = process.env.AIRTABLE_TOKEN;
  const adminKey = process.env.ADMIN_KEY;
  if (!token || !adminKey) return json({ error: '伺服器未設定環境變數' }, 500);

  // Netlify 會把標頭名稱轉小寫
  const key = event.headers['x-admin-key'];
  if (!key || key !== adminKey) return json({ error: 'unauthorized' }, 401);

  if (event.httpMethod === 'GET') {
    const offset = event.queryStringParameters && event.queryStringParameters.offset;
    const url = AIRTABLE_URL + (offset ? `?offset=${encodeURIComponent(offset)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return json(await res.json(), res.status);
  }

  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return json({ error: 'bad json' }, 400); }
    if (!body.recordId) return json({ error: '缺少 recordId' }, 400);
    const res = await fetch(`${AIRTABLE_URL}/${body.recordId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: body.fields || {} }),
    });
    return json(await res.json(), res.status);
  }

  return json({ error: 'method not allowed' }, 405);
};
