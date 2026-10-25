// 스터디버디 프론트엔드 — 빌드 도구 없는 단일 페이지 앱 (hash 라우팅)

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const topbar = $('#topbar');
const tabbar = $('#tabbar');
// PC에서는 앱 화면(.phone) 안에서 스크롤되고, 휴대폰에서는 페이지 전체가 스크롤된다.
const scroller = () => {
  const phone = $('.phone');
  return getComputedStyle(phone).overflowY === 'auto' ? phone : document.scrollingElement;
};

const WD = ['', '월', '화', '수', '목', '금', '토', '일'];
const AVATARS = ['🙂', '😎', '🤓', '😺', '🐻', '🐰', '🦊', '🐼', '👩', '🧑', '👦', '👧', '👩‍🎓', '🧑‍💻', '🙋‍♀️', '🙋‍♂️', '🌱', '📚'];

let OPTIONS = null;
let timers = [];
let routeToken = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => `${Number(n).toLocaleString('ko-KR')}`;

function fmtDate(s, withWeekday = false) {
  const [, m, d] = s.split('-').map(Number);
  const wd = new Date(`${s}T00:00:00`).getDay();
  return `${m}월 ${d}일${withWeekday ? ` (${WD[wd === 0 ? 7 : wd]})` : ''}`;
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  if (h === 24) return '자정';
  const ap = h < 12 ? '오전' : '오후';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${hh}:${String(m).padStart(2, '0')}`;
}
function fmtMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function api(path, { method = 'GET', body } = {}) {
  // 단독 실행 HTML(npm run build:standalone)에서는 브라우저 안의 가짜 서버를 쓴다.
  if (window.__mockApi) {
    const { status, data } = await window.__mockApi(path, { method, body });
    if (status >= 400) {
      const err = new Error(data.error || '요청을 처리하지 못했어요.');
      err.status = status;
      throw err;
    }
    return data;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || '요청을 처리하지 못했어요.');
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

function every(ms, fn) {
  timers.push(setInterval(fn, ms));
}

function setTop({ title = '', back = null, brand = false, right = '' } = {}) {
  topbar.innerHTML = `
    <div>${back ? `<a class="icon-btn" href="${back}" aria-label="뒤로">‹</a>` : ''}</div>
    ${brand ? '<div class="center"><img class="logo" src="logo.png" alt="스터디버디"></div>' : `<h1>${esc(title)}</h1>`}
    <div>${right}</div>`;
}

function setTabs(active) {
  tabbar.hidden = !active;
  view.classList.toggle('no-tabs', !active);
  $$('a', tabbar).forEach((a) => a.classList.toggle('active', a.dataset.tab === active));
}

const loading = () => { view.innerHTML = '<div class="spinner"></div>'; };

// 데모(가상) 메이트 표시
const botBadge = (u) => (u?.isBot ? ' <span class="pill gray" title="실제 사람이 아닌 체험용 메이트">데모 메이트</span>' : '');

// 시간표 칸("요일-시간대번호") → 요일별 이어진 시간 [{ day, start, end }]
function runsOfCells(cells) {
  const S = OPTIONS.timeSlots;
  const byDay = {};
  for (const c of cells) {
    const [d, i] = c.split('-').map(Number);
    (byDay[d] ??= []).push(i);
  }
  const runs = [];
  for (const d of Object.keys(byDay).map(Number).sort((x, y) => x - y)) {
    const idx = [...new Set(byDay[d])].sort((x, y) => x - y);
    let from = idx[0];
    for (let k = 1; k <= idx.length; k++) {
      if (k < idx.length && idx[k] === idx[k - 1] + 1) continue;
      runs.push({ day: d, start: S[from].start, end: S[idx[k - 1]].end });
      if (k < idx.length) from = idx[k];
    }
  }
  return runs;
}

// 요일별 시간 → 짧은 요약. 같은 시간인 요일끼리 묶는다.
function scheduleText(runs) {
  const groups = new Map();
  for (const r of runs) {
    const key = `${fmtTime(r.start)}~${fmtTime(r.end)}`;
    groups.set(key, [...(groups.get(key) ?? []), r.day]);
  }
  return [...groups].map(([time, days]) => `${[...new Set(days)].map((d) => WD[d]).join('·')} ${time}`).join(' · ');
}

function styleLabels(keys) {
  return keys.map((k) => OPTIONS.styles[k]?.label ?? k).join(' · ');
}

// ───────────────────────── 라우터 ─────────────────────────

const routes = {
  login: renderLogin,
  signup: renderSignup,
  reset: renderReset,
  home: renderHome,
  apply: renderApply,
  match: renderMatch,
  chat: renderChat,
  me: renderMe,
  'me/edit': renderEditProfile,
};

async function router() {
  timers.forEach(clearInterval);
  timers = [];
  closeModal();
  const token = ++routeToken;
  const name = location.hash.replace(/^#\/?/, '') || 'home';
  scroller().scrollTo(0, 0);
  const pastId = name.match(/^history\/(\d+)$/)?.[1];
  const [, sub, subId] = name.match(/^(match|chat)\/(\d+)$/) ?? [];
  const render = pastId ? (alive) => renderPast(alive, Number(pastId))
    : sub === 'match' ? (alive) => renderMatch(alive, Number(subId))
      : sub === 'chat' ? (alive) => renderChat(alive, Number(subId))
        : routes[name] ?? renderHome;
  try {
    if (!OPTIONS) OPTIONS = await api('/options');
    await render(() => token === routeToken);
  } catch (err) {
    if (err.status === 401 && !['login', 'signup', 'reset'].includes(name)) {
      location.hash = '#/login';
      return;
    }
    console.error(err);
    view.innerHTML = `<div class="empty"><div class="em">⚠️</div><h3>문제가 생겼어요</h3><p>${esc(err.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', router);
router();

// ───────────────────────── 로그인 / 가입 ─────────────────────────

function authShell(inner) {
  setTop({});
  setTabs(null);
  topbar.innerHTML = '';
  view.innerHTML = `
    <div class="auth">
      <img class="logo lg" src="logo.png" alt="스터디버디">
      ${inner}
    </div>`;
}

// 실서비스는 국민대 메일만 받는다. 아이디만 입력해도 @kookmin.ac.kr 을 붙여 준다.
const withDomain = (email) => {
  const v = String(email ?? '').trim();
  return OPTIONS.emailDomain && v && !v.includes('@') ? `${v}@${OPTIONS.emailDomain}` : v;
};

const emailLabel = () => (OPTIONS.emailDomain ? '국민대 메일' : '이메일');
const emailPlaceholder = () => (OPTIONS.emailDomain ? `아이디@${OPTIONS.emailDomain}` : '');

// 이메일 + "인증번호 받기" 버튼 + 인증번호 입력칸 (메일 인증을 쓰는 실서비스에서만)
function emailCodeFields() {
  if (!OPTIONS.emailVerification) {
    return `<label class="field"><span>${emailLabel()}</span><input class="input" name="email" type="email" autocomplete="email" placeholder="${esc(emailPlaceholder())}" required></label>`;
  }
  return `
    <div class="field"><span>${emailLabel()}</span>
      <div class="row">
        <input class="input" name="email" autocomplete="email" placeholder="${esc(emailPlaceholder())}" required>
        <button type="button" class="btn inline-btn" id="send-code">인증번호 받기</button>
      </div>
    </div>
    <label class="field" id="code-field" hidden><span>인증번호 (메일로 받은 6자리)</span>
      <input class="input code" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
    </label>`;
}

function bindSendCode(form, purpose) {
  const btn = $('#send-code', form);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    form.email.value = withDomain(form.email.value);
    if (!form.email.value) return toast('메일 주소를 입력해 주세요.', true);
    btn.disabled = true;
    try {
      await api('/auth/code', { method: 'POST', body: { email: form.email.value, purpose } });
      $('#code-field', form).hidden = false;
      form.code.required = true;
      form.code.focus();
      toast('메일로 인증번호를 보냈어요. (스팸함도 확인해 주세요)');
      let left = 60;
      btn.textContent = `다시 받기 (${left})`;
      const timer = setInterval(() => {
        left -= 1;
        if (left <= 0 || !btn.isConnected) {
          clearInterval(timer);
          btn.disabled = false;
          btn.textContent = '다시 받기';
        } else {
          btn.textContent = `다시 받기 (${left})`;
        }
      }, 1000);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  });
}

async function renderLogin() {
  authShell(`
    <h2>같은 시간에<br>함께 시작하는 공부</h2>
    <p class="lead">${OPTIONS.emailDomain ? '국민대 학생을 위한 ' : ''}1주일 단위 1:1 스터디 메이트 매칭, 스터디버디</p>
    <form id="f" class="card">
      <label class="field"><span>${emailLabel()}</span><input class="input" name="email" autocomplete="email" placeholder="${esc(emailPlaceholder())}" required></label>
      <label class="field"><span>비밀번호</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary block mt-lg">로그인</button>
    </form>
    <p class="switch-link">처음이신가요? <a href="#/signup">회원가입</a>${OPTIONS.emailVerification ? ' · <a href="#/reset">비밀번호 찾기</a>' : ''}</p>
    ${OPTIONS.demoLogin ? `
      <div class="demo-login">
        <button type="button" class="btn block" id="demo-login">🧪 데모 계정으로 로그인</button>
        <p class="tiny muted center">가입 없이 둘러볼 수 있는 체험용 계정이에요.</p>
      </div>` : ''}`);
  $('#demo-login')?.addEventListener('click', async () => {
    try {
      await api('/auth/demo', { method: 'POST' });
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    e.target.email.value = withDomain(e.target.email.value);
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await api('/auth/login', { method: 'POST', body: fd });
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
}

async function renderSignup() {
  authShell(`
    <h2>공부 약속이<br>지켜지는 구조</h2>
    <p class="lead">${OPTIONS.emailDomain ? '국민대학교 메일로 가입할 수 있어요. ' : ''}가입하면 보증금으로 쓸 수 있는 50,000P를 드려요.</p>
    <form id="f" class="card">
      ${emailCodeFields()}
      <label class="field"><span>이름 (닉네임)</span><input class="input" name="name" maxlength="20" required></label>
      <label class="field"><span>나이</span><input class="input" name="age" type="number" min="14" max="100" inputmode="numeric"></label>
      <label class="field"><span>비밀번호 (6자 이상)</span><input class="input" name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <button class="btn primary block mt-lg">가입하고 시작하기</button>
    </form>
    <p class="switch-link">이미 계정이 있나요? <a href="#/login">로그인</a></p>`);
  const form = $('#f');
  bindSendCode(form, 'signup');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.email.value = withDomain(form.email.value);
    if (OPTIONS.emailVerification && $('#code-field').hidden) return toast("먼저 '인증번호 받기'를 눌러 주세요.", true);
    const fd = Object.fromEntries(new FormData(form));
    try {
      await api('/auth/signup', { method: 'POST', body: fd });
      toast('환영해요! 이번 주 메이트를 찾아볼까요?');
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
}

async function renderReset() {
  if (!OPTIONS.emailVerification) {
    authShell(`<div class="empty"><h3>비밀번호 찾기</h3><p>데모 버전에서는 지원하지 않아요.</p><a class="btn mt" href="#/login">로그인으로</a></div>`);
    return;
  }
  authShell(`
    <h2>비밀번호 찾기</h2>
    <p class="lead">가입한 국민대 메일로 인증번호를 보내 드려요.</p>
    <form id="f" class="card">
      ${emailCodeFields()}
      <label class="field"><span>새 비밀번호 (6자 이상)</span><input class="input" name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <button class="btn primary block mt-lg">비밀번호 바꾸기</button>
    </form>
    <p class="switch-link"><a href="#/login">로그인으로 돌아가기</a></p>`);
  const form = $('#f');
  bindSendCode(form, 'reset');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.email.value = withDomain(form.email.value);
    if ($('#code-field').hidden) return toast("먼저 '인증번호 받기'를 눌러 주세요.", true);
    const fd = Object.fromEntries(new FormData(form));
    try {
      await api('/auth/reset', { method: 'POST', body: fd });
      toast('비밀번호를 바꿨어요. 다른 기기에서는 다시 로그인해 주세요.');
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
}

// ───────────────────────── 시간표 (신청 화면·홈 공용) ─────────────────────────

const toMinutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// 요일 + 시간 범위 → 그 안에 들어가는 시간표 칸들
function cellsOfRun(day, start, end) {
  return OPTIONS.timeSlots
    .map((s, i) => [s, i])
    .filter(([s]) => toMinutes(s.start) >= toMinutes(start) && toMinutes(s.end) <= toMinutes(end))
    .map(([, i]) => `${day}-${i}`);
}

// 내 시간표: 칸 → { kind: match|pending|personal, label, matchId }
// 이어진 칸 묶음의 첫 칸에만 이름(label)을 단다.
function myTimetable({ matches = [], pendingRequests = [], personal = [] }) {
  const map = new Map();
  const put = (cells, info) => cells.forEach((c, k) => map.set(c, { ...info, label: k === 0 ? info.label : '' }));
  for (const m of matches) {
    for (const r of m.schedule) put(cellsOfRun(r.day, r.start, r.end), { kind: 'match', label: m.mate.name, matchId: m.id });
  }
  for (const req of pendingRequests) {
    for (const r of runsOfCells(req.cells)) put(cellsOfRun(r.day, r.start, r.end), { kind: 'pending', label: '대기' });
  }
  const byTitle = new Map();
  for (const p of personal) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p.cell]);
  for (const [title, cells] of byTitle) {
    for (const r of runsOfCells(cells)) put(cellsOfRun(r.day, r.start, r.end), { kind: 'personal', label: title });
  }
  return map;
}

// 시간표 HTML. cellInfo(cell) → { cls, label, on, disabled }
function timetableHTML(id, cellInfo) {
  const SLOTS = OPTIONS.timeSlots;
  const days = [1, 2, 3, 4, 5, 6, 7];
  return `
    <div class="tt" id="${id}">
      <div class="tt-corner"></div>${days.map((d) => `<div class="tt-day${d > 5 ? ' weekend' : ''}">${WD[d]}</div>`).join('')}
      ${SLOTS.map((s, i) => `${i === 6 ? '<div class="tt-divider"></div>' : ''}
        <div class="tt-time${i >= 6 ? ' evening' : ''}">${s.start}</div>
        ${days.map((d) => {
          const info = cellInfo(`${d}-${i}`) ?? {};
          return `<button type="button" class="tt-cell${i >= 6 ? ' evening' : ''}${info.cls ? ` ${info.cls}` : ''}" data-cell="${d}-${i}"
            aria-pressed="${!!info.on}"${info.disabled ? ' disabled' : ''} aria-label="${WD[d]} ${s.start}~${s.end}${info.label ? ` ${esc(info.label)}` : ''}">${info.label ? `<span>${esc(info.label)}</span>` : ''}</button>`;
        }).join('')}`).join('')}
    </div>`;
}

// 시간표 칸 누르기·끌기. get(cell) → 켜짐 여부, set(cell, on, btn) 으로 바꾼다. 막힌(disabled) 칸은 건너뛴다.
function attachPaint(tt, { get, set }) {
  let paint = null;
  let last = null;
  const btnOf = (d, i) => tt.querySelector(`[data-cell="${d}-${i}"]`);
  const paintTo = (btn) => {
    const [d, i] = btn.dataset.cell.split('-').map(Number);
    const cells = [[d, i]];
    // 빠르게 끌어도 빠지는 칸이 없도록, 같은 요일/같은 시간대로 움직이면 사이 칸도 모두 칠한다
    if (last && last[0] === d) for (let k = Math.min(last[1], i); k <= Math.max(last[1], i); k++) cells.push([d, k]);
    if (last && last[1] === i) for (let k = Math.min(last[0], d); k <= Math.max(last[0], d); k++) cells.push([k, i]);
    for (const [cd, ci] of cells) {
      const b = btnOf(cd, ci);
      if (b && !b.disabled && get(b.dataset.cell) !== paint) set(b.dataset.cell, paint, b);
    }
    last = [d, i];
  };
  tt.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.tt-cell');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    paint = !get(btn.dataset.cell);
    last = null;
    paintTo(btn);
  });
  tt.addEventListener('pointermove', (e) => {
    if (paint === null) return;
    const btn = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.tt-cell');
    if (btn && tt.contains(btn)) paintTo(btn);
  });
  const stop = () => { paint = null; last = null; };
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}

// ───────────────────────── 홈 ─────────────────────────

async function renderHome(alive) {
  setTop({ brand: true });
  setTabs('home');
  loading();
  const state = await api('/me');
  if (!alive()) return;
  const { user, matches, pendingRequests, personal, mateLeft, community, exam } = state;

  const reportCard = (m) => `
      <div class="card lime">
        <div class="card-head"><h2>📊 주간 리포트가 도착했어요</h2></div>
        <p class="small">${esc(m.mate.name)}님과의 ${m.round}주차 결과를 확인하고, 다음 주를 골라 주세요.</p>
        <a class="btn primary block mt" href="#/match/${m.id}">리포트 보기</a>
      </div>`;
  const matchCard = (m) => {
    const next = m.appointments.find((x) => ['open', 'studying', 'scheduled'].includes(x.me.status));
    return `
      <div class="card">
        <div class="card-head"><h2>👥 이번 주 메이트</h2><span class="pill">${m.round}주차</span></div>
        <div class="profile">
          <div class="avatar">${esc(m.mate.avatar)}</div>
          <div>
            <div class="name">${esc(m.mate.name)}${m.mate.age ? `<small>(${m.mate.age}세)</small>` : ''}${botBadge(m.mate)}</div>
            <div class="small muted">${esc(scheduleText(m.schedule))}</div>
            <div class="small muted">출석 ${m.stats.me.attended}/${m.stats.me.total} · 공부 ${fmtMinutes(m.stats.me.minutes)}</div>
          </div>
        </div>
        ${next ? `
          <div class="notice"><span>📅</span><span>다음 약속 <b>${fmtDate(next.date, true)} ${fmtTime(next.startTime)}</b> · ${esc(next.location)}</span></div>`
        : '<div class="notice"><span>✅</span><span>이번 주 약속을 모두 마쳤어요. 주간이 끝나면 리포트가 도착해요.</span></div>'}
        <a class="btn primary block mt" href="#/match/${m.id}">${next && ['open', 'studying'].includes(next.me.status) ? '지금 출석하러 가기' : '매칭 정보 보기'}</a>
      </div>`;
  };
  const pendingCard = (req) => `
      <div class="card">
        <div class="row" style="gap:12px">
          <div class="pulse sm">🔍</div>
          <div style="flex:1">
            <b>메이트를 찾는 중</b>
            <p class="tiny muted">${esc(scheduleText(req.schedule))}<br>${esc(req.location)} · ${styleLabels(req.styles)}${req.deposit ? ` · 보증금 ${won(req.deposit)}P` : ''}</p>
          </div>
        </div>
        <button class="btn ghost block mt danger sm" data-cancel="${req.id}">신청 취소하기</button>
      </div>`;

  let leftNote = '';
  if (mateLeft) {
    const detail = mateLeft.reward
      ? `보증금 ${won(mateLeft.refunded)}P를 돌려받고, 보상으로 <span class="plus">+${won(mateLeft.reward)}P</span>를 받았어요.`
      : mateLeft.refunded ? `보증금 ${won(mateLeft.refunded)}P를 돌려받았어요.` : '';
    leftNote = `
      <div class="card">
        <div class="card-head"><h2>👋 메이트가 매칭을 그만뒀어요</h2></div>
        <p class="small">${esc(mateLeft.mateName)}님이 이번 주 매칭을 중간에 그만뒀어요. ${detail}</p>
      </div>`;
  }
  const hasAny = matches.length || pendingRequests.length;
  // 기말고사 디데이 · 국민대 통계 (매칭 전에는 첫 카드 안에, 매칭 후에는 매칭 카드 아래에)
  const dday = exam ? (exam.dday === 0 ? 'D-DAY' : `D-${exam.dday}`) : '';
  const heroStats = `
        <div class="hero-stats">
          ${exam ? `<div><span>📅 ${esc(exam.name)}까지</span><b>${dday}</b><span>${Number(exam.date.slice(5, 7))}월 ${Number(exam.date.slice(8))}일</span></div>` : ''}
          <div><span>🎓 국민대생</span><b>${community.studying}명</b><span>이번 주 함께 공부 중${community.waiting ? ` · 대기 ${community.waiting}명` : ''}</span></div>
        </div>`;
  const homeStats = `
    <div class="home-stats">
      ${exam ? `<div class="stat"><span>📅 ${esc(exam.name)}까지</span><b>${dday}</b><span>${Number(exam.date.slice(5, 7))}월 ${Number(exam.date.slice(8))}일</span></div>` : ''}
      <div class="stat"><span>🎓 국민대생</span><b>${community.studying}명</b><span>이번 주 함께 공부 중${community.waiting ? ` · 대기 ${community.waiting}명` : ''}</span></div>
    </div>`;
  const ttCard = '<section class="card" id="my-tt-card"></section>';
  // 매칭·신청이 있으면: 시간표 → 매칭 상태 카드들 → 통계
  // 없으면: 매칭 신청 카드(통계 포함) → 시간표 (첫 화면에서 시간표가 잘리지 않게 위쪽을 작게)
  const main = hasAny
    ? ttCard
      + [...matches.map((m) => (m.status === 'reported' ? reportCard(m) : matchCard(m))), ...pendingRequests.map(pendingCard)].join('')
      + '<a class="btn block mt" href="#/apply">＋ 다른 시간에 매칭 추가 신청</a>'
      + homeStats
    : `${leftNote}
      <div class="card hero compact">
        <h2>이번 주, 같이 공부할 메이트를 찾아볼까요?</h2>
        <p class="tiny muted">시간표에서 시간을 고르면 조건이 맞는 1:1 메이트와 연결돼요.</p>
        ${heroStats}
        <a class="btn lime block" href="#/apply">매칭 신청하기 →</a>
      </div>
      ${ttCard}`;

  view.innerHTML = `
    <div class="row between home-hello">
      <div style="font-size:19px;font-weight:800">${esc(user.name)}님 👋</div>
      <a href="#/me" class="pill lime" style="text-decoration:none">💰 ${won(user.points)}P</a>
    </div>
    ${main}
    <div class="card">
      <div class="card-head"><h2>스터디버디는 이렇게 진행돼요</h2></div>
      <ol class="steps">
        <li><b>매칭 신청</b><span class="small muted">시간표에서 시간을 고르고 장소, 교류 방식을 정하면 1:1로 연결돼요.</span></li>
        <li><b>약속 보증금 (선택)</b><span class="small muted">약속을 지키면 돌려받고, 어기면 지킨 메이트에게 보상으로 가요.</span></li>
        <li><b>약속 이행</b><span class="small muted">1주일 동안 만나서 각자 공부하고 출석·공부시간을 기록해요.</span></li>
        <li><b>주간 리포트와 재매칭</b><span class="small muted">같은 메이트와 계속할지, 새 메이트를 만날지 골라요.</span></li>
      </ol>
    </div>`;

  // ── 내 시간표 (매칭 · 대기 · 개인 일정) + 개인 일정 편집
  let mine = personal.map((p) => ({ ...p }));
  let editing = false;
  let editTitle = '수업';
  // 편집 중에는 칸 모양과 이름만 다시 칠한다 (끌기 상태 유지)
  const redrawCells = () => {
    const map = myTimetable({ matches, pendingRequests, personal: mine });
    $$('#my-tt .tt-cell').forEach((b) => {
      const info = map.get(b.dataset.cell);
      b.classList.remove('match', 'pending', 'personal');
      if (info) b.classList.add(info.kind);
      b.innerHTML = info?.label ? `<span>${esc(info.label)}</span>` : '';
    });
  };
  const drawTimetable = () => {
    const map = myTimetable({ matches, pendingRequests, personal: mine });
    const card = $('#my-tt-card');
    const empty = !matches.length && !pendingRequests.length && !mine.length;
    card.innerHTML = `
      <div class="card-head"><h2>🗓 내 시간표</h2>
        ${editing ? '' : '<button class="btn sm ghost" id="tt-edit">✏️ 개인 일정</button>'}</div>
      <div class="tt-legend tiny">
        <span><i class="lg match"></i>매칭</span><span><i class="lg pending"></i>대기</span><span><i class="lg personal"></i>개인 일정</span>
      </div>
      ${editing ? `
        <div class="notice"><span>✏️</span><span>일정 이름을 적고 칸을 누르거나 끌어서 넣어요. 같은 칸을 다시 누르면 빠져요.</span></div>
        <div class="row mt"><input class="input" id="tt-title" maxlength="20" value="${esc(editTitle)}" placeholder="예: 마케팅 수업"></div>` : ''}
      ${timetableHTML('my-tt', (cell) => {
        const info = map.get(cell);
        if (!info) return editing ? {} : { cls: 'ro' };
        if (editing) return { cls: info.kind, label: info.label, disabled: info.kind !== 'personal' };
        return { cls: `${info.kind} ${info.kind === 'match' ? 'link' : 'ro'}`, label: info.label };
      })}
      ${editing ? `
        <div class="btn-row mt">
          <button class="btn" id="tt-cancel">취소</button>
          <button class="btn primary" id="tt-save">저장</button>
        </div>` : (empty ? '<p class="tiny muted mt">매칭이나 개인 일정이 생기면 여기에 보여요.</p>' : '')}`;

    const tt = $('#my-tt');
    if (!editing) {
      // 매칭 칸을 누르면 그 매칭 화면으로
      tt.addEventListener('click', (e) => {
        const btn = e.target.closest('.tt-cell.match');
        const info = btn && map.get(btn.dataset.cell);
        if (info) location.hash = `#/match/${info.matchId}`;
      });
      $('#tt-edit').addEventListener('click', () => { editing = true; drawTimetable(); });
      return;
    }
    $('#tt-title').addEventListener('input', (e) => { editTitle = e.target.value; });
    tt.classList.add('editing');
    attachPaint(tt, {
      get: (cell) => mine.some((p) => p.cell === cell),
      set: (cell, on) => {
        mine = mine.filter((p) => p.cell !== cell);
        if (on) mine.push({ cell, title: editTitle.trim() || '개인 일정' });
        redrawCells();
      },
    });
    $('#tt-cancel').addEventListener('click', () => { mine = personal.map((p) => ({ ...p })); editing = false; drawTimetable(); });
    $('#tt-save').addEventListener('click', async () => {
      try {
        const res = await api('/me/personal', { method: 'PUT', body: { entries: mine } });
        personal.splice(0, personal.length, ...res.personal);
        mine = res.personal.map((p) => ({ ...p }));
        editing = false;
        toast('개인 일정을 저장했어요.');
        drawTimetable();
      } catch (err) { toast(err.message, true); }
    });
  };
  drawTimetable();

  $$('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('이 매칭 신청을 취소할까요? 걸어둔 보증금은 돌려드려요.')) return;
    try {
      await api(`/requests/${b.dataset.cancel}`, { method: 'DELETE' });
      toast('신청을 취소했어요.');
      router();
    } catch (err) { toast(err.message, true); }
  }));

  if (pendingRequests.length) {
    const before = matches.length;
    every(4000, async () => {
      const s = await api('/me').catch(() => null);
      if (s && s.matches.length > before && alive()) {
        toast('🎉 메이트를 찾았어요!');
        location.hash = `#/match/${s.matches.at(-1).id}`;
      }
    });
  }
}

// ───────────────────────── 매칭 신청 ─────────────────────────

async function renderApply(alive) {
  setTop({ title: '매칭 신청', back: '#/home' });
  setTabs(null);
  loading();
  const state = await api('/me');
  if (!alive()) return;
  const { user } = state;
  // 이미 매칭·신청한 칸과 개인 일정 칸은 고를 수 없다
  const taken = myTimetable(state);
  const defaults = ['1-7', '1-8', '3-7', '3-8', '5-7', '5-8'].filter((c) => !taken.has(c));

  const form = { cells: new Set(defaults), location: OPTIONS.locations[0], styles: new Set(), depositOn: false, deposit: 10000 };
  // 시간표: 칸을 누르거나 끌어서 고른다. form.cells = "요일-시간대번호" 모음
  const grid = () => timetableHTML('tt', (cell) => {
    const info = taken.get(cell);
    if (info) return { cls: `${info.kind} ro`, label: info.label, disabled: true };
    return { on: form.cells.has(cell) };
  });

  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>👤 내 프로필</h2><a class="link" href="#/me/edit">수정하기 ›</a></div>
      <div class="profile">
        <div class="avatar">${esc(user.avatar)}</div>
        <div>
          <div class="name">${esc(user.name)}${user.age ? `<small>(${user.age}세)</small>` : ''}</div>
          <div class="tags">${user.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="small muted">태그를 추가하면 메이트가 나를 더 잘 알 수 있어요</span>'}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>📅 공부 일정 및 장소 설정</h2></div>
      <div class="field"><span>공부할 시간</span>
        ${grid()}
        <p class="tiny muted tt-hint"><span class="one-line">칸을 누르거나 끌어서 골라요 · 낮 1시간 30분, 저녁(18시~) 1시간</span>${taken.size ? '회색 빗금 칸은 이미 매칭·신청했거나 개인 일정이 있는 시간이에요' : ''}</p>
        <button type="button" class="btn sm ghost" id="tt-clear">모두 지우기</button>
      </div>
      <label class="field"><span>장소 설정</span>
        <select class="select" id="loc">${OPTIONS.locations.map((l) => `<option>${esc(l)}</option>`).join('')}</select>
      </label>
    </section>

    <section class="card">
      <div class="card-head"><h2>📖 공부 스타일 선택</h2><span class="hint">중복 선택 가능</span></div>
      <div class="style-picker" id="styles">
        ${Object.entries(OPTIONS.styles).map(([k, s], i) => `
          <button type="button" data-style="${k}" aria-pressed="false">
            <b>${'ABC'[i]}. ${esc(s.label)}</b><small>${esc(s.desc)}</small>
          </button>`).join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>💰 보증금 설정</h2><span class="hint">노쇼 방지를 위해 걸 수 있어요</span></div>
      <div class="toggle-pair" id="dep">
        <button type="button" data-on="1" aria-pressed="false"><span class="switch"></span>보증금 사용</button>
        <button type="button" data-on="0" aria-pressed="true"><span class="switch"></span>사용 안함</button>
      </div>
      <div id="dep-amount" hidden>
        <label class="field"><span>보증금 금액 (보유 ${won(user.points)}P)</span>
          <select class="select" id="amount">${OPTIONS.deposits.map((d) => `<option value="${d}"${d === form.deposit ? ' selected' : ''}>${won(d)}원</option>`).join('')}</select>
        </label>
        <div class="notice"><span>🛡️</span><span>매칭이 성사되면 보증금이 안전하게 보관돼요. 약속을 모두 지키면 돌려받고, 지키지 못하면 약속을 지킨 메이트에게 보상으로 전달돼요. 메이트와 금액이 다르면 낮은 금액에 맞추고 차액은 바로 돌려드려요.</span></div>
      </div>
    </section>

    <div class="sticky-cta"><button class="btn primary block" id="submit">매칭 신청하기 →</button></div>`;

  $('#styles').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = b.dataset.style;
    form.styles.has(s) ? form.styles.delete(s) : form.styles.add(s);
    b.setAttribute('aria-pressed', form.styles.has(s));
  });
  $('#dep').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    form.depositOn = b.dataset.on === '1';
    $$('#dep button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#dep-amount').hidden = !form.depositOn;
  });
  // 시간표 칸: 누르면 켜고/끄고, 누른 채 끌면 같은 상태로 여러 칸을 칠한다 (마우스·터치 모두)
  attachPaint($('#tt'), {
    get: (cell) => form.cells.has(cell),
    set: (cell, on, btn) => {
      on ? form.cells.add(cell) : form.cells.delete(cell);
      btn.setAttribute('aria-pressed', on);
    },
  });
  $('#tt-clear').addEventListener('click', () => {
    form.cells.clear();
    $$('#tt .tt-cell').forEach((b) => b.setAttribute('aria-pressed', false));
  });
  $('#loc').addEventListener('change', (e) => { form.location = e.target.value; });
  $('#amount').addEventListener('change', (e) => { form.deposit = Number(e.target.value); });

  $('#submit').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const res = await api('/requests', {
        method: 'POST',
        body: {
          cells: [...form.cells],
          location: form.location,
          styles: [...form.styles],
          deposit: form.depositOn ? form.deposit : 0,
        },
      });
      if (res.matchId) {
        toast('🎉 바로 메이트를 찾았어요!');
        location.hash = `#/match/${res.matchId}`;
      } else {
        toast('신청 완료! 조건이 맞는 메이트를 기다리는 중이에요.');
        location.hash = '#/home';
      }
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
    }
  });
}

