import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';
import { PROMISE_RULE } from '../server/options.js';

// 같은 테스트를 SQLite(로컬·데모)와 PostgreSQL(실서비스, PGlite로 대체)에서 모두 돌린다.
const DRIVERS = {
  sqlite: () => openSqlite(':memory:'),
  postgres: () => openPglite(),
};

// 스터디 기간: 2026-11-10(화) ~ 11-12(목) 19:00~21:00 고정. 이 중 원하는 날짜(요일 2·3·4)를 고른다.
// 장소는 '채팅으로 정하기' / '지정 강의실 (경상관 102A)'.
const ROOM = '지정 강의실 (경상관 102A)';
const baseReq = { days: [2, 3, 4], location: ROOM, styles: ['check'] };
const STUDY_DATES = ['2026-11-10', '2026-11-11', '2026-11-12'];

test('compatibility: 장소·요일·시간·스타일 조건', () => {
  const a = { ...baseReq, days: [1, 3], start_time: '18:00', end_time: '21:00' };
  const b = { ...baseReq, days: [3, 5], start_time: '19:00', end_time: '23:00', styles: ['check', 'talk'] };
  const c = S.compatibility(a, b);
  assert.deepEqual(c.days, [3]);
  assert.equal(c.startTime, '19:00');
  assert.equal(c.endTime, '21:00');
  assert.deepEqual(c.styles, ['check']);

  assert.equal(S.compatibility(a, { ...b, location: '채팅으로 정하기' }), null);
  assert.equal(S.compatibility(a, { ...b, days: [2] }), null);
  assert.equal(S.compatibility(a, { ...b, start_time: '20:30' }), null, '겹치는 시간 1시간 미만');
  assert.equal(S.compatibility(a, { ...b, styles: ['social'] }), null);

  // 장소 여러 개: 하나라도 겹치면 매칭, 겹치는 게 여럿이면 강의실 우선
  const both = { locations: ['채팅으로 정하기', ROOM] };
  assert.equal(S.compatibility({ ...a, ...both }, b).location, ROOM);
  assert.equal(S.compatibility({ ...a, ...both }, { ...b, location: '채팅으로 정하기' }).location, '채팅으로 정하기');
  assert.equal(S.compatibility({ ...a, ...both }, { ...b, ...both }).location, ROOM);
});

test('신청 검증: 장소는 여러 개 고를 수 있음', () => {
  setNow(kst(2026, 10, 31, 9, 0));
  const r = S.validateRequest({ ...baseReq, location: undefined, locations: [ROOM, '채팅으로 정하기'] });
  assert.deepEqual(r.locations, ['채팅으로 정하기', ROOM]);
  assert.throws(() => S.validateRequest({ ...baseReq, location: undefined, locations: [] }), /장소/);
  assert.throws(() => S.validateRequest({ ...baseReq, location: undefined, locations: [ROOM, '국민대 성곡도서관'] }), /장소/);
  setNow(null);
});

test('신청 검증: 화·수·목 중 원하는 날짜, 시간은 19~21시 고정, 보증금 없음', () => {
  setNow(kst(2026, 10, 31, 9, 0));
  assert.throws(() => S.validateRequest({ ...baseReq, location: '국민대 성곡도서관' }), /장소/);
  assert.throws(() => S.validateRequest({ ...baseReq, styles: ['x'] }), /스타일/);
  assert.throws(() => S.validateRequest({ ...baseReq, days: [] }), /하나 이상/);
  assert.throws(() => S.validateRequest({ ...baseReq, days: [1, 2] }), /스터디 날짜 중에서/);
  // 보증금은 무시, 칸을 안 보내면 고른 날짜의 19~21시 전체
  const r = S.validateRequest({ ...baseReq, days: [4, 2, 2], deposit: 20000 });
  assert.deepEqual([r.days, r.startTime, r.endTime, r.deposit], [[2, 4], '19:00', '21:00', 0]);
  assert.deepEqual(r.cells, ['2-7', '2-8', '4-7', '4-8']);
  // 1시간 칸만 고를 수 있고, 스터디 시간 밖의 칸은 버린다
  const one = S.validateRequest({ ...baseReq, days: [2, 4], cells: ['2-8', '4-7', '1-0'] });
  assert.deepEqual([one.days, one.cells, one.startTime, one.endTime], [[2, 4], ['2-8', '4-7'], '19:00', '21:00']);
  assert.throws(() => S.validateRequest({ ...baseReq, days: [2], cells: ['1-0'] }), /시간을/);
  // 이미 지난 날짜는 못 고름, 마지막 약속이 끝나면 신청 마감
  setNow(kst(2026, 11, 10, 21, 0));
  assert.throws(() => S.validateRequest(baseReq), /지난 날짜/);
  assert.doesNotThrow(() => S.validateRequest({ ...baseReq, days: [3, 4] }));
  setNow(kst(2026, 11, 12, 21, 0));
  assert.throws(() => S.validateRequest(baseReq), /끝나서/);
  setNow(null);
});

test('11/1(일)은 스터디 날짜가 아님', () => {
  setNow(kst(2026, 11, 1, 11, 0));
  assert.throws(() => S.validateRequest({ ...baseReq, days: [7] }), /스터디 날짜 중에서/);
  setNow(null);
});

