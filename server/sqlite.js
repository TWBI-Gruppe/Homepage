import { DatabaseSync } from 'node:sqlite';

// Driver for node:sqlite (local server, Docker).
export function sqliteDriver(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return {
    exec: async (statements) => statements.forEach((statement) => db.exec(statement)),
    all: async (query, ...params) => db.prepare(query).all(...params),
    first: async (query, ...params) => db.prepare(query).get(...params) ?? null,
    run: async (query, ...params) => {
      const result = db.prepare(query).run(...params);
      return { changes: Number(result.changes), lastRowId: Number(result.lastInsertRowid) };
    },
    close: () => db.close(),
  };
}
