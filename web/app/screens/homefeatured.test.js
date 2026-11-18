// F135: Home's Settings row first with its gear icon, the jailbreak app's Home without the featured banners and its
// Browse page with them, and the banners' placeholder cards while they load (over a small fake DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homeLinks, SETTINGS_ICON, homeShowsFeatured, browseShowsFeatured } from "./home.js";
import { homeFeatured, featuredPlaceholder, FEATURED_PLACEHOLDERS } from "./extras.js";

const here = new URL(".", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, here), "utf8");

function fakeEl(tag) {
  const classes = new Set();
  const e = {
    tagName: tag.toUpperCase(), children: [], style: { setProperty() {} }, attrs: {}, textContent: "",
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); for (const c of String(v).split(" ").filter(Boolean)) classes.add(c); },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute(k, v) { e.attrs[k] = v; },
    append(...kids) { e.children.push(...kids); },
    replaceChildren(...kids) { e.children = [...kids]; },
  };
  return e;
}
async function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = { createElement: fakeEl, createDocumentFragment: () => fakeEl("#fragment") };
  try { return await fn(); } finally { globalThis.document = saved; }
}

test("F135: Settings is Home's first group, its row with our gear at the left", () => {
  const [first, ...rest] = homeLinks();
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].label, "Settings");
  assert.equal(first.rows[0].icon.cls, SETTINGS_ICON);
  assert.ok(rest.every((g) => g.rows?.every((r) => r.label !== "Settings")), "Settings only once");
  assert.equal(rest.at(-1).rows[0].label, "Credits / Thank You");
});

test("F159: the Settings row's gear is a tile glyph with the tiles' padding, so it lines up with them", () => {
  assert.equal(SETTINGS_ICON, "home-glyph glyph-settings");
  const css = read("../home.css");
  const rule = (sel) => css.match(new RegExp(sel.replace(/[.>]/g, (c) => "\\" + c) + " \\{([^}]*)\\}"))?.[1] ?? "";
  const decl = (body, prop) => body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1].trim();
  const tile = rule(".home-tile"), row = rule(".home-settings-row > .cell-inner");
  assert.ok(decl(tile, "padding"), "the tiles set their padding");
  assert.equal(decl(row, "padding"), decl(tile, "padding"), "same left inset as the tiles");
  assert.equal(decl(row, "gap"), decl(tile, "gap"), "same icon-label gap as the tiles");
  const glyph = rule(".glyph-settings");
  assert.match(glyph, /background-color: #8e8e93/, "a grey square");
  assert.match(glyph, /url\("data:image\/svg\+xml,[^"]*fill='%23fff'/, "a white gear drawn inline, as the other glyphs");
  assert.doesNotMatch(css, /settings\.svg/, "no full-bleed bitmap gear left");
});

test("F159: grouped() rows put an icon's cls on the cell-icon", async () => {
  const { grouped } = await import("../nav/ui.js");
  await withDom(async () => {
    const frag = grouped([{ rows: homeLinks()[0].rows }]);
    const find = (n, cls) => (n.className?.split?.(" ").includes(cls) ? n : (n.children ?? []).map((c) => find(c, cls)).find(Boolean));
    const icon = find(frag, "cell-icon");
    assert.ok(icon, "the Settings row draws an icon");
    assert.deepEqual(icon.className.split(" "), ["cell-icon", "home-glyph", "glyph-settings"]);
    assert.equal((icon.children ?? []).length, 0, "no <img>: the glyph is the span's own background");
  });
});

test("F135: the jailbreak app's Home drops the banners and its Browse page shows them; the site and sideload keep Home's", () => {
  assert.equal(homeShowsFeatured("jailbreak"), false);
  assert.equal(browseShowsFeatured("jailbreak"), true);
  for (const m of ["site", "sideload"]) {
    assert.equal(homeShowsFeatured(m), true, m);
    assert.equal(browseShowsFeatured(m), false, m);
  }
  // Home's root and Browse's page draw them by those answers (the render code itself needs the whole app's DOM).
  const src = read("./home.js");
  assert.match(src, /box: homeShowsFeatured\(settings\.mode\) \? homeFeatured\(\)/);
  assert.match(src, /if \(!homeShowsFeatured\(settings\.mode\)\) return;\n\s+const box = homeFeatured\(\);/, "Reload doesn't bring them back");
  const browse = src.slice(src.indexOf("async function renderBrowse(body)"));
  assert.match(browse.slice(0, browse.indexOf("\n}\n")), /^\s+if \(browseShowsFeatured\(settings\.mode\)\) body\.append\(homeFeatured\(\)\);/m);
  assert.ok(browse.indexOf("browseShowsFeatured") < browse.indexOf("box.replaceChildren(grouped"), "at the top, above the lists");
});

test("F135: placeholder cards the banners' size while they load, then the banners", () => withDom(async () => {
  const ph = featuredPlaceholder();
  assert.equal(ph.attrs["aria-busy"], "true");
  assert.equal(ph.children.length, FEATURED_PLACEHOLDERS);
  for (const c of ph.children) {
    assert.ok(c.classList.contains("featured-banner"), "the banners' own box: size and corners");
    assert.ok(c.classList.contains("ph-box"), "the app's placeholder look");
  }
  let land;
  const box = homeFeatured({ deviceType: () => "rootless", sources: async () => [{ key: "k" }],
    forHome: () => new Promise((r) => { land = r; }) });
  assert.equal(box.children.length, 1);
  assert.ok(box.children[0].classList.contains("featured-ph"), "placeholders, not empty or a spinner");
  await new Promise((r) => setTimeout(r, 0));
  land([{ key: "k", package: "p", title: "P", url: "https://x.dev/b.png" }]);
  await box.ready;
  assert.equal(box.children.length, 1);
  assert.ok(box.children[0].classList.contains("featured-row"));
  assert.equal(box.children[0].classList.contains("featured-ph"), false, "the banners took the placeholders' place");
  assert.equal(box.children[0].children.length, 1);
}));

test("F135: no banners or a failure empties the scroller; Not Jailbroken shows no placeholders at all", () => withDom(async () => {
  const none = homeFeatured({ deviceType: () => "rootless", sources: async () => [], forHome: async () => [] });
  await none.ready;
  assert.equal(none.children.length, 0);
  const bad = homeFeatured({ deviceType: () => "rootless", sources: async () => { throw new Error("down"); } });
  await bad.ready;
  assert.equal(bad.children.length, 0);
  const off = homeFeatured({ deviceType: () => "none" });
  assert.equal(off.children.length, 0);
}));
