// 전화번호 가입/로그인 — 인증 없이 닉네임 + 전화번호 + 4자리 PIN. 전화번호는 연락처용(인증 아님).
// 기존 국민대 메일 가입자는 그대로 이메일 로그인 유지.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';

const DRIVERS = { sqlite: () => openSqlite(':memory:'), postgres: () => openPglite() };

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(`phone-auth/${name}`, () => {
    let db;
    beforeEach(async () => { setNow(kst(2026, 10, 31, 9, 0)); db = await open(); });
    afterEach(async () => { setNow(null); await db.close?.(); });

    const signup = (phone, pin = '1234', nm = '빈이') => S.signupPhone(db, { phone, pin, name: nm }, {});

    test('무인증: 닉네임 + 전화번호 + 4자리 PIN 으로 가입하고 로그인한다', async () => {
      const { user } = await signup('010-1234-5678', '1234', '빈이');
      assert.equal(user.name, '빈이');
      assert.equal(user.isAdmin, false);

      const ok = await S.loginPhone(db, { phone: '01012345678', pin: '1234' });
      assert.equal(ok.user.id, user.id, '하이픈 없이 입력해도 같은 계정');
      await assert.rejects(S.loginPhone(db, { phone: '010-1234-5678', pin: '0000' }), /전화번호 또는 비밀번호/);
      await assert.rejects(S.loginPhone(db, { phone: '010-0000-0000', pin: '1234' }), /전화번호 또는 비밀번호/);
    });

    test('PIN 은 숫자 4자리만, 전화번호 형식·중복을 거부한다', async () => {
      await assert.rejects(signup('010-1111-2222', '123'), /4자리/);
      await assert.rejects(signup('010-1111-2222', 'abcd'), /4자리/);
      await assert.rejects(signup('010-1111-2222', '12345'), /4자리/);
      await assert.rejects(signup('02-123-4567', '1234'), /전화번호/);
      await signup('010-3333-4444', '1234', 'a');
      await assert.rejects(signup('010-3333-4444', '5678', 'b'), /이미 가입/);
    });

    test('pin 또는 password 어느 키로 와도 받는다', async () => {
      await S.signupPhone(db, { phone: '010-7000-8000', password: '4321', name: 'c' }, {});
      const ok = await S.loginPhone(db, { phone: '010-7000-8000', password: '4321' });
      assert.ok(ok.user.id);
    });

    test('전화번호만으로는 관리자 권한을 얻을 수 없다 (취약점 차단)', async () => {
      const { user } = await signup('010-7777-8888', '1234', '관리자');
      assert.equal(user.isAdmin, false);
      await assert.rejects(S.assertAdmin(db, user.id), /관리자만/);
    });

    test('기존 이메일 가입자는 그대로 유지된다 (이메일 로그인 계속 동작)', async () => {
      const NO = { domain: null, verify: false };
      await S.signup(db, { email: 'old@kookmin.ac.kr', password: 'secret6', name: '기존', department: '경영', phone: '010-9000-1000' }, NO);
      const ok = await S.login(db, { email: 'old@kookmin.ac.kr', password: 'secret6' }, NO);
      assert.equal(ok.user.name, '기존');
    });
  });
}
