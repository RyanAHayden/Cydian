// Sources > Manage: the nav bar's Manage button opens #/sources/manage, and that page draws its rows. Find More
// Sources asked for a row icon that did not exist ("globe" is a glyph, not a ROW_ICONS name), so wherever Find More
// shows (jailbroken, or the sideload app's Tweak Sources) the page threw and stayed blank.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeDocument, fakePage, memStorage, tick } from "../fakes.test-helper.js";
import { ROW_ICONS } from "../icons/rowicons.js";

// The website's backend and settings, over storage that says jailbroken; set before the screens load.
globalThis.localStorage = memStorage({ "ifizbox.device": "iphoneos-arm64" }); // Settings > Device: rootless
globalThis.document = fakeDocument();
globalThis.CSS ??= { escape: (s) => String(s) };
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
delete globalThis.ifizboxNative;
const sources = await import("./sources.js");
const { format } = await import("../router.js");

const labels = (el) => el.querySelectorAll(".cell-label").map((n) => n.textContent);

function openManage() {
  const went = [];
  const ctx = { go: (r) => went.push(r), setBadge() {}, setTitle() {} };
  const bar = sources.nav({ tab: "sources", path: [] }, ctx);
  const button = [bar.right].flat().find((b) => b.label === "Manage");
  assert.ok(button, "the Sources nav bar has Manage");
  button.onClick({ currentTarget: null });
  assert.equal(went.length, 1, "Manage goes somewhere");
  return { route: went[0], ctx };
}

test("Manage opens #/sources/manage with its rows (jailbroken: Find More Sources too)", async () => {
  const { route, ctx } = openManage();
  assert.equal(format(route), "#/sources/manage");
  assert.equal(sources.nav(route, ctx).title, "Manage");
  const body = fakePage();
  sources.render(body, route, ctx); // threw "no row icon globe"
  await tick();
  const rows = labels(body);
  for (const l of ["Sources", "Import & Export", "Hidden", "Recommended", "Find More Sources"]) {
    assert.ok(rows.some((r) => r.startsWith(l)), `Manage lists ${l} (got ${rows.join(", ")})`);
  }
});

test("Manage, not jailbroken: the same rows without Find More Sources", async () => {
  globalThis.localStorage.setItem("ifizbox.device", "none");
  try {
    const { route, ctx } = openManage();
    const body = fakePage();
    sources.render(body, route, ctx);
    await tick();
    const rows = labels(body);
    assert.ok(rows.some((r) => r.startsWith("Recommended")), rows.join(", "));
    assert.ok(!rows.some((r) => r.startsWith("Find More")), "no Find More where APT repos aren't kept");
  } finally {
    globalThis.localStorage.setItem("ifizbox.device", "iphoneos-arm64");
  }
});

// The general guard: rowIcon("x") with a name tileSvg does not know throws on draw, blanking the whole page.
test("every rowIcon(\"…\") in web/app names a ROW_ICONS entry", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      if (f === "vendor" || f === "node_modules") continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".js") && !f.endsWith(".test.js")) files.push(p);
    }
  };
  walk(root);
  const missing = [];
  for (const p of files) {
    for (const [, name] of readFileSync(p, "utf8").matchAll(/rowIcon\("([A-Za-z]+)"\)/g)) {
      if (!ROW_ICONS[name]) missing.push(`${p.slice(root.length)}: ${name}`);
    }
  }
  assert.deepEqual(missing, []);
});
