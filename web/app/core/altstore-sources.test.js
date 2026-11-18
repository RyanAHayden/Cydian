// F28: the user's own AltStore sources, as the site's default list and as test sources. Each fixture in
// web/fixtures/altstore/ is a trimmed snapshot of one of them (web/fixtures/altstore/README.md); one test per shape
// found, then every source is seeded, refreshed, listed and added through the HTTP backend, against a fake proxy
// that answers like the real one (redirects already followed server-side, the final body under the URL asked for).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_ALT_SOURCES, DEFAULT_SOURCES, dedupeUrls } from "./sources.js";
import { parseAltSource, altKey, isAltKey } from "./altstore.js";
import { detect } from "./sources/detect.js";
import { createCatalog } from "./catalog.js";
import { createHttpBackend } from "../backend-http.js";

const fixture = (name) => readFileSync(new URL(`../../fixtures/altstore/${name}.json`, import.meta.url), "utf8");

// Each default URL, its fixture, and what the fixture holds: [source name, apps after the parse].
const SOURCES = {
  "https://raw.githubusercontent.com/RyanAHayden/Cydian/main/web/app/source.json": ["cydian", "iFizBox", 1], // I7
  "https://provenance-emu.com/apps.json": ["provenance-emu", "Provenance Emulator", 3],
  "https://fizl0.github.io/apps/source.json": ["fizl0-apps", "FIZL0", 3],
  "https://raw.githubusercontent.com/claration/Feather/refs/heads/main/app-repo.json": ["feather", "Feather Repository", 1],
  "https://github.com/chachillie/Flycast-iOS/raw/main/flycast-ios.json": ["flycast-ios", "Flycast-iOS26", 1],
  "https://xitrix.github.io/iTorrent/AltStore.json": ["itorrent", "iTorrent Source", 1],
  "https://alt.crystall1ne.dev/": ["crystall1ne", "crystall1ne.dev", 2],
  "https://repository.apptesters.org/": ["apptesters", "AppTesters IPA Repo", 4],
  "https://raw.githubusercontent.com/MountainofPenguin/Altstore-Repository/main/apps.json": ["mountainofpenguin", "YouMod Repo", 1],
  "https://source.ryuksign.com/source.json": ["ryuksign", "RyukSign Source", 4],
  "https://repo.unbound.rip/app-repo.json": ["unbound", "Unbound App Repo", 2],
};
const parse = (name) => parseAltSource(fixture(name));
const ids = (p) => p.apps.map((a) => a.bundleIdentifier);
const versions = (app) => app.versions.map((v) => v.version);

test("F28: the default AltStore list is the user's 13 sources, deduped, each with a fixture", () => {
  assert.deepEqual(DEFAULT_ALT_SOURCES, Object.keys(SOURCES));
  assert.deepEqual(dedupeUrls(["https://A.example/x.json", "https://a.example/x.json", "https://b.example", "ftp://c/",
    "not a url", "https://b.example/"]), ["https://a.example/x.json", "https://b.example/"]);
  // None of them is an APT default, and none is listed twice.
  assert.equal(new Set(DEFAULT_ALT_SOURCES).size, DEFAULT_ALT_SOURCES.length);
  assert.ok(!DEFAULT_SOURCES.some((s) => DEFAULT_ALT_SOURCES.includes(s.uri)));
  for (const [url, [name, title, apps]] of Object.entries(SOURCES)) {
    const p = parse(name);
    assert.equal(p.name, title, url);
    assert.equal(p.apps.length, apps, url);
  }
});

test("F28 shape: AltStore 2.0 (versions[], news, appPermissions, featuredApps, header): Provenance, crystall1ne, iTorrent, Unbound, YouMod", () => {
  const prov = parse("provenance-emu");
  assert.deepEqual(versions(prov.apps[0]), ["3.3.0", "3.2.1"]);
  assert.equal(prov.news.length, 2);
  assert.ok(prov.apps[0].permissions.entitlements.length > 0);
  const cr = parse("crystall1ne");
  assert.deepEqual(cr.featuredApps, ["org.angelauramc.amethyst"]);
  assert.equal(cr.tintColor, "#99140b");
  assert.ok(cr.headerURL?.startsWith("https://"));
  assert.equal(cr.apps[0].versions[0].minOSVersion, "14.0");
  const it = parse("itorrent");
  assert.deepEqual(it.featuredApps, ["com.xitrix.iTorrent2"]);
  // 2.0's appPermissions.privacy and 1.x's permissions[] both land in privacy.
  assert.ok(it.apps[0].permissions.privacy.length >= 2);
  const ub = parse("unbound");
  assert.deepEqual(ids(ub), ["com.hammerandchisel.discord", "com.hammerandchisel.discord.testflight"]);
  assert.equal(ub.apps[1].versions[0].minOSVersion, "18.0");
  assert.deepEqual(ids(parse("mountainofpenguin")), ["com.google.ios.youtube"]);
});

