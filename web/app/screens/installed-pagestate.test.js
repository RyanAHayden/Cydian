// B43: Installed's pushed pages open on their defaults; Back and the tab's root keep their choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageStates, APPS, DPKG } from "./installed.js";
import { pageOpened } from "../nav/pagestate.js";
import { createStacks } from "../nav/stack.js";

const build = () => createStacks({ tabs: ["installed", "search"], create: (tab, path) => { pageOpened({ tab, path }); return {}; } });

function withMode(mode, fn) {
  const was = globalThis.ifizboxNative;
  globalThis.ifizboxNative = mode === "site" ? undefined : { mode };
  try { fn(); } finally { globalThis.ifizboxNative = was; }
}

test("jailbreak: the apps page pushed from Installed opens on User, empty, out of Edit; Back keeps it", () => withMode("jailbreak", () => {
  const { apps, dpkg } = pageStates();
  const stacks = build();
  stacks.sync({ tab: "installed", path: [] });
  dpkg.mode = "expert"; // the root's own choice
  dpkg.type = "Tweaks";
  stacks.sync({ tab: "installed", path: [APPS] });
  Object.assign(apps, { mode: "recent", query: "ma", editing: true });
  stacks.sync({ tab: "installed", path: [APPS, "app:com.x"] });
  stacks.sync({ tab: "installed", path: [APPS] }); // Back
  assert.deepEqual([apps.mode, apps.query, apps.editing], ["recent", "ma", true], "Back from an app: as it was");
  stacks.sync({ tab: "search", path: [] });
  stacks.sync({ tab: "installed", path: [APPS] });
  assert.equal(apps.mode, "recent", "a tab switch keeps it");
  stacks.sync({ tab: "installed", path: [] }); // Back to the root
  assert.deepEqual([dpkg.mode, dpkg.type], ["expert", "Tweaks"], "the tab root keeps its choice");
  stacks.sync({ tab: "installed", path: [APPS] }); // pushed again
  assert.deepEqual([apps.mode, apps.query, apps.editing], ["user", "", false]);
  assert.deepEqual([dpkg.mode, dpkg.type], ["expert", "Tweaks"], "pushing the apps page leaves the root alone");
}));

test("the site: the dpkg page pushed from Installed opens on User / All; the Wish List out of Edit", () => withMode("site", () => {
  const { apps, dpkg, wish } = pageStates();
  const stacks = build();
  stacks.sync({ tab: "installed", path: [] });
  apps.mode = "recent"; // the site's root is the apps list
  stacks.sync({ tab: "installed", path: [DPKG] });
  Object.assign(dpkg, { mode: "expert", type: "Themes", query: "x" });
  stacks.sync({ tab: "installed", path: [] });
  stacks.sync({ tab: "installed", path: [DPKG] });
  assert.deepEqual([dpkg.mode, dpkg.type, dpkg.query], ["user", "All", ""]);
  assert.equal(apps.mode, "recent", "the root keeps User | Recent");
  stacks.sync({ tab: "installed", path: [] });
  stacks.sync({ tab: "installed", path: ["wishlist"] });
  wish.editing = true;
  stacks.sync({ tab: "installed", path: [] });
  stacks.sync({ tab: "installed", path: ["wishlist"] });
  assert.equal(wish.editing, false);
}));
