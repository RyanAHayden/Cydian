// F8: every "Open in" link and iFizBox's /add link, exactly as each app's source code reads it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLinks, packageLinks, formatOf, addLink, parseAddLink, siteOrigin, isAddPath, PUBLIC_SITE } from "./handoff.js";

const FLAT = { key: "deb:https://repo.chariz.com/:./", uri: "https://repo.chariz.com/", dist: "./", components: [] };
const DIST = { key: "deb:https://apt.procurs.us/:1800", uri: "https://apt.procurs.us/", dist: "1800", components: ["main", "extra"] };
const ALT = { key: "alt:https://example.com/apps.json", kind: "altstore", uri: "https://example.com/apps.json" };
const byApp = (list) => Object.fromEntries(list.map((l) => [l.app, l.url]));

test("format: alt: keys and kind altstore are AltStore, everything else APT", () => {
  assert.equal(formatOf(FLAT), "apt");
  assert.equal(formatOf(ALT), "altstore");
  assert.equal(formatOf({ key: "alt:https://x/y.json" }), "altstore");
});

test("flat APT source: Cydia's share page, Sileo, Zebra, Irisin", () => {
  assert.deepEqual(byApp(sourceLinks(FLAT)), {
    Cydia: "cydia://url/https://cydia.saurik.com/api/share#?source=https://repo.chariz.com/",
    Sileo: "sileo://source/https://repo.chariz.com/",
    Zebra: "zbra://sources/add/https://repo.chariz.com/",
    Irisin: "irisin://repository/add?url=https%3A%2F%2Frepo.chariz.com%2F",
  });
});

test("a URL with & or # stays one value in Cydia's share fragment", () => {
  const s = { ...FLAT, uri: "https://x.example/r?a=1&b=2/" };
  assert.equal(byApp(sourceLinks(s)).Cydia, "cydia://url/https://cydia.saurik.com/api/share#?source=https://x.example/r?a=1%26b=2/");
});

test("dist APT source: only Irisin, with suite and components", () => {
  assert.deepEqual(sourceLinks(DIST), [{ app: "Irisin",
    url: "irisin://repository/add?url=https%3A%2F%2Fapt.procurs.us%2F&suite=1800&component=main&component=extra" }]);
});

test("AltStore source: every sideloader, in AltDirect's order", () => {
  const e = "https%3A%2F%2Fexample.com%2Fapps.json";
  assert.deepEqual(sourceLinks(ALT), [
    { app: "AltStore Classic", url: `altstore-classic://source?url=${e}` },
    { app: "AltStore", url: `altstore://source?url=${e}` },
    { app: "SideStore", url: `sidestore://source?url=${e}` },
    { app: "Feather", url: "feather://source/https://example.com/apps.json" },
    { app: "LiveContainer", url: `livecontainer://source?url=${e}` },
    { app: "StikStore", url: `stikstore://add-source?url=${e}` },
    { app: "TrollApps", url: `trollapps://add?url=${e}` },
  ]);
  // The key alone is enough (a source record without uri).
  assert.equal(sourceLinks({ key: ALT.key }).length, 7);
});

test("Feather only takes https sources", () => {
  const apps = sourceLinks({ key: "alt:http://example.com/a.json" }).map((l) => l.app);
  assert.ok(!apps.includes("Feather"));
  assert.equal(apps.length, 6);
});

test("no links for a missing or non-http source", () => {
  assert.deepEqual(sourceLinks(null), []);
  assert.deepEqual(sourceLinks({ uri: "file:///var/lib/x/", dist: "./" }), []);
  assert.deepEqual(packageLinks("x", { uri: "cdrom:/", dist: "./" }), []);
  assert.deepEqual(packageLinks("", FLAT), []);
});

test("APT package on a flat source: the source rides along where the app can add it", () => {
  assert.deepEqual(byApp(packageLinks("com.example.tweak+x", FLAT)), {
    Cydia: "cydia://url/https://cydia.saurik.com/api/share#?source=https://repo.chariz.com/&package=com.example.tweak%2Bx",
    Sileo: "sileo://package/com.example.tweak%2Bx",
    Zebra: "zbra://packages/com.example.tweak%2Bx?source=https://repo.chariz.com/",
    Irisin: "irisin://package/com.example.tweak%2Bx",
  });
});

test("APT package on a dist source: plain package links", () => {
  assert.deepEqual(byApp(packageLinks("apt", DIST)), {
    Cydia: "cydia://package/apt",
    Sileo: "sileo://package/apt",
    Zebra: "zbra://packages/apt",
    Irisin: "irisin://package/apt",
  });
});

test("AltStore app: its source's add links", () => {
  assert.deepEqual(packageLinks("com.example.app", ALT), sourceLinks(ALT));
});

test("add link: the URL, and a dist repo's suite and components", () => {
  assert.equal(addLink(FLAT, "https://cydian.dev"), "https://cydian.dev/add?url=https%3A%2F%2Frepo.chariz.com%2F");
  assert.equal(addLink(DIST, "http://localhost:8080/"),
    "http://localhost:8080/add?url=https%3A%2F%2Fapt.procurs.us%2F&suite=1800&component=main&component=extra");
  assert.equal(addLink(ALT), `${PUBLIC_SITE}/add?url=https%3A%2F%2Fexample.com%2Fapps.json`);
  assert.equal(addLink({ uri: "ftp://x/" }), null);
});