test("F28 shape: AltStore 1.x, one version on the app itself (no versions[]): Flycast", () => {
  const raw = JSON.parse(fixture("flycast-ios"));
  assert.equal(raw.apps[0].versions, undefined);
  const app = parse("flycast-ios").apps[0];
  assert.equal(app.bundleIdentifier, "com.chachirie.FlycastiOS");
  assert.deepEqual(versions(app), [raw.apps[0].version]);
  assert.equal(app.versions[0].downloadURL, raw.apps[0].downloadURL);
  assert.equal(app.beta, raw.apps[0].beta === true);
});

test("F28 shape: 1.x fields beside versions[] (versions[] wins): FIZL0, OpenTennis, Party Board, openMX, Feather", () => {
  for (const name of ["fizl0-apps", "opentennis", "partyboard", "openmx", "feather"]) {
    const raw = JSON.parse(fixture(name));
    const p = parse(name);
    p.apps.forEach((app, i) => {
      assert.ok(raw.apps[i].version && raw.apps[i].versions.length, name);
      assert.deepEqual(versions(app), raw.apps[i].versions.map((v) => v.version), name);
    });
  }
  // The FIZL0 source and the three release sources list the same apps.
  assert.deepEqual(ids(parse("fizl0-apps")).sort(),
    ["opentennis", "partyboard", "openmx"].flatMap((n) => ids(parse(n))).sort());
});

test("F28 shape: ESign-style entries (META, bundleID/down, one entry per version), served as text/html: AppTesters", () => {
  const text = fixture("apptesters");
  assert.equal(detect("https://repository.apptesters.org/", text).format, "esign");
  const raw = JSON.parse(text);
  assert.equal(raw.apps.length, 6);
  const p = parse("apptesters");
  // F42: a bundle id listed again under the same name is another version of that app: one app, every version.
  assert.deepEqual(ids(p), ["com.andyworks.camera", "com.ulisesolave.Fitia", "com.calm.calmapp", "com.madarsoft.fitness"]);
  assert.deepEqual(versions(p.apps[0]), ["1.64", "1.63"]);
  assert.deepEqual(versions(p.apps[3]), ["22.0", "4.4.1"]); // no name: the bundle id is the name on both
  assert.equal(p.apps[0].versions[1].downloadURL, raw.apps[3].downloadURL);
  assert.equal(p.apps[0].versions[0].downloadURL, raw.apps[0].downloadURL);
  assert.equal(p.apps[0].versions[0].size, raw.apps[0].size);
});

test("F28 shape: variants that share a bundle id, with per-version permissions and sha256: RyukSign", () => {
  const raw = JSON.parse(fixture("ryuksign"));
  assert.equal(raw.apps.length, 4);
  const p = parse("ryuksign");
  // F42: the same bundle id under other names is a variant: each its own app and row, the real bundle id kept.
  assert.deepEqual(ids(p), ["com.burbn.instagram", "com.ryuk.ryukgram", "com.ryuk.ryukgram", "com.ryuk.ryukgram"]);
  assert.deepEqual(p.apps.map((a) => a.id), ["com.burbn.instagram", "com.ryuk.ryukgram",
    "com.ryuk.ryukgram~ryukgram-duplicate-ios-15", "com.ryuk.ryukgram~ryukgram-duplicate-ios-16"]);
  assert.deepEqual(p.apps.map((a) => a.name), raw.apps.map((a) => a.name));
  assert.deepEqual(p.apps.map((a) => a.versions[0].minOSVersion), ["16.3", "16.3", "15.0", "16.0"]);
  assert.equal(p.apps[0].name, raw.apps[0].name);
  assert.equal(p.apps[0].versions[0].minOSVersion, "16.3");
});

test("F28 shape: every source lists its apps as catalog rows", () => {
  for (const [url, [name, , apps]] of Object.entries(SOURCES)) {
    const c = createCatalog();
    const key = altKey(url);
    assert.equal(c.loadAlt(key, fixture(name), null), apps, name); // unknown iOS: every app, newest version
    assert.equal(c.list(key).length, apps, name);
    assert.ok(c.list(key).every((r) => r.kind === "ipa" && r.id && r.version), name);
  }
});

// ---- through the HTTP backend --------------------------------------------------------------------------------

