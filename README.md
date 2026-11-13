# 스터디버디 (studybuddy.)

> 1주일 단위 1:1 스터디 메이트 매칭 플랫폼 — 메이트업 MateUp · 국민대학교 창업동아리

혼자 하는 공부는 미뤄도 아무도 모르기 때문에 쉽게 무너집니다.
스터디버디는 "같은 시간에 함께 시작한다"는 약속 하나로 두 사람을 연결하고, 출석·공부시간 기록과 '약속 지키기' 규칙(도서관 연체 정지처럼)으로 그 약속이 지켜지게 만듭니다.

## 실행 방법

Node.js 22.13 이상이 필요합니다. 로컬에서는 Node 내장 `node:sqlite`를 써서 별도 DB 설치가 필요 없고, 실서비스는 Supabase(PostgreSQL)를 씁니다.

```bash
npm install
npm run demo     # 데모 모드 (추천): SQLite + 데모 메이트, 시간과 상관없이 출석, 주간 즉시 마감 버튼
npm start        # 일반 모드: SQLite, 약속 시작 30분 전 ~ 종료 시각에만 출석 가능
npm run dev      # 데모 모드 + 파일 변경 시 자동 재시작
npm run dev:db   # .env.local 의 DATABASE_URL(Supabase, 실서비스 DB!)에 접속해서 실행
npm test         # 매칭·출석·정산·보안·개인정보 테스트 (SQLite와 PostgreSQL 모두)
TEST_DATABASE_URL=postgres://... node --test test/postgres.test.js  # 실제 PostgreSQL 동시성 테스트 (CI의 postgres 작업)
npm run test:e2e # 실제 브라우저로 화면 자동 테스트 (먼저: npm i --no-save playwright@1.63.0 && npx playwright install chromium)
npm run backup   # 실서비스 DB 백업 (.env.local 의 DATABASE_URL), 복구 연습은 npm run restore:check -- <파일>
npm run ops -- status   # 운영 도구: 현황·정지 풀기·대기 신청 정리 (docs/operations-guide.md)
npm run loadtest # 부하 테스트: 서버 한 대가 감당하는 양 (운영 가이드 9장)
```

브라우저에서 http://localhost:3000 을 열고 회원가입하면 됩니다. 모바일 화면 기준으로 디자인되어 있습니다.

환경 변수: `PORT` (기본 3000), `DB_FILE` (기본 `data/studybuddy.db`), `DEMO_MODE=1` (`--demo`와 동일), `DATABASE_URL` (있으면 SQLite 대신 PostgreSQL 사용)

데이터를 초기화하려면 서버를 끄고 `data/` 폴더를 지우세요.

## 서버 없이 HTML 파일 하나로 체험하기

```bash
npm run build:standalone
```

`dist/studybuddy-demo.html` 이 만들어집니다. 이 파일만 더블클릭하면 서버 없이 모든 기능(데모 모드)을 쓸 수 있고, 다른 사람에게 파일로 보내도 됩니다.

- 서버 로직(`server/service.js`)을 그대로 브라우저에서 실행하고, DB는 SQLite WASM(sql.js)으로 대체합니다. 관련 코드는 `standalone/`에 있습니다.
- 데이터는 그 브라우저(localStorage)에만 저장되어 다른 사람과 공유되지 않습니다. 마이페이지의 "데모 데이터 모두 지우기"로 초기화할 수 있습니다.
- 화면이나 로직을 고친 뒤에는 이 명령을 다시 실행해야 파일에 반영됩니다.

## 실서비스 배포 (Vercel + Supabase)

GitHub `main` 브랜치에 push하면 Vercel이 `npm run build:vercel`을 실행해 배포합니다. (`vercel.json`)

| 주소 | 내용 |
| --- | --- |
| `/` | 실서비스 화면 (`public/`) — 실제 사용자끼리 매칭 |
| `/api/*` | 서버 API — `api/index.js` 서버리스 함수(서울 `icn1`)가 `server/app.js`를 실행 |

