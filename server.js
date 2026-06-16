require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const LINE_PAY_BASE = process.env.LINE_PAY_ENV === 'production'
  ? 'https://api-pay.line.me'
  : 'https://sandbox-api-pay.line.me';

const CHANNEL_ID = process.env.LINE_PAY_CHANNEL_ID;
const CHANNEL_SECRET = process.env.LINE_PAY_CHANNEL_SECRET;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// In-memory order store — replace with a database in production
const pendingOrders = {};

// Clean up orders older than 1 hour to prevent memory leaks
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, order] of Object.entries(pendingOrders)) {
    if (order.createdAt < cutoff) delete pendingOrders[id];
  }
}, 10 * 60 * 1000);

function linePayHeaders(uri, body) {
  const nonce = uuidv4();
  const bodyStr = JSON.stringify(body);
  const hmacText = CHANNEL_SECRET + uri + bodyStr + nonce;
  const signature = crypto
    .createHmac('sha256', CHANNEL_SECRET)
    .update(hmacText)
    .digest('base64');
  return {
    'Content-Type': 'application/json',
    'X-LINE-ChannelId': CHANNEL_ID,
    'X-LINE-Authorization-Nonce': nonce,
    'X-LINE-Authorization': signature,
  };
}

// POST /api/payment/request — create LINE Pay payment
app.post('/api/payment/request', async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '購物車是空的' });
  }

  // Validate each item
  for (const item of items) {
    if (!item.id || !item.name || typeof item.price !== 'number' || typeof item.quantity !== 'number') {
      return res.status(400).json({ error: '商品資料格式錯誤' });
    }
  }

  const orderId = `SF-${Date.now()}-${uuidv4().split('-')[0].toUpperCase()}`;
  const totalAmount = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const body = {
    amount: totalAmount,
    currency: 'TWD',
    orderId,
    packages: [{
      id: `pkg-${orderId}`,
      amount: totalAmount,
      products: items.map(i => ({
        name: i.name,
        quantity: i.quantity,
        price: i.price,
      })),
    }],
    redirectUrls: {
      confirmUrl: `${BASE_URL}/api/payment/confirm`,
      cancelUrl: `${BASE_URL}/#products`,
    },
  };

  const uri = '/v3/payments/request';

  try {
    const { data } = await axios.post(`${LINE_PAY_BASE}${uri}`, body, {
      headers: linePayHeaders(uri, body),
    });

    if (data.returnCode === '0000') {
      pendingOrders[orderId] = { amount: totalAmount, items, createdAt: Date.now() };
      return res.json({ paymentUrl: data.info.paymentUrl.web, orderId });
    }

    res.status(400).json({ error: data.returnMessage });
  } catch (err) {
    console.error('[LINE Pay request]', err.response?.data || err.message);
    res.status(500).json({ error: '付款請求失敗，請稍後再試' });
  }
});

// GET /api/payment/confirm — LINE Pay redirects here after user pays
app.get('/api/payment/confirm', async (req, res) => {
  const { transactionId, orderId } = req.query;

  if (!transactionId || !orderId) {
    return res.redirect('/?payment=error');
  }

  const order = pendingOrders[orderId];
  if (!order) return res.redirect('/?payment=error');

  const body = { amount: order.amount, currency: 'TWD' };
  const uri = `/v3/payments/${transactionId}/confirm`;

  try {
    const { data } = await axios.post(`${LINE_PAY_BASE}${uri}`, body, {
      headers: linePayHeaders(uri, body),
    });

    delete pendingOrders[orderId];

    if (data.returnCode === '0000') {
      return res.redirect(`/?payment=success&orderId=${encodeURIComponent(orderId)}`);
    }

    res.redirect('/?payment=error');
  } catch (err) {
    console.error('[LINE Pay confirm]', err.response?.data || err.message);
    res.redirect('/?payment=error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`肆菓伺服器啟動：http://localhost:${PORT}`);
});
