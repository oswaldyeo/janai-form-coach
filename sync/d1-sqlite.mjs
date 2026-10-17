// Test-only D1 stand-in backed by node:sqlite (Node ≥ 22.5). Implements the
// slice of the D1 binding the Worker uses: prepare().bind().first/all/run and
// a transactional batch(). Runs the real schema.sql, so tests exercise the
// actual SQL rather than a mock.

import { readFileSync } from 'node:fs';

export async function createD1() {
  let sqlite;
  try { sqlite = await import('node:sqlite'); } catch { return null; }
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    _exec() { return db.prepare(sql).run(...args); },
    async first(col) {
      const row = db.prepare(sql).get(...args);
      if (!row) return null;
      return col ? row[col] : { ...row };
    },
    async all() { return { results: db.prepare(sql).all(...args).map((r) => ({ ...r })), success: true }; },
    async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  });

  return {
    raw: db,
    prepare: (sql) => wrap(sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => { const r = s._exec(); return { success: true, meta: { changes: Number(r.changes) } }; });
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
