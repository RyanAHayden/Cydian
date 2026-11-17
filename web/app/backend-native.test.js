// N3: the app's backend against the Swift side's stand-in (native/fake/fake-native.mjs: a fixture prefix with apt's
// sources, lists and dpkg status, and native/fake/cydian-helper), fed into the same core as the site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { createNativeBackend } from "./backend-native.js";
import { BackendError } from "./backend-http.js";
import { createCatalog, ALL } from "./core/catalog.js";
import { repoLayout } from "./core/apt.js";
import { createSettings } from "./core/settings.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";

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

const PROCURSUS = "deb:https://apt.procurs.us/:1800";
const HAVOC = "deb:https://havoc.app/:./";

function setup(t, opts = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, ...opts });
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB() } });
  return { fx, native, backend };
}

test("sources() is apt's list: .list and .sources files, deb-src and disabled skipped, defaults' names kept", async (t) => {
  const { backend } = setup(t);
  const list = await backend.sources();
  assert.deepEqual(list.map((s) => s.key), [HAVOC, PROCURSUS]);
  const p = list.find((s) => s.key === PROCURSUS);
  assert.equal(p.name, "Procursus"); // from core/sources.js DEFAULT_SOURCES, seeded as metadata
  assert.match(p.file, /sources\.list\.d\/procursus\.sources$/);
  assert.deepEqual(p.components, ["main"]);
});

test("before apt-get update there are no lists: packages() falls back to the network through the shell", async (t) => {
  const { backend } = setup(t, { net: { "https://havoc.app/Packages": "Package: x\nVersion: 1\n" } });
  const r = await backend.packages("https://havoc.app/");
  assert.deepEqual(r, { text: "Package: x\nVersion: 1\n", source: "https://havoc.app/Packages", cached: false });
  await assert.rejects(backend.packages("https://none.test/"), (e) => e instanceof BackendError && e.code === "not_found");
});

test("refreshSources runs apt-get update through the helper, then counts from apt's lists", async (t) => {
  const { backend, native } = setup(t, { net: null }); // offline: everything must come from apt's lists
  const seen = [];
  const out = await backend.refreshSources((s) => seen.push(s.key));
  assert.deepEqual(native.calls.find((c) => c.method === "helper.run").params.words, ["update"]);
  assert.deepEqual(seen.sort(), [PROCURSUS, HAVOC].sort());
  const by = Object.fromEntries(out.map((s) => [s.key, s]));
  assert.equal(by[PROCURSUS].count, 2);
  assert.equal(by[PROCURSUS].origin, "Procursus");
  assert.equal(by[HAVOC].count, 2); // the iphoneos-arm stanza isn't ours
  assert.equal(by[HAVOC].origin, "Havoc"); // from the clearsigned InRelease
  assert.equal(by[HAVOC].error, null);
  const again = await backend.sources();
  assert.equal(again.find((s) => s.key === HAVOC).count, 2); // kept on the device
  const pk = await backend.packages(repoLayout(by[PROCURSUS]).packages[0].replace(/Packages$/, ""));
  assert.equal(pk.source, "apt:apt.procurs.us_dists_1800_main_binary-iphoneos-arm64_Packages");
});

test("a failed apt-get update is an error with apt's message, not a silent refresh", async (t) => {
  const { backend } = setup(t, { env: { FAKE_FAIL: "update" } });
  await assert.rejects(backend.refreshSources(), (e) => e.code === "helper" && /Could not get lock/.test(e.message));
});

test("apt's lists, dpkg's status and the holds go into the same core as the site", async (t) => {
  const { backend } = setup(t, { net: null });
  await backend.refreshSources();
  const catalog = createCatalog();
  for (const s of await backend.sources()) {
    const layout = repoLayout(s);
    const texts = await Promise.all(layout.packages.map(async (f) => (await backend.packages(f.slice(0, -8))).text));
    catalog.load(s.key, texts.join("\n\n"), layout.root);
  }
  assert.equal(catalog.setInstalled(await backend.dpkgStatus()), 3); // config-files leftovers aren't installed
  assert.deepEqual(catalog.list(ALL, ALL).map((r) => r.id).sort(), ["apt", "bash", "com.example.held", "com.example.tweak"]);
  const settings = createSettings({ storage: null, mode: "jailbreak", helper: backend.helper });
  const holds = await settings.holds.sync();
  assert.deepEqual(holds, ["com.example.held"]);
  const up = catalog.upgrades(holds, { dpkgHolds: false });
  assert.deepEqual(up.available.map((r) => r.id).sort(), ["apt", "com.example.tweak"]);
  assert.deepEqual(up.ignored.map((r) => r.id), ["com.example.held"]);
});