- DB: Supabase PostgreSQL(서울 `ap-northeast-2`). Vercel 환경 변수 `DATABASE_URL`에 **Transaction pooler(포트 6543)** 주소를 넣습니다. 테이블은 첫 실행 때 자동으로 만들어지고, 모든 테이블에 RLS가 켜져 Supabase 공개 API로는 접근할 수 없습니다.
- 매일 작업: Vercel Cron이 매일 00:00(KST)에 `/api/cron/settle`을 호출합니다. 주간 정산 → 대기 신청끼리 다시 맞추기 → 보관 기간 지난 기록 정리 순서로 돌고, 결과는 `/api/health`에서 봅니다. 사용자가 앱을 열 때도 정산을 확인합니다. 환경 변수 `CRON_SECRET`을 넣으면 크론 호출만 허용합니다.
- 환경 변수 전체와 장애 대응·백업·운영자 작업은 [docs/operations-guide.md](docs/operations-guide.md)에 있습니다.
- 변경은 PR로 올리고 자동 확인(CI: `.github/workflows/ci.yml`)의 test·e2e가 통과해야 합칩니다.
- 실서비스에는 데모 기능(시간 무관 출석, 즉시 마감)이 없습니다. 데모 버전은 배포하지 않습니다(`npm run build:standalone`으로 HTML 파일만 만들 수 있음).
- 가입·로그인은 국민대 메일(@kookmin.ac.kr)만 가능하고, 가입·비밀번호 찾기는 메일 인증번호로 확인합니다. Vercel 환경 변수 `GMAIL_USER`, `GMAIL_APP_PASSWORD`(Gmail 앱 비밀번호)가 필요합니다.
- 날짜 계산은 서버 위치와 상관없이 한국 시간(KST) 기준입니다. (`server/time.js`)

## 기능 (기획서 → 구현)

| 기획서 | 구현 내용 |
| --- | --- |
| **매칭 신청** — 요일·시간, 장소, 교류 방식(체크형·대화형·사교형) | 신청 화면에서 조건을 고르면 대기 중인 신청 가운데 조건이 맞는 메이트와 즉시 1:1 연결. 없으면 대기열에 올라가고, 새 신청이 들어올 때 자동 매칭 |
| **약속 지키기** (보증금 대신) | 약속 날 안 나오거나(미참석) 매칭된 뒤 '매칭 그만두기'를 하면 1회로 기록. **2회**가 되면 **30일** 동안 매칭 신청 정지(기다리던 신청도 취소), 정지가 끝나면 0회부터 다시 셈. 데모 메이트·공용 데모 계정은 세지 않음. 횟수·기간·시작일은 `server/options.js`의 `PROMISE_RULE` (2026-11-06부터 적용) |
| **약속 이행** — 출석·공부시간 기록 | 매칭되면 1주일치 약속이 자동 생성. 메이트의 QR을 스캔(또는 6자리 코드 입력)하거나 직접 출석. 출석 후 타이머로 공부시간 기록 |
| **주간 리포트와 재매칭** | 주간이 끝나면 자동 정산 후 리포트(출석률·공부시간). 이때 안 나온 약속이 '약속 지키기' 기록으로 남음. "계속하기"를 둘 다 고르면 다음 주 약속이 바로 생성되고, 한 명이라도 "새 메이트"를 고르면 종료 (매칭 정지 중에는 계속하기 불가) |
| 화면 스케치 — 메이트 화면 | 현장 출석 확인(QR, 출석할 수 있을 때 맨 위), 메이트 프로필, 약속별 출석 표(날짜·시간 / 나 / 메이트), 남은 약속을 **캘린더에 추가**(.ics 내려받기 → 구글·애플·아웃룩 캘린더), 하단 탭(홈·메이트·채팅·마이페이지) |
| (추가) 채팅 · 마이페이지 | 메이트와 1:1 채팅(안 읽은 메시지 수), 프로필/태그 수정, 약속 기록(몇 회 / 매칭 정지), **내 공부 기록**(약속을 다 지킨 주가 연달아 이어진 **연속**·함께한 주·총 공부시간·출석률), 지난 스터디 기록 |

### 보안·개인정보·운영 (2026-11-06)

