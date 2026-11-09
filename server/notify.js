// 알림 메일 (Phase 1: 이메일). 본래 흐름(매칭·정산)을 막지 않도록 여기서는 절대 throw 하지 않는다.
//  - mailer 가 없으면(데모·메일 설정 전) 아무것도 안 한다.
//  - 봇(데모 메이트)·공용 데모 계정·메일 없는 계정·알림을 끈 사용자(notify_opt_out)는 건너뛴다.
//  - DB 트랜잭션 밖(커밋 뒤)에서 부른다. 메일은 느린 I/O라 매칭 잠금을 잡으면 안 된다.
import { DEMO_ACCOUNT } from './service.js';

const SITE = process.env.PUBLIC_SITE_URL || 'https://mateup-gamma.vercel.app';

const shell = (lead, bodyHtml) => `<div style="font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:440px;margin:auto;padding:24px;border:1px solid #dde4d5;border-radius:16px;background:#fefaef;color:#1e2b1a">
  <p style="color:#315443;font-weight:800;letter-spacing:.04em;margin:0 0 14px">STUDY BUDDY</p>
  <p style="font-size:16px;font-weight:700;margin:0 0 8px">${lead}</p>
  ${bodyHtml}
  <p style="margin:20px 0 0"><a href="${SITE}" style="display:inline-block;background:#456e2a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700">앱에서 보기</a></p>
  <p style="color:#8a927f;font-size:12px;margin:18px 0 0">알림을 받고 싶지 않다면 앱 마이페이지 &gt; 알림에서 끌 수 있어요.</p>
</div>`;

async function sendSafe(mailer, msg) {
  try { await mailer.send(msg); } catch { /* 알림 한 통 실패는 무시 */ }
}

function sendable(u) {
  return u && !u.is_bot && u.email && u.email !== DEMO_ACCOUNT.email && !u.notify_opt_out;
}

// 한 매칭의 두 사람에게 '매칭됐어요' 메일 (매칭 커밋 뒤 호출).
export async function notifyMatch(db, mailer, matchId) {
  if (!mailer || !matchId) return;
  try {
    const m = await db.get('SELECT user_a, user_b FROM matches WHERE id = ?', matchId);
    if (!m) return;
    const users = await db.all(
      'SELECT id, name, email, is_bot, notify_opt_out FROM users WHERE id IN (?, ?)', m.user_a, m.user_b,
    );
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const u of users) {
      if (!sendable(u)) continue;
      const mate = byId.get(u.id === m.user_a ? m.user_b : m.user_a);
      const mateName = mate?.name ?? '메이트';
      await sendSafe(mailer, {
        to: u.email,
        subject: `[스터디버디] ${mateName}님과 매칭됐어요`,
        text: `이번 주 공부 메이트로 ${mateName}님과 매칭됐어요.\n약속 날짜·장소는 앱에서 확인하고, 약속한 날 꼭 나와 주세요.\n\n${SITE}\n\n알림을 받고 싶지 않다면 앱 마이페이지 > 알림에서 끌 수 있어요.`,
        html: shell(`${mateName}님과 매칭됐어요`,
          '<p style="font-size:14px;color:#3a4636;margin:0">이번 주 공부 메이트가 정해졌어요. 약속 날짜·장소를 앱에서 확인하고, 약속한 날 꼭 나와 주세요.</p>'),
      });
    }
  } catch { /* 알림 전체 실패는 무시 (본래 흐름 보호) */ }
}
