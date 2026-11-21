// 단독 데모 전용: 스터디 날짜를 "파일을 연 날 기준 어제·오늘·내일"로 바꾼다.
// 실서비스(server/options.js)의 날짜는 오늘부터 7일로 넘어가지만, 데모 파일은 어제부터 체험할 수 있게 여기서만 바꾼다.
// mock-server.js 맨 처음에 import 해야 한다 (server/seed.js 가 불러올 때 날짜로 데모 메이트를 만들기 때문).
import { STUDY_PERIOD } from '../server/options.js';
import * as T from '../server/time.js';

const today = T.today();
// (실서비스의 dates 는 '오늘부터 7일'을 계산하는 getter 라서, 값으로 덮어쓴다)
Object.defineProperty(STUDY_PERIOD, 'dates', { value: [T.addDays(today, -1), today, T.addDays(today, 1)], writable: true, configurable: true });
delete STUDY_PERIOD.times; // 날짜별로 시간을 다르게 둔 설정이 있으면 지운다 (데모는 모든 날 같은 시간)
