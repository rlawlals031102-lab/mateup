import * as T from './time.js';

export const LOCATIONS = [
  '채팅으로 정하기',
  '지정 강의실 (미래관 320호)',
];

// 날짜마다 지정 강의실이 다른 날. 여기 없는 날은 위 기본 강의실(미래관 320호).
export const ROOMS_BY_DATE = {
  '2026-11-25': '공학관 B119호',
  '2026-11-26': '공학관 B119호',
  '2026-11-27': '미래관 320호',
  '2026-11-28': '공학관 B119호',
  '2026-11-29': '공학관 B119호',
  '2026-11-30': '공학관 B119호',
  '2026-12-01': '공학관 B119호',
  '2026-12-02': '공학관 B119호',
  '2026-12-03': '공학관 B119호',
};
// 지정 강의실이 없는 날: 이날만 고르면 지정 강의실을 못 고르고,
// 다른 날과 같이 고르면 이날 약속만 '채팅으로 정하기'가 된다 (다른 날은 지정 강의실).
export const NO_ROOM_DATES = ['2026-11-23', '2026-11-24'];
export const isRoomLocation = (l) => String(l ?? '').startsWith('지정 강의실');
// '지정 강의실 (기본)' 장소를 그날의 강의실로 바꿔 보여 준다 (강의실이 없는 날은 '채팅으로 정하기')
// 이날부터는 강의실을 아직 정하지 않았다 (ROOMS_BY_DATE 에 넣으면 그 강의실로)
export const ROOMS_UNASSIGNED_FROM = '2026-12-04';
export const UNASSIGNED_ROOM = '아직 배정된 강의실이 없어요';
export const roomLocation = (location, date) => {
  if (!isRoomLocation(location)) return location;
  if (NO_ROOM_DATES.includes(date)) return '채팅으로 정하기';
  const room = ROOMS_BY_DATE[date] ?? (date >= ROOMS_UNASSIGNED_FROM ? UNASSIGNED_ROOM : null);
  return room ? String(location).replace(/\(.*\)/, `(${room})`) : location;
};

// 스터디 기간: 매일(월~일) 17:00~22:00. 매칭 신청에서는 이 중 원하는 날짜만 고름.
// 날짜는 따로 바꿀 필요 없이 '오늘부터 7일'(오늘 공부 시간이 끝났으면 내일부터)로 저절로 넘어간다 (한 요일당 한 날짜).
export const STUDY_PERIOD = {
  get dates() {
    const first = T.at(T.today(), this.end) > T.now() ? T.today() : T.addDays(T.today(), 1);
    return Array.from({ length: 7 }, (_, i) => T.addDays(first, i));
  },
  start: '17:00',
  end: '22:00',
  // 날짜별로 시간을 다르게 할 날이 있으면: times: { 'YYYY-MM-DD': { start, end, label } }
};

export const STYLES = {
  check: { label: '체크형', desc: '조용히 공부하기' },
  talk: { label: '대화형', desc: '공부와 가벼운 대화' },
  social: { label: '사교형', desc: '공부 후 네트워킹' },
};

// 약속 시작 몇 분 전부터 출석할 수 있는지
export const CHECKIN_EARLY_MIN = 30;

export const MIN_OVERLAP_MIN = 60;

// 실서비스 가입·로그인을 허용하는 학교 메일 도메인 (데모 모드에서는 제한 없음)
export const EMAIL_DOMAIN = 'kookmin.ac.kr';

// 약속 지키기 (보증금 대신, 도서관 연체 정지처럼):
// 매칭 그만두기·약속 날 미참석이 strikeLimit번 쌓이면 suspendDays일 동안 매칭 신청 정지. 정지가 끝나면 0번부터 다시 센다.
// from 이전의 약속·그만두기는 세지 않는다 (규칙을 알린 다음 회차부터 적용).
export const PROMISE_RULE = { strikeLimit: 2, suspendDays: 30, from: '2026-11-06' };

// 보증금(계좌이체): 매칭된 사람은 아래 계좌로 입금하고, 약속을 지키면 끝난 뒤 환불받는다.
// 앱은 돈을 직접 움직이지 않는다 — 운영자가 문자로 입금/환불을 수동 확인한다.
// 계좌번호는 결제 대상자(매칭된 실제 사용자)에게만 /me/deposit 로만 보인다. /api/options·공개 빌드에는 넣지 않는다.
// 계좌 정보는 반드시 환경변수로만 받는다(소스·공개 데모 빌드 유출 방지). 운영자가 Vercel 환경변수에 설정:
//   DEPOSIT_BANK, DEPOSIT_ACCOUNT, DEPOSIT_HOLDER  (안 넣으면 보증금 기능은 꺼진 것으로 본다)
//   끄기: DEPOSIT_ENABLED=0
export const DEPOSIT = {
  enabled: process.env.DEPOSIT_ENABLED !== '0',
  amount: Number(process.env.DEPOSIT_AMOUNT) || 5000,
  refundMinutes: Number(process.env.DEPOSIT_REFUND_MIN) || 10,
  bank: process.env.DEPOSIT_BANK ?? '',
  account: process.env.DEPOSIT_ACCOUNT ?? '',
  holder: process.env.DEPOSIT_HOLDER ?? '',
};
// 계좌가 실제로 설정됐고 기능이 켜져 있어야 보증금을 요구한다.
export const depositConfigured = () => DEPOSIT.enabled && !!DEPOSIT.account;

