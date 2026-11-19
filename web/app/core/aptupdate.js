// B23: which sources `apt-get update` failed on, read from its own output, so one dead source no longer fails the
// whole Refresh (or Add Source & Install of another source). Pure JS, no DOM: node tests cover it.
//
//   updateFailures(stdout, stderr)  -> [{ uri, suite, target, message }]  every source apt couldn't fetch
//   failureFor(source, failures)    -> the failure naming this source ({ uri, dist }), or null
//
// What counts (from apt 2.x on the iPhone 7, journal/2026-11-18-b23-*):
//   stdout  "Err:21 https://dead.example/repo ./ Packages" then an indented "  525  <none> [IP: 1.2.3.4 443]". Only an
//           item whose last line is Err counts: apt reports an optional file's 404 as Err and then gives up on it with
//           "Ign:<same n>" (Translation-en). Translation-* is optional anyway and never counts.
//   stderr  "E: Failed to fetch <url>  <reason>" (W: in older apt), and "E: The repository '<uri> <suite> Release' ..."
//           (a missing or refused Release apt won't read).
// Not counted: the W: lines about unsigned repositories, GPG keys or a Release with no Hash or Date (the helper's
// Acquire::AllowInsecureRepositories reads those repos anyway), and the closing "E: Some index files failed to
// download", which names nothing.

const OPTIONAL = /^Translation-/;

const tidy = (reason) => String(reason ?? "")
  .replace(/\s*\[IP:[^\]]*\]\s*$/, "")
  .replace(/<(none|unknown)>/g, "")
  .replace(/\s+/g, " ")
  .trim();

const lower = (uri) => String(uri ?? "").replace(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)/i, (m) => m.toLowerCase());
const base = (uri) => lower(uri).replace(/\/+$/, "");

function message(target, reason) {
  const why = tidy(reason);
  return `apt-get update couldn't fetch ${target || "its index"}${why ? ` (${why})` : ""}`;
}

export function updateFailures(stdout = "", stderr = "") {
  const items = new Map(); // n -> { status, uri, suite, target, reason }
  const lines = String(stdout ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(Hit|Get|Ign|Err):(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(lines[i]);
    if (!m) continue;
    const [, status, n, uri, suite, rest = ""] = m;
    const words = rest.replace(/\s*\[[^\]]*\]\s*$/, "").trim().split(/\s+/).filter(Boolean);
    const item = { status, uri, suite, target: words[words.length - 1] ?? "", reason: "" };
    if (status === "Err" && /^\s+\S/.test(lines[i + 1] ?? "")) item.reason = lines[++i].trim();
    items.set(n, item);
  }
  const out = [];
  const seen = new Set();
  const add = (f) => {
    const k = `${base(f.uri)} ${f.suite ?? ""}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };
  for (const it of items.values()) {
    if (it.status !== "Err" || OPTIONAL.test(it.target)) continue;
    add({ uri: it.uri, suite: it.suite, target: it.target, message: message(it.target, it.reason) });
  }
  for (const line of String(stderr ?? "").split(/\r?\n/)) {
    let m = /^[EW]: Failed to fetch (\S+)\s*(.*)$/.exec(line);
    if (m) {
      const target = m[1].split("/").pop();
      if (OPTIONAL.test(target)) continue;
      add({ uri: m[1], suite: null, target, message: message(target, m[2]) });
      continue;
    }
    m = /^E: The repository '(\S+) (\S+)(?: (\S+))?' (.*)$/.exec(line);
    if (m) add({ uri: m[1], suite: m[2], target: m[3] ?? "Release", message: `apt-get update: ${m[4].replace(/\.$/, "")}` });
  }
  return out;
}

// Does failure `f` name the source ({ uri, dist })? An Err line gives the repo URI and suite; a Failed to fetch line
// gives the file's whole URL, which must sit under the repo (and under dists/<dist>/ for a suite repo).
function names(f, source) {
  const b = base(source?.uri);
  if (!b) return false;
  const dist = source.dist || "./";
  const u = lower(f.uri);
  if (f.suite != null) return base(u) === b && (f.suite === dist || f.suite.replace(/\/+$/, "") === dist.replace(/\/+$/, ""));
  if (!u.startsWith(b + "/")) return false;
  if (dist.endsWith("/")) return true;
  return u.slice(b.length).startsWith(`/dists/${dist}/`);
}

export function failureFor(source, failures) {
  return (failures ?? []).find((f) => names(f, source)) ?? null;
}

// B23: the in-app banner's words for refreshSources' `failed` ([{ name, uri }]), or null when nothing failed.
// Cydia names the sources that failed and goes on; so does the banner (nav/banner.js), which opens Sources.
export const FAILED_BANNER_MS = 6000;
export function failedBanner(failed) {
  const names = [...new Set((failed ?? []).map((f) => f.name || hostOf(f.uri)).filter(Boolean))];
  if (!names.length) return null;
  const shown = names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} more`] : names;
  const list = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0];
  return { title: names.length > 1 ? "Sources Failed to Refresh" : "Source Failed to Refresh", message: `${list}: tap to see Sources.` };
}

