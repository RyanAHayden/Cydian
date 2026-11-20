// F291: the safety nets' pure parts: exploitable iOS versions (core/ios-exposure.js), the known-safe list
// (core/safe-sources.js), trust labels (core/trust.js), reports and the malware IPA list (core/malicious.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPLOITABLE_IOS, exposureOf, exposureDue, exposureAlert, loadSeen, markSeen, patchesFor, duePatch, patchAlert, patchRow,
  loadSnooze, snoozePatch, SOFTWARE_UPDATE, UNDERSTOOD, INSTALL_PATCH, LATER } from "./ios-exposure.js";
import { KNOWN_SAFE, knownSafe, placeOf } from "./safe-sources.js";
import { trustOf, loadTrusted, setTrusted, isTrustedInput, untrustedJobs, unknownSourceAlert, TRUST_LABEL, ADD_TRUST } from "./trust.js";
import { MALICIOUS_REASONS, reportBody, reportsApi, bannerOf, malwareIpa, malwareAlert, rememberIpaHash, ipaHash, MALWARE_IPAS,
  REPORT_BANNER, reportedAlert, INSTALL_ANYWAY } from "./malicious.js";
import { RECOMMENDED_SOURCES } from "./recommended.js";
import { sourceWarning } from "./warnings.js";
import { compareVersions } from "./selfupdate.js";
import { DOMAIN } from "../brand.js";

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

// ---- exploitable iOS --------------------------------------------------------------------------------------------

test("every list entry is well formed: a range, a later fix, a CVE page", () => {
  for (const e of EXPLOITABLE_IOS) {
    assert.ok(compareVersions(e.from, e.through) <= 0, e.id);
    assert.ok(compareVersions(e.fixed, e.through) > 0, e.id);
    if (e.cve !== null) assert.match(e.cve, /^CVE-\d{4}-\d{4,}$/);
    assert.match(e.link, /^https:\/\//);    assert.ok(Array.isArray(e.patches));
  }
});

test("exposureOf: listed versions, the newest fix among overlapping entries, unlisted ones null", () => {
  assert.equal(exposureOf("17.4"), null);
  assert.equal(exposureOf("16.7.6"), null);
  assert.equal(exposureOf("18.7.2"), null);
  assert.equal(exposureOf("15.8.7"), null);
  assert.equal(exposureOf("13.7"), null);
  assert.equal(exposureOf(null), null);
  assert.equal(exposureOf("garbage"), null);
  const e = exposureOf("16.2");
  assert.deepEqual(e.entries.map((x) => x.id).sort(), ["coruna-gruber-16", "kfd-landa", "kfd-physpuppet-16", "kfd-smith-16"]);
  assert.equal(e.fixed, "17.0");
  assert.equal(exposureOf("15.1").fixed, "15.8.7");
  assert.equal(exposureOf("15.8.6").fixed, "15.8.7");
  assert.equal(exposureOf("16.7").fixed, "17.0");
  assert.equal(exposureOf("16.7.5").fixed, "16.7.6");
  assert.equal(exposureOf("17.2.1").fixed, "17.3");
  assert.equal(exposureOf("18.6.2").fixed, "18.7.2");
  assert.equal(exposureOf("14.8.1").fixed, "15.7.7");
});

test("exposureDue: sideload and site only, untrusted installs only, once per iOS version", () => {
  assert.equal(exposureDue({ mode: "sideload", ios: "16.2", untrusted: true }), true);
  assert.equal(exposureDue({ mode: "site", ios: "16.2", untrusted: true }), true);
  assert.equal(exposureDue({ mode: "jailbreak", ios: "16.2", untrusted: true }), false, "quiet in the jailbreak build");
  assert.equal(exposureDue({ mode: "sideload", ios: "16.2", untrusted: false }), false);
  assert.equal(exposureDue({ mode: "sideload", ios: "17.4", untrusted: true }), false);
  assert.equal(exposureDue({ mode: "sideload", ios: "16.2", untrusted: true, seen: "16.2" }), false);
  assert.equal(exposureDue({ mode: "sideload", ios: "16.3", untrusted: true, seen: "16.2" }), true, "a new version asks again");
  const s = mem();
  assert.equal(loadSeen(s), null);
  markSeen(s, "16.2");
  assert.equal(loadSeen(s), "16.2");
});

test("exposureAlert: plain wording, Software Update only where Settings opens", () => {
  const ex = exposureOf("16.2");
  const app = exposureAlert(ex, { canOpenSettings: true });
  assert.equal(app.title, "Check Before You Install");
  assert.deepEqual(app.buttons, [SOFTWARE_UPDATE, UNDERSTOOD]);
  assert.match(app.message, /iOS 16\.2 has a known flaw/);
  assert.match(app.message, /iOS 17\.0 fixes it\./);
  const site = exposureAlert(ex);
  assert.deepEqual(site.buttons, [UNDERSTOOD]);
  assert.match(site.message, /Settings > General > Software Update/);
  assert.doesNotMatch(app.message + site.message, /danger|hack|!|malware/i, "not scary");
  assert.deepEqual(exposureAlert({ ios: "1.0", entries: [], fixed: null }, { canOpenSettings: true }).buttons, [UNDERSTOOD]);
});

test("patches: listed per version, the first not installed or snoozed, Later until a newer version", () => {
  const list = [{ id: "x", name: "X", cve: "CVE-2099-0001", from: "16.0", through: "16.6.1", fixed: "16.7", link: "https://e/",
    patches: [{ id: "com.example.patch", name: "Example Patch", repo: "https://repo.example/", link: "https://e/p", version: "1.0" }] }];
  const ps = patchesFor("16.4", list);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].exploit, "X");
  assert.deepEqual(patchesFor("17.0", list), []);
  assert.deepEqual(patchesFor("16.4"), [], "none shipped yet");
  assert.equal(duePatch(ps, {}).id, "com.example.patch");
  assert.equal(duePatch(ps, new Map([["com.example.patch", "1.0"]])), null);
  const s = mem();
  snoozePatch(s, ps[0]);
  assert.equal(duePatch(ps, {}, loadSnooze(s)), null);
  assert.equal(duePatch([{ ...ps[0], version: "1.1" }], {}, loadSnooze(s)).version, "1.1", "a new patch version asks again");
  const a = patchAlert(ps[0]);
  assert.equal(a.title, "Security Patch Available");
  assert.deepEqual(a.buttons, [LATER, INSTALL_PATCH]);
  assert.equal(a.cancel, 0);
  const row = patchRow(ps[0], "deb:https://repo.example/:./");
  assert.deepEqual([row.id, row.section, row.security], ["com.example.patch", "Security Patch Available", true]);
});

