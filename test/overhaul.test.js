// 2026-11-18 개편: ① 전화번호 간편 가입 ② 보증금 계좌이체(포인트 없음) ③ 이용 후기
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';
import { ADMIN_PHONES } from '../server/options.js';

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
      assert.equal(u.isAdmin, false, 'ADMIN_PHONES에 없으면 일반 사용자');
      assert.equal(u.points, undefined, '포인트는 없앴다');

      await assert.rejects(S.signup(db, { name: '다른이', phone: '01012345678', password: '0000' }, PHONE), /이미 가입된 전화번호/);
      await assert.rejects(S.signup(db, { name: 'x', phone: '010-9999-8888', password: '123' }, PHONE), /4자리/);
      await assert.rejects(S.signup(db, { name: 'x', phone: '010-9999-8888', password: 'abcd' }, PHONE), /4자리/);
      await assert.rejects(S.signup(db, { name: ' ', phone: '010-9999-8888', password: '1234' }, PHONE), /닉네임/);
      await assert.rejects(S.signup(db, { name: 'y', phone: '02-123-4567', password: '1234' }, PHONE), /전화번호/);

      const ok = await S.login(db, { phone: '010-1234-5678', password: '1234' }, PHONE);
      assert.equal(ok.user.id, u.id);
      await assert.rejects(S.login(db, { phone: '010-1234-5678', password: '0000' }, PHONE), /전화번호 또는 비밀번호/);
      await assert.rejects(S.login(db, { phone: '010-0000-0000', password: '1234' }, PHONE), /전화번호 또는 비밀번호/);
    });

    test('전화번호 가입: 운영자 번호로 가입하면 개발자 화면 권한', async () => {
      if (!ADMIN_PHONES.length) return; // 운영자 번호가 설정된 경우에만
      const admin = await joinPhone('운영', ADMIN_PHONES[0]);
      assert.equal(admin.isAdmin, true, '운영자 전화번호로 가입하면 isAdmin');
      await S.assertAdmin(db, admin.id);
      const normal = await joinPhone('일반', '010-0101-0101');
      assert.equal(normal.isAdmin, false);
      await assert.rejects(S.assertAdmin(db, normal.id), /관리자만/);
    });

    // ───── ③ 보증금: 계좌이체라 앱은 포인트로 돈을 움직이지 않는다 ─────
    test('보증금 계좌이체: 매칭·신청에 포인트 이동이 없다', async () => {
      const a = (await joinPhone('a', '010-1111-1111')).id;
      const b = (await joinPhone('b', '010-2222-2222')).id;
      const r = await S.createRequest(db, a, baseReq);
      assert.equal(r.request.deposit, 0, '신청에는 보증금 금액(포인트)이 없다');
      const { matchId } = await S.createRequest(db, b, baseReq);
      assert.ok(matchId);
      assert.equal((await S.currentMatch(db, a)).stake, 0, '매칭 보증금(포인트)은 0');
    });

    // ───── ① 이용 후기 ─────
    test('이용 후기: 별점 1~5 필수, 서술형 선택, 약속당 사람별 1개', async () => {
      const a = (await joinPhone('a', '010-1212-1212')).id;
      const b = (await joinPhone('b', '010-3434-3434')).id;
      await S.createRequest(db, a, baseReq);
      await S.createRequest(db, b, baseReq);
      const appt = (await S.currentMatch(db, a)).appointments[0];

      await assert.rejects(S.submitReview(db, a, appt.id, { rating: 0 }), /별점/);
      await assert.rejects(S.submitReview(db, a, appt.id, { rating: 6 }), /별점/);
      await S.submitReview(db, a, appt.id, { rating: 5, comment: '좋았어요' });
      await assert.rejects(S.submitReview(db, a, appt.id, { rating: 4 }), /이미 후기/);
      await S.submitReview(db, b, appt.id, { rating: 3 }); // 서술형 없이도 가능

      const c = (await joinPhone('c', '010-7777-8888')).id;
      await assert.rejects(S.submitReview(db, c, appt.id, { rating: 5 })); // 당사자 아님

      const reviews = await S.recentReviews(db);
      assert.equal(reviews.length, 2);
      assert.equal(reviews.find((r) => r.name === 'a').comment, '좋았어요');
      assert.equal(reviews.find((r) => r.name === 'b').comment, null);
    });
  });
}