function hostOf(uri) {
  try { return new URL(uri).host + new URL(uri).pathname.replace(/\/+$/, ""); } catch { return String(uri ?? ""); }
}

// F233: apt-get update's lines as they come (backend.update(onEvent), the helper's { fd, line } events), turned into
// row states for the sources they name, so the Sources tab's rows move while the one apt-get update runs:
//
//   const live = liveUpdate(sources, (key, state, reason) => ...)   // sources: [{ key, uri, dist }]
//   live.feed({ fd: "out" | "err", line })
//
//   "Get:n <uri> <suite> <target>", "Hit:n ...", "Ign:n ..."  -> the source's row spins ("loading"), once
//   "Err:n <uri> <suite> <target>" + an indented reason line   -> "failed" with apt's reason (Translation-* never)
//   stderr "E: Failed to fetch <url> <reason>" and "E: The repository '<uri> <suite> Release' ..."  -> "failed"
// A line naming no listed source changes nothing. apt says nothing per source when it is done (it fetches them all
// at once): the rows that didn't fail land when refreshSources reads their lists back.
export function liveUpdate(sources, onRow = () => {}) {
  const list = (sources ?? []).filter((s) => s?.key != null && s?.uri);
  const states = new Map(); // key -> "loading" | "failed"
  let pending = null; // an Err line waiting for its indented reason: { key, target }
  const sourceOf = (f) => list.find((s) => names(f, s)) ?? null;
  const emit = (key, state, reason) => {
    const cur = states.get(key);
    if (cur === "failed" || cur === state) return;
    states.set(key, state);
    onRow(key, state, reason);
  };
  const flush = (reason = "") => {
    if (!pending) return;
    const p = pending;
    pending = null;
    emit(p.key, "failed", message(p.target, reason));
  };
  return {
    states,
    feed(ev) {
      const line = String(ev?.line ?? "");
      const fd = ev?.fd ?? "out";
      if (fd === "status") return;
      if (fd === "err") {
        flush();
        let m = /^[EW]: Failed to fetch (\S+)\s*(.*)$/.exec(line);
        if (m) {
          const target = m[1].split("/").pop();
          const s = OPTIONAL.test(target) ? null : sourceOf({ uri: m[1], suite: null });
          if (s) emit(s.key, "failed", message(target, m[2]));
          return;
        }
        m = /^E: The repository '(\S+) (\S+)(?: (\S+))?' (.*)$/.exec(line);
        const s = m && sourceOf({ uri: m[1], suite: m[2] });
        if (s) emit(s.key, "failed", `apt-get update: ${m[4].replace(/\.$/, "")}`);
        return;
      }
      if (pending && /^\s+\S/.test(line)) { flush(line.trim()); return; }
      flush();
      const m = /^(Hit|Get|Ign|Err):(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(line);
      if (!m) return;
      const [, status, , uri, suite, rest = ""] = m;
      const s = sourceOf({ uri, suite });
      if (!s) return;
      const words = rest.replace(/\s*\[[^\]]*\]\s*$/, "").trim().split(/\s+/).filter(Boolean);
      const target = words[words.length - 1] ?? "";
      if (status === "Err" && !OPTIONAL.test(target)) {
        emit(s.key, "loading");
        pending = { key: s.key, target };
        return;
      }
      emit(s.key, "loading");
    },
    end() { flush(); },
  };
}
