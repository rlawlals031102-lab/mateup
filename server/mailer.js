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
    async send({ to, subject, text, html }) {
      await transport.sendMail({ from: `스터디버디 <${user}>`, to, subject, text, html });
    },
  };
}
