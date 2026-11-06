// 실제 PostgreSQL에서만 드러나는 동시성 문제 테스트 (PGlite는 한 번에 하나씩만 실행해서 재현되지 않음).
// TEST_DATABASE_URL(관리자 접속 주소, 예: postgres://postgres:postgres@localhost:5432/postgres)이 있을 때만 돈다.
// CI(.github/workflows/ci.yml)의 postgres 작업에서 실행된다. 테스트마다 새 DB를 만들고 끝나면 지운다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openPg } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';
import { STEPS } from '../server/migrate.js';
import { countHit } from '../server/security.js';
import { sessionUser, hashToken } from '../server/sessions.js';
import { STUDY_PERIOD } from '../server/options.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const skip = ADMIN_URL ? false : 'TEST_DATABASE_URL 없음 (CI의 postgres 작업에서 실행)';

async function withDatabase(fn) {
  const { default: pg } = await import('pg');
  const name = `sb_test_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new pg.Client(ADMIN_URL);
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  try {
    await fn(url.toString());
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}

test('서버 여러 대가 동시에 켜져도 DB 구조 변경은 한 번만, 오류 없이', { skip }, () => withDatabase(async (url) => {
  const dbs = await Promise.all([1, 2, 3, 4].map(() => openPg(url)));
  const n = Number((await dbs[0].get('SELECT COUNT(*) AS n FROM schema_migrations')).n);
  assert.equal(n, 1 + STEPS.length);
  await Promise.all(dbs.map((d) => d.close()));
}));

test('거의 동시에 들어온 신청끼리 바로 매칭 (서버 두 대처럼 연결 묶음 두 개)', { skip }, () => withDatabase(async (url) => {
  const [y, m, d] = STUDY_PERIOD.dates[0].split('-').map(Number);
  setNow(kst(y, m, d - 1, 10, 0));
  const [d1, d2] = [await openPg(url), await openPg(url)];
  try {
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
    for (let i = 0; i < 12; i++) {
      const a = await S.signup(d1, { email: `a${i}@t.dev`, password: 'secret1', name: `a${i}`, department: 'x', phone: '010-1234-5678' });
      const b = await S.signup(d1, { email: `b${i}@t.dev`, password: 'secret1', name: `b${i}`, department: 'x', phone: '010-1234-5678' });
      const req = { days: [day], cells: [`${day}-7`], locations: ['채팅으로 정하기'], styles: [['check', 'talk', 'social'][i % 3]] };
      const [ra, rb] = await Promise.all([S.createRequest(d1, a.user.id, req), S.createRequest(d2, b.user.id, req)]);
      assert.ok(ra.matchId || rb.matchId, `${i}번째 쌍이 매칭되지 않음`);
      await d1.run("UPDATE match_requests SET status = 'cancelled' WHERE status = 'pending'");
    }
  } finally {
    setNow(null);
    await d1.close();
    await d2.close();
  }
}));

test('요청 횟수는 동시에 세도 빠짐없이 (DB 한 줄 원자적 증가)', { skip }, () => withDatabase(async (url) => {
  const [d1, d2] = [await openPg(url), await openPg(url)];
  await Promise.all(Array.from({ length: 40 }, (_, i) => countHit(i % 2 ? d1 : d2, 'race:key', { windowSec: 3600 })));
  assert.equal(Number((await d1.get("SELECT SUM(hits) AS n FROM rate_limits WHERE key = 'race:key'")).n), 40);
  await d1.close();
  await d2.close();
}));

test('예전 로그인 토큰을 동시에 써도 세션은 하나로 옮겨짐', { skip }, () => withDatabase(async (url) => {
  const db = await openPg(url);
  const u = await S.signup(db, { email: 'old@t.dev', password: 'secret1', name: 'old', department: 'x', phone: '010-1234-5678' });
  const legacy = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO auth_tokens (token, user_id, created_at) VALUES (?, ?, ?)', legacy, u.user.id, new Date().toISOString());
  const results = await Promise.all(Array.from({ length: 6 }, () => sessionUser(db, legacy)));
  assert.ok(results.every((r) => r?.user?.id === u.user.id));
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?', hashToken(legacy))).n), 1);
  await db.close();
}));
