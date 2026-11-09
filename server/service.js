import crypto from 'node:crypto';
import { isUniqueViolation } from './db.js';
import * as T from './time.js';
import {
  LOCATIONS, STYLES, CHECKIN_EARLY_MIN, MIN_OVERLAP_MIN,
  EMAIL_CODE_TTL_MIN, EMAIL_CODE_MAX_ATTEMPTS, EMAIL_CODE_RESEND_SEC, EXAM, TIME_SLOTS, STUDY_PERIOD, ADMIN_EMAILS, PROMISE_RULE,
  PRIVACY_POLICY,
} from './options.js';
import { createSession, sessionUser, endSession, endAllSessions } from './sessions.js';
// 전화번호는 운영 결정(2026-11-06)으로 암호화하지 않고 그대로 저장한다. 예전에 암호화된 값이 있으면 읽을 때만 풀어 준다.
import { decryptField, emailHash } from './fieldcrypt.js';

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

// 신청 장소: 여러 개를 고를 수 있어 JSON 배열로 저장한다. 예전 신청·데모 메이트는 장소 하나(문자열).
const locationsOf = (x) => x.locations
  ?? (String(x.location ?? '').startsWith('[') ? JSON.parse(x.location) : [x.location]);

const parseRequest = (r) => {
  if (!r) return r;
  const days = JSON.parse(r.days);
  // cells: 시간표에서 고른 칸 ["요일-시간대번호", ...]. 예전 신청·데모 메이트는 요일 × 시간 범위로 만든다.
  const cells = r.cells ? JSON.parse(r.cells) : cellsFromRange(days, r.start_time, r.end_time);
  const locations = locationsOf(r);
  return { ...r, days, styles: JSON.parse(r.styles), cells, schedule: runsOf(cells), locations, location: locations.join(' · ') };
};
const parseMatch = (m) => m && {
  ...m,
  days: JSON.parse(m.days),
  styles: JSON.parse(m.styles),
  report: m.report ? JSON.parse(m.report) : null,
  // 요일별 약속 시간 [{ day, start, end }]. 예전 매칭은 모든 요일이 같은 시간.
  schedule: m.schedule ? JSON.parse(m.schedule)
    : JSON.parse(m.days).map((day) => ({ day, start: m.start_time, end: m.end_time })),
};

// ───────────────────────── 시간표 칸 ─────────────────────────
// 칸 = 요일(1=월…7=일) × 시간대 번호(TIME_SLOTS 순서). 문자열 "요일-번호"로 다룬다.

const cellKey = (day, slot) => `${day}-${slot}`;
const parseCell = (c) => c.split('-').map(Number);

// 요일들 × [start, end] 안에 완전히 들어가는 시간대 칸
function cellsFromRange(days, start, end) {
  const s = T.toMin(start);
  const e = T.toMin(end);
  const out = [];
  for (const day of days) {
    TIME_SLOTS.forEach((slot, i) => {
      if (T.toMin(slot.start) >= s && T.toMin(slot.end) <= e) out.push(cellKey(day, i));
    });
  }
  return out;
}

// 요일별로 이어진 칸 묶음 → [{ day, start, end, minutes }] (요일 순, 같은 요일은 시간 순)
function runsOf(cells) {
  const byDay = new Map();
  for (const c of cells) {
    const [d, i] = parseCell(c);
    byDay.set(d, [...(byDay.get(d) ?? []), i]);
  }
  const runs = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const idx = [...new Set(byDay.get(day))].sort((a, b) => a - b);
    let from = idx[0];
    for (let k = 1; k <= idx.length; k++) {
      const continues = k < idx.length && idx[k] === idx[k - 1] + 1 && TIME_SLOTS[idx[k - 1]].end === TIME_SLOTS[idx[k]].start;
      if (continues) continue;
      const start = TIME_SLOTS[from].start;
      const end = TIME_SLOTS[idx[k - 1]].end;
      runs.push({ day, start, end, minutes: T.toMin(end) - T.toMin(start) });
      if (k < idx.length) from = idx[k];
    }
  }
  return runs;
}

// 공통 칸으로 요일별 약속 시간 정하기: 요일마다 가장 긴(같으면 이른) 묶음 하나
function scheduleFromCells(cells) {
  const best = new Map();
  for (const r of runsOf(cells)) {
    const cur = best.get(r.day);
    if (!cur || r.minutes > cur.minutes) best.set(r.day, r);
  }
  return [...best.values()].filter((r) => r.minutes >= MIN_OVERLAP_MIN);
}

export const publicUser = (u) => u && {
  id: u.id,
  name: u.name,
  age: u.age,
  tags: JSON.parse(u.tags),
  bio: u.bio,
  avatar: u.avatar,
  isBot: !!u.is_bot && !!u.bot_template, // 체험용 데모 메이트 (화면에 "가상 인물"로 표시)
};

export const privateUser = (u) => u && {
  ...publicUser(u), email: u.email, department: u.department ?? null, phone: decryptField(u.phone),
  isAdmin: ADMIN_EMAILS.includes(u.email),
};

const getUser = (db, id) => db.get('SELECT * FROM users WHERE id = ?', id);

// ───────────────────────── 인증 ─────────────────────────

