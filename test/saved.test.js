// 소셜 3단계: 메이트 저장(즐겨찾기) + 친구면 끝난 매칭도 채팅 유지.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';

const DRIVERS = { sqlite: () => openSqlite(':memory:'), postgres: () => openPglite() };
const iso = () => new Date().toISOString();

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(`saved+chat/${name}`, () => {
    let db;
    beforeEach(async () => { setNow(kst(2026, 10, 31, 9, 0)); db = await open(); });
    afterEach(async () => { setNow(null); await db.close?.(); });

    const signup = (phone, nm) => S.signupPhone(db, { phone, pin: '1234', name: nm }, {});
    async function matchedPair() {
      const { user: a } = await signup('010-1000-0001', '에이');
      const { user: b } = await signup('010-2000-0002', '비');
      await db.run(
        `INSERT INTO matches (user_a, user_b, days, start_time, end_time, location, styles, week_start, week_end, status, created_at)
         VALUES (?, ?, '["mon"]', '19:00', '21:00', '강의실', '["check"]', '2026-10-26', '2026-11-01', 'active', ?)`,
        a.id, b.id, iso());
      const m = await db.get('SELECT id FROM matches LIMIT 1');
      return [a, b, m.id];
    }
    async function befriend(a, b) {
      await S.sendFriendRequest(db, a.id, b.id);
      await S.respondFriendRequest(db, b.id, a.id, true);
    }

    test('메이트 저장: 함께 공부한 메이트만, 저장/해제/목록', async () => {
      const [a, b] = await matchedPair();
      const { user: c } = await signup('010-3000-0003', '씨'); // 매칭 이력 없음
      await assert.rejects(S.saveMate(db, a.id, c.id), /함께 공부한 메이트/);

      assert.equal((await S.saveMate(db, a.id, b.id)).saved, true);
      assert.equal((await S.listSavedMates(db, a.id))[0].id, b.id);
      const prof = await S.publicProfile(db, b.id, a.id);
      assert.equal(prof.saved, true);
      assert.equal(prof.canSave, true);

      await S.unsaveMate(db, a.id, b.id);
      assert.equal((await S.listSavedMates(db, a.id)).length, 0);
      assert.equal((await S.publicProfile(db, b.id, a.id)).saved, false);
    });

    test('친구면 끝난 매칭도 채팅 유지 (비친구는 종료)', async () => {
      const [a, b, mid] = await matchedPair();
      await db.run("UPDATE matches SET status = 'closed' WHERE id = ?", mid);

      // 비친구: 종료된 매칭 → 발신 불가, 채팅 목록에 없음
      await assert.rejects(S.sendMessage(db, a.id, mid, '안녕'), /종료된 매칭/);
      assert.equal((await S.chatThreads(db, a.id, {})).length, 0);

      // 친구가 되면: 발신 가능, 채팅 목록에 뜨고, 상대 안 읽은 수에 포함
      await befriend(a, b);
      await S.sendMessage(db, a.id, mid, '끝나도 얘기하자');
      const threads = await S.chatThreads(db, a.id, {});
      assert.equal(threads.length, 1, '친구 채팅방이 목록에 뜬다');
      assert.equal(threads[0].mate.id, b.id);

      const prof = await S.publicProfile(db, b.id, a.id);
      assert.equal(prof.chatMatchId, mid, '친구 프로필에 채팅방 id');

      const unread = await S.unreadCounts(db, b.id);
      assert.ok(unread.total >= 1, '친구 채팅 안 읽음 포함');
    });
  });
}
