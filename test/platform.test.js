// 보안·개인정보·운영 장치 테스트 (HTTP 요청으로 확인). SQLite와 PostgreSQL(PGlite) 양쪽에서 돌린다.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openSqlite } from '../server/db.js';
import { openPglite } from '../server/db-pg.js';
import { createApp } from '../server/app.js';
import * as S from '../server/service.js';
import { setNow, kst } from '../server/time.js';
import { SECURITY_HEADERS, HSTS } from '../server/security.js';
import { migrate, STEPS } from '../server/migrate.js';
import { purgeOldData } from '../server/privacy.js';
import { alertOps } from '../server/ops.js';
import { hashToken } from '../server/sessions.js';

const DRIVERS = { sqlite: () => openSqlite(':memory:'), postgres: () => openPglite() };
const ROOM = '지정 강의실 (경상관 102A)';
const REQ = { days: [2, 3, 4], location: ROOM, styles: ['check'] };
const ADMIN = 'rlawlals031102@kookmin.ac.kr';
const MIN = 60 * 1000;

test('vercel.json 보안 헤더가 server/security.js 와 같음', async () => {
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const all = vercel.headers.find((h) => h.source === '/(.*)').headers;
  const got = Object.fromEntries(all.map((h) => [h.key, h.value]));
  assert.deepEqual(got, { ...SECURITY_HEADERS, 'Strict-Transport-Security': HSTS });
});

