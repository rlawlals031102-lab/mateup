// PostgreSQL 드라이버 — 실서비스(Neon)는 pg, 테스트는 PGlite(메모리 속 PostgreSQL)를 쓴다.
// 인터페이스는 server/db.js 설명 참고. '?' 자리표시자를 $1, $2 ...로 바꿔 실행한다.

import { schema } from './db.js';

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

export async function openPg(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL이 설정되지 않았습니다.');
  const { default: pg } = await import('pg');
  // Supabase 등 원격 DB는 SSL 필수. 주소에 붙은 sslmode는 빼고 여기서 지정한다.
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  url.searchParams.delete('sslmode');
  // 서버리스 환경에서는 인스턴스마다 연결을 조금만 연다.
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
  });
  const db = wrap((sql, p) => pool.query(sql, p), (sql) => pool.query(sql));
  db.tx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const t = wrap((sql, p) => client.query(sql, p), (sql) => client.query(sql));
      t.tx = (f) => f(t);
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
  await db.exec(schema('pg'));
  return db;
}

export async function openPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite();
  const db = wrap((sql, p) => pglite.query(sql, p), (sql) => pglite.exec(sql));
  db.tx = (fn) => pglite.transaction(async (tr) => {
    const t = wrap((sql, p) => tr.query(sql, p), (sql) => tr.exec(sql));
    t.tx = (f) => f(t);
    return fn(t);
  });
  db.close = () => pglite.close();
  await db.exec(schema('pg'));
  return db;
}
