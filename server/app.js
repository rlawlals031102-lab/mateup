import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import * as S from './service.js';
import { LOCATIONS, STYLES, CHECKIN_EARLY_MIN, TIME_SLOTS, STUDY_PERIOD, PROMISE_RULE, PRIVACY_POLICY } from './options.js';
import { sessionUser } from './sessions.js';
import { emailHash } from './fieldcrypt.js';
import { LIMITS, limit, assertUnder, countHit, clearHits, ipKey, securityHeaders } from './security.js';
import { requestContext, log, alertOps, beat, health } from './ops.js';
import { consentState, recordConsent, deleteAccount, purgeOldData, exportMyData } from './privacy.js';
import { notifyMatch, sendDueReminders } from './notify.js';
import { reportChat, REPORT_REASONS } from './reports.js';
import { logAdmin, promiseOverview, reportList, recentAdminLogs, unsuspend, closeReport, matchChat } from './admin.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const COOKIE = 'sb_token';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try { return decodeURIComponent(v.join('=')); } catch { return null; }
    }
  }
  return null;
}

// demo: 시간과 상관없이 출석, 주간 즉시 마감 허용
// secureCookies: HTTPS 배포 환경에서 쿠키를 Secure로 (+ HSTS 헤더)
// cronSecret: 설정되어 있으면 /api/cron/settle 호출 시 확인 (Vercel Cron이 자동으로 붙여 보낸다)
// emailPolicy: { domain, verify } — 실서비스는 국민대 메일만 + 메일 인증번호 (server/service.js 참고)
// mailer: 인증번호 메일 발송기 (server/mailer.js)
// consentRequired: 개인정보 처리방침 동의를 받는지 (실서비스). 동의 전에는 매칭·채팅 등을 쓸 수 없다.
export function createApp({
  db, demo = false, secureCookies = false, cronSecret = null, serveStatic = true,
  emailPolicy = { domain: null, verify: false }, mailer = null,
  demoLogin = demo, // '데모 계정으로 로그인' 버튼 허용 (공용 체험 계정, 데모 메이트와만 매칭)
  consentRequired = emailPolicy.verify,
}) {
  const app = express();
  const opts = { demo };
  const signupPolicy = { ...emailPolicy, consent: consentRequired };

  app.disable('x-powered-by');
  app.use(securityHeaders({ hsts: secureCookies })); // server/security.js (vercel.json 과 같은 값)
  app.use(requestContext()); // 요청 번호 + 오류·느린 요청 로그 (server/ops.js)
  app.use(express.json({ limit: '50kb' }));

  const api = express.Router();

  const setSession = (res, token) => res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: COOKIE_MAX_AGE,
  });

  api.use(async (req, res, next) => {
    req.token = readCookie(req, COOKIE);
    const s = await sessionUser(db, req.token);
    req.user = s?.user ?? null;
    if (s?.refreshed) setSession(res, req.token); // 쓰는 동안은 로그인 유지 (쿠키도 30일 뒤로)
    next();
  });

  const auth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요해요.' });
    next();
  };
  // 처리방침 동의가 필요한 기능. 동의 전이면 홈에서 동의 창이 뜬다 (public/app.js showConsent)
  const member = (req, res, next) => auth(req, res, () => {
    if (consentState(req.user, consentRequired).required) {
      return res.status(403).json({ error: '개인정보 처리방침에 동의해야 이용할 수 있어요.', code: 'consent_required' });
    }
    next();
  });

  api.get('/options', (req, res) => {
    res.json({
      locations: LOCATIONS, styles: STYLES, checkinEarlyMin: CHECKIN_EARLY_MIN, demo, timeSlots: TIME_SLOTS, studyPeriod: STUDY_PERIOD,
      emailDomain: emailPolicy.domain, emailVerification: emailPolicy.verify, demoLogin, promiseRule: PROMISE_RULE,
      privacyVersion: PRIVACY_POLICY.version, reportReasons: REPORT_REASONS,
    });
  });

  // 상태 확인 (외부 감시 서비스용): DB 연결, 매일 작업이 제때 돌았는지
  api.get('/health', async (req, res) => {
    const h = await health(db);
    res.status(h.ok ? 200 : 503).set('Cache-Control', 'no-store').json(h);
  });

  // 개발자 화면 (운영자 계정만). 열람은 기록으로 남긴다 (server/admin.js)
  api.get('/admin', member, async (req, res) => {
    await S.assertAdmin(db, req.user.id);
    const dashboard = await S.adminDashboard(db);
    await logAdmin(db, req.user.id, 'view_dashboard', `chats:${dashboard.chats?.length ?? 0}`);
    res.json({
      ...dashboard,
      promise: await promiseOverview(db), // 약속 기록·매칭 정지
      reports: await reportList(db, { withMessages: false }), // 신고 (내용은 아래에서 따로)
      adminLogs: await recentAdminLogs(db), // 운영자 행동 기록
    });
  });
  // 신고된 대화 내용 (열람 기록이 남는다)
  api.get('/admin/reports', member, async (req, res) => {
    await S.assertAdmin(db, req.user.id);
    const reports = await reportList(db);
    await logAdmin(db, req.user.id, 'view_reports', `reports:${reports.length}`);
    res.json({ reports });
  });
  // 매칭 하나의 대화 (개발자 화면 '대화 보기'. 누를 때마다 열람 기록이 남는다)
  api.get('/admin/matches/:id/chat', member, async (req, res) => {
    await S.assertAdmin(db, req.user.id);
    const chat = await matchChat(db, req.user.id, Number(req.params.id));
    if (!chat) return res.status(404).json({ error: '매칭을 찾을 수 없어요.' });
    res.set('Cache-Control', 'no-store').json(chat);
  });
  // 매칭 하나의 매칭중 화면 (개발자 화면 '매칭 화면 보기'. 당사자 한 명이 보는 화면 그대로, 열람 기록이 남는다)
  api.get('/admin/matches/:id/view', member, async (req, res) => {
    await S.assertAdmin(db, req.user.id);
    const match = await S.adminMatchView(db, Number(req.params.id), req.query.as);
    if (!match) return res.status(404).json({ error: '매칭을 찾을 수 없어요.' });
    // 그 사람 화면에 뜨는 출석 QR도 같이 보낸다 (QR 주소는 본인만 열 수 있어서)
    for (const a of match.appointments) {
      if (a.myCode) a.qrSvg = await QRCode.toString(`SB:${a.id}:${a.myCode}`, { type: 'svg', margin: 1, color: { dark: '#203829', light: '#ffffff' } });
    }
    await logAdmin(db, req.user.id, 'view_match', `match:${match.id}`);
    res.set('Cache-Control', 'no-store').json({ match });
  });
  api.post('/admin/reports/:id/close', member, async (req, res) => {
    await S.assertAdmin(db, req.user.id);
    res.json({ ok: await closeReport(db, req.user.id, Number(req.params.id)) });
  });
  // 매칭 정지 풀기 (약속 기록도 0번부터)
  api.post('/admin/users/:id/unsuspend', member, async (req, res) => {
    await S.assertAdmin(db, req.user.id);
    const user = await unsuspend(db, req.user.id, Number(req.params.id));
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없어요.' });
    res.json({ user });
  });

  // 방문자 수 세기 (로그인 없이). 한 IP에서 너무 많이 오면 조용히 세지 않는다
  api.post('/visit', async (req, res) => {
    if ((await countHit(db, `visit:${ipKey(req)}`, LIMITS.visitIp)) <= LIMITS.visitIp.limit) await S.recordVisit(db, req.body?.id);
    res.status(204).end();
  });

  // 인증 (요청 횟수 제한: server/security.js LIMITS)
  const mailKey = (req) => emailHash(req.body?.email);
  api.post('/auth/code', async (req, res) => {
    await limit(db, `code:ip:${ipKey(req)}`, LIMITS.codeIp);
    await limit(db, `code:email:${mailKey(req)}`, LIMITS.codeEmail);
    res.json(await S.requestEmailCode(db, mailer, req.body ?? {}, emailPolicy));
  });
  api.post('/auth/reset', async (req, res) => {
    await limit(db, `reset:ip:${ipKey(req)}`, LIMITS.resetIp);
    const { user, token } = await S.resetPassword(db, req.body ?? {}, emailPolicy);
    setSession(res, token);
    res.json({ user });
  });
  api.post('/auth/signup', async (req, res) => {
    await limit(db, `signup:ip:${ipKey(req)}`, LIMITS.signupIp);
    const { user, token } = await S.signup(db, req.body ?? {}, signupPolicy);
    setSession(res, token);
    res.status(201).json({ user });
  });
  // 로그인: 한 메일로 5번 틀리면 15분 동안 잠금 (잠긴 동안은 맞는 비밀번호도 막음), 한 IP에서 15분에 30번까지
  api.post('/auth/login', async (req, res) => {
    await limit(db, `login:ip:${ipKey(req)}`, LIMITS.loginIp);
    const failKey = `login:fail:${mailKey(req)}`;
    await assertUnder(db, failKey, LIMITS.loginFail);
    let result;
    try {
      result = await S.login(db, req.body ?? {}, emailPolicy);
    } catch (err) {
      if (err.status === 401) await countHit(db, failKey, LIMITS.loginFail);
      throw err;
    }
    await clearHits(db, failKey);
    setSession(res, result.token);
    res.json({ user: result.user });
  });
  // 데모 계정으로 바로 로그인 (개발·시연용, 실서비스에서는 막힘)
  api.post('/auth/demo', async (req, res) => {
    if (!demoLogin) return res.status(403).json({ error: '데모 계정을 사용할 수 없어요.' });
    const { user, token } = await S.demoLogin(db);
    setSession(res, token);
    res.json({ user });
  });
  api.post('/auth/logout', async (req, res) => {
    if (req.token) await S.logout(db, req.token);
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  // 내 정보 (동의 전에도 볼 수 있어야 홈에서 동의 창을 띄운다)
  api.get('/me', auth, async (req, res) => res.json({
    ...(await S.homeState(db, req.user.id, opts)),
    consent: consentState(req.user, consentRequired),
  }));
  api.post('/me/consent', auth, async (req, res) => res.json({ consent: await recordConsent(db, req.user.id) }));
  // 이메일 알림 켜기/끄기
  api.post('/me/notify', auth, async (req, res) => res.json(await S.setNotifyOptOut(db, req.user.id, req.body?.optOut === true)));
  // 회원 탈퇴: 비밀번호 확인, 진행 중인 매칭이 있으면 거절 (server/privacy.js)
  api.post('/me/delete', auth, async (req, res) => {
    await limit(db, `delete:user:${req.user.id}`, LIMITS.deleteAccount);
    await deleteAccount(db, req.user.id, req.body?.password);
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });
  // 내 정보 내려받기 (개인정보 열람권). 동의 전이어도 볼 수 있어야 한다
  api.get('/me/export', auth, async (req, res) => {
    await limit(db, `export:user:${req.user.id}`, LIMITS.exportData);
    res.set('Cache-Control', 'no-store').json(await exportMyData(db, req.user.id));
  });
  api.put('/me', member, async (req, res) => res.json({ user: await S.updateProfile(db, req.user.id, req.body ?? {}) }));
  api.put('/me/personal', member, async (req, res) => {
    res.json({ personal: await S.setPersonalSchedule(db, req.user.id, req.body?.entries) });
  });
  api.get('/me/history', member, async (req, res) => res.json({ matches: await S.matchHistory(db, req.user.id) }));

  // 매칭 신청
  api.post('/requests', member, async (req, res) => {
    await limit(db, `request:user:${req.user.id}`, LIMITS.request);
    const result = await S.createRequest(db, req.user.id, req.body ?? {});
    if (result.matchId) await notifyMatch(db, mailer, result.matchId); // 바로 매칭되면 두 사람에게 메일
    res.status(201).json(result);
  });
  api.delete('/requests/:id', member, async (req, res, next) => {
    if (req.params.id === 'current') return next();
    await S.cancelRequest(db, req.user.id, Number(req.params.id));
    res.json({ ok: true });
  });
  api.delete('/requests/current', member, async (req, res) => {
    await S.cancelRequest(db, req.user.id);
    res.json({ ok: true });
  });

  // 매칭
  api.get('/matches/current', member, async (req, res) => res.json({ match: await S.currentMatch(db, req.user.id, opts) }));
  api.get('/matches/active', member, async (req, res) => res.json({
    matches: await S.activeMatches(db, req.user.id, opts), strikes: await S.strikeStatus(db, req.user.id),
  }));
  // 지난 매칭 다시 보기 (/matches/current 보다 뒤에 둬야 'current'를 가로채지 않음)
  api.get('/matches/:id', member, async (req, res) => {
    res.json({ match: await S.matchById(db, req.user.id, Number(req.params.id), opts) });
  });
  api.post('/matches/:id/settle', member, async (req, res) => {
    if (!demo) return res.status(403).json({ error: '데모 모드에서만 사용할 수 있어요.' });
    await S.forceSettle(db, req.user.id, Number(req.params.id));
    res.json({ match: await S.matchById(db, req.user.id, Number(req.params.id), opts) });
  });
  api.post('/matches/:id/leave', member, async (req, res) => {
    res.json(await S.leaveMatch(db, req.user.id, Number(req.params.id)));
  });
  api.post('/matches/:id/choice', member, async (req, res) => {
    res.json(await S.chooseNext(db, req.user.id, Number(req.params.id), req.body?.choice));
  });

  // 채팅
  // 새 메시지 + 메이트가 어디까지 읽었는지(mateLastReadId: 이 번호까지는 메이트가 읽음). 채팅 화면이 몇 초마다 부른다
  api.get('/matches/:id/messages', member, async (req, res) => {
    res.json(await S.chatUpdate(db, req.user.id, Number(req.params.id), req.query.after));
  });
  // 채팅 읽음 표시, 안 읽은 메시지 수 (채팅 탭 빨간 숫자)
  api.post('/matches/:id/read', member, async (req, res) => {
    res.json(await S.markChatRead(db, req.user.id, Number(req.params.id), req.body?.lastId));
  });
  api.get('/chat/unread', member, async (req, res) => res.json(await S.unreadCounts(db, req.user.id)));
  api.post('/matches/:id/messages', member, async (req, res) => {
    await limit(db, `message:user:${req.user.id}`, LIMITS.message);
    await S.sendMessage(db, req.user.id, Number(req.params.id), req.body?.body);
    res.status(201).json({ ok: true });
  });
  // 대화 신고 (신고된 대화는 개발자 화면에 바로 보인다. 다른 대화는 운영자가 '대화 보기'로 열 때만)
  api.post('/matches/:id/report', member, async (req, res) => {
    await limit(db, `report:user:${req.user.id}`, LIMITS.report);
    res.status(201).json(await reportChat(db, req.user.id, Number(req.params.id), req.body ?? {}));
  });

  // 출석
  // 내 출석 QR (메이트가 스캔하면 내 출석이 확인됨)
  api.get('/appointments/:id/qr', member, async (req, res) => {
    const { appt, code } = await S.myAttendanceCode(db, req.user.id, Number(req.params.id));
    const svg = await QRCode.toString(`SB:${appt.id}:${code}`, { type: 'svg', margin: 1, color: { dark: '#203829', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  });
  // 상대방 출석 확인하기 (혼자 하는 출석은 없음)
  api.post('/appointments/:id/confirm', member, async (req, res) => {
    await S.confirmMate(db, req.user.id, Number(req.params.id), req.body?.code, opts);
    res.json({ match: await S.matchForAppointment(db, req.user.id, Number(req.params.id), opts) });
  });
  api.post('/appointments/:id/checkout', member, async (req, res) => {
    const { minutes } = await S.checkOut(db, req.user.id, Number(req.params.id), opts);
    res.json({ minutes, match: await S.matchForAppointment(db, req.user.id, Number(req.params.id), opts) });
  });

  // 매일 작업 (Vercel Cron, 매일 00:00 KST): 주간 정산 → 대기 신청끼리 다시 맞추기 → 보관 기간 지난 기록 정리
  // 결과는 ops_heartbeats 에 남고(/api/health), 실패하면 알림이 간다.
  api.get('/cron/settle', async (req, res) => {
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const settled = await S.autoSettle(db);
      const rematchedIds = await S.rematchPending(db);
      const purged = await purgeOldData(db);
      const out = { settled, rematched: rematchedIds.length, purged };
      await beat(db, 'daily', true, JSON.stringify(out));
      for (const id of rematchedIds) await notifyMatch(db, mailer, id); // 매일 작업에서 맺힌 매칭도 메일
      res.json(out);
    } catch (err) {
      await beat(db, 'daily', false, err.message).catch(() => {});
      await alertOps(db, '매일 작업(정산·정리)이 실패했어요', err.message);
      throw err;
    }
  });

  // 약속 리마인드 (GitHub Actions가 30분마다 호출). 같은 약속·사람·종류는 한 번만 보낸다.
  api.get('/cron/reminders', async (req, res) => {
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    res.json({ sent: await sendDueReminders(db, mailer) });
  });

  api.use((req, res) => res.status(404).json({ error: '존재하지 않는 API입니다.' }));

  app.use('/api', api);
  if (serveStatic) {
    app.use(express.static(PUBLIC_DIR));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof S.AppError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: '보낸 내용이 너무 커요.' });
    log('error', 'unhandled error', { id: req.id, method: req.method, path: req.path, err: err.stack ?? String(err) });
    alertOps(db, '서버 오류가 났어요', `${req.method} ${req.path} (요청 번호 ${req.id})\n${err.message}`).catch(() => {});
    res.status(500).json({ error: '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.', requestId: req.id });
  });

  return app;
}
