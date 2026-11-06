// DB 백업: 모든 표를 JSON 파일 하나로 → backups/backup-YYYYMMDD-HHmm.json
//
//   npm run backup          (.env.local 의 DATABASE_URL = 실서비스 DB 주소)
//
// 개인정보가 들어 있다: 저장소에 올리지 말고(backups/ 는 .gitignore), 운영진만 보는 곳에 보관하고 30일 뒤 지운다.
// 백업이 제대로 됐는지는 npm run restore:check -- <파일> 로 확인한다 (실서비스 DB는 건드리지 않음).
// DB 구조는 바꾸지 않는다 (migrate: false).
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPg } from '../server/db-pg.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL이 없어요. .env.local 에 실서비스 DB 주소를 넣고 다시 실행해 주세요.');
  process.exit(1);
}

const db = await openPg(url, { migrate: false });
try {
  const tables = (await db.all(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  )).map((r) => r.name);
  const data = {};
  for (const t of tables) data[t] = await db.all(`SELECT * FROM "${t.replace(/"/g, '')}"`);
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  await mkdir(path.join(ROOT, 'backups'), { recursive: true });
  const file = path.join(ROOT, 'backups', `backup-${now}.json`);
  await writeFile(file, JSON.stringify({ createdAt: new Date().toISOString(), tables: data }), { mode: 0o600 });
  console.log(`백업했어요 → ${path.relative(ROOT, file)}`);
  for (const t of tables) console.log(`  ${t}: ${data[t].length}행`);
} finally {
  await db.close();
}
