// DB 구조 버전 관리 — 서버가 켜질 때마다 표 만드는 SQL을 전부 돌리지 않게 한다.
//
//  1) 기본 구조: server/db.js 의 schema() + ADDED_COLUMNS. 지금처럼 거기에 표·열을 추가하면 된다.
//     내용이 바뀌면 '지문'(SHA-256)이 달라져서 다음 시작 때 한 번만 다시 실행된다. (모두 IF NOT EXISTS 라 몇 번 돌아도 안전)
//  2) 한 번만 실행해야 하는 변경: 아래 STEPS 끝에 번호를 붙여 추가한다. 이미 쓴 번호는 고치거나 지우지 않는다.
//
//  적용 기록은 schema_migrations 표에 남는다. PostgreSQL에서는 여러 서버(Vercel 함수)가 동시에 켜져도
//  한 곳만 적용하도록 트랜잭션 잠금(pg_advisory_xact_lock)을 건다. 되돌리기는 하지 않고, 앞으로 고치는 변경을 새로 추가한다.
import crypto from 'node:crypto';
import { schema, migrations } from './db.js';

const LOCK_ID = 727274; // 마이그레이션 잠금 번호 (아무 숫자, 바꾸지 않기)

const checkConstraint = (table, name, expr) => `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
    ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr}) NOT VALID;
  END IF;
END $$;`;

export const STEPS = [
  {
    id: 'm001',
    name: '상태 값 제약: 정해진 상태 말고는 DB가 거부 (PostgreSQL)',
    pg: [
      checkConstraint('match_requests', 'match_requests_status_valid', "status IN ('pending', 'matched', 'cancelled')"),
      checkConstraint('matches', 'matches_status_valid', "status IN ('active', 'reported', 'closed')"),
      checkConstraint('reports', 'reports_status_valid', "status IN ('open', 'closed')"),
    ],
  },
];

export const fingerprint = (dialect) => crypto.createHash('sha256')
  .update(`${schema(dialect)}\n${migrations(dialect).join(';\n')}`).digest('hex').slice(0, 16);

const META = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`;

async function appliedIds(db) {
  try {
    return new Set((await db.all('SELECT id FROM schema_migrations')).map((r) => r.id));
  } catch {
    return null; // 표가 아직 없음
  }
}

// 적용한 항목 이름 목록을 돌려준다 (이미 최신이면 빈 배열 — DB에 한 번만 물어본다)
export async function migrate(db) {
  const dialect = db.dialect;
  const base = `base-${fingerprint(dialect)}`;
  const wanted = [base, ...STEPS.map((s) => s.id)];
  const have = await appliedIds(db);
  if (have && wanted.every((id) => have.has(id))) return [];

  return db.tx(async (t) => {
    if (dialect === 'pg') await t.exec(`SELECT pg_advisory_xact_lock(${LOCK_ID})`);
    await t.exec(META);
    const done = (await appliedIds(t)) ?? new Set();
    const applied = [];
    if (!done.has(base)) {
      await t.exec(schema(dialect));
      for (const sql of migrations(dialect)) {
        try {
          await t.exec(sql);
        } catch (err) {
          // SQLite는 ADD COLUMN IF NOT EXISTS 가 없어서, 이미 있는 열이면 넘어간다
          if (!/duplicate column/i.test(err.message)) throw err;
        }
      }
      applied.push(base);
    }
    for (const step of STEPS) {
      if (done.has(step.id)) continue;
      for (const sql of step[dialect] ?? []) await t.exec(sql);
      applied.push(step.id);
    }
    const at = new Date().toISOString();
    for (const id of applied) {
      await t.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING', id, at);
    }
    return applied;
  });
}
