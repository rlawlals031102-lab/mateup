// Vercel 배포용 정적 파일 만들기 → www/ (실서비스 화면, public/ 복사)
// API는 api/index.js 함수가 처리한다.
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'www');

await rm(OUT, { recursive: true, force: true });
await cp(path.join(ROOT, 'public'), OUT, { recursive: true });
console.log('만들었어요 → www/ (실서비스 화면)');