// 비밀번호: scrypt(비동기 — 계산하는 동안에도 서버가 다른 요청을 받는다) + 사람마다 다른 소금값
const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
});

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt)).toString('hex')}`;
}

export async function passwordMatches(password, stored) {
  const [salt, hash] = String(stored ?? '').split(':');
  if (!salt || !hash) return false;
  const actual = await scrypt(password, salt);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

// 없는 메일로 로그인해도 같은 시간이 걸리게 (응답 시간으로 가입 여부를 알아내지 못하게)
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

// 로그인 세션 (server/sessions.js — 토큰은 해시로만 저장, 30일 만료)
const issueToken = (db, userId) => createSession(db, userId);

// 전화번호: 숫자만 남겨 010-1234-5678 꼴로
function normalizePhone(phone) {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (!/^01[016789]\d{7,8}$/.test(d)) throw new AppError(400, '전화번호를 올바르게 입력해 주세요. (예: 010-1234-5678)');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

function validateProfile({ name, age, tags, bio, avatar, department, phone }, partial = false) {
  const out = {};
  if (name !== undefined || !partial) {
    const n = String(name ?? '').trim();
    if (n.length < 1 || n.length > 20) throw new AppError(400, '이름은 1~20자로 입력해 주세요.');
    out.name = n;
  }
  // 학과·전화번호: 가입 때 꼭 받고, 본인과 운영자만 본다 (메이트에게는 보이지 않음)
  if (department !== undefined || !partial) {
    const d = String(department ?? '').trim();
    if (d.length < 1 || d.length > 30) throw new AppError(400, '학과를 입력해 주세요.');
    out.department = d;
  }
  if (phone !== undefined || !partial) out.phone = normalizePhone(phone);
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

// 이메일 정책: { domain: 'kookmin.ac.kr' | null, verify: true면 가입·비밀번호 찾기에 메일 인증번호 필요 }
// 실서비스는 { domain: EMAIL_DOMAIN, verify: true }, 로컬 데모·테스트 기본값은 제한 없음.
const NO_POLICY = { domain: null, verify: false };

function normalizeEmail(email, policy = NO_POLICY) {
  const e = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new AppError(400, '이메일 형식이 올바르지 않습니다.');
  if (policy.domain && !e.endsWith(`@${policy.domain}`)) {
    throw new AppError(400, `국민대학교 메일(@${policy.domain})만 사용할 수 있어요.`);
  }
  return e;
}

const checkPassword = (password) => {
  if (String(password ?? '').length < 6) throw new AppError(400, '비밀번호는 6자 이상이어야 합니다.');
};

const hashCode = (email, code) => crypto.createHash('sha256').update(`${email}:${code}`).digest('hex');

// 인증번호 메일 보내기. purpose: 'signup'(가입) | 'reset'(비밀번호 찾기)
export async function requestEmailCode(db, mailer, { email, purpose }, policy = NO_POLICY) {
  if (!['signup', 'reset'].includes(purpose)) throw new AppError(400, '요청이 올바르지 않습니다.');
  const e = normalizeEmail(email, policy);
  if (!mailer) throw new AppError(503, '메일 발송이 아직 설정되지 않았어요. 운영자에게 문의해 주세요.');

  const exists = await db.get('SELECT id FROM users WHERE email = ? AND is_bot = 0', e);
  if (purpose === 'signup' && exists) throw new AppError(409, '이미 가입된 이메일입니다. 로그인해 주세요.');

  const last = await db.get(
    'SELECT created_at FROM email_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1', e, purpose,
  );
  const wait = last && EMAIL_CODE_RESEND_SEC - Math.floor((T.now() - new Date(last.created_at)) / 1000);
  if (wait > 0) throw new AppError(429, `${wait}초 후에 다시 받을 수 있어요.`);

  // 가입되지 않은 메일로 비밀번호 찾기를 요청하면, 가입 여부를 알 수 없도록 성공처럼 응답만 한다.
  if (purpose === 'reset' && !exists) return { sent: true };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = new Date(T.now().getTime() + EMAIL_CODE_TTL_MIN * 60000).toISOString();
  await db.run("UPDATE email_codes SET used = 1 WHERE email = ? AND purpose = ? AND used = 0", e, purpose);
  await db.run(
    'INSERT INTO email_codes (email, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    e, purpose, hashCode(e, code), expires, iso(),
  );

  const what = purpose === 'signup' ? '회원가입' : '비밀번호 재설정';
  await mailer.send({
    to: e,
    subject: `[스터디버디] ${what} 인증번호 ${code}`,
    text: `스터디버디 ${what} 인증번호는 ${code} 입니다.\n${EMAIL_CODE_TTL_MIN}분 안에 입력해 주세요.\n\n본인이 요청하지 않았다면 이 메일을 무시하세요.`,
    html: `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #dde4d5;border-radius:16px">
      <p style="color:#315443;font-weight:800;margin:0 0 12px">STUDY BUDDY</p>
      <p>스터디버디 ${what} 인증번호입니다.</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:6px;color:#203829;margin:16px 0">${code}</p>
      <p style="color:#5f6b5c;font-size:13px">${EMAIL_CODE_TTL_MIN}분 안에 입력해 주세요. 본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
    </div>`,
  });
  return { sent: true };
}

// 인증번호 확인. 틀리면 시도 횟수를 올리고(트랜잭션 밖에서 기록되도록 여기서 처리), 맞으면 코드 id를 돌려준다.
async function verifyEmailCode(db, email, purpose, code) {
  const row = await db.get(
    'SELECT * FROM email_codes WHERE email = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1', email, purpose,
  );
  if (!row || new Date(row.expires_at) <= T.now()) throw new AppError(400, '인증번호를 다시 받아 주세요.');
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) throw new AppError(400, '입력 횟수를 넘었어요. 인증번호를 다시 받아 주세요.');
  if (hashCode(email, String(code ?? '').trim()) !== row.code_hash) {
    await db.run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    const left = EMAIL_CODE_MAX_ATTEMPTS - row.attempts - 1;
    throw new AppError(400, left > 0 ? `인증번호가 맞지 않아요. (${left}번 남음)` : '입력 횟수를 넘었어요. 인증번호를 다시 받아 주세요.');
  }
  return row.id;
}

// policy.consent: 개인정보 처리방침 동의가 필요한지 (실서비스). 동의하면 시각과 처리방침 버전을 남긴다.
export async function signup(db, { email, password, name, age, department, phone, code, agree }, policy = NO_POLICY) {
  const e = normalizeEmail(email, policy);
  checkPassword(password);
  const profile = validateProfile({ name, age, department, phone });
  if (policy.consent && agree !== true) throw new AppError(400, '개인정보 수집·이용에 동의해 주세요.');
  const codeId = policy.verify ? await verifyEmailCode(db, e, 'signup', code) : null;
  const passwordHash = await hashPassword(String(password));
  return db.tx(async (t) => {
    const { rows } = await t.run(
      `INSERT INTO users (email, password_hash, name, age, department, phone, points, created_at, agreed_at, privacy_version)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      e, passwordHash, profile.name, profile.age ?? null, profile.department, profile.phone, iso(),
      agree === true ? iso() : null, agree === true ? PRIVACY_POLICY.version : null,
    );
    if (!rows.length) throw new AppError(409, '이미 가입된 이메일입니다.');
    if (codeId) await t.run('UPDATE email_codes SET used = 1 WHERE id = ?', codeId);
    const id = rows[0].id;
    // 매칭 정지 중에 탈퇴했던 메일이면 남은 정지 기간을 이어 간다 (server/privacy.js)
    const blocked = await t.get('SELECT blocked_until FROM blocked_emails WHERE email_hash = ?', emailHash(e));
    if (blocked && new Date(blocked.blocked_until) > T.now()) {
      await t.run('UPDATE users SET suspended_until = ?, strikes_since = ? WHERE id = ?', blocked.blocked_until, blocked.blocked_until, id);
    }
    return { user: privateUser(await getUser(t, id)), token: await issueToken(t, id) };
  });
}

export async function login(db, { email, password }, policy = NO_POLICY) {
  const e = normalizeEmail(email, policy);
  const u = await db.get('SELECT * FROM users WHERE email = ? AND is_bot = 0', e);
  const ok = await passwordMatches(String(password ?? ''), u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) {
    throw new AppError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  return { user: privateUser(u), token: await issueToken(db, u.id) };
}

// 비밀번호 찾기: 메일로 받은 인증번호로 새 비밀번호 설정. 다른 기기의 로그인은 모두 해제하고 새로 로그인시킨다.
export async function resetPassword(db, { email, code, password }, policy = NO_POLICY) {
  const e = normalizeEmail(email, policy);
  checkPassword(password);
  const codeId = await verifyEmailCode(db, e, 'reset', code);
  const passwordHash = await hashPassword(String(password));
  return db.tx(async (t) => {
    const u = await t.get('SELECT * FROM users WHERE email = ? AND is_bot = 0', e);
    if (!u) throw new AppError(400, '인증번호를 다시 받아 주세요.');
    await t.run('UPDATE email_codes SET used = 1 WHERE id = ?', codeId);
    await t.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, u.id);
    await endAllSessions(t, u.id); // 다른 기기의 로그인은 모두 해제
    return { user: privateUser(u), token: await issueToken(t, u.id) };
  });
}

// 데모 계정 로그인 (데모 모드 전용). 계정이 없으면 만든다.
export const DEMO_ACCOUNT = { email: 'demo@studybuddy.local', name: '데모 사용자', department: '경영정보학부', phone: '010-0000-0000' };

export async function demoLogin(db) {
  let u = await db.get('SELECT * FROM users WHERE email = ? AND is_bot = 0', DEMO_ACCOUNT.email);
  if (!u) {
    await signup(db, { ...DEMO_ACCOUNT, password: crypto.randomBytes(12).toString('hex') });
    u = await db.get('SELECT * FROM users WHERE email = ? AND is_bot = 0', DEMO_ACCOUNT.email);
  }
  await ensureDemoHistory(db, u.id);
  return { user: privateUser(u), token: await issueToken(db, u.id) };
}

// 데모 계정의 '지난 스터디'에 보여 줄 고정 기록 (첫 베타 서비스 회고). 없을 때만 만든다.
const DEMO_HISTORY = {
  mate: {
    email: 'beta-history@studybuddy.local', name: '실제 첫 베타 서비스', avatar: '🚀',
    tags: ['#5일간', '#17명 신청', '#6회 매칭 성사'], bio: '스터디버디 첫 베타 서비스 기록',
  },
  location: '경상관 102A호',
  label: '첫 베타기간', // '1주차' 대신 보여 줄 이름
  headline: '5일간의 실서비스 · 19:00–21:00', // 지난 스터디 화면 맨 위 문구
  days: [1, 2, 3, 4, 5],
  startTime: '19:00',
  endTime: '21:00',
  weekStart: '2026-10-12', // 월
  weekEnd: '2026-10-18',
  dates: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'], // 월~금
  missed: '2026-10-15', // 5일 중 4일 출석
  styles: ['check', 'talk', 'social'],
};

