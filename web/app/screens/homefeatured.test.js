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
  globalThis.document = { createElement: fakeEl };
  try { return await fn(); } finally { globalThis.document = saved; }
}

test("F135: Settings is Home's first group, its row with our gear at the left", () => {
  const [first, ...rest] = homeLinks();
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].label, "Settings");
  assert.equal(first.rows[0].icon.src, SETTINGS_ICON);
  assert.ok(rest.every((g) => g.rows?.every((r) => r.label !== "Settings")), "Settings only once");
  assert.equal(rest.at(-1).rows[0].label, "Credits / Thank You");
});

test("F135: the gear is our own SVG, 29pt, grey, with its rounded square; Home's CSS sizes it in the row", () => {
  assert.equal(SETTINGS_ICON, "icons/settings.svg");
  const svg = read("../icons/settings.svg");
  assert.match(svg, /viewBox="0 0 58 58"/);
  assert.match(svg, /width="29" height="29"/);
  assert.match(svg, /<rect[^>]+rx=/, "the icon's rounded square");
  assert.match(svg, /stroke-dasharray/, "the gear's teeth");
  assert.doesNotMatch(svg, /<image|base64/, "drawn, not a pasted bitmap");
  assert.match(read("../home.css"), /\.home-settings-row \.cell-icon img \{[^}]*width: 100%/);
});

test("F154: no horizontal scroller of banners on Home or Browse, in any build", () => {
  for (const m of ["jailbreak", "site", "sideload"]) {
    assert.equal(homeShowsFeatured(m), false, m);
    assert.equal(browseShowsFeatured(m), false, m);
  }
  // Home's root, its Reload, its Featured page and Browse draw no homeFeatured() strip at all.
  assert.doesNotMatch(read("./home.js"), /homeFeatured\(/);
  const browse = read("./browse.js");
  const home = browse.slice(browse.indexOf("// ---- Browse (F154)"));
  assert.doesNotMatch(home, /homeFeatured|featuredStrip|featured-row/, "Browse's page: the Tweak of the Day card instead");
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
