// 인증 메일 보내기 (Gmail SMTP).
//
// 환경 변수
//   GMAIL_USER / GMAIL_APP_PASSWORD      보내는 Gmail 주소와 앱 비밀번호 (필수)
//   GMAIL_USER_2 / GMAIL_APP_PASSWORD_2  예비 Gmail 계정 (선택). 첫 계정이 막히거나 한도에 걸리면 이 계정으로 보낸다.
//
// 설정이 하나도 없으면 null을 돌려주고, 메일이 필요한 기능은 "메일 설정 없음" 오류를 낸다.
//
// 메일이 가끔 안 오던 원인(코드 분석)과 대응
//   1) 시간 제한이 없어서, SMTP 연결이 느리면 서버 함수가 먼저 끝나 버릴 수 있었다
//      → 연결·응답 시간 제한을 짧게 두고, 실패하면 바로 다시 시도한다.
//   2) 한 번 실패하면 끝이었다 (Gmail이 일시적으로 거절·한도 초과·로그인 차단을 해도 재시도 없음)
//      → 계정마다 최대 2번, 예비 계정이 있으면 예비 계정으로도 보낸다.
//   3) 실패해도 기록이 남지 않아 원인을 알 수 없었다
//      → send() 결과(어느 계정, 몇 번 시도, 오류 내용)를 돌려주고 service.js 가 email_logs 에 남긴다.

const TIMEOUTS = { connectionTimeout: 7000, greetingTimeout: 7000, socketTimeout: 10000 };

// 다시 보내도 소용없는 오류 (주소 자체가 거절됨)
const isPermanent = (err) => /^5\d\d$/.test(String(err?.responseCode ?? '')) && !/(auth|login|limit|quota|rate)/i.test(err?.response ?? '');

export async function createGmailMailer({ user, pass, user2, pass2 } = {}) {
  const accounts = [[user, pass], [user2, pass2]].filter(([u, p]) => u && p);
  if (!accounts.length) return null;
  const { default: nodemailer } = await import('nodemailer');
  const transports = accounts.map(([u, p]) => ({
    user: u,
    transport: nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: u, pass: p.replace(/\s+/g, '') }, // 앱 비밀번호는 4자리씩 띄어서 보여지므로 공백 제거
      ...TIMEOUTS,
    }),
  }));

  return {
    // 성공하면 { provider, attempts }, 모두 실패하면 err.attempts / err.provider 를 붙여 던진다.
    async send({ to, subject, text, html }) {
      let attempts = 0;
      let lastErr = null;
      for (const { user: from, transport } of transports) {
        for (let i = 0; i < 2; i++) {
          attempts++;
          try {
            await transport.sendMail({ from: `스터디버디 <${from}>`, to, subject, text, html });
            return { provider: from, attempts };
          } catch (err) {
            lastErr = err;
            if (isPermanent(err)) break;
            if (i === 0) await new Promise((r) => setTimeout(r, 600));
          }
        }
      }
      lastErr.attempts = attempts;
      lastErr.provider = transports.map((t) => t.user).join(',');
      throw lastErr;
    },
  };
}
