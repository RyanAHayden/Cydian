// B43: Installed's pushed pages open on their defaults; Back and the tab's root keep their choice.
// C25: each apps or dpkg page has a view of its own, made by nav() for that page: a new page is a new view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nav, pageStates, pageKind, APPS, DPKG } from "./installed.js";
import { pageOpened } from "../nav/pagestate.js";
import { createStacks } from "../nav/stack.js";
import { fakeDocument } from "../nav/fakedom.test-helper.js";

globalThis.document ??= fakeDocument(); // nav() builds the title's User | Recent control

// Each page built gets nav()'s view (app.js drawPage calls nav, then render, which takes it over).
const build = () => createStacks({ tabs: ["installed", "search"], create: (tab, path) => {
  const route = { tab, path };
  pageOpened(route);
  nav(route, {});
  const kind = pageKind(route);
  return { view: kind === "apps" ? pageStates().apps : kind === "dpkg" ? pageStates().dpkg : null, wish: pageStates().wish };
} });
const viewAt = (stacks, tab = "installed") => stacks.top(tab).page.view;

function withMode(mode, fn) {
  const was = globalThis.ifizboxNative;
  globalThis.ifizboxNative = mode === "site" ? undefined : { mode };
  try { fn(); } finally { globalThis.ifizboxNative = was; }
}

test("jailbreak: the apps page pushed from Installed opens on User, empty, out of Edit; Back keeps it", () => withMode("jailbreak", () => {
  const stacks = build();
  stacks.sync({ tab: "installed", path: [] });
  const dpkg = viewAt(stacks);
  dpkg.mode = "expert"; // the root's own choice
  dpkg.type = "Tweaks";
  stacks.sync({ tab: "installed", path: [APPS] });
  const apps = viewAt(stacks);
  Object.assign(apps, { mode: "recent", query: "ma", editing: true });
  stacks.sync({ tab: "installed", path: [APPS, "app:com.x"] });
  stacks.sync({ tab: "installed", path: [APPS] }); // Back
  assert.equal(viewAt(stacks), apps);
  assert.deepEqual([apps.mode, apps.query, apps.editing], ["recent", "ma", true], "Back from an app: as it was");
  stacks.sync({ tab: "search", path: [] });
  stacks.sync({ tab: "installed", path: [APPS] });
  assert.equal(viewAt(stacks).mode, "recent", "a tab switch keeps it");
  stacks.sync({ tab: "installed", path: [] }); // Back to the root
  assert.equal(viewAt(stacks), dpkg);
  assert.deepEqual([dpkg.mode, dpkg.type], ["expert", "Tweaks"], "the tab root keeps its choice");
  stacks.sync({ tab: "installed", path: [APPS] }); // pushed again
  const again = viewAt(stacks);
  assert.notEqual(again, apps);
  assert.deepEqual([again.mode, again.query, again.editing], ["user", "", false]);
  assert.deepEqual([dpkg.mode, dpkg.type], ["expert", "Tweaks"], "pushing the apps page leaves the root alone");
}));

test("the site: the dpkg page pushed from Installed opens on User / All; the Wish List out of Edit", () => withMode("site", () => {
  const stacks = build();
  stacks.sync({ tab: "installed", path: [] });
  const apps = viewAt(stacks);
  apps.mode = "recent"; // the site's root is the apps list
  stacks.sync({ tab: "installed", path: [DPKG] });
  Object.assign(viewAt(stacks), { mode: "expert", type: "Themes", query: "x" });
  stacks.sync({ tab: "installed", path: [] });
  stacks.sync({ tab: "installed", path: [DPKG] });
  const dpkg = viewAt(stacks);
  assert.deepEqual([dpkg.mode, dpkg.type, dpkg.query], ["user", "All", ""]);
  assert.equal(apps.mode, "recent", "the root keeps User | Recent");
  stacks.sync({ tab: "installed", path: [] });
  stacks.sync({ tab: "installed", path: ["wishlist"] });
  const { wish } = pageStates();
  wish.editing = true;
  stacks.sync({ tab: "installed", path: [] });
  stacks.sync({ tab: "installed", path: ["wishlist"] });
  assert.equal(wish.editing, false);
}));

test("C25: two copies of the root (its tab, and pushed on Home) keep their own mode, search and Manage", () => withMode("sideload", () => {
  nav({ tab: "installed", path: [] }, {});
  const tab = pageStates().apps;
  nav({ tab: "installed", path: [] }, {}); // the copy pushed on Home: mounted to the same route
  const home = pageStates().apps;
  assert.notEqual(tab, home);
  Object.assign(tab, { mode: "recent", query: "del" });
  assert.deepEqual([home.mode, home.query], ["user", ""]);
}));
