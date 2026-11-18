// F182: the part of Cloudflare D1's API src/reviews.js uses, over Node's built-in SQLite (node:sqlite, Node 22.5+),
// for worker/test.mjs and anyone running worker/node.mjs who wants reviews: d1(":memory:") or d1("reviews.db").
// Node only: the Worker never imports this.
//   db.prepare(sql).bind(...values) -> { first(), all() -> {results}, run() -> {meta: {changes}} }
//   db.batch([stmt]) -> [ {results, meta} ], in one transaction
// SPDX-License-Identifier: GPL-3.0-or-later
import { DatabaseSync } from "node:sqlite";

export function d1(path = ":memory:") {
  const sql = new DatabaseSync(path);
  const plain = (row) => (row ? { ...row } : null);
  const stmt = (text, values = []) => ({
    bind: (...v) => stmt(text, v),
    async first() { return plain(sql.prepare(text).get(...values)); },
    async all() { return this.raw(); },
    async run() { return this.raw(); },
    raw() {
      const s = sql.prepare(text);
      if (/^\s*(select|with)\b/i.test(text)) return { results: s.all(...values).map(plain), meta: { changes: 0 } };
      const r = s.run(...values);
      return { results: [], meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (text) => stmt(text),
    async batch(list) {
      sql.exec("BEGIN");
      try {
        const out = list.map((s) => s.raw());
        sql.exec("COMMIT");
        return out;
      } catch (e) { sql.exec("ROLLBACK"); throw e; }
    },
    close: () => sql.close(),
  };
}
