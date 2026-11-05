export const LOCATIONS = [
  '채팅으로 정하기',
  '지정 강의실 (경상관 102A)',
];

// 스터디 기간: 정해진 날짜·시간에만 약속을 잡는다 (매칭 신청에서는 이 중 원하는 날짜만 고름)
// 회차를 바꿀 때는 dates 만 다음 주 화·수·목으로 바꾸고 다시 배포한다.
// 신청할 때는 날짜마다 18~21시 중 1시간 칸(18–19, 19–20, 20–21)을 여러 개 고른다.
export const STUDY_PERIOD = {
  dates: ['2026-11-10', '2026-11-11', '2026-11-12'], // 화·수·목
  start: '18:00',
  end: '21:00',
  // 날짜별로 시간을 다르게 할 날이 있으면: times: { 'YYYY-MM-DD': { start, end, label } }
};

export const STYLES = {
  check: { label: '체크형', desc: '쿨한 출석체크, 무소음 초집중' },
  talk: { label: '대화형', desc: '가벼운 티타임, 긍정 에너지 공유' },
  social: { label: '사교형', desc: '공부 후 식사, 네트워크' },
};

// 약속 시작 몇 분 전부터 출석할 수 있는지
export const CHECKIN_EARLY_MIN = 30;

export const MIN_OVERLAP_MIN = 60;

// 실서비스 가입·로그인을 허용하는 학교 메일 도메인 (데모 모드에서는 제한 없음)
export const EMAIL_DOMAIN = 'kookmin.ac.kr';

// 운영자 계정 (운영자 화면 전체: 현황·돈·메일·채팅). 메일은 소문자로 적는다.
// Vercel 환경 변수 ADMIN_EMAILS 에 적은 메일도 운영자가 된다.
export const ADMIN_ACCOUNTS = [
  'rlawlals031102@kookmin.ac.kr', // 김지민
  'yunbinna6@kookmin.ac.kr', // 나윤빈
];

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

// 약속 보증금 (계좌이체). 운영진 계좌(환경 변수 DEPOSIT_ACCOUNT)가 설정돼 있을 때만 신청 화면에 보인다.
// 운영진이 입금을 확인하면 매칭 대기열에 들어가고, 주간이 끝나면 앱이 계산한 금액을 운영진이 직접 이체한다.
export const DEPOSIT_OPTIONS = [5000, 10000, 20000];

// 사진: 화면에서 줄여서(긴 변 1280px, JPEG) 올리고, 서버는 이 크기까지만 받는다.
export const PHOTO_MAX_BYTES = 1_200_000;
