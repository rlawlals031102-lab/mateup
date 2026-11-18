// 2026-11-18 개편: ① 전화번호 간편 가입 ② 보증금(포인트) 부활 ③ 이용 후기 + 포인트 상점
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';
import { DEPOSIT_POINTS, SIGNUP_POINTS, ADMIN_PHONES } from '../server/options.js';

const ROOM = '지정 강의실 (미래관 320호)';
const baseReq = { days: [2, 3, 4], location: ROOM, styles: ['check'] };
const PHONE = { mode: 'phone', consent: false }; // 전화번호 가입 정책 (실서비스 index.js 와 동일)

const DRIVERS = { sqlite: () => openSqlite(':memory:'), postgres: () => openPglite() };

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(`overhaul/${name}`, () => {
    let db;
    beforeEach(async () => { setNow(kst(2026, 10, 31, 9, 0)); db = await open(); });
    afterEach(async () => { setNow(null); await db.close?.(); });

    const joinPhone = async (nick, phone) =>
      (await S.signup(db, { name: nick, phone, password: '1234' }, PHONE)).user;

    // ───── ② 전화번호 간편 가입 ─────
    test('전화번호 가입/로그인: 이메일·인증번호 없이 닉네임+전화번호+4자리 비번', async () => {
      const u = await joinPhone('빈이', '010-1234-5678');
      assert.equal(u.name, '빈이');
      assert.equal(u.points, SIGNUP_POINTS, '가입 시작 포인트 지급');
      assert.equal(u.isAdmin, false, 'ADMIN_PHONES 비어 있으면 일반 사용자');

      // 같은 전화번호(형식 달라도) 재가입 불가
      await assert.rejects(S.signup(db, { name: '다른이', phone: '01012345678', password: '0000' }, PHONE), /이미 가입된 전화번호/);
      // 비번은 숫자 4자리만
      await assert.rejects(S.signup(db, { name: 'x', phone: '010-9999-8888', password: '123' }, PHONE), /4자리/);
      await assert.rejects(S.signup(db, { name: 'x', phone: '010-9999-8888', password: 'abcd' }, PHONE), /4자리/);
      // 닉네임 1~20자, 전화번호 형식 검사
      await assert.rejects(S.signup(db, { name: ' ', phone: '010-9999-8888', password: '1234' }, PHONE), /닉네임/);
      await assert.rejects(S.signup(db, { name: 'y', phone: '02-123-4567', password: '1234' }, PHONE), /전화번호/);

      // 로그인: 전화번호 + 비번
      const ok = await S.login(db, { phone: '010-1234-5678', password: '1234' }, PHONE);
      assert.equal(ok.user.id, u.id);
      await assert.rejects(S.login(db, { phone: '010-1234-5678', password: '0000' }, PHONE), /전화번호 또는 비밀번호/);
      await assert.rejects(S.login(db, { phone: '010-0000-0000', password: '1234' }, PHONE), /전화번호 또는 비밀번호/);
    });

    test('전화번호 가입: 운영자 번호로 가입하면 개발자 화면 권한', async () => {
      if (!ADMIN_PHONES.length) return; // 운영자 번호가 설정된 경우에만
      const admin = await joinPhone('운영', ADMIN_PHONES[0]);
      assert.equal(admin.isAdmin, true, '운영자 전화번호로 가입하면 isAdmin');
      await S.assertAdmin(db, admin.id); // 던지지 않으면 통과
      const normal = await joinPhone('일반', '010-0101-0101');
      assert.equal(normal.isAdmin, false);
      await assert.rejects(S.assertAdmin(db, normal.id), /관리자만/);
    });

    // ───── ③ 보증금(포인트) 부활 ─────
    test('보증금: 신청 때 예치, 취소하면 환불', async () => {
      const a = (await joinPhone('a', '010-1111-1111')).id;
      await S.createRequest(db, a, baseReq);
      assert.equal((await S.pointsState(db, a)).balance, SIGNUP_POINTS - DEPOSIT_POINTS, '신청하면 보증금 예치');
      await S.cancelRequest(db, a);
      assert.equal((await S.pointsState(db, a)).balance, SIGNUP_POINTS, '취소하면 환불');
    });

    test('보증금: 메이트가 안 오면 지킨 사람이 가져간다', async () => {
      const a = (await joinPhone('a', '010-1111-2222')).id;
      const b = (await joinPhone('b', '010-3333-4444')).id;
      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      const m = await S.currentMatch(db, a);
      // a만 세 번 다 출석(b가 a의 코드로 확인), b는 한 번도 안 나옴
      for (const [i, appt] of m.appointments.entries()) {
        setNow(kst(2026, 11, 17 + i, 19, 0));
        await S.confirmMate(db, b, appt.id, appt.myCode);
        setNow(kst(2026, 11, 17 + i, 21, 30));
        await S.checkOut(db, a, appt.id);
      }
      setNow(kst(2026, 11, 20, 9, 0));
      await S.settleMatch(db, matchId);
      assert.equal((await S.pointsState(db, a)).balance, SIGNUP_POINTS + DEPOSIT_POINTS, 'a: 반환 + b 보증금 보상');
      assert.equal((await S.pointsState(db, b)).balance, SIGNUP_POINTS - DEPOSIT_POINTS, 'b: 안 와서 몰수');
    });

    test('보증금: 포인트가 모자라면 신청 불가', async () => {
      const a = (await joinPhone('a', '010-5555-6666')).id;
      await S.requestRedemption(db, a, 'cu5000'); // 5000
      await S.requestRedemption(db, a, 'cu5000'); // 5000 → 잔액 0
      assert.equal((await S.pointsState(db, a)).balance, 0);
      await assert.rejects(S.createRequest(db, a, baseReq), /포인트가 부족/);
    });

    // ───── ① 이용 후기 ─────
    test('이용 후기: 별점 1~5 필수, 서술형 선택, 약속당 사람별 1개', async () => {
      const a = (await joinPhone('a', '010-1212-1212')).id;
      const b = (await joinPhone('b', '010-3434-3434')).id;
      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      const appt = (await S.currentMatch(db, a)).appointments[0];

      await assert.rejects(S.submitReview(db, a, appt.id, { rating: 0 }), /별점/);
      await assert.rejects(S.submitReview(db, a, appt.id, { rating: 6 }), /별점/);
      await S.submitReview(db, a, appt.id, { rating: 5, comment: '좋았어요' });
      await assert.rejects(S.submitReview(db, a, appt.id, { rating: 4 }), /이미 후기/);
      await S.submitReview(db, b, appt.id, { rating: 3 }); // 서술형 없이도 가능

      // 매칭 당사자가 아니면 후기 불가
      const c = (await joinPhone('c', '010-7777-8888')).id;
      await assert.rejects(S.submitReview(db, c, appt.id, { rating: 5 }));

      const reviews = await S.recentReviews(db);
      assert.equal(reviews.length, 2);
      assert.equal(reviews.find((r) => r.name === 'a').comment, '좋았어요');
      assert.equal(reviews.find((r) => r.name === 'b').comment, null);
      assert.ok(matchId);
    });

    // ───── 포인트 상점 (기프티콘, 운영진 수동) ─────
    test('포인트 상점: 교환 신청하면 차감 + 대기, 운영진이 완료 처리', async () => {
      const a = (await joinPhone('a', '010-9090-9090')).id;
      const st = await S.pointsState(db, a);
      assert.equal(st.balance, SIGNUP_POINTS);
      assert.ok(st.items.length > 0, '상점 목록이 있다');
      await assert.rejects(S.requestRedemption(db, a, 'nope'), /상품/);

      const r = await S.requestRedemption(db, a, 'cafe'); // 5000
      assert.equal(r.balance, SIGNUP_POINTS - 5000);
      const pending = await S.pendingRedemptions(db);
      assert.equal(pending.length, 1);
      assert.equal(pending[0].item, '카페 아메리카노');
      assert.equal(pending[0].phone, '010-9090-9090', '운영진이 보내 줄 전화번호가 보인다');

      await S.fulfillRedemption(db, pending[0].id);
      assert.equal((await S.pendingRedemptions(db)).length, 0);
      await assert.rejects(S.fulfillRedemption(db, pending[0].id), /처리할/);

      await assert.rejects(S.requestRedemption(db, a, 'chicken'), /포인트가 부족/); // 15000 > 5000
    });
  });
}
