import crypto from 'node:crypto';
import { requeueBot, adjustPoints } from './service.js';
import * as T from './time.js';

// 데모용 메이트. 로컬 데모(npm run demo)와 서버 없는 HTML 데모에서만 만든다. (실서비스에는 없음)
// 사용자가 매칭을 신청하면 이 중 조건이 맞는 메이트와 연결된다.
const ALL = [1, 2, 3, 4, 5, 6, 7];
export const BOTS = [
  { name: '이지은', age: 24, avatar: '👩', tags: ['#카페공부', '#자격증준비', '#ENFJ'], bio: '카페에서 집중이 잘 돼요!',
    template: { location: '정릉 근처 카페', days: [1, 3, 4, 5], startTime: '13:00', endTime: '22:00', styles: ['check', 'talk'], deposit: 10000 } },
  { name: '박준호', age: 26, avatar: '🧑', tags: ['#취준', '#토익', '#아침형'], bio: '아침 공부 같이 하실 분',
    template: { location: '경영관 3층 라운지', days: [2, 4, 6], startTime: '09:00', endTime: '18:00', styles: ['check'], deposit: 0 } },
  { name: '최서연', age: 22, avatar: '👧', tags: ['#전공공부', '#시험기간', '#ISTJ'], bio: '조용히 각자 공부해요',
    template: { location: '국민대 성곡도서관', days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00', styles: ['check', 'talk'], deposit: 5000 } },
  { name: '정민수', age: 23, avatar: '👦', tags: ['#코딩', '#프로젝트', '#ENTP'], bio: '끝나고 밥 먹어요 🍚',
    template: { location: '국민대 성곡도서관', days: [1, 3, 5, 6, 7], startTime: '13:00', endTime: '23:00', styles: ['talk', 'social'], deposit: 0 } },
  { name: '한유나', age: 25, avatar: '👩‍🎓', tags: ['#공시', '#꾸준함'], bio: '매일 조금씩!',
    template: { location: '북악관 1층 라운지', days: ALL, startTime: '10:00', endTime: '22:00', styles: ['check', 'talk', 'social'], deposit: 10000 } },
  { name: '오세훈', age: 21, avatar: '🧑‍💻', tags: ['#저녁공부', '#코테'], bio: '저녁에 코테 같이 풀어요',
    template: { location: '경영관 3층 라운지', days: [2, 4, 6, 7], startTime: '18:00', endTime: '24:00', styles: ['talk', 'social'], deposit: 0 } },
  { name: '윤하린', age: 23, avatar: '🙋‍♀️', tags: ['#열람실', '#자격증'], bio: '열람실에서 조용히 공부해요',
    template: { location: '복지관 3층 열람실', days: ALL, startTime: '06:00', endTime: '24:00', styles: ['check'], deposit: 0 } },
  { name: '강태민', age: 24, avatar: '🙋‍♂️', tags: ['#열람실', '#고시'], bio: '보증금 걸고 빡세게!',
    template: { location: '복지관 3층 열람실', days: ALL, startTime: '06:00', endTime: '24:00', styles: ['check', 'talk'], deposit: 10000 } },
];

const botEmail = (i) => `bot${i + 1}@studybuddy.local`;

export async function seedBots(db) {
  await db.tx(async (t) => {
    for (const [i, b] of BOTS.entries()) {
      const existing = await t.get('SELECT id FROM users WHERE email = ?', botEmail(i));
      if (existing) {
        await syncBot(t, existing.id, b);
        continue;
      }
      const { rows } = await t.run(
        `INSERT INTO users (email, password_hash, name, age, tags, bio, avatar, points, is_bot, bot_template, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?) RETURNING id`,
        botEmail(i), `!${crypto.randomBytes(8).toString('hex')}`, b.name, b.age,
        JSON.stringify(b.tags), b.bio, b.avatar, JSON.stringify(b.template), T.now().toISOString(),
      );
      await adjustPoints(t, rows[0].id, 1_000_000, '데모 메이트 포인트');
      await requeueBot(t, rows[0].id);
    }
  });
}

// 위 목록을 고치면 이미 만들어진 데모 메이트와 대기 중인 신청에도 반영한다.
// (진행 중인 매칭은 건드리지 않고, 끝난 뒤 새 템플릿으로 다시 대기한다.)
async function syncBot(db, id, b) {
  const t = b.template;
  await db.run('UPDATE users SET name = ?, age = ?, tags = ?, bio = ?, avatar = ?, bot_template = ? WHERE id = ?',
    b.name, b.age, JSON.stringify(b.tags), b.bio, b.avatar, JSON.stringify(t), id);
  await db.run(
    `UPDATE match_requests SET location = ?, days = ?, start_time = ?, end_time = ?, styles = ?
     WHERE user_id = ? AND status = 'pending'`,
    t.location, JSON.stringify(t.days), t.startTime, t.endTime, JSON.stringify(t.styles), id,
  );
}
