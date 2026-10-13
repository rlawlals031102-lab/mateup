// Vercel 서버리스 함수 — /api/* 요청을 모두 받아 Express 앱으로 처리한다. (vercel.json rewrites)
// DB는 Vercel–Neon 연동이 넣어 주는 DATABASE_URL 을 쓴다.
import { createApp } from '../server/app.js';
import { openPg } from '../server/db-pg.js';

const db = await openPg(process.env.DATABASE_URL);

export default createApp({
  db,
  demo: false,
  secureCookies: true,
  cronSecret: process.env.CRON_SECRET || null,
  serveStatic: false,
});
