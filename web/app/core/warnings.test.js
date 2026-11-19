// F228: Canister's piracy list (core/piracy-list.js, from tools/sync-piracy-list.py), subdomain matching, Installed's
// flags and the known-malware list. No fetches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PIRACY_HOSTS, PIRACY_LIST_SOURCE } from "./piracy-list.js";
import { sourceWarning, hostWarning, inputHost, SOURCE_WARNINGS, PIRACY_WARNINGS, LISTED_REASON, packageWarning, flagPiracy,
  PIRACY_SUBTITLE } from "./warnings.js";
import { MALWARE_FILES, MALWARE_PACKAGES, scanRequest, malwareFindings, removalIds, orphanFiles, malwareAlert } from "./known-malware.js";
import { RECOMMENDED_SOURCES } from "./recommended.js";
import { sourceKey } from "./sources.js";
import { altKey } from "./altstore.js";

const HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/;
const SHARED = ["github.io", "gitlab.io", "netlify.app", "vercel.app", "pages.dev", "com", "net", "org", "io"];

test("the generated list is well formed: sorted, unique, lower-case hosts, no shared suffix, no developer page", () => {
  assert.ok(PIRACY_HOSTS.length > 100, "Canister's list has well over 100 hosts");
  for (const h of PIRACY_HOSTS) {
    assert.match(h, HOST, h);
    assert.ok(!h.startsWith("www."), h);
    assert.ok(!SHARED.includes(h), h);
  }
  assert.deepEqual([...PIRACY_HOSTS].sort(), PIRACY_HOSTS);
  assert.equal(new Set(PIRACY_HOSTS).size, PIRACY_HOSTS.length);
  for (const dev of ["n3d1117.github.io", "autopear.github.io", "i0ntempest.github.io", "filippobiga.me"]) {
    assert.ok(!PIRACY_HOSTS.includes(dev), `${dev} is left out (tools/sync-piracy-list.py NOT_COPIED)`);
    assert.equal(sourceWarning(`https://${dev}/`), null, dev);
  }
  assert.match(PIRACY_LIST_SOURCE.commit, /^[0-9a-f]{40}$/);
  assert.match(PIRACY_LIST_SOURCE.date, /^\d{4}-\d\d-\d\d$/);
});

test("every hand-written entry is on Canister's list, and keeps its own reason", () => {
  for (const e of SOURCE_WARNINGS) {
    assert.ok(PIRACY_HOSTS.includes(e.host), e.host);
    assert.equal(sourceWarning(e.host).reason, e.reason);
  }
  assert.ok(!PIRACY_WARNINGS.some((w) => SOURCE_WARNINGS.some((e) => e.host === w.host)));
});

test("a generated entry has the generic reason and a link to its manifest file", () => {
  const w = sourceWarning("https://byg.iosios.net/");
  assert.equal(w.host, "byg.iosios.net");
  assert.equal(w.reason, LISTED_REASON);
  assert.equal(w.link, "https://github.com/cnstr/manifests/blob/main/configs/piracy-list/byg.iosios.net");
});

test("subdomains match, as Canister's API does; parent domains and lookalikes don't", () => {
  assert.equal(sourceWarning("https://x.repo.hackyouriphone.org/").host, "repo.hackyouriphone.org");
  assert.equal(sourceWarning("http://a.b.repo.xarold.com/dists/stable").host, "repo.xarold.com");
  assert.equal(sourceWarning("https://www.byg.iosios.net").host, "byg.iosios.net");
  assert.equal(sourceWarning("https://evil.abdomuftah.github.io/").host, "abdomuftah.github.io");
  assert.equal(sourceWarning("https://iosios.net/"), null);
  assert.equal(sourceWarning("https://xarold.com/"), null);
  assert.equal(sourceWarning("https://github.io/"), null);
  assert.equal(sourceWarning("https://someone.github.io/"), null);
  assert.equal(sourceWarning("https://notrepo.hackyouriphone.org.example/"), null);
  assert.equal(sourceWarning("https://xrepo.hackyouriphone.org/"), null); // a label boundary, not a suffix
  assert.equal(hostWarning("org"), null);
  assert.equal(hostWarning(""), null);
});

test("recommended sources are never flagged", () => {
  for (const r of RECOMMENDED_SOURCES) assert.equal(sourceWarning(r.url), null, r.name);
});

