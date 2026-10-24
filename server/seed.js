import crypto from 'node:crypto';
import { requeueBot } from './service.js';
import * as T from './time.js';

// 데모(가상) 메이트. 사용자가 매칭을 신청하면 이 중 조건이 맞는 메이트와 연결된다.
// 화면에는 "데모 메이트"로 표시된다. 목록을 고치면 다음 실행 때 기존 메이트 정보와 대기 신청에도 반영된다.
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_STYLES = ['check', 'talk', 'social'];
const START_POINTS = 100_000; // 데모 메이트 포인트 (보증금이 차감되지 않아 항상 이 값)

export const BOTS = [
  { email: 'bot-morning@studybuddy.local', name: '김아침', age: null, avatar: '🌅',
    tags: ['#아침공부', '#경영관'], bio: '아침 9시에 같이 시작해요',
    template: { location: '경영관 3층 라운지', days: WEEKDAYS, startTime: '09:00', endTime: '12:00', styles: ALL_STYLES, deposit: 10000 } },
  { email: 'bot-evening@studybuddy.local', name: '김저녁', age: null, avatar: '🌙',
    tags: ['#저녁공부', '#성곡도서관'], bio: '수업 끝나고 저녁에 같이 공부해요',
    template: { location: '국민대 성곡도서관', days: WEEKDAYS, startTime: '19:00', endTime: '21:00', styles: ALL_STYLES, deposit: 5000 } },
  { email: 'bot-weekend@studybuddy.local', name: '김주말', age: null, avatar: '☀️',
    tags: ['#주말공부', '#카페공부'], bio: '주말 오후에 카페에서 공부해요',
    template: { location: '정릉 근처 카페', days: [6, 7], startTime: '13:30', endTime: '18:00', styles: ALL_STYLES, deposit: 20000 } },
];

export async function seedBots(db) {
  await db.tx(async (t) => {
    for (const b of BOTS) {
      const existing = await t.get('SELECT id FROM users WHERE email = ?', b.email);
      if (existing) {
        await syncBot(t, existing.id, b);
        continue;
      }
      const { rows } = await t.run(
        `INSERT INTO users (email, password_hash, name, age, tags, bio, avatar, points, is_bot, bot_template, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
        b.email, `!${crypto.randomBytes(8).toString('hex')}`, b.name, b.age,
        JSON.stringify(b.tags), b.bio, b.avatar, START_POINTS, JSON.stringify(b.template), T.now().toISOString(),
      );
      await requeueBot(t, rows[0].id);
    }
  });
}

// 위 목록에 없는 예전 데모 메이트를 정리한다.
//   매칭 기록이 없으면 완전히 삭제, 있으면(다른 사용자의 지난 스터디에 남아 있음) 대기에서만 빼고 기록용으로 남긴다.
export async function retireOldBots(db) {
  // 데모 계정의 고정 '지난 스터디' 상대(기록용)도 정리하지 않는다.
  const keep = [...BOTS.map((b) => b.email), 'beta-history@studybuddy.local'];
  const olds = (await db.all('SELECT id, name, email FROM users WHERE is_bot = 1'))
    .filter((u) => !keep.includes(u.email));
  const result = { deleted: [], retired: [] };
  await db.tx(async (t) => {
    for (const u of olds) {
      await t.run("UPDATE match_requests SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'", u.id);
      const used = await t.get('SELECT 1 AS x FROM matches WHERE user_a = ? OR user_b = ? LIMIT 1', u.id, u.id);
      if (used) {
        await t.run('UPDATE users SET bot_template = NULL WHERE id = ?', u.id); // 다시 대기하지 않음
        result.retired.push(u.name);
      } else {
        await t.run('DELETE FROM point_logs WHERE user_id = ?', u.id);
        await t.run('DELETE FROM match_requests WHERE user_id = ?', u.id);
        await t.run('DELETE FROM auth_tokens WHERE user_id = ?', u.id);
        await t.run('DELETE FROM users WHERE id = ?', u.id);
        result.deleted.push(u.name);
      }
    }
  });
  return result;
}

async function syncBot(db, id, b) {
  const t = b.template;
  // 데모 메이트 포인트는 항상 고정 (예전 버전에서 차감된 보증금도 되돌림)
  await db.run('UPDATE users SET name = ?, age = ?, tags = ?, bio = ?, avatar = ?, bot_template = ?, points = ? WHERE id = ?',
    b.name, b.age, JSON.stringify(b.tags), b.bio, b.avatar, JSON.stringify(t), START_POINTS, id);
  await requeueBot(db, id);
  await db.run(
    `UPDATE match_requests SET location = ?, days = ?, start_time = ?, end_time = ?, styles = ?
     WHERE user_id = ? AND status = 'pending'`,
    t.location, JSON.stringify(t.days), t.startTime, t.endTime, JSON.stringify(t.styles), id,
  );
}
