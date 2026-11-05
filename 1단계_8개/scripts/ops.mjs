// 운영 도구 — DB를 직접 고치지 않고 정해진 작업만 한다. 정지 해제 같은 변경은 운영 기록(admin_logs)에 남는다.
//
//   npm run ops -- status                   가입자·대기 신청·진행 중 매칭·정지 중 인원·매일 작업 상태
//   npm run ops -- user <메일>              그 사람의 약속 기록·정지 상태
//   npm run ops -- unsuspend <메일>         매칭 정지 풀기 (약속 기록도 0번부터)
//   npm run ops -- cancel-requests <메일>   대기 중인 매칭 신청 모두 취소
//
// 필요: .env.local 의 DATABASE_URL(실서비스 DB), OPERATOR_EMAIL(실행하는 운영자의 학교 메일 — 기록에 남음)
// DB 구조는 바꾸지 않는다 (migrate: false).
import { openPg } from '../server/db-pg.js';
import * as S from '../server/service.js';
import { unsuspend, logAdmin } from '../server/admin.js';
import { health } from '../server/ops.js';

const [cmd, arg] = process.argv.slice(2);
const HELP = '사용법: npm run ops -- status | user <메일> | unsuspend <메일> | cancel-requests <메일>';
if (!cmd) {
  console.log(HELP);
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL이 없어요. .env.local 에 실서비스 DB 주소를 넣어 주세요.');
  process.exit(1);
}

const db = await openPg(process.env.DATABASE_URL, { migrate: false });
const findUser = async (email) => {
  const u = await db.get('SELECT * FROM users WHERE email = ? AND is_bot = 0', String(email ?? '').trim().toLowerCase());
  if (!u) throw new Error(`가입한 사람을 찾을 수 없어요: ${email}`);
  return u;
};
const operator = async () => {
  const u = await findUser(process.env.OPERATOR_EMAIL ?? '');
  if (!S.privateUser(u).isAdmin) throw new Error('OPERATOR_EMAIL 이 운영자 계정이 아니에요 (server/options.js ADMIN_EMAILS).');
  return u;
};

try {
  if (cmd === 'status') {
    const n = async (sql) => Number((await db.get(sql)).n);
    console.log({
      가입자: await n("SELECT COUNT(*) AS n FROM users WHERE is_bot = 0 AND deleted_at IS NULL AND email NOT LIKE '%@studybuddy.local'"),
      대기신청: await n("SELECT COUNT(*) AS n FROM match_requests WHERE status = 'pending'"),
      진행중매칭: await n("SELECT COUNT(*) AS n FROM matches WHERE status = 'active'"),
      정지중: await n(`SELECT COUNT(*) AS n FROM users WHERE suspended_until > '${new Date().toISOString()}'`),
      열린신고: await n("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      상태확인: await health(db),
    });
  } else if (cmd === 'user') {
    const u = await findUser(arg);
    console.log({ 이름: u.name, 약속기록: await S.strikeStatus(db, u.id) });
  } else if (cmd === 'unsuspend') {
    const op = await operator();
    const u = await findUser(arg);
    await unsuspend(db, op.id, u.id);
    console.log(`${u.name}님의 매칭 정지를 풀었어요. (기록: ${op.name})`);
  } else if (cmd === 'cancel-requests') {
    const op = await operator();
    const u = await findUser(arg);
    const { changes } = await db.run("UPDATE match_requests SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'", u.id);
    await logAdmin(db, op.id, 'cancel_requests', `user:${u.id}`);
    console.log(`${u.name}님의 대기 신청 ${changes}건을 취소했어요.`);
  } else {
    console.log(HELP);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
