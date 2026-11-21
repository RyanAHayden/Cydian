// C30: the UI talks to the backend interface (AGENTS.md), not to the shell's bridge. Only backend-native.js and
// native.js (the one accessor, nativeBridge() / hasNativeCall()) may read `globalThis.ifizboxNative`.
// ALLOWED lists the files that still read it directly and how often (comments count too), as they stood when this
// test came in. Each count is a ceiling: a file may drop below it, never rise above it, and a file not listed may not
// read the global at all. When you move reads to getBackend() or native.js, lower or drop that file's line here.
// Never raise a number or add a line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const EXEMPT = new Set(["backend-native.js", "native.js"]);

const ALLOWED = {
  "app.js": 9,
  "app-updates.js": 1,
  "backend.js": 1,
  "catalog.js": 2,
  "core/installed.js": 2,
  "core/push.js": 2,
  "core/reviews.js": 1,
  "device.js": 1,
  "essential-ui.js": 2,
  "incoming.js": 3,
  "ipa-install.js": 3,
  "nav/alert.js": 1,
  "nav/banner.js": 1,
  "nav/menu.js": 2,
  "settings.js": 4,
  "settings-store.js": 2,
  "share.js": 1,
  "signing/common.js": 1,
  "signing/device.js": 1,
  "signing/install.js": 1,
  "signing-sheet.js": 4,
};

// The shipped modules: every .js under web/app but tests, test helpers and vendor/.
function appModules(dir = root) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "vendor" && e.name !== "node_modules") out.push(...appModules(p)); }
    else if (e.name.endsWith(".js") && !/\.test(-helper)?\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

const READ = /globalThis\s*(?:\.\s*ifizboxNative\b|\[\s*["'`]ifizboxNative["'`]\s*\])/g;

function directReads() {
  const counts = {};
  for (const p of appModules()) {
    const rel = relative(root, p).split("\\").join("/");
    if (EXEMPT.has(rel)) continue;
    const n = (readFileSync(p, "utf8").match(READ) ?? []).length;
    if (n) counts[rel] = n;
  }
  return counts;
}

test("no file reads globalThis.ifizboxNative more often than its allowlist line says", () => {
  const over = Object.entries(directReads())
    .filter(([f, n]) => n > (ALLOWED[f] ?? 0))
    .map(([f, n]) => `${f}: ${n} (allowed ${ALLOWED[f] ?? 0}; use getBackend() or native.js nativeBridge())`);
  assert.deepEqual(over, []);
});

test("the total of direct reads stays at or below the allowlist's", () => {
  const total = Object.values(directReads()).reduce((a, b) => a + b, 0);
  const allowed = Object.values(ALLOWED).reduce((a, b) => a + b, 0);
  assert.ok(total <= allowed, `${total} direct reads, allowlist ${allowed}`);
});

test("screens/installed.js reads the bridge only through native.js", () => {
  assert.equal(directReads()["screens/installed.js"] ?? 0, 0);
  const src = readFileSync(join(root, "screens/installed.js"), "utf8");
  assert.match(src, /from "\.\.\/native\.js"/);
});

test("no screen reads the bridge off globalThis: screens/ go through native.js or getBackend()", () => {
  const screens = Object.keys(directReads()).filter((f) => f.startsWith("screens/"));
  assert.deepEqual(screens, []);
  assert.ok(!Object.keys(ALLOWED).some((f) => f.startsWith("screens/")), "screens/ has no allowlist lines");
});

test("nativeBridge() and hasNativeCall() read the global at call time", async () => {
  const { nativeBridge, hasNativeCall } = await import("./native.js");
  const before = globalThis.ifizboxNative;
  try {
    delete globalThis.ifizboxNative;
    assert.equal(nativeBridge(), undefined);
    assert.equal(hasNativeCall(), false);
    const bridge = { call: async () => null };
    globalThis.ifizboxNative = bridge;
    assert.equal(nativeBridge(), bridge);
    assert.equal(hasNativeCall(), true);
    globalThis.ifizboxNative = { mode: "sideload" };
    assert.equal(hasNativeCall(), false);
  } finally {
    if (before === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = before;
  }
});
