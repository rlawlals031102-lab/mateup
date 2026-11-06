// 부하 테스트: 서버 한 대(= Vercel 함수 하나, DB 연결 3개)가 얼마나 버티는지 잰다.
//
// 실행:
//   npm run loadtest                                        → 임시 SQLite 파일 (끝나면 지움)
//   LOADTEST_DATABASE_URL=postgres://... npm run loadtest   → PostgreSQL. 비어 있는 시험용 DB만 쓸 것!
//       (가상 계정·매칭·메시지가 그 DB에 남는다. 실서비스 DB는 절대 안 됨. 내 컴퓨터가 아닌 DB는 --remote-db-ok 필요)
//   옵션: --users=10,25,50,100  동시 사용자 단계      --seconds=15  단계마다 재는 시간
//         --db-rtt=2  DB까지 왕복 시간(ms)을 흉내 냄 (PostgreSQL만. 실서비스는 Vercel 서울 ↔ Supabase 서울)
//         --json=결과.json  결과를 파일로
//
// 하는 일
//  1) 이 파일을 서버 모드(--serve)로 하나 더 띄운다. 메일 인증 없이 가입되는 시험용 설정이고,
//     시계는 '첫 스터디 날 하루 전 10시'부터 실제 시간만큼 흐른다 (언제 돌려도 신청이 받아지도록).
//  2) 가상 사용자를 만들고 둘씩 매칭한다 (사용자마다 다른 IP로 보내 IP 횟수 제한에 걸리지 않게).
//  3) 단계마다 가상 사용자들이 실제 화면이 보내는 요청(채팅 확인, 안 읽은 수, 홈, 읽음, 메시지 보내기)을
//     쉬지 않고 보낸다. 초당 처리 수, 응답 시간(p50·p95·p99), 오류, 요청 1건당 DB 쿼리 수를 보여 주고,
//     'p95 0.5초 안·오류 1% 미만'을 지킨 단계 중 가장 많이 처리한 단계로 동시 접속 수용량을 어림한다.
import { fork } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

// 채팅 화면에서 대화 중인 사람이 1분에 보내는 요청 수 (public/app.js 기준, 수용량 어림에 씀):
// 채팅 확인 3초마다(20) + 안 읽은 수 15초마다(4) + 읽음 표시·보내기(약 3)
const CHATTING_PER_MIN = 27;

// 한 사람이 보내는 요청의 비율 (대화 중인 사람 기준)
const MIX = [
  ['GET /matches/:id/messages', 50],
  ['GET /chat/unread', 20],
  ['GET /me', 10],
  ['POST /matches/:id/read', 10],
  ['GET /matches/active', 5],
  ['POST /matches/:id/messages', 5], // 한 사람당 4초에 한 번까지 (메시지 횟수 제한 1분 30번 안쪽)
];
const TOTAL_WEIGHT = MIX.reduce((s, [, w]) => s + w, 0);

// ── 서버 모드 (자식 프로세스) ──
async function serve() {
  const [{ createApp }, T, { STUDY_PERIOD }] = await Promise.all([
    import('../server/app.js'), import('../server/time.js'), import('../server/options.js'),
  ]);
  const [y, m, d] = STUDY_PERIOD.dates[0].split('-').map(Number);
  const base = Date.UTC(y, m - 1, d - 1, 1, 0); // 첫날 하루 전 10:00 (한국)
  const t0 = Date.now();
  const tick = () => T.setNow(new Date(base + Date.now() - t0));
  tick();
  setInterval(tick, 200).unref();

  const url = process.env.LOADTEST_DATABASE_URL;
  const db = url
    ? await (await import('../server/db-pg.js')).openPg(url)
    : await (await import('../server/db.js')).openSqlite(process.env.LOADTEST_DB_FILE);

  // DB 쿼리 수 세기 (트랜잭션은 BEGIN·COMMIT 두 번을 더한다)
  let queries = 0;
  const counted = (o) => {
    for (const k of ['get', 'all', 'run']) {
      const f = o[k];
      o[k] = (...a) => { queries += 1; return f.apply(o, a); };
    }
    if (o.lock) {
      const lock = o.lock;
      o.lock = (...a) => { queries += 1; return lock.apply(o, a); };
    }
    return o;
  };
  counted(db);
  const tx = db.tx;
  db.tx = (fn) => { queries += 2; return tx.call(db, (t) => fn(counted(t))); };

  const app = createApp({
    db, demo: false, demoLogin: false, serveStatic: false,
    emailPolicy: { domain: null, verify: false }, consentRequired: true, mailer: { send: async () => {} },
  });
  const server = app.listen(Number(process.env.LOADTEST_PORT), '127.0.0.1', () => process.send({ ready: true }));
  process.on('message', (msg) => { if (msg === 'queries') process.send({ queries }); });
  process.on('disconnect', () => { server.close(); db.close?.(); process.exit(0); });
}

