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
// 선 아이콘 (Phosphor Icons, MIT 라이선스 — public/vendor/PHOSPHOR_LICENSE.txt)
const ICON_D = {
  'caret-left': 'M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z',
  'caret-right': 'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z',
};
const icon = (name, cls = '') => `<svg class="ic${cls ? ` ${cls}` : ''}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"><path d="${ICON_D[name]}"/></svg>`;

// 프로필 동그라미: 이모지 대신 이름 글자. 성을 빼고 이름 두 글자 (김지민 → 지민, 남궁민수 → 민수), 별명은 앞 두 글자.
const SURNAMES = '김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부';
const SURNAMES_2 = ['남궁', '제갈', '황보', '선우', '독고', '서문'];
function initials(name) {
  const first = String(name ?? '').trim().split(/\s+/)[0] || '?';
  if (!/^[가-힣]+$/.test(first)) return first.slice(0, 1).toUpperCase();
  if (first.length >= 4 && SURNAMES_2.includes(first.slice(0, 2))) return first.slice(2, 4);
  if (first.length >= 3 && SURNAMES.includes(first[0])) return first.slice(1, 3);
  return first.slice(0, 2);
}
// 사람마다 다른 은은한 색 (포스터의 올리브·연두·모래색 계열)
const AV_TONES = [['#e3f0d6', '#3d6125'], ['#eef3c6', '#4f5c1a'], ['#f1e8d2', '#6a5226'], ['#e6eadb', '#465a31']];
function avatarHTML(u, size = '') {
  const n = [...String(u?.name ?? '')].reduce((sum, c) => sum + c.codePointAt(0), 0);
  const [bg, fg] = AV_TONES[n % AV_TONES.length];
  return `<div class="avatar${size ? ` ${size}` : ''}" style="background:${bg};color:${fg}" aria-hidden="true">${esc(initials(u?.name))}</div>`;
}
// 태그는 알약 모양 대신 글자로
const tagsHTML = (tags) => (tags?.length ? `<p class="tags">${tags.map((t) => esc(t)).join(' ')}</p>` : '');