| 영역 | 내용 | 코드 |
| --- | --- | --- |
| 로그인 | 세션 토큰은 해시로만 저장, 30일 안 쓰면 만료. 비밀번호를 바꾸거나 탈퇴하면 모든 기기 로그아웃. 예전 토큰은 첫 접속 때 자동으로 옮김 | `server/sessions.js` |
| 비밀번호 | scrypt(비동기), 없는 메일로 로그인해도 같은 시간 | `server/service.js` |
| 횟수 제한 | 로그인 5번 틀리면 15분 잠금, 인증메일 IP당 1시간 10번·메일당 하루 10번, 메시지 1분 30개 등. DB에 세서 서버가 여러 대여도 같이 셈 | `server/security.js` |
| 보안 헤더 | CSP(같은 주소의 스크립트만), 화면 끼워 넣기 금지, HSTS 등. `vercel.json`과 같은 값인지 테스트가 확인 | `server/security.js` |
| 개인정보 | 처리방침(`public/privacy.html`)과 가입 동의, 기존 회원 동의 창, 내 정보 내려받기(JSON, 상대방 정보 제외), 회원 탈퇴(정보 삭제·'탈퇴한 사용자'), 보관 기간 지나면 자동 삭제. 전화번호는 운영 연락용으로 그대로 저장(2026-11-06 결정: 메이트에게는 안 보이고 운영자 2명만 열람) | `server/privacy.js` |
| 신고·운영자 | 채팅 신고, 매칭 대화 보기(누를 때마다 열람 기록), 운영자 열람 기록, 정지 풀기 | `server/reports.js`, `server/admin.js` |
| 운영 | 요청 번호·오류 로그, 디스코드/슬랙 알림, `/api/health`, 매일 작업 기록, GitHub 30분 상태 확인(실패하면 메일), 약속 리마인드 메일(30분마다), 백업·복구 연습·운영 스크립트 | `server/ops.js`, `server/notify.js`, `scripts/`, `.github/workflows/uptime.yml`, `.github/workflows/reminders.yml` |
| DB 구조 | 구조가 바뀐 경우에만 한 번 적용(지문 비교) + 번호 붙은 변경, 서버 여러 대가 동시에 켜져도 한 번만 | `server/migrate.js` |
| 매칭 | 매칭은 한 번에 하나씩(PostgreSQL 잠금) → 거의 동시에 들어온 신청끼리도 바로 매칭, 매일 작업에서 대기 신청끼리 다시 맞추기 | `server/service.js` |
| 미리보기 배포 | PR·브랜치 미리보기는 실서비스 DB를 쓰지 않음(`PREVIEW_DATABASE_URL`, 없으면 API 503) | `api/index.js` |
| 성능 | 채팅 확인은 대화 중 3초·조용하면 6초·12초, 화면을 안 보면 멈춤. 자주 불리는 요청의 DB 쿼리를 줄임(요청당 평균 7.3번 → 4.8번). 부하 테스트 스크립트와 측정 결과 | `public/app.js`, `scripts/loadtest.mjs` |

### 매칭 규칙 (`server/service.js` → `compatibility`)

두 신청이 아래를 모두 만족하면 매칭되고, 후보가 여럿이면 겹치는 요일·스타일·시간이 많은 쪽을 우선합니다.

- 같은 장소
- 겹치는 요일 1개 이상 → 겹치는 요일이 약속 요일이 됨
- 겹치는 시간 1시간 이상 → 겹치는 구간이 약속 시간이 됨
- 공통 공부 스타일 1개 이상
- 매칭 정지 중인 사람은 신청할 수 없음 (`약속 지키기`)

### 데모 메이트

매칭을 기다리는 데모 메이트 3명(`server/seed.js`)이 있어 혼자서도 전체 흐름을 체험할 수 있습니다. 화면에는 "데모 메이트"로 표시되고, 사용자가 출석하면 함께 출석하고, 채팅에 답장하며, 리포트에서 항상 "계속하기"를 고릅니다. 목록에서 빠진 예전 데모 메이트는 실행할 때 자동으로 정리됩니다(매칭 기록이 있으면 기록용으로만 남김).

| 이름 | 요일 · 시간 | 장소 | 스타일 |
| --- | --- | --- | --- |
| 김아침 | 월~금 09:00~12:00 | 경영관 3층 라운지 | 체크형·대화형·사교형 |
| 김저녁 | 월~금 19:00~21:00 | 국민대 성곡도서관 | 체크형·대화형·사교형 |
| 김주말 | 토·일 13:00~18:00 | 정릉 근처 카페 | 체크형·대화형·사교형 |