for (const [name, open] of Object.entries(DRIVERS)) {
  describe(name, () => {
    let db;
    let server;
    let base;
    const start = async (options = {}) => {
      server?.close();
      server = createApp({ db, serveStatic: false, ...options }).listen(0);
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${server.address().port}/api`;
    };
    // 쿠키를 기억하는 "브라우저" 하나
    const browser = () => {
      let cookie = '';
      const call = async (method, p, body, headers = {}) => {
        const res = await fetch(base + p, {
          method,
          headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
          body: body ? JSON.stringify(body) : undefined,
        });
        const set = res.headers.get('set-cookie');
        const m = set?.match(/sb_token=([^;]*)/);
        if (m) cookie = m[1] ? `sb_token=${m[1]}` : '';
        const text = await res.text();
        let data = text;
        try { data = JSON.parse(text); } catch { /* 글자 그대로 */ }
        return { status: res.status, data, headers: res.headers };
      };
      call.token = () => cookie.replace('sb_token=', '');
      return call;
    };
    const join = async (b, email, extra = {}) => b('POST', '/auth/signup', {
      email, password: 'secret1', name: email.split('@')[0], department: '경영정보학부', phone: '010-1234-5678', ...extra,
    });

    beforeEach(async () => {
      setNow(kst(2026, 10, 31, 9, 0));
      db = await open();
      await start();
    });
    afterEach(async () => {
      server?.close();
      server = null;
      setNow(null);
      delete process.env.DATA_ENCRYPTION_KEY;
      delete process.env.ALERT_WEBHOOK_URL;
      await db.close?.();
    });

    test('API: 로그인 필요, 남의 매칭 차단, 개발자 화면은 운영자만, 보안 헤더', async () => {
      const [a, b, c] = [browser(), browser(), browser()];
      assert.equal((await a('GET', '/me')).status, 401);
      await join(a, 'a@test.dev');
      await join(b, 'b@test.dev');
      await join(c, 'c@test.dev');
      await a('POST', '/requests', REQ);
      const { data } = await b('POST', '/requests', REQ);
      assert.ok(data.matchId);
      assert.equal((await c('GET', `/matches/${data.matchId}`)).status, 404);
      assert.equal((await c('GET', `/matches/${data.matchId}/messages`)).status, 404);
      assert.equal((await c('GET', '/admin')).status, 403);
      const opts = await a('GET', '/options');
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(opts.headers.get(k), v, k);
      assert.ok(opts.headers.get('x-request-id'));
      assert.equal(opts.headers.get('strict-transport-security'), null, '로컬(HTTP)에서는 HSTS 없음');
    });

    test('로그인: 한 메일로 5번 틀리면 15분 잠금 (맞는 비밀번호도), 지나면 풀림', async () => {
      const a = browser();
      await join(a, 'lock@test.dev');
      const x = browser();
      for (let i = 0; i < 5; i++) assert.equal((await x('POST', '/auth/login', { email: 'lock@test.dev', password: 'wrong!!' })).status, 401);
      const locked = await x('POST', '/auth/login', { email: 'lock@test.dev', password: 'secret1' });
      assert.equal(locked.status, 429);
      assert.match(locked.data.error, /15분/);
      // 다른 메일은 상관없음
      assert.equal((await x('POST', '/auth/login', { email: 'nobody@test.dev', password: 'secret1' })).status, 401);
      setNow(new Date(kst(2026, 10, 31, 9, 0).getTime() + 16 * MIN));
      assert.equal((await x('POST', '/auth/login', { email: 'lock@test.dev', password: 'secret1' })).status, 200);
    });

    test('인증메일: 한 IP에서 1시간에 10번까지', async () => {
      const sent = [];
      await start({ emailPolicy: { domain: 'kookmin.ac.kr', verify: true }, mailer: { send: async (m) => { sent.push(m); } } });
      const x = browser();
      for (let i = 0; i < 10; i++) {
        assert.equal((await x('POST', '/auth/code', { email: `s${i}@kookmin.ac.kr`, purpose: 'signup' })).status, 200);
      }
      const r = await x('POST', '/auth/code', { email: 's10@kookmin.ac.kr', purpose: 'signup' });
      assert.equal(r.status, 429);
      assert.equal(sent.length, 10);
    });

    test('세션: 토큰은 해시로만 저장, 예전 토큰은 자동으로 옮김, 30일 안 쓰면 만료', async () => {
      const a = browser();
      const { data } = await join(a, 's@test.dev');
      const token = a.token();
      assert.match(token, /^[0-9a-f]{64}$/);
      const rows = await db.all('SELECT token_hash FROM sessions WHERE user_id = ?', data.user.id);
      assert.deepEqual(rows.map((r) => r.token_hash), [hashToken(token)], '원문이 아니라 해시만');
      assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM auth_tokens')).n), 0);

      // 예전 방식 토큰 (원문 저장) → 처음 쓰일 때 새 방식으로
      const legacy = crypto.randomBytes(32).toString('hex');
      await db.run('INSERT INTO auth_tokens (token, user_id, created_at) VALUES (?, ?, ?)', legacy, data.user.id, new Date().toISOString());
      const old = browser();
      const me = await old('GET', '/me', null, { cookie: `sb_token=${legacy}` });
      assert.equal(me.status, 200);
      assert.equal(await db.get('SELECT * FROM auth_tokens WHERE token = ?', legacy), null);
      assert.ok(await db.get('SELECT * FROM sessions WHERE token_hash = ?', hashToken(legacy)));

      // 이틀 뒤 쓰면 만료가 늘어나고(쿠키도 다시), 그 뒤 31일 동안 안 쓰면 만료
      setNow(kst(2026, 11, 2, 9, 0));
      const again = await a('GET', '/me');
      assert.equal(again.status, 200);
      assert.match(again.headers.get('set-cookie') ?? '', /sb_token=/);
      setNow(kst(2026, 12, 4, 9, 0));
      assert.equal((await a('GET', '/me')).status, 401);
      // 로그아웃하면 그 세션은 바로 끝
      const b = browser();
      await join(b, 'out@test.dev');
      await b('POST', '/auth/logout');
      assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?', 'out@test.dev')).n), 0);
    });

    test('처리방침 동의: 실서비스는 가입 때 필수, 기존 회원은 동의 전까지 매칭·채팅 막힘', async () => {
      await start({ consentRequired: true });
      const a = browser();
      const no = await join(a, 'n@test.dev');
      assert.equal(no.status, 400);
      assert.match(no.data.error, /동의/);
      assert.equal((await join(a, 'y@test.dev', { agree: true })).status, 201);
      assert.equal((await a('GET', '/me')).data.consent.required, false);
      assert.equal((await a('POST', '/requests', REQ)).status, 201);

      // 처리방침이 생기기 전에 가입한 회원
      await S.signup(db, { email: 'old@test.dev', password: 'secret1', name: 'old', department: '경영정보학부', phone: '010-1111-2222' });
      const o = browser();
      assert.equal((await o('POST', '/auth/login', { email: 'old@test.dev', password: 'secret1' })).status, 200);
      const me = await o('GET', '/me');
      assert.equal(me.status, 200, '홈은 보여야 동의 창을 띄운다');
      assert.equal(me.data.consent.required, true);
      const blocked = await o('POST', '/requests', REQ);
      assert.deepEqual([blocked.status, blocked.data.code], [403, 'consent_required']);
      assert.equal((await o('POST', '/me/consent')).status, 200);
      assert.equal((await o('POST', '/requests', REQ)).status, 201);
      const row = await db.get("SELECT agreed_at, privacy_version FROM users WHERE email = 'old@test.dev'");
      assert.ok(row.agreed_at && row.privacy_version);
    });

    test('회원 탈퇴: 진행 중이면 거절, 정보 삭제·로그인 불가, 정지 중이면 재가입해도 정지 유지', async () => {
      const [a, b] = [browser(), browser()];
      const aId = (await join(a, 'del@test.dev')).data.user.id;
      await join(b, 'mate@test.dev');
      await a('POST', '/requests', REQ);
      const { data: { matchId } } = await b('POST', '/requests', REQ);
      assert.equal((await a('POST', '/me/delete', { password: 'secret1' })).status, 409);
      await a('POST', `/matches/${matchId}/messages`, { body: '안녕하세요' });
      await a('POST', `/matches/${matchId}/leave`);
      const until = '2026-11-29T15:00:00.000Z';
      await db.run('UPDATE users SET suspended_until = ?, strikes_since = ? WHERE id = ?', until, until, aId);

      assert.equal((await a('POST', '/me/delete', { password: 'wrong!!' })).status, 401);
      assert.equal((await a('POST', '/me/delete', { password: 'secret1' })).status, 200);
      const u = await db.get('SELECT * FROM users WHERE id = ?', aId);
      assert.deepEqual([u.email, u.name, u.phone, u.department], [`deleted-${aId}@deleted.invalid`, '탈퇴한 사용자', null, null]);
      assert.ok(u.deleted_at);
      assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', aId)).n), 0);
      assert.equal((await a('GET', '/me')).status, 401);
      assert.equal((await browser()('POST', '/auth/login', { email: 'del@test.dev', password: 'secret1' })).status, 401);
      // 메이트의 기록에는 '탈퇴한 사용자'
      const msgs = await b('GET', `/matches/${matchId}/messages`);
      assert.equal(msgs.data.messages.length, 1);
      assert.equal((await b('GET', '/me/history')).data.matches[0].mate.name, '탈퇴한 사용자');

      // 같은 메일로 다시 가입 → 정지가 이어짐
      const again = browser();
      const re = await join(again, 'del@test.dev');
      assert.equal(re.status, 201);
      const r = await again('POST', '/requests', REQ);
      assert.equal(r.status, 403);
      assert.match(r.data.error, /매칭 정지/);
    });

    test('전화번호: 암호 키가 있어도 DB에는 번호 그대로, 운영자에게는 번호 전체, 매일 작업도 암호화하지 않음', async () => {
      process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
      const a = browser();
      const { data } = await join(a, 'p@test.dev');
      const phoneInDb = async () => (await db.get('SELECT phone FROM users WHERE id = ?', data.user.id)).phone;
      assert.equal(await phoneInDb(), '010-1234-5678');
      assert.equal((await a('PUT', '/me', { phone: '010-9999-8888' })).data.user.phone, '010-9999-8888');
      assert.equal(await phoneInDb(), '010-9999-8888');
      const admin = browser();
      await join(admin, ADMIN);
      const dash = await admin('GET', '/admin');
      assert.equal(dash.data.users.find((u) => u.id === data.user.id).phone, '010-9999-8888');
      await purgeOldData(db);
      assert.equal(await phoneInDb(), '010-9999-8888');
    });

    test('성능 예산: 몇 초마다 불리는 요청의 DB 쿼리 수가 늘지 않음 (docs/operations-guide.md 9장)', async () => {
      const [a, b] = [browser(), browser()];
      await join(a, 'qa@test.dev');
      await join(b, 'qb@test.dev');
      await a('POST', '/requests', REQ);
      const { data: { matchId } } = await b('POST', '/requests', REQ);
      await b('POST', `/matches/${matchId}/messages`, { body: '안녕하세요' });
      await a('GET', '/matches/active'); // 출석 코드가 이미 있는지 한 번 확인한 뒤부터 잰다
      let n = 0;
      for (const k of ['get', 'all', 'run']) {
        const f = db[k];
        db[k] = (...args) => { n += 1; return f.apply(db, args); };
      }
      const tx = db.tx;
      db.tx = (fn) => { n += 2; return tx.call(db, fn); }; // BEGIN·COMMIT (안의 쿼리는 세지 않음 → 넉넉한 하한)
      const count = async (method, p, body) => {
        n = 0;
        const r = await a(method, p, body);
        assert.ok(r.status < 300, `${p}: ${r.status}`);
        return n;
      };
      assert.ok((await count('GET', '/chat/unread')) <= 2, '안 읽은 수');
      assert.ok((await count('GET', `/matches/${matchId}/messages?after=0`)) <= 4, '채팅 확인');
      assert.ok((await count('POST', `/matches/${matchId}/read`, { lastId: 1 })) <= 4, '읽음 표시');
      const active = await count('GET', '/matches/active');
      assert.ok(active <= 9, `매칭 목록 ${active}번 (볼 때마다 출석 코드를 쓰지 않음)`);
    });

    test('내 정보 내려받기: 내 정보·기록만 (상대 메시지·연락처·비밀번호 없음), 하루 10번까지', async () => {
      process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
      const [a, b] = [browser(), browser()];
      assert.equal((await a('GET', '/me/export')).status, 401);
      await join(a, 'ex@test.dev', { phone: '010-1111-2222' });
      await join(b, 'mate@test.dev', { phone: '010-3333-4444' });
      await a('POST', '/requests', REQ);
      const { data: { matchId } } = await b('POST', '/requests', REQ);
      await a('POST', `/matches/${matchId}/messages`, { body: '내가 보낸 말' });
      await b('POST', `/matches/${matchId}/messages`, { body: '메이트가 보낸 말' });
      await b('POST', `/matches/${matchId}/report`, { reason: 'rude' });

      const res = await a('GET', '/me/export');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const d = res.data;
      assert.equal(d.profile.email, 'ex@test.dev');
      assert.equal(d.profile.phone, '010-1111-2222');
      assert.equal(d.matchRequests.length, 1);
      assert.deepEqual(d.matches.map((m) => [m.id, m.mateName]), [[matchId, 'mate']]);
      assert.deepEqual(d.messagesSent.map((m) => m.body), ['내가 보낸 말']);
      assert.deepEqual(d.reportsMade, [], '내가 받은 신고는 넣지 않음');
      assert.equal(d.loginSessions.length, 1);
      const text = JSON.stringify(d);
      const { password_hash: hash } = await db.get('SELECT password_hash FROM users WHERE email = ?', 'ex@test.dev');
      for (const secret of ['메이트가 보낸 말', 'mate@test.dev', '010-3333-4444', 'enc:v1:', hash, 'password', 'token']) {
        assert.equal(text.includes(secret), false, `${secret} 이(가) 들어 있으면 안 됨`);
      }
      for (let i = 1; i < 10; i++) assert.equal((await a('GET', '/me/export')).status, 200);
      assert.equal((await a('GET', '/me/export')).status, 429);
    });

    test('신고: 매칭된 사람만, 운영자는 신고된 대화만 보고 열람이 기록됨, 정지 풀기는 운영자만', async () => {
      const [a, b, c, admin] = [browser(), browser(), browser(), browser()];
      const aId = (await join(a, 'ra@test.dev')).data.user.id;
      await join(b, 'rb@test.dev');
      await join(c, 'rc@test.dev');
      await join(admin, ADMIN);
      await a('POST', '/requests', REQ);
      const { data: { matchId } } = await b('POST', '/requests', REQ);
      await a('POST', `/matches/${matchId}/messages`, { body: '불쾌한 말' });
      assert.deepEqual((await admin('GET', '/admin')).data.chats, [], '신고 전에는 대화가 보이지 않음');
      assert.equal((await b('POST', `/matches/${matchId}/report`, { reason: 'nope' })).status, 400);
      assert.equal((await b('POST', `/matches/${matchId}/report`, { reason: 'other' })).status, 400, '기타는 내용 필수');
      assert.equal((await b('POST', `/matches/${matchId}/report`, { reason: 'rude', detail: '욕설' })).status, 201);
      assert.equal((await c('POST', `/matches/${matchId}/report`, { reason: 'rude' })).status, 404);
      assert.equal((await c('GET', '/admin/reports')).status, 403);

      const list = await admin('GET', '/admin/reports');
      assert.equal(list.data.reports.length, 1);
      assert.deepEqual(list.data.reports[0].messages.map((m) => m.body), ['불쾌한 말']);
      const dash = await admin('GET', '/admin');
      assert.equal(dash.data.reports[0].messages, undefined, '개발자 첫 화면에는 대화 내용을 싣지 않음');
      assert.deepEqual(dash.data.chats.map((c) => c.matchId), [matchId], '신고된 대화만');
      const actions = (await db.all('SELECT action FROM admin_logs ORDER BY id')).map((r) => r.action);
      assert.deepEqual(actions, ['view_dashboard', 'view_reports', 'view_dashboard']);
      assert.equal((await admin('POST', `/admin/reports/${list.data.reports[0].id}/close`)).data.ok, true);
      assert.deepEqual((await admin('GET', '/admin')).data.chats, [], '처리를 마치면 다시 보이지 않음');

      // 정지 풀기
      const until = '2026-11-29T15:00:00.000Z';
      await db.run('UPDATE users SET suspended_until = ?, strikes_since = ? WHERE id = ?', until, until, aId);
      assert.equal((await admin('GET', '/admin')).data.promise.find((p) => p.id === aId).suspendedUntil, until);
      assert.equal((await c('POST', `/admin/users/${aId}/unsuspend`)).status, 403);
      assert.equal((await admin('POST', `/admin/users/${aId}/unsuspend`)).status, 200);
      assert.deepEqual(await S.strikeStatus(db, aId), { count: 0, limit: 2, suspendDays: 30, suspendedUntil: null });
    });

    test('매일 작업: 대기 신청끼리 다시 맞추기, 오래된 기록 정리, 상태 기록 → /api/health', async () => {
      const h0 = await browser()('GET', '/health');
      assert.equal(h0.status, 200);
      assert.deepEqual(h0.data.warnings, ['daily-job-late']);
      // 거의 동시에 들어와 서로를 못 본 두 신청 (둘 다 대기)
      const ids = [];
      for (const n of ['r1', 'r2']) {
        const u = await S.signup(db, { email: `${n}@test.dev`, password: 'secret1', name: n, department: '경영정보학부', phone: '010-1234-5678' });
        const { rows } = await db.run(
          `INSERT INTO match_requests (user_id, days, start_time, end_time, location, styles, deposit, cells, created_at)
           VALUES (?, '[2]', '19:00', '21:00', ?, '["check"]', 0, '["2-7","2-8"]', ?) RETURNING id`,
          u.user.id, JSON.stringify([ROOM]), new Date().toISOString(),
        );
        ids.push(rows[0].id);
      }
      await db.run('INSERT INTO email_codes (email, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        'x@kookmin.ac.kr', 'signup', 'h', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
      const cron = await browser()('GET', '/cron/settle');
      assert.equal(cron.status, 200);
      assert.equal(cron.data.rematched, 1);
      assert.equal(cron.data.purged.emailCodes, 1);
      assert.equal((await db.get('SELECT status FROM match_requests WHERE id = ?', ids[0])).status, 'matched');
      const h1 = await browser()('GET', '/health');
      assert.deepEqual([h1.data.ok, h1.data.daily.ok, h1.data.warnings], [true, true, []]);
      // 비밀값이 있으면 크론만
      await start({ cronSecret: 'shh' });
      assert.equal((await browser()('GET', '/cron/settle')).status, 401);
      assert.equal((await browser()('GET', '/cron/settle', null, { authorization: 'Bearer shh' })).status, 200);
    });

    test('장애 알림: 웹훅으로 보내고, 같은 알림은 10분에 한 번', async () => {
      const got = [];
      const hook = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => { got.push(JSON.parse(body)); res.end('ok'); });
      }).listen(0);
      await new Promise((r) => hook.once('listening', r));
      process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${hook.address().port}/hook`;
      assert.equal(await alertOps(db, '테스트 알림', '자세한 내용'), true);
      assert.equal(await alertOps(db, '테스트 알림', '또'), false);
      hook.close();
      assert.equal(got.length, 1);
      assert.match(got[0].content, /테스트 알림/);
      assert.equal(got[0].text, got[0].content);
    });

    test('DB 구조 버전: 최신이면 아무것도 하지 않고, 적용 기록이 남음', async () => {
      assert.deepEqual(await migrate(db), []);
      const ids = (await db.all('SELECT id FROM schema_migrations')).map((r) => r.id);
      assert.ok(ids.some((id) => id.startsWith('base-')));
      for (const s of STEPS) assert.ok(ids.includes(s.id));
      if (name === 'postgres') {
        // 상태 값 제약: 정해진 값 말고는 DB가 거부
        const u = await S.signup(db, { email: 'k@test.dev', password: 'secret1', name: 'k', department: '경영정보학부', phone: '010-1234-5678' });
        await assert.rejects(db.run(
          `INSERT INTO match_requests (user_id, days, start_time, end_time, location, styles, deposit, status, created_at)
           VALUES (?, '[2]', '19:00', '21:00', 'x', '[]', 0, 'weird', ?)`, u.user.id, new Date().toISOString(),
        ), /match_requests_status_valid/);
      }
    });
  });
}

test('DB 구조 버전: 파일 DB를 다시 열면 표를 다시 만들지 않음 (SQLite)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sb-'));
  const file = path.join(dir, 'a.db');
  const first = await openSqlite(file);
  const n = Number((await first.get('SELECT COUNT(*) AS n FROM schema_migrations')).n);
  first.raw.close();
  const second = await openSqlite(file);
  assert.deepEqual(await migrate(second), []);
  assert.equal(Number((await second.get('SELECT COUNT(*) AS n FROM schema_migrations')).n), n);
  second.raw.close();
  await rm(dir, { recursive: true, force: true });
});
