// 화면 자동 테스트 (실제 브라우저, 휴대폰 크기): 가입(동의) → 신청 → 매칭 → 출석 화면 → 채팅·안 읽음 표시 → 신고
// → 리포트 → 탈퇴 → 처리방침 동의 창 → 내 정보 내려받기 → 처리방침 페이지 → 상태 확인.
// 보안 정책(CSP) 위반이나 화면 오류(pageerror)가 하나라도 나면 실패한다.
//
// 실행: npm run test:e2e   (필요: npm i --no-save playwright@1.63.0 && npx playwright install chromium)
// 서버는 이 스크립트가 데모 모드로 직접 켜고 끈다. 시각은 스터디 첫날 하루 전 10시로 고정(서버·브라우저 모두).
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { STUDY_PERIOD } from '../server/options.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e', 'artifacts');
const PORT = Number(process.env.E2E_PORT) || 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const [y, m, d] = STUDY_PERIOD.dates[0].split('-').map(Number);
const FAKE_NOW = new Date(Date.UTC(y, m - 1, d - 1, 1, 0)); // 첫날 하루 전 10:00 KST

const problems = [];
const step = (msg) => console.log(`· ${msg}`);
const fail = (msg) => { throw new Error(msg); };

async function main() {
  await mkdir(OUT, { recursive: true });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sb-e2e-'));
  const dbFile = path.join(dir, 'e2e.db');
  const server = spawn(process.execPath, ['server/index.js', '--demo'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_FILE: dbFile, FAKE_NOW: FAKE_NOW.toISOString(), REQUIRE_CONSENT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (b) => { serverLog += b; });
  server.stderr.on('data', (b) => { serverLog += b; });
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const A = await newPhone(browser, 'A');
    const B = await newPhone(browser, 'B');

    step('가입: 처리방침 동의 체크 없이는 가입 버튼이 안 넘어감 → 체크하고 가입');
    await signup(A, 'e2e-a@test.dev', '가나다');
    await signup(B, 'e2e-b@test.dev', '라마바');

    step('신청 → 매칭');
    await apply(A);
    await A.waitForURL(/#\/home/, { timeout: 15000 });
    await apply(B);
    await B.waitForURL(/#\/match\/\d+/, { timeout: 15000 });
    await B.waitForSelector('.att-table tbody tr');
    if (!(await B.isVisible('#scan'))) fail('메이트 화면에 출석 확인(QR 찍기)이 없어요');
    await shot(B, '01_match');

    step('약속을 캘린더(.ics)로 내려받기');
    const [cal] = await Promise.all([B.waitForEvent('download'), B.click('#add-cal')]);
    if (cal.suggestedFilename() !== 'studybuddy.ics') fail(`캘린더 파일 이름이 이상해요: ${cal.suggestedFilename()}`);
    const calFile = path.join(dir, 'cal.ics');
    await cal.saveAs(calFile);
    const ics = await readFile(calFile, 'utf8');
    for (const must of [/^BEGIN:VCALENDAR/, /BEGIN:VEVENT/, /DTSTART;TZID=Asia\/Seoul:\d{8}T\d{6}/, /END:VCALENDAR$/]) {
      if (!must.test(ics)) fail(`.ics 내용이 이상해요: ${must}`);
    }

    step('채팅 → 상대 탭에 안 읽은 숫자');
    await A.goto(`${BASE}/#/chat`);
    await A.waitForSelector('#send input');
    await A.fill('#send input', '안녕하세요, 내일 봬요');
    await A.press('#send input', 'Enter');
    await A.waitForSelector('.bubble.me');
    await B.goto(`${BASE}/#/home`);
    await B.waitForSelector('.tabbar a[data-tab="chat"] .badge', { timeout: 20000 });
    await shot(B, '02_home_unread');

    step('신고');
    await B.goto(`${BASE}/#/chat`);
    await B.waitForSelector('#report');
    await B.click('#report');
    await B.check('input[name="reason"][value="rude"]');
    await B.fill('textarea[name="detail"]', '자동 테스트 신고');
    await B.click('#rep-form button.primary');
    await B.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('신고했어요'));
    await shot(B, '03_reported');

    step('데모 마감 → 리포트 → 새 메이트');
    await A.goto(`${BASE}/#/match`);
    await A.waitForSelector('#settle');
    A.once('dialog', (dlg) => dlg.accept());
    await A.click('#settle');
    await A.waitForSelector('[data-choice="new"]');
    await shot(A, '04_report');
    await A.click('[data-choice="new"]');
    await A.waitForURL(/#\/apply/);

    step('회원 탈퇴 → 같은 비밀번호로 로그인 안 됨');
    await A.goto(`${BASE}/#/me`);
    await A.waitForSelector('#delete-account');
    await A.click('#delete-account');
    await A.fill('#del-form input[name="password"]', 'secret1');
    A.once('dialog', (dlg) => dlg.accept());
    await A.click('#del-form button');
    await A.waitForURL(/#\/login/);
    await A.waitForSelector('#intro-ok');
    await A.click('#intro-ok');
    await A.fill('input[name="email"]', 'e2e-a@test.dev');
    await A.fill('input[name="password"]', 'secret1');
    await A.click('#f button.primary');
    await A.waitForFunction(() => document.querySelector('#toast.error'));

    step('처리방침 동의 전 회원 → 홈에서 동의 창');
    const db = new DatabaseSync(dbFile);
    db.prepare("UPDATE users SET privacy_version = NULL WHERE email = 'e2e-b@test.dev'").run();
    db.close();
    await B.goto(`${BASE}/#/me`); // 다른 화면으로 가도 홈으로 돌아와 동의 창
    await B.waitForSelector('#consent-ok', { timeout: 15000 });
    await shot(B, '05_consent');
    await B.click('#consent-ok');
    await B.waitForSelector('#consent-ok', { state: 'detached' });

    step('내 정보 내려받기 → JSON 파일 (상대 메시지는 없고, 탈퇴한 메이트는 이름만)');
    await B.goto(`${BASE}/#/me`);
    await B.waitForSelector('#export-data');
    const [download] = await Promise.all([B.waitForEvent('download'), B.click('#export-data')]);
    if (!/^studybuddy-my-data-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename())) fail(`파일 이름이 이상해요: ${download.suggestedFilename()}`);
    const saved = path.join(dir, 'export.json');
    await download.saveAs(saved);
    const text = await readFile(saved, 'utf8');
    const mine = JSON.parse(text);
    if (mine.profile?.email !== 'e2e-b@test.dev' || mine.reportsMade?.length !== 1) fail('내려받은 파일 내용이 이상해요');
    if (mine.matches?.[0]?.mateName !== '탈퇴한 사용자') fail('탈퇴한 메이트 이름이 이상해요');
    if (text.includes('안녕하세요, 내일 봬요')) fail('상대가 보낸 메시지가 들어 있어요');

    step('처리방침 페이지, 상태 확인');
    await B.goto(`${BASE}/privacy.html`);
    if (!(await B.textContent('h1')).includes('개인정보 처리방침')) fail('처리방침 페이지가 이상해요');
    await shot(B, '06_privacy');
    const health = await (await fetch(`${BASE}/api/health`)).json();
    if (!health.ok) fail(`상태 확인 실패: ${JSON.stringify(health)}`);

    if (problems.length) fail(`화면 오류·보안 정책 위반:\n${problems.join('\n')}`);
    console.log('E2E 통과');
  } catch (err) {
    console.error(`E2E 실패: ${err.message}`);
    console.error(`--- 서버 로그 ---\n${serverLog.slice(-4000)}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
    await rm(dir, { recursive: true, force: true });
  }
}

async function newPhone(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FAKE_NOW);
  page.on('pageerror', (e) => problems.push(`[${who}] ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Refused to|Content Security Policy|Uncaught/i.test(msg.text())) problems.push(`[${who}] ${msg.text()}`);
  });
  page.screenshots = who;
  return page;
}

async function signup(page, email, name) {
  await page.goto(`${BASE}/#/signup`);
  await page.waitForSelector('#f');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="department"]', '경영정보학부');
  await page.fill('input[name="phone"]', '010-1234-5678');
  await page.fill('input[name="password"]', 'secret1');
  await page.click('#f button.primary');
  if (!page.url().includes('#/signup')) fail('동의 없이 가입이 넘어갔어요');
  await page.check('input[name="agree"]');
  await page.click('#f button.primary');
  await page.waitForURL(/#\/home/);
}

async function apply(page) {
  await page.goto(`${BASE}/#/apply`);
  await page.waitForSelector('#days .tt-cell:not([disabled])');
  await page.click('#days .tt-cell:not([disabled]) >> nth=0');
  await page.click('#loc button >> nth=1');
  await page.click('#styles button >> nth=0');
  await page.click('#submit');
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${page.screenshots}_${name}.png`), fullPage: true });
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).status < 500) return;
    } catch { /* 아직 안 켜짐 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('서버가 켜지지 않았어요');
}

await main();
