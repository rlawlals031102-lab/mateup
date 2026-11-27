// 서버 없이 HTML 파일 하나로 동작하는 단독 실행 버전의 "브라우저 속 서버".
// server/service.js 의 로직을 그대로 쓰고, DB는 sql.js(SQLite WASM) + localStorage 로 대체한다.
// server/app.js 의 라우트와 같은 경로/응답을 돌려준다.

import './demo-period.js'; // 맨 먼저: 데모 날짜를 어제·오늘·내일로 (데모 메이트가 이 날짜로 만들어짐)
import initSqlJs from 'sql.js';
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';
import QRCode from 'qrcode';
import { openSqlite } from '../server/db.js';
import { seedBots, retireOldBots } from '../server/seed.js';
import * as S from '../server/service.js';
import { LOCATIONS, ROOMS_BY_DATE, NO_ROOM_DATES, ROOMS_UNASSIGNED_FROM, UNASSIGNED_ROOM, STYLES, CHECKIN_EARLY_MIN, TIME_SLOTS, HOME_SLOTS, STUDY_PERIOD, PROMISE_RULE, PRIVACY_POLICY } from '../server/options.js';
import { consentState, recordConsent, deleteAccount, exportMyData } from '../server/privacy.js';
import { reportChat, REPORT_REASONS } from '../server/reports.js';
import { persist, clearSaved } from './shims/sqlite.js';
import * as T from '../server/time.js';

const TOKEN_KEY = 'studybuddy-standalone-token';
const demo = true;
const opts = { demo };

const ready = (async () => {
  globalThis.__SQL = await initSqlJs({ wasmBinary });
  const db = await openSqlite('browser');
  await seedBots(db);
  await retireOldBots(db);
  await S.autoSettle(db);
  persist();
  return db;
})();

const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
};

