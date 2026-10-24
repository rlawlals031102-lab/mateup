export const LOCATIONS = [
  '국민대 성곡도서관',
  '북악관 1층 라운지',
  '복지관 3층 열람실',
  '경영관 3층 라운지',
  '정릉 근처 카페',
];

export const STYLES = {
  check: { label: '체크형', desc: '쿨한 출석체크, 무소음 초집중' },
  talk: { label: '대화형', desc: '가벼운 티타임, 긍정 에너지 공유' },
  social: { label: '사교형', desc: '공부 후 식사, 네트워크' },
};

export const DEPOSITS = [5000, 10000, 20000];

// 가입 시 지급되는 가상 포인트 (보증금 예치에 사용)
export const SIGNUP_POINTS = 50000;

// 약속 시작 몇 분 전부터 출석할 수 있는지
export const CHECKIN_EARLY_MIN = 30;

export const MIN_OVERLAP_MIN = 60;

// 실서비스 가입·로그인을 허용하는 학교 메일 도메인 (데모 모드에서는 제한 없음)
export const EMAIL_DOMAIN = 'kookmin.ac.kr';

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
