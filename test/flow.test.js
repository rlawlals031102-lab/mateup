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

      // A는 세 번 모두 출석(B가 A의 코드를 입력해 확인), B는 첫 날만 출석(A가 B의 코드를 입력)
      const bView = await S.currentMatch(db, b);
      for (const [i, appt] of m.appointments.entries()) {
        setNow(kst(2026, 10, 12 + i * 2, 19, 0));
        await assert.rejects(S.confirmMate(db, b, appt.id, 'WRONG1'), /맞지 않아요/);
        await S.confirmMate(db, b, appt.id, appt.myCode);
        await assert.rejects(S.confirmMate(db, b, appt.id, appt.myCode), /이미 확인/);
        if (i === 0) await S.confirmMate(db, a, appt.id, bView.appointments[0].myCode);
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

    test('매칭 그만두기: 첫 약속 전에도 보증금 잃음 / 남은 약속 없으면 정산', async () => {
      const [a, b] = [await signup('a'), await signup('b')];
      const req = { ...baseReq, deposit: 10000 };

      // 첫 약속(월 19:00) 전이어도 → 그만둔 a의 보증금은 b에게
      await S.createRequest(db, a, req);
      let { matchId } = await S.createRequest(db, b, req);
      assert.equal((await S.currentMatch(db, a)).leavePolicy, 'penalty');
      const left = await S.leaveMatch(db, a, matchId);
      assert.deepEqual([left.result, left.lostTo], ['left', 'mate']);
      assert.equal(await points(a), 40000);
      assert.equal(await points(b), 60000);
      assert.equal(await S.currentMatch(db, b), null);
      assert.equal((await S.homeState(db, b)).mateLeft.mateName, 'a');
      assert.equal((await S.matchHistory(db, b))[0].left, 'mate');
      await assert.rejects(S.leaveMatch(db, a, matchId), /진행 중인 매칭만/);

      // 지난 스터디 다시 보기: 남은 약속은 '취소', 누가 그만뒀는지 표시, 남의 매칭은 볼 수 없음
      const past = await S.matchById(db, b, matchId);
      assert.equal(past.status, 'closed');
      assert.equal(past.left, 'mate');
      assert.ok(past.appointments.every((x) => x.me.status === 'cancelled'));
      assert.equal(past.report.me.deposit.result, 'refunded');
      const c = await signup('c');
      await assert.rejects(S.matchById(db, c, matchId), /찾을 수 없어요/);

      // 약속 시작 후 → 그만둔 쪽 보증금이 메이트에게
      await S.createRequest(db, a, req);
      ({ matchId } = await S.createRequest(db, b, req));
      setNow(kst(2026, 10, 12, 19, 30));
      assert.equal((await S.currentMatch(db, b)).leavePolicy, 'penalty');
      assert.equal((await S.leaveMatch(db, b, matchId)).result, 'left');
      assert.equal(await points(b), 50000);
      assert.equal(await points(a), 50000);
      const note = (await S.homeState(db, a)).mateLeft;
      assert.deepEqual([note.refunded, note.reward], [10000, 10000]);
      assert.equal((await S.homeState(db, b)).mateLeft, null, '그만둔 본인에게는 안내 없음');
      assert.equal((await S.matchHistory(db, b))[0].left, 'me');

      // 남은 약속이 없으면 → 그만두는 대신 정산 (리포트)
      setNow(kst(2026, 10, 12, 9, 0));
      await S.createRequest(db, a, { ...baseReq, days: [1] });
      ({ matchId } = await S.createRequest(db, b, { ...baseReq, days: [1] }));
      setNow(kst(2026, 10, 13, 9, 0));
      assert.equal((await S.leaveMatch(db, a, matchId)).result, 'settled');
      assert.equal((await S.currentMatch(db, a)).status, 'reported');
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

      const form = { email, password: 'secret1', name: '국민' };
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

      setNow(kst(2026, 10, 12, 9, 5));
      await S.requestEmailCode(db, mailer, { email, purpose: 'reset' }, policy);
      assert.equal(sent.length, 2);
      await S.resetPassword(db, { email, code: lastCode(), password: 'newpass1' }, policy);
      assert.equal(await S.userByToken(db, oldToken), null, '기존 로그인은 해제');
      await assert.rejects(S.login(db, { email, password: 'secret1' }, policy), /올바르지/);
      await S.login(db, { email, password: 'newpass1' }, policy);

      // 인증번호 만료
      setNow(kst(2026, 10, 12, 9, 10));
      await S.requestEmailCode(db, mailer, { email, purpose: 'reset' }, policy);
      setNow(kst(2026, 10, 12, 9, 21));
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
      assert.equal(b1.user.points, 50000);
      // 실서비스에서도 demoLogin 을 켜면 허용
      const [s3] = await call(createApp({ db, demo: false, demoLogin: true, serveStatic: false }), '/auth/demo');
      assert.equal(s3, 200);
    });

    test('데모 메이트: 여러 명과 동시에 매칭, 포인트(보증금) 변화 없음', async () => {
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db);
      const bot = await db.get("SELECT id, points FROM users WHERE name = '김저녁'");
      assert.equal(bot.points, 100000);
      const req = { ...baseReq, days: [1], startTime: '19:00', endTime: '21:00', deposit: 5000 };
      const [x, y] = [await signup('x'), await signup('y')];
      const m1 = await S.createRequest(db, x, req);
      const m2 = await S.createRequest(db, y, req);
      assert.ok(m1.matchId && m2.matchId && m1.matchId !== m2.matchId, '둘 다 김저녁과 매칭');
      assert.equal((await S.currentMatch(db, x)).mate.name, '김저녁');
      assert.equal((await S.currentMatch(db, y)).mate.name, '김저녁');
      assert.ok(await S.pendingRequest(db, bot.id), '김저녁은 계속 대기');

      // x는 첫 약속(19:00) 전에 그만둠 → x 보증금은 소멸(데모 메이트는 받지 않음), y는 출석하고 주간 정산 → 반환
      assert.equal((await S.leaveMatch(db, x, m1.matchId)).lostTo, 'none');
      const appt = (await S.currentMatch(db, y)).appointments[0];
      setNow(kst(2026, 10, 12, 19, 0));
      await S.checkIn(db, y, appt.id, { method: 'self' });
      setNow(kst(2026, 10, 19, 9, 0));
      assert.equal((await S.currentMatch(db, y)).report.me.deposit.result, 'refunded');
      assert.equal(await points(x), 45000);
      assert.equal(await points(y), 50000);
      assert.equal((await db.get('SELECT points FROM users WHERE id = ?', bot.id)).points, 100000);
      assert.equal((await db.get('SELECT COUNT(*) AS n FROM point_logs WHERE user_id = ?', bot.id)).n, 0);
    });

    test('현장 출석: 메이트 코드를 입력하면 메이트 출석이 확인됨', async () => {
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
      setNow(kst(2026, 10, 12, 19, 0));
      await assert.rejects(S.confirmMate(db, a, apptId, 'ZZZZZZ'), /맞지 않아요/);
      await assert.rejects(S.confirmMate(db, a, apptId, aCode), /메이트의 출석 코드를/);
      await S.confirmMate(db, a, apptId, bCode.toLowerCase()); // a가 b를 확인
      let m = await S.currentMatch(db, a);
      assert.deepEqual([m.appointments[0].me.status, m.appointments[0].mate.status], ['open', 'studying']);
      await assert.rejects(S.confirmMate(db, a, apptId, bCode), /이미 확인/);
      await S.confirmMate(db, b, apptId, aCode); // b가 a를 확인
      m = await S.currentMatch(db, a);
      assert.equal(m.appointments[0].me.status, 'studying');
      assert.equal(matchId, m.id);
    });

    test('데모 메이트는 보증금이 있든 없든 매칭', async () => {
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db); // 김저녁: 보증금 5천
      const req = { ...baseReq, days: [1], startTime: '19:00', endTime: '21:00' };
      const [p, q] = [await signup('p'), await signup('q')];
      // 보증금 없이 신청 → 김저녁과 보증금 없는 매칭
      assert.ok((await S.createRequest(db, p, { ...req, deposit: 0 })).matchId);
      const mp = await S.currentMatch(db, p);
      assert.deepEqual([mp.mate.name, mp.stake], ['김저녁', 0]);
      assert.equal(await points(p), 50000);
      // 2만 걸고 신청 → 낮은 쪽(5천)에 맞추고 1만5천 반환
      assert.ok((await S.createRequest(db, q, { ...req, deposit: 20000 })).matchId);
      assert.equal((await S.currentMatch(db, q)).stake, 5000);
      assert.equal(await points(q), 45000);
      // 실제 사용자끼리는 여전히 보증금 사용 여부가 같아야 함
      assert.equal(S.compatibility({ ...req, deposit: 0 }, { ...req, deposit: 5000 }), null);
    });

    test('현장 출석: 데모 메이트를 확인하면 데모 메이트도 나를 확인', async () => {
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db);
      const x = await signup('x');
      await S.createRequest(db, x, { ...baseReq, days: [1], startTime: '19:00', endTime: '21:00', deposit: 5000 });
      const m = await S.currentMatch(db, x);
      const ap = m.appointments[0];
      assert.ok(ap.mateCode, '데모 메이트 코드는 체험용으로 보임');
      setNow(kst(2026, 10, 12, 19, 0));
      await S.confirmMate(db, x, ap.id, ap.mateCode);
      const after = (await S.currentMatch(db, x)).appointments[0];
      assert.deepEqual([after.me.status, after.mate.status], ['studying', 'studying']);
    });

    test('데모 계정 지난 스터디 고정 기록', async () => {
      setNow(kst(2026, 10, 24, 9, 0)); // 그 주가 지난 뒤
      const id = (await S.demoLogin(db)).user.id;
      await S.demoLogin(db); // 두 번 로그인해도 기록은 하나
      // 나중에 생긴 기록이 있어도 첫 베타 기록은 맨 아래(가장 오래된 기록)
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db);
      const r = await S.createRequest(db, id, { ...baseReq, days: [1], startTime: '19:00', endTime: '21:00', deposit: 0 });
      await S.settleMatch(db, r.matchId);
      await S.chooseNext(db, id, r.matchId, 'new');
      const all = await S.matchHistory(db, id);
      assert.equal(all.length, 2);
      assert.equal(all.at(-1).mate.name, '실제 첫 베타 서비스');
      const hist = all.slice(-1);
      assert.equal(hist[0].mate.name, '실제 첫 베타 서비스');
      assert.deepEqual(hist[0].mate.tags, ['#5일간', '#17명 신청', '#6회 매칭 성사']);
      assert.equal(hist[0].location, '경상관 102A호');
      const past = await S.matchById(db, id, hist[0].id);
      assert.deepEqual([past.weekStart, past.startTime, past.endTime, past.stake], ['2026-10-12', '19:00', '21:00', 0]);
      assert.deepEqual(past.appointments.map((a) => a.me.status), ['done', 'done', 'done', 'missed', 'done']);
      assert.equal(past.report.me.attended, 4);
      assert.equal(past.mate.isBot, false, '기록용 상대에는 데모 메이트 배지 없음');
      assert.equal(past.label, '첫 베타기간');
      assert.equal(past.headline, '오후 7:00 ~ 오후 9:00 5일간의 실서비스');
    });

    test('공용 데모 계정은 데모 메이트하고만 매칭', async () => {
      const { seedBots } = await import('../server/seed.js');
      await seedBots(db); // 김저녁: 성곡도서관, 평일 19~21시, 보증금 5천
      const demoId = (await S.demoLogin(db)).user.id;
      const real = await signup('real');
      const req = { ...baseReq, days: [1], startTime: '19:00', endTime: '21:00', deposit: 5000 };

      // 데모 계정은 데모 메이트(김저녁)와 매칭
      const { matchId } = await S.createRequest(db, demoId, req);
      assert.equal((await S.currentMatch(db, demoId)).mate.name, '김저녁');
      await S.leaveMatch(db, demoId, matchId);

      // 데모 메이트가 없는 조건: 실제 사용자가 먼저 기다려도 데모 계정과는 매칭되지 않음
      const other = { ...baseReq, location: '북악관 1층 라운지' };
      await S.createRequest(db, real, other);
      assert.equal((await S.createRequest(db, demoId, other)).matchId, null);
      // 반대로 데모 계정이 기다리는 중에 실제 사용자가 신청해도 매칭되지 않음
      await S.cancelRequest(db, real);
      assert.equal((await S.createRequest(db, real, other)).matchId, null);
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
