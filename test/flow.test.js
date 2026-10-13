import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';

// 같은 테스트를 SQLite(로컬·데모)와 PostgreSQL(실서비스, PGlite로 대체)에서 모두 돌린다.
const DRIVERS = {
  sqlite: () => openSqlite(':memory:'),
  postgres: () => openPglite(),
};

const baseReq = {
  days: [1, 3, 5], startTime: '19:00', endTime: '22:00', location: '국민대 성곡도서관', styles: ['check'], deposit: 0,
};

test('compatibility: 장소·요일·시간·스타일·보증금 조건', () => {
  const a = { ...baseReq, days: [1, 3], start_time: '18:00', end_time: '21:00' };
  const b = { ...baseReq, days: [3, 5], start_time: '19:00', end_time: '23:00', styles: ['check', 'talk'] };
  const c = S.compatibility(a, b);
  assert.deepEqual(c.days, [3]);
  assert.equal(c.startTime, '19:00');
  assert.equal(c.endTime, '21:00');
  assert.deepEqual(c.styles, ['check']);

  assert.equal(S.compatibility(a, { ...b, location: '정릉 근처 카페' }), null);
  assert.equal(S.compatibility(a, { ...b, days: [2] }), null);
  assert.equal(S.compatibility(a, { ...b, start_time: '20:30' }), null, '겹치는 시간 1시간 미만');
  assert.equal(S.compatibility(a, { ...b, styles: ['social'] }), null);
  assert.equal(S.compatibility(a, { ...b, deposit: 5000 }), null, '보증금 사용 여부 불일치');
});

test('신청 검증', () => {
  assert.throws(() => S.validateRequest({ ...baseReq, days: [] }), /요일/);
  assert.throws(() => S.validateRequest({ ...baseReq, endTime: '19:30' }), /1시간/);
  assert.throws(() => S.validateRequest({ ...baseReq, styles: ['x'] }), /스타일/);
  assert.throws(() => S.validateRequest({ ...baseReq, deposit: 777 }), /보증금/);
});

