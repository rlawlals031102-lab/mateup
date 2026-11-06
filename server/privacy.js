// 개인정보 보호 (처리방침: public/privacy.html)
//  - 동의: 가입할 때 받고, 처리방침이 바뀌면(PRIVACY_POLICY.version) 다시 받는다.
//  - 회원 탈퇴: 계정 정보를 지우고 '탈퇴한 사용자'로 남긴다(상대방의 매칭·채팅 기록은 유지).
//    매칭 정지 중이었다면 메일 해시와 정지 종료일만 정지가 끝날 때까지 보관 → 다시 가입해도 정지가 이어진다.
//  - 보관 기간이 지난 기록은 매일 작업(purgeOldData)에서 지운다. 표는 처리방침 '보유 기간'과 같아야 한다.
import * as T from './time.js';
import { AppError, passwordMatches, strikeStatus, chooseNext } from './service.js';
import { PRIVACY_POLICY } from './options.js';
import { endAllSessions } from './sessions.js';
import { encryptField, decryptField, encryptionOn, emailHash } from './fieldcrypt.js';

const DAY = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = {
  emailCodes: 30, // 인증번호 기록
  rateLimits: 2, // 요청 횟수 기록 (IP 해시 포함)
  adminLogs: 365, // 운영자 행동 기록
  closedReports: 365, // 처리가 끝난 신고
  chatsAfterMatch: 365, // 매칭이 끝난 뒤 채팅
};

// 동의가 필요한지 (required: 이 서비스가 동의를 받는지 — 실서비스만)
export const consentState = (user, required) => ({
  required: !!required && user?.privacy_version !== PRIVACY_POLICY.version,
  version: PRIVACY_POLICY.version,
});

export async function recordConsent(db, userId) {
  await db.run('UPDATE users SET agreed_at = ?, privacy_version = ? WHERE id = ?', T.now().toISOString(), PRIVACY_POLICY.version, userId);
  return consentState({ privacy_version: PRIVACY_POLICY.version }, true);
}

export async function deleteAccount(db, userId, password) {
  const u = await db.get('SELECT * FROM users WHERE id = ? AND is_bot = 0', userId);
  if (!u || u.deleted_at) throw new AppError(404, '계정을 찾을 수 없어요.');
  if (!(await passwordMatches(String(password ?? ''), u.password_hash))) throw new AppError(401, '비밀번호가 맞지 않아요.');
  const active = await db.get(
    "SELECT id FROM matches WHERE status = 'active' AND (user_a = ? OR user_b = ?) LIMIT 1", userId, userId,
  );
  if (active) throw new AppError(409, '진행 중인 매칭이 있어요. 이번 주를 마치거나 매칭을 그만둔 뒤에 탈퇴할 수 있어요.');
  // 리포트를 기다리는 매칭은 '새 메이트'로 마무리해 상대방이 기다리지 않게 한다
  for (const m of await db.all("SELECT id FROM matches WHERE status = 'reported' AND (user_a = ? OR user_b = ?)", userId, userId)) {
    await chooseNext(db, userId, m.id, 'new');
  }
  const { suspendedUntil } = await strikeStatus(db, userId);
  const now = T.now().toISOString();
  await db.tx(async (t) => {
    await t.run("UPDATE match_requests SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'", userId);
    if (suspendedUntil) {
      await t.run(
        `INSERT INTO blocked_emails (email_hash, blocked_until) VALUES (?, ?)
         ON CONFLICT (email_hash) DO UPDATE SET blocked_until = excluded.blocked_until`,
        emailHash(u.email), suspendedUntil,
      );
    }
    await t.run('DELETE FROM email_codes WHERE email = ?', u.email);
    await t.run(
      `UPDATE users SET email = ?, name = '탈퇴한 사용자', password_hash = '!', age = NULL, tags = '[]', bio = '',
         department = NULL, phone = NULL, personal = NULL, deleted_at = ? WHERE id = ?`,
      `deleted-${userId}@deleted.invalid`, now, userId,
    );
    await endAllSessions(t, userId);
  });
  return { ok: true };
}

