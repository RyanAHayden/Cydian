// F304: the fetch proxy's GitHub API route (src/github.js): only one repo's details or releases, the token when the
// Worker has one, trimmed answers kept at the edge, GitHub's 404 and rate limit passed on. Run by test_github.py.
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { githubApiTarget, githubApi, trimReleases, GITHUB_TTL_S } from "./src/github.js";
import w from "./src/index.js";

// Targets: the two shapes, rebuilt; anything else refused.
assert.deepEqual(githubApiTarget("https://api.github.com/repos/dayanch96/YTLite"), { url: "https://api.github.com/repos/dayanch96/YTLite", what: "repo" });
assert.deepEqual(githubApiTarget("https://api.github.com/repos/a/b/releases?per_page=30"), { url: "https://api.github.com/repos/a/b/releases?per_page=30", what: "releases" });
assert.deepEqual(githubApiTarget("https://api.github.com/repos/a/b/releases"), { url: "https://api.github.com/repos/a/b/releases?per_page=30", what: "releases" });
for (const bad of [
  "http://api.github.com/repos/a/b", "https://api.github.com/user", "https://api.github.com/repos/a/b/contents/x",
  "https://api.github.com/repos/a/b/releases?per_page=500", "https://api.github.com/repos/a/b/releases?access_token=x",
  "https://api.github.com:8443/repos/a/b", "https://api.github.com.evil.test/repos/a/b", "https://api.github.com/repos/a/..",
  "https://api.github.com/repos/-a/b", "https://api.github.com/repos/a/b?x=1", "https://github.com/a/b",
]) assert.equal(githubApiTarget(bad), null, bad);

// A fake GitHub and edge cache.
const cache = new Map();
const edge = { match: async (k) => cache.get(k.url)?.clone() ?? null, put: async (k, v) => { cache.set(k.url, v); } };
const seen = [];
const releases = [
  { tag_name: "v5.2", name: "5.2", draft: false, prerelease: false, html_url: "https://github.com/a/b/releases/tag/v5.2", published_at: "2026-11-01T00:00:00Z",
    body: "x".repeat(10000), author: { login: "a", gravatar_id: "" }, assets: [{ name: "B.deb", size: 5, browser_download_url: "https://github.com/a/b/releases/download/v5.2/B.deb", uploader: { login: "a" }, url: "https://api.github.com/x" }] },
  { tag_name: "v6-draft", draft: true, assets: [] },
];
const fetcher = async (url, init) => {
  seen.push({ url, auth: init.headers.Authorization ?? null, ua: init.headers["User-Agent"] });
  if (url.includes("/repos/a/b/releases")) return new Response(JSON.stringify(releases), { status: 200 });
  if (url.endsWith("/repos/a/b")) return new Response(JSON.stringify({ name: "b", description: "d", owner: { login: "a", avatar_url: "https://av/a", id: 1 }, node_id: "x" }), { status: 200 });
  if (url.includes("/repos/limited/")) return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
  return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
};

let r = await githubApi(new URL("https://api.github.com/repos/a/b/releases?per_page=30"), { GITHUB_TOKEN: "tok" }, { fetcher, cache: edge });
assert.equal(r.status, 200);
assert.equal(r.headers.get("cache-control"), `public, max-age=${GITHUB_TTL_S}`);
assert.equal(r.headers.get("x-content-type-options"), "nosniff");
let body = await r.json();
assert.equal(body.length, 1, "drafts dropped");
assert.equal(body[0].body.length, 4000, "notes cut short");
assert.deepEqual(Object.keys(body[0].assets[0]).sort(), ["browser_download_url", "content_type", "name", "size"]);
assert.equal(body[0].author, undefined);
assert.equal(seen[0].auth, "Bearer tok");
assert.ok(seen[0].ua);
// Kept: asked again, GitHub isn't.
r = await githubApi(new URL("https://api.github.com/repos/a/b/releases?per_page=30"), {}, { fetcher, cache: edge });
assert.equal((await r.json()).length, 1);
assert.equal(seen.length, 1);

r = await githubApi(new URL("https://api.github.com/repos/a/b"), {}, { fetcher, cache: edge });
body = await r.json();
assert.deepEqual(body.owner, { login: "a", avatar_url: "https://av/a" });
assert.equal(body.node_id, undefined);
assert.equal(seen.at(-1).auth, null, "no token, no Authorization");

r = await githubApi(new URL("https://api.github.com/repos/a/missing"), {}, { fetcher, cache: edge });
assert.equal(r.status, 404);
assert.deepEqual(await r.json(), { error: "upstream answered HTTP 404", code: "upstream", status: 404 });
assert.equal(cache.has("https://github.ifizbox.internal/repos/a/missing"), false, "an error isn't kept");

r = await githubApi(new URL("https://api.github.com/repos/limited/x"), {}, { fetcher, cache: edge });
assert.equal(r.status, 429);
assert.equal((await r.json()).code, "rate_limited");

assert.deepEqual(trimReleases(null), []);

// Through /api/fetch: a GitHub API URL is answered by this route (a bad one by the plain proxy's checks, never fetched raw).
const realFetch = globalThis.fetch;
const proxied = [];
globalThis.fetch = async (url, init) => { proxied.push(String(url)); return fetcher(String(url), init ?? { headers: {} }); };
try {
  const env = { LOOKUP_CACHE: { match: async () => null, put: async () => {} } };
  r = await w.fetch(new Request(`https://x.test/api/fetch?url=${encodeURIComponent("https://api.github.com/repos/a/b/releases?per_page=30")}`), env);
  assert.equal(r.status, 200);
  assert.equal((await r.json())[0].tag_name, "v5.2");
  assert.deepEqual(proxied, ["https://api.github.com/repos/a/b/releases?per_page=30"]);
} finally {
  globalThis.fetch = realFetch;
}
console.log("worker github: ok");