// 데모 체험: 매칭되면 어제·오늘·내일 세 번의 약속을 신청한 시간으로 잡고,
// 첫 약속(어제)은 둘 다 출석한 것으로 채운다 → 오늘이 세 번 중 두 번째 약속이 된다.
async function fillDemoWeek(db, matchId) {
  const m = await db.get('SELECT * FROM matches WHERE id = ?', matchId);
  if (!m) return;
  const appts = await db.all('SELECT * FROM appointments WHERE match_id = ? ORDER BY date', matchId);
  if (!appts.length) return;
  const base = appts[0]; // 신청한 시간 (여러 날 골랐으면 첫 날 시간을 빈 날에 씀)
  const code = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  const users = [m.user_a, m.user_b];
  const byDate = new Map(appts.map((a) => [a.date, a]));
  for (const date of STUDY_PERIOD.dates) {
    if (byDate.has(date)) continue;
    const { rows } = await db.run(
      'INSERT INTO appointments (match_id, date, start_time, end_time, code) VALUES (?, ?, ?, ?, ?) RETURNING id',
      matchId, date, base.start_time, base.end_time, code(),
    );
    for (const u of users) {
      await db.run('INSERT INTO attendance_codes (appointment_id, user_id, code) VALUES (?, ?, ?)', rows[0].id, u, code());
    }
    byDate.set(date, { id: rows[0].id, date, start_time: base.start_time, end_time: base.end_time });
  }
  // 첫 약속(어제): 둘 다 출석, 끝까지 공부한 것으로
  const first = byDate.get(STUDY_PERIOD.dates[0]);
  const start = T.at(first.date, first.start_time);
  const end = T.at(first.date, first.end_time);
  const minutes = Math.round((end - start) / 60000);
  for (const u of users) {
    await db.run(
      `INSERT INTO attendance (appointment_id, user_id, method, checked_in_at, checked_out_at, minutes) VALUES (?, ?, 'mate', ?, ?, ?)
       ON CONFLICT (appointment_id, user_id) DO NOTHING`,
      first.id, u, start.toISOString(), end.toISOString(), minutes,
    );
  }
  // 매칭에 적힌 요일·시간표도 세 날 모두로
  const all = [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  const days = all.map((a) => T.isoWeekday(a.date));
  const schedule = all.map((a) => ({ day: T.isoWeekday(a.date), start: a.start_time, end: a.end_time }));
  await db.run('UPDATE matches SET days = ?, schedule = ? WHERE id = ?', JSON.stringify(days), JSON.stringify(schedule), matchId);
  persist();
}

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
  ['GET', '/options', async () => ({ locations: LOCATIONS, roomsByDate: ROOMS_BY_DATE, noRoomDates: NO_ROOM_DATES, roomsUnassignedFrom: ROOMS_UNASSIGNED_FROM, unassignedRoom: UNASSIGNED_ROOM, styles: STYLES, checkinEarlyMin: CHECKIN_EARLY_MIN, demo, demoLogin: true, timeSlots: TIME_SLOTS, homeSlots: HOME_SLOTS, studyPeriod: STUDY_PERIOD, promiseRule: PROMISE_RULE,
    privacyVersion: PRIVACY_POLICY.version, reportReasons: REPORT_REASONS })],

  ['POST', '/auth/signup', async ({ db, body }) => {
    const { user, token } = await S.signup(db, body);
    setToken(token);
    return { user };
  }],
  ['POST', '/auth/login', async ({ db, body }) => {
    const { user, token } = await S.login(db, body);
    setToken(token);
    return { user };
  }],
  ['POST', '/auth/demo', async ({ db }) => {
    const { user, token } = await S.demoLogin(db);
    setToken(token);
    return { user };
  }],
  ['POST', '/auth/logout', async ({ db }) => {
    const t = getToken();
    if (t) await S.logout(db, t);
    setToken(null);
    return { ok: true };
  }],

  // 단독 데모는 처리방침 동의를 받지 않는다 (실서비스만: server/app.js consentRequired)
  ['GET', '/me', async (ctx) => ({ ...(await S.homeState(ctx.db, needUser(ctx), opts)), consent: consentState(ctx.user, false) })],
  ['POST', '/me/consent', async (ctx) => ({ consent: await recordConsent(ctx.db, needUser(ctx)) })],
  ['GET', '/me/export', (ctx) => exportMyData(ctx.db, needUser(ctx))],
  ['POST', '/me/delete', async (ctx) => {
    await deleteAccount(ctx.db, needUser(ctx), ctx.body.password);
    setToken(null);
    return { ok: true };
  }],
  ['POST', '/matches/:id/report', (ctx) => reportChat(ctx.db, needUser(ctx), ctx.id, ctx.body)],
  ['PUT', '/me', async (ctx) => ({ user: await S.updateProfile(ctx.db, needUser(ctx), ctx.body) })],
  ['GET', '/matches/:id', async (ctx) => ({ match: await S.matchById(ctx.db, needUser(ctx), ctx.id, opts) })],
  ['GET', '/me/history', async (ctx) => ({ matches: await S.matchHistory(ctx.db, needUser(ctx)) })],

  ['POST', '/requests', async (ctx) => {
    const res = await S.createRequest(ctx.db, needUser(ctx), ctx.body);
    if (res?.matchId) await fillDemoWeek(ctx.db, res.matchId);
    return res;
  }],
  ['DELETE', '/requests/:id', async (ctx) => {
    await S.cancelRequest(ctx.db, needUser(ctx), ctx.id);
    return { ok: true };
  }],
  ['DELETE', '/requests/current', async (ctx) => {
    await S.cancelRequest(ctx.db, needUser(ctx));
    return { ok: true };
  }],

  ['GET', '/matches/active', async (ctx) => ({
    matches: await S.activeMatches(ctx.db, needUser(ctx), opts), strikes: await S.strikeStatus(ctx.db, ctx.user.id),
  })],
  ['PUT', '/me/personal', async (ctx) => ({ personal: await S.setPersonalSchedule(ctx.db, needUser(ctx), ctx.body.entries) })],
  ['GET', '/matches/current', async (ctx) => ({ match: await S.currentMatch(ctx.db, needUser(ctx), opts) })],
  ['POST', '/matches/:id/settle', async (ctx) => {
    const uid = needUser(ctx);
    await S.forceSettle(ctx.db, uid, ctx.id);
    return { match: await S.matchById(ctx.db, uid, ctx.id, opts) };
  }],
  ['POST', '/matches/:id/leave', (ctx) => S.leaveMatch(ctx.db, needUser(ctx), ctx.id)],
  ['POST', '/matches/:id/choice', (ctx) => S.chooseNext(ctx.db, needUser(ctx), ctx.id, ctx.body.choice)],
  ['GET', '/matches/:id/messages', async (ctx) => {
    const uid = needUser(ctx);
    return S.chatUpdate(ctx.db, uid, ctx.id, ctx.query.after);
  }],
  ['POST', '/matches/:id/read', (ctx) => S.markChatRead(ctx.db, needUser(ctx), ctx.id, ctx.body.lastId)],
  ['GET', '/chat/unread', (ctx) => S.unreadCounts(ctx.db, needUser(ctx))],
  ['POST', '/matches/:id/messages', async (ctx) => {
    await S.sendMessage(ctx.db, needUser(ctx), ctx.id, ctx.body.body);
    return { ok: true };
  }],

  ['POST', '/appointments/:id/confirm', async (ctx) => {
    const uid = needUser(ctx);
    await S.confirmMate(ctx.db, uid, ctx.id, ctx.body.code, opts);
    return { match: await S.matchForAppointment(ctx.db, uid, ctx.id, opts) };
  }],
  ['POST', '/appointments/:id/checkout', async (ctx) => {
    const uid = needUser(ctx);
    const { minutes } = await S.checkOut(ctx.db, uid, ctx.id, opts);
    await S.autoSettle(ctx.db); // 마지막 약속을 마치면 바로 리포트
    return { minutes, match: await S.matchForAppointment(ctx.db, uid, ctx.id, opts) };
  }],
].map(([method, pattern, handler]) => ({
  method,
  handler,
  regex: new RegExp(`^${pattern.replace(':id', '(\\d+)')}$`), // '\\d' 로 써야 정규식의 숫자(\d)가 된다
}));

