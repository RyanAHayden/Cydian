// B29: the install log on the progress page. The shell's {log} lines reach the console from library.install (My
// IPAs) and from signing.progress, which carries the install server's lines (InstallLog in Sideload.swift: the
// bundle ID, each request iOS makes for the IPA and the bytes it got) after the install call has answered.
// A log line is not progress: it mustn't end the follow of iOS's install (B27's mid-install rounds).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { followInstall } from "./signing-sheet.js";
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

test("followInstall: the install server's lines go to the console, and one after progress doesn't end the follow", async () => {
  let round = 0;
  const native = fakeNative({
    "signing.progress": (p, on) => {
      round++;
      if (round === 1) {
        on({ log: "iOS: GET Range: bytes=43643958-43709493 -> 206, bytes 43643958-43709493 of 43709494" });
        on({ phase: "installing", progress: 0.4 });
        on({ log: "Sent bytes 0-43709493; iOS has 43709494 of 43709494 bytes (all of it)" });
        return { installed: false }; // iOS between its stages: followed again (B27)
      }
      on({ phase: "installing", progress: 1 });
      return { installed: true };
    },
  });
  const h = fakeHUD();
  assert.equal(await followInstall(native, "io.github.fizl0.hst.beta", h, { later: () => {} }), true);
  assert.equal(round, 2, "the log line after 40% didn't end the follow");
  assert.equal(h.lines.length, 2);
  assert.match(h.lines[0], /^iOS: GET Range: bytes=/);
  assert.match(h.lines[1], /all of it/);
  assert.ok(h.labels.includes("Installing 40%"));
  assert.ok(!h.labels.some((l) => /NaN/.test(l)), h.labels.join(", "));
  assert.equal(h.labels.at(-1), "Installed");
});

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
