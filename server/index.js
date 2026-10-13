// 로컬 실행용 서버.
//   npm run demo      → SQLite 파일(data/) + 데모 메이트 + 데모 모드
//   npm start         → SQLite 파일(data/), 데모 메이트 없음
//   npm run dev:db    → .env.local 의 DATABASE_URL(Supabase)에 접속 (실서비스와 같은 DB!)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqlite } from './db.js';
import { seedBots } from './seed.js';
import { autoSettle } from './service.js';
import { createApp } from './app.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo') || process.env.DEMO_MODE === '1';
const port = Number(process.env.PORT) || 3000;

let db;
if (process.env.DATABASE_URL) {
  const { openPg } = await import('./db-pg.js');
  db = await openPg(process.env.DATABASE_URL);
  console.log('DB: PostgreSQL (DATABASE_URL)');
} else {
  const file = process.env.DB_FILE || path.join(ROOT, 'data', 'studybuddy.db');
  db = await openSqlite(file);
  console.log(`DB: SQLite (${path.relative(ROOT, file)})`);
}

if (demo) await seedBots(db);
await autoSettle(db);
// 주간이 끝난 매칭은 접속이 없어도 주기적으로 리포트를 만든다.
setInterval(() => autoSettle(db).catch(console.error), 10 * 60 * 1000).unref();

createApp({ db, demo }).listen(port, () => {
  console.log(`스터디버디 서버 실행 중 → http://localhost:${port}${demo ? '  (데모 모드)' : ''}`);
});
