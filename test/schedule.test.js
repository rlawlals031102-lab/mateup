// 매일 일정(회차 없음): 오늘부터 7일, 매일 17~22시 / 시간표 09~22시 1시간 칸 / 예전 칸 옮기기 / 이용 후기
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';
import { STUDY_PERIOD, TIME_SLOTS, roomLocation } from '../server/options.js';
import { migrate } from '../server/migrate.js';

const ROOM = '지정 강의실 (미래관 320호)';
const CHAT = '채팅으로 정하기'; // 11/23·24는 지정 강의실을 못 고르므로 그날 신청은 채팅으로

test('시간표 칸: 09~22시 1시간 13칸', () => {
  assert.equal(TIME_SLOTS.length, 13);
  assert.deepEqual(TIME_SLOTS[0], { start: '09:00', end: '10:00' });
  assert.deepEqual(TIME_SLOTS.at(-1), { start: '21:00', end: '22:00' });
});

test('스터디 날짜: 오늘부터 7일(매일), 오늘 22시가 지나면 내일부터', () => {
  setNow(kst(2026, 11, 22, 10, 0)); // 일요일 오전
  assert.deepEqual(STUDY_PERIOD.dates, ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']);
  assert.deepEqual([STUDY_PERIOD.start, STUDY_PERIOD.end], ['17:00', '22:00']);
  setNow(kst(2026, 11, 22, 22, 0)); // 오늘 공부 시간이 끝남
  assert.equal(STUDY_PERIOD.dates[0], '2026-11-23');
  assert.equal(STUDY_PERIOD.dates.at(-1), '2026-11-29');
  setNow(null);
});

test('신청 검증: 월~일 어느 요일이든, 시간은 17~22시 칸만', () => {
  setNow(kst(2026, 11, 22, 10, 0));
  const r = S.validateRequest({ days: [6, 7], location: ROOM, styles: ['check'] });
  assert.deepEqual([r.days, r.startTime, r.endTime], [[6, 7], '17:00', '22:00']);
  assert.deepEqual(r.cells, ['6-8', '6-9', '6-10', '6-11', '6-12', '7-8', '7-9', '7-10', '7-11', '7-12']);
  // 17시 전 칸(09:00 = 0번)은 버린다
  const one = S.validateRequest({ days: [1], location: CHAT, styles: ['check'], cells: ['1-0', '1-9'] });
  assert.deepEqual([one.cells, one.startTime, one.endTime], [['1-9'], '18:00', '19:00']);
  setNow(null);
});

test('지정 강의실: 날짜마다 다른 강의실, 11/23·24는 채팅, 12/4부터는 아직 없음', () => {
  assert.equal(roomLocation(ROOM, '2026-11-25'), '지정 강의실 (공학관 B119호)');
  assert.equal(roomLocation(ROOM, '2026-11-27'), '지정 강의실 (미래관 320호)');
  assert.equal(roomLocation(ROOM, '2026-11-24'), CHAT);
  assert.equal(roomLocation(ROOM, '2026-12-03'), '지정 강의실 (공학관 B119호)');
  assert.equal(roomLocation(ROOM, '2026-12-04'), '지정 강의실 (아직 배정된 강의실이 없어요)');
  assert.equal(roomLocation(ROOM, '2026-11-20'), ROOM);
  assert.equal(roomLocation(CHAT, '2026-11-25'), CHAT);
});

test('11/23·24만 고르면 지정 강의실 불가, 다른 날과 같이 고르면 가능', () => {
  setNow(kst(2026, 11, 22, 10, 0));
  assert.throws(() => S.validateRequest({ days: [1], locations: [ROOM], styles: ['check'] }), /11\/23은 지정 강의실/);
  assert.throws(() => S.validateRequest({ days: [1, 2], locations: [ROOM, CHAT], styles: ['check'] }), /지정 강의실/);
  assert.ok(S.validateRequest({ days: [1, 3], locations: [ROOM], styles: ['check'] }));
  assert.ok(S.validateRequest({ days: [1], locations: [CHAT], styles: ['check'] }));
  setNow(null);
});

test('매칭: 11/23은 채팅으로 정하기, 다른 날은 지정 강의실', () => {
  setNow(kst(2026, 11, 22, 10, 0));
  const room = { days: [1, 3], cells: ['1-10', '3-10'], locations: [ROOM], styles: ['check'] };
  // 둘 다 지정 강의실: 두 날 모두 약속, 매칭 장소는 지정 강의실 (23일 약속은 채팅으로 정하기로 보임)
  const c = S.compatibility(room, room);
  assert.deepEqual([c.days, c.location], [[1, 3], ROOM]);
  // 한 사람은 채팅으로 정하기만: 23일만 겹쳐서 채팅으로 정하기
  const chat = S.compatibility(room, { ...room, locations: [CHAT] });
  assert.deepEqual([chat.days, chat.location], [[1], CHAT]);
  setNow(null);
});

test('예전 시간표 칸(번호가 범위 밖)이 남아 있어도 멈추지 않음', () => {
  const c = S.compatibility(
    { days: [1], location: ROOM, styles: ['check'], cells: ['1-9', '1-10', '1-40'] },
    { days: [1], location: ROOM, styles: ['check'], cells: ['1-9', '1-10'] },
  );
  assert.deepEqual([c.startTime, c.endTime], ['18:00', '20:00']);
});

test('m002: 예전 12칸 개인 일정을 새 칸으로 옮기고, 실제 사용자의 대기 신청은 취소', async () => {
  const db = await openSqlite(':memory:');
  await db.run(
    "INSERT INTO users (email, password_hash, name, created_at, personal) VALUES ('a@kookmin.ac.kr', 'h', 'A', 'now', ?)",
    JSON.stringify([
      { cell: '1-0', title: '아침' }, // 09:00~10:30 → 09·10시
      { cell: '1-7', title: '수업' }, // 19:00~20:00 → 19시
      { cell: '1-11', title: '밤' }, // 23:00~24:00 → 없어짐
    ]),
  );
  await db.run(
    `INSERT INTO match_requests (user_id, days, start_time, end_time, location, styles, deposit, cells, created_at)
     VALUES (1, '[2]', '19:00', '21:00', '[]', '[]', 0, '["2-7"]', 'now')`,
  );
  await db.run("DELETE FROM schema_migrations WHERE id = 'm002'");
  assert.deepEqual(await migrate(db), ['m002']);
  assert.deepEqual(JSON.parse((await db.get('SELECT personal FROM users WHERE id = 1')).personal), [
    { cell: '1-0', title: '아침' }, { cell: '1-1', title: '아침' }, { cell: '1-10', title: '수업' },
  ]);
  assert.equal((await db.get('SELECT status FROM match_requests WHERE id = 1')).status, 'cancelled');
  await db.close?.();
});

const DRIVERS = { sqlite: () => openSqlite(':memory:'), postgres: () => openPglite() };
for (const [name, open] of Object.entries(DRIVERS)) {
  describe(`이용 후기/${name}`, () => {
    let db;
    beforeEach(async () => { setNow(kst(2026, 11, 22, 10, 0)); db = await open(); });
    afterEach(async () => { setNow(null); await db.close?.(); });

    test('매칭된 사람만 약속마다 한 번, 별점 1~5', async () => {
      const join = async (email) => (await S.signup(db, {
        email, password: 'secret1', name: email[0], department: '경영정보학부', phone: '010-1234-5678',
      })).user.id;
      const a = await join('a@test.dev');
      const b = await join('b@test.dev');
      const c = await join('c@test.dev');
      const req = { days: [1], location: CHAT, styles: ['check'] };
      await S.createRequest(db, a, req);
      const { matchId } = await S.createRequest(db, b, req);
      assert.ok(matchId);
      const appt = await db.get('SELECT id FROM appointments WHERE match_id = ?', matchId);
      await assert.rejects(S.submitReview(db, a, appt.id, { rating: 0 }), /별점/);
      assert.deepEqual(await S.submitReview(db, a, appt.id, { rating: 5, comment: ' 좋았어요 ' }), { ok: true });
      await assert.rejects(S.submitReview(db, a, appt.id, { rating: 4 }), /이미 후기/);
      await assert.rejects(S.submitReview(db, c, appt.id, { rating: 4 }));
      const [v] = await S.recentReviews(db);
      assert.deepEqual([v.rating, v.comment, v.name], [5, '좋았어요', 'a']);
    });
  });
}

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(`리포트 시점/${name}`, () => {
    let db;
    beforeEach(async () => { setNow(kst(2026, 11, 22, 10, 0)); db = await open(); });
    afterEach(async () => { setNow(null); await db.close?.(); });

    // 월요일(11/23) 17~22시 약속 하나짜리 매칭
    const pair = async () => {
      const join = async (email) => (await S.signup(db, {
        email, password: 'secret1', name: email[0], department: '경영정보학부', phone: '010-1234-5678',
      })).user.id;
      const a = await join('a@test.dev');
      const b = await join('b@test.dev');
      const req = { days: [1], location: CHAT, styles: ['check'] };
      await S.createRequest(db, a, req);
      const { matchId } = await S.createRequest(db, b, req);
      const appt = await db.get('SELECT * FROM appointments WHERE match_id = ?', matchId);
      return { a, b, matchId, appt };
    };
    const status = async (id) => (await db.get('SELECT status FROM matches WHERE id = ?', id)).status;

    test('마지막 약속 시간이 끝나면 주간이 끝나기 전이어도 바로 리포트', async () => {
      const { matchId } = await pair();
      setNow(kst(2026, 11, 23, 21, 59));
      await S.autoSettle(db);
      assert.equal(await status(matchId), 'active');
      setNow(kst(2026, 11, 23, 22, 0));
      await S.autoSettle(db);
      assert.equal(await status(matchId), 'reported');
    });

    test('마지막 약속에서 두 사람 모두 공부를 마치면 약속 시간 전이어도 바로 리포트, 한 사람만이면 기다림', async () => {
      const { a, b, matchId, appt } = await pair();
      setNow(kst(2026, 11, 23, 17, 0));
      const codeA = (await S.myAttendanceCode(db, a, appt.id)).code;
      const codeB = (await S.myAttendanceCode(db, b, appt.id)).code;
      await S.confirmMate(db, a, appt.id, codeB);
      await S.confirmMate(db, b, appt.id, codeA);
      setNow(kst(2026, 11, 23, 19, 0));
      await S.checkOut(db, a, appt.id);
      await S.autoSettle(db);
      assert.equal(await status(matchId), 'active');
      await S.checkOut(db, b, appt.id);
      await S.autoSettle(db);
      assert.equal(await status(matchId), 'reported');
    });
  });
}
