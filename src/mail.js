// ============================================
// 肆菓 Season Flavor — SMTP 寄信（零外部依賴）
// ============================================
'use strict';

const tls = require('node:tls');
const net = require('node:net');
const { getSetting } = require('./db');

function smtpConfig() {
  const host = getSetting('smtp_host');
  const port = Number(getSetting('smtp_port')) || 465;
  const user = getSetting('smtp_user');
  const pass = getSetting('smtp_pass');
  const from = getSetting('smtp_from') || user;
  const to = getSetting('notify_email');
  if (!host || !user || !pass || !to) return null;
  return { host, port, user, pass, from, to };
}

function b64(str) { return Buffer.from(str).toString('base64'); }

function sendSmtp(cfg, envelope) {
  return new Promise((resolve, reject) => {
    const useImplicitTls = cfg.port === 465;
    let buf = '';
    let step = 0;
    const commands = [];

    function buildCommands() {
      commands.push(null); // wait for greeting
      if (!useImplicitTls) commands.push('EHLO seasonflavor\r\n');
      else commands.push('EHLO seasonflavor\r\n');
      commands.push(`AUTH LOGIN\r\n`);
      commands.push(b64(cfg.user) + '\r\n');
      commands.push(b64(cfg.pass) + '\r\n');
      commands.push(`MAIL FROM:<${cfg.from}>\r\n`);
      commands.push(`RCPT TO:<${cfg.to}>\r\n`);
      commands.push('DATA\r\n');
      commands.push(envelope.data + '\r\n.\r\n');
      commands.push('QUIT\r\n');
    }
    buildCommands();

    function nextStep(socket) {
      step++;
      if (step < commands.length && commands[step]) {
        socket.write(commands[step]);
      }
    }

    function onData(socket, chunk) {
      buf += chunk.toString();
      const lines = buf.split('\r\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.substring(0, 3), 10);
        if (line[3] === '-') continue; // multi-line, wait for final
        if (code >= 400) {
          socket.destroy();
          return reject(new Error(`SMTP error ${code}: ${line}`));
        }
        nextStep(socket);
      }
    }

    const timeout = 15000;

    if (useImplicitTls) {
      const socket = tls.connect({ host: cfg.host, port: cfg.port, timeout }, () => {});
      socket.setTimeout(timeout);
      socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP timeout')); });
      socket.on('error', reject);
      socket.on('data', (chunk) => onData(socket, chunk));
      socket.on('end', resolve);
    } else {
      const socket = net.createConnection({ host: cfg.host, port: cfg.port, timeout }, () => {});
      socket.setTimeout(timeout);
      socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP timeout')); });
      socket.on('error', reject);
      socket.on('data', (chunk) => onData(socket, chunk));
      socket.on('end', resolve);
    }
  });
}

function buildOrderEmail(cfg, order) {
  const METHOD_LABELS = {
    bank_transfer: '銀行轉帳', cod: '貨到付款',
    linepay: 'LINE Pay', credit_card: '信用卡',
  };
  const SHIP_LABELS = { home: '宅配', pickup: '自取' };

  const itemLines = order.items
    .map((it) => `  ${it.name} × ${it.qty}　NT$ ${(it.price * it.qty).toLocaleString()}`)
    .join('\n');

  const body = [
    `新訂單通知 — ${order.code}`,
    ``,
    `收件人：${order.customerName}`,
    `電話：${order.phone}`,
    `信箱：${order.email}`,
    order.address ? `地址：${order.address}` : '',
    ``,
    `付款方式：${METHOD_LABELS[order.paymentMethod] || order.paymentMethod}`,
    `配送方式：${SHIP_LABELS[order.shippingMethod] || order.shippingMethod}`,
    ``,
    `── 訂購明細 ──`,
    itemLines,
    order.shippingFee > 0 ? `  運費　NT$ ${order.shippingFee.toLocaleString()}` : '',
    ``,
    `  合計　NT$ ${order.total.toLocaleString()}`,
    ``,
    order.note ? `備註：${order.note}\n` : '',
    `提醒：此訂單為「先付款後出貨」，請確認收到款項後再安排出貨。`,
    ``,
    `— 肆菓 Season Flavor 系統通知`,
  ].filter(Boolean).join('\n');

  const subject = `=?UTF-8?B?${b64(`[肆菓] 新訂單 ${order.code}`)}?=`;
  const fromHeader = `=?UTF-8?B?${b64('肆菓 Season Flavor')}?= <${cfg.from}>`;
  const date = new Date().toUTCString();

  const data = [
    `From: ${fromHeader}`,
    `To: ${cfg.to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64(body),
  ].join('\r\n');

  return data;
}

async function notifyNewOrder(orderData) {
  const cfg = smtpConfig();
  if (!cfg) return; // SMTP 未設定，靜默跳過
  try {
    const data = buildOrderEmail(cfg, orderData);
    await sendSmtp(cfg, { data });
    console.log(`[mail] 訂單通知已寄出：${orderData.code} → ${cfg.to}`);
  } catch (err) {
    console.error(`[mail] 寄送失敗：${err.message}`);
  }
}

module.exports = { notifyNewOrder };