// ───────────────────────── 매칭중 ─────────────────────────

const STATUS_PILL = {
  done: '<span class="pill">출석</span>',
  studying: '<span class="pill lime">공부중</span>',
  missed: '<span class="pill red">미참석</span>',
  open: '<span class="pill lime">출석 가능</span>',
  scheduled: '<span class="pill gray">예정</span>',
  cancelled: '<span class="pill gray">취소</span>',
};
const MARK = {
  done: ['✓', '출석'], studying: ['✓', '공부중'], missed: ['✕', '미참석'],
  open: ['', '예정'], scheduled: ['', '예정'], off: ['–', '휴식'], cancelled: ['–', '취소'],
};

// 메이트가 여럿이면 화면 위에 메이트 고르는 버튼을 보여 준다
let mateTabs = '';
const mateTabsHTML = (matches, current, base) => (matches.length < 2 ? '' : `
  <div class="mate-tabs">${matches.map((m) => `
    <a href="#/${base}/${m.id}" class="${m.id === current ? 'on' : ''}">${esc(m.mate.avatar)} ${esc(m.mate.name)}<small>${esc(scheduleText(m.schedule))}</small></a>`).join('')}
  </div>`);

async function renderMatch(alive, id) {
  setTop({ title: '매칭중' });
  setTabs('match');
  loading();
  const { matches } = await api('/matches/active');
  if (!alive()) return;
  const match = matches.find((m) => m.id === id) ?? matches[0];
  mateTabs = mateTabsHTML(matches, match?.id, 'match');
  if (!match) {
    view.innerHTML = `
      <div class="empty">
        <div class="em">🌱</div>
        <h3>진행 중인 매칭이 없어요</h3>
        <p>매칭을 신청하면 1주일 동안 함께할 메이트를 찾아드려요.</p>
        <a class="btn primary mt-lg" href="#/home">홈으로</a>
      </div>`;
    return;
  }
  if (match.status === 'reported') return renderReport(match, alive);
  drawMatch(match, alive);
}

