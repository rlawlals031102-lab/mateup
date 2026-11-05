// Vercel 서버리스 함수 — /api/* 요청을 모두 받아 Express 앱으로 처리한다. (vercel.json rewrites)
// DB는 Vercel 환경 변수 DATABASE_URL(Supabase Transaction pooler)을 쓴다.
// 가입·로그인은 국민대 메일(@kookmin.ac.kr)만. 인증번호 메일은 GMAIL_USER / GMAIL_APP_PASSWORD 로 보낸다.
// 선택 환경 변수:
//   GMAIL_USER_2 / GMAIL_APP_PASSWORD_2  예비 메일 계정 (첫 계정이 실패하면 이 계정으로 보냄)
//   DEPOSIT_ACCOUNT   보증금 받을 운영진 계좌 문구. 있으면 신청 화면에 보증금(계좌이체) 선택이 보인다.
//   ADMIN_EMAILS      운영자 메일(쉼표로 구분). 이 메일로 로그인하면 운영자 화면을 쓸 수 있다.
//   SUPABASE_URL / SUPABASE_ANON_KEY   실시간 채팅. 없으면 3초마다 새 메시지를 확인한다.
//   REALTIME_SECRET   실시간 채널 이름을 만드는 비밀값 (없으면 DATABASE_URL로 만든다)
// 시작(모듈 로드·DB 연결)에 실패하면 함수가 통째로 죽지 않고, 원인을 JSON으로 알려 준다. (접속 정보는 가림)

let appPromise = null;

function getApp() {
  appPromise ??= (async () => {
    const [{ createApp }, { openPg }, { createGmailMailer }, { EMAIL_DOMAIN }, { createRealtime }, crypto] = await Promise.all([
      import('../server/app.js'),
      import('../server/db-pg.js'),
      import('../server/mailer.js'),
      import('../server/options.js'),
      import('../server/realtime.js'),
      import('node:crypto'),
    ]);
    const env = process.env;
    const db = await openPg(env.DATABASE_URL);
    const mailer = await createGmailMailer({
      user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD, user2: env.GMAIL_USER_2, pass2: env.GMAIL_APP_PASSWORD_2,
    });
    const realtime = createRealtime({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      secret: env.REALTIME_SECRET || crypto.createHash('sha256').update(`realtime:${env.DATABASE_URL}`).digest('hex'),
    });
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
      depositAccount: env.DEPOSIT_ACCOUNT || null,
      adminEmails: (env.ADMIN_EMAILS || '').split(','),
      realtime,
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