// A tiny IndexedDB with get, put, delete and getAll.
function fakeIndexedDB() {
  const dbs = new Map();
  const later = (f) => setTimeout(f, 0);
  return {
    open(name) {
      const req = {};
      later(() => {
        let db = dbs.get(name);
        const fresh = !db;
        if (fresh) {
          const stores = new Map();
          db = {
            objectStoreNames: { contains: (n) => stores.has(n) },
            createObjectStore(n, { keyPath }) { stores.set(n, { keyPath, rows: new Map() }); },
            transaction(n) {
              const s = stores.get(n);
              const tx = {};
              const request = (f) => { const r = {}; later(() => { r.result = f(); later(() => tx.oncomplete?.()); }); return r; };
              tx.objectStore = () => ({
                put: (v) => request(() => { s.rows.set(v[s.keyPath], structuredClone(v)); }),
                get: (k) => request(() => structuredClone(s.rows.get(k))),
                delete: (k) => request(() => { s.rows.delete(k); }),
                getAll: () => request(() => [...s.rows.values()].map((v) => structuredClone(v))),
              });
              return tx;
            },
            close() {},
          };
          dbs.set(name, db);
        }
        req.result = db;
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

// The proxy, as it answers for these hosts: each source URL gives its JSON (after the redirects it followed);
// alt.crystall1ne.dev answers every path with its JSON, Packages included; anything else is a 404 upstream.
function fakeProxy(bodies = {}) {
  const asked = [];
  const fetchFn = async (url) => {
    const q = new URL(url, "http://site.test").searchParams;
    const target = q.get("url").replace(/\?t=\d+$/, ""); // freshUrl's per-minute query on raw GitHub
    asked.push(target);
    const crystal = target.startsWith("https://alt.crystall1ne.dev/");
    if (q.get("kind") === "packages" && !crystal) {
      return Response.json({ error: "no Packages file", code: "not_found" }, { status: 404 });
    }
    const name = crystal ? "crystall1ne" : SOURCES[target]?.[0];
    if (name) return new Response(bodies[name] ?? fixture(name));
    return Response.json({ error: "upstream answered HTTP 404", code: "upstream", status: 404 }, { status: 502 });
  };
  return { fetchFn, asked };
}

const altOnly = (list) => list.filter((s) => isAltKey(s.key));

test("F28: the site seeds the 13 sources once; refresh reads each one's apps; a deleted default stays deleted", async () => {
  const idb = fakeIndexedDB();
  const { fetchFn } = fakeProxy();
  let b = createHttpBackend({ fetchFn, sourceOptions: { indexedDB: idb } });
  let alt = altOnly(await b.sources());
  assert.deepEqual(alt.map((s) => s.uri).sort(), [...DEFAULT_ALT_SOURCES].sort());
  assert.ok(alt.every((s) => s.kind === "altstore" && s.count === null && s.name === null));
  assert.equal((await b.sources()).length, DEFAULT_SOURCES.length + DEFAULT_ALT_SOURCES.length);

  const seen = [];
  await b.refreshSources((s) => { if (isAltKey(s.key)) seen.push(s.uri); });
  assert.deepEqual(seen.sort(), [...DEFAULT_ALT_SOURCES].sort());
  alt = altOnly(await b.sources());
  for (const s of alt) {
    const [, title, apps] = SOURCES[s.uri];
    assert.equal(s.error, null, s.uri);
    assert.equal(s.name, title, s.uri);
    assert.equal(s.count, apps, s.uri);
  }

  // A source that changes shows it on the next refresh.
  const { fetchFn: fetch2 } = fakeProxy({ "fizl0-apps": JSON.stringify({ ...JSON.parse(fixture("fizl0-apps")), name: "FIZL0 2" }) });
  b = createHttpBackend({ fetchFn: fetch2, sourceOptions: { indexedDB: idb } });
  await b.refreshSources();
  const fizl0 = "https://fizl0.github.io/apps/source.json";
  assert.equal(altOnly(await b.sources()).find((s) => s.uri === fizl0).name, "FIZL0 2");

  await b.removeSource(altKey("https://repository.apptesters.org/"));
  b = createHttpBackend({ fetchFn, sourceOptions: { indexedDB: idb } });
  alt = altOnly(await b.sources());
  assert.equal(alt.length, DEFAULT_ALT_SOURCES.length - 1);
  assert.ok(!alt.some((s) => s.uri === "https://repository.apptesters.org/"));
});

test("F28: each source adds from the Add Source alert, by the URL as given (crystall1ne's JSON-at-every-path is no APT repo)", async () => {
  const { fetchFn } = fakeProxy();
  const b = createHttpBackend({ fetchFn, sourceOptions: { indexedDB: fakeIndexedDB(), altDefaults: [] } });
  assert.equal(altOnly(await b.sources()).length, 0);
  const typed = {
    "https://alt.crystall1ne.dev/": "alt.crystall1ne.dev", // a bare host, as people share it
    "https://repository.apptesters.org/": "https://repository.apptesters.org",
  };
  for (const [url, [, title, apps]] of Object.entries(SOURCES)) {
    const added = await b.addSource(typed[url] ?? url);
    assert.equal(added.key, altKey(url), url);
    assert.equal(added.kind, "altstore", url);
    assert.equal(added.name, title, url);
    assert.equal(added.count, apps, url);
  }
  const list = await b.sources();
  assert.equal(altOnly(list).length, DEFAULT_ALT_SOURCES.length);
  assert.ok(!list.some((s) => s.key.startsWith("deb:https://alt.crystall1ne.dev")), "crystall1ne saved as an APT repo");
  // Adding one again updates it in place.
  await b.addSource("https://alt.crystall1ne.dev");
  assert.equal(altOnly(await b.sources()).length, DEFAULT_ALT_SOURCES.length);
});
