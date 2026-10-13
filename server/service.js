import crypto from 'node:crypto';
import { isUniqueViolation } from './db.js';
import * as T from './time.js';
import {
  LOCATIONS, STYLES, DEPOSITS, SIGNUP_POINTS, CHECKIN_EARLY_MIN, MIN_OVERLAP_MIN,
} from './options.js';

// 모든 함수는 첫 인자로 db(server/db.js 인터페이스)를 받는다.
// 여러 사용자가 동시에 접근해도 데이터가 꼬이지 않도록, 상태를 바꾸는 작업은
// "조건부 UPDATE"(WHERE status = '...')로 먼저 자리를 차지한 뒤 진행한다.

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const iso = () => T.now().toISOString();

// ───────────────────────── 직렬화 ─────────────────────────

const parseRequest = (r) => r && { ...r, days: JSON.parse(r.days), styles: JSON.parse(r.styles) };
const parseMatch = (m) => m && {
  ...m,
  days: JSON.parse(m.days),
  styles: JSON.parse(m.styles),
  report: m.report ? JSON.parse(m.report) : null,
};

export const publicUser = (u) => u && {
  id: u.id,
  name: u.name,
  age: u.age,
  tags: JSON.parse(u.tags),
  bio: u.bio,
  avatar: u.avatar,
};

export const privateUser = (u) => u && { ...publicUser(u), email: u.email, points: u.points };

const getUser = (db, id) => db.get('SELECT * FROM users WHERE id = ?', id);

// ───────────────────────── 인증 ─────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

async function issueToken(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO auth_tokens (token, user_id, created_at) VALUES (?, ?, ?)', token, userId, iso());
  return token;
}