// ── DB 왕복 시간 흉내 (자식 프로세스): 오가는 데이터를 반씩 늦춰 전달하는 TCP 중계 ──
function delayProxy() {
  const target = new URL(process.env.LOADTEST_TARGET);
  const half = Number(process.env.LOADTEST_RTT) / 2;
  const later = (to) => (chunk) => setTimeout(() => to.writable && to.write(chunk), half);
  const server = net.createServer((client) => {
    const db = net.connect(Number(target.port || 5432), target.hostname);
    client.on('data', later(db));
    db.on('data', later(client));
    const end = () => { client.destroy(); db.destroy(); };
    client.on('close', end).on('error', end);
    db.on('close', end).on('error', end);
  });
  server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  process.on('disconnect', () => process.exit(0));
}

// ── 측정 (부모 프로세스) ──
async function main() {
  const steps = arg('users', '10,25,50,100').split(',').map(Number).filter((n) => n > 0);
  const seconds = Number(arg('seconds', 15));
  const rtt = Number(arg('db-rtt', 0));
  const maxUsers = Math.max(...steps) + (Math.max(...steps) % 2);
  let dbUrl = process.env.LOADTEST_DATABASE_URL;
  if (dbUrl) {
    const host = new URL(dbUrl).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host) && !process.argv.includes('--remote-db-ok')) {
      console.error(`LOADTEST_DATABASE_URL 이 내 컴퓨터가 아닌 DB(${host})예요. 가상 계정이 그 DB에 남아요.`);
      console.error('비어 있는 시험용 DB가 맞으면 --remote-db-ok 를 붙여 다시 실행해 주세요. (실서비스 DB는 절대 안 돼요)');
      process.exit(1);
    }
  } else if (rtt) {
    console.error('--db-rtt 는 PostgreSQL(LOADTEST_DATABASE_URL)에서만 쓸 수 있어요.');
    process.exit(1);
  }
  const children = [];
  const spawnChild = (mode, env) => {
    const child = fork(SELF, [mode], { env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    children.push(child);
    return new Promise((resolve, reject) => {
      child.once('message', (msg) => resolve([child, msg]));
      child.once('exit', (code) => reject(new Error(`${mode} 프로세스가 켜지지 않았어요 (종료 코드 ${code})`)));
    });
  };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sb-load-'));
  const results = [];
  try {
    const shownDb = dbUrl ? `PostgreSQL (${new URL(dbUrl).host}${rtt ? `, DB 왕복 ${rtt}ms 흉내` : ''})` : 'SQLite (임시 파일)';
    if (rtt) {
      const [, { port }] = await spawnChild('--proxy', { LOADTEST_TARGET: dbUrl, LOADTEST_RTT: String(rtt) });
      const viaProxy = new URL(dbUrl);
      viaProxy.hostname = '127.0.0.1';
      viaProxy.port = String(port);
      dbUrl = viaProxy.toString();
    }
    const port = 4300 + Math.floor(Math.random() * 500);
    const [server] = await spawnChild('--serve', {
      LOADTEST_PORT: String(port), LOADTEST_DB_FILE: path.join(dir, 'load.db'), ...(dbUrl ? { LOADTEST_DATABASE_URL: dbUrl } : {}),
    });
    const queries = () => new Promise((resolve) => {
      server.once('message', (msg) => resolve(msg.queries));
      server.send('queries');
    });
    const base = `http://127.0.0.1:${port}/api`;
    console.log(`DB: ${shownDb} · CPU ${os.cpus().length}개 (${os.cpus()[0]?.model ?? '?'}) · Node ${process.version}`);
    console.log(`가상 사용자 ${maxUsers}명 만들고 매칭하는 중...`);
    const users = await setup(base, maxUsers);
    for (const n of steps) {
      const q0 = await queries();
      const r = await runStep(base, users.slice(0, n), seconds);
      r.queriesPerRequest = ((await queries()) - q0) / r.requests;
      results.push(r);
      console.log(`  동시 ${String(n).padStart(3)}명: ${r.rps.toFixed(0).padStart(5)}건/초 · p50 ${ms(r.p50)} · p95 ${ms(r.p95)} · p99 ${ms(r.p99)} · 오류 ${r.errors}건${r.errorKinds ? ` (${r.errorKinds})` : ''} · 요청당 쿼리 ${r.queriesPerRequest.toFixed(1)}`);
    }
    report(results);
    const out = arg('json', null);
    if (out) {
      await writeFile(out, `${JSON.stringify({
        at: new Date().toISOString(), db: process.env.LOADTEST_DATABASE_URL ? 'postgres' : 'sqlite', dbRttMs: rtt,
        cpus: os.cpus().length, node: process.version, seconds, results,
      }, null, 2)}\n`);
    }
  } finally {
    for (const child of children.reverse()) {
      if (child.connected) child.disconnect();
      await new Promise((r) => { if (child.exitCode !== null) r(); else { child.once('exit', r); setTimeout(r, 3000); } });
    }
    await rm(dir, { recursive: true, force: true });
  }
}

const ms = (v) => `${v < 10 ? v.toFixed(1) : v.toFixed(0)}ms`.padStart(7);
const ipOf = (i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

function client(base, ip) {
  let cookie = '';
  return async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'x-real-ip': ip, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie')?.match(/sb_token=([^;]+)/);
    if (set) cookie = `sb_token=${set[1]}`;
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function setup(base, count) {
  const { STUDY_PERIOD } = await import('../server/options.js');
  const [y, m, d] = STUDY_PERIOD.dates[0].split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  const request = { days: [day], cells: [`${day}-7`], locations: ['채팅으로 정하기'], styles: ['check'] };
  const run = Date.now().toString(36);
  const users = Array.from({ length: count }, (_, i) => ({ i, call: client(base, ipOf(i + 1)), email: `load${i}-${run}@load.test` }));
  await inBatches(users, 8, async (u) => {
    const r = await u.call('POST', '/auth/signup', {
      email: u.email, password: 'loadtest1', name: `부하${u.i}`, department: '부하테스트', phone: '010-0000-0000', agree: true,
    });
    if (r.status !== 201) throw new Error(`가입 실패 (${r.status}): ${r.data.error}`);
  });
  const pairs = Array.from({ length: count / 2 }, (_, k) => [users[2 * k], users[2 * k + 1]]);
  await inBatches(pairs, 8, async ([a, b]) => {
    for (const u of [a, b]) {
      const r = await u.call('POST', '/requests', request);
      if (r.status !== 201) throw new Error(`신청 실패 (${r.status}): ${r.data.error}`);
    }
  });
  await inBatches(users, 16, async (u) => {
    const r = await u.call('GET', '/matches/active');
    u.matchId = r.data.matches?.[0]?.id;
    if (!u.matchId) throw new Error(`${u.email} 이(가) 매칭되지 않았어요`);
  });
  return users;
}

function pick() {
  let x = Math.random() * TOTAL_WEIGHT;
  for (const [name, w] of MIX) if ((x -= w) < 0) return name;
  return MIX[0][0];
}

async function runStep(base, users, seconds) {
  const lat = [];
  const byName = {};
  const errors = {};
  const until = performance.now() + seconds * 1000;
  const started = performance.now();
  await Promise.all(users.map(async (u) => {
    let after = 0;
    let lastSend = 0;
    while (performance.now() < until) {
      let name = pick();
      if (name === 'POST /matches/:id/messages' && Date.now() - lastSend < 4000) name = 'GET /matches/:id/messages';
      const t = performance.now();
      let r;
      try {
        if (name === 'GET /matches/:id/messages') {
          r = await u.call('GET', `/matches/${u.matchId}/messages?after=${after}`);
          after = r.data.messages?.at(-1)?.id ?? after;
        } else if (name === 'POST /matches/:id/read') {
          r = await u.call('POST', `/matches/${u.matchId}/read`, { lastId: after });
        } else if (name === 'POST /matches/:id/messages') {
          lastSend = Date.now();
          r = await u.call('POST', `/matches/${u.matchId}/messages`, { body: `부하 테스트 메시지 ${lastSend}` });
        } else {
          const [method, p] = name.split(' ');
          r = await u.call(method, p);
        }
      } catch (err) {
        r = { status: `연결 오류 ${err.cause?.code ?? err.message}` };
      }
      const took = performance.now() - t;
      lat.push(took);
      (byName[name] ??= []).push(took);
      if (!(r.status >= 200 && r.status < 300)) errors[r.status] = (errors[r.status] ?? 0) + 1;
    }
  }));
  const elapsed = (performance.now() - started) / 1000;
  const total = lat.length;
  const errorCount = Object.values(errors).reduce((s, n) => s + n, 0);
  return {
    users: users.length,
    requests: total,
    rps: total / elapsed,
    p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99),
    errors: errorCount,
    errorRate: total ? errorCount / total : 0,
    errorKinds: Object.entries(errors).map(([k, n]) => `${k}: ${n}`).join(', '),
    endpoints: Object.fromEntries(Object.entries(byName).map(([k, v]) => [k, { n: v.length, p50: pct(v, 50), p95: pct(v, 95) }])),
  };
}

function pct(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function report(results) {
  const last = results.at(-1);
  console.log('\n요청 종류별 응답 시간 (마지막 단계)');
  for (const [name, e] of Object.entries(last.endpoints).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${name.padEnd(28)} ${String(e.n).padStart(6)}건 · p50 ${ms(e.p50)} · p95 ${ms(e.p95)}`);
  }
  const ok = results.filter((r) => r.p95 <= 500 && r.errorRate < 0.01);
  if (!ok.length) {
    console.log('\n가장 낮은 단계에서도 p95 0.5초·오류 1% 기준을 넘었어요. 서버나 DB 상태를 먼저 확인해 주세요.');
    return;
  }
  const best = ok.reduce((a, b) => (b.rps > a.rps ? b : a));
  console.log(`\n수용량 어림 (서버 한 대: 동시 ${best.users}명 단계, p95 ${ms(best.p95).trim()}·오류 ${(best.errorRate * 100).toFixed(2)}%에서 ${best.rps.toFixed(0)}건/초)`);
  console.log(`  채팅 화면에서 대화 중인 사용자(1분 ${CHATTING_PER_MIN}건)라면 동시에 약 ${Math.floor(best.rps / (CHATTING_PER_MIN / 60))}명`);
  console.log('  다른 상황(홈에서 기다림 등)은 요청 종류마다 쿼리 수가 달라 docs/operations-guide.md 9장처럼 따로 계산한다.');
}

if (process.argv.includes('--serve')) await serve();
else if (process.argv.includes('--proxy')) delayProxy();
else await main();