test("catalog source keys are read as their URL", () => {
  assert.equal(inputHost(sourceKey({ uri: "https://repo.hackyouriphone.org/", dist: "./" })), "repo.hackyouriphone.org");
  assert.equal(inputHost(sourceKey({ uri: "http://apt.tongbu.com/", dist: "stable" })), "apt.tongbu.com");
  assert.equal(inputHost(altKey("https://appaddict.org/apps.json")), "appaddict.org");
  assert.equal(sourceWarning(sourceKey({ uri: "https://repo.chariz.com/", dist: "./" })), null);
});

test("Installed: packages from a listed source are flagged, others and headers left alone", () => {
  const bad = { id: "a", name: "A", short: "desc", key: sourceKey({ uri: "https://repo.hackyouriphone.org/", dist: "./" }) };
  const good = { id: "b", name: "B", short: "desc", key: sourceKey({ uri: "https://repo.chariz.com/", dist: "./" }) };
  const none = { id: "c", name: "C", short: "desc", key: null };
  const header = { header: "A" };
  const out = flagPiracy([header, bad, good, none]);
  assert.equal(out[0], header);
  assert.equal(out[1].short, PIRACY_SUBTITLE);
  assert.equal(out[1].piracy.host, "repo.hackyouriphone.org");
  assert.equal(out[2], good);
  assert.equal(out[3], none);
  assert.equal(packageWarning({ key: null, source: "https://cydia.iphonecake.com/" }).host, "cydia.iphonecake.com");
  assert.equal(packageWarning({ key: null, source: "AltStore" }), null);
  assert.equal(packageWarning(null), null);
});

test("known malware: the lists, the scan request, findings from the scan and the alert", () => {
  assert.ok(MALWARE_FILES.every((f) => /^[A-Za-z0-9]+\.dylib$/.test(f.name) && f.link.startsWith("https://theapplewiki.com/")));
  assert.ok(MALWARE_PACKAGES.every((p) => /^[a-z0-9.-]+$/.test(p.id) && p.link.startsWith("https://theapplewiki.com/")));
  assert.ok(MALWARE_FILES.some((f) => f.name === "LicGenerator.dylib"));
  const req = scanRequest();
  assert.equal(req.files.length, MALWARE_FILES.length);
  assert.equal(req.packages.length, MALWARE_PACKAGES.length);

  assert.deepEqual(malwareFindings(null), []);
  assert.deepEqual(malwareFindings({ packages: [], files: [] }), []);
  const found = malwareFindings({
    packages: [{ id: "com.ownspy.daemon", version: "1.0" }, { id: "com.example.fine", version: "1" }],
    files: [
      { path: "/var/jb/Library/MobileSubstrate/DynamicLibraries/MainRepoEGG.dylib", name: "MainRepoEGG.dylib", owner: "org.mainrepo.egg" },
      { path: "/var/jb/usr/lib/TweakInject/LicGenerator.dylib", name: "LicGenerator.dylib", owner: null },
      { path: "/var/jb/usr/lib/TweakInject/Fine.dylib", name: "Fine.dylib", owner: null },
    ],
  });
  assert.deepEqual(found.map((f) => f.kind), ["package", "file", "file"]);
  assert.deepEqual(removalIds(found), ["com.ownspy.daemon", "org.mainrepo.egg"]);
  assert.deepEqual(orphanFiles(found), ["/var/jb/usr/lib/TweakInject/LicGenerator.dylib"]);
  const a = malwareAlert(found);
  assert.equal(a.title, "Malware Found");
  assert.deepEqual(a.buttons, ["Not Now", "Remove"]);
  assert.match(a.message, /com\.ownspy\.daemon/);
  assert.match(a.message, /MainRepoEGG\.dylib \(from org\.mainrepo\.egg\)/);
  assert.match(a.message, /No package owns this file/);
  assert.match(a.message, /theapplewiki\.com\/wiki\/MainRepoEGG/);

  const orphanOnly = malwareAlert(malwareFindings({ files: [{ path: "/usr/lib/TweakInject/SnowBoardSB.dylib", name: "SnowBoardSB.dylib", owner: null }] }));
  assert.deepEqual(orphanOnly.buttons, ["OK"]);
});
