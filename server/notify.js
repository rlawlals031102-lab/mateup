// 알림 메일 (Phase 1: 이메일). 본래 흐름(매칭·정산)을 막지 않도록 여기서는 절대 throw 하지 않는다.
//  - mailer 가 없으면(데모·메일 설정 전) 아무것도 안 한다.
//  - 봇(데모 메이트)·공용 데모 계정·메일 없는 계정·알림을 끈 사용자(notify_opt_out)는 건너뛴다.
//  - DB 트랜잭션 밖(커밋 뒤)에서 부른다. 메일은 느린 I/O라 매칭 잠금을 잡으면 안 된다.
import { DEMO_ACCOUNT } from './service.js';
import * as T from './time.js';

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


// ───────────────────────── 약속 리마인드 ─────────────────────────
// 30분마다 호출(GitHub Actions → /api/cron/reminders). 같은 약속·사람·종류는 한 번만 보낸다(sent_reminders).
const kstHour = (d) => new Date(d.getTime() + 9 * 3600000).getUTCHours();

// 지금 이 약속에 보낼 리마인드 종류: 3시간 이내면 '오늘', 전날 저녁(18~23시)이면 '내일', 아니면 없음.
function reminderKind(a, now) {
  const start = T.at(a.date, a.start_time);
  const diffMin = (start.getTime() - now.getTime()) / 60000;
  if (diffMin <= 0) return null;        // 이미 시작했거나 지난 약속
  if (diffMin <= 180) return 'soon';    // 3시간 이내 → 당일 리마인드
  if (a.date === T.addDays(T.today(), 1) && kstHour(now) >= 18 && kstHour(now) < 23) return 'day_before';
  return null;
}

function reminderMail(a, kind, mate) {
  const mateName = mate?.name ?? '메이트';
  const where = a.location ? ` · ${a.location}` : '';
  if (kind === 'soon') {
    const line = `오늘 ${a.start_time}에 ${mateName}님과 공부 약속이 있어요${where}. 잊지 말고 나와 주세요.`;
    return { subject: `[스터디버디] 오늘 ${a.start_time} 공부 약속이 있어요`, lead: `오늘 ${a.start_time}, ${mateName}님과 약속`, line };
  }
  const [, m, d] = a.date.split('-').map(Number);
  const line = `내일(${m}월 ${d}일) ${a.start_time}에 ${mateName}님과 공부 약속이 있어요${where}. 미리 챙겨 두세요.`;
  return { subject: `[스터디버디] 내일 ${a.start_time} 공부 약속이 있어요`, lead: `내일 ${a.start_time}, ${mateName}님과 약속`, line };
}

// 지금 보낼 리마인드를 모두 보낸다. 보낸 개수를 돌려준다. (본래 흐름 보호: 여기서도 throw 안 함)
export async function sendDueReminders(db, mailer, now) {
  if (!mailer) return 0;
  now = now || T.now();
  let sent = 0;
  try {
    const appts = await db.all(
      `SELECT a.id AS appt_id, a.date, a.start_time, m.user_a, m.user_b, m.location
       FROM appointments a JOIN matches m ON m.id = a.match_id WHERE m.status = 'active'`,
    );
    for (const a of appts) {
      const kind = reminderKind(a, now);
      if (!kind) continue;
      const users = await db.all(
        'SELECT id, name, email, is_bot, notify_opt_out FROM users WHERE id IN (?, ?)', a.user_a, a.user_b,
      );
      const byId = new Map(users.map((u) => [u.id, u]));
      for (const u of users) {
        if (!sendable(u)) continue;
        const ins = await db.run(
          'INSERT INTO sent_reminders (appointment_id, user_id, kind, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (appointment_id, user_id, kind) DO NOTHING',
          a.appt_id, u.id, kind, now.toISOString(),
        );
        if (!ins.changes) continue; // 이미 보냈으면 건너뜀
        const mate = byId.get(u.id === a.user_a ? a.user_b : a.user_a);
        const mail = reminderMail(a, kind, mate);
        await sendSafe(mailer, {
          to: u.email, subject: mail.subject,
          text: `${mail.line}\n\n${SITE}\n\n알림을 받고 싶지 않다면 앱 마이페이지 > 알림에서 끌 수 있어요.`,
          html: shell(mail.lead, `<p style="font-size:14px;color:#3a4636;margin:0">${mail.line}</p>`),
        });
        sent++;
      }
    }
  } catch { /* 리마인드 전체 실패는 무시 */ }
  return sent;
}
