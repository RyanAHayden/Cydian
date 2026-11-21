// B261: plain-http apt repos (BigBoss and most old Cydia repos are http only) are added and refreshed like https
// ones: on the site through the proxy (/api/fetch), in the app through the shell's net.fetch / net.packages, which
// fetch http outside App Transport Security (native/Sources/PlainFetch.swift). A URL with nothing flat at it but a
// dists/stable/ Release (BigBoss's http://apt.thebigboss.org/repofiles/cydia/) is added as that dist source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifySource, refreshSource } from "./sources.js";
import { createHttpBackend } from "../backend-http.js";
import { addSecure } from "../screens/manage.js";
import { fakeIndexedDB } from "../fakes.test-helper.js";

const PACKAGES = "Package: com.example.old\nArchitecture: iphoneos-arm64\nVersion: 1\n\n"
  + "Package: com.example.rootful\nArchitecture: iphoneos-arm\nVersion: 1\n";
const BIGBOSS = "http://apt.thebigboss.org/repofiles/cydia/";

// The site's proxy, as worker/src/index.js answers: files is a map of URL -> body; kind=packages finds the first
// Packages in the dir; https:// hosts in `noHttps` don't answer (BigBoss has no working https). Every URL asked is
// kept in `asked`, so a test can see http went through untouched.
function proxy(files, { noHttps = [] } = {}) {
  const asked = [];
  const fetchFn = async (url) => {
    const u = new URL(url, "https://site.test");
    const target = u.searchParams.get("url").replace(/[?&]_=\d+$/, "");
    asked.push(target);
    if (noHttps.some((h) => target.startsWith(`https://${h}/`))) {
      return Response.json({ error: "cannot reach the repo", code: "network" }, { status: 502 });
    }
    if (u.searchParams.get("kind") === "packages") {
      for (const n of ["Packages.gz", "Packages"]) if (target + n in files) return new Response(files[target + n]);
      return Response.json({ error: "no Packages file", code: "not_found" }, { status: 404 });
    }
    if (target in files) return new Response(files[target]);
    return Response.json({ error: "upstream answered HTTP 404", code: "upstream", status: 404 }, { status: 502 });
  };
  return { asked, fetchFn };
}

const backendOver = (p) => createHttpBackend({ fetchFn: p.fetchFn, sourceOptions: { indexedDB: fakeIndexedDB() } });

test("a flat http source is added (after This Source Is Not Secure's Add) and refreshed over http", async () => {
  const p = proxy({ "http://old.example/repo/Packages": PACKAGES, "http://old.example/repo/Release": "Origin: Old\n" },
    { noHttps: ["old.example"] });
  const backend = backendOver(p);
  const alerts = [];
  const saved = await addSecure("http://old.example/repo/", { backend, alert: async (a) => { alerts.push(a.title); return { index: 1 }; } });
  assert.deepEqual(alerts, ["This Source Is Not Secure"]);
  assert.equal(saved.uri, "http://old.example/repo/");
  assert.equal(saved.count, 1);
  assert.ok(p.asked.includes("http://old.example/repo/"), "http itself went through the proxy, not only its https twin");
  const listed = (await backend.sources()).find((s) => s.uri === "http://old.example/repo/");
  assert.ok(listed, "the http source is in the list");
  const r = await refreshSource(backend, listed);
  assert.equal(r.error, null);
  assert.equal(r.count, 1);
});

test("BigBoss's URL, typed flat, is added as its dists/stable source and refreshes", async () => {
  const p = proxy({
    [`${BIGBOSS}dists/stable/Release`]: "Origin: BigBoss\nArchitectures: iphoneos-arm iphoneos-arm64\nComponents: main\n",
    [`${BIGBOSS}dists/stable/main/binary-iphoneos-arm64/Packages`]: PACKAGES,
  });
  const backend = backendOver(p);
  const s = await verifySource(backend, BIGBOSS);
  assert.equal(s.uri, BIGBOSS);
  assert.equal(s.dist, "stable");
  assert.deepEqual(s.components, ["main"]);
  assert.equal(s.count, 1);
  assert.equal(s.origin, "BigBoss");
  const r = await refreshSource(backend, s);
  assert.equal(r.error, null);
  assert.equal(r.count, 1);
});

test("nothing flat and no dists/stable Release: still Did Not Find Repository", async () => {
  await assert.rejects(verifySource(backendOver(proxy({})), "http://empty.example/"), { kind: "not_repository" });
});

test("the shell fetches http outside ATS: Apt.get hands http to PlainFetch, ATS stays on app-wide", () => {
  const native = new URL("../../../native/", import.meta.url);
  const apt = readFileSync(new URL("Sources/Apt.swift", native), "utf8");
  const get = apt.slice(apt.indexOf("static func get(_ url: URL"), apt.indexOf("static func packages("));
  assert.match(get, /url\.scheme\?\.lowercased\(\) == "http"\s*\{\s*return PlainFetch\.get\(url, done: done\)/);
  const plain = readFileSync(new URL("Sources/PlainFetch.swift", native), "utf8");
  assert.match(plain, /NWConnection\(host:/);
  assert.match(plain, /Apt\.maxBody/);
  for (const plist of ["Info.plist", "Info-sideload.plist"]) {
    assert.doesNotMatch(readFileSync(new URL(plist, native), "utf8"), /NSAllowsArbitraryLoads/, plist);
  }
});
