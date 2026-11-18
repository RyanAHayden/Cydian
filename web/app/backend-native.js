// App backend (N3): the same calls as backend-http.js, answered by the Swift shell instead of the site's proxy.
// The shell injects `globalThis.cydianNative` before any module runs (native/bridge.js); this file only needs its
// `call(method, params, onEvent)`, which resolves with the Swift handler's reply (native/Sources/Apt.swift):
//
//   apt.sources                 -> [{ path, text }]  sources.list, sources.list.d/*.list and *.sources
//   apt.list { name }           -> text | null       a file in apt's lists directory (after apt-get update)
//   apt.dpkgStatus              -> text | null       dpkg's status file
//   net.fetch { url }           -> { status, headers, body }   body base64; the shell fetches (no CORS, no proxy)
//   net.packages { dir }        -> { text, source }  Packages.xz, .gz or plain in dir, decompressed by the shell
//   helper.run { words, stream } -> { code, stdout, stderr }  cydian-helper <words> as root; stream events
//                                  { fd: "out" | "err" | "status", line } while it runs
//
// The install queue (N4, jailbreak build only: the sideload build has no helper): queue(job) marks a package in the
// app's one queue (queue.js), which opens the Confirm sheet (screens/queue.js); simulate(jobs) is `apt-get -s` over
// it, apply(jobs, onEvent) runs it with the console streaming, respring() restarts SpringBoard. All through
// cydian-helper's simulate | apply | respring verbs (native/helper/README.md).
//
// Roll Back (F71, jailbreak build): rollbacks(id) lists the .debs N7's daemon kept when automatic updates replaced
// a version (cydian-helper rollbacks), [{ version, file }] newest first; rollback(id, version, onEvent) installs one
// (cydian-helper rollback: apt-get install of the stored file, downgrades allowed), streaming like apply.
//
// Errors from the shell come as "<code>: <message>" (bridge.js turns them into errors with a `code`); here they
// become BackendError with the same codes the proxy uses (network, timeout, too_large, upstream, not_found, ...).
//
// Sources: the list is apt's (core/aptsources.js), so what the app shows is what apt installs from. Refresh runs
// `apt-get update` through the helper first, then reads each source's Release and Packages from apt's lists
// directory, falling back to the network for anything apt has no list for. A source added in Cydian is checked
// like on the site, then written into apt's own sources through the helper (F33: `cydian-helper addsource`, which
// edits only sources.list.d/cydian.sources), so apt-get update and installs use it too. Only where the helper
// can't be run (not installed) is it kept on the device alone (IndexedDB, `added: true`); refreshSources moves such
// records into cydian.sources once it can. Removing works for cydian.sources' sources; apt's other files are left
// to the user. Counts, origin and refresh times of every source are kept in IndexedDB.
import { BackendError } from "./backend-http.js";
import { verifySource, refreshSource, openSourceStore, sortSources } from "./core/sources.js";
import { parseAptSources, listNamesFor } from "./core/aptsources.js";
import { healthFields } from "./core/health.js";
import { DEFAULT_ARCH, compareVersions } from "./core/apt.js";
import { withAltSources } from "./core/altstore.js";
import { detectMode } from "./core/settings.js";
import { queueWords, parseSimulation } from "./core/queue.js";
import { installQueue } from "./queue.js";

// The one apt source file Cydian writes (cydian-helper addsource/removesource, F33).
const CYDIAN_SOURCES = /(^|\/)sources\.list\.d\/cydian\.sources$/;

const CODES = new Set(["bad_url", "refused", "too_large", "timeout", "upstream", "not_found", "network", "helper"]);

function backendError(e) {
  if (e instanceof BackendError) return e;
  const msg = e?.message || String(e);
  const m = msg.match(/^([a-z_]+): ([\s\S]*)$/);
  const code = e?.code && CODES.has(e.code) ? e.code : m && CODES.has(m[1]) ? m[1] : "network";
  return new BackendError(code, m && CODES.has(m[1]) ? m[2] : msg, e?.status);
}

