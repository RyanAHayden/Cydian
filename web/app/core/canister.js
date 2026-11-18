// Cross-repo discovery through Canister (F20): packages from sources the user hasn't added, each with its source so
// Search can offer Add Source. Pure JS, no DOM; the caller hands in `getJson` (the site: through the F3 proxy; the
// app: the shell's fetch).
//
//   searchUrl(q, { limit, page })      -> https://api.canister.me/v2/jailbreak/package/search?… (null under 2 chars)
//   lookupUrl(id)                      -> …/v2/jailbreak/package/<id>  (every repo's copy of one package)
//   mapResults(json, { have, arch })   -> [{ id, name, description, author, version, section, price, paid, icon,
//                                         depiction, arch, archOk, repo: { uri, name, slug, flat, dist,
//                                         components, added, key } }]
//   priceFor(json, repoUri)            -> the price Canister lists for that repo's copy ("$1.99"), or null
//   normalRepo(uri)                    -> how two repo URIs are compared (scheme, case and trailing / ignored)
//   createCanister({ getJson, ttl, now, max })  .search(q) / .lookup(id), cached, one request per key at a time
//
// The API (github.com/cnstr/api, crates/api/src/routes/package/search.rs): q at least 2 characters, limit 1-250
// (default 100), page from 1; answers { status, refs: { nextPage }, count, data: [...] }. On 2026-11-17
// api.canister.me answers 308 to api.tale.me/v4/canister-services/…, which both fetchers follow, and sends
// Access-Control-Allow-Origin: *. Canister publishes no terms or rate limits (checked: the API's source has no
// limiter, docs.canister.me states none); be gentle anyway: Search asks only after typing stops, only for 2+
// characters, at most 50 results, and every answer is kept 10 minutes.

export const CANISTER = "https://api.canister.me/v2/jailbreak";
export const SEARCH_LIMIT = 50;
const TTL = 10 * 60 * 1000;
const PKG = /^[a-z0-9][a-z0-9+.-]*$/i;

export function searchUrl(q, { limit = SEARCH_LIMIT, page = 1 } = {}) {
  const query = String(q ?? "").trim();
  if (query.length < 2) return null;
  const l = Math.min(250, Math.max(1, Math.floor(limit) || SEARCH_LIMIT));
  const p = Math.max(1, Math.floor(page) || 1);
  return `${CANISTER}/package/search?${new URLSearchParams({ q: query.slice(0, 100), limit: String(l), ...(p > 1 ? { page: String(p) } : {}) })}`;
}

export function lookupUrl(id) {
  if (!PKG.test(String(id ?? ""))) return null;
  return `${CANISTER}/package/${encodeURIComponent(id)}`;
}

export function normalRepo(uri) {
  const s = String(uri ?? "").trim();
  let u;
  try { u = new URL(s); } catch { return s.toLowerCase(); }
  return (u.host + u.pathname).toLowerCase().replace(/\/+$/, "");
}

const http = (u) => (typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);
const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
// "Name <mail@example.com>" -> "Name"
const person = (v) => str(v).replace(/\s*<[^>]*>\s*/g, " ").trim();
const isFree = (p) => !p || /^(free|0|\$?0(\.00)?)$/i.test(String(p).trim());

