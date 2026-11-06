// 백업 복구 연습: 백업 파일을 메모리 속 PostgreSQL(PGlite)에 넣어 보고, 표마다 행 수가 같은지 확인한다.
// 실서비스 DB는 건드리지 않는다. 분기(학기)마다 한 번은 해 보기를 권장 (docs/operations-guide.md).
//
//   npm run restore:check -- backups/backup-20261106-0930.json
import { readFile } from 'node:fs/promises';
import { openPglite } from '../server/db-pg.js';

const file = process.argv[2];
if (!file) {
  console.error('백업 파일을 알려 주세요. 예) npm run restore:check -- backups/backup-20261106-0930.json');
  process.exit(1);
}

const { createdAt, tables } = JSON.parse(await readFile(file, 'utf8'));
const db = await openPglite(); // 지금 코드의 DB 구조로 빈 DB를 만든다
const quote = (n) => `"${String(n).replace(/"/g, '')}"`;
let ok = true;
await db.tx(async (t) => {
  await t.exec('SET session_replication_role = replica'); // 표 사이 참조 확인을 잠시 끄고 순서와 상관없이 넣는다
  for (const [name, rows] of Object.entries(tables)) {
    const exists = await t.get("SELECT 1 AS x FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?", name);
    if (!exists) {
      console.log(`  ${name}: 지금 코드에는 없는 표라 건너뜀 (${rows.length}행)`);
      continue;
    }
    for (const row of rows) {
      const cols = Object.keys(row);
      await t.run(
        `INSERT INTO ${quote(name)} (${cols.map(quote).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`,
        ...cols.map((c) => row[c]),
      );
    }
  }
  await t.exec('SET session_replication_role = DEFAULT');
});
console.log(`백업 시각: ${createdAt}`);
for (const [name, rows] of Object.entries(tables)) {
  if (name === 'schema_migrations') continue; // 새 DB가 이미 가지고 있음
  const exists = await db.get("SELECT 1 AS x FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?", name);
  if (!exists) continue;
  const n = Number((await db.get(`SELECT COUNT(*) AS n FROM ${quote(name)}`)).n);
  const same = n === rows.length;
  ok &&= same;
  console.log(`  ${same ? '같음' : '다름'}  ${name}: 백업 ${rows.length}행 → 복구 ${n}행`);
}
await db.close();
console.log(ok ? '복구 연습 성공: 모든 표의 행 수가 같아요.' : '복구 연습 실패: 행 수가 다른 표가 있어요.');
process.exit(ok ? 0 : 1);
