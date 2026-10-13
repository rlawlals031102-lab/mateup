// 서버 없이 더블클릭으로 열 수 있는 HTML 파일 하나를 만든다 → dist/studybuddy-demo.html
// 서버 로직(server/service.js)과 SQLite(WASM), 화면(public/)을 모두 한 파일에 담는다.

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shim = (name) => path.join(ROOT, 'standalone', 'shims', name);

const nodeShims = {
  name: 'node-shims',
  setup(b) {
    b.onResolve({ filter: /^(node:)?crypto$/ }, () => ({ path: shim('crypto.js') }));
    b.onResolve({ filter: /^node:sqlite$/ }, () => ({ path: shim('sqlite.js') }));
    b.onResolve({ filter: /^(node:)?(fs|path)$/ }, () => ({ path: shim('empty.js') }));
  },
};

const result = await build({
  entryPoints: [path.join(ROOT, 'standalone', 'mock-server.js')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  loader: { '.wasm': 'binary' },
  plugins: [nodeShims],
  logLevel: 'warning',
});

const read = (p) => readFile(path.join(ROOT, p), 'utf8');
const [html, css, app, icon, logo] = await Promise.all([
  read('public/index.html'),
  read('public/styles.css'),
  read('public/app.js'),
  readFile(path.join(ROOT, 'public', 'logo.webp')), // 정사각형 원본 → 탭 아이콘
  readFile(path.join(ROOT, 'public', 'logo.png')), // 한 줄 로고 → 화면
]);

const iconUri = `data:image/webp;base64,${icon.toString('base64')}`;
const logoUri = `data:image/png;base64,${logo.toString('base64')}`;
const safeScript = (js) => js.replace(/<\/script/gi, '<\\/script');

// String.replace의 $ 치환 패턴을 피하려고 모두 함수로 넘긴다.
const out = html
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace(
    '<script type="module" src="app.js"></script>',
    () => `<script>\n${safeScript(result.outputFiles[0].text)}\n</script>\n<script type="module">\n${safeScript(app)}\n</script>`,
  )
  .replaceAll('logo.webp', () => iconUri)
  .replaceAll('logo.png', () => logoUri);

if (out.includes('src="app.js"') || out.includes('href="styles.css"')) {
  throw new Error('index.html 구조가 바뀌어 인라인에 실패했습니다.');
}

await mkdir(path.join(ROOT, 'dist'), { recursive: true });
const file = path.join(ROOT, 'dist', 'studybuddy-demo.html');
await writeFile(file, out);
// 웹에 올릴 때(Vercel 등) 첫 페이지로 쓰이도록 같은 내용을 index.html로도 둔다.
await writeFile(path.join(ROOT, 'dist', 'index.html'), out);
console.log(`만들었어요 → ${path.relative(ROOT, file)} (+ dist/index.html) (${(out.length / 1024).toFixed(0)} KB)`);
