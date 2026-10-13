// 날짜/시간 유틸. 날짜는 'YYYY-MM-DD', 시간은 'HH:MM' 문자열로 다룬다.
// 서버가 어느 시간대에서 돌든(Vercel은 UTC) 한국 시간(KST, UTC+9) 기준으로 계산한다.
// 테스트에서 시간을 고정할 수 있도록 now()를 통해서만 현재 시각을 얻는다.

const KST_OFFSET = 9 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

let override = null;

export const setNow = (d) => { override = d ? new Date(d) : null; };
export const now = () => (override ? new Date(override) : new Date());

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD'를 그 날짜의 UTC 자정 타임스탬프로 (날짜 계산용)
const utcMidnight = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtcMidnight = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

// 실제 시각 → 한국 날짜
export const dateStr = (d) => fromUtcMidnight(d.getTime() + KST_OFFSET);
export const today = () => dateStr(now());

export const addDays = (s, n) => fromUtcMidnight(utcMidnight(s) + n * DAY);

// 1=월 ... 7=일
export const isoWeekday = (s) => {
  const w = new Date(utcMidnight(s)).getUTCDay();
  return w === 0 ? 7 : w;
};

export const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

// 한국 날짜 + 'HH:MM' → 실제 시각 ('24:00'은 다음날 0시)
export const at = (date, time) => new Date(utcMidnight(date) + toMin(time) * 60000 - KST_OFFSET);

// 테스트·스크립트용: 한국 시간으로 시각 만들기
export const kst = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min) - KST_OFFSET);