export async function ensureDemoHistory(db, demoUserId) {
  const h = DEMO_HISTORY;
  await db.tx(async (t) => {
    let mate = await t.get('SELECT id FROM users WHERE email = ?', h.mate.email);
    if (!mate) {
      // 기록용 계정: 로그인 불가, 매칭 대기 없음(bot_template 없음)
      const { rows } = await t.run(
        `INSERT INTO users (email, password_hash, name, tags, bio, avatar, points, is_bot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?) ON CONFLICT (email) DO NOTHING RETURNING id`,
        h.mate.email, `!${crypto.randomBytes(8).toString('hex')}`, h.mate.name, JSON.stringify(h.mate.tags),
        h.mate.bio, h.mate.avatar, iso(),
      );
      mate = rows[0] ?? await t.get('SELECT id FROM users WHERE email = ?', h.mate.email);
    }
    const exists = await t.get(
      'SELECT id FROM matches WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?) LIMIT 1',
      mate.id, demoUserId, demoUserId, mate.id,
    );
    if (exists) {
      // 이미 있는 기록도 최신 문구(장소·기간 이름)로 맞춘다.
      const row = await t.get('SELECT report FROM matches WHERE id = ?', exists.id);
      const rep = { ...JSON.parse(row.report), label: h.label, headline: h.headline };
      await t.run('UPDATE matches SET location = ?, report = ? WHERE id = ?', h.location, JSON.stringify(rep), exists.id);
      await t.run('UPDATE users SET name = ?, tags = ?, bio = ?, avatar = ? WHERE id = ?',
        h.mate.name, JSON.stringify(h.mate.tags), h.mate.bio, h.mate.avatar, mate.id);
      return;
    }

    const stat = { total: 5, attended: 4, minutes: 4 * 120, rate: 80, kept: false, deposit: { result: 'none', amount: 0 }, reward: 0 };
    const report = { generatedAt: `${h.weekEnd}T15:00:00.000Z`, label: h.label, headline: h.headline, users: { [mate.id]: { ...stat }, [demoUserId]: { ...stat } } };
    const { rows } = await t.run(
      `INSERT INTO matches (user_a, user_b, days, start_time, end_time, location, styles, stake, week_start, week_end,
                            status, choice_a, choice_b, report, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'closed', 'new', 'new', ?, ?) RETURNING id`,
      mate.id, demoUserId, JSON.stringify(h.days), h.startTime, h.endTime, h.location, JSON.stringify(h.styles),
      h.weekStart, h.weekEnd, JSON.stringify(report), `${h.weekStart}T00:00:00.000Z`,
    );
    const matchId = rows[0].id;
    for (const date of h.dates) {
      const { rows: ap } = await t.run(
        'INSERT INTO appointments (match_id, date, start_time, end_time, code) VALUES (?, ?, ?, ?, ?) RETURNING id',
        matchId, date, h.startTime, h.endTime, makeCode(),
      );
      if (date === h.missed) continue;
      for (const uid of [demoUserId, mate.id]) {
        await t.run(
          'INSERT INTO attendance (appointment_id, user_id, method, checked_in_at, checked_out_at, minutes) VALUES (?, ?, ?, ?, ?, 120)',
          ap[0].id, uid, 'qr', T.at(date, h.startTime).toISOString(), T.at(date, h.endTime).toISOString(),
        );
      }
    }
  });
}

export async function logout(db, token) {
  await endSession(db, token);
}