let OPTIONS = null;
let timers = [];
let routeToken = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(s, withWeekday = false) {
  const [, m, d] = s.split('-').map(Number);
  const wd = new Date(`${s}T00:00:00`).getDay();
  return `${m}월 ${d}일${withWeekday ? ` (${WD[wd === 0 ? 7 : wd]})` : ''}`;
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
const fmtRange = (a, b) => `${fmtTime(a)}–${fmtTime(b)}`;
// 이번 회차 날짜·시간 한 줄: "11월 10일(화)·11일(수)·12일(목) 19:00–21:00"
function periodText() {
  const p = OPTIONS.studyPeriod;
  const days = p.dates.map((d, i) => {
    const [, mo, dd] = d.split('-').map(Number);
    const wd = WD[new Date(`${d}T00:00:00`).getDay() || 7];
    return i === 0 ? `${mo}월 ${dd}일(${wd})` : `${dd}일(${wd})`;
  });
  return `${days.join('·')} ${fmtRange(p.start, p.end)}`;
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
// 날짜 범위: 같은 달이면 "11월 3일–5일", 다른 달이면 "10월 30일–11월 2일" (시간 범위와 같은 – 기호)
function fmtDateRange(a, b) {
  const [, am, ad] = a.split('-').map(Number);
  const [, bm, bd] = b.split('-').map(Number);
  if (a === b) return `${am}월 ${ad}일`;
  return am === bm ? `${am}월 ${ad}일–${bd}일` : `${am}월 ${ad}일–${bm}월 ${bd}일`;
}

// ── 약속 지키기 (보증금 대신): 약속 날 안 나오거나 매칭을 그만두면 1회.
//    정해진 횟수가 되면 일정 기간 매칭 신청이 멈추고, 끝나면 0회부터 다시 센다. (server/options.js PROMISE_RULE)
const rule = () => OPTIONS.promiseRule ?? { strikeLimit: 2, suspendDays: 30, from: '' };
const ruleOn = () => todayStr() >= rule().from;
// ISO 시각 → 한국 날짜 "12월 6일"
function kDay(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}
const reopenText = (st) => `${kDay(st.suspendedUntil)}부터 다시 신청할 수 있어요.`;
const RULE_TEXT = () => `약속 날 안 나오거나 매칭을 그만두면 1회로 기록돼요. ${rule().strikeLimit}회가 되면 ${rule().suspendDays}일 동안 매칭 신청이 멈추고, 정지가 끝나면 다시 0회부터 시작해요.`;
let myStrikes = null; // 내 약속 기록 (메이트 화면을 열 때 받아 둔다)

async function api(path, { method = 'GET', body } = {}) {
  // 단독 실행 HTML(npm run build:standalone)에서는 브라우저 안의 가짜 서버를 쓴다.
  if (window.__mockApi) {
    const { status, data } = await window.__mockApi(path, { method, body });
    if (status >= 400) {
      const err = new Error(data.error || '요청을 처리하지 못했어요.');
      err.status = status;
      err.code = data.code ?? null;
      if (err.code === 'consent_required') goConsent();
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
    err.code = data.code ?? null;
    if (err.code === 'consent_required') goConsent();
    throw err;
  }
  return data;
}

// 처리방침 동의가 필요하다는 응답을 받으면(화면을 보는 중 주기적으로 묻는 요청 포함) 홈으로 → 동의 창
function goConsent() {
  if (!/^#?\/?(home)?$/.test(location.hash)) location.hash = '#/home';
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// 일이 빨리 끝나도 로딩 화면을 최소 ms 동안 보여 준다 (오류는 기다리지 않고 바로 알림)
// 첫 인자(예전 이모지 자리)는 쓰지 않는다.
async function withLoading(_icon, text, task, ms = 600) {
  const modal = $('#modal');
  modal.innerHTML = `
    <div class="finding">
      <div class="spinner sm"></div>
      <b>${text}</b>
    </div>`;
  modal.hidden = false;
  const minWait = new Promise((r) => setTimeout(r, ms));
  try {
    const res = await task();
    await minWait;
    return res;
  } finally {
    closeModal();
  }
}

// 화면이 바뀌면 멈추는 반복 (화면을 안 보고 있을 때는 건너뜀)
function every(ms, fn) {
  timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms));
}

// 서버에 주기적으로 묻기: 조용할수록 천천히 묻는다. gaps = [[조용한 시간 ms, 묻는 간격 ms], ...] (앞에서부터 처음 맞는 것)
// 화면을 안 보고 있으면 묻지 않고, 다시 보면 바로 묻는다. 돌려주는 active()를 부르면 다시 자주 묻는다.
const POLL_GAPS = [[60 * 1000, 4000], [5 * 60 * 1000, 10000], [Infinity, 20000]];
function poll(fn, gaps = POLL_GAPS) {
  let quietSince = Date.now();
  let nextAt = 0;
  let busy = false;
  let away = false;
  const schedule = () => {
    const quiet = Date.now() - quietSince;
    nextAt = Date.now() + gaps.find(([upTo]) => quiet < upTo)[1];
  };
  schedule();
  timers.push(setInterval(async () => {
    if (document.hidden) { away = true; return; }
    if (busy || (!away && Date.now() < nextAt)) return;
    away = false;
    busy = true;
    try { await fn(); } catch { /* 다음 차례에 다시 */ } finally { busy = false; schedule(); }
  }, 1000));
  return { active: () => { quietSince = Date.now(); nextAt = Math.min(nextAt, Date.now() + gaps[0][1]); } };
}

function setTop({ title = '', back = null, brand = false, right = '' } = {}) {
  topbar.hidden = false;
  topbar.innerHTML = `
    <div>${back ? `<a class="icon-btn" href="${back}" aria-label="뒤로">${icon('caret-left')}</a>` : ''}</div>
    ${brand ? '<div class="center"><img class="logo" src="logo.svg" alt="스터디버디"></div>' : `<h1>${esc(title)}</h1>`}
    <div>${right}</div>`;
}

function setTabs(active) {
  tabbar.hidden = !active;
  view.classList.toggle('no-tabs', !active);
  $$('a', tabbar).forEach((a) => a.classList.toggle('active', a.dataset.tab === active));
}

const loading = () => { view.innerHTML = '<div class="spinner"></div>'; };

// 데모(가상) 메이트 표시
const botBadge = (u) => (u?.isBot ? ' <small class="bot-note" title="실제 사람이 아닌 체험용 메이트">데모</small>' : '');

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
    const key = fmtRange(r.start, r.end);
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
  admin: renderAdmin,
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
  const [, adminMatchId, adminSide] = name.match(/^admin\/match\/(\d+)(?:\/(a|b))?$/) ?? [];
  const render = adminMatchId ? (alive) => renderAdminMatch(alive, Number(adminMatchId), adminSide ?? 'a')
    : pastId ? (alive) => renderPast(alive, Number(pastId))
    : sub === 'match' ? (alive) => renderMatch(alive, Number(subId))
      : sub === 'chat' ? (alive) => renderChat(alive, Number(subId))
        : routes[name] ?? renderHome;
  try {
    if (!OPTIONS) OPTIONS = await api('/options');
    await render(() => token === routeToken);
    refreshUnread();
  } catch (err) {
    if (err.status === 401 && !['login', 'signup', 'reset'].includes(name)) {
      location.hash = '#/login';
      return;
    }
    // 처리방침 동의 전: 홈에서 동의 창을 띄운다
    if (err.code === 'consent_required' && name !== 'home') {
      location.hash = '#/home';
      return;
    }
    console.error(err);
    view.innerHTML = `<div class="empty"><h3>문제가 생겼어요</h3><p>${esc(err.message)}</p></div>`;
  }
}

// ── 안 읽은 채팅: 채팅 탭 아이콘 위 빨간 숫자 (홈 등 탭이 보이는 모든 화면)
let unread = { total: 0, byMatch: {} };
async function refreshUnread() {
  if (tabbar.hidden || document.hidden) return;
  try { unread = await api('/chat/unread'); } catch { return; }
  const tab = $('a[data-tab="chat"]', tabbar);
  let badge = $('.badge', tab);
  if (!unread.total) {
    badge?.remove();
    tab.removeAttribute('aria-label');
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'badge';
    badge.setAttribute('aria-hidden', 'true');
    $('.ti', tab).append(badge);
  }
  badge.textContent = unread.total > 99 ? '99+' : String(unread.total);
  tab.setAttribute('aria-label', `채팅, 안 읽은 메시지 ${unread.total}개`);
}
setInterval(refreshUnread, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshUnread(); });

window.addEventListener('hashchange', router);
router();
countVisit();


// 방문 기록: 브라우저마다 무작위 id를 하나 만들어 두고, 사이트를 열 때마다 서버에 알린다 (실패해도 화면에는 영향 없음)
function countVisit() {
  try {
    let id = localStorage.getItem('visitorId');
    if (!id) {
      id = crypto.getRandomValues(new Uint32Array(4)).reduce((s, n) => s + n.toString(36).padStart(7, '0'), '');
      localStorage.setItem('visitorId', id);
    }
    api('/visit', { method: 'POST', body: { id } }).catch(() => {});
  } catch {}
}

// ───────────────────────── 로그인 / 가입 ─────────────────────────

function authShell(inner) {
  setTop({});
  setTabs(null);
  // 로그인·가입·비밀번호 찾기 화면에는 위쪽 띠가 없다 (스크롤할 때 로고를 가리지 않게)
  topbar.innerHTML = '';
  topbar.hidden = true;
  view.innerHTML = `
    <div class="auth">
      <img class="logo lg" src="logo-stack.svg" alt="STUDY BUDDY 스터디버디">
      ${inner}
    </div>`;
  $$('.email-input input').forEach(placeDomain);
}

// 실서비스는 국민대 메일만 받는다. 칸에는 @ 앞(아이디)만 입력하고, 보낼 때 @kookmin.ac.kr 을 붙인다.
const withDomain = (email) => {
  const v = String(email ?? '').trim();
  if (!OPTIONS.emailDomain || !v) return v;
  return `${v.split('@')[0]}@${OPTIONS.emailDomain}`;
};

const emailLabel = () => (OPTIONS.emailDomain ? '국민대 메일' : '이메일');

// 메일 입력칸. 국민대 메일만 받을 때는 뒤에 @kookmin.ac.kr 을 고정으로 붙여 보여 준다.
const emailInput = () => (OPTIONS.emailDomain
  ? `<div class="email-input"><input class="input" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="아이디" required><span>@${esc(OPTIONS.emailDomain)}</span></div>`
  : '<input class="input" name="email" type="email" autocomplete="email" required>');

// @kookmin.ac.kr 을 입력한 글자(비어 있으면 '아이디' 안내 글자) 바로 뒤에 붙인다.
// 칸 끝까지 차면 오른쪽 끝에 멈추고, 글자는 그 앞에서 옆으로 밀린다.
const measureCtx = document.createElement('canvas').getContext('2d');
function placeDomain(input) {
  const span = input.nextElementSibling;
  if (!span) return;
  const cs = getComputedStyle(input);
  measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = input.value || input.placeholder;
  const left = parseFloat(cs.paddingLeft) + measureCtx.measureText(text).width + 2;
  span.style.left = `${Math.min(left, input.clientWidth - span.offsetWidth - 12)}px`;
}
document.fonts?.ready.then(() => $$('.email-input input').forEach(placeDomain));

// 아이디 칸에 전체 주소를 붙여 넣으면 @ 앞만 남긴다
document.addEventListener('input', (e) => {
  if (OPTIONS.emailDomain && e.target.name === 'email' && e.target.value.includes('@')) {
    e.target.value = e.target.value.split('@')[0];
  }
  if (e.target.closest?.('.email-input')) placeDomain(e.target);
});

// 이메일 + "인증번호 받기" 버튼 + 인증번호 입력칸 (메일 인증을 쓰는 실서비스에서만)
function emailCodeFields() {
  if (!OPTIONS.emailVerification) {
    return `<label class="field"><span>${emailLabel()}</span>${emailInput()}</label>`;
  }
  return `
    <div class="field"><span>${emailLabel()}</span>
      <div class="row">
        ${emailInput()}
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
    const email = withDomain(form.email.value);
    if (!email) return toast('메일 주소를 입력해 주세요.', true);
    btn.disabled = true;
    try {
      await api('/auth/code', { method: 'POST', body: { email, purpose } });
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
    <h2>같은 시간에 만나<br>함께 공부해요</h2>
    <p class="lead">매주 새로운 ${OPTIONS.emailDomain ? '국민대 ' : ''}메이트와 약속을 잡고, 함께 공부하며 더 넓은 캠퍼스를 만나요.</p>
    <form id="f" class="card">
      <label class="field"><span>${emailLabel()}</span>${emailInput()}</label>
      <label class="field"><span>비밀번호</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary block mt-lg">로그인</button>
    </form>
    <p class="switch-link">처음이신가요? <a href="#/signup">회원가입</a>${OPTIONS.emailVerification ? ' · <a href="#/reset">비밀번호 찾기</a>' : ''}</p>
    <p class="legal-link"><a href="privacy.html" target="_blank" rel="noopener">개인정보 처리방침</a></p>
    ${OPTIONS.demoLogin ? `
      <div class="demo-login">
        <button type="button" class="btn block" id="demo-login">데모 계정으로 로그인</button>
        <p class="tiny muted center">가입 없이 둘러볼 수 있는 체험용 계정이에요.</p>
      </div>` : ''}`);
  showIntro();
  $('#demo-login')?.addEventListener('click', async () => {
    try {
      await api('/auth/demo', { method: 'POST' });
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.email = withDomain(fd.email);
    try {
      await api('/auth/login', { method: 'POST', body: fd });
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
}

async function renderSignup() {
  authShell(`
    <h2>회원가입</h2>
    <p class="lead">${OPTIONS.emailDomain ? '국민대학교 메일로 가입할 수 있어요.' : ''}</p>
    <form id="f" class="card">
      ${emailCodeFields()}
      <label class="field"><span>이름</span><input class="input" name="name" maxlength="20" autocomplete="name" required></label>
      <label class="field"><span>학과</span><input class="input" name="department" maxlength="30" placeholder="예: 경영정보학부" required></label>
      <label class="field"><span>전화번호</span><input class="input" name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="010-1234-5678" required></label>
      <p class="tiny muted">학과와 전화번호는 운영 연락용으로만 쓰고, 메이트에게는 보이지 않아요.</p>
      <label class="field"><span>비밀번호 (6자 이상)</span><input class="input" name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      ${consentSummary()}
      <label class="agree"><input type="checkbox" name="agree" required>
        <span><b>[필수]</b> 개인정보 수집·이용에 동의해요 · <a class="link" href="privacy.html" target="_blank" rel="noopener">처리방침 보기</a></span></label>
      <button class="btn primary block mt">가입하고 시작하기</button>
    </form>
    <p class="switch-link">이미 계정이 있나요? <a href="#/login">로그인</a></p>`);
  const form = $('#f');
  bindSendCode(form, 'signup');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (OPTIONS.emailVerification && $('#code-field').hidden) return toast("먼저 '인증번호 받기'를 눌러 주세요.", true);
    const fd = Object.fromEntries(new FormData(form));
    fd.email = withDomain(fd.email);
    fd.agree = fd.agree === 'on';
    try {
      await withLoading('', '가입하는 중이에요', () => api('/auth/signup', { method: 'POST', body: fd }));
      toast('가입을 마쳤어요.');
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
}

// ── 개인정보 처리방침 (public/privacy.html) 요약과 동의 창 ──
const consentSummary = () => `
      <dl class="consent-sum">
        <dt>받는 정보</dt><dd>국민대 메일, 이름, 학과, 전화번호, 비밀번호(암호화해서 저장)</dd>
        <dt>쓰는 곳</dt><dd>본인 확인, 매칭·출석 관리, 운영 연락. 메이트에게는 이름·소개만 보여요</dd>
        <dt>보관</dt><dd>탈퇴하면 바로 지워요 (자세한 기간은 처리방침)</dd>
      </dl>`;

// 처리방침이 생겼거나 바뀐 뒤 처음 들어온 회원: 동의해야 계속 쓸 수 있다 (바깥을 눌러도 닫히지 않음)
function showConsent() {
  const modal = $('#modal');
  modal.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <h3 id="consent-title">개인정보 처리방침에 동의해 주세요</h3>
      <p class="small muted">스터디버디가 개인정보를 어떻게 다루는지 정리했어요. 동의하면 지금처럼 이용할 수 있어요.</p>
      ${consentSummary()}
      <p class="small"><a class="link" href="privacy.html" target="_blank" rel="noopener">처리방침 전체 보기</a></p>
      <button class="btn primary block mt" id="consent-ok">동의하고 계속하기</button>
      <button type="button" class="text-btn" id="consent-no">동의하지 않고 로그아웃</button>
    </div>`;
  modal.hidden = false;
  modal.onclick = null;
  $('#consent-ok').addEventListener('click', async () => {
    try {
      await api('/me/consent', { method: 'POST' });
      closeModal();
      toast('동의했어요.');
      router();
    } catch (err) { toast(err.message, true); }
  });
  $('#consent-no').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    closeModal();
    location.hash = '#/login';
  });
}

// 로그인 화면에 들어오면 스터디버디 소개 팝업을 띄운다
// 스터디버디 소개 (로그인 팝업·홈 진행 안내 카드 공용)
const introBody = () => `
      <p class="small">국민대 창업동아리 <b>MateUp팀</b>이 운영해요.</p>
      <p class="small muted">국민대생끼리 1:1로 공부 메이트를 이어 줘요.</p>
      <ol class="steps mt">
        <li><b>매칭 신청</b><span class="small muted">원하는 날짜·장소·공부 스타일을 고르면 맞는 메이트와 연결돼요.</span></li>
        <li><b>함께 공부</b><span class="small muted">약속한 날 만나 각자 공부하고, 서로 QR을 찍어 출석을 확인해요.</span></li>
        <li><b>약속 지키기</b><span class="small muted">약속 날 안 나오거나 매칭을 중간에 그만두면 1회로 쌓여요. ${rule().strikeLimit}회가 되면 ${rule().suspendDays}일 동안 매칭 신청이 멈춰요.</span></li>
      </ol>
      <p class="small mt"><b>3회차</b> ${periodText()}</p>
      <p class="small muted center mt">소식은 인스타그램 <a class="link" href="https://www.instagram.com/study._.buddys/" target="_blank" rel="noopener">@study._.buddys</a>에 올려요.</p>`;

function showIntro() {
  const modal = $('#modal');
  modal.innerHTML = `
    <div class="sheet intro">
      <img class="logo" src="logo.svg" alt="스터디버디">
      ${introBody()}
      <button class="btn primary block mt" id="intro-ok">확인했어요</button>
    </div>`;
  modal.hidden = false;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  $('#intro-ok').addEventListener('click', closeModal);
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
    if ($('#code-field').hidden) return toast("먼저 '인증번호 받기'를 눌러 주세요.", true);
    const fd = Object.fromEntries(new FormData(form));
    fd.email = withDomain(fd.email);
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
  const start = (btn) => {
    paint = !get(btn.dataset.cell);
    last = null;
    paintTo(btn);
  };
  // 스크롤이 되는 시간표(touch-action ≠ none)에서 손가락은: 끌면 스크롤, 탭하면 한 칸, 꾹 누른 뒤 끌면 칠하기
  const scrollable = () => getComputedStyle(tt).touchAction !== 'none';
  let pending = null;
  let timer = null;
  const clearPending = () => { clearTimeout(timer); timer = null; pending = null; };
  tt.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.tt-cell');
    if (!btn || btn.disabled) return;
    if (e.pointerType === 'touch' && scrollable()) {
      pending = { btn, x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        if (!pending) return;
        start(pending.btn);
        navigator.vibrate?.(15);
        pending = null;
      }, 300);
      return;
    }
    e.preventDefault();
    start(btn);
  });
  tt.addEventListener('pointerup', () => {
    if (pending) { const { btn } = pending; clearPending(); start(btn); paint = null; last = null; }
  });
  tt.addEventListener('pointercancel', clearPending);
  // 꾹 눌러 칠하는 중에는 화면이 스크롤되지 않게 막는다
  tt.addEventListener('touchmove', (e) => { if (paint !== null && e.cancelable) e.preventDefault(); }, { passive: false });
  tt.addEventListener('pointermove', (e) => {
    if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 8) clearPending();
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
  const [state, u] = await Promise.all([api('/me'), api('/chat/unread').catch(() => null)]);
  if (!alive()) return;
  if (u) unread = u;
  const { user, matches, pendingRequests, personal, mateLeft, community, exam, strikes } = state;
  // 약속 지키기: 기록이 있으면 한 줄로 알리고, 정지 중이면 신청 버튼 대신 다시 신청할 수 있는 날을 보여 준다
  const st = strikes ?? { count: 0, limit: rule().strikeLimit };
  const stopped = !!st.suspendedUntil;
  const ruleNote = stopped
    ? `<p class="rule-line"><b class="warn-text">매칭 정지 중</b> · ${reopenText(st)}</p>`
    : st.count ? `<p class="rule-line">약속 기록 <b>${st.count}/${st.limit}회</b> · ${st.limit}회가 되면 ${rule().suspendDays}일 동안 매칭 신청이 멈춰요.</p>` : '';

  const reportCard = (m) => `
      <div class="card lime">
        <div class="card-head"><h2>주간 리포트가 도착했어요</h2></div>
        <p class="small">${esc(m.mate.name)}님과의 ${m.round}주차 결과를 확인하고, 다음 주를 골라 주세요.</p>
        <a class="btn primary block mt" href="#/match/${m.id}">리포트 보기</a>
      </div>`;
  const matchCard = (m) => {
    const next = m.appointments.find((x) => ['open', 'studying', 'scheduled'].includes(x.me.status));
    return `
      <div class="card">
        <div class="card-head"><h2>이번 주 메이트</h2><span class="hint">${m.round}주차</span></div>
        <div class="profile">
          ${avatarHTML(m.mate)}
          <div>
            <div class="name">${esc(m.mate.name)}${botBadge(m.mate)}</div>
            <div class="small muted">${esc(scheduleText(m.schedule))}</div>
            <div class="small muted">출석 ${m.stats.me.attended}/${m.stats.me.total} · 공부 ${fmtMinutes(m.stats.me.minutes)}</div>
          </div>
        </div>
        ${next ? `
          <p class="next-line">다음 약속 <b>${fmtDate(next.date, true)} ${fmtTime(next.startTime)}</b> · ${esc(next.location)}</p>`
        : '<p class="next-line">이번 주 약속을 모두 마쳤어요. 주간이 끝나면 리포트가 도착해요.</p>'}
        ${unread.byMatch[m.id] ? `<a class="unread-line" href="#/chat/${m.id}"><span class="badge inline">${unread.byMatch[m.id]}</span>안 읽은 메시지가 있어요</a>` : ''}
        <a class="btn primary block mt" href="#/match/${m.id}">${next && ['open', 'studying'].includes(next.me.status) ? '지금 출석하러 가기' : '매칭 정보 보기'}</a>
      </div>`;
  };
  const pendingCard = (req) => `
      <div class="card">
        <div class="row" style="gap:12px">
          <div class="spinner sm"></div>
          <div style="flex:1">
            <b>메이트를 찾는 중</b>
            <p class="tiny muted">${esc(scheduleText(req.schedule))}<br>${esc(req.location)} · ${styleLabels(req.styles)}</p>
          </div>
        </div>
        <button class="btn ghost block mt sm" data-cancel="${req.id}">신청 취소하기</button>
      </div>`;

  let leftNote = '';
  if (mateLeft) {
    leftNote = `
      <div class="card">
        <div class="card-head"><h2>메이트가 매칭을 그만뒀어요</h2></div>
        <p class="small">${esc(mateLeft.mateName)}님이 이번 주 매칭을 중간에 그만뒀어요.</p>
      </div>`;
  }
  const hasAny = matches.length || pendingRequests.length;
  // 기말고사 디데이 · 국민대 통계 (매칭 전에는 첫 카드 안에, 매칭 후에는 매칭 카드 아래에)
  const dday = exam ? (exam.dday === 0 ? 'D-DAY' : `D-${exam.dday}`) : '';
  const facts = `
        <ul class="facts">
          ${exam ? `<li><span>${esc(exam.name)}까지</span><b>${dday}</b><small>${Number(exam.date.slice(5, 7))}월 ${Number(exam.date.slice(8))}일</small></li>` : ''}
          <li><span>지금까지 함께 공부한 팀</span><b>${community.studiedTeams}팀</b>${community.waiting ? `<small>대기 ${community.waiting}명</small>` : ''}</li>
        </ul>`;
  const heroStats = facts;
  const homeStats = `<section class="section">${facts}</section>`;
  const ttCard = '<section class="card" id="my-tt-card"></section>';
  // 매칭·신청이 있으면: 시간표 → 매칭 상태 카드들 → 통계
  // 없으면: 매칭 신청 카드(통계 포함) → 시간표 (첫 화면에서 시간표가 잘리지 않게 위쪽을 작게)
  const main = hasAny
    ? ttCard
      + [...matches.map((m) => (m.status === 'reported' ? reportCard(m) : matchCard(m))), ...pendingRequests.map(pendingCard)].join('')
      + (stopped ? '' : '<a class="btn block mt" href="#/apply">다른 날짜에도 신청하기</a>')
      + ruleNote
      + homeStats
    : `${leftNote}
      <div class="card hero compact">
        <h2>${stopped ? '지금은 매칭을 신청할 수 없어요' : '이번 주 메이트 신청'}</h2>
        <p class="small muted">${stopped ? `약속 기록이 ${st.limit}회가 되어 ${rule().suspendDays}일 동안 매칭 신청이 멈췄어요. ${reopenText(st)}`
          : `${periodText()} 중 원하는 시간만 고르면 돼요.`}</p>
        ${heroStats}
        ${stopped ? '' : `<a class="btn lime block" href="#/apply">매칭 신청하기</a>${ruleNote}`}
      </div>
      ${ttCard}`;

  view.innerHTML = `
    <p class="hello">${esc(user.name)}님</p>
    ${main}
    <section class="section">
      <h2 class="section-title">스터디버디는 이렇게 진행돼요</h2>
      ${introBody()}
    </section>`;

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
      <div class="card-head"><h2>내 시간표</h2>
        ${editing ? '' : '<button class="btn sm ghost" id="tt-edit">개인 일정</button>'}</div>
      <div class="tt-legend tiny">
        <span><i class="lg match"></i>매칭</span><span><i class="lg pending"></i>대기</span><span><i class="lg personal"></i>개인 일정</span>
      </div>
      ${editing ? `
        <div class="notice">일정 이름을 적고 칸을 누르거나 끌어서 넣어요. 같은 칸을 다시 누르면 빠져요.</div>
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
  if (state.consent?.required) showConsent();

  $$('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('이 매칭 신청을 취소할까요?')) return;
    try {
      await withLoading('', '신청을 취소하는 중이에요', () => api(`/requests/${b.dataset.cancel}`, { method: 'DELETE' }));
      toast('신청을 취소했어요.');
      router();
    } catch (err) { toast(err.message, true); }
  }));

  if (pendingRequests.length) {
    const before = matches.length;
    poll(async () => {
      const s = await api('/me');
      if (s.matches.length > before && alive()) {
        toast('메이트가 정해졌어요.');
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
  const stopped = !!state.strikes?.suspendedUntil; // 약속 지키기: 매칭 정지 중
  // 스터디 날짜(화·수·목) 19~21시를 1시간 칸으로 보여 주고, 원하는 칸을 여러 개 고른다.
  // 이미 끝난 칸, 이미 신청·매칭한 칸은 고를 수 없다.
  const period = OPTIONS.studyPeriod;
  const taken = myTimetable(state);
  const slots = OPTIONS.timeSlots.map((s, i) => ({ ...s, i }))
    .filter((s) => toMinutes(s.start) >= toMinutes(period.start) && toMinutes(s.end) <= toMinutes(period.end));
  const studyDays = period.dates.map((date) => {
    const day = new Date(`${date}T00:00:00`).getDay() || 7;
    const cells = slots.map((s) => {
      const cell = `${day}-${s.i}`;
      const over = new Date(`${date}T00:00:00+09:00`).getTime() + toMinutes(s.end) * 60000 <= Date.now();
      const busy = taken.has(cell) && taken.get(cell).kind !== 'personal';
      return { cell, start: s.start, disabled: over || busy, note: over ? '지남' : busy ? '신청함' : '' };
    });
    return { date, day, cells };
  });
  const form = { locations: new Set(), styles: new Set(), cells: new Set() };

  view.innerHTML = `
    ${stopped ? `<div class="notice warn"><b>매칭 정지 중이에요.</b> ${reopenText(state.strikes)}</div>` : ''}
    <section class="card">
      <div class="card-head"><h2>내 프로필</h2><a class="link" href="#/me/edit">수정하기 ›</a></div>
      <div class="profile">
        ${avatarHTML(user)}
        <div>
          <div class="name">${esc(user.name)}</div>
          ${tagsHTML(user.tags) || '<p class="small muted">태그를 추가하면 메이트가 나를 더 잘 알 수 있어요</p>'}
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>공부 일정 및 장소 설정</h2></div>
      <div class="field"><span>공부할 시간 (중복 선택 가능)</span>
        <div class="tt apply-tt" id="days">
          <div class="tt-corner"></div>${studyDays.map((d) => `<div class="tt-day">${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))} (${WD[d.day]})</div>`).join('')}
          ${slots.map((s, k) => `
            <div class="tt-time"><i>${s.start}</i>${k === slots.length - 1 ? `<i class="end">${s.end}</i>` : ''}</div>
            ${studyDays.map((d) => `<button type="button" class="tt-cell" data-cell="${d.cells[k].cell}" aria-pressed="false"${d.cells[k].disabled ? ' disabled' : ''}
              aria-label="${WD[d.day]} ${s.start}">${d.cells[k].note ? `<span>${d.cells[k].note}</span>` : ''}</button>`).join('')}`).join('')}
        </div>
      </div>
      <div class="field"><span>장소 설정 (중복 선택 가능)</span>
        <div class="pick-list" id="loc">
          ${OPTIONS.locations.map((l) => {
            const [, name, sub] = l.match(/^(.*?)\s*\((.*)\)$/) ?? [null, l, ''];
            return `<button type="button" data-loc="${esc(l)}" aria-pressed="false">
              <span class="check" aria-hidden="true"></span>
              <span class="ct"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
            </button>`;
          }).join('')}
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>공부 스타일 선택</h2><span class="hint">중복 선택 가능</span></div>
      <div class="pick-list" id="styles">
        ${Object.entries(OPTIONS.styles).map(([k, s]) => `
          <button type="button" data-style="${k}" aria-pressed="false">
            <span class="check" aria-hidden="true"></span>
            <span class="ct"><b>${esc(s.label)}</b><small>${esc(s.desc)}</small></span>
          </button>`).join('')}
      </div>
    </section>

    <div class="sticky-cta"><button class="btn primary block" id="submit"${stopped ? ' disabled' : ''}>매칭 신청하기</button></div>`;

  $('#styles').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = b.dataset.style;
    form.styles.has(s) ? form.styles.delete(s) : form.styles.add(s);
    b.setAttribute('aria-pressed', form.styles.has(s));
  });
  $('#days').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const c = b.dataset.cell;
    form.cells.has(c) ? form.cells.delete(c) : form.cells.add(c);
    b.setAttribute('aria-pressed', form.cells.has(c));
  });
  // 장소는 여러 개 고를 수 있다
  $('#loc').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const l = b.dataset.loc;
    form.locations.has(l) ? form.locations.delete(l) : form.locations.add(l);
    b.setAttribute('aria-pressed', form.locations.has(l));
  });

  $('#submit').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      // 바로 매칭되더라도 메이트를 찾는 화면을 3초 동안 보여 준다
      const res = await withLoading('', '메이트를 찾는 중이에요', () => api('/requests', {
        method: 'POST',
        body: { days: [...new Set([...form.cells].map((c) => Number(c.split('-')[0])))], cells: [...form.cells], locations: [...form.locations], styles: [...form.styles] },
      }), 3000);
      if (res.matchId) {
        toast('메이트가 정해졌어요.');
        location.hash = `#/match/${res.matchId}`;
      } else {
        toast('신청했어요. 맞는 메이트가 생기면 연결해 드려요.');
        location.hash = '#/home';
      }
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
    }
  });
}

