import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpBackend, BackendError } from "./backend-http.js";

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return handler(new URL(url, "http://site.test"));
  };
  return { fn, calls };
}

test("packages() asks the proxy with kind=packages and reads the headers", async () => {
  const { fn, calls } = fakeFetch(() => new Response("Package: a\n", {
    headers: { "X-Source-URL": "https://r.test/Packages.xz", "X-Cache": "HIT" },
  }));
  const b = createHttpBackend({ fetchFn: fn });
  const r = await b.packages("https://r.test/");
  assert.deepEqual(r, { text: "Package: a\n", source: "https://r.test/Packages.xz", cached: true });
  const u = new URL(calls[0], "http://site.test");
  assert.equal(u.pathname, "/api/fetch");
  assert.equal(u.searchParams.get("url"), "https://r.test/");
  assert.equal(u.searchParams.get("kind"), "packages");
});

test("errors carry the proxy's code and upstream status", async () => {
  const { fn } = fakeFetch(() => Response.json({ error: "upstream answered HTTP 404", code: "upstream", status: 404 },
    { status: 502 }));
  const b = createHttpBackend({ fetchFn: fn });
  await assert.rejects(b.text("https://r.test/x"), (e) => e instanceof BackendError && e.code === "upstream" &&
    e.status === 404);
});

test("non-JSON 429 and network failures map to codes", async () => {
  let b = createHttpBackend({ fetchFn: async () => new Response("slow down", { status: 429 }) });
  await assert.rejects(b.text("https://r.test/"), { code: "rate_limited" });
  b = createHttpBackend({ fetchFn: async () => { throw new TypeError("offline"); } });
  await assert.rejects(b.text("https://r.test/"), { code: "network" });
});