export async function userByToken(db, token) {
  return (await sessionUser(db, token))?.user ?? null;
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

// ───────────────────────── 개인 일정 ─────────────────────────

// 홈 시간표에 보이는 내 개인 일정 (수업 등). [{ cell: "요일-시간대번호", title }]
export async function setPersonalSchedule(db, userId, entries) {
  if (!Array.isArray(entries)) throw new AppError(400, '일정 형식이 올바르지 않습니다.');
  const seen = new Set();
  const clean = [];
  for (const e of entries) {
    const cell = String(e?.cell ?? '');
    const [d, i] = parseCell(cell);
    if (!/^\d-\d+$/.test(cell) || d < 1 || d > 7 || !TIME_SLOTS[i]) throw new AppError(400, '시간표 칸이 올바르지 않습니다.');
    if (seen.has(cell)) continue;
    seen.add(cell);
    const title = String(e?.title ?? '').trim().slice(0, 20) || '개인 일정';
    clean.push({ cell, title });
  }
  await db.run('UPDATE users SET personal = ? WHERE id = ?', JSON.stringify(clean), userId);
  return clean;
}

// ───────────────────────── 포인트 ─────────────────────────

// 잔액 확인과 차감을 한 문장으로 처리해 동시에 요청이 와도 음수가 되지 않는다.
// 데모 메이트(봇)의 포인트는 바뀌지 않는다. (보증금 예치·반환·보상 모두 없음)
export async function adjustPoints(db, userId, amount, reason, matchId = null) {
  if (!amount) return;
  const { rows } = await db.run(
    'UPDATE users SET points = points + ? WHERE id = ? AND is_bot = 0 AND points + ? >= 0 RETURNING points',
    amount, userId, amount,
  );
  if (!rows.length && (await getUser(db, userId))?.is_bot) return;
  if (!rows.length) throw new AppError(400, '포인트가 부족합니다.');
  await db.run(
    'INSERT INTO point_logs (user_id, amount, balance, reason, match_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId, amount, rows[0].points, reason, matchId, iso(),
  );
}

// ───────────────────────── 매칭 신청 ─────────────────────────

// 스터디 날짜의 시간 (날짜별로 다르게 정한 날이 있으면 그 시간)
const studyTimeOf = (date) => STUDY_PERIOD.times?.[date] ?? STUDY_PERIOD;
const studyDateOfDay = (d) => STUDY_PERIOD.dates.find((date) => T.isoWeekday(date) === d);

// 고른 요일들의 시간표 칸 (요일마다 그 날짜의 스터디 시간)
export const studyCellsFor = (days) => days.flatMap((d) => {
  const { start, end } = studyTimeOf(studyDateOfDay(d));
  return cellsFromRange([d], start, end);
});

// 아직 끝나지 않은 스터디 날짜
const remainingStudyDates = () => STUDY_PERIOD.dates.filter((d) => T.at(d, studyTimeOf(d).end) > T.now());

// 날짜는 스터디 날짜(일·화·수·목) 중 원하는 날을 여러 개 고르고, 시간은 날짜마다 정해져 있다
// (화·수·목 19~21시, 11/1 일요일은 바로 시작). days: 요일 번호(7=일, 2=화, 3=수, 4=목). 보증금은 없다.
export function validateRequest(input) {
  const remaining = remainingStudyDates();
  if (!remaining.length) throw new AppError(400, '이번 스터디 기간이 끝나서 신청할 수 없어요.');
  const days = [...new Set((input.days ?? []).map(Number))].sort((a, b) => a - b);
  if (!days.length) throw new AppError(400, '공부할 날짜를 하나 이상 골라 주세요.');
  if (days.some((d) => !studyDateOfDay(d))) throw new AppError(400, '스터디 날짜 중에서 골라 주세요.');
  if (days.some((d) => !remaining.includes(studyDateOfDay(d)))) throw new AppError(400, '이미 지난 날짜는 고를 수 없어요.');
  // 시간표 칸(1시간 단위)을 보내면 그 칸만, 안 보내면 고른 날짜의 스터디 시간 전체
  const allowed = studyCellsFor(days);
  const cells = input.cells ? [...new Set(input.cells)].filter((c) => allowed.includes(c)) : allowed;
  if (!cells.length) throw new AppError(400, '공부할 시간을 하나 이상 골라 주세요.');
  // 장소는 여러 개 고를 수 있다 (locations). 예전 방식(location 하나)도 받는다.
  const picked = input.locations ?? (input.location ? [input.location] : []);
  const locations = LOCATIONS.filter((l) => picked.includes(l));
  if (!locations.length || locations.length !== new Set(picked).size) throw new AppError(400, '장소를 골라 주세요.');
  const styles = [...new Set(input.styles ?? [])];
  if (!styles.length || styles.some((s) => !STYLES[s])) {
    throw new AppError(400, '공부 스타일을 하나 이상 골라 주세요.');
  }
  const runs = runsOf(cells);
  const startTime = T.fromMin(Math.min(...runs.map((r) => T.toMin(r.start))));
  const endTime = T.fromMin(Math.max(...runs.map((r) => T.toMin(r.end))));
  return {
    cells, days: [...new Set(runs.map((r) => r.day))], startTime, endTime,
    locations, location: locations.join(' · '), styles, deposit: 0,
  };
}

// 두 신청이 매칭 가능한지 판단하고, 가능하면 합의 조건과 점수를 돌려준다.
// 조건: 겹치는 장소 1개 이상, 겹치는 요일 1개 이상, 겹치는 시간 1시간 이상, 공통 스타일 1개 이상.
// 겹치는 장소가 여럿이면 정해진 장소(강의실 등)를 '채팅으로 정하기'보다 먼저 고른다.
export function compatibility(a, b) {
  const locsB = locationsOf(b);
  const commonLocs = LOCATIONS.filter((l) => locationsOf(a).includes(l) && locsB.includes(l));
  if (!commonLocs.length) return null;
  const location = commonLocs.find((l) => l !== '채팅으로 정하기') ?? commonLocs[0];
  // 시간표에서 둘 다 고른 칸 → 요일마다 가장 길게 이어진 시간이 그날 약속 (1시간 이상)
  const cellsA = a.cells ?? cellsFromRange(a.days, a.start_time ?? a.startTime, a.end_time ?? a.endTime);
  const cellsB = new Set(b.cells ?? cellsFromRange(b.days, b.start_time ?? b.startTime, b.end_time ?? b.endTime));
  const common = cellsA.filter((c) => cellsB.has(c));
  const schedule = scheduleFromCells(common);
  if (!schedule.length) return null;
  const styles = a.styles.filter((s) => b.styles.includes(s));
  if (!styles.length) return null;
  return {
    days: schedule.map((r) => r.day),
    schedule: schedule.map(({ day, start, end }) => ({ day, start, end })),
    startTime: T.fromMin(Math.min(...schedule.map((r) => T.toMin(r.start)))),
    endTime: T.fromMin(Math.max(...schedule.map((r) => T.toMin(r.end)))),
    location,
    styles,
    overlapMin: schedule.reduce((sum, r) => sum + r.minutes, 0), // 약속으로 잡히는 시간 합계
    overlapCells: common.length, // 시간표에서 겹치는 칸 수 (매칭 우선순위)
  };
}

export async function pendingRequest(db, userId) {
  return (await pendingRequests(db, userId))[0] ?? null;
}

// 대기 중인 신청 모두 (겹치지 않는 시간대로 여러 개 신청할 수 있다)
export async function pendingRequests(db, userId) {
  return (await db.all("SELECT * FROM match_requests WHERE user_id = ? AND status = 'pending' ORDER BY id", userId))
    .map(parseRequest);
}

// 이미 신청했거나 매칭된 시간표 칸 (새 신청은 이 칸과 겹칠 수 없다)
export async function busyCells(db, userId) {
  const set = new Set();
  for (const r of await pendingRequests(db, userId)) r.cells.forEach((c) => set.add(c));
  for (const m of await activeMatchRows(db, userId)) {
    for (const s of m.schedule) cellsFromRange([s.day], s.start, s.end).forEach((c) => set.add(c));
  }
  return set;
}

export async function createRequest(db, userId, input) {
  await assertNotSuspended(db, userId); // 약속 지키기: 매칭 정지 중이면 신청 불가
  const req = validateRequest(input);
  try {
    return await db.tx(async (t) => {
      await t.lock?.('matching'); // PostgreSQL: 매칭은 한 번에 하나씩 (끝나면 자동으로 풀림)
      const busy = await busyCells(t, userId);
      if (req.cells.some((c) => busy.has(c))) {
        throw new AppError(409, '고른 날짜에 이미 신청했거나 매칭됐어요. 다른 날짜를 골라 주세요.');
      }
      const { rows } = await t.run(
        `INSERT INTO match_requests (user_id, days, start_time, end_time, location, styles, deposit, cells, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        userId, JSON.stringify(req.days), req.startTime, req.endTime, JSON.stringify(req.locations),
        JSON.stringify(req.styles), req.deposit, JSON.stringify(req.cells), iso(),
      );
      const match = await tryMatch(t, rows[0].id);
      const request = match ? null : parseRequest(await t.get('SELECT * FROM match_requests WHERE id = ?', rows[0].id));
      return { request, matchId: match?.id ?? null };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, '이미 대기 중인 매칭 신청이 있어요.');
    throw err;
  }
}

// ───────────────────────── 약속 지키기 (보증금 대신) ─────────────────────────
// 매칭 그만두기(left)·약속 날 미참석(missed)을 기록하고, PROMISE_RULE.strikeLimit번이 되면
// suspendDays일 동안 매칭 신청을 막는다. 정지가 끝나면 0번부터 다시 센다. 데모 메이트·공용 데모 계정은 세지 않는다.

const kDate = (at) => { const [, m, d] = T.dateStr(new Date(at)).split('-').map(Number); return `${m}월 ${d}일`; };
const suspendedMessage = (until) => `매칭 정지 중이에요. ${kDate(until)}부터 다시 신청할 수 있어요.`;

export async function strikeStatus(db, userId) {
  const u = await getUser(db, userId);
  const { strikeLimit: limit, suspendDays } = PROMISE_RULE;
  const suspendedUntil = u?.suspended_until && new Date(u.suspended_until) > T.now() ? u.suspended_until : null;
  const count = suspendedUntil ? limit : Number((await db.get(
    'SELECT COUNT(*) AS n FROM strikes WHERE user_id = ? AND created_at > ?', userId, u?.strikes_since ?? '',
  )).n);
  return { count: Math.min(count, limit), limit, suspendDays, suspendedUntil };
}

async function assertNotSuspended(db, userId) {
  const { suspendedUntil } = await strikeStatus(db, userId);
  if (suspendedUntil) throw new AppError(403, suspendedMessage(suspendedUntil));
}

async function addStrike(db, userId, kind, matchId, appointmentId = 0) {
  const u = await getUser(db, userId);
  if (!u || u.is_bot || u.email === DEMO_ACCOUNT.email) return;
  const { changes } = await db.run(
    `INSERT INTO strikes (user_id, kind, match_id, appointment_id, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    userId, kind, matchId, appointmentId, iso(),
  );
  if (!changes) return; // 이미 센 일
  const st = await strikeStatus(db, userId);
  if (st.suspendedUntil || st.count < st.limit) return; // 정지 중에 생긴 일은 다음 횟수에 넣지 않는다
  // 정지: 오늘부터 suspendDays일 뒤 0시(한국 시간)까지. 정지가 끝나는 시각 뒤의 일만 다시 센다.
  const until = T.at(T.addDays(T.today(), st.suspendDays), '00:00').toISOString();
  await db.run('UPDATE users SET suspended_until = ?, strikes_since = ? WHERE id = ?', until, until, userId);
  // 기다리던 신청은 취소 (정지 중에 매칭되지 않게)
  await db.run("UPDATE match_requests SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'", userId);
}

// 끝난 약속(until 이전)에 출석 기록이 없는 사람을 '미참석'으로 기록한다. 규칙 시작일 이전 약속은 세지 않는다.
async function recordNoShows(db, matchId, until = T.now()) {
  const m = await getMatchRow(db, matchId);
  if (!m) return;
  const appts = await db.all('SELECT * FROM appointments WHERE match_id = ? ORDER BY date, start_time', m.id);
  for (const a of appts) {
    if (a.date < PROMISE_RULE.from || T.at(a.date, a.end_time) > until) continue;
    for (const uid of [m.user_a, m.user_b]) {
      if (!(await attendanceOf(db, a.id, uid))) await addStrike(db, uid, 'missed', m.id, a.id);
    }
  }
}

// requestId 를 주면 그 신청만, 없으면 가장 먼저 한 대기 신청을 취소한다.
export async function cancelRequest(db, userId, requestId = null) {
  return db.tx(async (t) => {
    const target = requestId ?? (await pendingRequest(t, userId))?.id ?? 0;
    const { rows } = await t.run(
      "UPDATE match_requests SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending' RETURNING deposit",
      target, userId,
    );
    if (!rows.length) throw new AppError(404, '대기 중인 매칭 신청이 없어요.');
    if (rows[0].deposit) await adjustPoints(t, userId, rows[0].deposit, '매칭 취소 보증금 반환');
  });
}

// 대기 중인 신청끼리 다시 맞춰 본다 (매일 작업, 안전망). 데모 메이트·공용 데모 계정의 신청은 건드리지 않는다.
export async function rematchPending(db) {
  const ids = (await db.all(
    `SELECT r.id FROM match_requests r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'pending' AND u.is_bot = 0 AND u.email <> ? ORDER BY r.id`, DEMO_ACCOUNT.email,
  )).map((r) => r.id);
  let made = 0;
  for (const id of ids) {
    try {
      const match = await db.tx(async (t) => {
        await t.lock?.('matching');
        const row = await t.get('SELECT status FROM match_requests WHERE id = ?', id);
        return row?.status === 'pending' ? tryMatch(t, id) : null;
      });
      if (match) made++;
    } catch (err) {
      if (!(err instanceof AppError)) throw err; // 스터디 기간이 끝난 신청 등은 건너뛴다
    }
  }
  return made;
}

async function tryMatch(db, requestId) {
  const req = parseRequest(await db.get('SELECT * FROM match_requests WHERE id = ?', requestId));
  const candidates = (await db.all(
    `SELECT r.*, u.is_bot AS u_bot, u.email AS u_email FROM match_requests r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'pending' AND r.user_id != ? ORDER BY r.id`,
    req.user_id,
  )).map(parseRequest); // 장소는 여러 개일 수 있어 compatibility에서 겹치는지 본다
  // 공용 데모 계정은 데모 메이트하고만, 실제 사용자는 실제 사용자하고만 매칭한다.
  // (보증금이 없어진 뒤로 데모 메이트가 실제 스터디 신청을 가져가지 않도록)
  const me = await getUser(db, req.user_id);
  const iAmDemo = me.email === DEMO_ACCOUNT.email;
  const allowed = (c) => (iAmDemo ? !!c.u_bot : !c.u_bot && c.u_email !== DEMO_ACCOUNT.email);

  const ranked = candidates
    .filter(allowed)
    .map((c) => ({ c, compat: compatibility(req, c) }))
    .filter((x) => x.compat)
    // 우선순위: 시간표에서 겹치는 칸 수 → 먼저 기다린 사람
    .sort((x, y) => y.compat.overlapCells - x.compat.overlapCells || x.c.id - y.c.id);

  for (const { c, compat } of ranked) {
    // 데모 메이트는 여러 사람과 동시에 매칭되도록 신청을 그대로 대기 상태로 둔다.
    // 실제 사용자는 다른 사람이 먼저 데려갔으면 다음 후보로 넘어간다.
    if (!c.u_bot) {
      const claimed = await db.run(
        "UPDATE match_requests SET status = 'matched' WHERE id = ? AND status = 'pending'", c.id,
      );
      if (!claimed.changes) continue;
    }
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

// 약속 날짜: 스터디 기간 중 두 사람이 함께 고른 요일이면서 아직 끝나지 않은 날짜 (한국 시간 기준).
// 주간은 스터디 첫날 ~ 마지막 날. schedule: [{ day, start, end }] (없으면 모든 스터디 날짜)
// 반환하는 dates 는 [{ date, start, end }]
export function planStudy(schedule = null) {
  const dates = remainingStudyDates()
    .filter((date) => !schedule || schedule.some((s) => s.day === T.isoWeekday(date)))
    .map((date) => {
      const { start, end } = schedule?.find((s) => s.day === T.isoWeekday(date)) ?? studyTimeOf(date);
      return { date, start, end };
    });
  if (!dates.length) throw new AppError(400, '이번 스터디 기간이 끝났어요.');
  return { weekStart: STUDY_PERIOD.dates[0], weekEnd: STUDY_PERIOD.dates.at(-1), dates };
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

async function createMatch(db, { userA, userB, stakeA, stakeB, terms, prevMatchId = null }) {
  const stake = Math.min(stakeA, stakeB);
  const schedule = terms.schedule ?? terms.days.map((day) => ({ day, start: terms.startTime, end: terms.endTime }));
  const { weekStart, weekEnd, dates } = planStudy(schedule);
  const { rows } = await db.run(
    `INSERT INTO matches (user_a, user_b, days, start_time, end_time, location, styles, stake,
                          week_start, week_end, prev_match_id, schedule, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    userA, userB, JSON.stringify(schedule.map((s) => s.day)), terms.startTime, terms.endTime, terms.location,
    JSON.stringify(terms.styles), stake, weekStart, weekEnd, prevMatchId, JSON.stringify(schedule), iso(),
  );
  const matchId = rows[0].id;

  if (stakeA > stake) await adjustPoints(db, userA, stakeA - stake, '보증금 차액 반환 (메이트 금액에 맞춤)', matchId);
  if (stakeB > stake) await adjustPoints(db, userB, stakeB - stake, '보증금 차액 반환 (메이트 금액에 맞춤)', matchId);

  for (const { date, start, end } of dates) {
    const { rows: ap } = await db.run(
      'INSERT INTO appointments (match_id, date, start_time, end_time, code) VALUES (?, ?, ?, ?, ?) RETURNING id',
      matchId, date, start, end, makeCode(),
    );
    await ensureCodes(db, [ap[0].id], [userA, userB]);
  }
  return getMatchRow(db, matchId);
}

// 약속마다 두 사람의 출석 코드를 만든다 (이미 있으면 그대로). 예전에 만들어진 매칭도 처음 볼 때 채워진다.
async function ensureCodes(db, appointmentIds, userIds) {
  for (const apptId of appointmentIds) {
    for (const uid of userIds) {
      await db.run(
        'INSERT INTO attendance_codes (appointment_id, user_id, code) VALUES (?, ?, ?) ON CONFLICT (appointment_id, user_id) DO NOTHING',
        apptId, uid, makeCode(),
      );
    }
  }
}

// ───────────────────────── 매칭 조회 ─────────────────────────

const getMatchRow = async (db, id) => parseMatch(await db.get('SELECT * FROM matches WHERE id = ?', id));

// 진행 중인 매칭 모두 (리포트 대기 포함)
async function activeMatchRows(db, userId) {
  return (await db.all(
    `SELECT * FROM matches WHERE (user_a = ? OR user_b = ?) AND status IN ('active', 'reported') ORDER BY id`,
    userId, userId,
  )).map(parseMatch);
}

export async function activeMatches(db, userId, opts) {
  await autoSettle(db);
  const out = [];
  for (const m of await activeMatchRows(db, userId)) out.push(await matchDetail(db, userId, m, opts));
  return out;
}

// 약속이 속한 매칭의 상세 (출석·공부 종료 후 화면 갱신용)
export async function matchForAppointment(db, userId, appointmentId, opts) {
  const { m } = await loadAppointment(db, userId, appointmentId);
  return matchDetail(db, userId, await getMatchRow(db, m.id), opts);
}

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

function appointmentStatus(appt, att, demo, active = true) {
  if (att) return att.checked_out_at ? 'done' : 'studying';
  if (T.at(appt.date, appt.end_time) <= T.now()) return 'missed';
  if (!active) return 'cancelled'; // 중간에 끝난 매칭의 남은 약속
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
  const codesOfMatch = () => db.all(
    'SELECT c.* FROM attendance_codes c JOIN appointments p ON p.id = c.appointment_id WHERE p.match_id = ?', m.id,
  );
  let codes = await codesOfMatch();
  // 출석 코드는 매칭할 때 만든다. 예전에 만들어진 매칭에 빠진 코드만 처음 볼 때 채운다 (볼 때마다 DB에 쓰지 않게)
  const hasCode = (apptId, uid) => codes.some((c) => Number(c.appointment_id) === Number(apptId) && Number(c.user_id) === Number(uid));
  const missing = m.status === 'active' ? appts.filter((a) => !hasCode(a.id, userId) || !hasCode(a.id, mateId)) : [];
  if (missing.length) {
    await ensureCodes(db, missing.map((a) => a.id), [userId, mateId]);
    codes = await codesOfMatch();
  }
  const codeOf = (apptId, uid) => codes.find((c) => c.appointment_id === apptId && c.user_id === uid)?.code ?? null;
  const mateUser = await getUser(db, mateId);
  const mateIsBot = !!mateUser.is_bot;

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
      myCode: codeOf(a.id, userId), // 메이트에게 보여 주는 내 출석 코드
      // 데모 메이트는 내 코드를 입력해 줄 수 없으니, 체험용으로 메이트 코드를 보여 준다.
      mateCode: mateIsBot ? codeOf(a.id, mateId) : null,
      me: { status: appointmentStatus(a, mine, demo, m.status === 'active'), checkedInAt: mine?.checked_in_at ?? null,
        method: mine?.method ?? null, minutes: studiedMinutes(mine, a) },
      mate: { status: appointmentStatus(a, mates, demo, m.status === 'active'), minutes: studiedMinutes(mates, a) },
    };
  });

  // 주간 첫날 ~ 마지막 날 (스터디 기간은 3일, 예전 매칭은 7일)
  const week = [];
  for (let i = 0; i < 7 && T.addDays(m.week_start, i) <= m.week_end; i++) {
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
    schedule: m.schedule, // 요일별 약속 시간 [{ day, start, end }]
    startTime: m.start_time,
    endTime: m.end_time,
    styles: m.styles,
    stake: m.stake,
    weekStart: m.week_start,
    weekEnd: m.week_end,
    round: await countRounds(db, m),
    mate: publicUser(mateUser),
    appointments,
    week,
    stats: { me: summarize('me'), mate: summarize('mate') },
    report: m.report && { me: m.report.users[userId], mate: m.report.users[mateId] },
    myChoice: amA ? m.choice_a : m.choice_b,
    mateChoice: amA ? m.choice_b : m.choice_a,
    leavePolicy: m.status === 'active' ? leavePolicy(appts) : null,
    left: m.report?.leftBy ? (m.report.leftBy === userId ? 'me' : 'mate') : null,
    label: m.report?.label ?? null, // '1주차' 대신 쓸 이름 (예: 첫 베타기간)
    headline: m.report?.headline ?? null, // 지난 스터디 맨 위 문구를 따로 정한 경우
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

// 지난 매칭 포함, 내가 참여한 매칭 하나의 상세 (지난 스터디 다시 보기)
export async function matchById(db, userId, matchId, opts) {
  const m = await loadMatchForUser(db, userId, matchId);
  return matchDetail(db, userId, m, opts);
}

export async function currentMatch(db, userId, opts) {
  await autoSettle(db);
  const m = await currentMatchRow(db, userId);
  return m ? matchDetail(db, userId, m, opts) : null;
}

export async function matchHistory(db, userId) {
  const rows = await db.all(
    // 스터디 기간이 최근인 순서 (데모 계정의 첫 베타 기록은 기간이 가장 이르므로 항상 맨 아래)
    `SELECT * FROM matches WHERE (user_a = ? OR user_b = ?) AND status = 'closed' ORDER BY week_start DESC, id DESC LIMIT 20`,
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
      left: m.report?.leftBy ? (m.report.leftBy === userId ? 'me' : 'mate') : null,
    });
  }
  return out;
}

export async function homeState(db, userId, opts) {
  const matches = await activeMatches(db, userId, opts);
  const pendings = await pendingRequests(db, userId);
  const u = await getUser(db, userId);
  return {
    user: privateUser(u),
    matches, // 진행 중인 매칭 모두
    pendingRequests: pendings, // 대기 중인 신청 모두
    match: matches.at(-1) ?? null, // (예전 화면 호환) 가장 최근 매칭
    pendingRequest: pendings[0] ?? null,
    personal: u.personal ? JSON.parse(u.personal) : [], // 내 개인 일정
    mateLeft: matches.length ? null : await recentMateLeft(db, userId),
    community: await communityStats(db),
    exam: examDday(),
    strikes: await strikeStatus(db, userId), // 약속 지키기: 그만두기·미참석 횟수, 매칭 정지
  };
}

// 국민대 전체 통계: 실제 사용자만 (데모 메이트·공용 데모 계정 제외)
async function communityStats(db) {
  const real = `u.is_bot = 0 AND u.email <> '${DEMO_ACCOUNT.email}'`;
  const studying = await db.get(
    `SELECT COUNT(DISTINCT u.id) AS n FROM matches m JOIN users u ON u.id IN (m.user_a, m.user_b)
     WHERE m.status = 'active' AND ${real}`,
  );
  const waiting = await db.get(
    `SELECT COUNT(*) AS n FROM match_requests r JOIN users u ON u.id = r.user_id WHERE r.status = 'pending' AND ${real}`,
  );
  return { studying: Number(studying.n), waiting: Number(waiting.n) };
}

// 사이트 방문 기록. 사이트를 열 때마다 한 줄씩 남긴다 (사람 수는 visitorId로 따로 센다).
export async function recordVisit(db, visitorId) {
  if (typeof visitorId !== 'string' || !/^[a-z0-9]{8,40}$/i.test(visitorId)) throw new AppError(400, '잘못된 요청이에요.');
  await db.run(
    'INSERT INTO visits (visitor_id, day, created_at) VALUES (?, ?, ?)',
    visitorId, T.today(), iso(),
  );
}

// ───────────────────────── 개발자 화면 ─────────────────────────
// 운영자(ADMIN_EMAILS)만 볼 수 있는 운영 현황. 실제 사용자만 센다 (데모 메이트·공용 데모 계정 제외).
// 전화번호는 전체를 보여 주고(운영 결정 2026-11-06), 메일은 앞 3글자만 보인다. 비밀번호·인증번호는 원래부터 암호로만 저장돼 없다.

export async function assertAdmin(db, userId) {
  const u = await getUser(db, userId);
  if (!ADMIN_EMAILS.includes(u?.email)) throw new AppError(403, '개발자만 볼 수 있어요.');
}

const maskEmail = (e) => e.replace(/^(.{3}).*@/, '$1***@');

export async function adminDashboard(db) {
  const real = (col) => `${col} IN (SELECT id FROM users WHERE is_bot = 0 AND email <> '${DEMO_ACCOUNT.email}')`;
  const n = async (sql) => Number((await db.get(sql)).n);
  const users = await db.all(`SELECT * FROM users WHERE is_bot = 0 AND email <> ? ORDER BY id`, DEMO_ACCOUNT.email);
  const nameOf = new Map((await db.all('SELECT id, name, is_bot FROM users')).map((u) => [u.id, u.is_bot ? `${u.name}(데모)` : u.name]));

  // 방문: 사이트를 열 때마다 한 줄. 사람 수는 브라우저 id로 센다.
  const visits = await db.all('SELECT visitor_id, day, created_at FROM visits ORDER BY id');
  const visitorNo = new Map();
  for (const v of visits) if (!visitorNo.has(v.visitor_id)) visitorNo.set(v.visitor_id, visitorNo.size + 1);
  const kstHour = (s) => new Date(new Date(s).getTime() + 9 * 3600000).getUTCHours();
  const byDay = new Map();
  const byHour = Array(24).fill(0);
  const perVisitor = new Map();
  for (const v of visits) {
    const d = byDay.get(v.day) ?? { day: v.day, people: new Set(), visits: 0 };
    d.people.add(v.visitor_id);
    d.visits += 1;
    byDay.set(v.day, d);
    const h = kstHour(v.created_at);
    byHour[h] += 1;
    const key = `${visitorNo.get(v.visitor_id)}|${v.day}`;
    const p = perVisitor.get(key) ?? { visitor: visitorNo.get(v.visitor_id), day: v.day, hours: {} };
    p.hours[h] = (p.hours[h] ?? 0) + 1;
    perVisitor.set(key, p);
  }

  const requests = (await db.all(`SELECT * FROM match_requests WHERE ${real('user_id')} ORDER BY id DESC`)).map(parseRequest);
  const matches = (await db.all(
    `SELECT * FROM matches WHERE ${real('user_a')} OR ${real('user_b')} ORDER BY id DESC`,
  )).map(parseMatch);
  const attendance = await db.all(`SELECT user_id, checked_in_at FROM attendance WHERE ${real('user_id')}`);
  const lastLogin = new Map((await db.all(
    `SELECT user_id, MAX(created_at) AS at FROM (
       SELECT user_id, created_at FROM auth_tokens UNION ALL SELECT user_id, created_at FROM sessions) x GROUP BY user_id`,
  )).map((r) => [r.user_id, r.at]));
  const codes = await db.all('SELECT email, purpose, used, attempts, created_at FROM email_codes ORDER BY id DESC');
  const joined = new Set(users.map((u) => u.email));
  const notJoined = new Set(codes.filter((c) => c.purpose === 'signup' && !joined.has(c.email)).map((c) => c.email));
  // 첫 화면에는 처리 안 한 신고의 대화만 싣는다 (처리방침 5번). 처리를 마친 신고의 대화는 다시 보이지 않는다.
  // 다른 매칭의 대화는 운영자가 '대화 보기'를 누를 때만 따로 연다 (server/admin.js matchChat, 열람 기록).
  const messageCount = new Map((await db.all('SELECT match_id, COUNT(*) AS n FROM messages GROUP BY match_id'))
    .map((r) => [r.match_id, Number(r.n)]));
  const messages = await db.all(
    `SELECT match_id, user_id, body, created_at FROM messages
     WHERE match_id IN (SELECT match_id FROM reports WHERE status = 'open') ORDER BY id`,
  );
  const realIds = new Set(users.map((u) => u.id));

  // 전환 단계: 단계마다 사람 수. today면 오늘(한국 날짜) 일어난 일만 센다.
  const isToday = (s) => T.dateStr(new Date(s)) === T.today();
  const funnel = (today) => {
    const keep = (s) => !today || isToday(s);
    return [
      { label: '방문', count: new Set(visits.filter((v) => !today || v.day === T.today()).map((v) => v.visitor_id)).size },
      { label: '가입', count: users.filter((u) => keep(u.created_at)).length },
      { label: '매칭 신청', count: new Set(requests.filter((r) => keep(r.created_at)).map((r) => r.user_id)).size },
      { label: '매칭 성사', count: new Set(matches.filter((m) => keep(m.created_at)).flatMap((m) => [m.user_a, m.user_b]).filter((id) => realIds.has(id))).size },
      { label: '출석', count: new Set(attendance.filter((x) => keep(x.checked_in_at)).map((x) => x.user_id)).size },
    ];
  };

  return {
    summary: {
      todayVisitors: new Set(visits.filter((v) => v.day === T.today()).map((v) => v.visitor_id)).size,
      users: users.length,
      pendingRequests: requests.filter((r) => r.status === 'pending').length,
      activeMatches: matches.filter((m) => m.status !== 'closed').length,
    },
    visits: {
      people: visitorNo.size,
      total: visits.length,
      byDay: [...byDay.values()].map((d) => ({ day: d.day, people: d.people.size, visits: d.visits })),
      byHour,
      perVisitor: [...perVisitor.values()],
    },
    funnel: { all: funnel(false), today: funnel(true) },
    requests: requests.map((r) => ({
      id: r.id, name: nameOf.get(r.user_id), status: r.status, schedule: r.schedule,
      location: r.location, styles: r.styles, createdAt: r.created_at,
    })),
    matches: matches.map((m) => ({
      id: m.id, names: [nameOf.get(m.user_a), nameOf.get(m.user_b)], status: m.status,
      weekStart: m.week_start, weekEnd: m.week_end, schedule: m.schedule, location: m.location, styles: m.styles,
      leftBy: m.report?.leftBy ? nameOf.get(m.report.leftBy) : null, createdAt: m.created_at,
      messageCount: messageCount.get(m.id) ?? 0, // 수만 (내용은 '대화 보기'로)
    })),
    users: users.map((u) => ({
      id: u.id, name: u.name, department: u.department ?? null, phone: decryptField(u.phone),
      createdAt: u.created_at, lastLogin: lastLogin.get(u.id) ?? null,
    })),
    emailCodes: {
      notJoined: notJoined.size,
      list: codes.map((c) => ({ ...c, email: maskEmail(c.email), joined: joined.has(c.email) })),
    },
    chats: matches.map((m) => ({
      matchId: m.id, names: [nameOf.get(m.user_a), nameOf.get(m.user_b)],
      messages: messages.filter((x) => x.match_id === m.id).map((x) => ({ name: nameOf.get(x.user_id), body: x.body, createdAt: x.created_at })),
    })).filter((c) => c.messages.length),
  };
}

// 시험 디데이 (한국 날짜 기준). 시험일이 지나면 null.
function examDday() {
  const days = Math.round((Date.parse(EXAM.date) - Date.parse(T.today())) / 86400000);
  return days < 0 ? null : { name: EXAM.name, date: EXAM.date, dday: days };
}

// 메이트가 최근(3일 안)에 매칭을 그만뒀으면 홈에서 알려 준다.
async function recentMateLeft(db, userId) {
  const row = await db.get(
    `SELECT * FROM matches WHERE (user_a = ? OR user_b = ?) AND status = 'closed' ORDER BY id DESC LIMIT 1`,
    userId, userId,
  );
  const m = parseMatch(row);
  if (!m?.report?.leftBy || m.report.leftBy === userId) return null;
  if (T.now() - new Date(m.report.generatedAt) > 3 * 24 * 60 * 60 * 1000) return null;
  const mine = m.report.users[userId];
  return {
    mateName: (await getUser(db, mateOf(m, userId))).name,
    refunded: mine.deposit.result === 'refunded' ? mine.deposit.amount : 0,
    reward: mine.reward ?? 0,
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

export async function myAttendanceCode(db, userId, appointmentId) {
  const { appt, m } = await loadAppointment(db, userId, appointmentId);
  await ensureCodes(db, [appt.id], [m.user_a, m.user_b]);
  const row = await db.get('SELECT code FROM attendance_codes WHERE appointment_id = ? AND user_id = ?', appt.id, userId);
  return { appt, code: row.code };
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

// 상대방 출석 확인하기: 메이트의 출석 코드(메이트 화면에 보이는 코드/QR)를 입력하면 메이트의 출석이 확인된다.
export async function confirmMate(db, userId, appointmentId, code, { demo = false } = {}) {
  return db.tx(async (t) => {
    const { appt, m } = await loadAppointment(t, userId, appointmentId);
    if (m.status !== 'active') throw new AppError(400, '이미 마감된 주간이에요.');
    if (!demo && !isCheckinWindow(appt)) {
      throw new AppError(400, `출석 확인은 약속 시작 ${CHECKIN_EARLY_MIN}분 전부터 종료 시각까지 할 수 있어요.`);
    }
    const mateId = mateOf(m, userId);
    await ensureCodes(t, [appt.id], [userId, mateId]);
    const expected = await t.get('SELECT code FROM attendance_codes WHERE appointment_id = ? AND user_id = ?', appt.id, mateId);
    const given = String(code ?? '').trim().toUpperCase();
    if (!given) throw new AppError(400, '메이트의 출석 코드를 입력해 주세요.');
    if (given !== expected.code) {
      const mine = await t.get('SELECT code FROM attendance_codes WHERE appointment_id = ? AND user_id = ?', appt.id, userId);
      throw new AppError(400, given === mine.code ? '내 코드가 아니라 메이트의 출석 코드를 입력해 주세요.' : '출석 코드가 맞지 않아요.');
    }
    const { changes } = await insertAttendance(t, appt.id, mateId, 'mate');
    if (!changes) throw new AppError(409, '메이트의 출석은 이미 확인됐어요.');
    // 데모 메이트는 확인해 주면 내 출석도 확인해 준다.
    if ((await getUser(t, mateId)).is_bot) await insertAttendance(t, appt.id, userId, 'mate');
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

// 한 사람의 출석률·공부시간. '공부 종료'를 안 누른 기록은 여기서 마감한다.
async function attendanceStats(db, appts, uid) {
  let attended = 0;
  let minutes = 0;
  for (const a of appts) {
    const att = await attendanceOf(db, a.id, uid);
    if (!att) continue;
    attended++;
    const mins = studiedMinutes(att, a);
    minutes += mins;
    if (!att.checked_out_at) {
      await db.run('UPDATE attendance SET checked_out_at = ?, minutes = ? WHERE id = ?', iso(), mins, att.id);
    }
  }
  const total = appts.length;
  return { total, attended, minutes, rate: total ? Math.round((attended / total) * 100) : 100, kept: attended >= total };
}

export async function settleMatch(db, matchId) {
  const { row, claimed } = await settleMatchTx(db, matchId);
  if (claimed) await recordNoShows(db, matchId); // 이번에 정산한 경우에만: 약속 날 안 나온 사람 기록
  return row;
}

async function settleMatchTx(db, matchId) {
  return db.tx(async (t) => {
    // 먼저 상태를 바꿔 자리를 차지한다. 다른 요청이 이미 정산했다면 아무것도 하지 않는다.
    const claimed = await t.run("UPDATE matches SET status = 'reported' WHERE id = ? AND status = 'active'", matchId);
    if (!claimed.changes) return { row: await getMatchRow(t, matchId), claimed: false };
    const m = await getMatchRow(t, matchId);
    const appts = await t.all('SELECT * FROM appointments WHERE match_id = ?', m.id);

    const users = {
      [m.user_a]: await attendanceStats(t, appts, m.user_a),
      [m.user_b]: await attendanceStats(t, appts, m.user_b),
    };

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
    return { row: await getMatchRow(t, m.id), claimed: true };
  });
}

// 매칭 그만두기 규칙 (첫 약속 전이어도 같음)
// ※ 보증금은 2026-11-05에 없앴다 (stake 는 항상 0). 대신 '약속 지키기' 기록이 남는다 → leaveMatch, addStrike
//   penalty : 그만둔 사람의 보증금은 메이트에게 보상, 메이트는 자기 보증금 반환
//             (메이트가 데모 메이트면 그만둔 사람의 보증금은 그냥 소멸)
//   settle  : 남은 약속이 없음 → 그만두는 대신 지금까지의 출석으로 주간 정산
function leavePolicy(appts) {
  const nowT = T.now();
  return appts.some((a) => T.at(a.date, a.end_time) > nowT) ? 'penalty' : 'settle';
}

export async function leaveMatch(db, userId, matchId) {
  const m = await loadMatchForUser(db, userId, matchId);
  if (m.status !== 'active') throw new AppError(400, '진행 중인 매칭만 그만둘 수 있어요.');
  const appts = await db.all('SELECT * FROM appointments WHERE match_id = ? ORDER BY date', m.id);
  const policy = leavePolicy(appts);
  if (policy === 'settle') {
    await settleMatch(db, m.id);
    return { result: 'settled', strikes: await strikeStatus(db, userId) };
  }

  const leftAt = T.now();
  const res = await leaveMatchTx(db, userId, m, appts, policy);
  await recordNoShows(db, m.id, leftAt); // 그만두기 전에 이미 지난 약속만
  if (T.today() >= PROMISE_RULE.from) await addStrike(db, userId, 'left', m.id);
  return { ...res, strikes: await strikeStatus(db, userId) };
}

async function leaveMatchTx(db, userId, m, appts, policy) {
  return db.tx(async (t) => {
    // 동시에 정산·그만두기가 겹쳐도 한 번만 처리되도록 상태를 먼저 바꾼다.
    const claimed = await t.run("UPDATE matches SET status = 'closed' WHERE id = ? AND status = 'active'", m.id);
    if (!claimed.changes) throw new AppError(409, '이미 끝난 매칭이에요.');
    const mateId = mateOf(m, userId);
    const users = {
      [userId]: await attendanceStats(t, appts, userId),
      [mateId]: await attendanceStats(t, appts, mateId),
    };
    const mateIsBot = !!(await getUser(t, mateId)).is_bot;
    const none = { result: 'none', amount: 0 };
    if (!m.stake) {
      users[userId].deposit = none;
      users[mateId].deposit = none;
    } else {
      await adjustPoints(t, mateId, m.stake * 2, '메이트 중도 종료 · 보증금 반환 + 보상', m.id); // 데모 메이트면 변화 없음
      // 그만둔 사람: 보증금은 이미 예치 때 빠졌으므로 잔액 변화 없이 내역만 남긴다
      const { points } = await getUser(t, userId);
      await t.run(
        'INSERT INTO point_logs (user_id, amount, balance, reason, match_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        userId, 0, points, mateIsBot ? `중도 종료 · 보증금 ${m.stake.toLocaleString()}P 소멸` : `중도 종료 · 보증금 ${m.stake.toLocaleString()}P 메이트에게 보상`, m.id, iso(),
      );
      users[userId].deposit = { result: mateIsBot ? 'forfeited' : 'to_mate', amount: m.stake };
      users[mateId].deposit = { result: 'refunded', amount: m.stake };
    }
    users[userId].reward = 0;
    users[mateId].reward = m.stake && !mateIsBot ? m.stake : 0;

    const col = m.user_a === userId ? 'choice_a' : 'choice_b';
    const report = { generatedAt: iso(), leftBy: userId, leavePolicy: policy, users };
    await t.run(`UPDATE matches SET report = ?, ${col} = 'left' WHERE id = ?`, JSON.stringify(report), m.id);
    for (const uid of [m.user_a, m.user_b]) await requeueBot(t, uid);
    return { result: 'left', stake: m.stake, lostTo: m.stake ? (mateIsBot ? 'none' : 'mate') : null };
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
  if (choice === 'continue') await assertNotSuspended(db, userId);
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
    terms: { schedule: m.schedule, startTime: m.start_time, endTime: m.end_time, location: m.location, styles: m.styles },
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
  if (await pendingRequest(db, userId)) return;
  const t = JSON.parse(u.bot_template);
  // cells가 있으면 시간표 칸 그대로 (날짜마다 시간이 다른 스터디 기간), 없으면 요일 × 시간 범위
  await db.run(
    `INSERT INTO match_requests (user_id, days, start_time, end_time, location, styles, deposit, cells, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, JSON.stringify(t.days), t.startTime, t.endTime, t.location, JSON.stringify(t.styles), t.deposit,
    t.cells ? JSON.stringify(t.cells) : null, iso(),
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

// ── 채팅 읽음 ──
// 매칭마다 사람별로 어디까지 읽었는지(chat_reads.last_read_id) 기록한다.
// 안 읽은 메시지 = 메이트가 보낸 메시지 중 내가 읽은 위치보다 뒤의 것.

const lastMessageId = async (db, matchId) => Number((await db.get('SELECT MAX(id) AS n FROM messages WHERE match_id = ?', matchId))?.n) || 0;
const lastReadOf = async (db, matchId, userId) => Number((await db.get(
  'SELECT last_read_id AS n FROM chat_reads WHERE match_id = ? AND user_id = ?', matchId, userId,
))?.n) || 0;

// 채팅 화면에서 본 메시지까지 읽음으로 기록 (lastId가 없으면 지금까지 전부). 뒤로 되돌리지는 않는다.
export async function markChatRead(db, userId, matchId, lastId) {
  const m = await loadMatchForUser(db, userId, matchId);
  const max = await lastMessageId(db, m.id);
  const upto = Math.min(Number(lastId) > 0 ? Number(lastId) : max, max);
  if (upto > 0) {
    const { rows } = await db.run(
      `INSERT INTO chat_reads (match_id, user_id, last_read_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (match_id, user_id) DO UPDATE SET
         last_read_id = CASE WHEN excluded.last_read_id > chat_reads.last_read_id THEN excluded.last_read_id ELSE chat_reads.last_read_id END,
         updated_at = excluded.updated_at
       RETURNING last_read_id AS n`,
      m.id, userId, upto, iso(),
    );
    if (rows?.length) return { lastReadId: Number(rows[0].n) || 0 };
  }
  return { lastReadId: await lastReadOf(db, m.id, userId) };
}

// 진행 중인 매칭(리포트 대기 포함)별 안 읽은 메시지 수 → 채팅 탭의 빨간 숫자
export async function unreadCounts(db, userId) {
  const rows = await db.all(
    `SELECT m.id AS "matchId", COUNT(msg.id) AS n
       FROM matches m
       JOIN messages msg ON msg.match_id = m.id AND msg.user_id <> ?
       LEFT JOIN chat_reads r ON r.match_id = m.id AND r.user_id = ?
      WHERE (m.user_a = ? OR m.user_b = ?) AND m.status IN ('active', 'reported')
        AND msg.id > COALESCE(r.last_read_id, 0)
      GROUP BY m.id`,
    userId, userId, userId, userId,
  );
  const byMatch = Object.fromEntries(rows.map((r) => [Number(r.matchId), Number(r.n)]));
  return { total: Object.values(byMatch).reduce((a, b) => a + b, 0), byMatch };
}

// 메이트가 어디까지 읽었는지 (내가 보낸 메시지 옆 '1' 표시). 데모 메이트는 바로 읽은 것으로 친다.
export async function mateLastRead(db, userId, matchId) {
  const m = await loadMatchForUser(db, userId, matchId);
  const mate = await getUser(db, mateOf(m, userId));
  return mate?.is_bot ? lastMessageId(db, m.id) : lastReadOf(db, m.id, mate.id);
}

// 채팅 화면이 몇 초마다 묻는 것: 새 메시지 + 메이트가 어디까지 읽었는지.
// listMessages + mateLastRead 와 같은 결과를 매칭 확인 한 번, DB 왕복 3번으로 (가장 자주 불리는 요청이라 줄임)
export async function chatUpdate(db, userId, matchId, afterId = 0) {
  const m = await loadMatchForUser(db, userId, matchId);
  const messages = await db.all(
    'SELECT id, user_id AS "userId", body, created_at AS "createdAt" FROM messages WHERE match_id = ? AND id > ? ORDER BY id',
    m.id, Number(afterId) || 0,
  );
  const mate = await db.get(
    `SELECT u.is_bot AS "isBot", r.last_read_id AS "lastReadId" FROM users u
       LEFT JOIN chat_reads r ON r.match_id = ? AND r.user_id = u.id WHERE u.id = ?`,
    m.id, mateOf(m, userId),
  );
  const mateLastReadId = mate?.isBot ? await lastMessageId(db, m.id) : Number(mate?.lastReadId) || 0;
  return { messages, mateLastReadId };
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
