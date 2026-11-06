# 코드 나누기 계획 (김지민님과 함께 정할 일)

지금 `server/service.js`(약 1,550줄)와 `public/app.js`(약 1,900줄)에 거의 모든 기능이 들어 있다. 두 사람이 같은 파일을 동시에 고치면 서로 덮어쓰기 쉽고, 한 곳을 고쳐도 어디가 영향을 받는지 알기 어렵다.

이번 정리(2026-11-06)에서 새로 만든 기능은 처음부터 따로 만들었다.

- `server/sessions.js`, `security.js`, `privacy.js`, `reports.js`, `admin.js`, `ops.js`, `migrate.js`, `fieldcrypt.js`

기존 두 파일은 김지민님 작업과 부딪치지 않도록 아직 나누지 않았다.

## 원칙

- **한 번에 한 파일만, 기능은 그대로 옮기기만** 한다. 옮기면서 고치지 않는다. 테스트 83개와 화면 자동 테스트(e2e)가 그대로 통과해야 한다.
- 옮기는 날에는 그 파일을 다른 사람이 고치지 않는다. 미리 날짜를 정하고, 하루 안에 PR로 합친다.
- 파일 하나가 400줄을 넘지 않게 한다.

## 서버: `server/service.js` → 영역별 파일

| 새 파일 | 옮길 내용 |
| --- | --- |
| `server/auth.js` | 가입·로그인·비밀번호 찾기·인증메일·데모 로그인, `privateUser`/`publicUser` |
| `server/matching.js` | `validateRequest`, `compatibility`, `createRequest`, `tryMatch`, `rematchPending`, `cancelRequest`, `planStudy` |
| `server/attendance.js` | 출석 코드·QR, `confirmMate`, `checkOut`, 출석 상태 |
| `server/weekly.js` | `settleMatch`, `autoSettle`, `leaveMatch`, `chooseNext`, 리포트, 지난 스터디 |
| `server/promise.js` | 약속 지키기 (`strikeStatus`, `addStrike`, `recordNoShows`) |
| `server/chat.js` | 메시지, 읽음, 안 읽은 수 |
| `server/dashboard.js` | `adminDashboard`, 방문 기록 |
| `server/service.js` | 위 파일들을 다시 내보내기만 (`export * from './auth.js'` …) → 다른 파일과 테스트는 그대로 동작 |

**순서:** 약속 지키기 → 채팅 → 출석 → 주간 → 매칭 → 인증 → 개발자 화면. 의존이 적은 것부터 옮긴다.

## 화면: `public/app.js` → 화면별 파일 (ES 모듈)

| 새 파일 | 옮길 내용 | 담당 |
| --- | --- | --- |
| `public/js/core.js` | `api`, `esc`, `toast`, `$`, 날짜 함수, 라우터 | 함께 |
| `public/js/home.js` | 홈 (시간표 포함) | **김지민** |
| `public/js/apply.js` | 매칭 신청 | **김지민** |
| `public/js/admin.js` | 개발자 화면 | **김지민** |
| `public/js/mate.js` | 메이트 화면·리포트·지난 스터디 | 나윤빈 |
| `public/js/chat.js` | 채팅·신고 | 나윤빈 |
| `public/js/me.js` | 마이페이지·탈퇴·프로필 | 나윤빈 |
| `public/js/auth.js` | 로그인·가입·동의 | 나윤빈 |

**나누면 좋아지는 점:**

- `.github/CODEOWNERS`에 파일별 담당자를 적을 수 있다. 예: `/public/js/home.js @rlawlals031102-lab`
- 그러면 김지민님 화면 파일은 김지민님이 승인해야만 바뀐다. 지금은 한 파일이라 이렇게 나눌 수 없다.

**단독 실행 HTML:** `scripts/build-standalone.mjs`가 지금은 `app.js`를 그대로 붙인다. 나눈 뒤에는 esbuild로 묶도록 바꿔야 한다(서버 쪽 묶음과 같은 방식).

## 그 다음 (선택)

- 화면 코드를 HTML 글자로 직접 만드는 대신 lit-html 같은 작은 도구를 쓰면, 이스케이프(`esc`)를 빠뜨리는 실수가 구조적으로 사라진다.
- TypeScript 타입 검사(`// @ts-check` + `tsc --noEmit`)를 CI에 넣으면 잘못된 이름·형식을 미리 잡는다.
