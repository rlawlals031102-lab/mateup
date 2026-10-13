import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { seedBots } from './seed.js';
import { autoSettle } from './service.js';
import { createApp } from './app.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo') || process.env.DEMO_MODE === '1';
const port = Number(process.env.PORT) || 3000;
const dbFile = process.env.DB_FILE || path.join(ROOT, 'data', 'studybuddy.db');

const db = openDb(dbFile);
seedBots(db);
autoSettle(db);
// 주간이 끝난 매칭은 접속이 없어도 주기적으로 리포트를 만든다.
setInterval(() => autoSettle(db), 10 * 60 * 1000).unref();

createApp({ db, demo }).listen(port, () => {
  console.log(`스터디버디 서버 실행 중 → http://localhost:${port}${demo ? '  (데모 모드)' : ''}`);
});
