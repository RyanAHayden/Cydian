// Site backend: fetches go through the Worker's SSRF-safe proxy, /api/fetch (worker/src/index.js), because most repos
// send no CORS headers. The app build swaps this for backend-native.js, which fetches directly.
//
//   const backend = createHttpBackend();
//   const { text, source, cached } = await backend.packages("https://repo.example.com/");
//   const res = await backend.fetch("https://repo.example.com/CydiaIcon.png");  // a Response
//
//   await backend.sources();  backend.addSource(url);  backend.removeSource(key);  backend.refreshSources(onEach)
//
// Failures throw BackendError with the proxy's `code` (bad_url, refused, too_large, timeout, upstream,
// not_found, network, rate_limited) and, for code "upstream", the repo's HTTP `status`.

import { freshUrl } from "./core/sources.js";
import { sourceCalls, sortSources, DEFAULT_ALT_SOURCES } from "./core/sources.js";
import { withAltSources } from "./core/altstore.js";
import { validatorCache } from "./core/health.js";
import { reviewsApi } from "./core/reviews.js";

export class BackendError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

// `sourceOptions` go to core/sources.js sourceCalls (indexedDB, arch, count): the source list lives in this
// browser's IndexedDB, the same code the app runs.
export function createHttpBackend({ base = "", fetchFn = globalThis.fetch.bind(globalThis), sourceOptions = {} } = {}) {
  const endpoint = (params) => `${base}/api/fetch?${new URLSearchParams(params.url ? { ...params, url: freshUrl(params.url) } : params)}`;

  // F19: the proxy answers with an ETag (and the repo's Last-Modified); text() sends them back, and a 304 reuses
  // the text kept here, so a Release that hasn't changed costs no transfer.
  const validators = validatorCache();

  async function call(params, headers = null) {
    let res;
    try {
      res = await (headers ? fetchFn(endpoint(params), { headers }) : fetchFn(endpoint(params)));
    } catch (e) {
      throw new BackendError("network", `cannot reach the server: ${e.message}`);
    }
    if (res.status === 304 && headers) return res;
    if (!res.ok) {
      let body = {};
      try {
        body = await res.json();
      } catch {
        // not JSON: a proxy in front of us answered
      }
      throw new BackendError(body.code || (res.status === 429 ? "rate_limited" : "network"),
        body.error || `server answered HTTP ${res.status}`, body.status);
    }
    return res;
  }

  const backend = {
    kind: "http",
    // The raw Response for any http(s) URL. HTML and other active types come back as application/octet-stream.
    fetch: (url) => call({ url }),
    // A URL an <img> can load the remote image through (repo icons): the proxy, since it's on our origin.
    assetUrl: (url) => endpoint({ url }),
    async text(url) {
      const cond = validators.headers(url);
      const res = await call({ url }, Object.keys(cond).length ? cond : null);
      if (res.status === 304) {
        const kept = validators.reuse(url);
        if (kept !== undefined) return kept;
        return (await call({ url })).text(); // forgotten meanwhile: ask again in full
      }
      const text = await res.text();
      validators.store(url, res.headers, text);
      return text;
    },
    // A repo's Packages index as plain text: the server tries Packages.xz, .bz2, .gz, then plain in `repoDir`
    // (a flat repo's URL, or a dists/<suite>/<component>/binary-<arch>/ directory) and caches it 30 minutes.
    async packages(repoDir) {
      const res = await call({ url: repoDir, kind: "packages" });
      return {
        text: await res.text(),
        source: res.headers.get("X-Source-URL") || repoDir,
        cached: res.headers.get("X-Cache") === "HIT",
      };
    },
  };
  // F182: user reviews, on the same server as the proxy (core/reviews.js; worker/src/reviews.js).
  backend.reviews = reviewsApi({ base, fetcher: fetchFn });
  // AltStore sources (F9) sit beside the APT list, in their own store (core/altstore.js withAltSources).
  return Object.assign(backend, withAltSources(sourceCalls(backend, sourceOptions), backend, { altDefaults: DEFAULT_ALT_SOURCES, ...sourceOptions, sort: sortSources }));
}
