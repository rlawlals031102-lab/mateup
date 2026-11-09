// 운영자 기능 (개발자 화면 서버 쪽). 화면은 김지민님 담당이라, 여기서는 데이터와 동작만 제공한다.
//  - 운영자 행동 기록(admin_logs): 개발자 화면 열람, 신고 대화 열람, 매칭 대화 열람, 정지 해제. 1년 보관.
//  - 약속 지키기 현황과 정지 해제, 신고 목록, 매칭 하나의 대화.
import * as T from './time.js';
import { DEMO_ACCOUNT } from './service.js';
import { REPORT_REASONS } from './reports.js';

export async function logAdmin(db, adminId, action, target = null) {
  await db.run('INSERT INTO admin_logs (admin_id, action, target, created_at) VALUES (?, ?, ?, ?)',
    adminId, action, target == null ? null : String(target).slice(0, 200), T.now().toISOString());
}

export async function recentAdminLogs(db, limit = 30) {
  const rows = await db.all(
    `SELECT l.*, u.name FROM admin_logs l JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT ${Number(limit) | 0}`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, action: r.action, target: r.target, at: r.created_at }));
}

// 약속 기록이 있거나 정지 중인 사람
export async function promiseOverview(db) {
  const rows = await db.all(
    `SELECT u.id, u.name, u.suspended_until,
       (SELECT COUNT(*) FROM strikes s WHERE s.user_id = u.id AND s.created_at > COALESCE(u.strikes_since, '')) AS n
     FROM users u WHERE u.is_bot = 0 AND u.email <> ? AND u.deleted_at IS NULL ORDER BY u.id`,
    DEMO_ACCOUNT.email,
  );
  const now = T.now();
  return rows
    .map((r) => ({
      id: r.id, name: r.name, count: Number(r.n),
      suspendedUntil: r.suspended_until && new Date(r.suspended_until) > now ? r.suspended_until : null,
    }))
    .filter((r) => r.count > 0 || r.suspendedUntil);
}

export async function unsuspend(db, adminId, userId) {
  const u = await db.get('SELECT id, name FROM users WHERE id = ? AND is_bot = 0', userId);
  if (!u) return null;
  const now = T.now().toISOString();
  // 정지를 풀고 기록도 0번부터 (정지가 끝난 것과 같게)
  await db.run('UPDATE users SET suspended_until = ?, strikes_since = ? WHERE id = ?', now, now, userId);
  await logAdmin(db, adminId, 'unsuspend', `user:${userId}`);
  return { id: u.id, name: u.name };
}

// 신고 목록 (+ 신고된 대화 내용). 열람은 app.js 에서 admin_logs 에 남긴다.
export async function reportList(db, { withMessages = true } = {}) {
  const rows = await db.all(
    `SELECT r.*, ru.name AS reporter, ua.name AS name_a, ub.name AS name_b
     FROM reports r JOIN users ru ON ru.id = r.reporter_id JOIN matches m ON m.id = r.match_id
     JOIN users ua ON ua.id = m.user_a JOIN users ub ON ub.id = m.user_b
     ORDER BY (r.status = 'open') DESC, r.id DESC`,
  );
  const out = [];
  for (const r of rows) {
    const item = {
      id: r.id, matchId: r.match_id, status: r.status, reason: REPORT_REASONS[r.reason] ?? r.reason, detail: r.detail,
      reporter: r.reporter, names: [r.name_a, r.name_b], createdAt: r.created_at,
    };
    if (withMessages) {
      item.messages = (await db.all(
        `SELECT m.body, m.created_at, u.name FROM messages m JOIN users u ON u.id = m.user_id
         WHERE m.match_id = ? ORDER BY m.id`, r.match_id,
      )).map((m) => ({ name: m.name, body: m.body, createdAt: m.created_at }));
    }
    out.push(item);
  }
  return out;
}

// 매칭 하나의 대화. 운영자가 개발자 화면에서 '대화 보기'를 누를 때만 열고, 열 때마다 기록이 남는다.
// 처리방침 5번: 신고된 대화와 약속 분쟁 처리에 꼭 필요한 경우에만 확인, 누가 언제 열람했는지 기록.
export async function matchChat(db, adminId, matchId) {
  const m = await db.get(
    `SELECT m.id, ua.name AS name_a, ub.name AS name_b FROM matches m
     JOIN users ua ON ua.id = m.user_a JOIN users ub ON ub.id = m.user_b WHERE m.id = ?`, matchId,
  );
  if (!m) return null;
  const messages = (await db.all(
    `SELECT msg.body, msg.created_at, u.name FROM messages msg JOIN users u ON u.id = msg.user_id
     WHERE msg.match_id = ? ORDER BY msg.id`, matchId,
  )).map((x) => ({ name: x.name, body: x.body, createdAt: x.created_at }));
  await logAdmin(db, adminId, 'view_chat', `match:${matchId}`);
  return { matchId: m.id, names: [m.name_a, m.name_b], messages };
}

export async function closeReport(db, adminId, reportId) {
  const { changes } = await db.run("UPDATE reports SET status = 'closed' WHERE id = ?", reportId);
  if (changes) await logAdmin(db, adminId, 'close_report', `report:${reportId}`);
  return changes > 0;
}
