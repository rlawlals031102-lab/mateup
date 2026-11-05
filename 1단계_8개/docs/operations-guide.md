# 스터디버디 운영 가이드

문제가 생겼을 때 이 문서대로 따라 하면 됩니다. 운영진: 김지민(개인정보 보호책임자), 나윤빈(담당자).

## 1. 평소에 하는 일

| 언제 | 할 일 |
| --- | --- |
| 매일 (자동) | 00:00 KST에 Vercel Cron이 `/api/cron/settle` 실행: 주간 정산 → 대기 신청끼리 다시 맞추기 → 보관 기간 지난 기록 정리 → 아직 암호화 안 된 전화번호 암호화. 결과는 `/api/health`의 `daily` |
| 매주 | GitHub의 Dependabot PR(라이브러리 보안 업데이트) 확인 → CI 통과하면 합치기 |
| 회차 시작 전 | `npm run backup`으로 백업 → `npm run restore:check -- <파일>`로 복구 연습 |
| 신고가 들어오면 | 개발자 화면에서 신고 내용 확인 → 처리 후 '처리 완료' (열람 기록이 남음) |

## 2. 변경을 올리는 순서 (main 보호를 켠 뒤)

1. 바꾼 파일을 새 브랜치에 올린다.
   - 웹 업로드라면 Upload files 화면 아래에서 **Create a new branch for this commit and start a pull request**를 고른다.
2. PR(변경 요청)을 만든다. 자동 확인(CI)의 **test**와 **e2e**가 돈다(약 5분). 실패하면 `Details`에서 이유를 본다. e2e가 실패하면 화면 캡처가 `e2e-screenshots`로 올라온다.
3. 다른 한 사람이 PR을 보고 승인한다.
4. **Merge**를 누르면 Vercel이 실서비스에 배포한다(1–2분).
5. 배포 뒤 `https://mateup-gamma.vercel.app/api/health`가 `"ok": true`인지 확인한다.

## 3. 장애가 났을 때

### 사이트가 안 열리거나 오류 화면이 계속 나온다

1. `/api/health`를 연다.
   - 응답이 없거나 `"db": "error"`이면 3번(DB)으로 간다.
   - `ok`이면 화면 코드 문제일 가능성이 높다.
2. **바로 되돌리기:** Vercel → 프로젝트 → Deployments에서 직전에 잘 되던 배포의 `…` → **Instant Rollback**. 1분 안에 이전 버전으로 돌아간다.
3. 원인 찾기: Vercel → Logs에서 `"level":"error"` 줄을 찾는다.
   - 사용자가 본 오류 화면에 **요청 번호**(`requestId`)가 있으면 그 번호로 검색한다.
4. 고친 변경은 2번 순서대로 다시 올린다.

### DB 문제 (`"db": "error"`)

1. Supabase 대시보드 → 프로젝트가 일시 정지(Paused)됐는지, 사용량 한도를 넘었는지 확인한다.
2. Vercel 환경 변수 `DATABASE_URL`이 Transaction pooler(포트 6543) 주소인지 확인한다.
3. `DATABASE_CA_CERT`를 최근에 넣었다면 지워 보고 다시 배포한다. 인증서가 맞지 않으면 연결이 거절된다.

### 인증메일이 안 간다

1. Vercel 환경 변수 `GMAIL_USER`, `GMAIL_APP_PASSWORD`를 확인한다.
2. Gmail의 하루 발송 한도를 넘었을 수 있다. 다음 날 풀린다.
3. 한 사람이 1시간에 10번 넘게 요청했거나 하루에 10번 넘게 받으면 서버가 막는다(429).

### 매일 정산이 안 됐다 (`warnings`에 `daily-job-late` 또는 `daily-job-failed`)

1. Vercel → Settings → Cron Jobs에서 실행 기록을 확인한다.
2. 실패했다면 브라우저로 직접 실행할 수 있다:
   - `CRON_SECRET`을 넣지 않은 경우: `https://mateup-gamma.vercel.app/api/cron/settle`을 연다.
   - 넣은 경우: 헤더 `Authorization: Bearer <CRON_SECRET>`을 붙여 호출한다.
3. 사용자가 앱을 열 때도 정산을 확인하므로, 하루 늦어도 리포트는 만들어진다.

## 4. 운영자 작업 (DB를 직접 고치지 않기)

