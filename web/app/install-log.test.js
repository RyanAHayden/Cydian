// B29: the install log on the progress page. The shell's {log} lines reach the console from library.install (My
// IPAs). Once iOS has the link the page ends on Done (user 2026-11-18), so the server's later lines aren't shown.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installFromLibrary } from "./signing-client.js";

function fakeNative(answers = {}) {
  const calls = [];
  return {
    mode: "sideload", calls,
    async call(method, params, onEvent) {
      calls.push({ method, params });
      const a = answers[method];
      if (a instanceof Error) throw a;
      return typeof a === "function" ? a(params, onEvent) : a ?? null;
    },
  };
}
function fakeHUD() {
  const h = { labels: [], lines: [], hidden: 0 };
  h.set = (x) => h.labels.push(x);
  h.hide = () => { h.hidden++; };
  h.page = { raw: (t) => h.lines.push(t) };
  return h;
}

let saved;
beforeEach(() => { saved = globalThis.ifizboxNative; });
afterEach(() => { if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved; });

test("installFromLibrary: library.install's log (the bundle ID it installs as) reaches the console", async () => {
  const native = fakeNative({
    "library.sign": {},
    "library.install": (p, on) => {
      on({ log: "Bundle ID: io.github.fizl0.hst.beta, version 1.7.2; serving 43.7 MB" });
      on({ phase: "installing", progress: 0 });
      return { bundleId: "io.github.fizl0.hst.beta", name: "OpenTennis Beta", version: "1.7.2" };
    },
  });
  const h = fakeHUD();
  const followed = [];
  const r = await installFromLibrary({ file: "opentennis-beta-p146.ipa", name: "OpenTennis Beta" },
    { native, hud: () => h, alert: async () => assert.fail("no alert"), check: async () => null, reachable: async () => true,
      follow: (n, id) => followed.push(id), later: () => {} });
  assert.equal(r, "installed");
  assert.deepEqual(h.lines, ["Bundle ID: io.github.fizl0.hst.beta, version 1.7.2; serving 43.7 MB"]);
  assert.deepEqual(followed, ["io.github.fizl0.hst.beta"]);
});
