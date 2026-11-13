// public/ics.js (약속 → 캘린더 .ics) 단위 테스트. 브라우저 없이 문자열만 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, toIcsLocal, icsEscape } from '../public/ics.js';

const APPTS = [
  { id: 11, date: '2026-11-10', startTime: '09:00', endTime: '11:00', location: '성곡도서관 2층' },
  { id: 12, date: '2026-11-12', startTime: '14:00', endTime: '16:00', location: '성곡도서관 2층' },
];
const NOW = '2026-11-09T01:00:00.000Z';

test('toIcsLocal: KST 로컬 시각 포맷, 24:00은 다음날 0시', () => {
  assert.equal(toIcsLocal('2026-11-10', '09:00'), '20261110T090000');
  assert.equal(toIcsLocal('2026-11-10', '24:00'), '20261111T000000');
  assert.equal(toIcsLocal('2026-12-31', '24:00'), '20270101T000000'); // 연말 넘김
});

test('icsEscape: 쉼표·세미콜론·역슬래시·줄바꿈', () => {
  assert.equal(icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('buildCalendar: 약속이 없으면 빈 문자열', () => {
  assert.equal(buildCalendar([], { mateName: '라마바' }), '');
  assert.equal(buildCalendar(null, { mateName: '라마바' }), '');
});

test('buildCalendar: VCALENDAR/VTIMEZONE 뼈대와 약속당 VEVENT', () => {
  const ics = buildCalendar(APPTS, { mateName: '라마바', now: NOW });
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR$/);
  assert.match(ics, /BEGIN:VTIMEZONE[\s\S]*TZID:Asia\/Seoul[\s\S]*TZOFFSETTO:\+0900[\s\S]*END:VTIMEZONE/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.equal((ics.match(/END:VEVENT/g) || []).length, 2);
  // 줄 끝은 CRLF
  assert.ok(ics.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'LF 단독 줄바꿈이 있으면 안 됨');
});

test('buildCalendar: DTSTART/DTEND는 Asia/Seoul TZID + KST 로컬 시각', () => {
  const ics = buildCalendar(APPTS, { mateName: '라마바', now: NOW });
  assert.match(ics, /DTSTART;TZID=Asia\/Seoul:20261110T090000/);
  assert.match(ics, /DTEND;TZID=Asia\/Seoul:20261110T110000/);
  assert.match(ics, /DTSTART;TZID=Asia\/Seoul:20261112T140000/);
});

test('buildCalendar: 메이트 이름이 제목에, 장소/알림/고정 UID 포함', () => {
  const ics = buildCalendar(APPTS, { mateName: '라마바', now: NOW });
  assert.match(ics, /SUMMARY:스터디버디 · 라마바님과 공부/);
  assert.match(ics, /LOCATION:성곡도서관 2층/);
  assert.match(ics, /BEGIN:VALARM[\s\S]*TRIGGER:-PT30M[\s\S]*END:VALARM/);
  assert.match(ics, /UID:studybuddy-appt-11@mateup/);
  assert.match(ics, /UID:studybuddy-appt-12@mateup/);
  // DTSTAMP는 넘긴 now(UTC) 기준으로 고정
  assert.match(ics, /DTSTAMP:20261109T010000Z/);
});

test('buildCalendar: 장소의 쉼표는 이스케이프된다', () => {
  const ics = buildCalendar([{ id: 1, date: '2026-11-10', startTime: '09:00', endTime: '11:00', location: '북악관, 3층' }], { mateName: '가나다', now: NOW });
  assert.match(ics, /LOCATION:북악관\\, 3층/);
});

test('buildCalendar: 날짜/시간 빠진 약속은 건너뛴다', () => {
  const ics = buildCalendar([{ id: 1, date: '2026-11-10', startTime: '', endTime: '11:00' }, APPTS[0]], { mateName: '가나다', now: NOW });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});
