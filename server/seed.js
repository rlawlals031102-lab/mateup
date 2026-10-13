import crypto from 'node:crypto';
import { tx } from './db.js';
import { requeueBot, adjustPoints } from './service.js';
import * as T from './time.js';

// 데모용 메이트. 사용자가 매칭을 신청하면 이 중 조건이 맞는 메이트와 연결된다.
const ALL = [1, 2, 3, 4, 5, 6, 7];
export const BOTS = [
  { name: '이지은', age: 24, avatar: '👩', tags: ['#카페공부', '#자격증준비', '#ENFJ'], bio: '카페에서 집중이 잘 돼요!',
    template: { location: '강남역 근처 스터디 카페', days: [1, 3, 4, 5], startTime: '13:00', endTime: '22:00', styles: ['check', 'talk'], deposit: 10000 } },
  { name: '박준호', age: 26, avatar: '🧑', tags: ['#취준', '#토익', '#아침형'], bio: '아침 공부 같이 하실 분',
    template: { location: '강남역 근처 스터디 카페', days: [2, 4, 6], startTime: '09:00', endTime: '18:00', styles: ['check'], deposit: 0 } },
  { name: '최서연', age: 22, avatar: '👧', tags: ['#전공공부', '#시험기간', '#ISTJ'], bio: '조용히 각자 공부해요',
    template: { location: '국민대 성곡도서관', days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00', styles: ['check', 'talk'], deposit: 5000 } },
  { name: '정민수', age: 23, avatar: '👦', tags: ['#코딩', '#프로젝트', '#ENTP'], bio: '끝나고 밥 먹어요 🍚',
    template: { location: '국민대 성곡도서관', days: [1, 3, 5, 6, 7], startTime: '13:00', endTime: '23:00', styles: ['talk', 'social'], deposit: 0 } },
  { name: '한유나', age: 25, avatar: '👩‍🎓', tags: ['#공시', '#꾸준함'], bio: '매일 조금씩!',
    template: { location: '국민대 북악관 라운지', days: ALL, startTime: '10:00', endTime: '22:00', styles: ['check', 'talk', 'social'], deposit: 10000 } },
  { name: '오세훈', age: 21, avatar: '🧑‍💻', tags: ['#새벽공부', '#코테'], bio: '밤샘 코테 메이트 구해요',
    template: { location: '홍대입구역 스터디 카페', days: [2, 4, 6, 7], startTime: '18:00', endTime: '24:00', styles: ['talk', 'social'], deposit: 0 } },
  { name: '윤하린', age: 23, avatar: '🙋‍♀️', tags: ['#캠스터디', '#자격증'], bio: '캠 켜고 조용히 공부해요',
    template: { location: '온라인 (캠스터디)', days: ALL, startTime: '06:00', endTime: '24:00', styles: ['check'], deposit: 0 } },
  { name: '강태민', age: 24, avatar: '🙋‍♂️', tags: ['#캠스터디', '#고시'], bio: '보증금 걸고 빡세게!',
    template: { location: '온라인 (캠스터디)', days: ALL, startTime: '06:00', endTime: '24:00', styles: ['check', 'talk'], deposit: 10000 } },
];

export function seedBots(db) {
  if (db.prepare('SELECT 1 FROM users WHERE is_bot = 1').get()) return;
  tx(db, () => {
    BOTS.forEach((b, i) => {
      const { lastInsertRowid } = db.prepare(
        `INSERT INTO users (email, password_hash, name, age, tags, bio, avatar, points, is_bot, bot_template, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
      ).run(`bot${i + 1}@studybuddy.local`, `!${crypto.randomBytes(8).toString('hex')}`, b.name, b.age,
        JSON.stringify(b.tags), b.bio, b.avatar, JSON.stringify(b.template), T.now().toISOString());
      adjustPoints(db, Number(lastInsertRowid), 1_000_000, '데모 메이트 포인트');
      requeueBot(db, Number(lastInsertRowid));
    });
  });
}
