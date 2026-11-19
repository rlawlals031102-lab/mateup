// DB 공통 인터페이스 — SQLite(로컬·데모)와 PostgreSQL(Neon, 실서비스)에서 같은 코드가 돌도록
// 서비스 코드는 아래 메서드만 쓴다. SQL은 두 DB에서 모두 통하는 문법으로 작성하고 자리표시자는 '?'를 쓴다.
//
//   await db.get(sql, ...params)   → 첫 행 또는 null
//   await db.all(sql, ...params)   → 행 배열
//   await db.run(sql, ...params)   → { changes, rows }  (RETURNING 결과는 rows)
//   await db.exec(sql)             → 여러 문장 실행 (파라미터 없음)
//   await db.tx(async (t) => ...)  → 트랜잭션. 안에서는 t를 db처럼 쓰고, t.tx()는 같은 트랜잭션에 합류

import { mkdirSync } from 'node:fs';
import path from 'node:path';

// 나중에 추가된 열. 이미 있는 DB에도 붙인다.
const ADDED_COLUMNS = [
  ['match_requests', 'cells', 'TEXT'], // 시간표에서 고른 칸
  ['matches', 'schedule', 'TEXT'], // 요일별 약속 시간
  ['users', 'personal', 'TEXT'], // 내 개인 일정 [{ cell, title }]
  ['users', 'department', 'TEXT'], // 학과 (가입 때 수집, 본인·운영자만 봄)
  ['users', 'phone', 'TEXT'], // 전화번호 (가입 때 수집, 본인·운영자만 봄)
  ['users', 'suspended_until', 'TEXT'], // 매칭 정지가 끝나는 시각 (약속 지키기 규칙)
  ['users', 'strikes_since', 'TEXT'], // 이 시각 뒤의 그만두기·미참석만 센다 (정지가 끝나면 0번부터)
  ['users', 'agreed_at', 'TEXT'], // 개인정보 처리방침 동의 시각
  ['users', 'privacy_version', 'TEXT'], // 동의한 처리방침 버전 (server/options.js PRIVACY_POLICY)
  ['users', 'deleted_at', 'TEXT'], // 탈퇴 시각 (계정 정보는 지우고 '탈퇴한 사용자'로 남김)
  ['users', 'notify_opt_out', 'INTEGER NOT NULL DEFAULT 0'], // 이메일 알림 끄기 (0=받음, 1=안 받음)
];

