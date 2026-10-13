import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import * as S from '../server/service.js';
import { setNow } from '../server/time.js';

// 2026-10-12 는 월요일
const MON_9AM = new Date(2026, 9, 12, 9, 0);

let db;
beforeEach(() => {
  setNow(MON_9AM);
  db = openDb(':memory:');
});
afterEach(() => setNow(null));

const signup = (name) => {
  const { user } = S.signup(db, { email: `${name}@test.dev`, password: 'secret1', name, age: 22 });
  return user.id;
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

  assert.equal(S.compatibility(a, { ...b, location: '온라인 (캠스터디)' }), null);
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

test('전체 흐름: 매칭 → 출석 → 정산(보증금 이전) → 계속하기', () => {
  const a = signup('a');
  const b = signup('b');

  const r1 = S.createRequest(db, a, { ...baseReq, deposit: 10000 });
  assert.equal(r1.matchId, null);
  assert.equal(S.homeState(db, a).user.points, 40000);

  // 금액이 다르면 낮은 쪽(5000)에 맞추고 차액 반환
  const r2 = S.createRequest(db, b, { ...baseReq, deposit: 5000 });
  assert.ok(r2.matchId);
  assert.equal(S.homeState(db, a).user.points, 45000);
  assert.equal(S.homeState(db, b).user.points, 45000);

  const m = S.currentMatch(db, a);
  assert.equal(m.stake, 5000);
  assert.deepEqual(m.appointments.map((x) => x.date), ['2026-10-12', '2026-10-14', '2026-10-16']);
  assert.equal(m.mate.name, 'b');

  // 출석 가능 시간 전에는 거절
  assert.throws(() => S.checkIn(db, a, m.appointments[0].id, { method: 'self' }), /출석은/);

  // A는 세 번 모두 출석(QR), B는 첫 날만 출석
  m.appointments.forEach((appt, i) => {
    setNow(new Date(2026, 9, 12 + i * 2, 19, 0));
    assert.throws(() => S.checkIn(db, a, appt.id, { method: 'qr', code: 'WRONG1' }), /일치하지/);
    S.checkIn(db, a, appt.id, { method: 'qr', code: appt.code });
    if (i === 0) S.checkIn(db, b, appt.id, { method: 'self' });
    setNow(new Date(2026, 9, 12 + i * 2, 21, 30));
    assert.equal(S.checkOut(db, a, appt.id).minutes, 150);
  });

  // 주간이 끝나면 자동 정산
  setNow(new Date(2026, 9, 19, 9, 0));
  const reported = S.currentMatch(db, a);
  assert.equal(reported.status, 'reported');
  assert.equal(reported.report.me.rate, 100);
  assert.equal(reported.report.me.minutes, 450);
  assert.equal(reported.report.me.deposit.result, 'refunded');
  assert.equal(reported.report.mate.deposit.result, 'to_mate');
  assert.equal(reported.report.mate.attended, 1);
  // B는 체크아웃을 안 했으므로 약속 종료 시각까지로 계산 (19:00~22:00)
  assert.equal(reported.report.mate.minutes, 180);

  assert.equal(S.homeState(db, a).user.points, 45000 + 5000 + 5000);
  assert.equal(S.homeState(db, b).user.points, 45000);

  // 둘 다 계속하기 → 새 주간 생성, 보증금 재예치
  assert.equal(S.chooseNext(db, a, m.id, 'continue').next, 'waiting');
  const next = S.chooseNext(db, b, m.id, 'continue');
  assert.equal(next.next, 'continue');
  const m2 = S.currentMatch(db, a);
  assert.equal(m2.id, next.matchId);
  assert.equal(m2.round, 2);
  assert.equal(m2.stake, 5000);
  assert.equal(S.homeState(db, a).user.points, 50000);
  assert.equal(S.matchHistory(db, a).length, 1);
});

test('새 메이트 선택 시 매칭 종료, 다시 신청 가능', () => {
  const a = signup('a');
  const b = signup('b');
  S.createRequest(db, a, baseReq);
  const { matchId } = S.createRequest(db, b, baseReq);
  assert.throws(() => S.createRequest(db, a, baseReq), /진행 중/);
  S.settleMatch(db, matchId);
  assert.equal(S.chooseNext(db, a, matchId, 'new').next, 'new');
  assert.equal(S.currentMatch(db, a), null);
  assert.equal(S.currentMatch(db, b), null);
  assert.doesNotThrow(() => S.createRequest(db, a, baseReq));
});

test('신청 취소 시 보증금 반환, 다른 사람 매칭 접근 차단', () => {
  const a = signup('a');
  const b = signup('b');
  const c = signup('c');
  S.createRequest(db, a, { ...baseReq, deposit: 20000 });
  S.cancelRequest(db, a);
  assert.equal(S.homeState(db, a).user.points, 50000);

  S.createRequest(db, a, baseReq);
  const { matchId } = S.createRequest(db, b, baseReq);
  assert.throws(() => S.listMessages(db, c, matchId), /찾을 수 없어요/);
  S.sendMessage(db, a, matchId, '안녕하세요');
  assert.equal(S.listMessages(db, b, matchId).length, 1);
});

test('로그인 / 토큰', () => {
  signup('a');
  assert.throws(() => S.signup(db, { email: 'a@test.dev', password: 'secret1', name: 'x' }), /이미 가입/);
  assert.throws(() => S.login(db, { email: 'a@test.dev', password: 'nope' }), /올바르지/);
  const { token } = S.login(db, { email: 'A@test.dev', password: 'secret1' });
  assert.equal(S.userByToken(db, token).name, 'a');
  S.logout(db, token);
  assert.equal(S.userByToken(db, token), null);
});
