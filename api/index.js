// Vercel 서버리스 함수 — /api/* 요청을 모두 받아 Express 앱으로 처리한다. (vercel.json rewrites)
// DB는 Vercel 환경 변수 DATABASE_URL(Supabase Transaction pooler)을 쓴다.
// 가입·로그인은 국민대 메일(@kookmin.ac.kr)만. 인증번호 메일은 GMAIL_USER / GMAIL_APP_PASSWORD 로 보낸다.
// 시작(모듈 로드·DB 연결)에 실패하면 함수가 통째로 죽지 않고, 원인을 JSON으로 알려 준다. (접속 정보는 가림)
//
// 미리보기(Preview) 배포는 실서비스 DB를 쓰지 않는다. PR·브랜치마다 Vercel이 만드는 미리보기 서버가
// 아직 합치지 않은 코드의 DB 구조 변경(server/migrate.js)을 실서비스 DB에 적용하는 일을 막기 위해서다.
// 미리보기용 DB 주소는 Vercel 환경 변수 PREVIEW_DATABASE_URL (Environment: Preview). 없으면 미리보기 API는 503.
const isPreview = () => process.env.VERCEL_ENV === 'preview';
const databaseUrl = () => (isPreview() ? process.env.PREVIEW_DATABASE_URL : process.env.DATABASE_URL);

let appPromise = null;

function getApp() {
  appPromise ??= (async () => {
    const [{ createApp }, { openPg }, { createGmailMailer }, { EMAIL_DOMAIN }] = await Promise.all([
      import('../server/app.js'),
      import('../server/db-pg.js'),
      import('../server/mailer.js'),
      import('../server/options.js'),
    ]);
    const db = await openPg(databaseUrl());
    const mailer = await createGmailMailer({ user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD });
    return createApp({
      db,
      demo: false,
      secureCookies: true,
      cronSecret: process.env.CRON_SECRET || null,
      serveStatic: false,
      // 국민대 메일만 가입·로그인하고, 가입·비밀번호 찾기는 메일 인증번호로 확인한다.
      emailPolicy: { domain: EMAIL_DOMAIN, verify: true },
      mailer,
      demoLogin: false, // 실제 모집 기간이라 공용 체험 계정(데모 계정으로 로그인)은 끔
    });
  })();
  return appPromise;
}

const redact = (s) => String(s ?? '').replace(/postgres(ql)?:\/\/\S+/gi, '[DATABASE_URL]');

export default async function handler(req, res) {
  if (isPreview() && !process.env.PREVIEW_DATABASE_URL) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: '미리보기 배포라 실서비스 DB를 쓰지 않아요. 미리보기용 DB(PREVIEW_DATABASE_URL)를 넣으면 동작해요.' }));
    return;
  }
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
