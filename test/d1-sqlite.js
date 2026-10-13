// Test stand-in for Cloudflare D1, backed by bun:sqlite, built from the REAL migration file (migrations/0001_ledger_c.sql). Same prepare/bind/run/all/first shape.
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
export function makeD1() {
  const raw = new Database(":memory:");
  raw.exec(readFileSync(join(import.meta.dir, "..", "migrations", "0001_ledger_c.sql"), "utf8"));
  const stmt = (sql, vals = []) => ({
    bind: (...v) => stmt(sql, v),
    run: async () => { const r = raw.query(sql).run(...vals); return { meta: { changes: r.changes } }; },
    all: async () => ({ results: raw.query(sql).all(...vals) }),
    first: async () => raw.query(sql).get(...vals) ?? null,
  });
  return { db: { prepare: (s) => stmt(s), batch: async (xs) => Promise.all(xs.map((x) => x.run())) }, raw };
}