// ───────────────────────── 내 메이트 (매칭된 메이트·약속·출석) ─────────────────────────

// 약속 상태: 알약 배지 대신 색 글자 (출석은 초록, 미참석은 빨강, 나머지는 회색)
const APPT_STATUS = {
  done: ['출석', 'ok'], studying: ['공부 중', 'ok'], missed: ['미참석', 'bad'],
  open: ['출석 가능', 'now'], scheduled: ['예정', ''], cancelled: ['취소', 'off'],
};
function statusHTML(status, { mate = false, minutes = 0 } = {}) {
  // 메이트 칸의 '출석 가능'은 내 할 일이 아니므로 '예정'으로
  const [label, cls] = mate && status === 'open' ? APPT_STATUS.scheduled : APPT_STATUS[status] ?? [status, ''];
  return `<span class="st${cls ? ` ${cls}` : ''}">${label}</span>${minutes ? `<small>${fmtMinutes(minutes)}</small>` : ''}`;
}
// 약속별 출석 표: 날짜·시간 | 나 | 메이트 (예전의 '약속 목록'과 '요일별 출석 칸'을 하나로)
function apptTable(m, { highlight = null, minutes = false } = {}) {
  if (!m.appointments.length) return '<p class="small muted">약속이 없어요.</p>';
  return `
    <table class="att-table">
      <thead><tr><th>날짜</th><th>나</th><th title="${esc(m.mate.name)}">${esc(m.mate.name)}</th></tr></thead>
      <tbody>${m.appointments.map((a) => `
        <tr${a.id === highlight ? ' class="is-open"' : ''}>
          <td><b>${fmtDate(a.date)}</b> <span class="muted">(${WD[a.weekday]})</span><small>${fmtRange(a.startTime, a.endTime)}</small></td>
          <td>${statusHTML(a.me.status, { minutes: minutes ? a.me.minutes : 0 })}</td>
          <td>${statusHTML(a.mate.status, { mate: true })}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

// 메이트가 여럿이면 화면 위에 메이트 고르는 버튼을 보여 준다
let mateTabs = '';
const mateTabsHTML = (matches, current, base) => (matches.length < 2 ? '' : `
  <div class="mate-tabs">${matches.map((m) => `
    <a href="#/${base}/${m.id}" class="${m.id === current ? 'on' : ''}">${esc(m.mate.name)}${base === 'chat' && m.id !== current && unread.byMatch[m.id] ? `<span class="badge inline">${unread.byMatch[m.id]}</span>` : ''}<small>${esc(scheduleText(m.schedule))}</small></a>`).join('')}
  </div>`);

async function renderMatch(alive, id) {
  setTop({ title: '내 메이트' });
  setTabs('match');
  loading();
  const { matches, strikes } = await api('/matches/active');
  if (!alive()) return;
  myStrikes = strikes ?? null;
  const match = matches.find((m) => m.id === id) ?? matches[0];
  mateTabs = mateTabsHTML(matches, match?.id, 'match');
  if (!match) {
    view.innerHTML = `
      <div class="empty">
        <h3>이번 주 메이트가 아직 없어요</h3>
        <p>매칭을 신청하면 1주일 동안 함께할 메이트를 찾아드려요.</p>
        <a class="btn primary mt-lg" href="#/home">홈으로</a>
      </div>`;
    return;
  }
  if (match.status === 'reported') return renderReport(match, alive);
  drawMatch(match, alive);
}

// 개발자 화면 '매칭 화면 보기': 당사자 한 명이 보는 매칭중 화면 그대로 (버튼은 눌리지 않음, 열람은 운영 기록에 남음)
async function renderAdminMatch(alive, id, side) {
  setTop({ title: '매칭 화면 보기', back: '#/admin' });
  setTabs(null);
  loading();
  const { match } = await api(`/admin/matches/${id}/view?as=${side}`);
  if (!alive()) return;
  myStrikes = match.viewer.strikes; // '매칭 그만두기' 안내에 그 사람의 약속 기록이 나오게
  drawMatch(match, alive, { admin: true });
}

function drawMatch(m, alive, { admin = false } = {}) {
  const tabs = admin ? `
  <div class="mate-tabs">${m.viewer.names.map((n, i) => `
    <a href="#/admin/match/${m.id}/${'ab'[i]}" class="${m.viewer.side === 'ab'[i] ? 'on' : ''}">${esc(n)}<small>님이 보는 화면</small></a>`).join('')}
  </div>
  <p class="tiny muted">개발자 화면 · 보기 전용이라 버튼은 눌리지 않아요. 연 기록이 운영 기록에 남아요.</p>` : mateTabs;
  const target = m.appointments.find((a) => a.me.status === 'studying' || a.mate.status === 'studying')
    ?? m.appointments.find((a) => a.me.status === 'open' || a.mate.status === 'open');
  const next = m.appointments.find((a) => a.me.status === 'scheduled');

  // 현장 출석 확인: 내 코드는 메이트가 입력해서 내 출석을 확인해 주고, 나는 메이트의 코드를 입력해서 메이트 출석을 확인한다.
  let checkinCard = '';
  let nextLine = '';
  if (target) {
    const meIn = ['studying', 'done'].includes(target.me.status);
    const mateIn = ['studying', 'done'].includes(target.mate.status);
    const myPart = meIn
      ? (target.me.status === 'studying' ? `
        <div class="center">
          <p class="small muted">메이트가 내 출석을 확인했어요</p>
          <div class="timer mt" id="timer" data-since="${esc(target.me.checkedInAt)}">00:00:00</div>
          <p class="tiny muted">공부 시간 기록 중</p>
          <button class="btn primary block mt" id="checkout" data-id="${target.id}">공부 종료하고 기록하기</button>
        </div>` : '<p class="small">오늘 내 출석 완료 · 공부 기록을 마쳤어요</p>')
      : `
        <div class="checkin">
          <div>
            <p class="small"><b>내 출석 코드</b></p>
            <div class="code">${esc(target.myCode ?? '')}</div>
            <p class="tiny muted mt">메이트가 이 QR을 찍으면 내 출석이 바로 확인돼요. QR이 안 되면 이 코드를 알려 주세요.</p>
          </div>
          <div class="qr-box"><img data-qr="${target.id}" alt="내 출석 QR 코드"></div>
        </div>`;
    const matePart = mateIn
      ? `<p class="small">${esc(m.mate.name)}님 출석 확인 완료</p>`
      : `
        <p class="small"><b>${esc(m.mate.name)}님 출석 확인하기</b></p>
        <p class="tiny muted">메이트 화면의 QR을 찍으면 메이트 출석이 바로 확인돼요.</p>
        <button class="btn primary block mt" id="scan" data-id="${target.id}">메이트 QR 찍기</button>
        <p class="tiny muted mt">QR이 안 되면 메이트 화면의 출석 코드를 입력해 주세요.</p>
        ${target.mateCode ? `<p class="tiny muted">데모 메이트 코드: <b class="code" style="font-size:12px">${esc(target.mateCode)}</b></p>` : ''}
        <form class="row mt" id="confirm-form" data-id="${target.id}">
          <input class="input code" name="code" maxlength="6" placeholder="메이트 코드" autocomplete="off" style="text-transform:uppercase" required>
          <button class="btn inline-btn">확인</button>
        </form>`;
    checkinCard = `
    <section class="card">
      <div class="card-head"><h2>현장 출석 확인</h2><span class="hint">${fmtDate(target.date, true)} ${fmtRange(target.startTime, target.endTime)}</span></div>
      <div class="att-part">${myPart}</div>
      <div class="att-part">${matePart}</div>
    </section>`;
  } else if (next) {
    nextLine = `<p class="next-line">다음 약속 <b>${fmtDate(next.date, true)} ${fmtTime(next.startTime)}</b> · 시작 ${OPTIONS.checkinEarlyMin}분 전부터 출석할 수 있어요.</p>`;
  } else {
    nextLine = '<p class="next-line">이번 주 약속이 모두 끝났어요. 주간이 끝나면 리포트가 도착해요.</p>';
  }

  view.innerHTML = `${tabs}
    ${checkinCard}
    <section class="card">
      <div class="card-head"><h2>메이트 프로필</h2><span class="hint">${m.round}주차</span></div>
      <div class="profile">
        ${avatarHTML(m.mate, 'lg')}
        <div>
          <div class="name">${esc(m.mate.name)}${botBadge(m.mate)}</div>
          ${m.mate.bio ? `<div class="small muted">${esc(m.mate.bio)}</div>` : ''}
          ${tagsHTML(m.mate.tags)}
        </div>
      </div>
      ${m.mate.isBot ? '<div class="notice">체험용 <b>가상 메이트</b>예요. 실제로 약속 장소에 나오지 않아요. 내가 출석하면 함께 출석하고, 채팅에 자동으로 답해요.</div>' : ''}
      <p class="meta-line">${esc(styleLabels(m.styles))} · ${esc(m.location)}</p>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-title">이번 주 약속</h2><span class="hint">${fmtDateRange(m.weekStart, m.weekEnd)}</span></div>
      <p class="meta-line">내 출석 <b>${m.stats.me.attended}/${m.stats.me.total}</b> · 공부 <b>${fmtMinutes(m.stats.me.minutes)}</b> · 메이트 출석 <b>${m.stats.mate.attended}/${m.stats.mate.total}</b></p>
      ${apptTable(m, { highlight: target?.id })}
      ${nextLine}
    </section>

    ${OPTIONS.demo && !admin ? `
      <div class="demo-bar">
        <b>데모 모드</b> · 시간과 상관없이 출석할 수 있고, 주간을 바로 마감해 리포트를 볼 수 있어요.
        <button class="btn sm block mt" id="settle">이번 주 마감하고 리포트 받기</button>
      </div>` : ''}

    <div class="leave-box">
      <button type="button" class="text-btn danger" id="leave">매칭 그만두기</button>
      <p class="tiny muted center">${esc(leaveHint(m))}</p>
    </div>`;

  $$('img[data-qr]').forEach(async (img) => {
    const id = img.dataset.qr;
    const qrSvg = admin && m.appointments.find((a) => String(a.id) === id)?.qrSvg;
    img.src = admin ? (qrSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}` : '')
      : window.__mockQr ? await window.__mockQr(Number(id)).catch(() => '') : `/api/appointments/${id}/qr`;
    // 누르면 메이트가 찍기 쉽게 크게 보여 준다 (아무 데나 누르면 닫힘)
    img.addEventListener('click', () => {
      const modal = $('#modal');
      modal.innerHTML = `
        <div class="qr-zoom">
          <img src="${img.src}" alt="내 출석 QR 코드 (크게)">
          <div class="code">${esc(target.myCode ?? '')}</div>
          <p class="tiny muted">메이트에게 이 QR을 찍게 해 주세요 · 화면을 누르면 닫혀요</p>
        </div>`;
      modal.hidden = false;
      modal.onclick = closeModal;
    });
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

  // 개발자 화면에서는 보기만: 버튼·입력칸을 막고, 아래 동작은 연결하지 않는다
  if (admin) {
    $$('button, input', view).forEach((el) => { el.disabled = true; });
    return;
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
      toast(`${m.mate.name}님 출석을 확인했어요.`);
      refresh(res.match);
    } catch (err) { toast(err.message, true); }
  };
  $('#confirm-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    confirmMate(e.target.dataset.id, e.target.code.value);
  });
  $('#scan')?.addEventListener('click', (e) => openScanner(Number(e.target.dataset.id), refresh));
  $('#checkout')?.addEventListener('click', async (e) => {
    try {
      const res = await api(`/appointments/${e.target.dataset.id}/checkout`, { method: 'POST' });
      toast(`${fmtMinutes(res.minutes)} 공부를 기록했어요.`);
      refresh(res.match);
    } catch (err) { toast(err.message, true); }
  });
  $('#leave')?.addEventListener('click', async () => {
    if (!confirm(leaveConfirm(m))) return;
    try {
      const res = await api(`/matches/${m.id}/leave`, { method: 'POST' });
      if (res.result === 'settled') {
        toast('이번 주를 정산했어요. 리포트를 확인해 주세요.');
        router();
        return;
      }
      const st = res.strikes;
      toast(st?.suspendedUntil ? `매칭을 그만뒀어요. 약속 기록이 ${st.limit}회가 되어 매칭 신청이 멈췄어요. ${reopenText(st)}`
        : st?.count ? `매칭을 그만뒀어요. 약속 기록 ${st.count}/${st.limit}회` : '매칭을 그만뒀어요.');
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
  $('#settle')?.addEventListener('click', async () => {
    if (!confirm('이번 주를 마감하고 리포트를 받을까요?')) return;
    try {
      const res = await api(`/matches/${m.id}/settle`, { method: 'POST' });
      refresh(res.match);
    } catch (err) { toast(err.message, true); }
  });
}

// 매칭 그만두기 안내 (server/service.js leavePolicy 와 같은 규칙).
// 약속 지키기: 그만두기 1회 + 이미 지난 약속 중 안 나온 날도 함께 기록된다.
function leaveHint(m) {
  if (m.leavePolicy === 'settle') return '남은 약속이 없어서, 지금까지 출석으로 이번 주를 정산해요.';
  if (!ruleOn()) return '지금 그만두면 이번 주 매칭이 바로 끝나요.';
  const st = myStrikes ?? { count: 0, limit: rule().strikeLimit };
  const add = 1 + m.appointments.filter((a) => a.me.status === 'missed' && a.date >= rule().from).length;
  return st.count + add >= st.limit
    ? `지금 그만두면 약속 기록이 ${st.limit}회가 되어 ${rule().suspendDays}일 동안 매칭 신청이 멈춰요.`
    : `지금 그만두면 약속 기록 ${add}회가 남아요. (지금 ${st.count}/${st.limit}회)`;
}
function leaveConfirm(m) {
  if (m.leavePolicy === 'settle') return '남은 약속이 없어요. 지금까지 출석으로 이번 주를 정산하고 리포트를 받을까요?';
  return `정말 매칭을 그만둘까요?\n\n${m.mate.name}님과의 이번 주 매칭이 바로 끝나요.${ruleOn() ? `\n${leaveHint(m)}` : ''}`;
}

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

  const stopped = !!myStrikes?.suspendedUntil; // 약속 지키기: 정지 중이면 같은 메이트와 이어 갈 수 없음
  let choice;
  if (stopped && m.myChoice !== 'continue') {
    choice = `
      <p class="small">매칭 정지 중이라 다음 주를 이어 갈 수 없어요. ${reopenText(myStrikes)}</p>
      <button class="btn block mt" data-choice="new">이번 매칭 마치기</button>`;
  } else if (m.myChoice === 'continue') {
    choice = `<div class="notice">${esc(m.mate.name)}님의 선택을 기다리고 있어요. 둘 다 '계속하기'를 고르면 다음 주 약속이 바로 만들어져요.</div>`;
  } else {
    choice = `
      <p class="small muted">${m.mateChoice === 'continue' ? `${esc(m.mate.name)}님은 계속하고 싶어 해요.` : '다음 주는 어떻게 할까요?'}</p>
      <div class="stack mt">
        <button class="btn primary block" data-choice="continue">${esc(m.mate.name)}님과 계속하기</button>
        <button class="btn block" data-choice="new">새 메이트 만나기</button>
      </div>`;
  }

  view.innerHTML = `${mateTabs}
    <header class="page-head">
      <p class="small muted">${fmtDateRange(m.weekStart, m.weekEnd)} · ${m.round}주차</p>
      <h2>${me.kept ? '이번 주 약속을 모두 지켰어요' : '이번 주는 아쉬웠어요'}</h2>
    </header>

    <section class="card">
      <div class="card-head"><h2>출석률과 공부시간</h2></div>
      <div class="vs">${col('me', me, '나')}${col('mate', mate, m.mate.name)}</div>
    </section>

    <section class="card">
      <div class="card-head"><h2>다음 주 선택</h2></div>
      ${choice}
    </section>`;

  $$('[data-choice]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const res = await api(`/matches/${m.id}/choice`, { method: 'POST', body: { choice: b.dataset.choice } });
      if (res.next === 'continue') {
        toast(`다음 주도 ${m.mate.name}님과 함께해요.`);
        router();
      } else if (res.next === 'new') {
        toast(stopped ? '이번 매칭을 마쳤어요.' : '새 메이트를 신청해 주세요.');
        location.hash = stopped ? '#/home' : '#/apply';
      } else {
        toast('선택을 저장했어요.');
        router();
      }
    } catch (err) { toast(err.message, true); }
  }));

  if (m.myChoice === 'continue') {
    poll(async () => {
      const res = await api('/matches/current');
      if (!alive()) return;
      if (!res.match || res.match.id !== m.id) router();
    });
  }
}

// ───────────────────────── 지난 스터디 다시 보기 ─────────────────────────

async function renderPast(alive, id) {
  setTop({ title: '지난 스터디', back: '#/me' });
  setTabs('me');
  loading();
  const { match: m } = await api(`/matches/${id}`);
  if (!alive()) return;
  if (m.status !== 'closed') {
    location.hash = '#/match'; // 아직 진행 중인 매칭은 '메이트' 탭에서
    return;
  }
  const r = m.report;
  const headline = m.headline ? m.headline : m.left === 'me' ? '내가 중간에 그만둔 스터디예요'
    : m.left === 'mate' ? `${m.mate.name}님이 중간에 그만둔 스터디예요`
    : r?.me?.kept ? '약속을 모두 지킨 주였어요' : '아쉬움이 남은 주였어요';

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
    <header class="page-head">
      <p class="small muted">${fmtDateRange(m.weekStart, m.weekEnd)} · ${esc(m.label ?? `${m.round}주차`)} · ${esc(m.location)}</p>
      <h2>${esc(headline)}</h2>
    </header>

    <section class="card">
      <div class="card-head"><h2>메이트</h2></div>
      <div class="profile">
        ${avatarHTML(m.mate)}
        <div>
          <div class="name">${esc(m.mate.name)}${botBadge(m.mate)}</div>
          ${tagsHTML(m.mate.tags)}
        </div>
      </div>
      <p class="meta-line">${esc(styleLabels(m.styles))}</p>
    </section>

    ${r ? `
    <section class="card">
      <div class="card-head"><h2>출석률과 공부시간</h2></div>
      <div class="vs">${col(r.me, '나')}${col(r.mate, m.mate.name)}</div>
    </section>` : ''}

    <section class="section">
      <h2 class="section-title">약속별 출석</h2>
      ${apptTable(m, { minutes: true })}
    </section>`;
}

// ───────────────────────── QR 스캐너 ─────────────────────────

function closeModal() {
  const modal = $('#modal');
  modal.dispatchEvent(new Event('close'));
  modal.hidden = true;
  modal.innerHTML = '';
  modal.onclick = null;
}

// 카메라 화면에서 QR 글자 읽기: 브라우저 기본 기능(BarcodeDetector)이 없으면(아이폰 등) jsQR로 읽는다.
let jsQrLoading = null;
const loadJsQr = () => (jsQrLoading ??= new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'vendor/jsQR.js';
  s.onload = () => resolve(window.jsQR);
  s.onerror = () => { jsQrLoading = null; reject(new Error('QR 인식 기능을 불러오지 못했어요.')); };
  document.head.append(s);
}));

async function qrReader(video) {
  if ('BarcodeDetector' in window) {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    return async () => (await detector.detect(video).catch(() => [])).map((c) => c.rawValue);
  }
  const jsQR = await loadJsQr();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async () => {
    if (!video.videoWidth) return [];
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    return hit ? [hit.data] : [];
  };
}

function openScanner(appointmentId, onDone) {
  const modal = $('#modal');
  const canScan = !!navigator.mediaDevices?.getUserMedia;
  modal.innerHTML = `
    <div class="sheet">
      <div class="row between"><h3>메이트 QR 찍기</h3><button class="btn sm ghost" id="close">닫기</button></div>
      <p class="small muted">메이트 화면의 출석 QR을 비추면 바로 출석이 확인돼요. 안 되면 아래에 메이트의 코드를 입력하세요.</p>
      ${canScan ? '<div class="scanner"><video id="video" playsinline muted></video></div>' : '<div class="notice">이 브라우저는 카메라를 쓸 수 없어요. 메이트 화면의 6자리 코드를 입력해 주세요.</div>'}
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
      toast('메이트 출석을 확인했어요.');
      onDone(res.match);
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    }
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
        const read = await qrReader(video);
        const loop = async () => {
          if (stopped) return;
          const hit = (await read()).find((v) => v.startsWith('SB:'));
          // 읽었는데 확인에 실패하면(시간 전 등) 잠깐 쉬었다가 다시 찍을 수 있게 한다
          if (hit && await submit(hit.split(':')[2])) return;
          if (hit) return setTimeout(loop, 2000);
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
  const [{ matches }, { user }, u] = await Promise.all([api('/matches/active'), api('/me'), api('/chat/unread').catch(() => null)]);
  if (!alive()) return;
  if (u) unread = u;
  const match = matches.find((m) => m.id === id) ?? matches[0];
  if (!match) {
    view.innerHTML = `
      <div class="empty"><h3>대화할 메이트가 없어요</h3>
      <p>매칭이 되면 메이트와 약속을 이야기할 수 있어요.</p></div>`;
    return;
  }
  setTop({ title: match.mate.name, right: '<button type="button" class="top-action" id="report">신고</button>' });
  $('#report').addEventListener('click', () => openReport(match));
  const quick = quickMessages(match);
  view.innerHTML = `${mateTabsHTML(matches, match.id, 'chat')}
    <p class="chat-meta">${esc(match.location)} · ${esc(scheduleText(match.schedule))}</p>
    <div class="chat mt" id="chat"></div>
    <div class="chat-dock">
      <div class="quick" id="quick" aria-label="자주 쓰는 메시지">
        ${quick.map((q, i) => `<button type="button" class="quick-chip" data-i="${i}" title="${esc(q.body)}">${esc(q.label)}</button>`).join('')}
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
  let readSent = 0; // 서버에 '여기까지 읽음'으로 알린 번호
  // 메이트가 읽은 위치보다 뒤에 내가 보낸 메시지에는 '1' (메이트가 채팅을 열면 사라짐)
  const markMine = (mateLastReadId) => $$('.read-mark', box).forEach((el) => {
    if (Number(el.dataset.id) <= mateLastReadId) el.remove();
  });
  let chatPoll = null;
  const fetchNew = async () => {
    const { messages, mateLastReadId = 0 } = await api(`/matches/${match.id}/messages?after=${lastId}`);
    if (!alive()) return;
    if (messages.length) {
      $('#hello')?.remove();
      chatPoll?.active();
      for (const msg of messages) {
        if (msg.id <= lastId) continue;
        lastId = msg.id;
        const mine = msg.userId === user.id;
        const t = new Date(msg.createdAt);
        const mark = mine && msg.id > mateLastReadId ? `<b class="read-mark" data-id="${msg.id}" title="메이트가 아직 읽지 않았어요">1</b>` : '';
        box.insertAdjacentHTML('beforeend', `
          <div class="bubble ${mine ? 'me' : 'mate'}">${esc(msg.body)}<time>${mark}${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}</time></div>`);
      }
      scroller().scrollTo(0, scroller().scrollHeight);
    }
    markMine(mateLastReadId);
    // 화면을 보고 있을 때만 읽음으로 기록하고, 탭의 빨간 숫자를 다시 센다
    if (lastId > readSent && document.visibilityState === 'visible') {
      readSent = lastId;
      api(`/matches/${match.id}/read`, { method: 'POST', body: { lastId } }).then(refreshUnread).catch(() => {});
    }
  };
  // 한 번에 하나씩 (보내기 직후 확인과 주기적 확인이 겹쳐 같은 메시지가 두 번 붙지 않게)
  let queue = Promise.resolve();
  const load = () => (queue = queue.then(fetchNew, fetchNew));
  await load();
  if (!box.children.length) box.innerHTML = `<p class="center small muted" id="hello">${esc(match.mate.name)}님께 먼저 인사해 보세요.</p>`;
  // 대화가 오가면 3초마다, 30초 조용하면 6초, 2분 조용하면 12초마다 확인 (화면을 안 보면 멈춤)
  chatPoll = poll(load, [[30 * 1000, 3000], [2 * 60 * 1000, 6000], [Infinity, 12000]]);
  $('#send input').addEventListener('input', () => chatPoll.active());

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
    const card = e.target.closest('.quick-chip');
    if (!card || card.disabled) return;
    const q = quick[Number(card.dataset.i)];
    card.disabled = true;
    try {
      await send(q.body);
      toast(`${match.mate.name}님께 보냈어요.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      card.disabled = false;
    }
  });
}

// 대화 신고 (server/reports.js): 신고된 대화는 개발자 화면에 바로 보인다. 다른 대화는 운영자가 '대화 보기'로 열 때만 (열람 기록)
function openReport(match) {
  const modal = $('#modal');
  const reasons = Object.entries(OPTIONS.reportReasons ?? {});
  modal.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rep-title">
      <div class="row between"><h3 id="rep-title">대화 신고</h3><button type="button" class="btn sm ghost" id="close">닫기</button></div>
      <p class="small muted">신고하면 운영진이 ${esc(match.mate.name)}님과의 대화 내용을 확인해요. 신고한 사실은 상대방에게 알리지 않아요.</p>
      <form id="rep-form" class="mt">
        <fieldset class="choice-list"><legend class="sr-only">신고 이유</legend>
          ${reasons.map(([k, label], i) => `<label class="choice"><input type="radio" name="reason" value="${esc(k)}"${i === 0 ? ' required' : ''}><span>${esc(label)}</span></label>`).join('')}
        </fieldset>
        <label class="field mt"><span>어떤 일이 있었나요? (기타는 꼭 적어 주세요)</span><textarea class="input" name="detail" maxlength="500" placeholder="500자까지"></textarea></label>
        <button class="btn primary block mt">신고하기</button>
      </form>
    </div>`;
  modal.hidden = false;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  $('#close').addEventListener('click', closeModal);
  $('#rep-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/matches/${match.id}/report`, { method: 'POST', body: { reason: fd.get('reason'), detail: fd.get('detail') } });
      closeModal();
      toast('신고했어요. 운영진이 확인할게요.');
    } catch (err) { toast(err.message, true); }
  });
}

// 채팅 입력창 위 자주 쓰는 메시지 (누르면 바로 보냄)
function quickMessages(match) {
  return [
    { label: '도착했어요', body: `${match.location}에 도착했어요. 먼저 자리 잡고 있을게요.` },
    { label: '5분 늦어요', body: '5분 정도 늦을 것 같아요. 죄송해요, 금방 갈게요.' },
    { label: '잠깐 쉴까요', body: '잠깐 10분 쉬었다 할까요?' },
    { label: '수고했어요', body: '오늘도 같이 공부해서 좋았어요. 수고 많으셨어요.' },
  ];
}

// ───────────────────────── 마이페이지 ─────────────────────────

async function renderMe(alive) {
  setTop({ title: '마이페이지' });
  setTabs('me');
  loading();
  const [{ user, strikes }, { matches }] = await Promise.all([api('/me'), api('/me/history')]);
  if (!alive()) return;
  const st = strikes ?? { count: 0, limit: rule().strikeLimit };

  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>내 프로필</h2><a class="link" href="#/me/edit">수정하기 ›</a></div>
      <div class="profile">
        ${avatarHTML(user, 'lg')}
        <div>
          <div class="name">${esc(user.name)}</div>
          <div class="small muted">${esc(user.email)}</div>
          ${user.department || user.phone ? `<div class="small muted">${esc([user.department, user.phone].filter(Boolean).join(' · '))}</div>` : ''}
          ${user.bio ? `<div class="small mt">${esc(user.bio)}</div>` : ''}
          ${tagsHTML(user.tags)}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-title">약속 기록</h2>
        <b class="${st.suspendedUntil ? 'warn-text' : ''}">${st.suspendedUntil ? '매칭 정지 중' : `${st.count}/${st.limit}회`}</b></div>
      <p class="small muted">${st.suspendedUntil ? `${reopenText(st)} ` : ''}${RULE_TEXT()}</p>
    </section>

    <section class="section">
      <h2 class="section-title">지난 스터디</h2>
      ${matches.length ? matches.map((h) => `
        <a class="list-item link-item" href="#/history/${h.id}">
          <div class="row">
            ${avatarHTML(h.mate, 'sm')}
            <div><div><b>${esc(h.mate.name)}</b></div><div class="tiny muted">${fmtDateRange(h.weekStart, h.weekEnd)} · ${esc(h.location)}</div></div>
          </div>
          <span class="row" style="gap:6px">${h.left ? `<span class="small" style="color:var(--red)">${h.left === 'me' ? '내가 그만둠' : '메이트가 그만둠'}</span>` : h.report ? `<span class="small muted">${h.report.me.rate}% · ${fmtMinutes(h.report.me.minutes)}</span>` : ''}<span class="chev">${icon('caret-right')}</span></span>
        </a>`).join('') : '<p class="small muted">첫 주를 마치면 여기에 기록이 쌓여요.</p>'}
    </section>

    <section class="section">
      <h2 class="section-title">알림</h2>
      <button type="button" class="list-item" id="notify-toggle" aria-pressed="${!user.notifyOptOut}" style="width:100%;background:none;border:0;border-bottom:1px solid var(--soft);cursor:pointer">
        <span class="small">매칭·약속 이메일 알림</span><span class="switch"></span>
      </button>
      <p class="tiny muted mt">매칭이 되거나 약속·리포트가 생기면 ${esc(user.email)}로 알려 드려요.</p>
    </section>

    ${user.isAdmin ? '<a class="btn block mt-lg" href="#/admin">개발자 화면</a>' : ''}
    <nav class="me-links" aria-label="계정">
      <a class="text-btn" href="privacy.html" target="_blank" rel="noopener">개인정보 처리방침</a>
      <button type="button" class="text-btn" id="export-data">내 정보 내려받기</button>
      <button type="button" class="text-btn" id="logout">로그아웃</button>
      <button type="button" class="text-btn quiet" id="delete-account">회원 탈퇴</button>
    </nav>
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
  $('#delete-account').addEventListener('click', openDeleteAccount);
  $('#export-data').addEventListener('click', downloadMyData);
  $('#notify-toggle').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const on = btn.getAttribute('aria-pressed') === 'true'; // 지금 켜져 있나
    btn.setAttribute('aria-pressed', String(!on));
    try {
      await api('/me/notify', { method: 'POST', body: { optOut: on } }); // 켜져 있으면 끄기(optOut true)
      toast(on ? '이메일 알림을 껐어요.' : '이메일 알림을 켰어요.');
    } catch (err) { btn.setAttribute('aria-pressed', String(on)); toast(err.message, true); }
  });
}

