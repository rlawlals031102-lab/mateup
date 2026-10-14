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