test("add link round-trips through parseAddLink", () => {
  for (const s of [FLAT, ALT]) {
    const q = new URL(addLink(s)).search;
    assert.deepEqual(parseAddLink(q), { url: s.uri });
  }
  assert.deepEqual(parseAddLink(new URL(addLink(DIST)).search), { url: DIST.uri, dist: "1800", components: ["main", "extra"] });
  assert.deepEqual(parseAddLink("?url=https://a.example/&suite=./"), { url: "https://a.example/" });
});

test("parseAddLink refuses what isn't an http(s) URL", () => {
  assert.equal(parseAddLink(""), null);
  assert.equal(parseAddLink("?url="), null);
  assert.equal(parseAddLink("?url=javascript:alert(1)"), null);
  assert.equal(parseAddLink("?url=repo.example.com"), null);
});

test("siteOrigin: the page's own http(s) origin, else the public site", () => {
  assert.equal(siteOrigin({ origin: "http://127.0.0.1:8080" }), "http://127.0.0.1:8080");
  assert.equal(siteOrigin({ origin: "null" }), PUBLIC_SITE);
  assert.equal(siteOrigin({ origin: "ifizbox-app://bundle" }), PUBLIC_SITE);
  assert.equal(siteOrigin(undefined), PUBLIC_SITE);
});

test("isAddPath", () => {
  assert.ok(isAddPath("/add"));
  assert.ok(isAddPath("/add/"));
  assert.ok(isAddPath("/ifizbox/add"));
  assert.ok(!isAddPath("/"));
  assert.ok(!isAddPath("/address"));
  assert.ok(!isAddPath("/index.html"));
});

// F50: Open In by the alt: record's format (F16a keeps `format` on it).
const E = (u) => encodeURIComponent(u);
const ipa = (format, uri, extra = {}) => ({ key: `alt:${uri}`, uri, format, ...extra });

test("format: an alt: record's format, AltStore when it has none or an unknown one", () => {
  assert.equal(formatOf(ipa("scarlet", "https://x/r.json")), "scarlet");
  assert.equal(formatOf(ipa("esign", "https://x/r.json")), "esign");
  assert.equal(formatOf(ipa("gbox", "https://x/r.json")), "gbox");
  assert.equal(formatOf(ipa("altstore", "https://x/r.json")), "altstore");
  assert.equal(formatOf(ipa("bogus", "https://x/r.json")), "altstore");
  assert.equal(formatOf({ ...FLAT, format: "scarlet" }), "apt"); // only alt: records carry a format
});

test("Scarlet repo: Open in Scarlet alone, scarlet://repo=<url> as unwrapLink reads it", async () => {
  const u = "https://raw.githubusercontent.com/suprstarrd/locus-ios/main/scarlet.json";
  const links = sourceLinks(ipa("scarlet", u));
  assert.deepEqual(links, [{ app: "Scarlet", url: `scarlet://repo=${u}` }]);
  const { unwrapLink } = await import("./sources/detect.js");
  assert.equal(unwrapLink(links[0].url).url, u);
  assert.equal(unwrapLink(links[0].url).hint, "scarlet");
});

test("ESign source: ESign first, then the AltStore-format sideloaders (its JSON is AltStore 1.x)", () => {
  const u = "https://example.com/esign.json";
  const links = sourceLinks(ipa("esign", u));
  assert.deepEqual(links[0], { app: "ESign", url: `esign://addsource?url=${u}` });
  assert.equal(links.length, 8);
  assert.deepEqual(links.slice(1).map((l) => l.url), sourceLinks(ipa("altstore", u)).map((l) => l.url));
  // & and # stay inside url=.
  assert.equal(sourceLinks(ipa("esign", "https://x.example/s?a=1&b=2"))[0].url,
    "esign://addsource?url=https://x.example/s?a=1%26b=2");
});

test("GBox source: Open in GBox alone; an encrypted one too, with no sideloader", () => {
  const u = "https://raw.githubusercontent.com/qoli/GboxApps/main/apps.json";
  assert.deepEqual(sourceLinks(ipa("gbox", u)), [{ app: "GBox", url: `gbox://AddSource/${u}` }]);
  const enc = ipa("gbox", u, { unsupported: "This GBox source is encrypted, so only GBox can read it." });
  assert.deepEqual(sourceLinks(enc), [{ app: "GBox", url: `gbox://AddSource/${u}` }]);
  assert.deepEqual(packageLinks("gbox.app", enc), sourceLinks(enc));
});

test("an unsupported AltStore record offers no sideloader that can't read it", () => {
  assert.deepEqual(sourceLinks(ipa("altstore", "https://x/a.json", { unsupported: "no" })), []);
  assert.equal(sourceLinks(ipa("esign", "https://x/a.json", { unsupported: "no" })).map((l) => l.app).join(), "ESign");
});

test("IPA formats: a package's links are its source's, and the add link carries no suite", () => {
  for (const f of ["scarlet", "esign", "gbox"]) {
    const s = ipa(f, "https://example.com/r.json");
    assert.deepEqual(packageLinks("com.x", s), sourceLinks(s));
    assert.equal(addLink(s), `${PUBLIC_SITE}/add?url=${E("https://example.com/r.json")}`);
  }
  assert.deepEqual(sourceLinks(ipa("scarlet", "file:///x.json")), []);
});