// 요청을 하나씩 처리한다. (DB를 localStorage에 저장하는 동안 다른 트랜잭션이 열려 있으면 안 됨)
let queue = Promise.resolve();
const serial = (fn) => (...args) => {
  const run = queue.then(() => fn(...args));
  queue = run.catch(() => {});
  return run;
};

window.__mockApi = serial(async (path, { method = 'GET', body } = {}) => {
  const db = await ready;
  const [pathname, qs] = path.split('?');
  const route = routes.find((r) => r.method === method && r.regex.test(pathname));
  if (!route) return { status: 404, data: { error: '존재하지 않는 API입니다.' } };
  try {
    const ctx = {
      db,
      body: body ?? {},
      query: Object.fromEntries(new URLSearchParams(qs ?? '')),
      id: Number(pathname.match(route.regex)[1]),
      user: await S.userByToken(db, getToken()),
    };
    const data = await route.handler(ctx);
    return { status: 200, data };
  } catch (err) {
    if (err instanceof HttpError || err instanceof S.AppError) return { status: err.status, data: { error: err.message } };
    console.error(err);
    return { status: 500, data: { error: '오류가 발생했어요. 다시 시도해 주세요.' } };
  } finally {
    persist();
  }
});

window.__mockQr = serial(async (appointmentId) => {
  const db = await ready;
  const user = await S.userByToken(db, getToken());
  if (!user) throw new Error('로그인이 필요해요.');
  const { appt, code } = await S.myAttendanceCode(db, user.id, appointmentId);
  const svg = await QRCode.toString(`SB:${appt.id}:${code}`, { type: 'svg', margin: 1, color: { dark: '#203829', light: '#ffffff' } });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
});

window.__mockReset = () => {
  clearSaved();
  setToken(null);
};