test("helper() streams output lines and status-fd lines; refusals come back as exit 64", async (t) => {
  const { backend } = setup(t);
  const events = [];
  const r = await backend.helper(["update"], (e) => events.push(e));
  assert.equal(r.code, 0);
  assert.ok(events.some((e) => e.fd === "out" && /^Get:1 /.test(e.line)));
  assert.ok(events.some((e) => e.fd === "status" && /^dlstatus:/.test(e.line)));
  const bad = await backend.helper(["install", "--force-yes"]);
  assert.equal(bad.code, 64);
  assert.match(bad.stderr, /bad package name/);
  assert.equal((await backend.helper(["remove", "com.not.installed"])).code, 64);
});

test("fetch() and text() go through the shell; HTTP errors are 'upstream' like the proxy's", async (t) => {
  const { backend } = setup(t, { net: { "https://r.test/a.json": { body: "{\"a\":1}", headers: { "content-type": "application/json" } } } });
  const res = await backend.fetch("https://r.test/a.json");
  assert.deepEqual(await res.json(), { a: 1 });
  assert.equal(res.headers.get("content-type"), "application/json");
  await assert.rejects(backend.text("https://r.test/missing"), (e) => e.code === "upstream" && e.status === 404);
  await assert.rejects(backend.fetch("file:///etc/passwd"), { code: "bad_url" });
  assert.equal(backend.assetUrl("https://r.test/CydiaIcon.png"), "https://r.test/CydiaIcon.png");
  const offline = setup(t, { net: null }).backend;
  await assert.rejects(offline.text("https://r.test/x"), { code: "network" });
});

const NEW_NET = {
  "https://new.test/Packages": "Package: a\nVersion: 1\nArchitecture: iphoneos-arm64\n",
  "https://new.test/Release": "Origin: New Repo\nArchitectures: iphoneos-arm64\n",
};
const NEW = "deb:https://new.test/:./";
const cydianSources = (fx) => join(fx.prefix, "etc/apt/sources.list.d/cydian.sources");
const readOrNull = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

test("addSource checks the repo and writes it into apt's sources (cydian.sources) through the helper", async (t) => {
  const { backend, native, fx } = setup(t, { net: NEW_NET });
  const added = await backend.addSource("new.test");
  assert.equal(added.key, NEW);
  assert.equal(added.origin, "New Repo");
  assert.equal(added.count, 1);
  assert.equal(added.added, undefined); // in apt's files now, not the device's alone
  assert.deepEqual(native.calls.filter((c) => c.method === "helper.run").map((c) => c.params.words),
    [["addsource", "https://new.test/", "./"]]);
  assert.equal(readOrNull(cydianSources(fx)), "Types: deb\nURIs: https://new.test/\nSuites: ./\n");
  const listed = (await backend.sources()).find((s) => s.key === NEW);
  assert.match(listed.file, /sources\.list\.d\/cydian\.sources$/);
  assert.equal(listed.origin, "New Repo"); // the device's metadata stays with apt's entry
  assert.equal(listed.added, undefined);
  await backend.addSource("new.test"); // again: no second stanza
  assert.equal(readOrNull(cydianSources(fx)), "Types: deb\nURIs: https://new.test/\nSuites: ./\n");
});

test("F48: addSource takes a dist repo { uri, dist, components }: Release under dists/<suite>/, suite and components to apt", async (t) => {
  const net = {
    "https://dist.test/dists/stable/Release": "Origin: Dist Repo\nComponents: main\nArchitectures: iphoneos-arm64\n",
    "https://dist.test/dists/stable/main/binary-iphoneos-arm64/Packages": "Package: a\nVersion: 1\nArchitecture: iphoneos-arm64\n",
  };
  const { backend, native, fx } = setup(t, { net });
  const added = await backend.addSource({ uri: "https://dist.test/", dist: "stable", components: ["main"] });
  assert.equal(added.key, "deb:https://dist.test/:stable");
  assert.equal(added.origin, "Dist Repo");
  assert.equal(added.count, 1);
  assert.deepEqual(native.calls.filter((c) => c.method === "helper.run").map((c) => c.params.words),
    [["addsource", "https://dist.test/", "stable", "main"]]);
  assert.match(readOrNull(cydianSources(fx)), /URIs: https:\/\/dist\.test\/\nSuites: stable\nComponents: main\n/);
  // no Release there: APT's "Did not Find Repository", not an AltStore attempt with the object
  await assert.rejects(backend.addSource({ uri: "https://dist.test/", dist: "nope", components: ["main"] }), { kind: "not_repository" });
});

