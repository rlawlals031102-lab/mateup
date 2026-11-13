export const LOCATIONS = [
  '채팅으로 정하기',
  '지정 강의실 (미래관 320호)',
];

// 스터디 기간: 정해진 날짜·시간에만 약속을 잡는다 (매칭 신청에서는 이 중 원하는 날짜만 고름)
export const STUDY_PERIOD = {
  dates: ['2026-11-17', '2026-11-18', '2026-11-19'], // 화·수·목
  start: '19:00',
  end: '21:00',
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
export const ADMIN_EMAILS = [ADMIN_EMAIL, 'yunbinna6@kookmin.ac.kr']; // 김지민, 나윤빈

// 이메일 인증번호: 유효 시간(분), 최대 입력 시도, 재발송 간격(초)
export const EMAIL_CODE_TTL_MIN = 10;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_CODE_RESEND_SEC = 60;

// 홈 화면 시험 디데이 (지나면 자동으로 숨김)
export const EXAM = { name: '기말고사', date: '2026-12-08' };

// 매칭 신청에서 고를 수 있는 시간대. 낮(09~18시)은 1시간 30분, 저녁(18~24시)은 1시간 단위.
// 이어진 시간대를 여러 개 고를 수 있다 (예: 19:00~20:00 + 20:00~21:00 → 19:00~21:00).
export const TIME_SLOTS = [
  ['09:00', '10:30'], ['10:30', '12:00'], ['12:00', '13:30'], ['13:30', '15:00'], ['15:00', '16:30'], ['16:30', '18:00'],
  ['18:00', '19:00'], ['19:00', '20:00'], ['20:00', '21:00'], ['21:00', '22:00'], ['22:00', '23:00'], ['23:00', '24:00'],
].map(([start, end]) => ({ start, end }));
