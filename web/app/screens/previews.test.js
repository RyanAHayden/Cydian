// F122: the gallery's pictures (sized by aspect, a blocked https picture retried through the site's proxy, an icon
// dropped) and where previews' text is fetched from, over a small fake DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { galleryImage, previewText } from "./altstore.js";

function fakeImg() {
  const classes = new Set();
  return {
    tagName: "IMG", style: {}, attrs: {}, src: "", naturalWidth: 0, naturalHeight: 0, removed: false,
    set className(v) { classes.clear(); for (const c of String(v).split(" ").filter(Boolean)) classes.add(c); },
    classList: { add: (c) => classes.add(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    closest: () => null, remove() { this.removed = true; },
  };
}

function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = { createElement: fakeImg };
  try { return fn(); } finally { globalThis.document = saved; }
}

const http = { kind: "http", assetUrl: (u) => `/api/fetch?url=${encodeURIComponent(u)}`, text: async (u) => `proxy:${u}` };

test("galleryImage: eager (B54: it loads off the page), the source's aspect, else the picture's own; landscape is wide", () => withDom(() => {
  const a = galleryImage({ url: "https://x.dev/a.png", width: 1179, height: 2556 }, { backend: () => http });
  assert.equal(a.loading, "eager");
  assert.equal(a.style.aspectRatio, "1179 / 2556");
  assert.equal(a.classList.contains("wide"), false);
  const b = galleryImage({ url: "https://x.dev/b.png" }, { backend: () => http });
  b.naturalWidth = 2048; b.naturalHeight = 1536; b.onload();
  assert.equal(b.style.aspectRatio, "2048 / 1536");
  assert.equal(b.classList.contains("wide"), true);
  const icon = galleryImage({ url: "https://x.dev/c.png" }, { backend: () => http });
  icon.naturalWidth = 60; icon.naturalHeight = 60; icon.onload();
  assert.equal(icon.removed, true, "a picture icon-sized after all is dropped");
  assert.equal(galleryImage({ url: "javascript:alert(1)" }), null);
}));

test("galleryImage: an https picture that fails retries once through the site's proxy, then goes", () => withDom(() => {
  const i = galleryImage({ url: "https://x.dev/a.png" }, { backend: () => http });
  assert.equal(i.src, "https://x.dev/a.png");
  i.onerror();
  assert.equal(i.src, "/api/fetch?url=https%3A%2F%2Fx.dev%2Fa.png");
  assert.equal(i.removed, false);
  i.onerror();
  assert.equal(i.removed, true);
  const n = galleryImage({ url: "https://x.dev/a.png" }, { backend: () => ({ kind: "native", assetUrl: (u) => u }) });
  n.onerror();
  assert.equal(n.removed, true, "the app has no proxy to try");
}));

test("previewText: GitHub's CORS hosts straight from the browser, the rest (and a failed connect) through the backend", async () => {
  const asked = [];
  const fetchFn = async (u, o) => { asked.push([u, o?.headers?.Accept ?? null]); return { ok: true, text: async () => `direct:${u}` }; };
  assert.equal(await previewText("https://raw.githubusercontent.com/o/r/HEAD/README.md", { backend: http, fetchFn }), "direct:https://raw.githubusercontent.com/o/r/HEAD/README.md");
  assert.equal(await previewText("https://api.github.com/repos/o/r/releases/latest", { backend: http, fetchFn }), "direct:https://api.github.com/repos/o/r/releases/latest");
  assert.equal(asked[1][1], "application/vnd.github+json");
  assert.equal(await previewText("https://repo.dev/dep.html", { backend: http, fetchFn }), "proxy:https://repo.dev/dep.html");
  const down = async () => { throw new TypeError("Failed to fetch"); };
  assert.equal(await previewText("https://raw.githubusercontent.com/o/r/HEAD/README.md", { backend: http, fetchFn: down }), "proxy:https://raw.githubusercontent.com/o/r/HEAD/README.md");
  const missing = async () => ({ ok: false, status: 404 });
  await assert.rejects(previewText("https://raw.githubusercontent.com/o/r/HEAD/README.md", { backend: http, fetchFn: missing }), /404/);
  const native = { kind: "native", text: async (u) => `native:${u}` };
  assert.equal(await previewText("https://api.github.com/repos/o/r/readme", { backend: native, fetchFn }), "native:https://api.github.com/repos/o/r/readme");
});
