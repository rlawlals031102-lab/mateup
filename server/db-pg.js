// PostgreSQL 드라이버 — 실서비스(Neon)는 pg, 테스트는 PGlite(메모리 속 PostgreSQL)를 쓴다.
// 인터페이스는 server/db.js 설명 참고. '?' 자리표시자를 $1, $2 ...로 바꿔 실행한다.

import { migrate } from './migrate.js';

const toDollar = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

function wrap(query, exec) {
  return {
    dialect: 'pg',
    async get(sql, ...p) { return (await query(toDollar(sql), p)).rows[0] ?? null; },
    async all(sql, ...p) { return (await query(toDollar(sql), p)).rows; },
    async run(sql, ...p) {
      const r = await query(toDollar(sql), p);
      return { changes: r.rowCount ?? r.affectedRows ?? 0, rows: r.rows ?? [] };
    },
    exec,
  };
}

// options.migrate=false: 표·열을 만들지 않고 연결만 (백업·운영 스크립트가 실서비스 DB 구조를 바꾸지 않게)
export async function openPg(connectionString, { migrate: runMigrations = true } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL이 설정되지 않았습니다.');
  const { default: pg } = await import('pg');
  // Supabase 등 원격 DB는 SSL 필수. 주소에 붙은 sslmode는 빼고 여기서 지정한다.
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  url.searchParams.delete('sslmode');
  // 인증서 검증: DATABASE_CA_CERT(Supabase 대시보드에서 받은 인증서 PEM)가 있으면 서버 인증서를 확인한다.
  // 없으면 암호화는 하되 상대가 진짜 Supabase인지는 확인하지 않는다 (예전과 같음) → 경고를 남긴다.
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  if (!local && !ca) console.warn(JSON.stringify({ level: 'warn', msg: 'DB 인증서 검증 꺼짐: DATABASE_CA_CERT를 설정하세요' }));
  // 서버리스 환경에서는 인스턴스마다 연결을 조금만 연다.
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: local ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
  });
  // 쉬고 있던 연결이 끊기면(DB 재시작, Supabase 연결 정리 등) 풀이 'error'를 낸다.
  // 받아 주지 않으면 서버가 통째로 죽으므로, 기록만 하고 넘어간다 (끊긴 연결은 풀에서 빠지고 다음 요청 때 새로 연결됨).
  pool.on('error', (err) => console.warn(JSON.stringify({ level: 'warn', msg: 'DB 연결이 끊겨 다시 연결해요', err: err.message })));
  const db = wrap((sql, p) => pool.query(sql, p), (sql) => pool.query(sql));
  db.tx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const t = wrap((sql, p) => client.query(sql, p), (sql) => client.query(sql));
      t.tx = (f) => f(t);
      // 같은 이름의 잠금을 건 트랜잭션은 한 번에 하나씩 (끝나면 자동으로 풀림). 예: 매칭
      t.lock = (name) => client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [name]);
      const result = await fn(t);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };
  db.close = () => pool.end();
  if (runMigrations) await migrate(db); // 구조가 바뀐 경우에만 표·열을 만든다 (server/migrate.js)
  return db;
}

export async function openPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite();
  const db = wrap((sql, p) => pglite.query(sql, p), (sql) => pglite.exec(sql));
  db.tx = (fn) => pglite.transaction(async (tr) => {
    const t = wrap((sql, p) => tr.query(sql, p), (sql) => tr.exec(sql));
    t.tx = (f) => f(t);
    t.lock = (name) => tr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [name]);
    return fn(t);
  });
  db.close = () => pglite.close();
  await migrate(db);
  return db;
}
