// ============================================
// 肆菓 Season Flavor — 會員驗證與 Session
// ============================================
'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');
const { parseCookies, httpError } = require('./utils');

const SESSION_COOKIE = 'sf_session';
const SESSION_DAYS = 30;

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expires);
  return token;
}

function sessionCookie(token) {
  const maxAge = SESSION_DAYS * 86400;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** 取得目前登入的使用者，未登入回傳 null */
function getUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.name, u.phone, u.role, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role };
}

function requireUser(req) {
  const user = getUser(req);
  if (!user) throw httpError(401, '請先登入');
  return user;
}

function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') throw httpError(403, '沒有管理權限');
  return user;
}

module.exports = {
  createSession, sessionCookie, clearSessionCookie, destroySession,
  getUser, requireUser, requireAdmin,
};
