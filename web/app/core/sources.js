// The source list: defaults, the Add Source check, refreshing a source's package count, and the IndexedDB store
// the list lives in. Shared by the site and the app: everything that touches the network goes through a backend
// (backend-http.js or backend-native.js), which only needs these calls:
//
//   backend.packages(dir) -> { text, source }  the Packages index in a repo directory (.xz/.bz2/.gz/plain)
//   backend.text(url)     -> string
//   backend.fetch(url)    -> Response
//
// and throws errors with a `code` (BackendError: bad_url, refused, too_large, timeout, upstream, not_found,
// network, rate_limited). Cydia's behaviour this follows: docs/cydia.md, "Fetching a source" and "Sources tab".
import { repoLayout, parseRelease, parseControl, matchesArch, DEFAULT_ARCH } from "./apt.js";
import { isAltKey, neverLoaded } from "./altstore.js";
import { releaseTime, fingerprint, healthFields, withTimeout, pool, REFRESH_TIMEOUT, REFRESH_CONCURRENCY } from "./health.js";

// F72: Cydian's own repo names the oldest Cydian that may run without upgrading first (core/essential.js).
const MIN_FIELD = "x-cydian-minimum-version";

// A source: { key, uri, dist, components, name?, origin?, depiction?, count?, updated?, error? }. `name` is ours
// (the defaults), `origin` comes from the repo's Release; the row shows the first there is, else the host.
// `depiction` is the Release's Depiction: template (see releaseDepiction), null when the Release has none.
export const DEFAULT_SOURCES = [
  { name: "Telesphoreo", uri: "http://apt.saurik.com/", dist: "ios/1800.00", components: ["main"] },
  { name: "BigBoss", uri: "http://apt.thebigboss.org/repofiles/cydia/", dist: "stable", components: ["main"] },
  { name: "Chariz", uri: "https://repo.chariz.com/", dist: "./", components: [] },
  { name: "Havoc", uri: "https://havoc.app/", dist: "./", components: [] },
  { name: "Procursus", uri: "https://apt.procurs.us/", dist: "1800", components: ["main"] },
].map((s) => ({ ...s, key: sourceKey(s) }));

// F28: the AltStore sources the site lists by default (the user's own test sources, 2026-11-17): URLs only. They
// go in the AltStore list (core/altstore.js withAltSources `defaults`, seeded once like DEFAULT_SOURCES), not this
// one. Several redirect (github.com/.../raw/..., releases/latest/download/...): the proxy follows each hop, so the
// URL kept is the one given. Deduped on the parsed URL.
export const DEFAULT_ALT_SOURCES = dedupeUrls([
  // I7: Cydian's own source first, the app's own package page (web/app/source.json, tools/altsource.py).
  "https://raw.githubusercontent.com/RyanAHayden/Cydian/main/web/app/source.json",
  "https://provenance-emu.com/apps.json",
  "https://fizl0.github.io/apps/source.json",
  "https://raw.githubusercontent.com/claration/Feather/refs/heads/main/app-repo.json",
  "https://github.com/chachillie/Flycast-iOS/raw/main/flycast-ios.json",
  "https://xitrix.github.io/iTorrent/AltStore.json",
  "https://alt.crystall1ne.dev/",
  "https://repository.apptesters.org/",
  "https://raw.githubusercontent.com/MountainofPenguin/Altstore-Repository/main/apps.json",
  "https://source.ryuksign.com/source.json",
  "https://repo.unbound.rip/app-repo.json",
]);

// URLs -> their parsed hrefs (host lower-cased, a bare host gets its "/"), first of each kept, in order.
export function dedupeUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    let href;
    try { href = new URL(String(u).trim()).href; } catch { continue; }
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

// Cydia's key, `deb:<URI>:<dist>`.
export function sourceKey({ uri, dist }) {
  return `deb:${uri}:${dist || "./"}`;
}

// Cydia's alert texts (docs/cydia.md "UI strings"). `kind`: invalid_url, not_repository, verification.
export const ALERTS = {
  invalid_url: ["Invalid URL", "That is not a valid source URL. Please check it and try again."],
  not_repository: ["Did not Find Repository", "The indicated repository could not be found. This could be because "
    + "you are trying to add a legacy Installer repository (these are not supported). Also, this interface is only "
    + "capable of working with exact repository URLs."],
  verification: ["Verification Error", ""],
};

