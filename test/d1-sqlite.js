// Test stand-in for Cloudflare D1, backed by bun:sqlite, built from the REAL migration files (migrations/*.sql, in order). Same prepare/bind/run/all/first shape.
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
export function makeD1() {
  const raw = new Database(":memory:");
  const dir = join(import.meta.dir, "..", "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) raw.exec(readFileSync(join(dir, f), "utf8"));
  const stmt = (sql, vals = []) => ({
    bind: (...v) => stmt(sql, v),
    run: async () => { const r = raw.query(sql).run(...vals); return { meta: { changes: r.changes } }; },
    all: async () => ({ results: raw.query(sql).all(...vals) }),
    first: async () => raw.query(sql).get(...vals) ?? null,
  });
  return { db: { prepare: (s) => stmt(s), batch: async (xs) => Promise.all(xs.map((x) => x.run())) }, raw };
}