function drawMatch(m, alive) {
  const today = todayStr();
  const tabs = mateTabs;
  const target = m.appointments.find((a) => a.me.status === 'studying' || a.mate.status === 'studying')
    ?? m.appointments.find((a) => a.me.status === 'open' || a.mate.status === 'open');
  const next = m.appointments.find((a) => a.me.status === 'scheduled');

  // 현장 출석 확인: 내 코드는 메이트가 입력해서 내 출석을 확인해 주고, 나는 메이트의 코드를 입력해서 메이트 출석을 확인한다.
  let checkin;
  if (target) {
    const meIn = ['studying', 'done'].includes(target.me.status);
    const mateIn = ['studying', 'done'].includes(target.mate.status);
    const myPart = meIn
      ? (target.me.status === 'studying' ? `
        <div class="center">
          <p class="small muted">✅ 메이트가 내 출석을 확인했어요</p>
          <div class="timer mt" id="timer" data-since="${esc(target.me.checkedInAt)}">00:00:00</div>
          <p class="tiny muted">공부 시간 기록 중</p>
          <button class="btn primary block mt" id="checkout" data-id="${target.id}">공부 종료하고 기록하기</button>
        </div>` : '<p class="small">✅ 오늘 내 출석 완료 · 공부 기록을 마쳤어요</p>')
      : `
        <div class="checkin">
          <div>
            <p class="small"><b>내 출석 코드</b></p>
            <div class="code">${esc(target.myCode ?? '')}</div>
            <p class="tiny muted mt">메이트가 이 코드를 입력하거나 QR을 스캔하면 내 출석이 확인돼요.</p>
          </div>
          <div class="qr-box"><img data-qr="${target.id}" alt="내 출석 QR 코드"></div>
        </div>`;
    const matePart = mateIn
      ? `<p class="small">✅ ${esc(m.mate.name)}님 출석 확인 완료</p>`
      : `
        <p class="small"><b>${esc(m.mate.name)}님 출석 확인하기</b></p>
        <p class="tiny muted">메이트 화면에 보이는 출석 코드를 입력하거나 QR을 스캔해 주세요.</p>
        ${target.mateCode ? `<p class="tiny muted">🤖 데모 메이트 코드: <b class="code" style="font-size:12px">${esc(target.mateCode)}</b></p>` : ''}
        <form class="row mt" id="confirm-form" data-id="${target.id}">
          <input class="input code" name="code" maxlength="6" placeholder="메이트 코드" autocomplete="off" style="text-transform:uppercase" required>
          <button type="button" class="btn inline-btn" id="scan" data-id="${target.id}">⌗ QR</button>
        </form>
        <button class="btn primary block mt" id="confirm" data-id="${target.id}">✓ 상대방 출석 확인하기</button>`;
    checkin = `
      <p class="tiny muted">${fmtDate(target.date, true)} ${fmtTime(target.startTime)} ~ ${fmtTime(target.endTime)} 약속</p>
      <div class="att-part">${myPart}</div>
      <div class="att-part">${matePart}</div>`;
  } else if (next) {
    checkin = `<div class="notice" style="margin-top:0"><span>⏰</span><span>다음 약속은 <b>${fmtDate(next.date, true)} ${fmtTime(next.startTime)}</b>이에요. 시작 ${OPTIONS.checkinEarlyMin}분 전부터 출석할 수 있어요.</span></div>`;
  } else {
    checkin = '<div class="notice" style="margin-top:0"><span>✅</span><span>이번 주 약속이 모두 끝났어요. 주간이 끝나면 리포트가 도착해요.</span></div>';
  }

  const weekRow = (who) => m.week.map((d) => {
    const st = d[who];
    const [sym, label] = MARK[st];
    return `<div class="d${d.date === today ? ' today' : ''}">
      <b>${WD[d.weekday]}</b><span class="muted">${Number(d.date.slice(8))}일</span>
      <div class="mark ${st}">${sym}</div><span class="tiny">${label}</span>
    </div>`;
  }).join('');

  view.innerHTML = `${tabs}
    <section class="card">
      <div class="card-head"><h2>👥 메이트 프로필</h2><span class="pill">${m.round}주차</span></div>
      <div class="profile">
        <div class="avatar lg">${esc(m.mate.avatar)}</div>
        <div>
          <div class="name">${esc(m.mate.name)}${m.mate.age ? `<small>(${m.mate.age}세)</small>` : ''}${botBadge(m.mate)}</div>
          ${m.mate.bio ? `<div class="small muted">${esc(m.mate.bio)}</div>` : ''}
          <div class="tags">${m.mate.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
      </div>
      ${m.mate.isBot ? '<div class="notice"><span>🤖</span><span>체험용 <b>가상 메이트</b>예요. 실제로 약속 장소에 나오지 않아요. 내가 출석하면 함께 출석하고, 채팅에 자동으로 답해요.</span></div>' : ''}
      <div class="notice">
        <span>🤝</span>
        <span>${esc(styleLabels(m.styles))} · ${esc(m.location)}${m.stake ? ` · 보증금 ${won(m.stake)}원` : ' · 보증금 없음'}</span>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>📅 예정된 약속</h2><span class="hint">${fmtDate(m.weekStart)} ~ ${fmtDate(m.weekEnd)}</span></div>
      ${m.appointments.length ? m.appointments.map((a) => `
        <div class="appt${a.id === target?.id ? ' is-open' : ''}">
          <div class="date"><b>${fmtDate(a.date)}</b><span>(${WD[a.weekday]})</span></div>
          <div class="meta">
            <div>🕒 ${fmtTime(a.startTime)} ~ ${fmtTime(a.endTime)}</div>
            <div class="muted">📍 ${esc(a.location)}</div>
          </div>
          <div>${STATUS_PILL[a.me.status]}</div>
        </div>`).join('') : '<p class="small muted">이번 주 약속이 없어요.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>⌗ 현장 출석 확인</h2></div>
      ${checkin}
    </section>

    <section class="card">
      <div class="card-head"><h2>📊 이번주 출석</h2></div>
      <div class="stat-grid">
        <div class="stat"><b>${m.stats.me.attended}/${m.stats.me.total}</b><span>내 출석</span></div>
        <div class="stat"><b>${fmtMinutes(m.stats.me.minutes)}</b><span>내 공부시간</span></div>
        <div class="stat"><b>${m.stats.mate.attended}/${m.stats.mate.total}</b><span>메이트 출석</span></div>
      </div>
      <div class="week-label">나</div>
      <div class="week">${weekRow('me')}</div>
      <div class="week-label">${esc(m.mate.name)}</div>
      <div class="week">${weekRow('mate')}</div>
    </section>

    ${OPTIONS.demo ? `
      <div class="demo-bar">
        <b>데모 모드</b> · 시간과 상관없이 출석할 수 있고, 주간을 바로 마감해 리포트를 볼 수 있어요.
        <button class="btn sm block mt" id="settle">이번 주 마감하고 리포트 받기</button>
      </div>` : ''}

    <div class="leave-box">
      <button class="btn ghost block danger" id="leave">매칭 그만두기</button>
      <p class="tiny muted center">${esc(LEAVE_HINT[m.leavePolicy]?.(m) ?? '')}</p>
    </div>`;

  $$('img[data-qr]').forEach(async (img) => {
    const id = img.dataset.qr;
    img.src = window.__mockQr ? await window.__mockQr(Number(id)).catch(() => '') : `/api/appointments/${id}/qr`;
  });

  const timer = $('#timer');
  if (timer) {
    const since = new Date(timer.dataset.since).getTime();
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
      timer.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
    };
    tick();
    every(1000, tick);
  }

  const refresh = (match) => {
    if (!alive()) return;
    timers.forEach(clearInterval);
    timers = [];
    match.status === 'reported' ? renderReport(match, alive) : drawMatch(match, alive);
  };

  const confirmMate = async (id, code) => {
    try {
      const res = await api(`/appointments/${id}/confirm`, { method: 'POST', body: { code } });
      toast(`✅ ${m.mate.name}님 출석을 확인했어요. 함께 시작해요 📚`);
      refresh(res.match);
    } catch (err) { toast(err.message, true); }
  };
  $('#confirm')?.addEventListener('click', (e) => confirmMate(e.target.dataset.id, $('#confirm-form').code.value));
  $('#confirm-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    confirmMate(e.target.dataset.id, e.target.code.value);
  });
  $('#scan')?.addEventListener('click', (e) => openScanner(Number(e.target.dataset.id), refresh));
  $('#checkout')?.addEventListener('click', async (e) => {
    try {
      const res = await api(`/appointments/${e.target.dataset.id}/checkout`, { method: 'POST' });
      toast(`수고했어요! ${fmtMinutes(res.minutes)} 공부를 기록했어요.`);
      refresh(res.match);
    } catch (err) { toast(err.message, true); }
  });
  $('#leave')?.addEventListener('click', async () => {
    if (!confirm(LEAVE_CONFIRM[m.leavePolicy](m))) return;
    try {
      const res = await api(`/matches/${m.id}/leave`, { method: 'POST' });
      if (res.result === 'settled') {
        toast('이번 주를 정산했어요. 리포트를 확인해 주세요.');
        router();
        return;
      }
      toast(!res.stake ? '매칭을 그만뒀어요.'
        : res.lostTo === 'mate' ? `매칭을 그만뒀어요. 보증금 ${won(res.stake)}P는 메이트에게 전달됐어요.`
          : `매칭을 그만뒀어요. 보증금 ${won(res.stake)}P는 돌려받지 못해요.`);
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
  $('#settle')?.addEventListener('click', async () => {
    if (!confirm('이번 주를 마감하고 보증금을 정산할까요?')) return;
    try {
      const res = await api(`/matches/${m.id}/settle`, { method: 'POST' });
      refresh(res.match);
    } catch (err) { toast(err.message, true); }
  });
}

// 매칭 그만두기 규칙 안내 (server/service.js leavePolicy 와 같은 규칙)
const LEAVE_HINT = {
  penalty: (m) => (m.stake ? '지금 그만두면 내 보증금은 돌려받을 수 없어요.' : '지금 그만두면 이번 주 매칭이 바로 끝나요.'),
  settle: () => '남은 약속이 없어서, 지금까지 출석으로 이번 주를 정산해요.',
};
const LEAVE_CONFIRM = {
  penalty: (m) => (m.stake
    ? '정말 매칭을 그만둘까요?\n\n내 보증금은 돌려받을 수 없어요.'
    : `정말 매칭을 그만둘까요?\n\n${m.mate.name}님과의 이번 주 매칭이 바로 끝나요.`),
  settle: () => '남은 약속이 없어요. 지금까지 출석으로 이번 주를 정산하고 리포트를 받을까요?',
};

const DEPOSIT_TEXT = {
  none: () => '보증금 없이 진행했어요.',
  refunded: (n) => `약속을 지켜 보증금 ${won(n)}원을 돌려받았어요.`,
  to_mate: (n) => `약속을 지키지 못해 보증금 ${won(n)}원이 메이트에게 전달됐어요.`,
  forfeited: (n) => `둘 다 약속을 지키지 못해 보증금 ${won(n)}원이 반환되지 않았어요.`,
};

function renderReport(m, alive) {
  setTop({ title: '주간 리포트' });
  const { me, mate } = m.report;
  const col = (who, r, name) => `
    <div class="col">
      <div class="small muted">${esc(name)}</div>
      <div class="big">${r.rate}%</div>
      <div class="tiny muted">출석 ${r.attended}/${r.total}</div>
      <div class="bar"><i style="width:${r.rate}%"></i></div>
      <div class="small mt"><b>${fmtMinutes(r.minutes)}</b></div>
      <div class="tiny muted">공부시간</div>
    </div>`;

  let choice;
  if (m.myChoice === 'continue') {
    choice = `<div class="notice"><span>⏳</span><span>${esc(m.mate.name)}님의 선택을 기다리고 있어요. 둘 다 '계속하기'를 고르면 다음 주 약속이 바로 만들어져요.</span></div>`;
  } else {
    choice = `
      <p class="small muted">${m.mateChoice === 'continue' ? `💚 ${esc(m.mate.name)}님은 계속하고 싶어해요!` : '다음 주는 어떻게 할까요?'}</p>
      <div class="stack mt">
        <button class="btn primary block" data-choice="continue">${esc(m.mate.name)}님과 계속하기</button>
        <button class="btn block" data-choice="new">새 메이트 만나기</button>
      </div>`;
  }

  view.innerHTML = `${mateTabs}
    <section class="card hero">
      <div class="small muted">${fmtDate(m.weekStart)} ~ ${fmtDate(m.weekEnd)} · ${m.round}주차</div>
      <h2 style="font-size:20px;margin-top:4px">${me.kept ? '이번 주 약속을 모두 지켰어요 🎉' : '이번 주는 아쉬웠어요'}</h2>
    </section>

    <section class="card">
      <div class="card-head"><h2>📈 출석률과 공부시간</h2></div>
      <div class="vs">${col('me', me, '나')}${col('mate', mate, m.mate.name)}</div>
    </section>

    <section class="card">
      <div class="card-head"><h2>💰 보증금 정산</h2></div>
      <p class="small">${DEPOSIT_TEXT[me.deposit.result](me.deposit.amount)}</p>
      ${me.reward ? `<p class="small mt"><span class="plus">+${won(me.reward)}P</span> 메이트의 미이행 보상을 받았어요.</p>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>🔁 다음 주 선택</h2></div>
      ${choice}
    </section>`;

  $$('[data-choice]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const res = await api(`/matches/${m.id}/choice`, { method: 'POST', body: { choice: b.dataset.choice } });
      if (res.next === 'continue') {
        toast(`${m.mate.name}님과 다음 주도 함께해요!`);
        router();
      } else if (res.next === 'new') {
        toast('새 메이트를 찾아볼까요?');
        location.hash = '#/apply';
      } else {
        toast('선택을 저장했어요.');
        router();
      }
    } catch (err) { toast(err.message, true); }
  }));

  if (m.myChoice === 'continue') {
    every(4000, async () => {
      const res = await api('/matches/current').catch(() => null);
      if (!alive() || !res) return;
      if (!res.match || res.match.id !== m.id) router();
    });
  }
}

// ───────────────────────── 지난 스터디 다시 보기 ─────────────────────────

const PAST_DEPOSIT = {
  none: () => '보증금 없이 진행했어요.',
  refunded: (n) => `보증금 ${won(n)}P를 돌려받았어요.`,
  to_mate: (n) => `보증금 ${won(n)}P가 메이트에게 전달됐어요.`,
  forfeited: (n) => `둘 다 약속을 지키지 못해 보증금 ${won(n)}P가 반환되지 않았어요.`,
};

async function renderPast(alive, id) {
  setTop({ title: '지난 스터디', back: '#/me' });
  setTabs('me');
  loading();
  const { match: m } = await api(`/matches/${id}`);
  if (!alive()) return;
  if (m.status !== 'closed') {
    location.hash = '#/match'; // 아직 진행 중인 매칭은 매칭중 화면에서
    return;
  }
  const r = m.report;
  const headline = m.headline ? m.headline : m.left === 'me' ? '내가 중간에 그만둔 스터디예요'
    : m.left === 'mate' ? `${m.mate.name}님이 중간에 그만둔 스터디예요`
    : r?.me?.kept ? '약속을 모두 지킨 주였어요 🎉' : '아쉬움이 남은 주였어요';

  const weekRow = (who) => m.week.map((d) => {
    const [sym, label] = MARK[d[who]];
    return `<div class="d"><b>${WD[d.weekday]}</b><span class="muted">${Number(d.date.slice(8))}일</span>
      <div class="mark ${d[who]}">${sym}</div><span class="tiny">${label}</span></div>`;
  }).join('');
  const col = (u, name) => `
    <div class="col">
      <div class="small muted">${esc(name)}</div>
      <div class="big">${u.rate}%</div>
      <div class="tiny muted">출석 ${u.attended}/${u.total}</div>
      <div class="bar"><i style="width:${u.rate}%"></i></div>
      <div class="small mt"><b>${fmtMinutes(u.minutes)}</b></div>
      <div class="tiny muted">공부시간</div>
    </div>`;

  view.innerHTML = `
    <section class="card hero">
      <div class="small muted">${fmtDate(m.weekStart)} ~ ${fmtDate(m.weekEnd)} · ${esc(m.label ?? `${m.round}주차`)} · ${esc(m.location)}</div>
      <h2 style="font-size:18px;margin-top:4px">${esc(headline)}</h2>
    </section>

    <section class="card">
      <div class="card-head"><h2>👥 메이트</h2></div>
      <div class="profile">
        <div class="avatar">${esc(m.mate.avatar)}</div>
        <div>
          <div class="name">${esc(m.mate.name)}${m.mate.age ? `<small>(${m.mate.age}세)</small>` : ''}${botBadge(m.mate)}</div>
          <div class="tags">${m.mate.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
      </div>
      <div class="notice"><span>🤝</span><span>${esc(styleLabels(m.styles))} · ${m.stake ? `보증금 ${won(m.stake)}P` : '보증금 없음'}</span></div>
    </section>

    ${r ? `
    <section class="card">
      <div class="card-head"><h2>📈 출석률과 공부시간</h2></div>
      <div class="vs">${col(r.me, '나')}${col(r.mate, m.mate.name)}</div>
      <p class="small mt">💰 ${PAST_DEPOSIT[r.me.deposit.result](r.me.deposit.amount)}
        ${r.me.reward ? ` 보상으로 <span class="plus">+${won(r.me.reward)}P</span>를 받았어요.` : ''}</p>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>📅 약속</h2></div>
      ${m.appointments.map((a) => `
        <div class="appt">
          <div class="date"><b>${fmtDate(a.date)}</b><span>(${WD[a.weekday]})</span></div>
          <div class="meta"><div>🕒 ${fmtTime(a.startTime)} ~ ${fmtTime(a.endTime)}</div>
            ${a.me.minutes ? `<div class="muted">공부 ${fmtMinutes(a.me.minutes)}</div>` : ''}</div>
          <div>${STATUS_PILL[a.me.status]}</div>
        </div>`).join('') || '<p class="small muted">약속이 없었어요.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>📊 출석</h2></div>
      <div class="week-label">나</div>
      <div class="week">${weekRow('me')}</div>
      <div class="week-label">${esc(m.mate.name)}</div>
      <div class="week">${weekRow('mate')}</div>
    </section>`;
}

// ───────────────────────── QR 스캐너 ─────────────────────────

function closeModal() {
  const modal = $('#modal');
  modal.dispatchEvent(new Event('close'));
  modal.hidden = true;
  modal.innerHTML = '';
}

function openScanner(appointmentId, onDone) {
  const modal = $('#modal');
  const canScan = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  modal.innerHTML = `
    <div class="sheet">
      <div class="row between"><h3>QR 스캔하기</h3><button class="btn sm ghost" id="close">닫기</button></div>
      <p class="small muted">메이트 화면의 출석 QR을 비추거나, 아래에 메이트의 코드를 입력하세요.</p>
      ${canScan ? '<div class="scanner"><video id="video" playsinline muted></video></div>' : '<div class="notice">이 브라우저는 카메라 QR 인식을 지원하지 않아요. 메이트 화면의 6자리 코드를 입력해 주세요.</div>'}
      <form id="code-form" class="row mt">
        <input class="input code" name="code" maxlength="6" placeholder="메이트 코드" autocomplete="off" style="text-transform:uppercase" required>
        <button class="btn primary">출석 확인</button>
      </form>
    </div>`;
  modal.hidden = false;

  let stream = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
  };
  modal.addEventListener('close', stop, { once: true });
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  $('#close').addEventListener('click', closeModal);

  const submit = async (code) => {
    try {
      const res = await api(`/appointments/${appointmentId}/confirm`, { method: 'POST', body: { code } });
      closeModal();
      toast('✅ 메이트 출석을 확인했어요. 함께 시작해요 📚');
      onDone(res.match);
    } catch (err) { toast(err.message, true); }
  };

  $('#code-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit(new FormData(e.target).get('code'));
  });

  if (canScan) {
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) return stop();
        const video = $('#video');
        video.srcObject = stream;
        await video.play();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const loop = async () => {
          if (stopped) return;
          const codes = await detector.detect(video).catch(() => []);
          const hit = codes.map((c) => c.rawValue).find((v) => v.startsWith('SB:'));
          if (hit) return submit(hit.split(':')[2]);
          requestAnimationFrame(loop);
        };
        loop();
      } catch {
        toast('카메라를 사용할 수 없어요. 코드를 입력해 주세요.', true);
      }
    })();
  }
}