function repoOf(r, haveSet) {
  const uri = http(r?.uri);
  if (!uri) return null;
  const suite = str(r.suite) || "./";
  const flat = suite.endsWith("/");
  const components = typeof r.component === "string" && r.component ? r.component.split(/\s+/) : [];
  const n = normalRepo(uri);
  return { uri: uri.replace(/\/*$/, "/"), name: str(r.name, 80) || new URL(uri).host, slug: str(r.slug || r.id, 80),
    flat, dist: flat ? "./" : suite, components, added: haveSet.has(n), key: `deb:${uri.replace(/\/*$/, "/")}:${flat ? "./" : suite}` };
}

function versionNewer(a, b) {
  // Canister marks the newest copy latest_version; fall back to a plain compare only to pick between two copies.
  return String(a ?? "").localeCompare(String(b ?? ""), "en", { numeric: true }) > 0;
}

// `have`: the user's sources ([{ uri }]) or their URIs; results from those repos are marked added (Search shows
// them elsewhere already and keeps them out). `arch`: the device's architecture; results built for another one
// keep archOk false and sort last.
export function mapResults(json, { have = [], arch = null } = {}) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  const haveSet = new Set(have.map((h) => normalRepo(typeof h === "string" ? h : h?.uri)));
  const best = new Map();
  for (const x of rows) {
    if (!x || typeof x !== "object" || x.visible === false) continue;
    const id = str(x.package_id || x.package, 255);
    if (!PKG.test(id)) continue;
    const repo = repoOf(x.repository, haveSet);
    if (!repo) continue;
    const price = str(x.price, 20);
    const icon = http(x.icon_url);
    const item = {
      id, name: str(x.name, 120) || id, description: str(x.description, 300), author: person(x.author) || person(x.maintainer),
      version: str(x.version, 80), section: str(x.section, 80), price: isFree(price) ? null : price, paid: !isFree(price),
      icon, depiction: http(x.sileo_depiction) || http(x.native_depiction) || http(x.depiction),
      arch: str(x.architecture, 40), archOk: !arch || !x.architecture || x.architecture === arch || x.architecture === "all",
      latest: x.latest_version !== false, repo,
    };
    const k = id + "\n" + normalRepo(repo.uri);
    const cur = best.get(k);
    if (!cur || (item.archOk && !cur.archOk) || (item.archOk === cur.archOk && ((item.latest && !cur.latest)
      || (item.latest === cur.latest && versionNewer(item.version, cur.version))))) best.set(k, item);
  }
  // Canister's own order is by rank; keep it, but put packages for another architecture after the rest.
  const out = [...best.values()];
  return out.filter((r) => r.archOk).concat(out.filter((r) => !r.archOk)).map(({ latest, ...r }) => r);
}

// The lookup endpoint can leave repository.uri out (Havoc's copies on 2026-11-17 had only repository_id "havoc"):
// then a repository id/slug/name equal to `name` (the source's name, or its host's first label) counts too.
export function priceFor(json, repoUri, name = null) {
  const want = normalRepo(repoUri);
  let host = "";
  try { host = new URL(repoUri).hostname.replace(/^(www|repo|apt)\./, "").split(".")[0]; } catch { /* not a URL */ }
  const names = new Set([name, host].filter(Boolean).map((n) => String(n).toLowerCase()));
  const rows = Array.isArray(json?.data) ? json.data : [];
  const byUri = rows.filter((x) => normalRepo(x?.repository?.uri) === want);
  const byName = rows.filter((x) => !x?.repository?.uri
    && [x?.repository_id, x?.repository?.id, x?.repository?.slug, x?.repository?.name].some((v) => v && names.has(String(v).toLowerCase())));
  for (const x of byUri.length ? byUri : byName) {
    const p = str(x.price, 20);
    if (p) return isFree(p) ? "Free" : p;
  }
  return null;
}

export function createCanister({ getJson, ttl = TTL, now = () => Date.now(), max = 50 } = {}) {
  const cache = new Map(); // url -> { at, data }, oldest first
  const inflight = new Map();
  async function get(url) {
    if (!url) return null;
    const hit = cache.get(url);
    if (hit && now() - hit.at < ttl) return hit.data;
    if (inflight.has(url)) return inflight.get(url);
    const p = Promise.resolve().then(() => getJson(url)).then((data) => {
      cache.delete(url);
      cache.set(url, { at: now(), data });
      while (cache.size > max) cache.delete(cache.keys().next().value);
      return data;
    }).finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }
  return {
    search: (q, opts) => get(searchUrl(q, opts)),
    lookup: (id) => get(lookupUrl(id)),
    size: () => cache.size,
  };
}
