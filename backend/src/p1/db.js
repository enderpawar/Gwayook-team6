import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrations = [new URL('./001-initial.sql', import.meta.url)];

export class P1Error extends Error {
  constructor(status, code, fields) {
    super(code);
    this.status = status;
    this.fields = fields;
  }
}

export function transaction(db, operation, { readOnly = false } = {}) {
  db.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
  try {
    const result = operation(db);
    if (typeof result?.then === 'function') throw new TypeError('SQLite transaction callback must be synchronous');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export function openP1Database(path) {
  if (typeof path !== 'string' || !path.trim() || path === ':memory:' || /^file:/i.test(path)) {
    throw new TypeError('P1_DB_PATH must be a local SQLite file path');
  }
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(resolve(path));
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
    transaction(db, () => {
      const { user_version: version } = db.prepare('PRAGMA user_version').get();
      if (version > migrations.length) throw new Error('Unsupported P1 SQLite schema version');
      if (version === 0 && db.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' LIMIT 1").get()) {
        throw new Error('Refusing to initialize a nonempty unversioned SQLite database');
      }
      for (let i = version; i < migrations.length; i++) {
        db.exec(readFileSync(migrations[i], 'utf8'));
        db.exec(`PRAGMA user_version = ${i + 1}`);
      }
    });
  } catch (error) {
    db.close();
    throw error;
  }
  return { db, transaction: (operation, options) => transaction(db, operation, options), close: () => db.close() };
}
