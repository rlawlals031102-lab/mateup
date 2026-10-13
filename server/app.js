import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import * as S from './service.js';
import { LOCATIONS, STYLES, DEPOSITS, CHECKIN_EARLY_MIN } from './options.js';

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

export function createApp({ db, demo = false }) {
  const app = express();
  const opts = { demo };

  app.use(express.json({ limit: '50kb' }));

  app.use((req, res, next) => {
    req.token = readCookie(req, COOKIE);
    req.user = S.userByToken(db, req.token);
    next();
  });

  const auth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요해요.' });
    next();
  };

  const setSession = (res, token) => res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', maxAge: COOKIE_MAX_AGE,
  });

  const api = express.Router();

  api.get('/options', (req, res) => {
    res.json({ locations: LOCATIONS, styles: STYLES, deposits: DEPOSITS, checkinEarlyMin: CHECKIN_EARLY_MIN, demo });
  });

  // 인증
  api.post('/auth/signup', (req, res) => {
    const { user, token } = S.signup(db, req.body ?? {});
    setSession(res, token);
    res.status(201).json({ user });
  });
  api.post('/auth/login', (req, res) => {
    const { user, token } = S.login(db, req.body ?? {});
    setSession(res, token);
    res.json({ user });
  });
  api.post('/auth/logout', (req, res) => {
    if (req.token) S.logout(db, req.token);
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  // 내 정보
  api.get('/me', auth, (req, res) => res.json(S.homeState(db, req.user.id, opts)));
  api.put('/me', auth, (req, res) => res.json({ user: S.updateProfile(db, req.user.id, req.body ?? {}) }));
  api.get('/me/points', auth, (req, res) => res.json({ logs: S.pointLogs(db, req.user.id) }));
  api.get('/me/history', auth, (req, res) => res.json({ matches: S.matchHistory(db, req.user.id) }));

  // 매칭 신청
  api.post('/requests', auth, (req, res) => res.status(201).json(S.createRequest(db, req.user.id, req.body ?? {})));
  api.delete('/requests/current', auth, (req, res) => {
    S.cancelRequest(db, req.user.id);
    res.json({ ok: true });
  });

  // 매칭
  api.get('/matches/current', auth, (req, res) => res.json({ match: S.currentMatch(db, req.user.id, opts) }));
  api.post('/matches/:id/settle', auth, (req, res) => {
    if (!demo) return res.status(403).json({ error: '데모 모드에서만 사용할 수 있어요.' });
    S.forceSettle(db, req.user.id, Number(req.params.id));
    res.json({ match: S.currentMatch(db, req.user.id, opts) });
  });
  api.post('/matches/:id/choice', auth, (req, res) => {
    res.json(S.chooseNext(db, req.user.id, Number(req.params.id), req.body?.choice));
  });

  // 채팅
  api.get('/matches/:id/messages', auth, (req, res) => {
    res.json({ messages: S.listMessages(db, req.user.id, Number(req.params.id), req.query.after) });
  });
  api.post('/matches/:id/messages', auth, (req, res) => {
    S.sendMessage(db, req.user.id, Number(req.params.id), req.body?.body);
    res.status(201).json({ ok: true });
  });

  // 출석
  api.get('/appointments/:id/qr', auth, async (req, res) => {
    const appt = S.appointmentForQr(db, req.user.id, Number(req.params.id));
    const svg = await QRCode.toString(`SB:${appt.id}:${appt.code}`, { type: 'svg', margin: 1, color: { dark: '#203829', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  });
  api.post('/appointments/:id/checkin', auth, (req, res) => {
    S.checkIn(db, req.user.id, Number(req.params.id), req.body ?? {}, opts);
    res.json({ match: S.currentMatch(db, req.user.id, opts) });
  });
  api.post('/appointments/:id/checkout', auth, (req, res) => {
    const { minutes } = S.checkOut(db, req.user.id, Number(req.params.id), opts);
    res.json({ minutes, match: S.currentMatch(db, req.user.id, opts) });
  });

  api.use((req, res) => res.status(404).json({ error: '존재하지 않는 API입니다.' }));

  app.use('/api', api);
  app.use(express.static(PUBLIC_DIR));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof S.AppError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' });
  });

  return app;
}