function validateProfile({ name, age, tags, bio, avatar }, partial = false) {
  const out = {};
  if (name !== undefined || !partial) {
    const n = String(name ?? '').trim();
    if (n.length < 1 || n.length > 20) throw new AppError(400, '이름은 1~20자로 입력해 주세요.');
    out.name = n;
  }
  if (age !== undefined && age !== null && age !== '') {
    const a = Number(age);
    if (!Number.isInteger(a) || a < 14 || a > 100) throw new AppError(400, '나이를 올바르게 입력해 주세요.');
    out.age = a;
  } else if (age !== undefined) {
    out.age = null;
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags)) throw new AppError(400, '태그 형식이 올바르지 않습니다.');
    const clean = [...new Set(tags.map((t) => String(t).trim().replace(/^#*/, '')).filter(Boolean))]
      .slice(0, 5)
      .map((t) => `#${t.slice(0, 12)}`);
    out.tags = JSON.stringify(clean);
  }
  if (bio !== undefined) out.bio = String(bio).slice(0, 200);
  if (avatar !== undefined) {
    const a = String(avatar).trim();
    if (!a || [...a].length > 4) throw new AppError(400, '아바타를 다시 골라 주세요.');
    out.avatar = a;
  }
  return out;
}

export async function signup(db, { email, password, name, age }) {
  const e = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new AppError(400, '이메일 형식이 올바르지 않습니다.');
  if (String(password ?? '').length < 6) throw new AppError(400, '비밀번호는 6자 이상이어야 합니다.');
  const profile = validateProfile({ name, age });
  const passwordHash = hashPassword(String(password));
  return db.tx(async (t) => {
    const { rows } = await t.run(
      `INSERT INTO users (email, password_hash, name, age, points, created_at) VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      e, passwordHash, profile.name, profile.age ?? null, iso(),
    );
    if (!rows.length) throw new AppError(409, '이미 가입된 이메일입니다.');
    const id = rows[0].id;
    await adjustPoints(t, id, SIGNUP_POINTS, '가입 축하 포인트');
    return { user: privateUser(await getUser(t, id)), token: await issueToken(t, id) };
  });
}

export async function login(db, { email, password }) {
  const u = await db.get('SELECT * FROM users WHERE email = ? AND is_bot = 0', String(email ?? '').trim().toLowerCase());
  if (!u || !verifyPassword(String(password ?? ''), u.password_hash)) {
    throw new AppError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  return { user: privateUser(u), token: await issueToken(db, u.id) };
}

export async function logout(db, token) {
  await db.run('DELETE FROM auth_tokens WHERE token = ?', token);
}

export async function userByToken(db, token) {
  if (!token) return null;
  return db.get('SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?', token);
}

export async function updateProfile(db, userId, input) {
  const fields = validateProfile(input, true);
  const keys = Object.keys(fields);
  if (keys.length) {
    await db.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      ...keys.map((k) => fields[k]), userId);
  }
  return privateUser(await getUser(db, userId));
}

// ───────────────────────── 포인트 ─────────────────────────

// 잔액 확인과 차감을 한 문장으로 처리해 동시에 요청이 와도 음수가 되지 않는다.
export async function adjustPoints(db, userId, amount, reason, matchId = null) {
  if (!amount) return;
  const { rows } = await db.run(
    'UPDATE users SET points = points + ? WHERE id = ? AND points + ? >= 0 RETURNING points',
    amount, userId, amount,
  );
  if (!rows.length) throw new AppError(400, '포인트가 부족합니다.');
  await db.run(
    'INSERT INTO point_logs (user_id, amount, balance, reason, match_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId, amount, rows[0].points, reason, matchId, iso(),
  );
}

export function pointLogs(db, userId) {
  return db.all('SELECT * FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 50', userId);
}

// ───────────────────────── 매칭 신청 ─────────────────────────

export function validateRequest(input) {
  const days = [...new Set((input.days ?? []).map(Number))].sort();
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    throw new AppError(400, '공부할 요일을 하나 이상 골라 주세요.');
  }
  const timeOk = (t) => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t)
    && T.toMin(t) % 30 === 0 && T.toMin(t) >= 0 && T.toMin(t) <= 24 * 60;
  if (!timeOk(input.startTime) || !timeOk(input.endTime)) {
    throw new AppError(400, '시간을 30분 단위로 골라 주세요.');
  }
  if (T.toMin(input.endTime) - T.toMin(input.startTime) < MIN_OVERLAP_MIN) {
    throw new AppError(400, '공부 시간은 1시간 이상으로 설정해 주세요.');
  }
  if (!LOCATIONS.includes(input.location)) throw new AppError(400, '장소를 골라 주세요.');
  const styles = [...new Set(input.styles ?? [])];
  if (!styles.length || styles.some((s) => !STYLES[s])) {
    throw new AppError(400, '공부 스타일을 하나 이상 골라 주세요.');
  }
  const deposit = Number(input.deposit ?? 0);
  if (deposit !== 0 && !DEPOSITS.includes(deposit)) throw new AppError(400, '보증금 금액이 올바르지 않습니다.');
  return { days, startTime: input.startTime, endTime: input.endTime, location: input.location, styles, deposit };
}

// 두 신청이 매칭 가능한지 판단하고, 가능하면 합의 조건과 점수를 돌려준다.
// 조건: 같은 장소, 겹치는 요일 1개 이상, 겹치는 시간 1시간 이상, 공통 스타일 1개 이상,
//       보증금 사용 여부 일치 (금액이 다르면 작은 쪽에 맞춘다).
export function compatibility(a, b) {
  if (a.location !== b.location) return null;
  if ((a.deposit > 0) !== (b.deposit > 0)) return null;
  const days = a.days.filter((d) => b.days.includes(d));
  if (!days.length) return null;
  const start = Math.max(T.toMin(a.start_time ?? a.startTime), T.toMin(b.start_time ?? b.startTime));
  const end = Math.min(T.toMin(a.end_time ?? a.endTime), T.toMin(b.end_time ?? b.endTime));
  if (end - start < MIN_OVERLAP_MIN) return null;
  const styles = a.styles.filter((s) => b.styles.includes(s));
  if (!styles.length) return null;
  return {
    days,
    startTime: T.fromMin(start),
    endTime: T.fromMin(end),
    location: a.location,
    styles,
    score: days.length * 10 + styles.length * 5 + (end - start) / 60,
  };
}

export async function pendingRequest(db, userId) {
  return parseRequest(await db.get("SELECT * FROM match_requests WHERE user_id = ? AND status = 'pending'", userId));
}

export async function createRequest(db, userId, input) {
  const req = validateRequest(input);
  try {
    return await db.tx(async (t) => {
      if (await pendingRequest(t, userId)) throw new AppError(409, '이미 대기 중인 매칭 신청이 있어요.');
      if (await currentMatchRow(t, userId)) throw new AppError(409, '진행 중인 매칭이 있어요.');
      if (req.deposit) await adjustPoints(t, userId, -req.deposit, '보증금 예치');
      const { rows } = await t.run(
        `INSERT INTO match_requests (user_id, days, start_time, end_time, location, styles, deposit, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        userId, JSON.stringify(req.days), req.startTime, req.endTime, req.location,
        JSON.stringify(req.styles), req.deposit, iso(),
      );
      const match = await tryMatch(t, rows[0].id);
      return { request: await pendingRequest(t, userId), matchId: match?.id ?? null };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, '이미 대기 중인 매칭 신청이 있어요.');
    throw err;
  }
}

export async function cancelRequest(db, userId) {
  return db.tx(async (t) => {
    const { rows } = await t.run(
      "UPDATE match_requests SET status = 'cancelled' WHERE user_id = ? AND status = 'pending' RETURNING deposit",
      userId,
    );
    if (!rows.length) throw new AppError(404, '대기 중인 매칭 신청이 없어요.');
    if (rows[0].deposit) await adjustPoints(t, userId, rows[0].deposit, '매칭 취소 보증금 반환');
  });
}

async function tryMatch(db, requestId) {
  const req = parseRequest(await db.get('SELECT * FROM match_requests WHERE id = ?', requestId));
  const candidates = (await db.all(
    "SELECT * FROM match_requests WHERE status = 'pending' AND user_id != ? AND location = ? ORDER BY id",
    req.user_id, req.location,
  )).map(parseRequest);

  const ranked = candidates
    .map((c) => ({ c, compat: compatibility(req, c) }))
    .filter((x) => x.compat)
    .sort((x, y) => y.compat.score - x.compat.score || x.c.id - y.c.id);

  for (const { c, compat } of ranked) {
    // 다른 사람이 같은 상대를 먼저 데려갔으면 다음 후보로 넘어간다.
    const claimed = await db.run(
      "UPDATE match_requests SET status = 'matched' WHERE id = ? AND status = 'pending'", c.id,
    );
    if (!claimed.changes) continue;
    await db.run("UPDATE match_requests SET status = 'matched' WHERE id = ?", req.id);
    return createMatch(db, {
      userA: c.user_id, // 먼저 기다리던 사람이 A
      userB: req.user_id,
      stakeA: c.deposit,
      stakeB: req.deposit,
      terms: compat,
    });
  }
  return null;
}

// 이번 주 약속 날짜를 계산한다. 오늘부터 7일이 기본이고,
// 오늘 약속이 이미 끝났다면 건너뛴다. 남는 약속이 없으면 내일부터 7일로 잡는다.
export function planWeek(days, startTime, endTime) {
  const t = T.today();
  const build = (offset) => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = T.addDays(t, offset + i);
      if (!days.includes(T.isoWeekday(date))) continue;
      if (T.at(date, endTime) <= T.now()) continue;
      dates.push(date);
    }
    return dates;
  };
  let offset = 0;
  let dates = build(0);
  if (!dates.length) {
    offset = 1;
    dates = build(1);
  }
  return { weekStart: T.addDays(t, offset), weekEnd: T.addDays(t, offset + 6), dates };
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

async function createMatch(db, { userA, userB, stakeA, stakeB, terms, prevMatchId = null }) {
  const stake = Math.min(stakeA, stakeB);
  const { weekStart, weekEnd, dates } = planWeek(terms.days, terms.startTime, terms.endTime);
  const { rows } = await db.run(
    `INSERT INTO matches (user_a, user_b, days, start_time, end_time, location, styles, stake,
                          week_start, week_end, prev_match_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    userA, userB, JSON.stringify(terms.days), terms.startTime, terms.endTime, terms.location,
    JSON.stringify(terms.styles), stake, weekStart, weekEnd, prevMatchId, iso(),
  );
  const matchId = rows[0].id;

  if (stakeA > stake) await adjustPoints(db, userA, stakeA - stake, '보증금 차액 반환 (메이트 금액에 맞춤)', matchId);
  if (stakeB > stake) await adjustPoints(db, userB, stakeB - stake, '보증금 차액 반환 (메이트 금액에 맞춤)', matchId);

  for (const date of dates) {
    await db.run(
      'INSERT INTO appointments (match_id, date, start_time, end_time, code) VALUES (?, ?, ?, ?, ?)',
      matchId, date, terms.startTime, terms.endTime, makeCode(),
    );
  }
  return getMatchRow(db, matchId);
}

// ───────────────────────── 매칭 조회 ─────────────────────────

const getMatchRow = async (db, id) => parseMatch(await db.get('SELECT * FROM matches WHERE id = ?', id));

async function currentMatchRow(db, userId) {
  return parseMatch(await db.get(
    `SELECT * FROM matches WHERE (user_a = ? OR user_b = ?) AND status IN ('active', 'reported')
     ORDER BY id DESC LIMIT 1`,
    userId, userId,
  ));
}

const mateOf = (m, userId) => (m.user_a === userId ? m.user_b : m.user_a);
const isMember = (m, userId) => m && (m.user_a === userId || m.user_b === userId);

async function loadMatchForUser(db, userId, matchId) {
  const m = await getMatchRow(db, matchId);
  if (!isMember(m, userId)) throw new AppError(404, '매칭을 찾을 수 없어요.');
  return m;
}

// 약속 주간이 끝난 매칭의 리포트를 만든다. (크론 + 조회할 때마다)
export async function autoSettle(db) {
  const due = await db.all("SELECT id FROM matches WHERE status = 'active' AND week_end < ?", T.today());
  for (const { id } of due) await settleMatch(db, id);
  return due.length;
}

const attendanceOf = (db, appointmentId, userId) =>
  db.get('SELECT * FROM attendance WHERE appointment_id = ? AND user_id = ?', appointmentId, userId);

// 아직 '공부 종료'를 누르지 않은 기록의 공부시간 추정: 입실 ~ min(약속 종료, 지금)
function studiedMinutes(att, appt) {
  if (!att) return 0;
  if (att.minutes != null) return att.minutes;
  const end = Math.min(T.at(appt.date, appt.end_time).getTime(), T.now().getTime());
  return Math.max(0, Math.round((end - new Date(att.checked_in_at).getTime()) / 60000));
}

function isCheckinWindow(appt) {
  const nowT = T.now().getTime();
  const open = T.at(appt.date, appt.start_time).getTime() - CHECKIN_EARLY_MIN * 60000;
  const close = T.at(appt.date, appt.end_time).getTime();
  return nowT >= open && nowT < close;
}

function appointmentStatus(appt, att, demo) {
  if (att) return att.checked_out_at ? 'done' : 'studying';
  if (T.at(appt.date, appt.end_time) <= T.now()) return 'missed';
  if (demo || isCheckinWindow(appt)) return 'open';
  return 'scheduled';
}

export async function matchDetail(db, userId, m, { demo = false } = {}) {
  const mateId = mateOf(m, userId);
  const appts = await db.all('SELECT * FROM appointments WHERE match_id = ? ORDER BY date', m.id);
  const atts = await db.all(
    'SELECT a.* FROM attendance a JOIN appointments p ON p.id = a.appointment_id WHERE p.match_id = ?', m.id,
  );
  const find = (apptId, uid) => atts.find((a) => a.appointment_id === apptId && a.user_id === uid) ?? null;

  const appointments = appts.map((a) => {
    const mine = find(a.id, userId);
    const mates = find(a.id, mateId);
    return {
      id: a.id,
      date: a.date,
      weekday: T.isoWeekday(a.date),
      startTime: a.start_time,
      endTime: a.end_time,
      location: m.location,
      code: a.code,
      me: { status: appointmentStatus(a, mine, demo), checkedInAt: mine?.checked_in_at ?? null,
        method: mine?.method ?? null, minutes: studiedMinutes(mine, a) },
      mate: { status: appointmentStatus(a, mates, demo), minutes: studiedMinutes(mates, a) },
    };
  });

  const week = [];
  for (let i = 0; i < 7; i++) {
    const date = T.addDays(m.week_start, i);
    const a = appointments.find((x) => x.date === date);
    week.push({ date, weekday: T.isoWeekday(date), me: a ? a.me.status : 'off', mate: a ? a.mate.status : 'off' });
  }

  const summarize = (who) => {
    const total = appointments.length;
    const attended = appointments.filter((a) => ['done', 'studying'].includes(a[who].status)).length;
    const minutes = appointments.reduce((s, a) => s + a[who].minutes, 0);
    return { total, attended, minutes };
  };

  const amA = m.user_a === userId;
  return {
    id: m.id,
    status: m.status,
    location: m.location,
    days: m.days,
    startTime: m.start_time,
    endTime: m.end_time,
    styles: m.styles,
    stake: m.stake,
    weekStart: m.week_start,
    weekEnd: m.week_end,
    round: await countRounds(db, m),
    mate: publicUser(await getUser(db, mateId)),
    appointments,
    week,
    stats: { me: summarize('me'), mate: summarize('mate') },
    report: m.report && { me: m.report.users[userId], mate: m.report.users[mateId] },
    myChoice: amA ? m.choice_a : m.choice_b,
    mateChoice: amA ? m.choice_b : m.choice_a,
  };
}

async function countRounds(db, m) {
  let n = 1;
  let prev = m.prev_match_id;
  while (prev) {
    n++;
    prev = (await db.get('SELECT prev_match_id FROM matches WHERE id = ?', prev))?.prev_match_id;
  }
  return n;
}

export async function currentMatch(db, userId, opts) {
  await autoSettle(db);
  const m = await currentMatchRow(db, userId);
  return m ? matchDetail(db, userId, m, opts) : null;
}

export async function matchHistory(db, userId) {
  const rows = await db.all(
    `SELECT * FROM matches WHERE (user_a = ? OR user_b = ?) AND status = 'closed' ORDER BY id DESC LIMIT 20`,
    userId, userId,
  );
  const out = [];
  for (const row of rows) {
    const m = parseMatch(row);
    const mateId = mateOf(m, userId);
    out.push({
      id: m.id,
      weekStart: m.week_start,
      weekEnd: m.week_end,
      location: m.location,
      mate: publicUser(await getUser(db, mateId)),
      report: m.report && { me: m.report.users[userId], mate: m.report.users[mateId] },
    });
  }
  return out;
}

export async function homeState(db, userId, opts) {
  const match = await currentMatch(db, userId, opts);
  return {
    user: privateUser(await getUser(db, userId)),
    pendingRequest: await pendingRequest(db, userId),
    match,
  };
}

// ───────────────────────── 출석 ─────────────────────────

async function loadAppointment(db, userId, appointmentId) {
  const appt = await db.get('SELECT * FROM appointments WHERE id = ?', appointmentId);
  if (!appt) throw new AppError(404, '약속을 찾을 수 없어요.');
  const m = await loadMatchForUser(db, userId, appt.match_id);
  return { appt, m };
}

export async function appointmentForQr(db, userId, appointmentId) {
  return (await loadAppointment(db, userId, appointmentId)).appt;
}

const insertAttendance = (db, appointmentId, userId, method) => db.run(
  `INSERT INTO attendance (appointment_id, user_id, method, checked_in_at) VALUES (?, ?, ?, ?)
   ON CONFLICT (appointment_id, user_id) DO NOTHING`,
  appointmentId, userId, method, iso(),
);

export async function checkIn(db, userId, appointmentId, { method, code }, { demo = false } = {}) {
  return db.tx(async (t) => {
    const { appt, m } = await loadAppointment(t, userId, appointmentId);
    if (m.status !== 'active') throw new AppError(400, '이미 마감된 주간이에요.');
    if (!demo && !isCheckinWindow(appt)) {
      throw new AppError(400, `출석은 약속 시작 ${CHECKIN_EARLY_MIN}분 전부터 종료 시각까지 할 수 있어요.`);
    }
    if (method === 'qr') {
      if (String(code ?? '').trim().toUpperCase() !== appt.code) {
        throw new AppError(400, 'QR 코드가 이 약속과 일치하지 않아요.');
      }
    } else if (method !== 'self') {
      throw new AppError(400, '출석 방식이 올바르지 않습니다.');
    }
    const { changes } = await insertAttendance(t, appt.id, userId, method);
    if (!changes) throw new AppError(409, '이미 출석했어요.');

    // 데모용 메이트(봇)는 사용자가 출석하면 함께 출석한다.
    const mate = await getUser(t, mateOf(m, userId));
    if (mate.is_bot) await insertAttendance(t, appt.id, mate.id, 'qr');
  });
}

export async function checkOut(db, userId, appointmentId, { demo = false } = {}) {
  return db.tx(async (t) => {
    const { appt, m } = await loadAppointment(t, userId, appointmentId);
    const att = await attendanceOf(t, appt.id, userId);
    if (!att) throw new AppError(400, '먼저 출석해 주세요.');
    if (att.checked_out_at) throw new AppError(409, '이미 공부를 마쳤어요.');
    const nowT = T.now().getTime();
    // 데모 모드에서는 약속 시간과 상관없이 실제 경과 시간을 기록한다.
    const end = demo ? nowT : Math.min(nowT, T.at(appt.date, appt.end_time).getTime());
    const minutes = Math.max(0, Math.round((end - new Date(att.checked_in_at).getTime()) / 60000));
    const { changes } = await t.run(
      'UPDATE attendance SET checked_out_at = ?, minutes = ? WHERE id = ? AND checked_out_at IS NULL',
      iso(), minutes, att.id,
    );
    if (!changes) throw new AppError(409, '이미 공부를 마쳤어요.');

    const mate = await getUser(t, mateOf(m, userId));
    if (mate.is_bot) {
      await t.run(
        `UPDATE attendance SET checked_out_at = ?, minutes = ?
         WHERE appointment_id = ? AND user_id = ? AND checked_out_at IS NULL`,
        iso(), minutes, appt.id, mate.id,
      );
    }
    return { minutes };
  });
}

// ───────────────────────── 주간 정산 / 리포트 ─────────────────────────

export async function settleMatch(db, matchId) {
  return db.tx(async (t) => {
    // 먼저 상태를 바꿔 자리를 차지한다. 다른 요청이 이미 정산했다면 아무것도 하지 않는다.
    const claimed = await t.run("UPDATE matches SET status = 'reported' WHERE id = ? AND status = 'active'", matchId);
    if (!claimed.changes) return getMatchRow(t, matchId);
    const m = await getMatchRow(t, matchId);
    const appts = await t.all('SELECT * FROM appointments WHERE match_id = ?', m.id);

    const stat = async (uid) => {
      let attended = 0;
      let minutes = 0;
      for (const a of appts) {
        const att = await attendanceOf(t, a.id, uid);
        if (!att) continue;
        attended++;
        const mins = studiedMinutes(att, a);
        minutes += mins;
        if (!att.checked_out_at) {
          await t.run('UPDATE attendance SET checked_out_at = ?, minutes = ? WHERE id = ?', iso(), mins, att.id);
        }
      }
      const total = appts.length;
      return { total, attended, minutes, rate: total ? Math.round((attended / total) * 100) : 100,
        kept: attended >= total };
    };

    const users = { [m.user_a]: await stat(m.user_a), [m.user_b]: await stat(m.user_b) };

    for (const [uid, mid] of [[m.user_a, m.user_b], [m.user_b, m.user_a]]) {
      const me = users[uid];
      const mate = users[mid];
      if (!m.stake) {
        me.deposit = { result: 'none', amount: 0 };
      } else if (me.kept) {
        await adjustPoints(t, uid, m.stake, '약속 이행 · 보증금 반환', m.id);
        me.deposit = { result: 'refunded', amount: m.stake };
      } else if (mate.kept) {
        await adjustPoints(t, mid, m.stake, '메이트 약속 미이행 보상', m.id);
        me.deposit = { result: 'to_mate', amount: m.stake };
      } else {
        me.deposit = { result: 'forfeited', amount: m.stake };
      }
    }
    for (const [uid, mid] of [[m.user_a, m.user_b], [m.user_b, m.user_a]]) {
      users[uid].reward = users[mid].deposit.result === 'to_mate' ? m.stake : 0;
    }

    const report = { generatedAt: iso(), users };
    await t.run('UPDATE matches SET report = ? WHERE id = ?', JSON.stringify(report), m.id);

    // 데모용 봇은 항상 '계속하기'를 고른다.
    for (const [uid, col] of [[m.user_a, 'choice_a'], [m.user_b, 'choice_b']]) {
      if ((await getUser(t, uid)).is_bot) await t.run(`UPDATE matches SET ${col} = 'continue' WHERE id = ?`, m.id);
    }
    return getMatchRow(t, m.id);
  });
}

// 데모 모드에서 주간을 즉시 마감한다.
export async function forceSettle(db, userId, matchId) {
  const m = await loadMatchForUser(db, userId, matchId);
  if (m.status !== 'active') throw new AppError(400, '이미 마감된 주간이에요.');
  await settleMatch(db, m.id);
}

export async function chooseNext(db, userId, matchId, choice) {
  if (!['continue', 'new'].includes(choice)) throw new AppError(400, '선택이 올바르지 않습니다.');
  return db.tx(async (t) => {
    const m = await loadMatchForUser(t, userId, matchId);
    const col = m.user_a === userId ? 'choice_a' : 'choice_b';
    // UPDATE ... RETURNING 으로 행을 잠그고 최신 상태를 읽는다. (둘이 동시에 골라도 한쪽이 반드시 상대 선택을 본다)
    const { rows } = await t.run(
      `UPDATE matches SET ${col} = ? WHERE id = ? AND status = 'reported' RETURNING *`, choice, m.id,
    );
    if (!rows.length) throw new AppError(400, '리포트가 나온 뒤에 선택할 수 있어요.');
    const updated = parseMatch(rows[0]);

    if (updated.choice_a === 'new' || updated.choice_b === 'new') {
      await closeMatch(t, updated);
      return { next: 'new' };
    }
    if (updated.choice_a === 'continue' && updated.choice_b === 'continue') {
      await closeMatch(t, updated);
      const next = await continueMatch(t, updated);
      return { next: 'continue', matchId: next.id };
    }
    return { next: 'waiting' };
  });
}

async function continueMatch(db, m) {
  // 이전 주와 같은 보증금을 다시 건다. 둘 중 한 명이라도 포인트가 부족하면 보증금 없이 진행.
  let stake = m.stake;
  const canPay = async (uid) => (await getUser(db, uid)).points >= stake;
  if (stake && (!(await canPay(m.user_a)) || !(await canPay(m.user_b)))) stake = 0;
  if (stake) {
    await adjustPoints(db, m.user_a, -stake, '보증금 예치 (재매칭)', m.id);
    await adjustPoints(db, m.user_b, -stake, '보증금 예치 (재매칭)', m.id);
  }
  return createMatch(db, {
    userA: m.user_a,
    userB: m.user_b,
    stakeA: stake,
    stakeB: stake,
    prevMatchId: m.id,
    terms: { days: m.days, startTime: m.start_time, endTime: m.end_time, location: m.location, styles: m.styles },
  });
}

async function closeMatch(db, m) {
  await db.run("UPDATE matches SET status = 'closed' WHERE id = ?", m.id);
  // 매칭이 끝난 봇은 다시 매칭 대기열에 들어간다.
  for (const uid of [m.user_a, m.user_b]) await requeueBot(db, uid);
}

export async function requeueBot(db, userId) {
  const u = await getUser(db, userId);
  if (!u.is_bot || !u.bot_template) return;
  if (await pendingRequest(db, userId) || await currentMatchRow(db, userId)) return;
  const t = JSON.parse(u.bot_template);
  if (t.deposit) await adjustPoints(db, userId, -t.deposit, '보증금 예치');
  await db.run(
    `INSERT INTO match_requests (user_id, days, start_time, end_time, location, styles, deposit, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, JSON.stringify(t.days), t.startTime, t.endTime, t.location, JSON.stringify(t.styles), t.deposit, iso(),
  );
}

// ───────────────────────── 채팅 ─────────────────────────

const BOT_REPLIES = [
  '좋아요! 이번 주도 같이 힘내봐요 💪',
  '저도 지금 막 자리 잡았어요. 오늘 목표 정하셨어요?',
  '넵! 약속 시간 맞춰서 갈게요 :)',
  '오늘은 2시간 집중해 보려고요. 화이팅!',
  '끝나고 공부한 거 서로 공유해요 ✍️',
];

// 빠른 연락 메시지에는 상황에 맞게 답한다.
const BOT_CONTEXT_REPLIES = [
  [/늦을|지연/, '괜찮아요! 천천히 조심히 오세요 :)'],
  [/도착|접속/, '저도 거의 다 왔어요! 곧 봬요 🙌'],
  [/쉬었다|쉬는/, '좋아요! 10분 뒤에 다시 시작해요 ☕'],
  [/수고/, '저도요! 다음 약속 때 또 봬요 👋'],
];

function botReply(text) {
  const hit = BOT_CONTEXT_REPLIES.find(([re]) => re.test(text));
  return hit ? hit[1] : BOT_REPLIES[crypto.randomInt(BOT_REPLIES.length)];
}

export async function listMessages(db, userId, matchId, afterId = 0) {
  await loadMatchForUser(db, userId, matchId);
  return db.all(
    'SELECT id, user_id AS "userId", body, created_at AS "createdAt" FROM messages WHERE match_id = ? AND id > ? ORDER BY id',
    matchId, Number(afterId) || 0,
  );
}

export async function sendMessage(db, userId, matchId, body) {
  const text = String(body ?? '').trim();
  if (!text) throw new AppError(400, '메시지를 입력해 주세요.');
  if (text.length > 500) throw new AppError(400, '메시지는 500자까지 보낼 수 있어요.');
  return db.tx(async (t) => {
    const m = await loadMatchForUser(t, userId, matchId);
    if (m.status === 'closed') throw new AppError(400, '종료된 매칭이에요.');
    const insert = (uid, msg) => t.run(
      'INSERT INTO messages (match_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', m.id, uid, msg, iso(),
    );
    await insert(userId, text);
    const mate = await getUser(t, mateOf(m, userId));
    if (mate.is_bot) await insert(mate.id, botReply(text));
  });
}