test("removeSource takes a source out of cydian.sources; apt's other files are left alone", async (t) => {
  const { backend, native, fx } = setup(t, { net: NEW_NET });
  await backend.addSource("new.test");
  await assert.rejects(backend.removeSource(PROCURSUS), /procursus\.sources/);
  assert.ok(!native.calls.some((c) => c.method === "helper.run" && c.params.words[0] === "removesource"));
  await backend.removeSource(NEW);
  assert.deepEqual(native.calls.filter((c) => c.method === "helper.run").pop().params.words, ["removesource", "https://new.test/", "./"]);
  assert.equal(readOrNull(cydianSources(fx)), null); // the last one gone: the file too
  assert.ok(!(await backend.sources()).some((s) => s.key === NEW));
  assert.equal(readOrNull(join(fx.prefix, "etc/apt/sources.list.d/procursus.sources")).includes("apt.procurs.us"), true);
});

test("a failed write is an error with the helper's message, and nothing is kept", async (t) => {
  const { backend, fx } = setup(t, { net: NEW_NET, env: { FAKE_FAIL: "addsource" } });
  await assert.rejects(backend.addSource("new.test"), (e) => e.code === "helper" && /addsource failed \(74\).*temp file/.test(e.message));
  assert.equal(readOrNull(cydianSources(fx)), null);
  assert.ok(!(await backend.sources()).some((s) => s.key === NEW));
});

test("without a helper (sideload build) an added source is kept on the device, and moved into apt's sources later", async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const indexedDB = fakeIndexedDB();
  const make = (helper) => createNativeBackend({
    native: createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: NEW_NET, ...(helper ? { helper } : {}) }),
    sourceOptions: { indexedDB },
  });
  const bare = make(join(fx.dir, "no-helper"));
  const kept = await bare.addSource("new.test");
  assert.equal(kept.added, true);
  assert.ok((await bare.sources()).some((s) => s.key === NEW && s.added && !s.file));
  await assert.rejects(bare.removeSource(PROCURSUS), /procursus\.sources/);

  // The same device store, now with the helper: Refresh writes the record into cydian.sources first.
  const app = make();
  const seen = [];
  await app.refreshSources((s) => seen.push(s.key));
  assert.equal(readOrNull(cydianSources(fx)), "Types: deb\nURIs: https://new.test/\nSuites: ./\n");
  assert.ok(seen.includes(NEW));
  const listed = (await app.sources()).find((s) => s.key === NEW);
  assert.match(listed.file, /cydian\.sources$/);
  assert.equal(listed.added, undefined);
  assert.equal(listed.origin, "New Repo");
});

test("refreshSources keeps a device-only source that can't be written yet, and still refreshes", async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const indexedDB = fakeIndexedDB();
  const make = (opts) => createNativeBackend({
    native: createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: NEW_NET, ...opts }),
    sourceOptions: { indexedDB },
  });
  await make({ helper: join(fx.dir, "no-helper") }).addSource("new.test");
  const app = make({ env: { FAKE_FAIL: "addsource" } });
  const out = await app.refreshSources();
  assert.ok(out.some((s) => s.key === PROCURSUS && s.count === 2));
  assert.equal(readOrNull(cydianSources(fx)), null);
  assert.ok((await app.sources()).some((s) => s.key === NEW && s.added)); // tried again next time
});

test("native/bridge.js: postMessage ids, stream events, error codes, cydianApp", async () => {
  const src = readFileSync(join(import.meta.dirname, "../../native/bridge.js"), "utf8");
  const posted = [];
  let ctx;
  const handler = {
    postMessage(msg) {
      posted.push(msg);
      if (msg.method === "fail") return Promise.reject(new Error("timeout: the repo took too long"));
      if (msg.method === "helper.run") {
        ctx.cydianNative.emit(msg.id, [{ fd: "out", line: "hello" }]);
        return Promise.resolve({ code: 0, stdout: "hello\n", stderr: "" });
      }
      return Promise.resolve(undefined);
    },
  };
  ctx = vm.createContext({ webkit: { messageHandlers: { cydian: handler } }, console });
  vm.runInContext(src.replace("})(globalThis);", "})(this);"), ctx);
  assert.equal(ctx.cydianApp, true);
  const n = ctx.cydianNative;
  const lines = [];
  const r = await n.helper(["hold", "com.a"], (e) => lines.push(e.line));
  assert.equal(r.code, 0);
  assert.deepEqual(lines, ["hello"]);
  assert.deepEqual(JSON.parse(JSON.stringify(posted[0])), { id: 1, method: "helper.run", params: { words: ["hold", "com.a"], stream: true }, stream: true });
  assert.equal(await n.dpkgStatus(), null);
  await assert.rejects(n.call("fail"), (e) => e.code === "timeout" && e.message === "the repo took too long");
  // Without the shell it does nothing: the site never gets a cydianNative.
  const bare = vm.createContext({});
  vm.runInContext(src.replace("})(globalThis);", "})(this);"), bare);
  assert.equal(bare.cydianNative, undefined);
});