test('한국 시간 기준 날짜 계산 (서버가 UTC여도)', () => {
  setNow(kst(2026, 10, 12, 0, 30)); // 한국 월요일 00:30 = UTC 일요일 15:30
  const week = S.planWeek([1], '09:00', '10:00');
  assert.equal(week.weekStart, '2026-10-12');
  assert.deepEqual(week.dates, ['2026-10-12']);
  setNow(null);
});

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(name, () => {
    let db;
    beforeEach(async () => {
      setNow(kst(2026, 10, 12, 9, 0)); // 2026-10-12 월요일 09:00 KST
      db = await open();
    });
    afterEach(async () => {
      setNow(null);
      await db.close?.();
    });

    const signup = async (n) => (await S.signup(db, { email: `${n}@test.dev`, password: 'secret1', name: n, age: 22 })).user.id;
    const points = async (id) => (await S.homeState(db, id)).user.points;

    test('전체 흐름: 매칭 → 출석 → 정산(보증금 이전) → 계속하기', async () => {
      const a = await signup('a');
      const b = await signup('b');

      const r1 = await S.createRequest(db, a, { ...baseReq, deposit: 10000 });
      assert.equal(r1.matchId, null);
      assert.equal(await points(a), 40000);

      // 금액이 다르면 낮은 쪽(5000)에 맞추고 차액 반환
      const r2 = await S.createRequest(db, b, { ...baseReq, deposit: 5000 });
      assert.ok(r2.matchId);
      assert.equal(await points(a), 45000);
      assert.equal(await points(b), 45000);

      const m = await S.currentMatch(db, a);
      assert.equal(m.stake, 5000);
      assert.deepEqual(m.appointments.map((x) => x.date), ['2026-10-12', '2026-10-14', '2026-10-16']);
      assert.equal(m.mate.name, 'b');

      // 출석 가능 시간 전에는 거절
      await assert.rejects(S.checkIn(db, a, m.appointments[0].id, { method: 'self' }), /출석은/);

      // A는 세 번 모두 출석(QR), B는 첫 날만 출석
      for (const [i, appt] of m.appointments.entries()) {
        setNow(kst(2026, 10, 12 + i * 2, 19, 0));
        await assert.rejects(S.checkIn(db, a, appt.id, { method: 'qr', code: 'WRONG1' }), /일치하지/);
        await S.checkIn(db, a, appt.id, { method: 'qr', code: appt.code });
        await assert.rejects(S.checkIn(db, a, appt.id, { method: 'self' }), /이미 출석/);
        if (i === 0) await S.checkIn(db, b, appt.id, { method: 'self' });
        setNow(kst(2026, 10, 12 + i * 2, 21, 30));
        assert.equal((await S.checkOut(db, a, appt.id)).minutes, 150);
      }

      // 주간이 끝나면 자동 정산
      setNow(kst(2026, 10, 19, 9, 0));
      const reported = await S.currentMatch(db, a);
      assert.equal(reported.status, 'reported');
      assert.equal(reported.report.me.rate, 100);
      assert.equal(reported.report.me.minutes, 450);
      assert.equal(reported.report.me.deposit.result, 'refunded');
      assert.equal(reported.report.mate.deposit.result, 'to_mate');
      assert.equal(reported.report.mate.attended, 1);
      // B는 체크아웃을 안 했으므로 약속 종료 시각까지로 계산 (19:00~22:00)
      assert.equal(reported.report.mate.minutes, 180);

      assert.equal(await points(a), 45000 + 5000 + 5000);
      assert.equal(await points(b), 45000);

      // 정산은 한 번만 (크론과 조회가 겹쳐도)
      assert.equal(await S.autoSettle(db), 0);
      await S.settleMatch(db, m.id);
      assert.equal(await points(a), 55000);

      // 둘 다 계속하기 → 새 주간 생성, 보증금 재예치
      assert.equal((await S.chooseNext(db, a, m.id, 'continue')).next, 'waiting');
      const next = await S.chooseNext(db, b, m.id, 'continue');
      assert.equal(next.next, 'continue');
      const m2 = await S.currentMatch(db, a);
      assert.equal(m2.id, next.matchId);
      assert.equal(m2.round, 2);
      assert.equal(m2.stake, 5000);
      assert.equal(await points(a), 50000);
      assert.equal((await S.matchHistory(db, a)).length, 1);
    });

    test('새 메이트 선택 시 매칭 종료, 다시 신청 가능', async () => {
      const a = await signup('a');
      const b = await signup('b');
      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      await assert.rejects(S.createRequest(db, a, baseReq), /진행 중/);
      await S.settleMatch(db, matchId);
      assert.equal((await S.chooseNext(db, a, matchId, 'new')).next, 'new');
      assert.equal(await S.currentMatch(db, a), null);
      assert.equal(await S.currentMatch(db, b), null);
      await S.createRequest(db, a, baseReq);
      await assert.rejects(S.createRequest(db, a, baseReq), /대기 중/);
    });

    test('세 명이 동시에 신청해도 한 쌍만 매칭', async () => {
      const [a, b, c] = [await signup('a'), await signup('b'), await signup('c')];
      await S.createRequest(db, a, baseReq);
      const results = await Promise.all([
        S.createRequest(db, b, baseReq),
        S.createRequest(db, c, baseReq),
      ]);
      assert.equal(results.filter((r) => r.matchId).length, 1);
      assert.equal(results.filter((r) => r.request).length, 1, '나머지 한 명은 대기');
    });

    test('신청 취소 시 보증금 반환, 다른 사람 매칭 접근 차단', async () => {
      const [a, b, c] = [await signup('a'), await signup('b'), await signup('c')];
      await S.createRequest(db, a, { ...baseReq, deposit: 20000 });
      await S.cancelRequest(db, a);
      assert.equal(await points(a), 50000);

      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      await assert.rejects(S.listMessages(db, c, matchId), /찾을 수 없어요/);
      await S.sendMessage(db, a, matchId, '안녕하세요');
      const msgs = await S.listMessages(db, b, matchId);
      assert.equal(msgs.length, 1);
      assert.equal(msgs[0].userId, a);
    });

    test('로그인 / 토큰', async () => {
      await signup('a');
      await assert.rejects(S.signup(db, { email: 'a@test.dev', password: 'secret1', name: 'x' }), /이미 가입/);
      await assert.rejects(S.login(db, { email: 'a@test.dev', password: 'nope' }), /올바르지/);
      const { token } = await S.login(db, { email: 'A@test.dev', password: 'secret1' });
      assert.equal((await S.userByToken(db, token)).name, 'a');
      await S.logout(db, token);
      assert.equal(await S.userByToken(db, token), null);
    });
  });
}
