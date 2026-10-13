// Vercel 서버리스 함수 — /api/* 요청을 모두 받아 Express 앱으로 처리한다. (vercel.json rewrites)
// DB는 Vercel 환경 변수 DATABASE_URL(Supabase Transaction pooler)을 쓴다.
// 시작(모듈 로드·DB 연결)에 실패하면 함수가 통째로 죽지 않고, 원인을 JSON으로 알려 준다. (접속 정보는 가림)

let appPromise = null;

function getApp() {
  appPromise ??= (async () => {
    const [{ createApp }, { openPg }] = await Promise.all([
      import('../server/app.js'),
      import('../server/db-pg.js'),
    ]);
    const db = await openPg(process.env.DATABASE_URL);
    return createApp({
      db,
      demo: false,
      secureCookies: true,
      cronSecret: process.env.CRON_SECRET || null,
      serveStatic: false,
    });
  })();
  return appPromise;
}

const redact = (s) => String(s ?? '').replace(/postgres(ql)?:\/\/\S+/gi, '[DATABASE_URL]');

export default async function handler(req, res) {
  let app;
  try {
    app = await getApp();
  } catch (err) {
    appPromise = null; // 다음 요청에서 다시 시도
    console.error('서버 시작 실패', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: '서버를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
      cause: { code: err.code ?? null, message: redact(err.message) },
    }));
    return;
  }
  return app(req, res);
}