// ───────────────────────── 채팅 ─────────────────────────

async function renderChat(alive, id) {
  setTop({ title: '채팅' });
  setTabs('chat');
  loading();
  const [{ matches }, { user }] = await Promise.all([api('/matches/active'), api('/me')]);
  if (!alive()) return;
  const match = matches.find((m) => m.id === id) ?? matches[0];
  if (!match) {
    view.innerHTML = `
      <div class="empty"><div class="em">💬</div><h3>대화할 메이트가 없어요</h3>
      <p>매칭이 되면 메이트와 약속을 이야기할 수 있어요.</p></div>`;
    return;
  }
  setTop({ title: `${match.mate.avatar} ${match.mate.name}` });
  const quick = quickMessages(match);
  view.innerHTML = `${mateTabsHTML(matches, match.id, 'chat')}
    <div class="notice"><span>📌</span><span>${esc(match.location)} · ${esc(scheduleText(match.schedule))}</span></div>
    <div class="chat mt" id="chat"></div>
    <div class="chat-dock">
      <div class="quick">
        <div class="quick-head"><b>⚡ 메이트 빠른 연락</b><span>원클릭 알림</span></div>
        <div class="quick-list" id="quick">
          ${quick.map((q, i) => `
            <button type="button" class="quick-card" data-i="${i}">
              <span class="quick-icon">${q.icon}</span>
              <span class="quick-text"><b>${esc(q.title)}</b><small>"${esc(q.body)}"</small></span>
            </button>`).join('')}
        </div>
      </div>
      <form class="chat-input" id="send">
        <input class="input" name="body" maxlength="500" placeholder="메시지를 입력하세요" autocomplete="off">
        <button class="btn primary">전송</button>
      </form>
    </div>`;

  const box = $('#chat');
  // 하단 빠른 연락 + 입력창 높이만큼 비워 두어 마지막 메시지가 가려지지 않게 한다.
  box.style.paddingBottom = `${$('.chat-dock').offsetHeight + 16}px`;
  let lastId = 0;
  const load = async () => {
    const { messages } = await api(`/matches/${match.id}/messages?after=${lastId}`);
    if (!alive() || !messages.length) return;
    $('#hello')?.remove();
    for (const msg of messages) {
      lastId = msg.id;
      const t = new Date(msg.createdAt);
      box.insertAdjacentHTML('beforeend', `
        <div class="bubble ${msg.userId === user.id ? 'me' : 'mate'}">${esc(msg.body)}<time>${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}</time></div>`);
    }
    scroller().scrollTo(0, scroller().scrollHeight);
  };
  await load();
  if (!box.children.length) box.innerHTML = `<p class="center small muted" id="hello">${esc(match.mate.name)}님께 먼저 인사해 보세요 👋</p>`;
  every(3000, () => load().catch(() => {}));

  const send = (body) => api(`/matches/${match.id}/messages`, { method: 'POST', body: { body } }).then(load);

  $('#send').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.body;
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try {
      await send(body);
    } catch (err) {
      toast(err.message, true);
      input.value = body;
    }
  });

  $('#quick').addEventListener('click', async (e) => {
    const card = e.target.closest('.quick-card');
    if (!card || card.disabled) return;
    const q = quick[Number(card.dataset.i)];
    card.disabled = true;
    try {
      await send(q.body);
      toast(`${q.icon} ${match.mate.name}님께 알림을 보냈어요.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      card.disabled = false;
    }
  });
}

// 채팅 '메이트 빠른 연락' 원클릭 메시지
function quickMessages(match) {
  return [
    { icon: '🚶', title: '도착 완료 알림', body: `${match.location}에 도착했어요! 먼저 자리 잡고 있을게요.` },
    { icon: '⏰', title: '5분 지연 양해', body: '5분 정도 늦을 것 같아요. 죄송해요, 금방 갈게요!' },
    { icon: '☕', title: '쉬는 시간 제안', body: '잠깐 10분 쉬었다 할까요?' },
    { icon: '👋', title: '오늘 수고 인사', body: '오늘도 같이 공부해서 좋았어요. 수고 많으셨어요!' },
  ];
}

// ───────────────────────── 마이페이지 ─────────────────────────

async function renderMe(alive) {
  setTop({ title: '마이페이지' });
  setTabs('me');
  loading();
  const [{ user }, { logs }, { matches }] = await Promise.all([api('/me'), api('/me/points'), api('/me/history')]);
  if (!alive()) return;

  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>👤 내 프로필</h2><a class="link" href="#/me/edit">수정하기 ›</a></div>
      <div class="profile">
        <div class="avatar lg">${esc(user.avatar)}</div>
        <div>
          <div class="name">${esc(user.name)}${user.age ? `<small>(${user.age}세)</small>` : ''}</div>
          <div class="small muted">${esc(user.email)}</div>
          ${user.bio ? `<div class="small mt">${esc(user.bio)}</div>` : ''}
          <div class="tags">${user.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>💰 포인트</h2><span class="pill lime">${won(user.points)}P</span></div>
      ${logs.length ? logs.map((l) => `
        <div class="list-item">
          <div><div>${esc(l.reason)}</div><div class="tiny muted">${new Date(l.created_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</div></div>
          <span class="${l.amount > 0 ? 'plus' : 'minus'}">${l.amount > 0 ? '+' : ''}${won(l.amount)}</span>
        </div>`).join('') : '<p class="small muted">아직 포인트 내역이 없어요.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>📚 지난 스터디</h2></div>
      ${matches.length ? matches.map((h) => `
        <a class="list-item link-item" href="#/history/${h.id}">
          <div class="row">
            <div class="avatar sm">${esc(h.mate.avatar)}</div>
            <div><div><b>${esc(h.mate.name)}</b></div><div class="tiny muted">${fmtDate(h.weekStart)} ~ ${fmtDate(h.weekEnd)} · ${esc(h.location)}</div></div>
          </div>
          <span class="row" style="gap:6px">${h.left ? `<span class="pill red">${h.left === 'me' ? '내가 그만둠' : '메이트가 그만둠'}</span>` : h.report ? `<span class="pill">${h.report.me.rate}% · ${fmtMinutes(h.report.me.minutes)}</span>` : ''}<span class="chev">›</span></span>
        </a>`).join('') : '<p class="small muted">첫 주를 마치면 여기에 기록이 쌓여요.</p>'}
    </section>

    <button class="btn ghost block mt-lg danger" id="logout">로그아웃</button>
    ${window.__mockReset ? '<button class="btn ghost block small muted" id="reset">이 브라우저의 데모 데이터 모두 지우기</button>' : ''}`;

  $('#reset')?.addEventListener('click', () => {
    if (!confirm('이 브라우저에 저장된 계정·매칭 기록을 모두 지우고 처음 상태로 돌아갈까요?')) return;
    window.__mockReset();
    location.hash = '#/login';
    location.reload();
  });

  $('#logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.hash = '#/login';
  });
}

async function renderEditProfile(alive) {
  setTop({ title: '프로필 수정', back: '#/me' });
  setTabs(null);
  loading();
  const { user } = await api('/me');
  if (!alive()) return;
  let avatar = user.avatar;
  const avatars = AVATARS.includes(avatar) ? AVATARS : [avatar, ...AVATARS.slice(0, -1)];

  view.innerHTML = `
    <form id="f" class="card">
      <div class="field"><span>아바타</span>
        <div class="avatar-picker" id="avatars">
          ${avatars.map((a) => `<button type="button" aria-pressed="${a === avatar}">${a}</button>`).join('')}
        </div>
      </div>
      <label class="field"><span>이름 (닉네임)</span><input class="input" name="name" maxlength="20" value="${esc(user.name)}" required></label>
      <label class="field"><span>나이</span><input class="input" name="age" type="number" min="14" max="100" value="${user.age ?? ''}"></label>
      <label class="field"><span>태그 (쉼표로 구분, 최대 5개)</span><input class="input" name="tags" value="${esc(user.tags.join(', '))}" placeholder="#카페공부, #자격증준비, #ENFJ"></label>
      <label class="field"><span>한 줄 소개</span><textarea class="input" name="bio" maxlength="200" placeholder="메이트에게 나를 소개해 주세요">${esc(user.bio)}</textarea></label>
      <button class="btn primary block mt-lg">저장하기</button>
    </form>`;

  $('#avatars').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    avatar = b.textContent;
    $$('#avatars button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  });
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await api('/me', {
        method: 'PUT',
        body: { ...fd, avatar, tags: fd.tags.split(/[,\s]+/).filter(Boolean) },
      });
      toast('프로필을 저장했어요.');
      history.back();
    } catch (err) { toast(err.message, true); }
  });
}