// 개인정보 처리방침 (public/privacy.html). 내용을 바꾸면 version 을 바꾸고 → 모든 회원에게 다시 동의를 받는다.
// 책임자·담당자는 처리방침에 적힌 사람과 같아야 한다.
export const PRIVACY_POLICY = {
  version: '2026-11-06',
  officer: { name: '김지민', role: '개인정보 보호책임자', email: 'rlawlals031102@kookmin.ac.kr' },
  manager: { name: '나윤빈', role: '개인정보 보호담당자', email: 'yunbinna6@kookmin.ac.kr' },
};

// '지금까지 함께 공부한 팀' 누적의 시작값. 앱을 만들기 전 오프라인으로 매칭했던 팀 수(운영진 집계)를 더해서 보여 준다.
// 앱에서 성사된 실제 매칭 수가 이 값 위에 쌓인다. 숫자가 틀리면 여기만 고치면 된다.
export const PRIOR_TEAMS = 14;

// 개발자 화면을 볼 수 있는 계정 (운영자). 메일은 소문자로 적는다.
export const ADMIN_EMAIL = 'rlawlals031102@kookmin.ac.kr'; // 김지민
export const ADMIN_EMAILS = [ADMIN_EMAIL, 'yunbinna6@kookmin.ac.kr', 'rmsdud06@kookmin.ac.kr', 'dlwngk@kookmin.ac.kr', 'ybfl2004@kookmin.ac.kr']; // 김지민, 나윤빈, 김근영, 이주하, 김선우

// 이메일 인증번호: 유효 시간(분), 최대 입력 시도, 재발송 간격(초)
export const EMAIL_CODE_TTL_MIN = 10;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_CODE_RESEND_SEC = 60;

// 새 가입 방식: 'phone'(전화번호 + 닉네임 + 4자리 PIN, 무인증) | 'email'(기존 국민대 메일, 이미 가입된 사람용).
// 기본 'phone' — 새 가입은 전화번호로. 기존 메일 가입자는 그대로 이메일 로그인 유지(이미 인증된 사람들이라 인증 불필요).
export const AUTH_MODE = process.env.AUTH_MODE === 'email' ? 'email' : 'phone';

// 홈 화면 시험 디데이 (지나면 자동으로 숨김)
export const EXAM = { name: '기말고사', date: '2026-12-08' };

// 시간표 칸: 09~22시를 1시간 단위로 (홈 '내 시간표'는 전체, 매칭 신청은 공부 시간 17~22시 칸만).
// 이어진 시간대를 여러 개 고를 수 있다 (예: 17:00~18:00 + 18:00~19:00 → 17:00~19:00).
export const TIME_SLOTS = Array.from({ length: 13 }, (_, i) => {
  const h = String(9 + i).padStart(2, '0');
  const h2 = String(10 + i).padStart(2, '0');
  return { start: `${h}:00`, end: `${h2}:00` };
});

// 홈 '내 시간표' 줄: 09~18시는 1시간 30분, 18~22시는 1시간 (10줄).
// 개인 일정은 이 줄 번호로 저장한다 ("요일-p번호"). 매칭·대기는 위 1시간 칸 그대로이고,
// 홈에서는 줄과 겹치는 만큼만 칠한다 (예: 17~18시 매칭 → 16:30~18:00 줄의 아래 2/3).
export const HOME_SLOTS = [
  ['09:00', '10:30'], ['10:30', '12:00'], ['12:00', '13:30'], ['13:30', '15:00'], ['15:00', '16:30'], ['16:30', '18:00'],
  ['18:00', '19:00'], ['19:00', '20:00'], ['20:00', '21:00'], ['21:00', '22:00'],
].map(([start, end]) => ({ start, end }));
// 예전 1시간 칸 번호 → 그 칸의 시작 시각이 들어 있는 홈 줄 번호 (개인 일정 옮기기용)
export const HOUR_TO_HOME = TIME_SLOTS.map((s) => HOME_SLOTS.findIndex((h) => h.start <= s.start && s.start < h.end));
