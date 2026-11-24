// 프로필: 닉네임(공개) + 실명(비공개, 본인만), 선호 스타일(공개), 공개 프로필 + 긍정 지표만.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';

const DRIVERS = { sqlite: () => openSqlite(':memory:'), postgres: () => openPglite() };
const iso = () => new Date().toISOString();

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(`profile/${name}`, () => {
    let db;
    beforeEach(async () => { setNow(kst(2026, 10, 31, 9, 0)); db = await open(); });
    afterEach(async () => { setNow(null); await db.close?.(); });

    const signup = (phone, nm) => S.signupPhone(db, { phone, pin: '1234', name: nm }, {});

    test('실명은 본인(privateUser)만, 공개 프로필엔 안 나온다. 닉네임·스타일은 공개', async () => {
      const { user } = await signup('010-1234-5678', '빈이');
      const saved = await S.updateProfile(db, user.id, { realName: '나윤빈', studyStyle: 'talk', bio: '같이 공부해요' });
      // 본인 화면(privateUser)
      assert.equal(saved.realName, '나윤빈');
      assert.equal(saved.studyStyle, 'talk');

      // 공개 프로필(남이 보는 화면)
      const pub = (await S.publicProfile(db, user.id));
      assert.equal(pub.name, '빈이');
      assert.equal(pub.studyStyle, 'talk', '선호 스타일은 공개');
      assert.equal(pub.bio, '같이 공부해요');
      assert.equal(pub.realName, undefined, '실명은 공개 프로필에 없음');
      assert.equal(pub.department, undefined, '학과는 공개 프로필에 없음');
      assert.equal(pub.phone, undefined, '전화번호는 공개 프로필에 없음');
      assert.equal(pub.email, undefined, '이메일은 공개 프로필에 없음');
      assert.ok(pub.stats, '긍정 지표 포함');
    });

    test('긍정 지표: 지킨 약속·누적 공부시간·함께한 메이트 수', async () => {
      const { user: a } = await signup('010-1000-0001', '에이');
      const { user: b } = await signup('010-2000-0002', '비');

      await db.run(
        `INSERT INTO matches (user_a, user_b, days, start_time, end_time, location, styles, week_start, week_end, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        a.id, b.id, '["mon"]', '19:00', '21:00', '강의실', '["check"]', '2026-10-26', '2026-11-01', iso(),
      );
      const m = await db.get('SELECT id FROM matches LIMIT 1');
      for (const [date, mins] of [['2026-10-27', 60], ['2026-10-28', 90]]) {
        await db.run('INSERT INTO appointments (match_id, date, start_time, end_time, code) VALUES (?, ?, ?, ?, ?)',
          m.id, date, '19:00', '21:00', 'X');
        const ap = await db.get('SELECT id FROM appointments WHERE date = ?', date);
        await db.run('INSERT INTO attendance (appointment_id, user_id, method, checked_in_at, minutes) VALUES (?, ?, ?, ?, ?)',
          ap.id, a.id, 'self', iso(), mins);
      }

      const pub = await S.publicProfile(db, a.id);
      assert.equal(pub.stats.kept, 2, '출석(지킨 약속) 2회');
      assert.equal(pub.stats.minutes, 150, '누적 공부시간 60+90');
      assert.equal(pub.stats.mates, 1, '함께한 메이트 1명');

      // 아직 기록 없는 사람은 0으로 깔끔하게
      const pubB = await S.publicProfile(db, b.id);
      assert.deepEqual(pubB.stats, { kept: 0, minutes: 0, mates: 1 });
    });

    test('실명은 20자 이내, 선호 스타일은 정해진 값만, 비우면 지운다', async () => {
      const { user } = await signup('010-3000-0003', '씨');
      await assert.rejects(S.updateProfile(db, user.id, { realName: '가'.repeat(21) }), /20자/);
      await assert.rejects(S.updateProfile(db, user.id, { studyStyle: 'nope' }), /스타일/);

      await S.updateProfile(db, user.id, { realName: '김철수', studyStyle: 'social' });
      const cleared = await S.updateProfile(db, user.id, { realName: '', studyStyle: '' });
      assert.equal(cleared.realName, null, '실명 비우면 지워짐');
      assert.equal(cleared.studyStyle, null, '스타일 비우면 지워짐');
    });

    test('없는 사용자·탈퇴한 사용자의 공개 프로필은 404', async () => {
      await assert.rejects(S.publicProfile(db, 999999), /찾을 수 없/);
      const { user } = await signup('010-4000-0004', '디');
      await db.run('UPDATE users SET deleted_at = ? WHERE id = ?', iso(), user.id);
      await assert.rejects(S.publicProfile(db, user.id), /찾을 수 없/);
    });
  });
}
