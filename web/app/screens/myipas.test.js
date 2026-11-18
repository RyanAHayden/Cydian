// F77: My IPAs' routes (screens/myipas.js) and the link another app's .ipa opens (incoming.js).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pageOf, nav } from "./myipas.js";
import { myIpasPath, handleIncoming } from "../incoming.js";

const r = (...path) => ({ tab: "installed", path });
const saved = globalThis.ifizboxNative;
afterEach(() => { if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved; });

test("My IPAs' pages", () => {
  globalThis.ifizboxNative = { mode: "sideload", call: async () => null };
  assert.equal(pageOf(r()), null);
  assert.equal(pageOf(r("package:x")), null);
  assert.deepEqual(pageOf(r("myipas")), { page: "list" });
  assert.deepEqual(pageOf(r("myipas", "ipa:A b.ipa")), { page: "ipa", file: "A b.ipa" });
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa", "options")), { page: "options", file: "A.ipa" });
  assert.deepEqual(pageOf(r("myipas", "junk")), { page: "missing" });
  assert.deepEqual(nav(r("myipas")).right.map((b) => b.label), ["Add", "Edit"]); // F208: Edit beside Add
  assert.equal(nav(r("myipas", "ipa:A b.ipa")).title, "A b");
  assert.equal(nav(r("myipas", "ipa:A b.ipa")).right.label, "Install");
  assert.equal(nav(r("myipas", "ipa:A.ipa", "options")).title, "Sign Options");
});

test("the website has no Sign Options page (the Signing Server signs as the IPA is)", () => {
  delete globalThis.ifizboxNative;
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa", "options")), { page: "missing" });
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa")), { page: "ipa", file: "A.ipa" });
});

test("an .ipa another app sent opens its page in My IPAs", async () => {
  assert.deepEqual(myIpasPath("ifizbox://myipas?file=My%20App.ipa"), ["myipas", "ipa:My App.ipa"]);
  assert.deepEqual(myIpasPath("ifizbox://myipas?file=..%2Fx.ipa"), ["myipas"]);
  assert.deepEqual(myIpasPath("ifizbox://myipas?file=notes.txt"), ["myipas"]);
  assert.deepEqual(myIpasPath("ifizbox://myipas"), ["myipas"]);
  assert.equal(await handleIncoming("ifizbox://myipas?file=A.ipa"), "myipas");
});

// F79: My IPAs became Install IPAs: Browse (AltStore apps) first, then the user's own IPAs.
test("Install IPAs: the page's title, Add, and Browse's pages below it", async () => {
  const { PAGE_TITLE } = await import("./myipas.js");
  globalThis.ifizboxNative = { mode: "sideload", call: async () => null };
  assert.equal(PAGE_TITLE, "Install IPAs");
  assert.equal(nav(r("myipas")).title, "Install IPAs");
  assert.equal(nav(r("myipas")).right[0].label, "Add");
  assert.deepEqual(pageOf(r("myipas", "search")), { page: "search" });
  assert.deepEqual(pageOf(r("myipas", "apps")), { page: "apps" });
  assert.deepEqual(pageOf(r("myipas", "category:Games")), { page: "category", value: "Games" });
  assert.deepEqual(pageOf(r("myipas", "category:Games", "package:com.a")), { page: "browse" });
  assert.deepEqual(pageOf(r("myipas", "search", "package:com.a")), { page: "browse" });
  assert.equal(nav(r("myipas", "search")).title, "Search Apps");
  assert.equal(nav(r("myipas", "apps")).title, "All Apps");
  assert.equal(nav(r("myipas", "category:Photo & Video")).title, "Photo & Video");
  assert.equal(nav(r("myipas", "apps", "package:com.a")).right.label, "Install"); // browse.js's app page
  // an IPA's own pages are unchanged
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa")), { page: "ipa", file: "A.ipa" });
  // the website has the same Browse
  delete globalThis.ifizboxNative;
  assert.equal(nav(r("myipas")).title, "Install IPAs");
  assert.deepEqual(pageOf(r("myipas", "search")), { page: "search" });
});

test("Install IPAs' Browse section: All Apps and the categories of the AltStore apps only", async () => {
  const { browseGroups, appsOf, libraryEmptyText } = await import("./myipas.js");
  const rows = [
    { id: "a", name: "Delta", short: "Game emulator", section: "Apps (Games)", kind: "ipa" },
    { id: "b", name: "Provenance", section: "Apps (Games)", kind: "ipa" },
    { id: "c", name: "UTM", section: "Apps (Developer)", kind: "ipa" },
    { id: "d", name: "A Tweak", section: "Tweaks" }, // APT: not an IPA
  ];
  const apps = appsOf(rows);
  assert.deepEqual(apps.map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(appsOf(null), []);
  const [top, cats] = browseGroups(apps);
  assert.equal(top.header, "Browse");
  assert.deepEqual(top.rows.map((x) => x.label), ["All Apps"]); // the page's search bar replaced Search Apps
  assert.equal(top.rows[0].detail, "3");
  assert.equal(top.rows[0].href, "#/installed/myipas/apps");
  assert.deepEqual(cats.rows.map((x) => [x.label, x.detail]), [["Games", "1"], ["Emulators", "1"], ["Developer", "1"]]);
  assert.equal(cats.rows[0].href, "#/installed/myipas/category%3AGames");
  // loading, and no AltStore source
  assert.deepEqual(browseGroups(null)[0].rows.map((x) => x.label), ["All Apps"]); // placeholders while loading
  assert.equal(browseGroups(null)[1].rows.length, 4);
  const none = browseGroups([]);
  assert.equal(none.length, 1);
  assert.match(none[0].footer, /AltStore source/);
  assert.match(libraryEmptyText(true), /AltStore, SideStore or Feather/);
  assert.match(libraryEmptyText(false), /On My iPhone > iFizBox/);
});

test("Install IPAs: a list's search bar matches name, description, developer or ID", async () => {
  const { matchApp } = await import("./myipas.js");
  const r = { id: "com.x.delta", name: "Delta", short: "Game emulator", author: "Riley" };
  assert.ok(matchApp(r, "delt") && matchApp(r, "EMUL") && matchApp(r, "riley") && matchApp(r, "com.x"));
  assert.equal(matchApp(r, "utm"), false);
});
