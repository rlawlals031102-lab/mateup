// 테스트용 고정 스터디 기간: 2026-11-17(화) ~ 11-19(목) 19:00~21:00.
// 실서비스는 '오늘부터 7일, 매일 17~22시'로 저절로 넘어가지만(server/options.js STUDY_PERIOD),
// 매칭·출석·정산 흐름 테스트는 날짜가 고정돼야 해서 다른 import 보다 먼저 이 파일을 불러 기간을 고정한다.
// (매일 일정 자체는 test/schedule.test.js 에서 확인)
import { STUDY_PERIOD } from '../server/options.js';

export const FIXED_DATES = ['2026-11-17', '2026-11-18', '2026-11-19'];
Object.defineProperty(STUDY_PERIOD, 'dates', { value: FIXED_DATES, writable: true, configurable: true });
STUDY_PERIOD.start = '19:00';
STUDY_PERIOD.end = '21:00';