// ---- known-safe list and trust ---------------------------------------------------------------------------------

test("placeOf: GitHub by user and repo, others by host", () => {
  assert.equal(placeOf("https://raw.githubusercontent.com/claration/Feather/refs/heads/main/app-repo.json"), "gh:claration/feather");
  assert.equal(placeOf("https://github.com/Claration/Feather/raw/main/x.json"), "gh:claration/feather");
  assert.equal(placeOf("https://fizl0.github.io/apps/source.json"), "gh:fizl0/apps");
  assert.equal(placeOf("https://www.Havoc.app/"), "havoc.app");
  assert.equal(placeOf("alt:https://apps.altstore.io/"), "apps.altstore.io");
  assert.equal(placeOf("deb:https://repo.chariz.com/:./"), "repo.chariz.com");
  assert.equal(placeOf({ uri: "https://havoc.app/" }), "havoc.app");
  assert.equal(placeOf(""), null);
});

test("every Recommended source is Known Safe, and so is the built-in", () => {
  for (const r of RECOMMENDED_SOURCES) assert.ok(knownSafe(r.url), r.name);
  assert.ok(knownSafe(`https://${DOMAIN}/repo/source.json`));
  assert.ok(knownSafe(`https://${DOMAIN}/repo/`));
  for (const e of KNOWN_SAFE) {
    assert.ok(e.reason && e.link && e.name, e.place);
    assert.equal(sourceWarning(e.place.startsWith("gh:") ? "github.com" : e.place), null, `${e.place} is no piracy host`);
    assert.notEqual(e.place, "github.com");
    assert.ok(!/^gh:[^/]+\/$/.test(e.place) || e.place === "gh:fizl0/", e.place);
  }
});

