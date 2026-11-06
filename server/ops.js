// 운영 장치
//  - 요청 번호: 모든 응답에 X-Request-Id. 사용자가 오류 화면을 보내 주면 Vercel 로그에서 이 번호로 찾는다.
//  - 로그: 서버 오류(500)와 느린 요청(3초 이상)만 JSON 한 줄로 남긴다 (개인정보는 남기지 않음: 사용자 번호만).
//  - 장애 알림: 환경 변수 ALERT_WEBHOOK_URL(디스코드·슬랙 웹훅 주소)이 있으면 서버 오류·매일 작업 실패를 알린다.
//    같은 알림은 10분에 한 번만 보낸다.
//  - 상태 확인: GET /api/health → DB 연결, 매일 작업이 제때 돌았는지. 외부 감시 서비스(UptimeRobot 등)가 이 주소를 본다.
import crypto from 'node:crypto';
import * as T from './time.js';
import { countHit } from './security.js';

const env = () => globalThis.process?.env ?? {};

export function log(level, msg, data = {}) {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...data });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function requestContext() {
  return (req, res, next) => {
    req.id = String(req.headers['x-vercel-id'] ?? crypto.randomBytes(8).toString('hex')).slice(0, 100);
    res.setHeader('X-Request-Id', req.id);
    const started = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - started;
      if (res.statusCode < 500 && ms < 3000) return;
      log(res.statusCode >= 500 ? 'error' : 'warn', res.statusCode >= 500 ? 'server error' : 'slow request', {
        id: req.id, method: req.method, path: req.path, status: res.statusCode, ms, user: req.user?.id ?? null,
      });
    });
    next();
  };
}

export async function alertOps(db, title, detail = '') {
  const url = env().ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    const key = `alert:${crypto.createHash('sha256').update(title).digest('hex').slice(0, 16)}`;
    if ((await countHit(db, key, { windowSec: 600 })) > 1) return false; // 10분에 한 번
  } catch { /* 횟수를 못 세도 알림은 보낸다 */ }
  const text = `[스터디버디] ${title}\n${String(detail).slice(0, 1500)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, text }), // 디스코드는 content, 슬랙은 text
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch (err) {
    log('warn', 'alert failed', { err: err.message });
    return false;
  }
}

// 정기 작업 기록 (마지막 실행 시각·성공 여부)
export async function beat(db, name, ok, detail = '') {
  await db.run(
    `INSERT INTO ops_heartbeats (name, last_run, ok, detail) VALUES (?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET last_run = excluded.last_run, ok = excluded.ok, detail = excluded.detail`,
    name, T.now().toISOString(), ok ? 1 : 0, String(detail).slice(0, 1000),
  );
}

const DAILY_LATE_MS = 26 * 60 * 60 * 1000; // 매일 작업이 26시간 넘게 안 돌았으면 경고

export async function health(db) {
  let dbOk = true;
  let daily = null;
  try {
    await db.get('SELECT 1 AS ok');
    const row = await db.get("SELECT * FROM ops_heartbeats WHERE name = 'daily'");
    daily = row ? { lastRun: row.last_run, ok: !!row.ok } : null;
  } catch {
    dbOk = false;
  }
  const warnings = [];
  if (dbOk && (!daily || T.now().getTime() - new Date(daily.lastRun).getTime() > DAILY_LATE_MS)) warnings.push('daily-job-late');
  if (daily && !daily.ok) warnings.push('daily-job-failed');
  return {
    ok: dbOk,
    db: dbOk ? 'ok' : 'error',
    version: env().VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    time: T.now().toISOString(),
    daily,
    warnings,
  };
}
