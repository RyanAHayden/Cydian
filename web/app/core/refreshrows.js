// F233: one row per source while a refresh runs (Sileo's async refresh in the iOS 6 look). Pure: the Sources screen
// feeds it what happens and draws what it says; node tests cover it.
//
//   const rows = refreshRows(keys)           // every key starts "waiting"
//   rows.set(key, "loading")                 // its fetch (or apt's first line for it) started: the row spins
//   rows.land(record)                        // a refreshed source record: "done" with its count, or "failed" + reason
//   rows.fail(key, reason)                   // failed before its record came (apt's Err line, live)
//   rows.get(key) -> { state, count, reason } | null      rows.counts() -> { total, done, failed, waiting, loading }
//   rows.finish()                            // the run is over: rows still waiting or loading count as done
//   stripText(rows.counts(), running)        // "Refreshing 5 of 8…" / "6 refreshed, 2 failed"
//
// States: waiting (grey "Waiting", the run hasn't reached it), loading (spinner), done (its package count),
// failed (red badge, the reason in red under its name; a tap refreshes only that source).

export const ROW = Object.freeze({ waiting: "waiting", loading: "loading", done: "done", failed: "failed" });

// The reason a refreshed record failed, or null: its own error (fetch, timeout, apt's Err via aptError).
export function failReason(record) {
  if (!record) return null;
  const e = record.error ?? null;
  return e ? String(e) : null;
}

export function refreshRows(keys = []) {
  const rows = new Map();
  for (const k of keys ?? []) if (k != null && !rows.has(k)) rows.set(k, { state: ROW.waiting, count: null, reason: null });
  let over = false;
  const put = (key, next) => {
    if (key == null) return null;
    const cur = rows.get(key) ?? { state: ROW.waiting, count: null, reason: null };
    const row = { ...cur, ...next };
    rows.set(key, row);
    return row;
  };
  return {
    has: (key) => rows.has(key),
    get: (key) => rows.get(key) ?? null,
    keys: () => [...rows.keys()],
    get over() { return over; },
    // Only forward: a row that has landed (done or failed) doesn't go back to spinning, except through retry().
    set(key, state) {
      const cur = rows.get(key);
      if (cur && (cur.state === ROW.done || cur.state === ROW.failed)) return cur;
      return put(key, { state });
    },
    fail(key, reason) { return put(key, { state: ROW.failed, reason: reason ? String(reason) : "Failed" }); },
    land(record) {
      const key = record?.key;
      if (key == null) return null;
      const reason = failReason(record);
      if (reason) return put(key, { state: ROW.failed, reason, count: numberOr(record.count) });
      // apt's Err already marked it red (live): a record without its own error doesn't turn it back
      const cur = rows.get(key);
      if (cur?.state === ROW.failed) return put(key, { count: numberOr(record.count) });
      return put(key, { state: ROW.done, reason: null, count: numberOr(record.count) });
    },
    // A tap on a failed row: it alone runs again.
    retry(key) { over = false; return put(key, { state: ROW.loading, reason: null }); },
    finish() {
      over = true;
      for (const [k, r] of rows) if (r.state === ROW.waiting || r.state === ROW.loading) rows.set(k, { ...r, state: ROW.done });
    },
    counts() {
      const c = { total: rows.size, done: 0, failed: 0, waiting: 0, loading: 0 };
      for (const r of rows.values()) c[r.state] += 1;
      return c;
    },
    failedKeys: () => [...rows].filter(([, r]) => r.state === ROW.failed).map(([k]) => k),
  };
}

const numberOr = (n) => (typeof n === "number" && Number.isFinite(n) ? n : null);

// The strip under the nav bar. While running, the source being worked on: one past those that have landed, at most
// the total ("Refreshing 5 of 8…"). Afterwards what came of it ("6 refreshed, 2 failed", "8 refreshed").
export function stripText(counts, running) {
  const total = counts?.total ?? 0;
  const done = counts?.done ?? 0;
  const failed = counts?.failed ?? 0;
  if (running) return `Refreshing ${Math.min(total, done + failed + 1)} of ${total}…`;
  return failed ? `${done} refreshed, ${failed} failed` : `${done} refreshed`;
}

// The Sources tab's badge: a spinner while a refresh runs, then how many sources failed (none: no badge).
export function tabBadge(counts, running) {
  if (running) return "spinner";
  return counts?.failed ? counts.failed : null;
}

// Runs `fn` (the catalog load, so a landed source's packages reach Changes and Search) at most once at a time: a call
// while it runs asks for one more run after it, however many calls came. Resolves when the run that covers this call
// has ended.
export function coalesce(fn) {
  let running = null;
  let again = false;
  const loop = async () => {
    try {
      do {
        again = false;
        try { await fn(); } catch { /* a failed load is retried by the next call */ }
      } while (again);
    } finally {
      running = null;
    }
  };
  return () => {
    if (running) { again = true; return running; }
    running = loop();
    return running;
  };
}