test("knownSafe never covers a shared host or a sibling repo", () => {
  assert.equal(knownSafe("https://raw.githubusercontent.com/someone/else/main/apps.json"), null);
  assert.equal(knownSafe("https://github.com/claration/NotFeather/raw/main/x.json"), null);
  assert.equal(knownSafe("https://evil.havoc.app.example.com/"), null);
  assert.equal(knownSafe("https://cool-ipas.xyz/"), null);
});

test("trustOf: Known Safe, Trusted by the user, else Unknown; kept by place", () => {
  const s = mem();
  assert.equal(trustOf({ builtin: true, uri: "https://x.example/" }), "safe");
  assert.equal(trustOf({ uri: "https://havoc.app/" }), "safe");
  assert.equal(trustOf({ uri: "https://cool-ipas.xyz/apps.json" }), "unknown");
  setTrusted(s, { uri: "https://cool-ipas.xyz/apps.json" }, true);
  assert.deepEqual(loadTrusted(s), ["cool-ipas.xyz"]);
  assert.equal(trustOf({ uri: "https://cool-ipas.xyz/other.json" }, { trusted: loadTrusted(s) }), "trusted");
  setTrusted(s, { uri: "https://cool-ipas.xyz/" }, false);
  assert.deepEqual(loadTrusted(s), []);
  assert.deepEqual(Object.values(TRUST_LABEL), ["Known Safe", "Trusted", "Unknown"]);
});

test("untrustedJobs: installs from Unknown sources and files with no source; removals and re-signs don't count", () => {
  const jobs = [
    { id: "a", source: "https://havoc.app/", op: "install" },
    { id: "b", source: "https://cool-ipas.xyz/apps.json", op: "install" },
    { id: "c", key: null, source: null, library: "x.ipa" },
    { id: "d", source: "https://cool-ipas.xyz/apps.json", op: "remove" },
    { id: "e", source: "https://cool-ipas.xyz/apps.json", mode: "resign" },
    { id: "f", key: "alt:https://apps.altstore.io/" },
  ];
  assert.deepEqual(untrustedJobs(jobs).map((j) => j.id), ["b", "c"]);
  assert.deepEqual(untrustedJobs(jobs, { trusted: ["cool-ipas.xyz"] }).map((j) => j.id), ["c"]);
  assert.equal(isTrustedInput("https://apps.altstore.io/"), true);
  assert.equal(isTrustedInput(""), false);
});

