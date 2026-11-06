// 보안 장치
//  1) 요청 횟수 제한: DB(rate_limits 표)에 센다 → 서버(Vercel 함수)가 여러 대여도 함께 센다.
//     고정 구간(예: 15분) 단위로 세고, 기록은 2일 뒤 매일 작업에서 지운다. IP는 해시로만 남긴다.
//  2) 보안 헤더: 다른 사이트가 우리 화면을 끼워 넣거나(클릭재킹), 외부 스크립트를 실행하는 것을 막는다.
//     vercel.json 의 headers 와 같은 값이어야 한다 (test/api.test.js 가 확인).
import crypto from 'node:crypto';
import { AppError } from './service.js';
import * as T from './time.js';

const MIN = 60;
const HOUR = 60 * MIN;
export const LIMITS = {
  loginFail: { limit: 5, windowSec: 15 * MIN, message: '비밀번호를 여러 번 틀렸어요. 15분 뒤에 다시 시도해 주세요.' },
  loginIp: { limit: 30, windowSec: 15 * MIN },
  codeIp: { limit: 10, windowSec: HOUR, message: '인증번호를 너무 많이 요청했어요. 1시간 뒤에 다시 시도해 주세요.' },
  codeEmail: { limit: 10, windowSec: 24 * HOUR, message: '오늘은 이 메일로 인증번호를 더 받을 수 없어요. 내일 다시 시도해 주세요.' },
  signupIp: { limit: 10, windowSec: HOUR },
  resetIp: { limit: 10, windowSec: HOUR },
  visitIp: { limit: 120, windowSec: HOUR },
  message: { limit: 30, windowSec: MIN, message: '메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.' },
  request: { limit: 20, windowSec: HOUR },
  report: { limit: 10, windowSec: 24 * HOUR, message: '오늘은 더 신고할 수 없어요. 급한 일은 운영진 메일로 알려 주세요.' },
  deleteAccount: { limit: 5, windowSec: HOUR },
  exportData: { limit: 10, windowSec: 24 * HOUR, message: '오늘은 더 내려받을 수 없어요. 내일 다시 시도해 주세요.' },
};
const DEFAULT_MESSAGE = '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';

const windowStart = (sec) => {
  const ms = sec * 1000;
  return new Date(Math.floor(T.now().getTime() / ms) * ms).toISOString();
};

// 한 번 세고 지금까지 센 수를 돌려준다
export async function countHit(db, key, { windowSec }) {
  const { rows } = await db.run(
    `INSERT INTO rate_limits (key, window_start, hits) VALUES (?, ?, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1 RETURNING hits`,
    key, windowStart(windowSec),
  );
  return Number(rows[0]?.hits ?? 0);
}

async function hitsNow(db, key, { windowSec }) {
  const row = await db.get('SELECT hits FROM rate_limits WHERE key = ? AND window_start = ?', key, windowStart(windowSec));
  return Number(row?.hits ?? 0);
}

// 세고, 한도를 넘으면 429
export async function limit(db, key, rule) {
  if ((await countHit(db, key, rule)) > rule.limit) throw new AppError(429, rule.message ?? DEFAULT_MESSAGE);
}

// 세지 않고, 이미 한도에 닿았는지만 본다 (로그인 실패 잠금: 잠긴 동안은 맞는 비밀번호도 막는다)
export async function assertUnder(db, key, rule) {
  if ((await hitsNow(db, key, rule)) >= rule.limit) throw new AppError(429, rule.message ?? DEFAULT_MESSAGE);
}

export async function clearHits(db, key) {
  await db.run('DELETE FROM rate_limits WHERE key = ?', key);
}

// 접속 IP (Vercel은 x-real-ip / x-forwarded-for 를 실제 값으로 덮어써서 보낸다) → 저장할 때는 해시
export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return String(req.headers['x-real-ip'] ?? '').trim() || fwd || req.socket?.remoteAddress || 'unknown';
}
export const ipKey = (req) => crypto.createHash('sha256')
  .update(`${globalThis.process?.env?.DATA_ENCRYPTION_KEY ?? 'studybuddy'}:${clientIp(req)}`).digest('hex').slice(0, 20);

// ── 보안 헤더 ──
// 화면 코드는 같은 주소의 파일만 실행한다. style 속성(style="...")을 쓰고 있어 style은 inline 허용.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()', // 카메라는 출석 QR 찍기에만
  'Cross-Origin-Opener-Policy': 'same-origin',
};
export const HSTS = 'max-age=31536000; includeSubDomains'; // HTTPS(실서비스)에서만

export function securityHeaders({ hsts = false } = {}) {
  return (req, res, next) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (hsts) res.setHeader('Strict-Transport-Security', HSTS);
    next();
  };
}
