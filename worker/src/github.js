// GitHub repos as sources (F304): the fetch proxy (/api/fetch?url=) answers a GitHub API URL for one public repo here,
// not as a plain upstream fetch:
//
//   https://api.github.com/repos/<owner>/<repo>                  the repo: name, description, owner
//   https://api.github.com/repos/<owner>/<repo>/releases[?per_page=N]   its releases, newest first (N 1-100, 30 if none)
//
// GitHub limits anonymous API calls to 60 an hour per address, and a Worker shares its addresses with other sites, so
// the call carries GITHUB_TOKEN when the Worker has one (a token with no permissions: public data only, 5000 an hour,
// per token) and the answer is kept at the edge for GITHUB_TTL_S (Cloudflare's cache; node.mjs passes an in-memory one
// as env.LOOKUP_CACHE): every visitor adding or refreshing the same repo costs GitHub one call per ten minutes.
// Only what the app reads is passed on (core/github.js): names, tags, dates, assets, and release notes cut short.
// The host is fixed (api.github.com) and the path is rebuilt from two checked names, so nothing a visitor types can
// point this anywhere else: the SSRF guard holds.
import { DOMAIN } from "../../web/app/brand.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type" };
const SAFE = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", ...CORS };
export const GITHUB_TTL_S = 600;
export const NOTES_MAX = 4000; // characters of a release's notes passed on
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

// The API URL rebuilt from its parts, { url, what: "repo" | "releases" }, or null for anything else.
export function githubApiTarget(target) {
  let u;
  try { u = target instanceof URL ? target : new URL(String(target)); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "api.github.com" || u.port || u.username || u.password) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] !== "repos" || parts.length < 3 || parts.length > 4) return null;
  const [, owner, repo, more] = parts;
  if (!NAME.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") return null;
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  if (more === undefined) return u.search ? null : { url: base, what: "repo" };
  if (more !== "releases") return null;
  const keys = [...u.searchParams.keys()];
  if (keys.some((k) => k !== "per_page")) return null;
  const n = u.searchParams.has("per_page") ? Number(u.searchParams.get("per_page")) : 30;
  if (!Number.isInteger(n) || n < 1 || n > 100) return null;
  return { url: `${base}/releases?per_page=${n}`, what: "releases" };
}

const str = (v) => (typeof v === "string" ? v : null);
const num = (v) => (Number.isFinite(v) ? v : null);

// The fields core/github.js reads, nothing else (an API answer carries every uploader's profile and URL templates).
export function trimRepo(r) {
  if (!r || typeof r !== "object") return null;
  return { name: str(r.name), full_name: str(r.full_name), description: str(r.description), html_url: str(r.html_url),
    homepage: str(r.homepage), archived: Boolean(r.archived), stargazers_count: num(r.stargazers_count),
    owner: r.owner && typeof r.owner === "object" ? { login: str(r.owner.login), avatar_url: str(r.owner.avatar_url) } : null };
}

export function trimReleases(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((r) => r && typeof r === "object" && !r.draft).map((r) => ({
    tag_name: str(r.tag_name), name: str(r.name), html_url: str(r.html_url), prerelease: Boolean(r.prerelease),
    published_at: str(r.published_at), body: str(r.body)?.slice(0, NOTES_MAX) ?? null,
    assets: (Array.isArray(r.assets) ? r.assets : []).filter((a) => a && typeof a === "object").map((a) => ({
      name: str(a.name), size: num(a.size), content_type: str(a.content_type), browser_download_url: str(a.browser_download_url),
    })),
  }));
}

const answer = (body, status, ttl = 0) => new Response(JSON.stringify(body), { status, headers: { ...SAFE,
  "Content-Type": "application/json; charset=utf-8", "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store" } });
const err = (code, error, status) => answer({ error, code, ...(code === "upstream" ? { status } : {}) }, status);

// /api/fetch for a GitHub API URL (githubApiTarget's). Errors keep the proxy's shape: { error, code }, with code
// "upstream" and GitHub's status for a 404 (no such repo, or a private one), "rate_limited" when GitHub says so.
export async function githubApi(target, env = {}, { fetcher = fetch, cache = env.LOOKUP_CACHE ?? globalThis.caches?.default ?? null } = {}) {
  const t = githubApiTarget(target);
  if (!t) return err("bad_url", "Only a GitHub repo or its releases can be asked for here.", 400);
  const key = new Request(`https://github.ifizbox.internal/${t.url.slice("https://api.github.com/".length)}`);
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return hit;
  const headers = { "User-Agent": DOMAIN, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
    ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) };
  let r;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try { r = await fetcher(t.url, { headers, signal: ctl.signal }); } finally { clearTimeout(timer); }
  } catch (e) {
    return err("network", `GitHub didn't answer: ${e?.message ?? e}`, 502);
  }
  if (r.status === 429 || (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0")) {
    return err("rate_limited", "GitHub is limiting how often it is asked. Try again in a few minutes.", 429);
  }
  if (!r.ok) return err("upstream", `upstream answered HTTP ${r.status}`, r.status >= 400 && r.status < 600 ? r.status : 502);
  let body;
  try { body = await r.json(); } catch { return err("upstream", "GitHub's answer wasn't JSON.", 502); }
  const res = answer(t.what === "repo" ? trimRepo(body) : trimReleases(body), 200, GITHUB_TTL_S);
  if (cache) await cache.put(key, res.clone()).catch(() => {});
  return res;
}
