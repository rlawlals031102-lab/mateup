// 보증금(계좌이체) · 사진 · 운영자 화면 · 인증 메일 안정화 테스트
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import { createApp } from '../server/app.js';
import { createRealtime } from '../server/realtime.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';

const DRIVERS = {
  sqlite: () => openSqlite(':memory:'),
  postgres: () => openPglite(),
};

const ROOM = '지정 강의실 (경상관 102A)';
const baseReq = { days: [2, 3, 4], location: ROOM, styles: ['check'] };
const refund = { bank: '국민은행', account: '123456-01-234567', holder: '홍길동' };
const DEP = { deposits: true };

// 1x1 JPEG / PNG
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('보증금 검증: 계좌가 설정된 경우에만, 정해진 금액만', () => {
  setNow(kst(2026, 10, 31, 9, 0));
  assert.equal(S.validateRequest({ ...baseReq, deposit: 10000 }).deposit, 0, '설정이 없으면 무시');
  assert.equal(S.validateRequest({ ...baseReq, deposit: 10000 }, DEP).deposit, 10000);
  assert.throws(() => S.validateRequest({ ...baseReq, deposit: 7000 }, DEP), /금액/);
  // 보증금 건 사람과 안 건 사람은 매칭되지 않음
  const a = { ...baseReq, cells: ['2-7', '2-8'], deposit: 5000 };
  assert.equal(S.compatibility(a, { ...a, deposit: 0 }), null);
  assert.ok(S.compatibility(a, { ...a, deposit: 20000 }));
  setNow(null);
});

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(name, () => {
    let db;
    beforeEach(async () => {
      setNow(kst(2026, 10, 31, 9, 0));
      db = await open();
    });
    afterEach(async () => {
      setNow(null);
      await db.close?.();
    });

    const signup = async (n) => (await S.signup(db, {
      email: `${n}@test.dev`, password: 'secret1', name: n, department: '경영정보학부', phone: '010-1234-5678',
    })).user.id;
    const admin = async () => signup('admin');
    const money = async (uid) => (await db.all('SELECT kind, amount, status FROM money_logs WHERE user_id = ? ORDER BY id', uid))
      .map((r) => ({ kind: r.kind, amount: Number(r.amount), status: r.status }));

    test('1시간 칸: 겹치는 칸만 약속이 되고, 안 겹치면 매칭 안 됨', async () => {
      const [a, b, c] = [await signup('a'), await signup('b'), await signup('c')];
      // a: 화 18–19시, 목 19–21시 / b: 화 18–20시, 목 20–21시 → 화 18–19, 목 20–21
      await S.createRequest(db, a, { ...baseReq, cells: ['2-6', '4-7', '4-8'] });
      assert.equal((await S.createRequest(db, c, { ...baseReq, cells: ['3-6'] })).matchId, null, '수요일만 고른 c는 a와 안 겹침');
      const { matchId } = await S.createRequest(db, b, { ...baseReq, cells: ['2-6', '2-7', '4-8'] });
      assert.ok(matchId);
      const m = await S.currentMatch(db, a);
      assert.deepEqual(m.appointments.map((x) => [x.date, x.startTime, x.endTime]),
        [['2026-11-10', '18:00', '19:00'], ['2026-11-12', '20:00', '21:00']]);
      // 이미 매칭된 칸은 다시 신청 못 하지만, 다른 칸은 가능
      await assert.rejects(S.createRequest(db, a, { ...baseReq, cells: ['2-6'] }), /이미 신청했거나/);
      await S.createRequest(db, a, { ...baseReq, cells: ['2-7'] });
      // 지난 칸은 못 고름
      setNow(kst(2026, 11, 10, 18, 0));
      assert.throws(() => S.validateRequest({ ...baseReq, cells: ['2-6'] }), /지난/);
      assert.doesNotThrow(() => S.validateRequest({ ...baseReq, cells: ['2-7'] }));
    });

    test('보증금: 입금 확인 후 매칭 → 정산 결과대로 환급·보상 장부', async () => {
      const a = await signup('a');
      const b = await signup('b');
      const op = await admin();

      await assert.rejects(S.createRequest(db, a, { ...baseReq, deposit: 10000 }, DEP), /계좌/);
      const r1 = await S.createRequest(db, a, { ...baseReq, deposit: 10000, refund, depositor: '에이' }, DEP);
      assert.equal(r1.awaitingDeposit, true);
      assert.equal(r1.request.status, 'awaiting_deposit');
      const r2 = await S.createRequest(db, b, { ...baseReq, deposit: 20000, refund }, DEP);
      assert.equal(r2.matchId, null, '입금 확인 전에는 매칭되지 않음');
      assert.equal((await S.homeState(db, a)).pendingRequests.length, 1, '홈에는 입금 대기 신청이 보임');
      assert.deepEqual((await S.homeState(db, a)).user.refund, { bank: '국민은행', account: '123456-01-234567', holder: '홍길동' });

      const ov = await S.adminOverview(db);
      assert.equal(ov.deposits.length, 2);
      assert.equal(ov.deposits[0].depositor, '에이');
      assert.equal(ov.deposits[1].depositor, 'b', '입금자명을 안 쓰면 이름');

      assert.equal((await S.confirmDeposit(db, op, ov.deposits[0].id)).matchId, null);
      const { matchId } = await S.confirmDeposit(db, op, ov.deposits[1].id);
      assert.ok(matchId, 'B 입금 확인 → A와 매칭');
      await assert.rejects(S.confirmDeposit(db, op, ov.deposits[1].id), /이미 처리/);

      const m = await S.currentMatch(db, a);
      assert.equal(m.stake, 10000, '낮은 금액에 맞춤');
      assert.deepEqual(await money(b), [
        { kind: 'deposit', amount: 20000, status: 'done' },
        { kind: 'refund', amount: 10000, status: 'todo' }, // 차액 환급
      ]);

      // A만 모두 출석
      const bView = await S.currentMatch(db, b);
      for (const [i, appt] of m.appointments.entries()) {
        setNow(kst(2026, 11, 10 + i, 19, 0));
        await S.confirmMate(db, b, appt.id, appt.myCode);
        if (i === 0) await S.confirmMate(db, a, appt.id, bView.appointments[0].myCode);
      }
      setNow(kst(2026, 11, 13, 9, 0));
      const rep = await S.currentMatch(db, a);
      assert.equal(rep.report.me.deposit.result, 'refunded');
      assert.equal(rep.report.mate.deposit.result, 'to_mate');
      assert.equal(rep.report.me.reward, 10000);
      assert.deepEqual((await money(a)).map((x) => [x.kind, x.amount]), [['deposit', 10000], ['refund', 10000], ['reward', 10000]]);

      // 운영자: 이체할 목록 → 완료 표시
      const todo = (await S.adminOverview(db)).payouts;
      assert.equal(todo.length, 3);
      assert.equal(todo[0].account, '123456-01-234567');
      for (const p of todo) await S.markPayoutDone(db, op, p.id);
      assert.equal((await S.adminOverview(db)).payouts.length, 0);
      assert.equal((await S.myMoney(db, a)).every((x) => x.status === 'done'), true);
    });

    test('보증금: 둘 다 못 지키면 운영진 귀속, 중도 종료는 메이트에게 보상', async () => {
      const [a, b, c, d] = [await signup('a'), await signup('b'), await signup('c'), await signup('d')];
      const op = await admin();
      for (const u of [a, b]) await S.createRequest(db, u, { ...baseReq, deposit: 5000, refund }, DEP);
      for (const l of (await S.adminOverview(db)).deposits) await S.confirmDeposit(db, op, l.id);
      setNow(kst(2026, 11, 13, 9, 0));
      const rep = await S.currentMatch(db, a);
      assert.equal(rep.report.me.deposit.result, 'forfeited');
      assert.deepEqual(await money(a), [
        { kind: 'deposit', amount: 5000, status: 'done' },
        { kind: 'kept', amount: 5000, status: 'done' }, // 돌려주지 않음
      ]);
      assert.equal((await S.adminOverview(db)).payouts.length, 0, '보낼 돈 목록에 없음');
      assert.equal((await S.myMoney(db, a)).at(0).kind, 'kept');

      setNow(kst(2026, 10, 31, 10, 0));
      const req = { ...baseReq, location: '채팅으로 정하기', deposit: 5000, refund };
      for (const u of [c, d]) await S.createRequest(db, u, req, DEP);
      for (const l of (await S.adminOverview(db)).deposits) await S.confirmDeposit(db, op, l.id);
      const m = await S.currentMatch(db, c);
      await S.leaveMatch(db, c, m.id);
      assert.deepEqual((await money(c)).map((x) => x.kind), ['deposit'], '그만둔 사람은 환급 없음');
      assert.deepEqual((await money(d)).map((x) => [x.kind, x.amount]), [['deposit', 5000], ['refund', 5000], ['reward', 5000]]);
    });

    test('보증금: 입금 전 취소 / 입금 후 취소 / 운영자가 미입금 취소', async () => {
      const [a, b, c] = [await signup('a'), await signup('b'), await signup('c')];
      const op = await admin();
      const ra = await S.createRequest(db, a, { ...baseReq, deposit: 5000, refund }, DEP);
      await S.cancelRequest(db, a, ra.request.id);
      assert.deepEqual((await money(a)).map((x) => x.status), ['cancelled'], '입금 전 취소는 장부에서 취소');
      assert.equal((await S.myMoney(db, a)).length, 0);

      const rb = await S.createRequest(db, b, { ...baseReq, deposit: 5000, refund }, DEP);
      await S.confirmDeposit(db, op, (await S.adminOverview(db)).deposits[0].id);
      await S.cancelRequest(db, b, rb.request.id);
      assert.deepEqual((await money(b)).map((x) => [x.kind, x.status]), [['deposit', 'done'], ['refund', 'todo']]);

      await S.createRequest(db, c, { ...baseReq, deposit: 5000, refund }, DEP);
      await S.rejectDeposit(db, op, (await S.adminOverview(db)).deposits[0].id);
      assert.equal((await S.homeState(db, c)).pendingRequests.length, 0);
    });

    test('사진: 프로필·채팅, 보기 권한', async () => {
      const [a, b, c] = [await signup('a'), await signup('b'), await signup('c')];
      await assert.rejects(S.setProfilePhoto(db, a, 'data:text/plain;base64,aGk='), /형식/);
      await assert.rejects(S.setProfilePhoto(db, a, 'data:image/png;base64,aGVsbG8='), /올바르지/);
      const u = await S.setProfilePhoto(db, a, JPEG);
      assert.match(u.photo, /^\/api\/photos\/\d+$/);
      const pid = Number(u.photo.split('/').at(-1));
      assert.equal((await S.getPhoto(db, a, pid)).mime, 'image/jpeg');
      await assert.rejects(S.getPhoto(db, b, pid), /찾을 수 없어요/, '매칭 전 다른 사람은 못 봄');

      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      assert.ok(await S.getPhoto(db, b, pid), '메이트는 볼 수 있음');
      assert.equal((await S.currentMatch(db, b)).mate.photo, u.photo);

      const { photoId } = await S.sendPhoto(db, b, matchId, PNG);
      const msgs = await S.listMessages(db, a, matchId);
      assert.equal(msgs.at(-1).photoId, photoId);
      assert.equal((await S.getPhoto(db, a, photoId)).mime, 'image/png');
      await assert.rejects(S.getPhoto(db, c, photoId), /찾을 수 없어요/);
      assert.ok(await S.getPhoto(db, c, photoId, { admin: true }), '운영자는 볼 수 있음');
      await assert.rejects(S.sendPhoto(db, c, matchId, PNG), /찾을 수 없어요/);

      // 사진 교체·삭제
      const u2 = await S.setProfilePhoto(db, a, PNG);
      assert.notEqual(u2.photo, u.photo);
      await assert.rejects(S.getPhoto(db, a, pid), /찾을 수 없어요/, '예전 사진은 지워짐');
      assert.equal((await S.removeProfilePhoto(db, a)).photo, null);
    });

    test('운영자: 채팅 기록 보기와 열람 기록', async () => {
      const [a, b] = [await signup('a'), await signup('b')];
      const op = await admin();
      await S.createRequest(db, a, baseReq);
      const { matchId } = await S.createRequest(db, b, baseReq);
      await S.sendMessage(db, a, matchId, '안녕하세요');
      await S.sendPhoto(db, b, matchId, JPEG);
      const ov = await S.adminOverview(db);
      assert.equal(ov.matches[0].messageCount, 2);
      const chat = await S.adminChat(db, op, matchId);
      assert.equal(chat.messages.length, 2);
      assert.equal(chat.users[a].name, 'a');
      assert.equal(chat.users[a].phone, '010-1234-5678');
      const log = await db.get('SELECT * FROM admin_logs ORDER BY id DESC LIMIT 1');
      assert.equal(log.action, 'chat_view');
    });

    test('인증 메일: 보내기 실패하면 번호를 지우고 바로 다시 받을 수 있음, 기록 남김', async () => {
      const policy = { domain: 'kookmin.ac.kr', verify: true };
      const email = 'student@kookmin.ac.kr';
      let fail = true;
      const sent = [];
      const mailer = {
        send: async (m) => {
          if (fail) throw Object.assign(new Error('Connection timeout'), { attempts: 4, provider: 'x@gmail.com' });
          sent.push(m);
          return { provider: 'x@gmail.com', attempts: 1 };
        },
      };
      await assert.rejects(S.requestEmailCode(db, mailer, { email, purpose: 'signup' }, policy), /보내지 못했어요/);
      fail = false;
      await S.requestEmailCode(db, mailer, { email, purpose: 'signup' }, policy); // 60초 기다리지 않아도 됨
      const logs = (await S.adminOverview(db)).emailLogs;
      assert.deepEqual(logs.map((l) => l.status), ['sent', 'failed']);
      assert.equal(logs[1].attempts, 4);
      assert.match(logs[1].error, /timeout/);
      assert.equal((await S.adminOverview(db)).stats.mailFailed7d, 1);

      // 늦게 온 첫 메일의 번호도 받아 줌
      const code1 = sent[0].subject.match(/(\d{6})$/)[1];
      setNow(kst(2026, 10, 31, 9, 2));
      await S.requestEmailCode(db, mailer, { email, purpose: 'signup' }, policy);
      const form = { email, password: 'secret1', name: '국민', department: '경영정보학부', phone: '010-1111-2222' };
      const { user } = await S.signup(db, { ...form, code: code1 }, policy);
      assert.equal(user.email, email);
    });

    test('인증 메일: 안 오면 도움 요청 → 운영자가 새 번호 발급 → 가입', async () => {
      const policy = { domain: 'kookmin.ac.kr', verify: true };
      const email = 'late@kookmin.ac.kr';
      const op = await admin();
      await assert.rejects(S.requestEmailHelp(db, { email, purpose: 'signup', name: '', phone: '010-1111-2222' }, policy), /이름/);
      await S.requestEmailHelp(db, { email, purpose: 'signup', name: '늦음', phone: '010-1111-2222' }, policy);
      assert.equal((await S.requestEmailHelp(db, { email, purpose: 'signup', name: '늦음', phone: '010-1111-2222' }, policy)).already, true);
      const [h] = (await S.adminOverview(db)).help;
      assert.equal(h.phone, '010-1111-2222');
      const { code, expiresMin } = await S.issueHelpCode(db, op, h.id);
      assert.equal(expiresMin, 30);
      assert.equal((await S.adminOverview(db)).help.length, 0);
      setNow(kst(2026, 10, 31, 9, 20)); // 일반 번호(10분)보다 길게 유효
      const form = { email, password: 'secret1', name: '늦음', department: '경영정보학부', phone: '010-1111-2222' };
      assert.equal((await S.signup(db, { ...form, code }, policy)).user.email, email);
    });

    test('운영진 메일은 국민대 메일이 아니어도 가입·로그인, /admin 바로가기', async () => {
      const sent = [];
      const mailer = { send: async (m) => { sent.push(m); return { provider: 'x', attempts: 1 }; } };
      const app = createApp({
        db, serveStatic: true, emailPolicy: { domain: 'kookmin.ac.kr', verify: true }, mailer,
        adminEmails: ['Team.Member@Gmail.com'],
      });
      const server = app.listen(0);
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        const post = (path, body) => fetch(`${base}/api${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        // 일반 개인 메일은 거절, 운영진 메일은 인증번호 발송
        assert.equal((await post('/auth/code', { email: 'someone@gmail.com', purpose: 'signup' })).status, 400);
        assert.equal((await post('/auth/code', { email: 'team.member@gmail.com', purpose: 'signup' })).status, 200);
        const code = sent.at(-1).subject.match(/(\d{6})$/)[1];
        const res = await post('/auth/signup', {
          email: 'team.member@gmail.com', code, password: 'secret1', name: '운영진', department: '경영정보학부', phone: '010-9999-0000',
        });
        assert.equal(res.status, 201);
        const cookie = res.headers.get('set-cookie').split(';')[0];
        const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
        assert.equal(me.user.isAdmin, true);
        assert.equal((await fetch(`${base}/api/admin`, { headers: { cookie } })).status, 200);
        assert.equal((await post('/auth/login', { email: 'team.member@gmail.com', password: 'secret1' })).status, 200);

        const r = await fetch(`${base}/admin`, { redirect: 'manual' });
        assert.equal(r.status, 302);
        assert.equal(r.headers.get('location'), '/#/admin');
      } finally {
        server.close();
      }
    });

    test('API: 운영자만 운영자 화면, 사진 요청 크기, 실시간 채널', async () => {
      const app = createApp({
        db, serveStatic: false, adminEmails: ['admin@test.dev'], depositAccount: '국민은행 000-00 메이트업',
        realtime: createRealtime({ url: 'https://example.supabase.co', anonKey: 'anon', secret: 's' }),
      });
      const server = app.listen(0);
      const base = `http://127.0.0.1:${server.address().port}/api`;
      try {
        const call = async (path, { method = 'GET', body, cookie } = {}) => {
          const res = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], json: await res.json().catch(() => null) };
        };
        const join = (n) => call('/auth/signup', { method: 'POST', body: { email: `${n}@test.dev`, password: 'secret1', name: n, department: '학과', phone: '010-1234-5678' } });
        const user = (await join('u')).cookie;
        const op = (await join('admin')).cookie;

        const opt = (await call('/options')).json;
        assert.deepEqual(opt.deposits, { options: [5000, 10000, 20000], account: '국민은행 000-00 메이트업' });
        assert.deepEqual(opt.realtime, { url: 'https://example.supabase.co', anonKey: 'anon' });

        assert.equal((await call('/admin', { cookie: user })).status, 403);
        assert.equal((await call('/admin')).status, 401);
        assert.equal((await call('/admin', { cookie: op })).status, 200);
        assert.equal((await call('/me', { cookie: op })).json.user.isAdmin, true);
        assert.equal((await call('/me', { cookie: user })).json.user.isAdmin, false);

        // 사진은 큰 요청을 받지만, 다른 API는 50KB 제한
        const big = `data:image/jpeg;base64,${'A'.repeat(200_000)}`;
        assert.equal((await call('/me', { method: 'PUT', cookie: user, body: { bio: big } })).status, 413);
        assert.equal((await call('/me/photo', { method: 'PUT', cookie: user, body: { photo: JPEG } })).status, 200);
        assert.equal((await call('/me/photo', { method: 'PUT', cookie: user, body: { photo: big } })).status, 400);
      } finally {
        server.close();
      }
    });
  });
}
