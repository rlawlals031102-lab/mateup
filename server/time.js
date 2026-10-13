// 날짜/시간 유틸. 날짜는 로컬 기준 'YYYY-MM-DD', 시간은 'HH:MM' 문자열로 다룬다.
// 테스트에서 시간을 고정할 수 있도록 now()를 통해서만 현재 시각을 얻는다.

let override = null;

export const setNow = (d) => { override = d ? new Date(d) : null; };
export const now = () => (override ? new Date(override) : new Date());

const pad = (n) => String(n).padStart(2, '0');

export const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dateStr(now());

const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
};

// 1=월 ... 7=일
export const isoWeekday = (s) => {
  const w = parseDate(s).getDay();
  return w === 0 ? 7 : w;
};

export const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

// 날짜 + 'HH:MM' → Date ('24:00'은 다음날 0시)
export const at = (date, time) => {
  const d = parseDate(date);
  d.setMinutes(toMin(time));
  return d;
};