export function migrations(dialect) {
  return [
    ...ADDED_COLUMNS.map(([table, col, type]) => (dialect === 'pg'
      ? `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`
      : `ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)),
    // 겹치지 않는 시간대라면 여러 개 신청할 수 있게 '한 사람 한 신청' 제한을 없앤다
    'DROP INDEX IF EXISTS idx_requests_one_pending',
  ];
}

export function schema(dialect) {
  const ID = dialect === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY';
  return `
CREATE TABLE IF NOT EXISTS users (
  id            ${ID},
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  age           INTEGER,
  tags          TEXT NOT NULL DEFAULT '[]',
  bio           TEXT NOT NULL DEFAULT '',
  avatar        TEXT NOT NULL DEFAULT '🙂',
  points        INTEGER NOT NULL DEFAULT 0,
  is_bot        INTEGER NOT NULL DEFAULT 0,
  bot_template  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_requests (
  id         ${ID},
  user_id    INTEGER NOT NULL REFERENCES users(id),
  days       TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  location   TEXT NOT NULL,
  styles     TEXT NOT NULL,
  deposit    INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | matched | cancelled
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id            ${ID},
  user_a        INTEGER NOT NULL REFERENCES users(id),
  user_b        INTEGER NOT NULL REFERENCES users(id),
  days          TEXT NOT NULL,
  start_time    TEXT NOT NULL,
  end_time      TEXT NOT NULL,
  location      TEXT NOT NULL,
  styles        TEXT NOT NULL,
  stake         INTEGER NOT NULL DEFAULT 0,
  week_start    TEXT NOT NULL,
  week_end      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active', -- active | reported | closed
  choice_a      TEXT,
  choice_b      TEXT,
  report        TEXT,
  prev_match_id INTEGER REFERENCES matches(id),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id         ${ID},
  match_id   INTEGER NOT NULL REFERENCES matches(id),
  date       TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  code       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id             ${ID},
  appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  method         TEXT NOT NULL, -- qr | self
  checked_in_at  TEXT NOT NULL,
  checked_out_at TEXT,
  minutes        INTEGER,
  UNIQUE (appointment_id, user_id)
);

-- 약속마다 사람별 출석 코드. 메이트가 내 코드를 입력하면 내 출석이 확인된다.
CREATE TABLE IF NOT EXISTS attendance_codes (
  appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  code           TEXT NOT NULL,
  PRIMARY KEY (appointment_id, user_id)
);

-- 보낸 약속 리마인드 (같은 약속·사람·종류는 한 번만 보낸다). server/notify.js sendDueReminders
CREATE TABLE IF NOT EXISTS sent_reminders (
  appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL, -- soon | day_before
  created_at     TEXT NOT NULL,
  PRIMARY KEY (appointment_id, user_id, kind)
);

CREATE TABLE IF NOT EXISTS messages (
  id         ${ID},
  match_id   INTEGER NOT NULL REFERENCES matches(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 약속 지키기 기록: 매칭 그만두기(left)·약속 날 미참석(missed). 같은 일은 한 번만 센다.
-- 정해진 횟수가 쌓이면 users.suspended_until 까지 매칭 신청 정지 (server/options.js PROMISE_RULE)
CREATE TABLE IF NOT EXISTS strikes (
  id             ${ID},
  user_id        INTEGER NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL,
  match_id       INTEGER NOT NULL REFERENCES matches(id),
  appointment_id INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  UNIQUE (user_id, kind, match_id, appointment_id)
);

-- 로그인 세션: 토큰 원문 대신 SHA-256 해시만 저장. 30일 동안 안 쓰면 만료 (server/sessions.js)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

-- 요청 횟수 제한 (로그인 실패·인증메일·메시지 등). IP는 해시로만. 2일 뒤 지움 (server/security.js)
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT NOT NULL,
  window_start TEXT NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- 채팅 신고 (server/reports.js). 운영진은 신고된 대화만 확인한다
CREATE TABLE IF NOT EXISTS reports (
  id          ${ID},
  match_id    INTEGER NOT NULL REFERENCES matches(id),
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL,
  detail      TEXT,
  status      TEXT NOT NULL DEFAULT 'open', -- open | closed
  created_at  TEXT NOT NULL,
  UNIQUE (match_id, reporter_id)
);

-- 운영자 행동 기록 (개발자 화면 열람, 신고 대화 열람, 정지 해제). 1년 보관 (server/admin.js)
CREATE TABLE IF NOT EXISTS admin_logs (
  id         ${ID},
  admin_id   INTEGER NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL,
  target     TEXT,
  created_at TEXT NOT NULL
);

-- 매칭 정지 중에 탈퇴한 메일의 해시 → 정지가 끝날 때까지 다시 가입해도 정지 유지 (server/privacy.js)
CREATE TABLE IF NOT EXISTS blocked_emails (
  email_hash    TEXT PRIMARY KEY,
  blocked_until TEXT NOT NULL
);

-- 정기 작업 기록 (매일 정산 등) → /api/health 에서 제때 돌았는지 확인 (server/ops.js)
CREATE TABLE IF NOT EXISTS ops_heartbeats (
  name     TEXT PRIMARY KEY,
  last_run TEXT NOT NULL,
  ok       INTEGER NOT NULL,
  detail   TEXT
);

-- 채팅 읽음: 매칭마다 사람별로 어디까지 읽었는지 (안 읽은 메시지 수, 보낸 메시지 옆 '1' 표시)
CREATE TABLE IF NOT EXISTS chat_reads (
  match_id     INTEGER NOT NULL REFERENCES matches(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  last_read_id INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS point_logs (
  id         ${ID},
  user_id    INTEGER NOT NULL REFERENCES users(id),
  amount     INTEGER NOT NULL,
  balance    INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  match_id   INTEGER REFERENCES matches(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_codes (
  id         ${ID},
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL, -- signup | reset
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 사이트 방문 (사이트를 열 때마다 한 줄. visitor_id는 브라우저마다 만든 무작위 id, day는 한국 날짜)
CREATE TABLE IF NOT EXISTS visits (
  id         ${ID},
  visitor_id TEXT NOT NULL,
  day        TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON match_requests(status);
CREATE INDEX IF NOT EXISTS idx_matches_users ON matches(user_a, user_b);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_appointments_match ON appointments(match_id);
CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_email_codes ON email_codes(email, purpose);
CREATE INDEX IF NOT EXISTS idx_visits_day ON visits(day);
CREATE INDEX IF NOT EXISTS idx_strikes_user ON strikes(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_match ON reports(match_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_at ON admin_logs(created_at);
${dialect === 'pg' ? RLS : ''}`;
}

// PostgreSQL(Supabase)에서는 모든 테이블에 RLS를 켜 둔다. 정책이 없으므로 Supabase 공개 API(anon 키)로는
// 아무 데이터도 읽거나 쓸 수 없고, 테이블 소유자로 직접 접속하는 우리 서버만 접근한다.
const RLS = ['users', 'auth_tokens', 'match_requests', 'matches', 'appointments', 'attendance', 'messages', 'point_logs', 'email_codes', 'attendance_codes', 'visits', 'chat_reads', 'strikes', 'sent_reminders',
  'sessions', 'rate_limits', 'reports', 'admin_logs', 'blocked_emails', 'ops_heartbeats', 'schema_migrations']
  .map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`)
  .join('\n');

// UNIQUE 제약 위반 여부 (SQLite / PostgreSQL 공통)
export const isUniqueViolation = (err) => err?.code === '23505' || /UNIQUE constraint failed/i.test(err?.message ?? '');

// 동기 SQLite 드라이버(node:sqlite 또는 브라우저용 sql.js 래퍼)를 공통 인터페이스로 감싼다.
// 연결이 하나뿐이라 트랜잭션은 잠금으로 한 번에 하나씩 실행한다.
export function wrapSqlite(raw) {
  const base = {
    dialect: 'sqlite',
    async get(sql, ...p) { return raw.prepare(sql).get(...p) ?? null; },
    async all(sql, ...p) { return raw.prepare(sql).all(...p); },
    async run(sql, ...p) {
      if (/\breturning\b/i.test(sql)) {
        const rows = raw.prepare(sql).all(...p);
        return { changes: rows.length, rows };
      }
      const r = raw.prepare(sql).run(...p);
      return { changes: Number(r.changes), rows: [] };
    },
    async exec(sql) { raw.exec(sql); },
  };

  let lock = Promise.resolve();
  const db = {
    ...base,
    raw,
    tx(fn) {
      const run = lock.then(async () => {
        const t = { ...base, tx: (f) => f(t), lock: async () => {} }; // 한 번에 하나씩이라 따로 잠글 필요 없음
        raw.exec('BEGIN');
        try {
          const result = await fn(t);
          raw.exec('COMMIT');
          return result;
        } catch (err) {
          raw.exec('ROLLBACK');
          throw err;
        }
      });
      lock = run.catch(() => {});
      return run;
    },
  };
  return db;
}

export async function openSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');
  const db = wrapSqlite(raw);
  const { migrate } = await import('./migrate.js'); // 구조가 바뀐 경우에만 표·열을 만든다 (server/migrate.js)
  await migrate(db);
  return db;
}
