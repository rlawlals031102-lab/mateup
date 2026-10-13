// 브라우저용 node:sqlite 대체: sql.js(SQLite WASM) 위에 DatabaseSync API를 흉내 낸다.
// 데이터는 localStorage에 저장한다. initSqlJs 결과를 globalThis.__SQL 에 먼저 넣어 두어야 한다.

const STORAGE_KEY = 'studybuddy-standalone-db';
let current = null;

const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function loadSaved() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? fromBase64(saved) : null;
  } catch {
    return null;
  }
}

const params = (p) => p.map((v) => (v === undefined ? null : v));

export class DatabaseSync {
  constructor(file) {
    const SQL = globalThis.__SQL;
    const saved = file === ':memory:' ? null : loadSaved();
    this.db = saved ? new SQL.Database(saved) : new SQL.Database();
    current = this;
  }

  exec(sql) {
    this.db.exec(sql);
  }

  prepare(sql) {
    const { db } = this;
    const each = (p, fn) => {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params(p));
        return fn(stmt);
      } finally {
        stmt.free();
      }
    };
    return {
      get: (...p) => each(p, (s) => (s.step() ? s.getAsObject() : undefined)),
      all: (...p) => each(p, (s) => {
        const rows = [];
        while (s.step()) rows.push(s.getAsObject());
        return rows;
      }),
      run: (...p) => {
        db.run(sql, params(p));
        const changes = db.getRowsModified();
        const lastInsertRowid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        return { changes, lastInsertRowid };
      },
    };
  }
}

export function persist() {
  if (!current) return;
  try {
    localStorage.setItem(STORAGE_KEY, toBase64(current.db.export()));
  } catch (err) {
    console.warn('데이터를 저장하지 못했어요', err);
  }
  // export()가 연결을 다시 열면서 PRAGMA 설정이 초기화된다.
  current.db.exec('PRAGMA foreign_keys = ON;');
}

export function clearSaved() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 무시 */ }
}

export default { DatabaseSync };
