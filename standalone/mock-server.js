// 서버 없이 HTML 파일 하나로 동작하는 단독 실행 버전의 "브라우저 속 서버".
// server/service.js 의 로직을 그대로 쓰고, DB는 sql.js(SQLite WASM) + localStorage 로 대체한다.
// server/app.js 의 라우트와 같은 경로/응답을 돌려준다.

import initSqlJs from 'sql.js';
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';
import QRCode from 'qrcode';
import { openDb } from '../server/db.js';
import { seedBots } from '../server/seed.js';
import * as S from '../server/service.js';
import { LOCATIONS, STYLES, DEPOSITS, CHECKIN_EARLY_MIN } from '../server/options.js';
import { persist, clearSaved } from './shims/sqlite.js';

const TOKEN_KEY = 'studybuddy-standalone-token';
const demo = true;
const opts = { demo };

const ready = (async () => {
  globalThis.__SQL = await initSqlJs({ wasmBinary });
  const db = openDb('browser');
  seedBots(db);
  S.autoSettle(db);
  persist();
  return db;
})();

const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const needUser = (ctx) => {
  if (!ctx.user) throw new HttpError(401, '로그인이 필요해요.');
  return ctx.user.id;
};

const routes = [
  ['GET', '/options', () => ({ locations: LOCATIONS, styles: STYLES, deposits: DEPOSITS, checkinEarlyMin: CHECKIN_EARLY_MIN, demo })],

  ['POST', '/auth/signup', ({ db, body }) => {
    const { user, token } = S.signup(db, body);
    setToken(token);
    return { user };
  }],
  ['POST', '/auth/login', ({ db, body }) => {
    const { user, token } = S.login(db, body);
    setToken(token);
    return { user };
  }],
  ['POST', '/auth/logout', ({ db }) => {
    const t = getToken();
    if (t) S.logout(db, t);
    setToken(null);
    return { ok: true };
  }],

  ['GET', '/me', (ctx) => S.homeState(ctx.db, needUser(ctx), opts)],
  ['PUT', '/me', (ctx) => ({ user: S.updateProfile(ctx.db, needUser(ctx), ctx.body) })],
  ['GET', '/me/points', (ctx) => ({ logs: S.pointLogs(ctx.db, needUser(ctx)) })],
  ['GET', '/me/history', (ctx) => ({ matches: S.matchHistory(ctx.db, needUser(ctx)) })],

  ['POST', '/requests', (ctx) => S.createRequest(ctx.db, needUser(ctx), ctx.body)],
  ['DELETE', '/requests/current', (ctx) => {
    S.cancelRequest(ctx.db, needUser(ctx));
    return { ok: true };
  }],

  ['GET', '/matches/current', (ctx) => ({ match: S.currentMatch(ctx.db, needUser(ctx), opts) })],
  ['POST', '/matches/:id/settle', (ctx) => {
    const uid = needUser(ctx);
    S.forceSettle(ctx.db, uid, ctx.id);
    return { match: S.currentMatch(ctx.db, uid, opts) };
  }],
  ['POST', '/matches/:id/choice', (ctx) => S.chooseNext(ctx.db, needUser(ctx), ctx.id, ctx.body.choice)],
  ['GET', '/matches/:id/messages', (ctx) => ({ messages: S.listMessages(ctx.db, needUser(ctx), ctx.id, ctx.query.after) })],
  ['POST', '/matches/:id/messages', (ctx) => {
    S.sendMessage(ctx.db, needUser(ctx), ctx.id, ctx.body.body);
    return { ok: true };
  }],

  ['POST', '/appointments/:id/checkin', (ctx) => {
    const uid = needUser(ctx);
    S.checkIn(ctx.db, uid, ctx.id, ctx.body, opts);
    return { match: S.currentMatch(ctx.db, uid, opts) };
  }],
  ['POST', '/appointments/:id/checkout', (ctx) => {
    const uid = needUser(ctx);
    const { minutes } = S.checkOut(ctx.db, uid, ctx.id, opts);
    return { minutes, match: S.currentMatch(ctx.db, uid, opts) };
  }],
].map(([method, pattern, handler]) => ({
  method,
  handler,
  regex: new RegExp(`^${pattern.replace(':id', '(\\d+)')}$`),
}));

window.__mockApi = async (path, { method = 'GET', body } = {}) => {
  const db = await ready;
  const [pathname, qs] = path.split('?');
  const route = routes.find((r) => r.method === method && r.regex.test(pathname));
  if (!route) return { status: 404, data: { error: '존재하지 않는 API입니다.' } };
  const ctx = {
    db,
    body: body ?? {},
    query: Object.fromEntries(new URLSearchParams(qs ?? '')),
    id: Number(pathname.match(route.regex)[1]),
    user: S.userByToken(db, getToken()),
  };
  try {
    const data = route.handler(ctx);
    return { status: 200, data };
  } catch (err) {
    if (err instanceof HttpError || err instanceof S.AppError) return { status: err.status, data: { error: err.message } };
    console.error(err);
    return { status: 500, data: { error: '오류가 발생했어요. 다시 시도해 주세요.' } };
  } finally {
    persist();
  }
};

window.__mockQr = async (appointmentId) => {
  const db = await ready;
  const user = S.userByToken(db, getToken());
  if (!user) throw new Error('로그인이 필요해요.');
  const appt = S.appointmentForQr(db, user.id, appointmentId);
  const svg = await QRCode.toString(`SB:${appt.id}:${appt.code}`, { type: 'svg', margin: 1, color: { dark: '#203829', light: '#ffffff' } });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

window.__mockReset = () => {
  clearSaved();
  setToken(null);
};
