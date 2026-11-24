// 소셜 1단계: 친구(함께 매칭했던 메이트 한정)·차단·알림.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';

const DRIVERS = { sqlite: () => openSqlite(':memory:'), postgres: () => openPglite() };
const iso = () => new Date().toISOString();

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(`social/${name}`, () => {
    let db;
    beforeEach(async () => { setNow(kst(2026, 10, 31, 9, 0)); db = await open(); });
    afterEach(async () => { setNow(null); await db.close?.(); });

    const signup = (phone, nm) => S.signupPhone(db, { phone, pin: '1234', name: nm }, {});
    const makeMatch = (a, b) => db.run(
      `INSERT INTO matches (user_a, user_b, days, start_time, end_time, location, styles, week_start, week_end, created_at)
       VALUES (?, ?, '["mon"]', '19:00', '21:00', '강의실', '["check"]', '2026-10-26', '2026-11-01', ?)`,
      a, b, iso());

    async function twoMates() {
      const { user: a } = await signup('010-1000-0001', '에이');
      const { user: b } = await signup('010-2000-0002', '비');
      await makeMatch(a.id, b.id);
      return [a, b];
    }

    test('친구 요청은 함께 매칭했던 메이트에게만', async () => {
      const { user: a } = await signup('010-1000-0001', '에이');
      const { user: c } = await signup('010-3000-0003', '씨'); // 매칭 이력 없음
      await assert.rejects(S.sendFriendRequest(db, a.id, c.id), /함께 공부한 메이트/);

      const { user: b } = await signup('010-2000-0002', '비');
      await makeMatch(a.id, b.id);
      const r = await S.sendFriendRequest(db, a.id, b.id);
      assert.equal(r.state, 'sent');
    });

    test('수락하면 양방향 친구가 되고 허브에 반영된다', async () => {
      const [a, b] = await twoMates();
      await S.sendFriendRequest(db, a.id, b.id);

      const bHub = await S.socialOverview(db, b.id);
      assert.equal(bHub.incoming.length, 1, 'B에게 받은 요청 1');
      assert.equal(bHub.incoming[0].id, a.id);

      await S.respondFriendRequest(db, b.id, a.id, true);
      const aFriends = await S.listFriends(db, a.id);
      const bFriends = await S.listFriends(db, b.id);
      assert.equal(aFriends[0].id, b.id, 'A의 친구에 B');
      assert.equal(bFriends[0].id, a.id, 'B의 친구에 A');

      // 프로필 관계상태
      const prof = await S.publicProfile(db, b.id, a.id);
      assert.equal(prof.rel, 'friends');
    });

    test('거절하면 친구가 아니다', async () => {
      const [a, b] = await twoMates();
      await S.sendFriendRequest(db, a.id, b.id);
      await S.respondFriendRequest(db, b.id, a.id, false);
      assert.equal((await S.listFriends(db, a.id)).length, 0);
      const prof = await S.publicProfile(db, b.id, a.id);
      assert.equal(prof.rel, 'none');
      assert.equal(prof.canRequest, true, '거절 후 다시 요청 가능');
    });

    test('역요청이 와 있으면 바로 친구가 된다 (자동 수락)', async () => {
      const [a, b] = await twoMates();
      await S.sendFriendRequest(db, a.id, b.id); // A→B
      const r = await S.sendFriendRequest(db, b.id, a.id); // B→A → 자동 수락
      assert.equal(r.state, 'friends');
      assert.equal((await S.listFriends(db, a.id)).length, 1);
    });

    test('차단하면 친구·대기요청이 정리되고 요청이 막힌다', async () => {
      const [a, b] = await twoMates();
      await S.sendFriendRequest(db, a.id, b.id);
      await S.respondFriendRequest(db, b.id, a.id, true); // 친구

      await S.blockUser(db, a.id, b.id);
      assert.equal((await S.listFriends(db, a.id)).length, 0, '친구 해제됨');
      assert.equal((await S.listBlocked(db, a.id))[0].id, b.id, '차단 목록에 B');

      // 차단 중엔 요청 불가(차단한 쪽)
      await assert.rejects(S.sendFriendRequest(db, a.id, b.id), /차단/);
      // 차단당한 B 가 A 프로필을 보면 숨겨진다(404)
      await assert.rejects(S.publicProfile(db, a.id, b.id), /찾을 수 없/);
      // A 가 B 프로필을 보면 'blocked' 상태
      const prof = await S.publicProfile(db, b.id, a.id);
      assert.equal(prof.rel, 'blocked');

      await S.unblockUser(db, a.id, b.id);
      assert.equal((await S.listBlocked(db, a.id)).length, 0, '차단 해제');
    });

    test('알림: 요청 받으면 friend_request, 수락되면 friend_accepted', async () => {
      const [a, b] = await twoMates();
      await S.sendFriendRequest(db, a.id, b.id);
      let bNotis = await S.listNotifications(db, b.id);
      assert.equal(bNotis[0].type, 'friend_request');
      assert.equal(bNotis[0].actor.id, a.id);
      assert.equal(await S.unreadNotificationCount(db, b.id), 1);

      await S.respondFriendRequest(db, b.id, a.id, true);
      const aNotis = await S.listNotifications(db, a.id);
      assert.equal(aNotis[0].type, 'friend_accepted');

      await S.markNotificationsRead(db, b.id);
      assert.equal(await S.unreadNotificationCount(db, b.id), 0, '읽음 처리');
    });

    test('지난 메이트 후보에는 친구·차단이 빠진다. 봇에겐 요청 불가', async () => {
      const [a, b] = await twoMates();
      let mates = await S.listPastMates(db, a.id);
      assert.equal(mates.length, 1, '아직 친구 아님 → 후보에 B');
      assert.equal(mates[0].rel, 'none');

      await S.sendFriendRequest(db, a.id, b.id);
      await S.respondFriendRequest(db, b.id, a.id, true);
      mates = await S.listPastMates(db, a.id);
      assert.equal(mates.length, 0, '친구가 되면 후보에서 빠진다');

      // 봇 메이트에겐 친구 요청 불가
      const bot = await db.get("SELECT id FROM users WHERE is_bot = 1 LIMIT 1");
      if (bot) {
        await makeMatch(a.id, bot.id);
        await assert.rejects(S.sendFriendRequest(db, a.id, bot.id), /체험용|메이트에게는/);
      }
    });
  });
}
