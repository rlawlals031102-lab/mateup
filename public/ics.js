// 약속을 캘린더(.ics)로 내보내기. 서버 없이 화면에서 바로 만든다(단독 실행 데모에서도 동작).
// 시간은 한국시간(KST, UTC+9). Asia/Seoul VTIMEZONE을 넣어 어느 기기에서 열어도 같은 시각으로 보인다.
// 브라우저(public/app.js)와 Node 테스트(test/ics.test.js) 양쪽에서 import 한다 → DOM·브라우저 전용 API는 쓰지 않는다.

const SITE = 'https://mateup-gamma.vercel.app';

// .ics 텍스트 이스케이프 (RFC 5545): \ ; , 과 줄바꿈
export const icsEscape = (s) => String(s)
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

// 'YYYY-MM-DD' 다음 날 (end_time '24:00' 처리용)
const nextDay = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

// 'YYYY-MM-DD' + 'HH:MM' → '20261110T090000' (로컬=KST). '24:00'은 다음날 0시로.
export const toIcsLocal = (date, time) => {
  if (time === '24:00') { date = nextDay(date); time = '00:00'; }
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
};

// 지금 시각(UTC) → DTSTAMP 'YYYYMMDDTHHMMSSZ'
const stampNow = (now = new Date()) =>
  now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// RFC 5545 줄 접기: 한 줄은 75 옥텟까지. 넘으면 CRLF + 공백으로 이어 쓴다.
// 한글은 UTF-8에서 3바이트라, 글자 경계에서만 잘라 깨지지 않게 한다.
const enc = new TextEncoder();
const fold = (line) => {
  let out = '';
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 73) { // 이어지는 줄의 앞 공백까지 생각해 넉넉히 73
      out += (out ? '\r\n ' : '') + cur;
      cur = ch;
      bytes = b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  return out + (out ? '\r\n ' : '') + cur;
};

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul',
  'BEGIN:STANDARD', 'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD',
  'END:VTIMEZONE',
];

// appointments: [{ id, date, startTime, endTime, location }]
// opts: { mateName, now }  (now는 DTSTAMP 고정용 — 테스트에서만)
// 돌려주는 값: .ics 문자열 (약속이 없으면 '')
export function buildCalendar(appointments, { mateName = '메이트', now } = {}) {
  const list = (appointments || []).filter((a) => a && a.date && a.startTime && a.endTime);
  if (!list.length) return '';
  const stamp = stampNow(now ? new Date(now) : undefined);
  const summary = `스터디버디 · ${mateName}님과 공부`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StudyBuddy//KR//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
  ];
  for (const a of list) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:studybuddy-appt-${a.id}@mateup`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Seoul:${toIcsLocal(a.date, a.startTime)}`,
      `DTEND;TZID=Asia/Seoul:${toIcsLocal(a.date, a.endTime)}`,
      `SUMMARY:${icsEscape(summary)}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
    );
    if (a.location) lines.push(`LOCATION:${icsEscape(a.location)}`);
    lines.push(`DESCRIPTION:${icsEscape(`${mateName}님과 함께 공부하는 날이에요. 약속한 날 꼭 나와 주세요.\n앱에서 보기: ${SITE}`)}`);
    // 시작 30분 전 알림
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(summary)}`, 'TRIGGER:-PT30M', 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n');
}
