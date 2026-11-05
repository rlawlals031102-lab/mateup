// 개인정보 칸 암호화 (AES-256-GCM)와 메일 해시.
//
// 키: 환경 변수 DATA_ENCRYPTION_KEY = 32바이트를 base64로 (만들기: openssl rand -base64 32)
//   - 키가 없으면 암호화하지 않고 그대로 저장한다 (로컬·데모·테스트). 이미 암호화된 값은 키가 없으면 읽을 수 없다.
//   - 저장 모양: 'enc:v1:<iv>:<암호문>:<태그>' (base64). 앞의 v1은 나중에 키를 바꿀 때 구분하는 표시.
//   - 키를 잃어버리면 암호화된 전화번호는 되살릴 수 없다 → 키는 Vercel 환경 변수와 운영진 비밀 보관함 두 곳에 둔다.
import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';
let cached = null;

function dataKey() {
  const raw = globalThis.process?.env?.DATA_ENCRYPTION_KEY;
  if (!raw) return null;
  if (cached?.raw === raw) return cached.key;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY는 32바이트를 base64로 적은 값이어야 해요. (openssl rand -base64 32)');
  cached = { raw, key };
  return key;
}

export const encryptionOn = () => !!dataKey();
export const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);

export function encryptField(value) {
  if (value == null || value === '' || isEncrypted(value)) return value;
  const key = dataKey();
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${body.toString('base64')}:${cipher.getAuthTag().toString('base64')}`;
}

// 암호화된 값이면 풀어서, 아니면 그대로 돌려준다. 키가 없거나 맞지 않으면 null (화면에는 '확인 불가'로 보임).
export function decryptField(value) {
  if (!isEncrypted(value)) return value ?? null;
  const key = dataKey();
  if (!key) return null;
  try {
    const [iv, body, tag] = value.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    console.error(JSON.stringify({ level: 'error', msg: '암호화된 값을 풀지 못했어요 (DATA_ENCRYPTION_KEY 확인)' }));
    return null;
  }
}

// 메일 주소의 해시 (원래 주소로 되돌릴 수 없음). 탈퇴한 사람의 매칭 정지를 재가입 때 이어 갈 때 쓴다.
export const emailHash = (email) => crypto.createHash('sha256')
  .update(`studybuddy:${String(email ?? '').trim().toLowerCase()}`).digest('hex');
