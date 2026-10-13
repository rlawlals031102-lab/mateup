import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  age           INTEGER,
  tags          TEXT NOT NULL DEFAULT '[]',
  bio           TEXT NOT NULL DEFAULT '',
  avatar        TEXT NOT NULL DEFAULT '🙂',
  points        INTEGER NOT NULL DEFAULT 0,
  is_bot        INTEGER NOT NULL DEFAULT 0,
  bot_template  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_requests (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  days       TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  location   TEXT NOT NULL,
  styles     TEXT NOT NULL,
  deposit    INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | matched | cancelled
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id            INTEGER PRIMARY KEY,
  user_a        INTEGER NOT NULL REFERENCES users(id),
  user_b        INTEGER NOT NULL REFERENCES users(id),
  days          TEXT NOT NULL,
  start_time    TEXT NOT NULL,
  end_time      TEXT NOT NULL,
  location      TEXT NOT NULL,
  styles        TEXT NOT NULL,
  stake         INTEGER NOT NULL DEFAULT 0,
  week_start    TEXT NOT NULL,
  week_end      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active', -- active | reported | closed
  choice_a      TEXT,
  choice_b      TEXT,
  report        TEXT,
  prev_match_id INTEGER REFERENCES matches(id),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id         INTEGER PRIMARY KEY,
  match_id   INTEGER NOT NULL REFERENCES matches(id),
  date       TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  code       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id             INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  method         TEXT NOT NULL, -- qr | self
  checked_in_at  TEXT NOT NULL,
  checked_out_at TEXT,
  minutes        INTEGER,
  UNIQUE (appointment_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY,
  match_id   INTEGER NOT NULL REFERENCES matches(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS point_logs (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  amount     INTEGER NOT NULL,
  balance    INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  match_id   INTEGER REFERENCES matches(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON match_requests(status);
CREATE INDEX IF NOT EXISTS idx_matches_users ON matches(user_a, user_b);
CREATE INDEX IF NOT EXISTS idx_appointments_match ON appointments(match_id);
CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// 중첩 호출 시 바깥 트랜잭션에 합류한다.
let depth = 0;
export function tx(db, fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN');
  depth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}