// 내 정보 내려받기 (server/privacy.js exportMyData): 내가 낸 정보와 내 기록을 JSON 파일 하나로
async function downloadMyData() {
  try {
    const data = await api('/me/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `studybuddy-my-data-${String(data.exportedAt).slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('내 정보를 파일로 내려받았어요.');
  } catch (err) { toast(err.message, true); }
}

// 회원 탈퇴 (server/privacy.js): 비밀번호 확인 → 계정 정보 삭제, 기록은 '탈퇴한 사용자'로
function openDeleteAccount() {
  const modal = $('#modal');
  modal.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="del-title">
      <div class="row between"><h3 id="del-title">회원 탈퇴</h3><button type="button" class="btn sm ghost" id="close">닫기</button></div>
      <p class="small">탈퇴하면 메일·이름·학과·전화번호·소개를 바로 지워요. 메이트와 나눈 대화와 지난 스터디 기록은 상대방을 위해 '탈퇴한 사용자'로 남아요.</p>
      <p class="small muted mt">진행 중인 매칭이 있으면 먼저 마치거나 그만둬야 해요. 매칭 정지 중에 탈퇴하면 다시 가입해도 정지는 이어져요.</p>
      <form id="del-form" class="mt">
        <label class="field"><span>비밀번호 확인</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn block mt danger-solid">탈퇴하기</button>
      </form>
    </div>`;
  modal.hidden = false;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  $('#close').addEventListener('click', closeModal);
  $('#del-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('정말 탈퇴할까요? 되돌릴 수 없어요.')) return;
    try {
      await api('/me/delete', { method: 'POST', body: { password: e.target.password.value } });
      closeModal();
      toast('탈퇴했어요. 그동안 함께해 줘서 고마워요.');
      location.hash = '#/login';
    } catch (err) { toast(err.message, true); }
  });
}

// ───────────────────────── 개발자 화면 (운영자 계정만) ─────────────────────────

// ISO 시각 → 한국 시간 "11/4 23:12"
function fmtAt(s) {
  if (!s) return '-';
  const d = new Date(new Date(s).getTime() + 9 * 3600000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

async function renderAdmin(alive) {
  setTop({ title: '개발자 화면', back: '#/me' });
  setTabs(null);
  loading();
  let a;
  try {
    a = await api('/admin');
  } catch (err) {
    // 운영자 계정이 아니면 로그인 화면으로 보낸다
    if (err.status === 403) {
      location.hash = '#/login';
      return;
    }
    throw err;
  }
  if (!alive()) return;
  const STATUS = { pending: '대기', matched: '매칭됨', cancelled: '취소', active: '진행 중', reported: '리포트 대기', closed: '끝남' };
  const openReports = (a.reports ?? []).filter((r) => r.status === 'open');
  const ADMIN_ACTION = {
    view_dashboard: '개발자 화면 열람', view_reports: '신고 대화 열람', close_report: '신고 처리 완료',
    unsuspend: '매칭 정지 풀기', cancel_requests: '대기 신청 취소', view_chat: '대화 열람', view_match: '매칭 화면 열람',
  };
  // 운영 기록에서 어느 매칭의 대화를 열었는지 이름으로 보여 준다
  const logTarget = (l) => {
    const id = Number(/^match:(\d+)$/.exec(l.target ?? '')?.[1]);
    const m = id && a.matches.find((x) => x.id === id);
    return m ? ` (${m.names.join(' ↔ ')})` : '';
  };
  const shortDay = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`;
  const maxHour = Math.max(1, ...a.visits.byHour);
  const funnelHTML = (rows) => {
    const max = Math.max(1, ...rows.map((f) => f.count));
    return rows.map((f) => `
        <div class="funnel-row"><span>${f.label}</span><div><i style="width:${(f.count / max) * 100}%"></i></div><b>${f.count}</b></div>`).join('');
  };

  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>전환 단계</h2><button type="button" class="btn sm" id="funnel-today" aria-pressed="false">오늘만 보기</button></div>
      <div id="funnel">${funnelHTML(a.funnel.all)}</div>
      <p class="tiny muted mt">사람 수 기준이에요. 방문은 11/4부터 기록해서, 그 전에 가입한 사람은 방문 수에 없어요.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>방문 통계</h2><span class="hint">총 ${a.visits.total}번 방문</span></div>
      <p class="small">지금까지 들어온 사람 <b>${a.visits.people}명</b></p>
      <p class="small muted mt">날짜별 들어온 사람</p>
      ${a.visits.byDay.map((d) => `<div class="list-item"><span>${shortDay(d.day)}</span><span><b>${d.people}명</b> <span class="tiny muted">· ${d.visits}번</span></span></div>`).join('') || '<p class="small muted">아직 기록이 없어요.</p>'}
      <p class="small muted mt">시간대별 방문 (한국 시간)</p>
      <div class="hour-bars">
        ${a.visits.byHour.map((v, h) => `<div title="${h}시 ${v}번"><i style="height:${(v / maxHour) * 100}%"></i><span>${h % 3 === 0 ? h : ''}</span></div>`).join('')}
      </div>
      <details class="mt"><summary class="small">같은 사람의 시간대별 방문 보기</summary>
        ${a.visits.perVisitor.map((p) => `<div class="list-item"><span>방문자${p.visitor} · ${shortDay(p.day)}</span><span class="tiny">${Object.entries(p.hours).map(([h, n]) => `${h}시 ${n}번`).join(', ')}</span></div>`).join('')}
      </details>
    </section>

    <section class="card">
      <div class="card-head"><h2>가입자</h2><span class="hint">${a.users.length}명</span></div>
      ${a.users.map((u) => `
        <div class="admin-item">
          <div class="row" style="justify-content:space-between"><b>${esc(u.name)}</b><span class="tiny muted">${esc(u.department ?? '학과 없음')}</span></div>
          <div class="tiny muted">${esc(u.phone ?? '전화번호 없음')} · 가입 ${fmtAt(u.createdAt)} · 마지막 로그인 ${fmtAt(u.lastLogin)}</div>
        </div>`).join('')}
      <p class="tiny muted mt">마지막 로그인은 로그아웃하지 않은 기기 기준이에요.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>인증메일</h2><span class="hint">가입 못 마친 사람 ${a.emailCodes.notJoined}명</span></div>
      ${a.emailCodes.list.map((c) => `
        <div class="list-item"><span class="small">${esc(c.email)} <span class="tiny muted">${c.purpose === 'reset' ? '비번 찾기' : '가입'}</span></span>
          <span class="tiny">${fmtAt(c.created_at)} · ${c.used ? '사용함' : '<b style="color:var(--red)">안 씀</b>'}${c.attempts ? ` · 틀림 ${c.attempts}` : ''}${c.purpose === 'signup' && !c.joined ? ' · 미가입' : ''}</span></div>`).join('')}
    </section>

    <section class="card">
      <div class="card-head"><h2>매칭 신청</h2><span class="hint">대기 ${a.summary.pendingRequests}건 · 전체 ${a.requests.length}건</span></div>
      ${a.requests.map((r) => `
        <div class="admin-item">
          <div class="row" style="justify-content:space-between"><b>${esc(r.name)}</b><span class="pill${r.status === 'pending' ? ' lime' : r.status === 'cancelled' ? ' gray' : ''}">${STATUS[r.status] ?? r.status}</span></div>
          <div class="tiny muted">${esc(scheduleText(r.schedule))} · ${esc(r.location)} · ${styleLabels(r.styles)}</div>
          <div class="tiny muted">신청 ${fmtAt(r.createdAt)}</div>
        </div>`).join('') || '<p class="small muted">신청이 없어요.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>매칭</h2><span class="hint">전체 ${a.matches.length}건</span></div>
      <p class="tiny muted">'대화 보기'는 약속 분쟁 처리처럼 꼭 필요할 때만 눌러 주세요. 누를 때마다 운영 기록에 남아요.</p>
      ${a.matches.map((m) => `
        <div class="admin-item">
          <div class="row" style="justify-content:space-between"><b>${esc(m.names.join(' ↔ '))}</b><span class="pill${m.status === 'closed' ? ' gray' : ' lime'}">${STATUS[m.status] ?? m.status}</span></div>
          <div class="tiny muted">${shortDay(m.weekStart)}~${shortDay(m.weekEnd)} · ${esc(scheduleText(m.schedule))} · ${esc(m.location)} · ${styleLabels(m.styles)}</div>
          ${m.leftBy ? `<div class="tiny" style="color:var(--red)">${esc(m.leftBy)}님이 중간에 그만둠</div>` : ''}
          <a class="btn sm mt" href="#/admin/match/${m.id}">매칭 화면 보기</a>
          ${m.messageCount ? `<button type="button" class="btn sm mt" data-view-chat="${m.id}" data-label="대화 보기 (${m.messageCount})">대화 보기 (${m.messageCount})</button>
          <div id="admin-chat-${m.id}"></div>` : ''}
        </div>`).join('') || '<p class="small muted">매칭이 없어요.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>신고된 대화</h2><span class="hint">처리 안 한 신고 ${openReports.length}건</span></div>
      <p class="tiny muted">신고된 대화는 여기에 바로 보여요. 다른 대화는 위 '매칭'에서 '대화 보기'로 열고, 열람은 모두 운영 기록에 남아요.</p>
      ${openReports.map((r) => {
        const chat = a.chats.find((c) => c.matchId === r.matchId);
        return `
        <details class="admin-chat"><summary class="small"><b>${esc(r.names.join(' ↔ '))}</b> <span class="tiny muted">· ${esc(r.reason)} · 신고 ${esc(r.reporter)} · ${fmtAt(r.createdAt)}</span></summary>
          ${r.detail ? `<p class="small mt">${esc(r.detail)}</p>` : ''}
          ${(chat?.messages ?? []).map((m) => `<div class="admin-msg"><span class="tiny muted">${fmtAt(m.createdAt)} · ${esc(m.name)}</span><div class="small">${esc(m.body)}</div></div>`).join('') || '<p class="tiny muted mt">주고받은 메시지가 없어요.</p>'}
          <button type="button" class="btn sm mt" data-close-report="${r.id}">처리 완료</button>
        </details>`;
      }).join('') || '<p class="small muted">처리할 신고가 없어요.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>약속 기록</h2><span class="hint">${a.promise.length}명</span></div>
      ${a.promise.map((p) => `
        <div class="admin-item row" style="justify-content:space-between">
          <span><b>${esc(p.name)}</b> <span class="tiny muted">${p.suspendedUntil ? `매칭 정지 · ${fmtAt(p.suspendedUntil)}까지` : `기록 ${p.count}회`}</span></span>
          ${p.suspendedUntil ? `<button type="button" class="btn sm" data-unsuspend="${p.id}" data-name="${esc(p.name)}">정지 풀기</button>` : ''}
        </div>`).join('') || '<p class="small muted">약속 기록이 있는 사람이 없어요.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>운영 기록</h2><span class="hint">최근 ${a.adminLogs.length}건</span></div>
      ${a.adminLogs.map((l) => `<div class="list-item"><span class="small">${esc(l.name)} · ${ADMIN_ACTION[l.action] ?? esc(l.action)}${esc(logTarget(l))}</span><span class="tiny muted">${fmtAt(l.at)}</span></div>`).join('') || '<p class="small muted">기록이 없어요.</p>'}
    </section>`;

  // 매칭 대화 열어 보기 (누를 때마다 운영 기록에 남음, 처리방침 5번). 한 번 더 누르면 닫는다.
  $$('[data-view-chat]').forEach((b) => b.addEventListener('click', async () => {
    const box = $(`#admin-chat-${b.dataset.viewChat}`);
    if (box.childElementCount) {
      box.innerHTML = '';
      b.textContent = b.dataset.label;
      return;
    }
    if (!confirm('이 매칭의 대화를 열어 볼까요?\n약속 분쟁 처리처럼 꼭 필요할 때만 열어 주세요. 연 기록이 운영 기록에 남아요.')) return;
    try {
      const chat = await api(`/admin/matches/${b.dataset.viewChat}/chat`);
      box.innerHTML = chat.messages.map((m) => `<div class="admin-msg"><span class="tiny muted">${fmtAt(m.createdAt)} · ${esc(m.name)}</span><div class="small">${esc(m.body)}</div></div>`).join('')
        || '<p class="tiny muted mt">주고받은 메시지가 없어요.</p>';
      b.textContent = '대화 닫기';
    } catch (err) { toast(err.message, true); }
  }));

  // 신고 처리 완료, 매칭 정지 풀기 (둘 다 운영 기록에 남음)
  $$('[data-close-report]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/admin/reports/${b.dataset.closeReport}/close`, { method: 'POST' });
      toast('신고를 처리 완료로 바꿨어요.');
      router();
    } catch (err) { toast(err.message, true); }
  }));
  $$('[data-unsuspend]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`${b.dataset.name}님의 매칭 정지를 풀까요? 약속 기록도 0회부터 다시 세요.`)) return;
    try {
      await api(`/admin/users/${b.dataset.unsuspend}/unsuspend`, { method: 'POST' });
      toast('매칭 정지를 풀었어요.');
      router();
    } catch (err) { toast(err.message, true); }
  }));

  // 전환 단계: 전체 ↔ 오늘만
  $('#funnel-today').addEventListener('click', (e) => {
    const today = e.target.getAttribute('aria-pressed') !== 'true';
    e.target.setAttribute('aria-pressed', today);
    e.target.textContent = today ? '전체 보기' : '오늘만 보기';
    $('#funnel').innerHTML = funnelHTML(today ? a.funnel.today : a.funnel.all);
  });
}

