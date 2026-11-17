// Site backend: fetches go through the server's SSRF-safe proxy, /api/fetch (web/fetch.py), because most repos
// send no CORS headers. The app build swaps this for backend-native.js, which fetches directly.
//
//   const backend = createHttpBackend();
//   const { text, source, cached } = await backend.packages("https://repo.example.com/");
//   const res = await backend.fetch("https://repo.example.com/CydiaIcon.png");  // a Response
//
// Failures throw BackendError with the proxy's `code` (bad_url, refused, too_large, timeout, upstream,
// not_found, network, rate_limited) and, for code "upstream", the repo's HTTP `status`.

export class BackendError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export function createHttpBackend({ base = "", fetchFn = globalThis.fetch.bind(globalThis) } = {}) {
  const endpoint = (params) => `${base}/api/fetch?${new URLSearchParams(params)}`;

  async function call(params) {
    let res;
    try {
      res = await fetchFn(endpoint(params));
    } catch (e) {
      throw new BackendError("network", `cannot reach the server: ${e.message}`);
    }
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

  return {
    kind: "http",
    // The raw Response for any http(s) URL. HTML and other active types come back as application/octet-stream.
    fetch: (url) => call({ url }),
    async text(url) {
      return (await call({ url })).text();
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
}
