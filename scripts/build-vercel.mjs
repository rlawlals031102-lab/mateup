// Vercel 배포용 정적 파일 만들기 → www/
//   www/          실서비스 화면 (public/ 복사, API는 api/index.js 함수가 처리)
//   www/demo/     서버 없이 도는 데모 버전 (데모 메이트와 체험)
import { cp, rm, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'www');

await import('./build-standalone.mjs');

await rm(OUT, { recursive: true, force: true });
await cp(path.join(ROOT, 'public'), OUT, { recursive: true });
await mkdir(path.join(OUT, 'demo'), { recursive: true });
await copyFile(path.join(ROOT, 'dist', 'index.html'), path.join(OUT, 'demo', 'index.html'));
console.log('만들었어요 → www/ (실서비스 화면) + www/demo/ (데모)');
