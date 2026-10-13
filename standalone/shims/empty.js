// 브라우저에서 쓰이지 않는 node:fs / node:path 자리 채우기
export const mkdirSync = () => {};
export const dirname = () => '';
export const join = (...p) => p.join('/');
export default { mkdirSync, dirname, join };
