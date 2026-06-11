// ============================================
// 肆菓 Season Flavor — 共用工具
// ============================================
'use strict';

const MAX_BODY = 1024 * 1024; // 1MB

/** 讀取並解析 JSON request body */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(httpError(413, '請求內容過大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, 'JSON 格式錯誤'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    ...headers,
  });
  res.end(html);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(v) {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
}

/** 取得修剪過的字串欄位，超過長度或非字串時回傳 null */
function str(v, maxLen = 200) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0 || t.length > maxLen) return null;
  return t;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  readJson, sendJson, sendHtml, httpError, parseCookies,
  escapeHtml, isEmail, str, nowIso,
};