예) **국민대 성곡도서관 · 월~금 중 아무 요일 · 오후 7~9시 · 체크형**으로 신청 → 김저녁 님과 바로 매칭

장소: 국민대 성곡도서관, 북악관 1층 라운지, 복지관 3층 열람실, 경영관 3층 라운지, 정릉 근처 카페 (`server/options.js`)

## 구조

```
api/
  index.js     Vercel 서버리스 함수 (실서비스 API)
server/
  index.js     로컬 서버 시작, 데모 메이트 생성, 주간 자동 정산 스케줄
  app.js       Express 라우트 (REST API + 정적 파일 + 크론)
  service.js   핵심 로직: 인증, 매칭, 출석, 정산, 재매칭, 채팅, 포인트 (동시 접속 안전)
  db.js        DB 공통 인터페이스, 스키마, SQLite 드라이버
  db-pg.js     PostgreSQL 드라이버 (Supabase / 테스트용 PGlite)
  options.js   장소·스타일·스터디 날짜·약속 지키기 규칙(PROMISE_RULE)·처리방침 버전(PRIVACY_POLICY)
  migrate.js   DB 구조 버전 관리 (schema_migrations)
  sessions.js  로그인 세션 (토큰 해시·만료)
  security.js  요청 횟수 제한, 보안 헤더
  privacy.js   처리방침 동의, 회원 탈퇴, 보관 기간 정리, 내 정보 내려받기
  fieldcrypt.js 메일 해시(탈퇴 뒤 매칭 정지 유지), 예전에 암호화된 값 읽기
  reports.js   채팅 신고
  admin.js     운영자 기록·정지 풀기·신고 목록·매칭 대화 보기
  ops.js       로그·알림·상태 확인
  seed.js      데모 메이트
  time.js      날짜 유틸 (KST 고정, 테스트에서 시간 고정 가능)
public/        모바일 웹 프론트엔드 (빌드 없는 바닐라 JS)
standalone/    서버 없는 HTML 데모용 브라우저 어댑터
scripts/       빌드 스크립트 (단독 HTML, Vercel), 백업·복구 연습·운영 도구, 부하 테스트
test/          node:test 테스트 (SQLite·PostgreSQL 양쪽에서 실행)
e2e/           실제 브라우저 화면 자동 테스트 (Playwright)
docs/          운영 가이드, 코드 나누기 계획
.github/       자동 확인(CI), PR 양식, 리뷰 담당자(CODEOWNERS), 라이브러리 업데이트(Dependabot)
```

## 참고 / 한계

- 보증금 제도는 없앴습니다(2026-11-05). 서버의 포인트·`stake` 계산 코드는 예전 기록과 호환되도록 남아 있지만, 새 신청의 보증금은 항상 0입니다.
- 약속 지키기 기록은 `strikes` 표, 정지 기간은 `users.suspended_until`에 저장됩니다. 운영자는 `npm run ops -- unsuspend <메일>`로 정지를 풀 수 있습니다(운영 기록에 남음).
- 출석 QR은 약속마다 하나의 코드를 두 사람이 공유하는 방식이라, 같은 장소에 있다는 것을 강하게 보장하지는 않습니다. 실서비스에서는 시간에 따라 바뀌는 코드나 위치 확인을 더하는 것을 권장합니다.
- 카메라 QR 인식은 `BarcodeDetector`를 지원하는 브라우저(안드로이드 Chrome 등)에서 동작하며, 그 외에는 코드 입력으로 출석합니다. 카메라는 `localhost` 또는 HTTPS에서만 사용할 수 있습니다.
- 채팅은 폴링입니다(대화 중 3초, 조용하면 6초·12초, 화면을 안 보면 멈춤). 서버 한 대가 대화 중인 사용자 약 400명을 감당하는 것으로 측정했습니다(운영 가이드 9장). 훨씬 많아지면 Supabase Realtime 등 실시간 방식으로 바꾸는 것을 권장합니다.
- 처리방침은 법률 자문을 받은 문서가 아닙니다. 학교나 전문가에게 한 번 확인받는 것을 권장합니다.
