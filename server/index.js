// 로컬 실행용 서버.
//   npm run demo      → SQLite 파일(data/) + 데모 메이트 + 데모 모드
//   npm start         → SQLite 파일(data/), 데모 메이트 없음
//   npm run dev:db    → .env.local 의 DATABASE_URL(Supabase)에 접속 (실서비스와 같은 DB!)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqlite } from './db.js';
import { seedBots, retireOldBots } from './seed.js';
import { autoSettle, DEMO_ACCOUNT } from './service.js';
import { createRealtime } from './realtime.js';
import { createApp } from './app.js';
import { createGmailMailer } from './mailer.js';
import { EMAIL_DOMAIN } from './options.js';

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

if (demo) {
  await seedBots(db);
  await retireOldBots(db);
}
await autoSettle(db);
// 주간이 끝난 매칭은 접속이 없어도 주기적으로 리포트를 만든다.
setInterval(() => autoSettle(db).catch(console.error), 10 * 60 * 1000).unref();

// 데모가 아니면 실서비스처럼 국민대 메일 + 인증번호. (메일은 .env.local 의 GMAIL_USER / GMAIL_APP_PASSWORD)
const env = process.env;
const mailer = await createGmailMailer({
  user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD, user2: env.GMAIL_USER_2, pass2: env.GMAIL_APP_PASSWORD_2,
});
const emailPolicy = demo ? { domain: null, verify: false } : { domain: EMAIL_DOMAIN, verify: true };
const realtime = createRealtime({
  url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, secret: env.REALTIME_SECRET || env.DATABASE_URL || 'local',
});
// 데모 모드에서는 공용 데모 계정이 운영자 화면을 체험할 수 있다. 보증금 계좌는 DEPOSIT_ACCOUNT 가 있을 때만.
const adminEmails = [...(env.ADMIN_EMAILS || '').split(','), ...(demo ? [DEMO_ACCOUNT.email] : [])];

createApp({ db, demo, emailPolicy, mailer, realtime, adminEmails, depositAccount: env.DEPOSIT_ACCOUNT || null }).listen(port, () => {
  console.log(`스터디버디 서버 실행 중 → http://localhost:${port}${demo ? '  (데모 모드)' : ''}`);
});
