import { test } from "node:test";
import assert from "node:assert/strict";
// F19 Sources tools: import/export round trip and each foreign format, repo health, Release-first refresh with
// per-repo timeouts, conditional GETs through the site's proxy, the Source Warning list, the Sources search box and
// recommended sources per jailbreak.
import { sourceCalls, refreshSource, verifySource, openSourceStore } from "./sources.js";
import { healthOf, healthFields, releaseTime, fingerprint, withTimeout, pool, validatorCache, TimeoutError, QUIET_AFTER } from "./health.js";
import { exportText, parseImport, reviewImport, filterSources } from "./sourcelist.js";
import { sourceWarning, inputHost, SOURCE_WARNINGS, warningAlert } from "./warnings.js";
import { RECOMMENDED_SOURCES, detectJailbreak, jailbreakFromMarkers, recommendedFor, savedJailbreak, saveJailbreak, recommendedSeen, markRecommendedSeen } from "./recommended.js";
import { createHttpBackend, BackendError } from "../backend-http.js";

// The slice of IndexedDB that sources.js uses, in memory: several keyPath stores, get/getAll/put/delete, async
// requests and transaction completion.
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
            transaction(n, mode) {
              const s = stores.get(n);
              const tx = {};
              const request = (f) => {
                const r = {};
                later(() => { r.result = f(); later(() => tx.oncomplete?.()); });
                return r;
              };
              const write = (f) => { if (mode !== "readwrite") throw new Error("read-only"); return request(f); };
              tx.objectStore = () => ({
                get: (k) => request(() => structuredClone(s.rows.get(k))),
                getAll: () => request(() => [...s.rows.values()].map((v) => structuredClone(v))),
                put: (v) => write(() => { s.rows.set(v[s.keyPath], structuredClone(v)); return v[s.keyPath]; }),
                delete: (k) => write(() => { s.rows.delete(k); }),
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

const memStorage = () => {
  const mem = new Map();
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
};

// ---- (1) export and import ---------------------------------------------------------------------------------------

const LISTED = [
  { key: "deb:https://repo.chariz.com/:./", uri: "https://repo.chariz.com/", dist: "./", components: [] },
  { key: "deb:https://apt.procurs.us/:1800", uri: "https://apt.procurs.us/", dist: "1800", components: ["main"] },
  { key: "alt:https://apps.altstore.io/", uri: "https://apps.altstore.io/" },
];

test("F19: export then import gives back every source, and all of them already listed", () => {
  const { entries } = parseImport(exportText(LISTED, { date: new Date("2026-11-17") }));
  assert.equal(entries.length, 3);
  assert.deepEqual(reviewImport(entries, LISTED).map((e) => e.status), ["listed", "listed", "listed"]);
  assert.deepEqual(reviewImport(entries, []).map((e) => e.status), ["new", "new", "new"]);
});

test("F19: plain text, one URL per line, duplicates (slash or not, bare or deb line) once", () => {
  const { format, entries } = parseImport("https://repo.chariz.com/\nhttps://repo.chariz.com\n\nhttps://havoc.app/\n"
    + "deb https://havoc.app/ ./\n");
  assert.equal(format, "lines");
  assert.deepEqual(entries.map((e) => e.uri.replace(/\/$/, "")), ["https://repo.chariz.com", "https://havoc.app"]);
});

test("F19: Sileo's deb822 .sources", () => {
  const text = "Types: deb\nURIs: https://repo.chariz.com/\nSuites: ./\nComponents:\n\n"
    + "Types: deb\nURIs: https://apt.procurs.us/\nSuites: 1800\nComponents: main\n";
  const { format, entries } = parseImport(text);
  assert.equal(format, "deb822");
  assert.deepEqual(entries.map((e) => [e.uri, e.dist]), [["https://repo.chariz.com/", "./"], ["https://apt.procurs.us/", "1800"]]);
  assert.deepEqual(entries[1].input, { uri: "https://apt.procurs.us/", dist: "1800", components: ["main"] });
});

test("F19: Zebra's and Cydia's one-line sources.list", () => {
  // Zebra keeps /var/mobile/Library/Application Support/xyz.willy.Zebra/sources.list; Cydia cydia.list.
  const zebra = "deb https://getzbra.com/repo/ ./\ndeb https://repo.chariz.com/ ./\n";
  const cydia = "deb http://apt.thebigboss.org/repofiles/cydia/ stable main\ndeb https://repo.chariz.com/ ./\n";
  const z = parseImport(zebra);
  assert.equal(z.format, "list");
  assert.deepEqual(z.entries.map((e) => e.uri), ["https://getzbra.com/repo/", "https://repo.chariz.com/"]);
  const c = parseImport(cydia);
  assert.equal(c.format, "list");
  assert.deepEqual(c.entries.map((e) => [e.dist, e.components]), [["stable", ["main"]], ["./", []]]);
  // A source already listed is skipped (Already Listed), the rest are new.
  assert.deepEqual(reviewImport(c.entries, LISTED).map((e) => e.status), ["new", "listed"]);
});

test("F19: an AltStore / SideStore source list pasted in", () => {
  const sidestore = JSON.stringify({ sources: [{ name: "Team Picks", url: "https://community-apps.sidestore.io/sidecommunity.json" },
    { name: "AltStore", sourceURL: "https://apps.altstore.io/" }] });
  const { format, entries } = parseImport(sidestore);
  assert.equal(format, "json");
  assert.deepEqual(entries.map((e) => e.kind), ["altstore", "altstore"]);
  assert.deepEqual(reviewImport(entries, LISTED).map((e) => e.status), ["new", "listed"]);
  // Links, as AltStore and SideStore share them.
  const links = parseImport("altstore://source?url=https%3A%2F%2Fprovenance-emu.com%2Fapps.json\n"
    + "sidestore://source?url=https://provenance-emu.com/apps.json\n");
  assert.equal(links.entries.length, 1);
  assert.equal(links.entries[0].uri, "https://provenance-emu.com/apps.json");
});

// ---- (2) repo health --------------------------------------------------------------------------------------------

const NOW = Date.parse("2026-11-17T12:00:00Z");
const DAY = 24 * 3600 * 1000;

test("F19 health: unknown, ok, quiet and Not Responding", () => {
  assert.equal(healthOf({ key: "k" }, NOW).state, "unknown");
  const ok = healthOf({ updated: NOW - DAY, reachedAt: NOW - DAY, releaseDate: NOW - 3 * DAY }, NOW);
  assert.equal(ok.state, "ok");
  assert.equal(ok.label, "Reached yesterday · Release 3 days ago");
  assert.equal(healthOf({ updated: NOW, reachedAt: NOW, releaseDate: NOW - QUIET_AFTER - DAY }, NOW).state, "quiet");
  const down = healthOf({ updated: NOW, error: "timeout", reachedAt: NOW - 10 * DAY, failures: 3 }, NOW);
  assert.equal(down.state, "down");
  assert.equal(down.failures, 3);
  assert.equal(down.label, "Not Responding · last reached 10 days ago");
  assert.equal(healthOf({ updated: NOW, error: "x" }, NOW).label, "Not Responding · never reached");
  // Records from before F19: an error-free `updated` counts as reached.
  assert.equal(healthOf({ updated: NOW - 2 * DAY }, NOW).reachedAt, NOW - 2 * DAY);
});

test("F19 health: failures count up while it fails and reset once it answers", () => {
  assert.deepEqual(healthFields({}, { error: "x" }, NOW), { failures: 1 });
  assert.deepEqual(healthFields({ failures: 2, error: "x" }, { error: "y" }, NOW), { failures: 3 });
  assert.deepEqual(healthFields({ failures: 2 }, { error: null }, NOW), { reachedAt: NOW, failures: 0 });
});

test("F19 health: Release Date: is read, a bad one is null; fingerprints differ when the text does", () => {
  assert.equal(releaseTime({ fields: { date: "Sat, 14 Nov 2026 10:00:00 UTC" } }), Date.parse("2026-11-14T10:00:00Z"));
  assert.equal(releaseTime({ fields: { date: "someday" } }), null);
  assert.equal(releaseTime({ fields: {} }), null);
  assert.equal(fingerprint("a"), fingerprint("a"));
  assert.notEqual(fingerprint("Origin: A\n"), fingerprint("Origin: B\n"));
});

test("F19: withTimeout gives up with a timeout code; pool keeps order and its limit", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10), (e) => e instanceof TimeoutError && e.code === "timeout");
  assert.equal(await withTimeout(Promise.resolve(4), 1000), 4);
  let running = 0;
  let peak = 0;
  const out = await pool([5, 1, 4, 2, 3], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
});

// A backend over a map of URL -> body that counts its requests; `hang` URLs never answer.
function repoBackend(files, { hang = [] } = {}) {
  const calls = [];
  const get = (url) => {
    calls.push(url);
    if (hang.some((h) => url.startsWith(h))) return new Promise(() => {});
    if (!(url in files)) return Promise.reject(new BackendError("upstream", "upstream answered HTTP 404", 404));
    return Promise.resolve(files[url]);
  };
  return {
    calls,
    text: (url) => get(url),
    fetch: async (url) => new Response(await get(url)),
    packages: async (dir) => {
      calls.push("packages " + dir);
      if (hang.some((h) => dir.startsWith(h))) return new Promise(() => {});
      const t = files[dir + "Packages"];
      if (t == null) throw new BackendError("not_found", "no Packages file");
      return { text: t, source: dir + "Packages" };
    },
  };
}

const REL = "Origin: Flat\nLabel: Flat\nDate: Sat, 14 Nov 2026 10:00:00 UTC\nArchitectures: iphoneos-arm64\n";
const PKGS = "Package: a\nVersion: 1\nArchitecture: iphoneos-arm64\n\nPackage: b\nVersion: 1\nArchitecture: iphoneos-arm64\n";

test("F19 Release first: an unchanged Release keeps the count and fetches no Packages; a changed one refetches", async () => {
  const files = { "https://flat.example/Release": REL, "https://flat.example/Packages": PKGS };
  const b = repoBackend(files);
  const source = { key: "deb:https://flat.example/:./", uri: "https://flat.example/", dist: "./", components: [] };
  const first = await refreshSource(b, source);
  assert.equal(first.count, 2);
  assert.equal(first.releaseDate, Date.parse("2026-11-14T10:00:00Z"));
  assert.ok(first.releaseHash);
  assert.ok(b.calls.includes("packages https://flat.example/"));

  b.calls.length = 0;
  const second = await refreshSource(b, { ...source, ...first });
  assert.equal(second.count, 2);
  assert.equal(second.unchanged, true);
  assert.deepEqual(b.calls, ["https://flat.example/Release"]); // one request

  // Another architecture, an earlier error or a new Release: Packages again.
  b.calls.length = 0;
  await refreshSource(b, { ...source, ...first }, { arch: "iphoneos-arm" });
  assert.ok(b.calls.some((c) => c.startsWith("packages")));
  b.calls.length = 0;
  await refreshSource(b, { ...source, ...first, error: "boom" });
  assert.ok(b.calls.some((c) => c.startsWith("packages")));
  files["https://flat.example/Release"] = REL + "Version: 2\n";
  b.calls.length = 0;
  const third = await refreshSource(b, { ...source, ...first });
  assert.equal(third.unchanged, undefined);
  assert.ok(b.calls.some((c) => c.startsWith("packages")));
});

test("F19: Add Source saves the health fields", async () => {
  const b = repoBackend({ "https://flat.example/Release": REL, "https://flat.example/Packages": PKGS });
  const s = await verifySource(b, "https://flat.example/");
  assert.equal(s.reachedAt, s.updated);
  assert.equal(s.failures, 0);
  assert.equal(s.releaseDate, Date.parse("2026-11-14T10:00:00Z"));
  assert.equal(s.countArch, "iphoneos-arm64");
});

test("F19: a repo that never answers is marked Not Responding after its timeout and doesn't hold the others", async () => {
  const files = {};
  for (const n of ["chariz", "havoc"]) files[`https://${n}.example/Packages`] = PKGS;
  const b = repoBackend(files, { hang: ["https://dead.example/"] });
  const idb = fakeIndexedDB();
  const store = await openSourceStore({ indexedDB: idb });
  const keys = [];
  for (const n of ["chariz", "dead", "havoc"]) {
    const uri = `https://${n}.example/`;
    const key = `deb:${uri}:./`;
    keys.push(key);
    await store.put({ key, uri, dist: "./", components: [], updated: NOW - DAY, reachedAt: NOW - DAY, count: 2 });
  }
  const calls = sourceCalls(b, { indexedDB: idb, timeout: 50, concurrency: 2 });
  const started = Date.now();
  const out = await calls.refreshSources(undefined, { filter: (s) => keys.includes(s.key) });
  assert.ok(Date.now() - started < 1000);
  const byHost = Object.fromEntries(out.map((s) => [new URL(s.uri).hostname, s]));
  assert.equal(byHost["chariz.example"].count, 2);
  assert.equal(byHost["havoc.example"].failures, 0);
  assert.ok(byHost["havoc.example"].reachedAt >= started);
  const dead = byHost["dead.example"];
  assert.match(dead.error, /Not responding/);
  assert.equal(dead.failures, 1);
  assert.equal(dead.reachedAt, NOW - DAY); // kept: the last time it did answer
  assert.equal(healthOf(dead).state, "down");
});

// ---- conditional GETs through the site's proxy -------------------------------------------------------------------

test("F19: backend-http sends the ETag back and reuses the text on 304", async () => {
  const seen = [];
  let body = "Origin: A\n";
  const fetchFn = async (url, init) => {
    const h = init?.headers ?? {};
    seen.push(h["If-None-Match"] ?? null);
    const etag = `"${fingerprint(body)}"`;
    if (h["If-None-Match"] === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return new Response(body, { headers: { ETag: etag, "Last-Modified": "Sat, 14 Nov 2026 10:00:00 GMT" } });
  };
  const b = createHttpBackend({ fetchFn });
  assert.equal(await b.text("https://r.example/Release"), "Origin: A\n");
  assert.equal(await b.text("https://r.example/Release"), "Origin: A\n");
  assert.deepEqual(seen, [null, `"${fingerprint("Origin: A\n")}"`]);
  body = "Origin: B\n";
  assert.equal(await b.text("https://r.example/Release"), "Origin: B\n");
});

test("F19: validatorCache: headers from the 200, LRU bound, big bodies and no-validator answers not kept", () => {
  const v = validatorCache({ max: 2, maxBytes: 10 });
  const hdr = (o) => new Headers(o);
  v.store("a", hdr({ ETag: '"1"' }), "aa");
  v.store("b", hdr({ "Last-Modified": "x" }), "bb");
  assert.deepEqual(v.headers("a"), { "If-None-Match": '"1"' });
  assert.deepEqual(v.headers("b"), { "If-Modified-Since": "x" });
  assert.equal(v.reuse("a"), "aa"); // a is now the most recent
  v.store("c", hdr({ ETag: '"3"' }), "cc");
  assert.equal(v.reuse("b"), undefined);
  assert.equal(v.reuse("a"), "aa");
  v.store("d", hdr({ ETag: '"4"' }), "x".repeat(11));
  v.store("e", hdr({}), "e");
  assert.deepEqual(v.headers("d"), {});
  assert.deepEqual(v.headers("e"), {});
});

// ---- (3) Source Warning -----------------------------------------------------------------------------------------

test("F19 Source Warning: every entry has a reason and a link; matches by host in any input shape", () => {
  for (const w of SOURCE_WARNINGS) {
    assert.ok(w.reason.length > 10, w.host);
    assert.match(w.link, /^https:\/\//, w.host);
    assert.equal(w.host, w.host.toLowerCase());
  }
  assert.equal(sourceWarning("https://repo.hackyouriphone.org/").host, "repo.hackyouriphone.org");
  assert.equal(sourceWarning("repo.hackyouriphone.org").host, "repo.hackyouriphone.org");
  assert.equal(sourceWarning("HTTP://WWW.Repo.XAROLD.com/foo").host, "repo.xarold.com");
  assert.equal(sourceWarning({ uri: "http://cydia.iphonecake.com/", dist: "stable" }).host, "cydia.iphonecake.com");
  assert.equal(sourceWarning("altstore://source?url=https%3A%2F%2Fappaddict.com%2Fapps.json").host, "appaddict.com");
  assert.equal(sourceWarning("https://repo.chariz.com/"), null);
  assert.equal(sourceWarning("https://evil.repo.xarold.com.example/"), null); // exact host only
  assert.equal(sourceWarning(""), null);
  assert.equal(inputHost("not a url at all"), null);
  for (const r of RECOMMENDED_SOURCES) assert.equal(sourceWarning(r.url), null, r.name);
  const a = warningAlert(sourceWarning("repo.xarold.com"));
  assert.equal(a.title, "Source Warning");
  assert.deepEqual(a.buttons, ["Cancel", "Add Anyway"]);
});

test("F19 Source Warning: Import marks a listed piracy source and leaves the others alone", () => {
  const { entries } = parseImport("https://repo.chariz.com/\nhttps://repo.hackyouriphone.org/\n");
  const r = reviewImport(entries, []);
  assert.equal(r[0].warning, undefined);
  assert.equal(r[1].status, "new");
  assert.equal(r[1].warning.host, "repo.hackyouriphone.org");
});

// ---- (4) search -------------------------------------------------------------------------------------------------

test("F19 search: every word must match the name, URL or subtitle, case and accents aside", () => {
  const list = [
    { key: "1", name: "Chariz", uri: "https://repo.chariz.com/" },
    { key: "2", name: "Havoc", uri: "https://havoc.app/" },
    { key: "3", name: "Élan Tweaks", uri: "https://raw.githubusercontent.com/someone/tweaks/main/" },
  ];
  const keys = (q) => filterSources(list, q, (s) => s.name).map((s) => s.key);
  assert.deepEqual(keys(""), ["1", "2", "3"]);
  assert.deepEqual(keys("  "), ["1", "2", "3"]);
  assert.deepEqual(keys("HAV"), ["2"]);
  assert.deepEqual(keys("elan"), ["3"]);
  assert.deepEqual(keys("github someone"), ["3"]);
  assert.deepEqual(keys("chariz havoc"), []);
});

// ---- (5) recommended for the jailbreak ---------------------------------------------------------------------------

test("F19: the jailbreak is found from apt's source files", () => {
  assert.equal(detectJailbreak([{ path: "/var/jb/etc/apt/sources.list.d/palera1n.sources", text: "Types: deb\nURIs: https://repo.palera.in\n" }]), "palera1n");
  const dopamine = "URIs: https://repo.chariz.com/\n\nURIs: https://havoc.app/\n\nURIs: http://apt.thebigboss.org/repofiles/cydia/\n\nURIs: https://ellekit.space/\n";
  assert.equal(detectJailbreak([{ path: "/var/jb/etc/apt/sources.list.d/default.sources", text: dopamine }]), "dopamine");
  assert.equal(detectJailbreak([{ path: "/var/jb/etc/apt/sources.list.d/default.sources", text: "URIs: https://example.com/\n" }]), null);
  assert.equal(detectJailbreak([]), null);
  assert.equal(detectJailbreak(undefined), null);
});

test("F56: the jailbreak is found for sure from its marker files under the jbroot", () => {
  // nathanlr writes .installed_dopamine beside its own (usprebooter/main.m), so its marker wins
  assert.equal(jailbreakFromMarkers([".installed_dopamine", ".installed_nathanlr"]), "nathanlr");
  assert.equal(jailbreakFromMarkers([".installed_dopamine"]), "dopamine");
  assert.equal(jailbreakFromMarkers(["/.installed_dopamine"]), "dopamine");
  assert.equal(jailbreakFromMarkers([".installed_palera1n"]), "palera1n");
  assert.equal(jailbreakFromMarkers([".palecursus_strapped"]), "palera1n");
  assert.equal(jailbreakFromMarkers(["etc/apt/sources.list.d/palera1n.sources"]), "palera1n");
  assert.equal(jailbreakFromMarkers([".installed_dopamine", ".installed_nekojb"]), "other");
  assert.equal(jailbreakFromMarkers([]), null);
  assert.equal(jailbreakFromMarkers(undefined), null);
});

test("F19: each jailbreak gets its own tweak repos first; Other or none: all of them; F142: FIZL0 the only AltStore source", () => {
  const names = (jb) => recommendedFor(RECOMMENDED_SOURCES, jb).filter((r) => r.jailbreak).map((r) => r.name);
  assert.deepEqual(names("palera1n"), ["Havoc", "Chariz", "ElleKit", "palera1n", "Zebra"]);
  assert.deepEqual(names("dopamine"), ["Havoc", "Chariz", "ElleKit", "Zebra"]);
  assert.deepEqual(names("nathanlr"), ["Havoc", "Chariz", "Zebra"]);
  // F142: no jailbreak picked gets every APT entry; AltStore sources other than FIZL0's own are left to the IPA.
  const apt = RECOMMENDED_SOURCES.filter((r) => r.jailbreak).length;
  for (const jb of [null, "other"]) assert.equal(recommendedFor(RECOMMENDED_SOURCES, jb).filter((r) => r.jailbreak).length, apt);
  assert.deepEqual(recommendedFor(RECOMMENDED_SOURCES, "nathanlr").filter((r) => !r.jailbreak).map((r) => r.name), ["FIZL0"]);
  assert.ok(recommendedFor(RECOMMENDED_SOURCES, "dopamine")[0].jailbreak); // its own first
});

test("F19: the jailbreak pick and the first-run row's flag are kept", () => {
  const st = memStorage();
  assert.equal(savedJailbreak(st), null);
  saveJailbreak("nathanlr", st);
  assert.equal(savedJailbreak(st), "nathanlr");
  st.setItem("ifizbox.jailbreakName", "bogus");
  assert.equal(savedJailbreak(st), null);
  assert.equal(recommendedSeen(st), false);
  markRecommendedSeen(st);
  assert.equal(recommendedSeen(st), true);
});