// 보관 기간이 지난 기록 지우기 + 아직 암호화하지 않은 전화번호 암호화 (매일 작업)
export async function purgeOldData(db) {
  const now = T.now();
  const ago = (days) => new Date(now.getTime() - days * DAY).toISOString();
  const del = async (sql, ...p) => Number((await db.run(sql, ...p)).changes ?? 0);
  const out = {
    sessions: await del('DELETE FROM sessions WHERE expires_at <= ?', now.toISOString()),
    oldTokens: await del('DELETE FROM auth_tokens WHERE created_at <= ?', ago(30)),
    rateLimits: await del('DELETE FROM rate_limits WHERE window_start <= ?', ago(RETENTION_DAYS.rateLimits)),
    emailCodes: await del('DELETE FROM email_codes WHERE created_at <= ?', ago(RETENTION_DAYS.emailCodes)),
    adminLogs: await del('DELETE FROM admin_logs WHERE created_at <= ?', ago(RETENTION_DAYS.adminLogs)),
    reports: await del("DELETE FROM reports WHERE status <> 'open' AND created_at <= ?", ago(RETENTION_DAYS.closedReports)),
    blockedEmails: await del('DELETE FROM blocked_emails WHERE blocked_until <= ?', now.toISOString()),
    messages: await del(
      `DELETE FROM messages WHERE match_id IN (SELECT id FROM matches WHERE status <> 'active' AND week_end <= ?)`,
      T.addDays(T.today(), -RETENTION_DAYS.chatsAfterMatch),
    ),
    encryptedPhones: 0,
  };
  if (encryptionOn()) {
    const rows = await db.all("SELECT id, phone FROM users WHERE phone IS NOT NULL AND phone NOT LIKE 'enc:v1:%'");
    for (const r of rows) {
      out.encryptedPhones += Number((await db.run(
        'UPDATE users SET phone = ? WHERE id = ? AND phone = ?', encryptField(r.phone), r.id, r.phone,
      )).changes ?? 0);
    }
  }
  return out;
}

// 내 정보 내려받기 (개인정보 열람권): 내가 낸 정보와 서비스를 쓰며 생긴 내 기록을 JSON 하나로.
// 상대방이 보낸 메시지·상대방의 연락처처럼 다른 사람의 개인정보는 넣지 않는다 (메이트는 이름만).
const json = (v, fallback) => { try { return JSON.parse(v); } catch { return v ?? fallback; } };
export async function exportMyData(db, userId) {
  const u = await db.get('SELECT * FROM users WHERE id = ?', userId);
  if (!u) throw new AppError(404, '계정을 찾을 수 없어요.');
  const nameOf = async (id) => (await db.get('SELECT name FROM users WHERE id = ?', id))?.name ?? null;
  const matches = await db.all('SELECT * FROM matches WHERE user_a = ? OR user_b = ? ORDER BY id', userId, userId);
  return {
    exportedAt: T.now().toISOString(),
    privacyPolicyVersion: PRIVACY_POLICY.version,
    profile: {
      email: u.email, name: u.name, department: u.department ?? null, phone: decryptField(u.phone), age: u.age ?? null,
      tags: json(u.tags, []), bio: u.bio, personalSchedule: json(u.personal, []), createdAt: u.created_at,
      agreedAt: u.agreed_at ?? null, agreedPolicyVersion: u.privacy_version ?? null,
    },
    matchRequests: (await db.all('SELECT * FROM match_requests WHERE user_id = ? ORDER BY id', userId)).map((r) => ({
      createdAt: r.created_at, status: r.status, days: json(r.days, []), cells: json(r.cells, []),
      locations: json(r.location, r.location), styles: json(r.styles, []),
    })),
    matches: await Promise.all(matches.map(async (m) => ({
      id: m.id, status: m.status, weekStart: m.week_start, weekEnd: m.week_end, location: m.location,
      mateName: await nameOf(m.user_a === userId ? m.user_b : m.user_a), createdAt: m.created_at,
    }))),
    attendance: await db.all(
      `SELECT p.date, p.start_time AS "startTime", p.end_time AS "endTime", a.checked_in_at AS "checkedInAt",
         a.checked_out_at AS "checkedOutAt", a.minutes FROM attendance a JOIN appointments p ON p.id = a.appointment_id
       WHERE a.user_id = ? ORDER BY p.date`, userId,
    ),
    messagesSent: await db.all('SELECT match_id AS "matchId", body, created_at AS "createdAt" FROM messages WHERE user_id = ? ORDER BY id', userId),
    promiseRecords: await db.all('SELECT kind, match_id AS "matchId", created_at AS "createdAt" FROM strikes WHERE user_id = ? ORDER BY id', userId),
    suspendedUntil: u.suspended_until ?? null,
    reportsMade: await db.all('SELECT match_id AS "matchId", reason, detail, status, created_at AS "createdAt" FROM reports WHERE reporter_id = ? ORDER BY id', userId),
    loginSessions: await db.all('SELECT created_at AS "createdAt", last_seen_at AS "lastSeenAt", expires_at AS "expiresAt" FROM sessions WHERE user_id = ? ORDER BY created_at', userId),
  };
}