`.env.local`에 `DATABASE_URL`(실서비스 DB)과 `OPERATOR_EMAIL`(내 학교 메일)을 넣고 실행한다. 바꾸는 작업은 운영 기록(`admin_logs`)에 남는다.

```bash
npm run ops -- status                     # 가입자·대기 신청·진행 중 매칭·정지 중·열린 신고·상태
npm run ops -- user 학번@kookmin.ac.kr     # 약속 기록·정지 상태
npm run ops -- unsuspend 학번@kookmin.ac.kr        # 매칭 정지 풀기 (기록도 0번부터)
npm run ops -- cancel-requests 학번@kookmin.ac.kr  # 대기 신청 모두 취소
```

## 5. 백업과 복구

```bash
npm run backup                                          # backups/backup-날짜.json (개인정보 포함!)
npm run restore:check -- backups/backup-20261110-0900.json   # 메모리 속 DB에 넣어 보고 행 수 비교 (실서비스 DB는 그대로)
```

- 백업 파일은 저장소에 올리지 않는다. 운영진만 보는 곳에 두고 30일 뒤 지운다.
- 실제로 되살려야 하면 Supabase 대시보드 → Database → Backups에서 시점을 골라 복구한다.
  - 요금제에 따라 보관 기간이 다르다.
  - 복구하면 그 뒤에 생긴 데이터는 사라지니, 먼저 `npm run backup`을 한 번 더 받아 둔다.

## 6. 개인정보 요청과 유출 대응

- **열람·정정·삭제 요청 (메일로 받은 경우):** 본인 학교 메일에서 온 요청인지 확인하고 10일 안에 처리해서 답장한다.
  - 삭제: 본인이 마이페이지에서 탈퇴하도록 안내한다.
  - 본인이 할 수 없는 경우: `npm run ops`로 대기 신청을 정리한 뒤 개발자에게 요청한다.
- **유출이 의심되면** (DB 주소·비밀번호가 새어 나갔거나 이상한 접근이 보이면):
  1. 즉시 비밀값을 바꾼다: Supabase DB 비밀번호 → Vercel `DATABASE_URL` 바꾸기, Gmail 앱 비밀번호, `CRON_SECRET`.
     - 전화번호 암호 키(`DATA_ENCRYPTION_KEY`)는 바꾸면 기존 번호를 읽을 수 없으니, 새 키로 다시 암호화하는 작업이 먼저 필요하다. 개발자와 상의한다.
  2. 어떤 정보가, 누구의 것이, 언제 새어 나갔는지 정리한다.
  3. 개인정보 보호법에 따라 정보주체에게 알리고, 해당하면 개인정보보호위원회·KISA(118)에 신고한다. 72시간 이내 통지가 원칙이니 학교·전문가와 바로 상의한다.
- 처리방침을 바꾸면 `server/options.js`의 `PRIVACY_POLICY.version`도 바꾼다. 그러면 모든 회원에게 다시 동의 창이 뜬다.

## 7. 환경 변수 (Vercel → Settings → Environment Variables)

| 이름 | 필수 | 내용 |
| --- | --- | --- |
| `DATABASE_URL` | 필수 | Supabase Transaction pooler 주소 |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | 필수 | 인증메일 보내는 Gmail과 앱 비밀번호 |
| `DATA_ENCRYPTION_KEY` | 권장 | 전화번호 암호 키. `openssl rand -base64 32`로 만든다. **잃어버리면 암호화된 전화번호를 되살릴 수 없으니** 운영진 비밀 보관함에도 적어 둔다 |
| `CRON_SECRET` | 권장 | 아무 긴 글자. 있으면 매일 작업을 Vercel Cron만 부를 수 있다 |
| `ALERT_WEBHOOK_URL` | 권장 | 디스코드(또는 슬랙) 웹훅 주소. 서버 오류·매일 작업 실패를 알린다 |
| `DATABASE_CA_CERT` | 선택 | Supabase → Database → SSL Configuration에서 받은 인증서(PEM 내용). 넣으면 DB 서버가 진짜인지 확인한다 |
| `GMAIL_USER_2`, `ADMIN_EMAILS` 등 | — | 지금 코드에서는 쓰지 않음 |

## 8. 외부 감시 (선택, 무료)

UptimeRobot 같은 서비스에 `https://mateup-gamma.vercel.app/api/health`를 5분 간격으로 등록하고, 응답이 200이 아니면 메일·디스코드로 알리게 한다.
