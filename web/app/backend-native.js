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
// Errors from the shell come as "<code>: <message>" (bridge.js turns them into errors with a `code`); here they
// become BackendError with the same codes the proxy uses (network, timeout, too_large, upstream, not_found, ...).
//
// Sources: the list is apt's (core/aptsources.js), so what the app shows is what apt installs from. Refresh runs
// `apt-get update` through the helper first, then reads each source's Release and Packages from apt's lists
// directory, falling back to the network for anything apt has no list for. A source added in Cydian is checked
// like on the site and kept on the device (IndexedDB, `added: true`) beside apt's; writing it into apt's sources
// needs a helper verb (follow-up to N3). Counts, origin and refresh times of every source are kept there too.
import { BackendError } from "./backend-http.js";
import { verifySource, refreshSource, openSourceStore, sortSources } from "./core/sources.js";
import { parseAptSources, listNamesFor } from "./core/aptsources.js";
import { DEFAULT_ARCH } from "./core/apt.js";

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
    // apt-get update through the helper; throws BackendError("helper") with apt's last error line when it fails.
    async update(onEvent) {
      const r = await backend.helper(["update"], onEvent);
      if (r.code !== 0) throw new BackendError("helper", `apt-get update failed (${r.code}): ${lastLine(r.stderr) || "no output"}`);
      return r;
    },
  };
  return Object.assign(backend, nativeSourceCalls(backend, call, sourceOptions));
}

// The source-list calls (sources, addSource, removeSource, refreshSources) over apt's files plus the device store.
function nativeSourceCalls(backend, call, opts) {
  let opened = null;
  // The defaults core/sources.js seeds into a new store stay metadata only: just `added` records are listed.
  const store = () => (opened ??= openSourceStore({ indexedDB: opts.indexedDB, name: opts.name ?? "cydian-native-sources" }));
  const arch = () => (typeof opts.arch === "function" ? opts.arch() : opts.arch) || DEFAULT_ARCH;
  const count = opts.count;
  const aptSources = async () => parseAptSources((await call("apt.sources")) ?? []);

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
    async addSource(input) {
      const s = await verifySource(backend, input, { arch: arch(), count });
      const db = await store();
      const cur = await db.get(s.key);
      const inApt = (await aptSources()).some((a) => a.key === s.key);
      return db.put({ ...cur, ...s, ...(inApt ? {} : { added: true }) });
    },
    async removeSource(key) {
      const apt = (await aptSources()).find((s) => s.key === key);
      if (apt) throw new Error(`This source is listed in ${apt.file}, which Cydian can't change yet. Remove it there (Filza or a terminal), then Refresh.`);
      return (await store()).remove(key);
    },
    // apt-get update, then every source's count and Release from apt's lists (all at once), saved as each lands.
    async refreshSources(onEach = () => {}) {
      await backend.update();
      const db = await store();
      const sources = await list();
      return Promise.all(sources.map(async (s) => {
        const fields = await refreshSource(backend, s, { arch: arch(), count });
        const cur = await db.get(s.key);
        const { file, ...rest } = s;
        const next = { ...cur, ...rest, ...fields };
        await db.put(next);
        const shown = file ? { ...next, file } : next;
        onEach(shown);
        return shown;
      }));
    },
  };
}
