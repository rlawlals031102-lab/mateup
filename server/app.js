import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import * as S from './service.js';
import { LOCATIONS, STYLES, CHECKIN_EARLY_MIN, TIME_SLOTS, STUDY_PERIOD, DEPOSIT_OPTIONS, ADMIN_ACCOUNTS } from './options.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const COOKIE = 'sb_token';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// demo: 시간과 상관없이 출석, 주간 즉시 마감 허용
// secureCookies: HTTPS 배포 환경에서 쿠키를 Secure로
// cronSecret: 설정되어 있으면 /api/cron/settle 호출 시 확인 (Vercel Cron이 자동으로 붙여 보낸다)
// emailPolicy: { domain, verify } — 실서비스는 국민대 메일만 + 메일 인증번호 (server/service.js 참고)
// mailer: 인증번호 메일 발송기 (server/mailer.js)
// depositAccount: 보증금 받을 운영진 계좌 문구 (예: "국민은행 123-45-6789 메이트업"). 없으면 보증금 기능을 숨긴다.
// adminEmails: 운영자 메일 목록. 이 메일로 로그인하면 운영자 화면(#/admin)을 쓸 수 있다.
// realtime: 실시간 채팅 알림 (server/realtime.js). 없으면 3초마다 새 메시지를 확인한다.
export function createApp({
  db, demo = false, secureCookies = false, cronSecret = null, serveStatic = true,
  emailPolicy = { domain: null, verify: false }, mailer = null,
  demoLogin = demo, // '데모 계정으로 로그인' 버튼 허용 (공용 체험 계정, 데모 메이트와만 매칭)
  depositAccount = null, adminEmails = [], realtime = null,
}) {
  const app = express();
  const opts = { demo };
  const deposits = !!depositAccount;
  // 운영자: options.js 의 ADMIN_ACCOUNTS + 환경 변수 ADMIN_EMAILS
  const admins = new Set([...adminEmails, ...ADMIN_ACCOUNTS].map((e) => String(e).trim().toLowerCase()).filter(Boolean));
  const isAdmin = (u) => !!u && admins.has(u.email);
  // 운영자 메일은 학교 메일 제한에서 빼 준다 (운영진 개인 메일로도 가입·로그인)
  emailPolicy = { ...emailPolicy, extraEmails: admins };

  app.disable('x-powered-by');
  // 사진 올리기만 큰 요청(2MB)을 받고, 나머지는 50KB까지
  const smallJson = express.json({ limit: '50kb' });
  const bigJson = express.json({ limit: '2mb' });
  app.use((req, res, next) => (/^\/api\/(me\/photo|matches\/\d+\/photos)$/.test(req.path) ? bigJson : smallJson)(req, res, next));

  const api = express.Router();

  api.use(async (req, res, next) => {
    req.token = readCookie(req, COOKIE);
    req.user = await S.userByToken(db, req.token);
    next();
  });

  const auth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요해요.' });
    next();
  };

  const setSession = (res, token) => res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: COOKIE_MAX_AGE,
  });

  api.get('/options', (req, res) => {
    res.json({
      locations: LOCATIONS, styles: STYLES, checkinEarlyMin: CHECKIN_EARLY_MIN, demo, timeSlots: TIME_SLOTS, studyPeriod: STUDY_PERIOD,
      emailDomain: emailPolicy.domain, emailVerification: emailPolicy.verify, demoLogin,
      deposits: deposits ? { options: DEPOSIT_OPTIONS, account: depositAccount } : null,
      photos: true,
      realtime: realtime?.client ?? null,
    });
  });

  // 방문자 수 세기 (로그인 없이)
  api.post('/visit', async (req, res) => {
    await S.recordVisit(db, req.body?.id);
    res.status(204).end();
  });

  // 인증
  api.post('/auth/code', async (req, res) => {
    res.json(await S.requestEmailCode(db, mailer, req.body ?? {}, emailPolicy));
  });
  // 인증 메일이 안 올 때 운영진에게 도움 요청
  api.post('/auth/help', async (req, res) => {
    res.json(await S.requestEmailHelp(db, req.body ?? {}, emailPolicy));
  });
  api.post('/auth/reset', async (req, res) => {
    const { user, token } = await S.resetPassword(db, req.body ?? {}, emailPolicy);
    setSession(res, token);
    res.json({ user });
  });
  api.post('/auth/signup', async (req, res) => {
    const { user, token } = await S.signup(db, req.body ?? {}, emailPolicy);
    setSession(res, token);
    res.status(201).json({ user });
  });
  api.post('/auth/login', async (req, res) => {
    const { user, token } = await S.login(db, req.body ?? {}, emailPolicy);
    setSession(res, token);
    res.json({ user });
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

  // 내 정보
  api.get('/me', auth, async (req, res) => {
    const state = await S.homeState(db, req.user.id, opts);
    res.json({ ...state, user: { ...state.user, isAdmin: isAdmin(req.user) } });
  });
  api.put('/me/photo', auth, async (req, res) => res.json({ user: await S.setProfilePhoto(db, req.user.id, req.body?.photo) }));
  api.delete('/me/photo', auth, async (req, res) => res.json({ user: await S.removeProfilePhoto(db, req.user.id) }));
  api.get('/me/money', auth, async (req, res) => res.json({ money: await S.myMoney(db, req.user.id) }));
  api.get('/photos/:id', auth, async (req, res) => {
    const { mime, buffer } = await S.getPhoto(db, req.user.id, req.params.id, { admin: isAdmin(req.user) });
    res.type(mime).set('Cache-Control', 'private, max-age=86400').send(buffer);
  });
  api.put('/me', auth, async (req, res) => res.json({ user: await S.updateProfile(db, req.user.id, req.body ?? {}) }));
  api.put('/me/personal', auth, async (req, res) => {
    res.json({ personal: await S.setPersonalSchedule(db, req.user.id, req.body?.entries) });
  });
  api.get('/me/history', auth, async (req, res) => res.json({ matches: await S.matchHistory(db, req.user.id) }));

  // 매칭 신청
  api.post('/requests', auth, async (req, res) => {
    res.status(201).json(await S.createRequest(db, req.user.id, req.body ?? {}, { deposits }));
  });
  api.delete('/requests/:id', auth, async (req, res, next) => {
    if (req.params.id === 'current') return next();
    await S.cancelRequest(db, req.user.id, Number(req.params.id));
    res.json({ ok: true });
  });
  api.delete('/requests/current', auth, async (req, res) => {
    await S.cancelRequest(db, req.user.id);
    res.json({ ok: true });
  });

  // 매칭
  api.get('/matches/current', auth, async (req, res) => res.json({ match: await S.currentMatch(db, req.user.id, opts) }));
  api.get('/matches/active', auth, async (req, res) => res.json({ matches: await S.activeMatches(db, req.user.id, opts) }));
  // 지난 매칭 다시 보기 (/matches/current 보다 뒤에 둬야 'current'를 가로채지 않음)
  api.get('/matches/:id', auth, async (req, res) => {
    res.json({ match: await S.matchById(db, req.user.id, Number(req.params.id), opts) });
  });
  api.post('/matches/:id/settle', auth, async (req, res) => {
    if (!demo) return res.status(403).json({ error: '데모 모드에서만 사용할 수 있어요.' });
    await S.forceSettle(db, req.user.id, Number(req.params.id));
    res.json({ match: await S.matchById(db, req.user.id, Number(req.params.id), opts) });
  });
  api.post('/matches/:id/leave', auth, async (req, res) => {
    res.json(await S.leaveMatch(db, req.user.id, Number(req.params.id)));
  });
  api.post('/matches/:id/choice', auth, async (req, res) => {
    res.json(await S.chooseNext(db, req.user.id, Number(req.params.id), req.body?.choice));
  });

  // 채팅
  api.get('/matches/:id/messages', auth, async (req, res) => {
    res.json({ messages: await S.listMessages(db, req.user.id, Number(req.params.id), req.query.after) });
  });
  api.post('/matches/:id/messages', auth, async (req, res) => {
    await S.sendMessage(db, req.user.id, Number(req.params.id), req.body?.body);
    await realtime?.publish(Number(req.params.id));
    res.status(201).json({ ok: true });
  });
  api.post('/matches/:id/photos', auth, async (req, res) => {
    const out = await S.sendPhoto(db, req.user.id, Number(req.params.id), req.body?.photo);
    await realtime?.publish(Number(req.params.id));
    res.status(201).json(out);
  });
  // 실시간 채널 이름 (매칭 당사자만)
  api.get('/matches/:id/realtime', auth, async (req, res) => {
    await S.matchById(db, req.user.id, Number(req.params.id), opts); // 권한 확인
    res.json({ topic: realtime ? realtime.topicFor(Number(req.params.id)) : null });
  });

  // 출석
  // 내 출석 QR (메이트가 스캔하면 내 출석이 확인됨)
  api.get('/appointments/:id/qr', auth, async (req, res) => {
    const { appt, code } = await S.myAttendanceCode(db, req.user.id, Number(req.params.id));
    const svg = await QRCode.toString(`SB:${appt.id}:${code}`, { type: 'svg', margin: 1, color: { dark: '#203829', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  });
  // 상대방 출석 확인하기 (혼자 하는 출석은 없음)
  api.post('/appointments/:id/confirm', auth, async (req, res) => {
    await S.confirmMate(db, req.user.id, Number(req.params.id), req.body?.code, opts);
    res.json({ match: await S.matchForAppointment(db, req.user.id, Number(req.params.id), opts) });
  });
  api.post('/appointments/:id/checkout', auth, async (req, res) => {
    const { minutes } = await S.checkOut(db, req.user.id, Number(req.params.id), opts);
    res.json({ minutes, match: await S.matchForAppointment(db, req.user.id, Number(req.params.id), opts) });
  });

  // 주간이 끝난 매칭 일괄 정산 (Vercel Cron이 매일 호출)
  api.get('/cron/settle', async (req, res) => {
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    res.json({ settled: await S.autoSettle(db) });
  });

  // 운영자
  const admin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요해요.' });
    if (!isAdmin(req.user)) return res.status(403).json({ error: '운영자만 볼 수 있어요.' });
    next();
  };
  api.get('/admin', admin, async (req, res) => res.json(await S.adminOverview(db)));
  api.get('/admin/dashboard', admin, async (req, res) => res.json(await S.adminDashboard(db)));
  api.get('/admin/matches/:id/chat', admin, async (req, res) => res.json(await S.adminChat(db, req.user.id, req.params.id)));
  api.post('/admin/deposits/:id/confirm', admin, async (req, res) => res.json(await S.confirmDeposit(db, req.user.id, Number(req.params.id))));
  api.post('/admin/deposits/:id/reject', admin, async (req, res) => res.json(await S.rejectDeposit(db, req.user.id, Number(req.params.id))));
  api.post('/admin/payouts/:id/done', admin, async (req, res) => res.json(await S.markPayoutDone(db, req.user.id, Number(req.params.id))));
  api.post('/admin/help/:id/code', admin, async (req, res) => res.json(await S.issueHelpCode(db, req.user.id, Number(req.params.id))));
  api.post('/admin/help/:id/close', admin, async (req, res) => res.json(await S.closeHelp(db, req.user.id, Number(req.params.id))));

  api.use((req, res) => res.status(404).json({ error: '존재하지 않는 API입니다.' }));

  app.use('/api', api);
  if (serveStatic) {
    // 운영자 화면 바로가기: /admin → /#/admin
    app.get(['/admin', '/admin/'], (req, res) => res.redirect('/#/admin'));
    app.use(express.static(PUBLIC_DIR));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof S.AppError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: '사진이 너무 커요. 더 작은 사진을 골라 주세요.' });
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' });
  });

  return app;
}
