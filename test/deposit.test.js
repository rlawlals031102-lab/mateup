// 보증금(계좌이체): 결제 대상자에게만 계좌 노출, 운영자 수동 상태 변경. 앱은 돈을 움직이지 않는다.
// 계좌 정보는 환경변수로만 받으므로, 테스트에서는 DEPOSIT 객체를 직접 채워서 확인한다.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { DEPOSIT } from '../server/options.js';
import { setNow, kst } from '../server/time.js';

const NO = { domain: null, verify: false };
const DRIVERS = { sqlite: () => openSqlite(':memory:'), postgres: () => openPglite() };

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(`deposit/${name}`, () => {
    let db; let saved;
    beforeEach(async () => {
      setNow(kst(2026, 10, 31, 9, 0));
      saved = { ...DEPOSIT };
      Object.assign(DEPOSIT, { enabled: true, account: '110-547-243750', bank: '신한', holder: '김*민', amount: 5000, refundMinutes: 10 });
      db = await open();
    });
    afterEach(async () => { Object.assign(DEPOSIT, saved); setNow(null); await db.close?.(); });

    const user = async (email, phone, nm = email) =>
      (await S.signup(db, { email, password: 'pw1234', name: nm, department: '경영정보학부', phone }, NO)).user;
    const makeMatch = async (aId, bId, status = 'active') => {
      await db.run(
        "INSERT INTO matches (user_a, user_b, days, start_time, end_time, location, styles, week_start, week_end, status, created_at) VALUES (?, ?, '[]', '17:00', '18:00', '채팅으로 정하기', '[]', '2026-11-23', '2026-11-29', ?, ?)",
        aId, bId, status, new Date().toISOString(),
      );
      return (await db.get('SELECT id FROM matches ORDER BY id DESC LIMIT 1')).id;
    };

    test('결제 대상자(매칭된 사람)에게만 계좌가 보이고, 운영자가 상태를 바꾼다', async () => {
      const a = await user('a@x.com', '010-1111-1111');
      const b = await user('b@x.com', '010-2222-2222');
      const mid = await makeMatch(a.id, b.id);

      const da = await S.depositInfo(db, a.id);
      assert.equal(da.required, true);
      assert.equal(da.amount, 5000);
      assert.equal(da.refundMinutes, 10);
      assert.equal(da.account, '110-547-243750');
      assert.equal(da.status, 'pending');

      await S.setDepositStatus(db, mid, a.id, 'paid');
      assert.equal((await S.depositInfo(db, a.id)).status, 'paid');
      // 같은 상태를 다시 설정해도 중복 처리 없이 그대로 (멱등)
      await S.setDepositStatus(db, mid, a.id, 'paid');
      assert.equal((await S.depositInfo(db, a.id)).status, 'paid');
      await assert.rejects(S.setDepositStatus(db, mid, a.id, '아무거나'), /보증금 상태/);
    });

    test('매칭 없는 사람은 보증금을 요구하지 않는다', async () => {
      const c = await user('c@x.com', '010-3333-3333');
      assert.equal((await S.depositInfo(db, c.id)).required, false);
    });

    test('데모 메이트(봇)와의 매칭은 보증금이 없다', async () => {
      const a = await user('a2@x.com', '010-4444-4444');
      await db.run("INSERT INTO users (email, password_hash, name, points, is_bot, created_at) VALUES ('bot@x.com', 'x', '봇메이트', 0, 1, ?)", new Date().toISOString());
      const bot = await db.get("SELECT id FROM users WHERE email = 'bot@x.com'");
      await makeMatch(a.id, bot.id);
      assert.equal((await S.depositInfo(db, a.id)).required, false);
    });

    test('계좌 미설정(운영자 설정 전)이면 보증금을 요구하지 않는다 — 공개 유출 방지', async () => {
      DEPOSIT.account = '';
      const a = await user('a3@x.com', '010-5555-5555');
      const b = await user('b3@x.com', '010-6666-6666');
      await makeMatch(a.id, b.id);
      assert.equal((await S.depositInfo(db, a.id)).required, false);
    });
  });
}
