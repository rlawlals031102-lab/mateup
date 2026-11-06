// 로그인 세션 (쿠키 sb_token).
//  - 토큰 원문은 저장하지 않고 SHA-256 해시만 저장한다 → DB가 새어도 그 값으로 로그인할 수 없다.
//  - 30일 동안 쓰지 않으면 만료. 쓰는 동안에는 하루에 한 번씩 만료를 30일 뒤로 늘린다.
//  - 예전 방식(auth_tokens 표에 원문 저장)으로 로그인해 둔 사람은 처음 접속할 때 새 방식으로 옮긴다 → 다시 로그인할 필요 없음.
import crypto from 'node:crypto';
import * as T from './time.js';

export const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[0-9a-f]{64}$/;

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const later = (ms) => new Date(T.now().getTime() + ms).toISOString();

export async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = T.now().toISOString();
  await db.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    hashToken(token), userId, now, now, later(SESSION_DAYS * DAY),
  );
  return token;
}

// 예전 토큰(auth_tokens)을 새 세션으로 옮긴다. 같은 토큰으로 동시에 들어와도 한 번만 옮겨진다.
async function adoptLegacy(db, token, hash) {
  const old = await db.get('SELECT * FROM auth_tokens WHERE token = ?', token);
  if (!old) return false;
  await db.run(
    `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (token_hash) DO NOTHING`,
    hash, old.user_id, old.created_at, T.now().toISOString(), later(SESSION_DAYS * DAY),
  );
  await db.run('DELETE FROM auth_tokens WHERE token = ?', token);
  return true;
}

// 세션과 사용자를 쿼리 한 번에 (모든 요청이 거치는 길이라 DB 왕복을 줄인다). 세션 열은 s_ 를 붙여 사용자 열과 섞이지 않게.
async function sessionRow(db, hash) {
  const row = await db.get(
    `SELECT s.user_id AS s_user_id, s.last_seen_at AS s_last_seen_at, s.expires_at AS s_expires_at, u.*
       FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    hash,
  );
  if (!row) return null;
  const { s_user_id: userId, s_last_seen_at: lastSeenAt, s_expires_at: expiresAt, ...user } = row;
  return { s: { user_id: userId, last_seen_at: lastSeenAt, expires_at: expiresAt }, user: user.id == null ? null : user };
}

// 토큰 → { user, refreshed } 또는 null. refreshed 이면 쿠키 만료도 다시 늘려 준다 (server/app.js).
export async function sessionUser(db, token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const hash = hashToken(token);
  let found = await sessionRow(db, hash);
  if (!found) {
    // 예전 토큰이면 옮긴다. 같은 토큰의 다른 요청이 방금 옮겼을 수도 있으니 결과와 상관없이 한 번 더 찾는다.
    await adoptLegacy(db, token, hash);
    found = await sessionRow(db, hash);
  }
  if (!found) return null;
  const { s, user } = found;
  const now = T.now();
  if (new Date(s.expires_at) <= now) {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', hash);
    return null;
  }
  if (!user || user.deleted_at) return null;
  let refreshed = false;
  if (now.getTime() - new Date(s.last_seen_at).getTime() > DAY) {
    await db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?',
      now.toISOString(), later(SESSION_DAYS * DAY), hash);
    refreshed = true;
  }
  return { user, refreshed };
}

export async function endSession(db, token) {
  if (typeof token !== 'string' || !token) return;
  await db.run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
  await db.run('DELETE FROM auth_tokens WHERE token = ?', token);
}

// 비밀번호를 바꾸거나 탈퇴하면 모든 기기에서 로그아웃
export async function endAllSessions(db, userId) {
  await db.run('DELETE FROM sessions WHERE user_id = ?', userId);
  await db.run('DELETE FROM auth_tokens WHERE user_id = ?', userId);
}