test("unknownSourceAlert: gentle, Add & Trust first, Cancel last", () => {
  const a = unknownSourceAlert("cool-ipas.xyz");
  assert.equal(a.title, "Unknown Source");
  assert.deepEqual(a.buttons, [ADD_TRUST, "Add Source", "Cancel"]);
  assert.equal(a.cancel, 2);
  assert.match(a.message, /doesn't make it bad/);
});

// ---- reports and the malware list ------------------------------------------------------------------------------

test("the reasons are the user's seven, no ads option", () => {
  assert.deepEqual(MALICIOUS_REASONS.map((r) => r.label), ["Steals Logins or Codes", "Sends My Data Somewhere",
    "Asks to Install a Profile, VPN or Certificate", "Takes Over or Changes the Phone", "Steals Money or Crypto",
    "Isn't the App It Claims", "Something Else…"]);
});

test("reportBody: a known reason; Something Else needs short text; version and hash ride along", () => {
  assert.equal(reportBody({ reason: "ads" }).ok, false);
  assert.equal(reportBody({ reason: "other", text: "  " }).ok, false);
  assert.equal(reportBody({ reason: "other", text: "x".repeat(201) }).ok, false);
  assert.deepEqual(reportBody({ reason: "logins", text: "dropped", version: "3.0", sha256: "AB".repeat(32) }).body,
    { reason: "logins", text: "", version: "3.0", sha256: "ab".repeat(32) });
  assert.deepEqual(reportBody({ reason: "other", text: " asks for my\npassword ", version: 2 }).body,
    { reason: "other", text: "asks for my password", version: "2" });
  assert.equal("sha256" in reportBody({ reason: "money", sha256: "nope" }).body, false);
});

test("reportsApi: summary quiet when offline, send carries the token and the body", async () => {
  const asked = [];
  const api = reportsApi({ base: "https://s.example", token: async () => "t".repeat(40), fetcher: async (u, init) => {
    asked.push([u, init]);
    if (init.method === "POST") return { ok: true, status: 200, json: async () => ({ ok: true, count: 4 }) };
    return { ok: true, status: 200, json: async () => ({ enabled: true, count: 12, reasons: { data: 9, logins: 3 }, mine: false }) };
  } });
  const s = await api.summary("com.x", "3.0");
  assert.equal(asked[0][0], "https://s.example/reports/com.x?version=3.0");
  assert.equal(s.count, 12);
  const sent = await api.send("com.x", { reason: "data", version: "3.0" });
  assert.equal(sent.count, 4);
  assert.equal(asked[1][1].headers["X-Review-Token"], "t".repeat(40));
  assert.deepEqual(JSON.parse(asked[1][1].body), { reason: "data", version: "3.0" });
  const off = reportsApi({ token: async () => "t".repeat(40), fetcher: async () => { throw new Error("offline"); } });
  assert.deepEqual(await off.summary("com.x"), { enabled: false, count: 0, reasons: {}, mine: false });
  await assert.rejects(off.send("com.x", {}), (e) => e.code === "network");
  const limited = reportsApi({ token: async () => "t".repeat(40), fetcher: async () => ({ ok: false, status: 429, json: async () => ({ code: "rate_limited", error: "later" }) }) });
  await assert.rejects(limited.send("com.x", {}), (e) => e.code === "rate_limited");
});

test("bannerOf: from REPORT_BANNER devices, naming the top reason", () => {
  assert.equal(bannerOf({ count: REPORT_BANNER - 1, reasons: { data: 9 } }), null);
  const b = bannerOf({ count: 14, reasons: { logins: 10, data: 4 } });
  assert.equal(b.title, "Reported as Malicious");
  assert.match(b.message, /^14 people reported this version, most for “Steals Logins or Codes”\./);
  const a = reportedAlert("GBA4U");
  assert.deepEqual(a.buttons, ["Cancel", INSTALL_ANYWAY]);
});

test("malwareIpa: by hash, or bundle ID (and version when listed); none shipped yet", () => {
  assert.deepEqual(MALWARE_IPAS, []);
  const list = [{ bundleId: "com.bad.vpn", versions: ["2.1"], name: "FreeVPN Pro", reason: "It steals login tokens.", link: "https://e/" },
    { bundleId: "com.bad.any", sha256: "c".repeat(64), name: "Any", reason: "It is bad.", link: null }];
  assert.equal(malwareIpa({ bundleId: "com.bad.vpn", version: "2.1" }, list).name, "FreeVPN Pro");
  assert.equal(malwareIpa({ bundleId: "com.bad.vpn", version: "2.2" }, list), null);
  assert.equal(malwareIpa({ bundleId: "com.bad.any" }, list).name, "Any", "no versions: every version");
  assert.equal(malwareIpa({ sha256: "C".repeat(64) }, list).name, "Any");
  assert.equal(malwareIpa({ bundleId: "com.good" }, list), null);
  const alert = malwareAlert(list[0], "FreeVPN Pro");
  assert.equal(alert.title, "Known Malware");
  assert.deepEqual(alert.buttons, ["Why It's Listed", "OK"]);
  assert.doesNotMatch(alert.buttons.join(), /Anyway/);
  assert.deepEqual(malwareAlert(list[1]).buttons, ["OK"]);
});

test("IPA hashes kept per bundle ID and version", () => {
  const s = mem();
  rememberIpaHash(s, "com.x", "1.0", "D".repeat(64));
  rememberIpaHash(s, "com.x", "1.0", "nope");
  assert.equal(ipaHash(s, "com.x", "1.0"), "d".repeat(64));
  assert.equal(ipaHash(s, "com.x", "1.1"), null);
});