function fromBase64(b64) {
  const bin = atob(b64 || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The last non-empty line of apt's stderr: "E: Could not get lock /var/lib/apt/lists/lock" and the like.
const lastLine = (s) => String(s ?? "").trim().split("\n").filter(Boolean).pop() ?? "";

// `native`: the bridge (globalThis.cydianNative). `sourceOptions`: { indexedDB, arch: () => string, count, name }
// as for core/sources.js sourceCalls; `name` is the IndexedDB database the source records live in.
export function createNativeBackend({ native = globalThis.cydianNative, sourceOptions = {} } = {}) {
  if (!native?.call) throw new Error("no native bridge (cydianNative.call)");
  const call = (method, params, onEvent) => native.call(method, params, onEvent).catch((e) => { throw backendError(e); });

  // A file in apt's lists directory for an index URL, or null when apt has none (not refreshed, or not a source).
  async function localList(url) {
    for (const name of listNamesFor(url)) {
      const text = await call("apt.list", { name });
      if (typeof text === "string") return { text, name };
    }
    return null;
  }

  async function fetchUrl(url) {
    if (!/^https?:\/\//i.test(String(url))) throw new BackendError("bad_url", `not an http(s) URL: ${url}`);
    const r = await call("net.fetch", { url });
    if (r.status >= 400) throw new BackendError("upstream", `the repo answered HTTP ${r.status}`, r.status);
    const empty = [101, 204, 205, 304].includes(r.status);
    return new Response(empty ? null : fromBase64(r.body), { status: r.status, headers: r.headers ?? {} });
  }

  const backend = {
    kind: "native",
    fetch: fetchUrl,
    // Images load straight from the repo: the page's origin is cydian://app, which <img> may load http(s) from.
    assetUrl: (url) => url,
    async text(url) {
      if (/\/(In)?Release$/.test(url)) {
        const hit = await localList(url);
        if (hit) return hit.text;
        // apt keeps one of the two: when it has the other, this one isn't there (and needs no network).
        const other = url.endsWith("/InRelease") ? url.replace(/InRelease$/, "Release") : url.replace(/Release$/, "InRelease");
        if (await localList(other)) throw new BackendError("not_found", `apt has no ${url.split("/").pop()} for this source`);
      }
      return (await fetchUrl(url)).text();
    },
    // `source` says where the text came from: "apt:<list file>" or the URL the shell fetched.
    async packages(repoDir) {
      const hit = await localList(repoDir + "Packages");
      if (hit) return { text: hit.text, source: `apt:${hit.name}`, cached: true };
      const r = await call("net.packages", { dir: repoDir });
      return { text: r.text, source: r.source || repoDir, cached: false };
    },
    // cydian-helper <words>; onEvent({ fd, line }) sees its output as it comes. Resolves { code, stdout, stderr }.
    helper: (words, onEvent) => call("helper.run", { words, stream: Boolean(onEvent) }, onEvent),
    dpkgStatus: async () => (await call("apt.dpkgStatus")) ?? null,
    // F19: apt's source files ([{ path, text }]): which jailbreak wrote them tells Recommended what to offer.
    aptSourceFiles: async () => (await call("apt.sources")) ?? [],
    // apt-get update through the helper; throws BackendError("helper") with apt's last error line when it fails.
    async update(onEvent) {
      const r = await backend.helper(["update"], onEvent);
      if (r.code !== 0) throw new BackendError("helper", `apt-get update failed (${r.code}): ${lastLine(r.stderr) || "no output"}`);
      return r;
    },
  };
  if ((sourceOptions.mode ?? detectMode()) === "jailbreak") Object.assign(backend, queueCalls(backend, sourceOptions.queue ?? installQueue));
  // AltStore sources (F9) stay on the device, never in apt's sources (core/altstore.js withAltSources).
  // F49: the phone's kCFCoreFoundationVersionNumber (Bridge.swift app.info `cf`) adds Telesphoreo's ios/<cf> suite
  // to the dists Add Source tries, unless sourceOptions brings its own coreFoundation.
  const cf = sourceOptions.coreFoundation ? null : coreFoundationOf(call);
  const opts = { ...sourceOptions, sort: sortSources, ...(cf ? { coreFoundation: cf.get } : {}) };
  const sources = withAltSources(nativeSourceCalls(backend, call, sourceOptions), backend, opts);
  if (cf) {
    const add = sources.addSource;
    sources.addSource = async (input) => { await cf.ready(); return add(input); };
  }
  return Object.assign(backend, sources);
}

// N4: the install queue's calls. A helper that can't be run, or refuses, is an error with its message (never
// silent, Zebra #2052); apt saying no is not: simulate resolves with ok false and apt's output for the Confirm sheet.
function queueCalls(backend, q) {
  const run = async (words, onEvent) => {
    const r = await backend.helper(words, onEvent);
    if (r.code === 64 || r.code === 77 || r.code === 126) {
      throw new BackendError("helper", `cydian-helper ${words[0]} failed (${r.code}): ${lastLine(r.stderr) || "no output"}`);
    }
    return r;
  };
  return {
    // { op: "install" | "remove", id, version, installed, name }: browse.js's package page and Version History.
    queue: (job) => q.add(job),
    // -> { ok, code, plan (core/queue.js parseSimulation), output: apt's stdout then stderr }
    async simulate(jobs) {
      const r = await run(["simulate", ...queueWords(jobs)]);
      const output = [r.stdout, r.stderr].filter(Boolean).join(r.stdout?.endsWith("\n") ? "" : "\n");
      return { ok: r.code === 0, code: r.code, plan: parseSimulation(r.stdout), output };
    },
    // onEvent({ fd: "out" | "err" | "status", line }) as it runs. -> { code, stdout, stderr }
    apply: (jobs, onEvent) => run(["apply", ...queueWords(jobs)], onEvent),
    // F71: [] when nothing is stored, or the helper can't list (not installed, or an older one without the verb).
    async rollbacks(id) {
      let r;
      try {
        r = await backend.helper(["rollbacks", id]);
      } catch {
        return [];
      }
      if (r.code !== 0) return [];
      return parseRollbacks(r.stdout);
    },
    // -> { code, stdout, stderr } like apply; a refusal (64: not stored, control doesn't match) is an error.
    rollback: (id, version, onEvent) => run(["rollback", id, version], onEvent),
    async respring() {
      const r = await run(["respring"]);
      if (r.code !== 0) throw new BackendError("helper", `Couldn't restart SpringBoard (${r.code}): ${lastLine(r.stderr) || "no output"}`);
    },
  };
}

// cydian-helper rollbacks' "<version> <file>" lines -> [{ version, file }], newest version first, each version once.
export function parseRollbacks(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = line.trim().match(/^(\d[A-Za-z0-9.+~:-]*) (\S+\.deb)$/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ version: m[1], file: m[2] });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

// The app.info `cf` number, asked once when first needed: get() is it (or null: an older shell, or no answer) once
// ready() has resolved. ready() never rejects, so Add Source works without it.
function coreFoundationOf(call) {
  let value = null;
  let asked = null;
  return {
    get: () => value,
    ready: () => (asked ??= call("app.info", {}).then((info) => {
      const n = Number(info?.cf);
      value = Number.isFinite(n) && n > 0 ? n : null;
    }, () => {})),
  };
}

// The source-list calls (sources, addSource, removeSource, refreshSources) over apt's files plus the device store.
function nativeSourceCalls(backend, call, opts) {
  let opened = null;
  // The defaults core/sources.js seeds into a new store stay metadata only: just `added` records are listed.
  const store = () => (opened ??= openSourceStore({ indexedDB: opts.indexedDB, name: opts.name ?? "cydian-native-sources" }));
  const arch = () => (typeof opts.arch === "function" ? opts.arch() : opts.arch) || DEFAULT_ARCH;
  const count = opts.count;
  const aptSources = async () => parseAptSources((await call("apt.sources")) ?? []);

  // F33: cydian-helper addsource|removesource. Resolves true when it ran and succeeded, false when the helper
  // couldn't be run at all (no helper: the sideload build); a refusal or failed write is an error with its message.
  async function writeSource(verb, s) {
    const dist = s.dist || "./";
    const words = verb === "addsource" ? [verb, s.uri, dist, ...(dist.endsWith("/") ? [] : s.components ?? [])] : [verb, s.uri, dist];
    let r;
    try {
      r = await backend.helper(words);
    } catch (e) {
      if (e?.code === "helper") return false;
      throw e;
    }
    if (r.code !== 0) throw new BackendError("helper", `cydian-helper ${verb} failed (${r.code}): ${lastLine(r.stderr) || "no output"}`);
    return true;
  }

  // Records kept on the device only (`added: true`, from before F33 or without a helper) go into cydian.sources,
  // one at a time; one that can't be written stays as it is and is tried again on the next refresh.
  async function migrateAdded() {
    const db = await store();
    const added = (await db.list()).filter((s) => s.added);
    if (!added.length) return;
    const aptKeys = new Set((await aptSources()).map((s) => s.key));
    for (const s of added) {
      const { added: _, ...rest } = s;
      try {
        if (aptKeys.has(s.key) || (await writeSource("addsource", s))) await db.put(rest);
      } catch {
        // refused or not written: still listed from the device store, and the next refresh tries again
      }
    }
  }

  async function list() {
    const db = await store();
    const stored = new Map((await db.list()).map((s) => [s.key, s]));
    const apt = await aptSources();
    const aptKeys = new Set(apt.map((s) => s.key));
    const fromApt = apt.map((s) => {
      const { added, ...meta } = stored.get(s.key) ?? {};
      return { ...meta, ...s };
    });
    const added = [...stored.values()].filter((s) => s.added && !aptKeys.has(s.key));
    return sortSources([...fromApt, ...added]);
  }

  return {
    sources: list,
    // `input`: a URL, or a dist repo { uri, dist, components } (F48, Import's `deb` lines): verifySource checks its
    // Release under dists/<dist>/, and writeSource puts the suite and components on the cydian.sources line.
    async addSource(input) {
      const s = await verifySource(backend, input, { arch: arch(), count });
      const db = await store();
      const cur = await db.get(s.key);
      const inApt = (await aptSources()).some((a) => a.key === s.key);
      const written = !inApt && (await writeSource("addsource", s));
      const { added, ...rest } = { ...cur, ...s };
      return db.put(inApt || written ? rest : { ...rest, added: true });
    },
    async removeSource(key) {
      const apt = (await aptSources()).find((s) => s.key === key);
      if (apt && CYDIAN_SOURCES.test(apt.file)) {
        if (!(await writeSource("removesource", apt))) throw new BackendError("helper", "cydian-helper is not installed, so Cydian can't change apt's sources.");
      } else if (apt) {
        throw new Error(`This source is listed in ${apt.file}, which Cydian doesn't change. Remove it there (Filza or a terminal), then Refresh.`);
      }
      return (await store()).remove(key);
    },
    // Device-only sources into cydian.sources, apt-get update, then every source's count and Release from apt's
    // lists (all at once), saved as each lands.
    async refreshSources(onEach = () => {}) {
      await migrateAdded();
      await backend.update();
      const db = await store();
      const sources = await list();
      return Promise.all(sources.map(async (s) => {
        const fields = await refreshSource(backend, s, { arch: arch(), count });
        const cur = await db.get(s.key);
        const { file, ...rest } = s;
        const next = { ...cur, ...rest, ...fields, ...healthFields(cur, fields) }; // F19: reachedAt, failures
        await db.put(next);
        const shown = file ? { ...next, file } : next;
        onEach(shown);
        return shown;
      }));
    },
  };
}
