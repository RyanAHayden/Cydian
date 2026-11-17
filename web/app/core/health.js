// Repo health (F19): when a source last answered, when its Release was last dated, and whether it is answering now.
// Pure JS, no DOM, so node tests cover it. core/sources.js writes the fields on every refresh; the Sources tab and
// a source's page read them through healthOf.
//
//   healthOf(source, now)       -> { state, reachedAt, releaseDate, failures, label }
//                                  state: "unknown" (never refreshed) | "ok" | "quiet" (no new Release for a year)
//                                       | "down" (the last refresh failed: Cydian's "Not Responding")
//   healthFields(prev, result)  -> the record fields after a refresh (reachedAt, failures), from the last record
//   releaseTime(release)        -> the Release's Date: as ms since 1970, or null
//   fingerprint(text)           -> a short hash of a Release text: the same Release means the same Packages
//   withTimeout(promise, ms)    -> the promise, or a TimeoutError after ms (the work itself goes on unawaited)
//   pool(items, n, f)           -> f over every item, at most n at once, results in order
//   validatorCache(opts)        -> ETag/Last-Modified memory for conditional GETs (backend-http.js text())
//
// Record fields: { updated, error, reachedAt?, releaseDate?, releaseHash?, countArch?, failures? }. `updated` is the
// last try (as before F19), `reachedAt` the last try the repo answered.

export const QUIET_AFTER = 365 * 24 * 3600 * 1000; // no new Release for a year: still up, but nobody updates it
export const REFRESH_TIMEOUT = 20_000;             // per repo: one dead host can't hold Refresh longer than this
export const REFRESH_CONCURRENCY = 8;              // hundreds of repos go through in waves, not all at once

const DAY = 24 * 3600 * 1000;

// "today", "yesterday", "3 days ago", "5 months ago", "2 years ago".
export function ago(ms, now = Date.now()) {
  const d = Math.floor((now - ms) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 60) return `${d} days ago`;
  const m = Math.floor(d / 30.44);
  if (m < 24) return `${m} months ago`;
  return `${Math.floor(d / 365.25)} years ago`;
}

export function healthOf(source, now = Date.now()) {
  const s = source ?? {};
  const reachedAt = typeof s.reachedAt === "number" ? s.reachedAt : (s.updated != null && !s.error ? s.updated : null);
  const releaseDate = typeof s.releaseDate === "number" ? s.releaseDate : null;
  const failures = s.failures ?? (s.error ? 1 : 0);
  let state;
  if (s.error) state = "down";
  else if (s.updated == null) state = "unknown";
  else if (releaseDate != null && now - releaseDate > QUIET_AFTER) state = "quiet";
  else state = "ok";
  const parts = [];
  if (state === "down") parts.push("Not Responding", reachedAt ? `last reached ${ago(reachedAt, now)}` : "never reached");
  else if (state === "unknown") parts.push("Not loaded yet");
  else parts.push(`Reached ${ago(reachedAt ?? s.updated, now)}`);
  if (releaseDate != null && state !== "unknown") parts.push(`Release ${ago(releaseDate, now)}`);
  return { state, reachedAt, releaseDate, failures, label: parts.join(" · ") };
}

// After a refresh: `result` is refreshSource's fields ({ error, ... }), `prev` the record before it.
export function healthFields(prev, result, now = Date.now()) {
  if (result?.error) return { failures: (prev?.failures ?? (prev?.error ? 1 : 0)) + 1 };
  return { reachedAt: now, failures: 0 };
}

// Release's Date: is RFC 2822 ("Sat, 16 Nov 2026 10:00:00 UTC"); Date.parse reads it, "UTC" included.
export function releaseTime(release) {
  const raw = release?.fields?.date;
  if (!raw) return null;
  const t = Date.parse(String(raw).trim().replace(/\bUTC$/, "GMT"));
  return Number.isFinite(t) ? t : null;
}

// FNV-1a over the text, 32 bits as hex, with its length: cheap, and only ever compared with itself.
export function fingerprint(text) {
  const s = String(text ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length.toString(36)}-${h.toString(16).padStart(8, "0")}`;
}

export class TimeoutError extends Error {
  constructor(ms) {
    super(`Not responding (no answer in ${Math.round(ms / 1000)} s)`);
    this.name = "TimeoutError";
    this.code = "timeout";
  }
}

export function withTimeout(promise, ms, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!(ms > 0)) return Promise.resolve(promise);
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimer(() => reject(new TimeoutError(ms)), ms); });
  return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimer(timer));
}

export async function pool(items, n, f) {
  const list = [...items];
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await f(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n || 1, list.length)) }, worker));
  return out;
}

// Validators per URL for conditional GETs: send If-None-Match / If-Modified-Since, and on 304 hand back the text
// kept from the 200. Small bodies only (Release files, AltStore JSON), at most `max` of them, least recently used
// first out, so hundreds of repos cost a few MB at most.
export function validatorCache({ max = 400, maxBytes = 1 << 20 } = {}) {
  const map = new Map();
  return {
    headers(url) {
      const v = map.get(url);
      if (!v) return {};
      const h = {};
      if (v.etag) h["If-None-Match"] = v.etag;
      if (v.lastModified) h["If-Modified-Since"] = v.lastModified;
      return h;
    },
    // The text kept for url (after a 304), or undefined.
    reuse(url) {
      const v = map.get(url);
      if (!v) return undefined;
      map.delete(url);
      map.set(url, v);
      return v.text;
    },
    // After a 200: `headers` is a Headers (or anything with get()).
    store(url, headers, text) {
      const etag = headers?.get?.("ETag") || null;
      const lastModified = headers?.get?.("Last-Modified") || null;
      map.delete(url);
      if ((!etag && !lastModified) || String(text).length > maxBytes) return;
      map.set(url, { etag, lastModified, text });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    get size() { return map.size; },
  };
}
