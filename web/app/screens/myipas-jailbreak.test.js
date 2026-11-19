// F212: My IPAs in the jailbreak app: the shell's library (library.*), installed by ifizbox-helper, no sideloaders.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pageOf, listMode, libraryEmptyText, jailbreakIpaGroups, helperBridge, jailbreakInstall } from "./myipas.js";

const r = (...path) => ({ tab: "installed", path });
const saved = globalThis.ifizboxNative;
afterEach(() => { if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved; });

test("F212: the jailbreak app lists the shell's library, the website its own, the sideload app the shell's", () => {
  globalThis.ifizboxNative = { mode: "jailbreak", call: async () => null };
  assert.equal(listMode(), "jailbreak");
  globalThis.ifizboxNative = { call: async () => null }; // a shell that doesn't say: the jailbreak app (detectMode)
  assert.equal(listMode(), "jailbreak");
  globalThis.ifizboxNative = { mode: "sideload", call: async () => null };
  assert.equal(listMode(), "sideload");
  delete globalThis.ifizboxNative;
  assert.equal(listMode(), "site");
});

test("F212: no Sign Options page in the jailbreak app (it doesn't sign)", () => {
  globalThis.ifizboxNative = { mode: "jailbreak", call: async () => null };
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa")), { page: "ipa", file: "A.ipa" });
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa", "options")), { page: "missing" });
});

test("F212: the jailbreak app's empty list offers Files, a download and /var/mobile/Documents, no sideloaders", () => {
  const t = libraryEmptyText(false, { jailbreak: true });
  assert.match(t, /\/var\/mobile\/Documents/);
  assert.match(t, /Files/); // F224: the page's Add an IPA group (no Add button to name)
  assert.doesNotMatch(t, /AltStore|SideStore|Feather|sideload|browser/i);
  assert.match(libraryEmptyText(false), /On My iPhone > iFizBox/); // the sideload app's as before
});

test("F212: an IPA's page in the jailbreak app: details and Delete, nothing about signing", () => {
  let deleted = 0;
  const groups = jailbreakIpaGroups({ file: "A.ipa", name: "A", version: "1.2", bundleId: "a.b", size: 2048, minimumOS: "14.0" }, () => deleted++);
  const labels = groups.flatMap((g) => g.rows.map((x) => x.label));
  assert.deepEqual(labels, ["Version", "Bundle ID", "Size", "Requires", "File", "Delete"]);
  assert.doesNotMatch(JSON.stringify(groups), /[Ss]ign|certificate|AltStore|SideStore|Feather/);
  groups[1].rows[0].onClick();
  assert.equal(deleted, 1);
  assert.match(jailbreakIpaGroups({ file: "B.ipa", error: "no Info.plist" }, () => {})[0].footer, /can't be read: no Info\.plist/);
});

test("F212: Install runs Install IPA's console over library.helperInstall for that file", async () => {
  const calls = [];
  const native = { call: async (m, p, on) => { calls.push([m, p]); on?.({ fd: "status", line: "x" }); return { code: 0, bundleId: "a.b" }; } };
  const b = helperBridge("My App.ipa", native);
  const events = [];
  assert.deepEqual(await b.call("ipa.install", { url: "ignored", stream: true }, (e) => events.push(e)), { code: 0, bundleId: "a.b" });
  assert.deepEqual(calls, [["library.helperInstall", { file: "My App.ipa", stream: true }]]);
  assert.equal(events.length, 1);

  let opened = null;
  const installed = [];
  await jailbreakInstall("My App.ipa", "My App", { native, onInstalled: (x) => installed.push(x), open: async (o) => { opened = o; o.onInstalled({ bundleId: "a.b" }); return { ok: true }; } });
  assert.equal(opened.name, "My App");
  assert.equal(opened.url, "My App.ipa");
  calls.length = 0;
  await opened.native.call("ipa.install", { url: "My App.ipa", stream: true });
  assert.equal(calls[0][0], "library.helperInstall");
  assert.equal(calls[0][1].file, "My App.ipa");
  assert.deepEqual(installed, [{ bundleId: "a.b" }]);
});
