// 채팅 신고: 매칭된 두 사람만 그 대화를 신고할 수 있다. 같은 사람이 같은 대화를 다시 신고하면 내용을 바꾼다.
// 신고된 대화는 개발자 화면에 바로 보인다 (server/admin.js reportList). 다른 대화는 운영자가 '대화 보기'로 열 때만 (matchChat, 열람 기록).
import { AppError } from './service.js';
import * as T from './time.js';

export const REPORT_REASONS = {
  rude: '불쾌한 말이나 행동',
  promise: '약속·출석 관련 문제',
  spam: '광고·스팸',
  other: '기타',
};

export async function reportChat(db, userId, matchId, { reason, detail } = {}) {
  if (!REPORT_REASONS[reason]) throw new AppError(400, '신고 이유를 골라 주세요.');
  const text = String(detail ?? '').trim().slice(0, 500);
  if (reason === 'other' && !text) throw new AppError(400, '어떤 일인지 적어 주세요.');
  const m = await db.get('SELECT id FROM matches WHERE id = ? AND (user_a = ? OR user_b = ?)', matchId, userId, userId);
  if (!m) throw new AppError(404, '대화를 찾을 수 없어요.');
  await db.run(
    `INSERT INTO reports (match_id, reporter_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)
     ON CONFLICT (match_id, reporter_id) DO UPDATE
       SET reason = excluded.reason, detail = excluded.detail, status = 'open', created_at = excluded.created_at`,
    matchId, userId, reason, text || null, T.now().toISOString(),
  );
  return { ok: true };
}