export class SourceError extends Error {
  constructor(kind, message, code) {
    super(message || ALERTS[kind]?.[1] || kind);
    this.name = "SourceError";
    this.kind = kind;
    this.title = ALERTS[kind]?.[0] ?? "Error";
    if (code) this.code = code;
  }
}

// What the user typed -> the repo URL with a trailing slash, or SourceError("invalid_url"). Cydia's
// VerifySource() wants `(http(s?)://|file:///)[^# ]*`; file:/// can't be fetched by either backend, so only
// http(s). Unlike Cydia, a bare host ("repo.example.com") gets https:// in front: that's how repos are shared now.
export function normalizeSourceUrl(input) {
  let s = String(input ?? "").trim();
  if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  if (!/^https?:\/\/[^#\s/?]+[^#\s]*$/i.test(s)) throw new SourceError("invalid_url");
  let u;
  try { u = new URL(s); } catch { throw new SourceError("invalid_url"); }
  if (u.search || u.username || u.password) throw new SourceError("invalid_url");
  return u.href.replace(/\/*$/, "/");
}

// Where the source's Release and CydiaIcon.png live: the flat dir, or URI/dists/<dist>/.
export const sourceBase = (source) => repoLayout(source).base;
export const sourceIconUrl = (source) => sourceBase(source) + "CydiaIcon.png";

// Where to look for CydiaIcon.png, in order. Cydia asks only <base> (MetaIndexURI(""), so dists/<dist>/ for a
// dist repo), but dist repos such as Procursus serve it at the top level (the URI) instead, so a dist repo also
// gets the root as a fallback. A flat repo has the one place.
export function sourceIconUrls(source) {
  const { flat, base, root } = repoLayout(source);
  return flat ? [base + "CydiaIcon.png"] : [base + "CydiaIcon.png", root + "CydiaIcon.png"];
}

export function displayName(source) {
  if (source.name) return source.name;
  if (source.origin) return source.origin;
  const gh = githubRepo(source.uri);
  if (gh) return gh.user;
  try { return new URL(source.uri).hostname.toLowerCase(); } catch { return source.uri; }
}

// F44: the GitHub user and repo a source URL is hosted under, or null. The four shapes:
//   github.com/<user>/<repo>/raw/...  and  github.com/<user>/<repo>/releases/.../download/...
//   raw.githubusercontent.com/<user>/<repo>/...
//   <user>.github.io/<repo>/...  (repo null for a file at the root: the user's <user>.github.io site)
// The user keeps the case the URL has (FIZL0 on github.com; a github.io host is always lower case).
const GH_RESERVED = new Set(["orgs", "settings", "marketplace", "sponsors", "topics", "features", "login", "apps"]);
export function githubRepo(url) {
  let u;
  try { u = new URL(String(url ?? "").trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const name = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  if (host === "github.com" || host === "www.github.com" || host === "raw.githubusercontent.com") {
    const [user, repo] = parts;
    if (!user || !repo || !name.test(user) || (host !== "raw.githubusercontent.com" && GH_RESERVED.has(user.toLowerCase()))) return null;
    return { user, repo: repo.replace(/\.git$/, "") };
  }
  const io = /^([a-z0-9][a-z0-9-]{0,38})\.github\.io$/.exec(host);
  if (io) {
    // A first segment that is the file itself (fizl0.github.io/source.json) is no repo.
    const repo = parts.length > 1 ? parts[0] : null;
    return { user: io[1], repo };
  }
  return null;
}

// F44: the row's subtitle: "github.com/<user>/<repo>" for a GitHub-hosted source (just "<user>.github.io" for a
// user site's root), else the URL as given.
export function sourceSubtitle(source) {
  const gh = githubRepo(source?.uri);
  if (!gh) return source?.uri ?? "";
  return gh.repo ? `github.com/${gh.user}/${gh.repo}` : `${gh.user.toLowerCase()}.github.io`;
}

// F44: the GitHub avatar for a GitHub-hosted source (github.com redirects to avatars.githubusercontent.com), or
// null. It goes through backend.assetUrl like every other icon, so the site's proxy caches it.
export function githubAvatarUrl(source) {
  const gh = githubRepo(source?.uri);
  return gh ? `https://github.com/${encodeURIComponent(gh.user)}.png?size=120` : null;
}

// F44: where a source's icon may be, in order: an AltStore source's own iconURL, an APT source's CydiaIcon.png
// places (sourceIconUrls), then the GitHub avatar when the source is hosted there. An AltStore source that names
// an icon gets no avatar after it; a CydiaIcon.png that 404s does (the 404 is the "no icon of its own").
export function sourceIcons(source) {
  const avatar = githubAvatarUrl(source);
  if (isAltKey(source?.key)) return source.iconURL ? [source.iconURL] : avatar ? [avatar] : [];
  return [...sourceIconUrls(source), ...(avatar ? [avatar] : [])];
}

// Cydia's order: names that start with a letter first, then a compare without case or diacritics.
export function sortSources(list) {
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const letter = (s) => /^\p{L}/u.test(displayName(s));
  return [...list].sort((a, b) => (letter(b) - letter(a)) || collator.compare(displayName(a), displayName(b)));
}

// The repo answered, but not with this file: try the next name. Anything else (refused, timeout, network, too
// large, rate limited) ends the check: asking again won't help.
const missing = (e) => e?.code === "upstream" || e?.code === "not_found";

function verificationError(e) {
  return new SourceError("verification", e?.message || String(e), e?.code);
}

// A Release (or InRelease) file, not an HTML page the host sent for any path.
function looksLikeRelease(text) {
  if (/^\s*[<{[]/.test(text)) return false; // a page, or JSON served for every path (F28)
  const r = parseRelease(text);
  return Boolean(r.origin || r.label || r.suite || r.codename || r.architectures.length || Object.keys(r.hashes).length);
}

// A Packages text, not a page or a JSON file the host sends for every path (alt.crystall1ne.dev serves its
// AltStore JSON at /Packages, /Release and the rest, F28): such a host is no APT repo, so Add Source falls through
// to AltStore. An empty file is a repo with nothing in it yet.
function looksLikePackages(text) {
  return !/^\s*[<{[]/.test(String(text ?? ""));
}

const MAGIC = {
  "Packages.zst": [0x28, 0xb5, 0x2f, 0xfd],
  "Packages.lzma": [0x5d, 0x00, 0x00],
};

async function hasMagic(res, magic) {
  const head = new Uint8Array(await res.arrayBuffer(), 0);
  return magic.every((b, i) => head[i] === b);
}

// Counts the packages in a Packages text that install on `arch`. Pass `count` (core/parser.js's, which runs in
// the worker) to keep big lists off the UI thread; this inline one is the fallback.
function countInline(text, arch) {
  return parseControl(text).filter((s) => s.package && matchesArch(s, arch)).length;
}

async function releaseOf(backend, base) {
  for (const name of ["Release", "InRelease"]) {
    try {
      const text = await backend.text(base + name);
      if (looksLikeRelease(text)) return { ...parseRelease(text), raw: text }; // raw: F19's fingerprint
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
  return null;
}

// The Add Source check. Cydia HEADs only Packages.bz2 and .gz, so it turns away repos that ship .xz or .zst
// alone; this accepts a flat repo if any of Packages(.xz/.bz2/.gz) (one backend.packages call: the server or
// the app tries each), Release/InRelease, Packages.zst or Packages.lzma is there. Returns the source to save,
// with its package count when the index could be read (null for .zst/.lzma-only repos), or throws SourceError:
// invalid_url, not_repository, or verification (with the backend's `code`, e.g. "refused" by the proxy).
//
// F48: `input` may also be a repo as an object, { uri, dist, components } (Import's `deb <uri> <suite> <components>`
// lines): a flat dist ("./") is checked as above, any other through verifyDistSource.
export async function verifySource(backend, input, { arch = DEFAULT_ARCH, count = countInline } = {}) {
  if (input && typeof input === "object") {
    if (!isFlatDist(input.dist)) return verifyDistSource(backend, input, { arch, count });
    input = input.uri;
  }
  const uri = normalizeSourceUrl(input);
  const source = { uri, dist: "./", components: [] };
  source.key = sourceKey(source);
  let text = null;
  let release = null;
  let found = false;
  try {
    text = (await backend.packages(uri)).text;
    found = looksLikePackages(text);
    if (!found) text = null;
  } catch (e) {
    if (!missing(e)) throw verificationError(e);
  }
  try {
    release = await releaseOf(backend, uri);
  } catch (e) {
    if (!found) throw verificationError(e);
  }
  found ||= Boolean(release);
  for (const name of Object.keys(MAGIC)) {
    if (found) break;
    try {
      found = await hasMagic(await backend.fetch(uri + name), MAGIC[name]);
    } catch (e) {
      if (!missing(e)) throw verificationError(e);
    }
  }
  if (!found) throw new SourceError("not_repository");
  if (release?.origin) source.origin = release.origin;
  if (release) source.depiction = release.fields.depiction || null;
  if (release?.fields[MIN_FIELD]) source.minimumVersion = release.fields[MIN_FIELD]; // F72: Cydian's own repo
  source.count = text == null ? null : await count(text, arch);
  source.updated = source.reachedAt = Date.now(); // F19: health
  source.failures = 0;
  if (release) {
    source.releaseDate = releaseTime(release);
    source.releaseHash = fingerprint(release.raw);
  }
  if (source.count != null) source.countArch = arch;
  return source;
}

const isFlatDist = (dist) => !dist || String(dist).endsWith("/");

// A suite as apt takes it on a `deb` line: a relative path, no spaces, no `..` (it goes into URI/dists/<dist>/).
const DIST_RE = /^[A-Za-z0-9._~+-]+(\/[A-Za-z0-9._~+-]+)*$/;
const COMPONENT_RE = /^[A-Za-z0-9._~+-]+(\/[A-Za-z0-9._~+-]+)*$/;
const badPath = (p) => p.split("/").some((part) => part === "." || part === "..");

// F48: the Add Source check for a dist repo, { uri, dist, components }: its Release (or InRelease) must be under
// URI/dists/<dist>/. No components given: the Release's Components. Then every component's Packages is counted
// (refreshSource), so a wrong suite or component is turned away here rather than failing apt-get update later. A
// Release whose Architectures leave ours out (Telesphoreo, rootful only) is still added, with count 0, as Refresh
// would show it. Throws SourceError: invalid_url, not_repository (no Release there), verification.
export async function verifyDistSource(backend, { uri: rawUri, dist, components } = {}, { arch = DEFAULT_ARCH, count = countInline } = {}) {
  const uri = normalizeSourceUrl(rawUri);
  dist = String(dist ?? "").trim();
  if (!DIST_RE.test(dist) || badPath(dist)) throw new SourceError("invalid_url", `"${dist}" is not a valid suite.`);
  let comps = (Array.isArray(components) ? components : String(components ?? "").split(/\s+/))
    .map((c) => String(c).trim()).filter(Boolean);
  for (const c of comps) if (!COMPONENT_RE.test(c) || badPath(c)) throw new SourceError("invalid_url", `"${c}" is not a valid component.`);
  const source = { uri, dist, components: comps };
  let release;
  try {
    release = await releaseOf(backend, repoLayout(source).base);
  } catch (e) {
    throw verificationError(e);
  }
  if (!release) throw new SourceError("not_repository");
  if (!comps.length) comps = source.components = release.components.filter((c) => COMPONENT_RE.test(c) && !badPath(c));
  if (!comps.length) throw new SourceError("verification", `The Release under dists/${dist}/ names no components.`);
  source.key = sourceKey(source);
  const fields = await refreshSource(backend, source, { arch, count });
  if (fields.error) throw new SourceError("verification", fields.error);
  const { error, unchanged, ...rest } = fields;
  return { ...source, ...rest, reachedAt: rest.updated, failures: 0 };
}

// A package's fallback depiction: the source's Release Depiction: template with every `*` replaced by the
// package id (Cydia's `Package -depiction`, docs/cydia.md "Package page and depictions"). Only http(s) URLs
// count; anything else (or no template) is null. The package's own Depiction: always wins over this.
export function releaseDepiction(source, id) {
  const tpl = String(source?.depiction ?? "").trim();
  if (!tpl || !id) return null;
  const url = tpl.split("*").join(id);
  return /^https?:\/\//i.test(url) ? url : null;
}

// Refetches a source and returns the fields to store: { count, origin?, depiction?, updated, error }. `depiction`
// is only set when a Release was read, so a refresh that can't reach it keeps the stored template. A dist repo whose
// Release lists Architectures without ours has nothing for us (Telesphoreo is rootful only): count 0, no index
// fetched. Errors don't throw: they come back as `error` so one bad source doesn't stop the others.
//
// F19, Release first: the Release is read before any Packages. When it is the very text the last refresh saw
// (`releaseHash`), for the same architecture, and that refresh counted the packages without an error, the count
// stands and no Packages is fetched: an unchanged repo costs one request. `releaseDate` (its Date:) and
// `releaseHash` are saved for the health line (core/health.js) and the next refresh.
export async function refreshSource(backend, source, { arch = DEFAULT_ARCH, count = countInline } = {}) {
  const layout = repoLayout(source, arch);
  const out = { updated: Date.now(), error: null };
  try {
    let release = null;
    try {
      release = await releaseOf(backend, layout.base);
    } catch (e) {
      if (!layout.flat) throw e;
    }
    if (release?.origin) out.origin = release.origin;
    if (release) {
      out.depiction = release.fields.depiction || null;
      out.minimumVersion = release.fields[MIN_FIELD] || null; // F72: X-Cydian-Minimum-Version (Cydian's own repo)
      out.releaseDate = releaseTime(release);
      out.releaseHash = fingerprint(release.raw);
    }
    out.countArch = arch;
    if (release && out.releaseHash === source?.releaseHash && source?.countArch === arch
        && typeof source?.count === "number" && !source?.error) {
      out.count = source.count;
      out.unchanged = true;
      return out;
    }
    if (!layout.flat && release?.architectures.length && !release.architectures.includes(arch)) {
      out.count = 0;
      return out;
    }
    let total = 0;
    for (const file of layout.packages) {
      const dir = file.slice(0, -"Packages".length);
      total += await count((await backend.packages(dir)).text, arch);
    }
    out.count = total;
  } catch (e) {
    out.error = e?.message || String(e);
  }
  return out;
}

// F19: refreshSource with a time limit. The fetches it started go on unawaited; the source gets the timeout as its
// error, so the row says Not Responding and the rest of Refresh goes on.
export async function refreshTimed(backend, source, { timeout = REFRESH_TIMEOUT, ...rest } = {}) {
  try {
    return await withTimeout(refreshSource(backend, source, rest), timeout);
  } catch (e) {
    return { updated: Date.now(), error: e?.message || String(e) };
  }
}

// ---- the store ----------------------------------------------------------------------------------------------

// IndexedDB: store "sources" (keyPath "key") and "meta". The defaults go in once, on the first open, so a source
// the user deletes stays deleted. The IDBFactory is passed in so node tests can hand it a fake.
export function openSourceStore({ indexedDB: idb = globalThis.indexedDB, name = "cydian-sources" } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const store = wrap(req.result);
      store.seed().then(() => resolve(store), reject);
    };
  });
}

function wrap(db) {
  const run = (storeName, mode, f) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = f(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error ?? req?.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
  const store = {
    async seed() {
      if (await run("meta", "readonly", (s) => s.get("seeded"))) return;
      for (const s of DEFAULT_SOURCES) await run("sources", "readwrite", (st) => st.put(s));
      await run("meta", "readwrite", (s) => s.put({ key: "seeded", at: Date.now() }));
    },
    // Every source, in the Sources tab's order.
    list: async () => sortSources(await run("sources", "readonly", (s) => s.getAll())),
    get: (key) => run("sources", "readonly", (s) => s.get(key)),
    // Adds or replaces a whole source record.
    put: (source) => run("sources", "readwrite", (s) => s.put(source)).then(() => source),
    // Merges `fields` into the stored source; returns the new record, or undefined if it's gone.
    async update(key, fields) {
      const cur = await store.get(key);
      if (!cur) return undefined;
      return store.put({ ...cur, ...fields });
    },
    remove: (key) => run("sources", "readwrite", (s) => s.delete(key)).then(() => undefined),
    close: () => db.close(),
  };
  return store;
}

// The source-list calls every backend exposes (docs/native.md): `sources()`, `addSource(input)`,
// `removeSource(key)`, `refreshSources(onEach)`. Both backends mix these in over their own fetch calls, so the
// list lives on the device either way. `opts`: { indexedDB, arch: () => string, count }.
export function sourceCalls(backend, opts = {}) {
  let opened = null;
  const store = () => (opened ??= openSourceStore(opts));
  const arch = () => (typeof opts.arch === "function" ? opts.arch() : opts.arch) || DEFAULT_ARCH;
  const count = opts.count;
  return {
    sources: async () => (await store()).list(),
    // Checks the repo (a URL, or a dist repo { uri, dist, components }, F48), then saves it. Throws SourceError
    // (see verifySource). An already-listed source is refreshed in place rather than added twice.
    async addSource(input) {
      const s = await verifySource(backend, input, { arch: arch(), count });
      const db = await store();
      const cur = await db.get(s.key);
      return db.put(cur ? { ...cur, ...s } : s);
    },
    removeSource: async (key) => (await store()).remove(key),
    // Refreshes every source (all at once), saving each as it lands; onEach(source) sees the updated record.
    // `filter` (F41, sourceFilter): only the sources it keeps are fetched.
    // F19: at most REFRESH_CONCURRENCY at once, each given `timeout` ms (a dead host is marked Not Responding
    // instead of holding the rest), with the health fields (reachedAt, failures) saved beside the result.
    async refreshSources(onEach = () => {}, { filter, timeout = opts.timeout ?? REFRESH_TIMEOUT,
      concurrency = opts.concurrency ?? REFRESH_CONCURRENCY } = {}) {
      const db = await store();
      const list = (await db.list()).filter(filter ?? (() => true));
      return pool(list, concurrency, async (s) => {
        const fields = await refreshTimed(backend, s, { arch: arch(), count, timeout });
        const next = await db.update(s.key, { ...fields, ...healthFields(s, fields) });
        if (next) onEach(next);
        return next;
      });
    },
  };
}

// F37: the sources a device type shows. Not Jailbroken ("none") sees AltStore-style sources only (keys `alt:`,
// core/altstore.js); a jailbroken type sees every source. Returns { shown, hidden: count of APT sources left out }.
export function sourcesFor(list, type) {
  const all = Array.isArray(list) ? list : [];
  if (type !== "none") return { shown: all, hidden: 0 };
  const shown = all.filter((s) => String(s?.key ?? "").startsWith("alt:"));
  return { shown, hidden: all.length - shown.length };
}

// F41: which sources Refresh fetches for a device type, as a refreshSources `filter`: Not Jailbroken ("none")
// keeps AltStore-style sources only (what sourcesFor shows), so nobody's hidden APT Packages go through the
// site's proxy; a jailbroken type refreshes everything (null: no filter).
export function sourceFilter(type) {
  if (type !== "none") return null;
  return (s) => String(s?.key ?? "").startsWith("alt:");
}

// F43: the sources a first visit loads by itself: AltStore sources (the F28 defaults are seeded as bare URLs) that
// have never loaded, among those the device type shows (sourceFilter). APT sources are left to Refresh: their rows
// already have a name and CydiaIcon.png, and refreshing one means Packages through the proxy, or apt-get update in
// the app, where it would fight Refresh on Launch for apt's lock.
export function firstLoadFilter(type) {
  const shown = sourceFilter(type) ?? (() => true);
  return (s) => isAltKey(s?.key) && neverLoaded(s) && shown(s);
}

// F43: refreshes the never-loaded sources in `list` (firstLoadFilter), once each per `tried` (a Set of keys the
// caller keeps, so a source whose fetch throws isn't asked again on every visit). `begin()` runs before the fetch
// and returns what ends it (the screen's HUD). Resolves to the refreshed records, or null when nothing needed it.
export async function loadNeverLoaded(backend, list, type, { tried = new Set(), begin = () => () => {}, onEach } = {}) {
  const want = firstLoadFilter(type);
  const keys = new Set((Array.isArray(list) ? list : []).filter((s) => want(s) && !tried.has(s.key)).map((s) => s.key));
  if (!keys.size) return null;
  for (const k of keys) tried.add(k);
  const end = begin(keys);
  try {
    return await backend.refreshSources(onEach, { filter: (s) => keys.has(s?.key) });
  } finally {
    end();
  }
}


// What the user typed or pasted as a source, as one clean URL, or "" when it isn't one: the first URL-looking word,
// repeated schemes collapsed to the last one (the Add field starts with https://, so pasting https://repo.x gave
// https://https://repo.x; https://http://x keeps http), https:// added to a bare host, spaces and <> trimmed.
export function cleanSourceUrl(text) {
  const word = String(text ?? "").trim().split(/\s+/).find((w) => /[a-z0-9-]\.[a-z]{2,}|localhost/i.test(w)) ?? "";
  let u = word.replace(/^[<("']+|[>)"',.;]+$/g, "");
  if (!u) return "";
  u = u.replace(/^(?:(?:https?|cydia|sileo|zbra|altstore):\/{0,2}\/?)+(https?:\/\/)/i, "$1"); // the last scheme wins
  u = u.replace(/^(?:(?:https?):\/{0,2})+(?=https?:\/\/)/i, "");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u.replace(/^\/+/, "");
  try { return new URL(u).href; } catch { return ""; }
}