test('약속 날짜: 한국 시간 기준으로 끝나지 않은 스터디 날짜만', () => {
  setNow(kst(2026, 11, 10, 0, 30)); // 한국 화요일 00:30 = UTC 월요일 15:30
  assert.deepEqual(S.planStudy().dates.map((d) => d.date), STUDY_DATES);
  setNow(kst(2026, 11, 10, 21, 0)); // 첫날 약속이 끝남
  const p = S.planStudy();
  assert.deepEqual(p.dates.map((d) => d.date), ['2026-11-11', '2026-11-12']);
  assert.deepEqual([p.weekStart, p.weekEnd], ['2026-11-10', '2026-11-12']);
  // 두 사람이 함께 고른 요일만
  assert.deepEqual(S.planStudy([{ day: 3 }]).dates.map((d) => d.date), ['2026-11-11']);
  setNow(kst(2026, 11, 12, 21, 0));
  assert.throws(() => S.planStudy(), /끝났어요/);
  setNow(null);
});

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(name, () => {
    let db;
    beforeEach(async () => {
      setNow(kst(2026, 10, 31, 9, 0)); // 2026-10-31 토요일 09:00 KST (스터디 기간 전)
      db = await open();
    });
    afterEach(async () => {
      setNow(null);
      await db.close?.();
    });

    const signup = async (n) => (await S.signup(db, {
      email: `${n}@test.dev`, password: 'secret1', name: n, department: '경영정보학부', phone: '010-1234-5678',
    })).user.id;

    // 약속 지키기 시작일(PROMISE_RULE.from)을 테스트 안에서만 바꿔 본다.
    const withRuleFrom = async (from, fn) => {
      const saved = PROMISE_RULE.from;
      PROMISE_RULE.from = from;
      try { await fn(); } finally { PROMISE_RULE.from = saved; }
    };

    test('전체 흐름: 매칭 → 출석 → 정산 (보증금 없음)', () => withRuleFrom('2099-01-01', async () => {
      const a = await signup('a');
      const b = await signup('b');

      const r1 = await S.createRequest(db, a, baseReq);
      assert.equal(r1.matchId, null);
      const r2 = await S.createRequest(db, b, baseReq);
      assert.ok(r2.matchId);

      const m = await S.currentMatch(db, a);
      assert.equal(m.stake, 0);
      assert.deepEqual(m.appointments.map((x) => [x.date, x.startTime, x.endTime]),
        STUDY_DATES.map((d) => [d, '19:00', '21:00']));
      assert.deepEqual(m.week.map((d) => d.date), STUDY_DATES, '주간 표시는 스터디 3일');
      assert.equal(m.mate.name, 'b');

      // 출석 가능 시간 전에는 거절
      await assert.rejects(S.checkIn(db, a, m.appointments[0].id, { method: 'self' }), /출석은/);

      // A는 세 번 모두 출석(B가 A의 QR·코드로 확인), B는 첫 날만 출석(A가 B의 코드로 확인)
      const bView = await S.currentMatch(db, b);
      for (const [i, appt] of m.appointments.entries()) {
        setNow(kst(2026, 11, 10 + i, 19, 0));
        await assert.rejects(S.confirmMate(db, b, appt.id, 'WRONG1'), /맞지 않아요/);
        await S.confirmMate(db, b, appt.id, appt.myCode);
        await assert.rejects(S.confirmMate(db, b, appt.id, appt.myCode), /이미 확인/);
        if (i === 0) await S.confirmMate(db, a, appt.id, bView.appointments[0].myCode);
        setNow(kst(2026, 11, 10 + i, 21, 30));
        assert.equal((await S.checkOut(db, a, appt.id)).minutes, 120);
      }

      // 마지막 날 다음 날 자동 정산
      setNow(kst(2026, 11, 13, 9, 0));
      const reported = await S.currentMatch(db, a);
      assert.equal(reported.status, 'reported');
      assert.equal(reported.report.me.rate, 100);
      assert.equal(reported.report.me.minutes, 360);
      assert.equal(reported.report.me.deposit.result, 'none');
      assert.equal(reported.report.mate.attended, 1);
      // B는 체크아웃을 안 했으므로 약속 종료 시각까지로 계산 (19:00~21:00)
      assert.equal(reported.report.mate.minutes, 120);
      assert.equal((await S.strikeStatus(db, b)).count, 0, '약속 지키기 규칙 시작일 전 약속은 세지 않음');

      // 정산은 한 번만 (크론과 조회가 겹쳐도)
      assert.equal(await S.autoSettle(db), 0);
      await S.settleMatch(db, m.id);

      // 스터디 기간이 끝나서 같은 메이트와 계속할 수는 없음 → 새 메이트는 고를 수 있음
      await S.chooseNext(db, a, m.id, 'continue');
      await assert.rejects(S.chooseNext(db, b, m.id, 'continue'), /끝났어요/);
      assert.equal((await S.chooseNext(db, b, m.id, 'new')).next, 'new');
      assert.equal((await S.matchHistory(db, a)).length, 1);
    }));

    test('새 메이트 선택 시 매칭 종료, 다시 신청 가능', async () => {
      const a = await signup('a');
      const b = await signup('b');
      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      await assert.rejects(S.createRequest(db, a, baseReq), /이미 신청했거나 매칭/);
      await S.settleMatch(db, matchId);
      assert.equal((await S.chooseNext(db, a, matchId, 'new')).next, 'new');
      assert.equal(await S.currentMatch(db, a), null);
      assert.equal(await S.currentMatch(db, b), null);
      await S.createRequest(db, a, baseReq);
      await assert.rejects(S.createRequest(db, a, { ...baseReq, location: '채팅으로 정하기' }), /이미 신청했거나 매칭/, '한 사람 한 신청');
    });

    test('날짜 고르기: 함께 고른 날짜만 약속, 다른 날짜로 추가 신청 가능', async () => {
      const [a, b, c] = [await signup('a'), await signup('b'), await signup('c')];
      await S.createRequest(db, a, { ...baseReq, days: [2, 3] }); // 화·수
      assert.equal((await S.createRequest(db, b, { ...baseReq, days: [4] })).matchId, null, '겹치는 날이 없으면 대기');
      const { matchId } = await S.createRequest(db, c, { ...baseReq, days: [3, 4] }); // 수·목 → a와 수요일
      const m = await S.matchById(db, c, matchId);
      assert.equal(m.mate.name, 'a');
      assert.deepEqual(m.appointments.map((x) => x.date), ['2026-11-11']);
      assert.deepEqual(m.schedule, [{ day: 3, start: '19:00', end: '21:00' }]);

      // a는 수요일이 매칭됐으니 수요일은 다시 못 고르고, 목요일은 추가로 신청 가능 → 기다리던 b와 매칭
      await assert.rejects(S.createRequest(db, a, { ...baseReq, days: [3] }), /이미 신청했거나 매칭/);
      const second = await S.createRequest(db, a, { ...baseReq, days: [4] });
      assert.ok(second.matchId);
      assert.deepEqual((await S.homeState(db, a)).matches.map((x) => x.mate.name), ['c', 'b']);
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

    test('장소가 같아야 매칭, 신청 취소, 다른 사람 매칭 접근 차단', async () => {
      const [a, b, c] = [await signup('a'), await signup('b'), await signup('c')];
      await S.createRequest(db, a, { ...baseReq, location: '채팅으로 정하기' });
      assert.equal((await S.createRequest(db, b, baseReq)).matchId, null, '장소가 다르면 대기');
      await S.cancelRequest(db, a);
      assert.equal(await S.pendingRequest(db, a), null);

      const { matchId } = await S.createRequest(db, a, baseReq);
      assert.ok(matchId);
      await assert.rejects(S.listMessages(db, c, matchId), /찾을 수 없어요/);
      await S.sendMessage(db, a, matchId, '어느 강의실에서 만날까요?');
      const msgs = await S.listMessages(db, b, matchId);
      assert.equal(msgs.length, 1);
      assert.equal(msgs[0].userId, a);
    });

    test('매칭 그만두기: 바로 종료 / 남은 약속 없으면 정산', async () => {
      const [a, b] = [await signup('a'), await signup('b')];

      await S.createRequest(db, a, baseReq);
      let { matchId } = await S.createRequest(db, b, baseReq);
      assert.equal((await S.currentMatch(db, a)).leavePolicy, 'penalty');
      const left = await S.leaveMatch(db, a, matchId);
      assert.deepEqual([left.result, left.lostTo], ['left', null]);
      assert.equal(left.strikes.count, 0, '규칙 시작(11/6) 전 그만두기는 세지 않음');
      assert.equal(await S.currentMatch(db, b), null);
      assert.deepEqual((await S.homeState(db, b)).mateLeft, { mateName: 'a', refunded: 0, reward: 0 });
      assert.equal((await S.homeState(db, a)).mateLeft, null, '그만둔 본인에게는 안내 없음');
      assert.equal((await S.matchHistory(db, b))[0].left, 'mate');
      await assert.rejects(S.leaveMatch(db, a, matchId), /진행 중인 매칭만/);

      // 지난 스터디 다시 보기: 남은 약속은 '취소', 누가 그만뒀는지 표시, 남의 매칭은 볼 수 없음
      const past = await S.matchById(db, b, matchId);
      assert.equal(past.status, 'closed');
      assert.equal(past.left, 'mate');
      assert.ok(past.appointments.every((x) => x.me.status === 'cancelled'));
      const c = await signup('c');
      await assert.rejects(S.matchById(db, c, matchId), /찾을 수 없어요/);

      // 마지막 약속이 끝난 뒤 → 그만두는 대신 정산 (리포트)
      await S.createRequest(db, a, baseReq);
      ({ matchId } = await S.createRequest(db, b, baseReq));
      setNow(kst(2026, 11, 12, 21, 30));
      assert.equal((await S.leaveMatch(db, a, matchId)).result, 'settled');
      assert.equal((await S.currentMatch(db, a)).status, 'reported');
    });

    test('약속 지키기: 매칭 그만두기 2번이면 30일 매칭 정지, 기다리던 신청 취소, 끝나면 0번부터', () => withRuleFrom('2026-10-01', async () => {
      const [a, b, c] = [await signup('a'), await signup('b'), await signup('c')];
      assert.deepEqual(await S.strikeStatus(db, a), { count: 0, limit: 2, suspendDays: 30, suspendedUntil: null });

      // 1번: a가 b와의 매칭을 그만둠. 남은 b는 세지 않음.
      await S.createRequest(db, a, baseReq);
      const first = await S.createRequest(db, b, baseReq);
      const left1 = await S.leaveMatch(db, a, first.matchId);
      assert.deepEqual([left1.strikes.count, left1.strikes.suspendedUntil], [1, null]);
      assert.equal((await S.strikeStatus(db, b)).count, 0);
      assert.equal((await S.homeState(db, a)).strikes.count, 1);

      // 2번: a가 c와 화·수 매칭 + 목요일 신청은 대기 중 → 그만두면 정지, 대기 신청도 취소
      await S.createRequest(db, a, { ...baseReq, days: [2, 3] });
      const second = await S.createRequest(db, c, { ...baseReq, days: [2, 3] });
      await S.createRequest(db, a, { ...baseReq, days: [4] });
      assert.ok(await S.pendingRequest(db, a));
      const left2 = await S.leaveMatch(db, a, second.matchId);
      // 10/31 + 30일 = 11/30 0시(한국)부터 다시 신청 가능
      assert.deepEqual(left2.strikes, { count: 2, limit: 2, suspendDays: 30, suspendedUntil: '2026-11-29T15:00:00.000Z' });
      assert.equal(await S.pendingRequest(db, a), null, '기다리던 신청은 취소');
      await assert.rejects(S.createRequest(db, a, { ...baseReq, days: [4] }), /매칭 정지 중이에요\. 11월 30일부터/);
      assert.equal((await S.homeState(db, a)).strikes.suspendedUntil, '2026-11-29T15:00:00.000Z');

      // 정지가 끝나면 0번부터 (스터디 기간은 끝났으므로 신청은 '끝나서'로 막힘 = 정지 검사는 통과)
      setNow(kst(2026, 11, 30, 0, 0));
      assert.deepEqual(await S.strikeStatus(db, a), { count: 0, limit: 2, suspendDays: 30, suspendedUntil: null });
      await assert.rejects(S.createRequest(db, a, baseReq), /끝나서/);
    }));

    test('약속 지키기: 약속 날 미참석은 정산 때 한 번씩 셈, 규칙 시작일 전 약속은 제외', () => withRuleFrom('2026-11-11', async () => {
      const [a, b] = [await signup('a'), await signup('b')];
      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      const m = await S.currentMatch(db, a);
      // a는 세 번 모두 출석(b가 a의 코드로 확인), b는 한 번도 안 나옴
      for (const [i, appt] of m.appointments.entries()) {
        setNow(kst(2026, 11, 10 + i, 19, 0));
        await S.confirmMate(db, b, appt.id, appt.myCode);
      }
      setNow(kst(2026, 11, 13, 9, 0));
      await S.autoSettle(db);
      await S.settleMatch(db, matchId); // 다시 불러도 두 번 세지 않음
      assert.equal((await S.strikeStatus(db, a)).count, 0);
      // 11/10은 시작일(11/11) 전이라 제외 → 11/11·11/12 두 번 → 정지 (11/13 + 30일 = 12/13부터)
      const st = await S.strikeStatus(db, b);
      assert.deepEqual([st.count, st.suspendedUntil], [2, '2026-12-12T15:00:00.000Z']);
      const rows = await db.all('SELECT kind, appointment_id FROM strikes WHERE user_id = ? ORDER BY id', b);
      assert.deepEqual(rows.map((r) => r.kind), ['missed', 'missed']);
      // 정지 중에는 '같은 메이트와 계속하기'도 막힘
      await assert.rejects(S.chooseNext(db, b, matchId, 'continue'), /매칭 정지/);
    }));

    test('약속 지키기: 그만두기 전에 지난 약속의 미참석도 셈, 데모 계정·데모 메이트는 세지 않음', () => withRuleFrom('2026-10-01', async () => {
      const [a, b] = [await signup('a'), await signup('b')];
      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      // 11/10 약속에 둘 다 안 나오고, 11/11 낮에 a가 그만둠 → a: 미참석 1 + 그만두기 1, b: 미참석 1
      setNow(kst(2026, 11, 11, 12, 0));
      const left = await S.leaveMatch(db, a, matchId);
      assert.deepEqual([left.strikes.count, !!left.strikes.suspendedUntil], [2, true]);
      assert.deepEqual([(await S.strikeStatus(db, b)).count, (await S.strikeStatus(db, b)).suspendedUntil], [1, null]);

      setNow(kst(2026, 10, 31, 9, 0));
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db);
      const demoId = (await S.demoLogin(db)).user.id;
      const demoMatch = await S.createRequest(db, demoId, baseReq);
      await S.leaveMatch(db, demoId, demoMatch.matchId);
      assert.equal((await S.strikeStatus(db, demoId)).count, 0, '공용 데모 계정은 세지 않음');
      assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM strikes s JOIN users u ON u.id = s.user_id WHERE u.is_bot = 1')).n), 0);
    }));

    test('회원가입: 이름·학과·전화번호 필수, 학과·전화번호는 본인만', async () => {
      const form = { email: 'new@test.dev', password: 'secret1', name: '김국민', department: '경영정보학부', phone: '01012345678' };
      await assert.rejects(S.signup(db, { ...form, department: ' ' }), /학과/);
      await assert.rejects(S.signup(db, { ...form, phone: '' }), /전화번호/);
      await assert.rejects(S.signup(db, { ...form, phone: '02-123-4567' }), /전화번호/);
      const { user } = await S.signup(db, form);
      assert.deepEqual([user.name, user.department, user.phone], ['김국민', '경영정보학부', '010-1234-5678']);

      // 메이트에게 보이는 정보에는 학과·전화번호가 없음
      const mate = await signup('mate');
      await S.createRequest(db, mate, baseReq);
      await S.createRequest(db, user.id, baseReq);
      const seen = (await S.currentMatch(db, mate)).mate;
      assert.equal(seen.name, '김국민');
      assert.equal(seen.department, undefined);
      assert.equal(seen.phone, undefined);

      // 프로필 수정으로 바꿀 수 있음
      const updated = await S.updateProfile(db, user.id, { department: '경영학부', phone: '010-9876-5432' });
      assert.deepEqual([updated.department, updated.phone], ['경영학부', '010-9876-5432']);
      await assert.rejects(S.updateProfile(db, user.id, { phone: '123' }), /전화번호/);
    });

    test('국민대 메일 인증: 가입 · 로그인 제한 · 비밀번호 찾기', async () => {
      const policy = { domain: 'kookmin.ac.kr', verify: true };
      const sent = [];
      const mailer = { send: async (m) => { sent.push(m); } };
      const lastCode = () => sent.at(-1).subject.match(/(\d{6})$/)[1];
      const email = 'student@kookmin.ac.kr';

      await assert.rejects(S.requestEmailCode(db, mailer, { email: 'x@gmail.com', purpose: 'signup' }, policy), /국민대학교 메일/);
      await assert.rejects(S.requestEmailCode(db, null, { email, purpose: 'signup' }, policy), /메일 발송/);

      await S.requestEmailCode(db, mailer, { email, purpose: 'signup' }, policy);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, email);
      // 1분 안에는 다시 못 받음
      await assert.rejects(S.requestEmailCode(db, mailer, { email, purpose: 'signup' }, policy), /초 후에/);

      const form = { email, password: 'secret1', name: '국민', department: '경영정보학부', phone: '010-1111-2222' };
      await assert.rejects(S.signup(db, { ...form }, policy), /인증번호가 맞지 않아요/);
      await assert.rejects(S.signup(db, { ...form, code: '000000' === lastCode() ? '111111' : '000000' }, policy), /3번 남음/);
      const { user } = await S.signup(db, { ...form, code: lastCode() }, policy);
      assert.equal(user.email, email);
      // 같은 인증번호로 두 번 가입 불가
      await assert.rejects(S.signup(db, { ...form, email, code: lastCode() }, policy), /다시 받아/);

      await assert.rejects(S.login(db, { email: 'student@gmail.com', password: 'secret1' }, policy), /국민대학교 메일/);
      const { token: oldToken } = await S.login(db, { email, password: 'secret1' }, policy);

      // 가입 안 된 메일로 찾기 요청 → 성공처럼 응답하지만 메일은 안 감
      await S.requestEmailCode(db, mailer, { email: 'nobody@kookmin.ac.kr', purpose: 'reset' }, policy);
      assert.equal(sent.length, 1);

      setNow(kst(2026, 10, 31, 9, 5));
      await S.requestEmailCode(db, mailer, { email, purpose: 'reset' }, policy);
      assert.equal(sent.length, 2);
      await S.resetPassword(db, { email, code: lastCode(), password: 'newpass1' }, policy);
      assert.equal(await S.userByToken(db, oldToken), null, '기존 로그인은 해제');
      await assert.rejects(S.login(db, { email, password: 'secret1' }, policy), /올바르지/);
      await S.login(db, { email, password: 'newpass1' }, policy);

      // 인증번호 만료
      setNow(kst(2026, 10, 31, 9, 10));
      await S.requestEmailCode(db, mailer, { email, purpose: 'reset' }, policy);
      setNow(kst(2026, 10, 31, 9, 21));
      await assert.rejects(S.resetPassword(db, { email, code: lastCode(), password: 'another1' }, policy), /다시 받아/);
    });

    test('데모 계정 로그인: 데모 모드에서만, 같은 계정 재사용', async () => {
      const { createApp } = await import('../server/app.js');
      const call = async (app, path) => {
        const server = app.listen(0);
        const { port } = server.address();
        const res = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: 'POST' });
        server.close();
        return [res.status, await res.json()];
      };
      const [prodStatus] = await call(createApp({ db, demo: false, serveStatic: false }), '/auth/demo');
      assert.equal(prodStatus, 403);
      const [s1, b1] = await call(createApp({ db, demo: true, serveStatic: false }), '/auth/demo');
      const [, b2] = await call(createApp({ db, demo: true, serveStatic: false }), '/auth/demo');
      assert.equal(s1, 200);
      assert.equal(b1.user.email, 'demo@studybuddy.local');
      assert.equal(b1.user.id, b2.user.id);
      // 실서비스에서도 demoLogin 을 켜면 허용
      const [s3] = await call(createApp({ db, demo: false, demoLogin: true, serveStatic: false }), '/auth/demo');
      assert.equal(s3, 200);
    });

    test('데모 메이트: 공용 데모 계정하고만 매칭, 실제 사용자는 실제 사용자끼리', async () => {
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db); // 김저녁: 지정 강의실, 김대화: 채팅으로 정하기 (스터디 기간 19~21시)
      const bot = await db.get("SELECT id, points FROM users WHERE name = '김저녁'");
      assert.equal(bot.points, 100000);

      // 실제 사용자는 데모 메이트가 기다려도 매칭되지 않고 대기
      const p = await signup('p');
      assert.equal((await S.createRequest(db, p, baseReq)).matchId, null);

      // 데모 계정은 장소에 맞는 데모 메이트와 바로 매칭, 데모 메이트는 계속 대기
      const demoId = (await S.demoLogin(db)).user.id;
      const { matchId } = await S.createRequest(db, demoId, baseReq);
      const m = await S.currentMatch(db, demoId);
      assert.deepEqual([m.mate.name, m.stake], ['김저녁', 0]);
      assert.ok(await S.pendingRequest(db, bot.id), '김저녁은 계속 대기');
      assert.equal((await S.leaveMatch(db, demoId, matchId)).lostTo, null);

      await S.createRequest(db, demoId, { ...baseReq, location: '채팅으로 정하기' });
      assert.equal((await S.currentMatch(db, demoId)).mate.name, '김대화');
      assert.equal((await S.currentMatch(db, p)), null, 'p는 여전히 대기');
      assert.equal((await db.get('SELECT points FROM users WHERE id = ?', bot.id)).points, 100000);
    });

    test('현장 출석: 메이트 QR(코드)을 찍으면 메이트 출석이 확인됨', async () => {
      const [a, b] = [await signup('a'), await signup('b')];
      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      const ma = await S.currentMatch(db, a);
      const mb = await S.currentMatch(db, b);
      const apptId = ma.appointments[0].id;
      const aCode = ma.appointments[0].myCode;
      const bCode = mb.appointments[0].myCode;
      assert.ok(aCode && bCode && aCode !== bCode, '사람마다 다른 코드');
      assert.equal(ma.appointments[0].mateCode, null, '실제 메이트의 코드는 보이지 않음');

      await assert.rejects(S.confirmMate(db, a, apptId, bCode), /출석 확인은/, '약속 시간 전에는 안 됨');
      setNow(kst(2026, 11, 10, 19, 0));
      await assert.rejects(S.confirmMate(db, a, apptId, 'ZZZZZZ'), /맞지 않아요/);
      await assert.rejects(S.confirmMate(db, a, apptId, aCode), /메이트의 출석 코드를/);
      await S.confirmMate(db, a, apptId, bCode.toLowerCase()); // a가 b를 확인
      let m = await S.currentMatch(db, a);
      assert.deepEqual([m.appointments[0].me.status, m.appointments[0].mate.status], ['open', 'studying']);
      await assert.rejects(S.confirmMate(db, a, apptId, bCode), /이미 확인/);
      await S.confirmMate(db, b, apptId, aCode); // b가 a를 확인 → 둘 다 출석
      m = await S.currentMatch(db, a);
      assert.equal(m.appointments[0].me.status, 'studying');
      assert.equal(matchId, m.id);
    });

    test('개인 일정', async () => {
      const me = await signup('me');
      const saved = await S.setPersonalSchedule(db, me, [{ cell: '2-0', title: '마케팅' }, { cell: '2-1', title: '' }]);
      assert.deepEqual(saved, [{ cell: '2-0', title: '마케팅' }, { cell: '2-1', title: '개인 일정' }]);
      assert.deepEqual((await S.homeState(db, me)).personal, saved);
      await assert.rejects(S.setPersonalSchedule(db, me, [{ cell: '9-0' }]), /올바르지/);
    });

    test('매칭 우선순위: 먼저 기다린 순서', async () => {
      const [p, q, r, me] = [await signup('p'), await signup('q'), await signup('r'), await signup('me')];
      // 기다리는 셋은 스타일이 서로 달라 자기들끼리는 매칭되지 않고, me(모든 스타일)와만 맞는다
      await S.createRequest(db, p, { ...baseReq, styles: ['check'] });
      await S.createRequest(db, q, { ...baseReq, styles: ['talk'] });
      await S.createRequest(db, r, { ...baseReq, styles: ['social'] });
      await S.createRequest(db, me, { ...baseReq, styles: ['check', 'talk', 'social'] });
      assert.equal((await S.currentMatch(db, me)).mate.name, 'p');
    });

    test('홈: 기말고사 디데이, 국민대 통계(실제 사용자만)', async () => {
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db);
      const [a, b, c] = [await signup('a'), await signup('b'), await signup('c')];
      await S.createRequest(db, a, baseReq);
      await S.createRequest(db, b, baseReq); // a·b 매칭
      await S.createRequest(db, c, { ...baseReq, location: '채팅으로 정하기' }); // 대기 (데모 메이트와는 매칭 안 됨)
      const demo = (await S.demoLogin(db)).user.id;
      await S.createRequest(db, demo, baseReq); // 데모끼리 매칭 → 제외
      const home = await S.homeState(db, a);
      assert.deepEqual(home.community, { studying: 2, waiting: 1, studiedTeams: 15 }); // 앱 실제 1팀(a·b) + 앱 이전 14팀, 데모끼리는 제외
      assert.deepEqual(home.exam, { name: '기말고사', date: '2026-12-08', dday: 38 }); // 10/31 기준
      setNow(kst(2026, 12, 9, 9, 0));
      assert.equal((await S.homeState(db, a)).exam, null, '시험이 지나면 숨김');
    });

    test('현장 출석: 데모 메이트를 확인하면 데모 메이트도 나를 확인', async () => {
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db);
      const demoId = (await S.demoLogin(db)).user.id;
      await S.createRequest(db, demoId, baseReq);
      const m = await S.currentMatch(db, demoId);
      const ap = m.appointments[0];
      assert.ok(ap.mateCode, '데모 메이트 코드는 체험용으로 보임');
      setNow(kst(2026, 11, 10, 19, 0));
      await S.confirmMate(db, demoId, ap.id, ap.mateCode);
      const after = (await S.currentMatch(db, demoId)).appointments[0];
      assert.deepEqual([after.me.status, after.mate.status], ['studying', 'studying']);
    });

    test('데모 계정 지난 스터디 고정 기록', async () => {
      const id = (await S.demoLogin(db)).user.id;
      await S.demoLogin(db); // 두 번 로그인해도 기록은 하나
      // 나중에 생긴 기록이 있어도 첫 베타 기록은 맨 아래(가장 오래된 기록)
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db);
      const r = await S.createRequest(db, id, baseReq);
      await S.settleMatch(db, r.matchId);
      await S.chooseNext(db, id, r.matchId, 'new');
      const all = await S.matchHistory(db, id);
      assert.equal(all.length, 2);
      assert.equal(all.at(-1).mate.name, '실제 첫 베타 서비스');
      const hist = all.slice(-1);
      assert.deepEqual(hist[0].mate.tags, ['#5일간', '#17명 신청', '#6회 매칭 성사']);
      assert.equal(hist[0].location, '경상관 102A호');
      const past = await S.matchById(db, id, hist[0].id);
      assert.deepEqual([past.weekStart, past.startTime, past.endTime, past.stake], ['2026-10-12', '19:00', '21:00', 0]);
      assert.deepEqual(past.appointments.map((a) => a.me.status), ['done', 'done', 'done', 'missed', 'done']);
      assert.equal(past.report.me.attended, 4);
      assert.equal(past.mate.isBot, false, '기록용 상대에는 데모 메이트 배지 없음');
      assert.equal(past.label, '첫 베타기간');
      assert.equal(past.headline, '5일간의 실서비스 · 19:00–21:00');
      assert.equal(past.week.length, 7, '예전 매칭은 7일 표시');
    });

    test('공용 데모 계정은 실제 사용자와 매칭되지 않음', async () => {
      const demoId = (await S.demoLogin(db)).user.id;
      const real = await signup('real');
      // 실제 사용자가 먼저 기다려도 데모 계정과는 매칭되지 않음
      await S.createRequest(db, real, baseReq);
      assert.equal((await S.createRequest(db, demoId, baseReq)).matchId, null);
      // 반대로 데모 계정이 기다리는 중에 실제 사용자가 신청해도 매칭되지 않음
      await S.cancelRequest(db, real);
      assert.equal((await S.createRequest(db, real, baseReq)).matchId, null);
    });

    test('로그인 / 토큰', async () => {
      await signup('a');
      await assert.rejects(S.signup(db, { email: 'a@test.dev', password: 'secret1', name: 'x', department: 'y', phone: '010-0000-0000' }), /이미 가입/);
      await assert.rejects(S.login(db, { email: 'a@test.dev', password: 'nope' }), /올바르지/);
      const { token } = await S.login(db, { email: 'A@test.dev', password: 'secret1' });
      assert.equal((await S.userByToken(db, token)).name, 'a');
      await S.logout(db, token);
      assert.equal(await S.userByToken(db, token), null);
    });

    test('장소 여러 개로 신청: 겹치는 장소로 매칭', async () => {
      const a = await signup('a');
      const b = await signup('b');
      const { request } = await S.createRequest(db, a, { ...baseReq, location: undefined, locations: ['채팅으로 정하기', ROOM] });
      assert.deepEqual(request.locations, ['채팅으로 정하기', ROOM]);
      assert.equal(request.location, `채팅으로 정하기 · ${ROOM}`);
      const { matchId } = await S.createRequest(db, b, { ...baseReq, location: '채팅으로 정하기' });
      assert.ok(matchId);
      assert.equal((await S.currentMatch(db, a)).location, '채팅으로 정하기');
    });

    test('개발자 화면: 운영자만, 실제 사용자 기준 집계', async () => {
      const admin = (await S.signup(db, {
        email: 'rlawlals031102@kookmin.ac.kr', password: 'secret1', name: '운영자', department: '경영정보학부', phone: '010-1111-2222',
      })).user;
      assert.equal(admin.isAdmin, true);
      const a = await signup('a');
      const b = await signup('b');
      await assert.rejects(S.assertAdmin(db, a), /개발자만/);
      await S.assertAdmin(db, admin.id);

      await S.recordVisit(db, 'visitor0001');
      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      await S.sendMessage(db, a, matchId, '안녕하세요');
      await S.createRequest(db, (await S.demoLogin(db)).user.id, baseReq); // 데모 계정은 세지 않음

      const d = await S.adminDashboard(db);
      assert.deepEqual(d.summary, { todayVisitors: 1, users: 3, pendingRequests: 0, activeMatches: 1 });
      assert.deepEqual(d.funnel.all.map((f) => f.count), [1, 3, 2, 2, 0]);
      assert.deepEqual(d.funnel.today.map((f) => f.count), [1, 3, 2, 2, 0], '모두 오늘 일어난 일');
      assert.equal(d.users.find((u) => u.name === '운영자').phone, '010-1111-2222');
      // 운영진은 신고된 대화만 본다
      assert.deepEqual(d.chats, []);
      const { reportChat } = await import('../server/reports.js');
      await reportChat(db, b, matchId, { reason: 'rude' });
      const after = await S.adminDashboard(db);
      assert.deepEqual(after.chats.map((c) => [c.names, c.messages.map((m) => m.body)]), [[['a', 'b'], ['안녕하세요']]]);
    });

    test('방문자: 열 때마다 기록, 사람 수는 브라우저 id로 센다', async () => {
      setNow(kst(2026, 11, 4, 10, 0));
      await S.recordVisit(db, 'visitor0001');
      await S.recordVisit(db, 'visitor0001');
      await S.recordVisit(db, 'visitor0002');
      setNow(kst(2026, 11, 5, 10, 0));
      await S.recordVisit(db, 'visitor0001');
      const rows = await db.all('SELECT visitor_id, day FROM visits ORDER BY id');
      assert.deepEqual(rows.map((r) => `${r.visitor_id} ${r.day}`),
        ['visitor0001 2026-11-04', 'visitor0001 2026-11-04', 'visitor0002 2026-11-04', 'visitor0001 2026-11-05']);
      assert.equal(Number((await db.get('SELECT COUNT(DISTINCT visitor_id) AS n FROM visits')).n), 2);
      await assert.rejects(S.recordVisit(db, 'x'), /잘못된/);
    });

    test('채팅 읽음: 안 읽은 수, 읽음 표시, 메이트가 읽은 위치', async () => {
      const a = await signup('a');
      const b = await signup('b');
      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      assert.deepEqual(await S.unreadCounts(db, a), { total: 0, byMatch: {} });

      await S.sendMessage(db, b, matchId, '안녕하세요');
      await S.sendMessage(db, b, matchId, '7시에 봬요');
      assert.deepEqual(await S.unreadCounts(db, a), { total: 2, byMatch: { [matchId]: 2 } });
      assert.equal((await S.unreadCounts(db, b)).total, 0, '내가 보낸 메시지는 안 셈');

      const msgs = await S.listMessages(db, a, matchId);
      await S.markChatRead(db, a, matchId, msgs[0].id); // 첫 메시지까지만 봄
      assert.equal((await S.unreadCounts(db, a)).total, 1);
      await S.markChatRead(db, a, matchId, 999999); // 없는 번호는 마지막 메시지로 맞춤
      assert.equal((await S.unreadCounts(db, a)).total, 0);
      assert.equal((await S.markChatRead(db, a, matchId, msgs[0].id)).lastReadId, msgs[1].id, '뒤로 되돌리지 않음');

      // 내가 보낸 메시지는 메이트가 읽기 전까지 '1'
      await S.sendMessage(db, a, matchId, '네 좋아요');
      const mine = (await S.listMessages(db, a, matchId)).at(-1);
      assert.ok(mine.id > await S.mateLastRead(db, a, matchId));
      assert.equal((await S.unreadCounts(db, b)).total, 1);
      await S.markChatRead(db, b, matchId);
      assert.equal(await S.mateLastRead(db, a, matchId), mine.id);
      assert.equal((await S.unreadCounts(db, b)).total, 0);

      // 매칭 당사자가 아니면 읽음 표시도 못 함
      const c = await signup('c');
      await assert.rejects(S.markChatRead(db, c, matchId), /찾을 수 없어요/);
    });

    test('채팅 읽음: 데모 메이트는 바로 읽은 것으로', async () => {
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db);
      const demo = (await S.demoLogin(db)).user.id;
      const { matchId } = await S.createRequest(db, demo, baseReq);
      assert.ok(matchId);
      await S.sendMessage(db, demo, matchId, '안녕하세요');
      const all = await S.listMessages(db, demo, matchId);
      assert.equal(await S.mateLastRead(db, demo, matchId), all.at(-1).id);
      assert.equal((await S.unreadCounts(db, demo)).total, 1, '데모 메이트의 자동 답장 1개');
    });

    test('개발자 화면 권한: 김지민·나윤빈 학교 메일만', async () => {
      const make = async (email) => (await S.signup(db, {
        email, password: 'secret1', name: '운영', department: '경영정보학부', phone: '010-1111-2222',
      })).user;
      const jimin = await make('rlawlals031102@kookmin.ac.kr');
      const yunbin = await make('YunBinNa6@kookmin.ac.kr'); // 대소문자 섞어 가입해도 같은 메일
      const other = await make('someone@kookmin.ac.kr');
      assert.deepEqual([jimin.isAdmin, yunbin.isAdmin, other.isAdmin], [true, true, false]);
      await S.assertAdmin(db, jimin.id);
      await S.assertAdmin(db, yunbin.id);
      await assert.rejects(S.assertAdmin(db, other.id), /개발자만/);
    });
  });
}
