// Gmail SMTP로 메일 보내기. 환경 변수 GMAIL_USER(보내는 Gmail 주소)와 GMAIL_APP_PASSWORD(Gmail 앱 비밀번호)가 필요하다.
// 설정이 없으면 null을 돌려주고, 메일이 필요한 기능은 "메일 설정 없음" 오류를 낸다.

export async function createGmailMailer({ user, pass } = {}) {
  if (!user || !pass) return null;
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: pass.replace(/\s+/g, '') }, // 앱 비밀번호는 4자리씩 띄어서 보여지므로 공백 제거
  });
  return {
    // 잠깐 끊기는 오류(연결·시간 초과·임시 거절)는 한 번 더 보낸다. 로그인 정보 오류(EAUTH)는 바로 알린다.
    async send({ to, subject, text, html }) {
      for (let attempt = 1; ; attempt++) {
        try {
          await transport.sendMail({ from: `스터디버디 <${user}>`, to, subject, text, html });
          return;
        } catch (err) {
          const temporary = err.code !== 'EAUTH' && (!err.responseCode || err.responseCode < 500);
          if (attempt >= 2 || !temporary) throw err;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    },
  };
}