async function renderEditProfile(alive) {
  setTop({ title: '프로필 수정', back: '#/me' });
  setTabs(null);
  loading();
  const { user } = await api('/me');
  if (!alive()) return;

  view.innerHTML = `
    <form id="f" class="card">
      <div class="profile">
        ${avatarHTML(user)}
        <p class="tiny muted">프로필 동그라미에는 이름 글자가 보여요.</p>
      </div>
      <label class="field"><span>이름 (닉네임)</span><input class="input" name="name" maxlength="20" value="${esc(user.name)}" required></label>
      <label class="field"><span>학과</span><input class="input" name="department" maxlength="30" value="${esc(user.department ?? '')}" placeholder="예: 경영정보학부" required></label>
      <label class="field"><span>전화번호 (메이트에게는 보이지 않아요)</span><input class="input" name="phone" type="tel" inputmode="numeric" value="${esc(user.phone ?? '')}" placeholder="010-1234-5678" required></label>
      <label class="field"><span>태그 (쉼표로 구분, 최대 5개)</span><input class="input" name="tags" value="${esc(user.tags.join(', '))}" placeholder="#카페공부, #자격증준비, #ENFJ"></label>
      <label class="field"><span>한 줄 소개</span><textarea class="input" name="bio" maxlength="200" placeholder="메이트에게 나를 소개해 주세요">${esc(user.bio)}</textarea></label>
      <button class="btn primary block mt-lg">저장하기</button>
    </form>`;

  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await withLoading('', '프로필을 저장하는 중이에요', () => api('/me', {
        method: 'PUT',
        body: { ...fd, tags: fd.tags.split(/[,\s]+/).filter(Boolean) },
      }));
      toast('프로필을 저장했어요.');
      history.back();
    } catch (err) { toast(err.message, true); }
  });
}
