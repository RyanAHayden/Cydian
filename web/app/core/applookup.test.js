// F161: an IPA app's App Store details (merge rules: the source's fields win), the app page's links (never two to one
// page), the week-long cache, and where the website and the app ask.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupUrl, workerLookupUrl, regionOf, parseLookup, lookupNeed, mergeDetails, pageLinks, pageKey, lookupApp,
  clearLookupMemory, LOOKUP_TTL } from "./applookup.js";
import { appLinks } from "./previews.js";
import { storeLookup } from "../screens/altstore.js";

const APPLE = { resultCount: 1, results: [{ bundleId: "com.example.flight", trackName: "FlightTracker", artistName: "Example Ltd",
  primaryGenreName: "Travel", trackViewUrl: "http://apps.apple.com/gb/app/flighttracker/id123?uo=4", averageUserRating: 4.58,
  userRatingCount: 812, screenshotUrls: ["https://is1-ssl.mzstatic.com/a.jpg", "javascript:x", "https://is1-ssl.mzstatic.com/b.jpg"],
  description: "Track every flight.", version: "3.2", minimumOsVersion: "15.0" }] };

// AppTesters' entries: name, bundleID, version, size, downloadURL, icon and a one-line description.
const appTesters = { name: "FlightTracker", bundleIdentifier: "com.example.flight", developerName: "", localizedDescription: "Injected with Premium",
  screenshots: [], versions: [{ version: "3.1", downloadURL: "https://apps.apptesters.org/ipa/flight.ipa" }],
  sourceUrl: "https://repository.apptesters.org/", extra: {} };

test("lookupUrl / workerLookupUrl: bundle ID and a two-letter country only", () => {
  assert.equal(lookupUrl("com.example.flight", "GB"), "https://itunes.apple.com/lookup?bundleId=com.example.flight&country=gb");
  assert.equal(lookupUrl("com.a", "usa"), "https://itunes.apple.com/lookup?bundleId=com.a&country=us");
  assert.equal(lookupUrl("a/b"), null);
  assert.equal(workerLookupUrl("com.a", "de"), "/api/applookup?bundleId=com.a&country=de");
  assert.equal(regionOf("en-GB"), "gb");
  assert.equal(regionOf("zh-Hant-TW"), "tw");
  assert.equal(regionOf("en"), "us");
  assert.equal(regionOf(undefined), "us");
});

test("parseLookup: Apple's first result, https links, rating clamped; nothing found is null", () => {
  const s = parseLookup(JSON.stringify(APPLE));
  assert.equal(s.trackViewUrl, "https://apps.apple.com/gb/app/flighttracker/id123?uo=4");
  assert.equal(s.developer, "Example Ltd");
  assert.equal(s.category, "Travel");
  assert.equal(s.rating, 4.58);
  assert.equal(s.ratingCount, 812);
  assert.deepEqual(s.screenshots, ["https://is1-ssl.mzstatic.com/a.jpg", "https://is1-ssl.mzstatic.com/b.jpg"]);
  assert.equal(s.minimumOs, "15.0");
  assert.equal(parseLookup({ resultCount: 0, results: [] }), null);
  assert.equal(parseLookup("<html>"), null);
  assert.equal(parseLookup({ results: [{ bundleId: "a", averageUserRating: 0 }] }).rating, null);
});

test("lookupNeed: full without screenshots or developer; link-only with both; none when the app's own page is there too", () => {
  assert.equal(lookupNeed(appTesters, []), "full");
  const rich = { ...appTesters, developerName: "Dev", screenshots: [{ url: "https://x/1.png" }] };
  assert.equal(lookupNeed(rich, []), "link");
  assert.equal(lookupNeed(rich, [{ url: "https://github.com/dev/app" }]), "none");
  assert.equal(lookupNeed({ ...rich, developerName: "" }, [{ url: "https://github.com/dev/app" }]), "full");
});

test("mergeDetails: the source's fields win; the App Store fills only the gaps", () => {
  const store = parseLookup(APPLE);
  const m = mergeDetails(appTesters, store);
  assert.equal(m.developer, "Example Ltd");
  assert.equal(m.category, "Travel");
  assert.equal(m.rating, 4.58);
  assert.equal(m.screenshots.length, 2);
  assert.equal(m.description, "Track every flight.");
  assert.equal(m.version, "3.2");
  assert.equal(m.minimumOs, "15.0");

  const own = { ...appTesters, developerName: "Source Dev", category: "games", screenshots: [{ url: "https://x/1.png" }],
    localizedDescription: "Track   every flight." };
  const n = mergeDetails(own, store);
  assert.equal(n.developer, null, "the source's developer wins");
  assert.equal(n.category, null, "the source's category wins");
  assert.deepEqual(n.screenshots, [], "the source's screenshots win");
  assert.equal(n.description, null, "the same text isn't shown twice");

  const link = mergeDetails(own, store, "link");
  assert.equal(link.trackViewUrl, store.trackViewUrl);
  assert.equal(link.rating, null);
  assert.equal(link.developer, null);
  const none = mergeDetails(appTesters, null);
  assert.equal(none.developer, null);
  assert.deepEqual(none.screenshots, []);
});

const urlsOf = (rows) => rows.filter((r) => r.url).map((r) => pageKey(r.url));
const source = { label: "AppTesters", subtitle: "https://repository.apptesters.org/", href: "#sources/k" };

test("pageLinks: AppTesters: the App Store page, the source in iFizBox, the source's website", () => {
  const store = parseLookup(APPLE);
  const rows = pageLinks({ ownLinks: appLinks(appTesters), store, source, sourceWebsite: "https://apptesters.org", appUrls: [appTesters.sourceUrl] });
  assert.deepEqual(rows.map((r) => r.kind), ["appstore", "source", "website"]);
  assert.equal(rows[0].url, store.trackViewUrl);
  assert.equal(rows[1].href, "#sources/k");
});

test("pageLinks: never two rows to one page", () => {
  const store = parseLookup(APPLE);
  // the source's website given as the app's website: it's the source's page, shown once as the source's
  const asOwn = [{ kind: "website", label: "Developer Website", url: "https://apptesters.org/" }];
  let rows = pageLinks({ ownLinks: asOwn, store, source, sourceWebsite: "http://www.apptesters.org" });
  assert.deepEqual(rows.map((r) => r.kind), ["appstore", "source", "website"]);
  assert.equal(new Set(urlsOf(rows)).size, urlsOf(rows).length);

  // a source in a GitHub repo, whose IPA is released in that repo: that GitHub link is the source's, not the app's
  const ghSource = "https://raw.githubusercontent.com/team/repo/main/source.json";
  rows = pageLinks({ ownLinks: [{ kind: "github", label: "GitHub", url: "https://github.com/team/repo" }], store: null, source,
    sourceWebsite: "https://github.com/team/repo", appUrls: [ghSource] });
  assert.deepEqual(rows.map((r) => r.kind), ["source", "website"]);

  // the app's own GitHub wins over the App Store
  rows = pageLinks({ ownLinks: [{ kind: "github", label: "GitHub", url: "https://github.com/dev/app" }], store, source,
    sourceWebsite: "https://apptesters.org" });
  assert.deepEqual(rows.map((r) => r.kind), ["github", "source", "website"]);
  // the source's website is never taken for one app's page, even when the app names it: it shows once, as the source's
  rows = pageLinks({ ownLinks: [{ kind: "github", label: "GitHub", url: "https://github.com/dev/app" }], store, source,
    sourceWebsite: "https://github.com/dev/app/" });
  assert.deepEqual(rows.map((r) => r.kind), ["appstore", "source", "website"]);

  // the same App Store page spelt twice (country, query) is one page
  rows = pageLinks({ ownLinks: [{ kind: "website", label: "Website", url: "https://apps.apple.com/us/app/x/id123" }], store, source });
  assert.deepEqual(rows.map((r) => r.kind), ["website", "source"]);
  rows = pageLinks({ ownLinks: [], store, source, sourceWebsite: "https://apps.apple.com/us/app/x/id123" });
  assert.deepEqual(rows.map((r) => r.kind), ["appstore", "source"]);

  // nothing found and no website: just the source
  assert.deepEqual(pageLinks({ source }).map((r) => r.kind), ["source"]);
});

function memStore() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m };
}

test("lookupApp: cached per bundle ID a week, not-found too; a failed fetch isn't cached", async () => {
  clearLookupMemory();
  const store = memStore();
  let asked = 0;
  const get = async () => { asked++; return JSON.stringify(APPLE); };
  const a = await lookupApp("com.example.flight", { country: "gb", get, store, now: 1000 });
  assert.equal(a.developer, "Example Ltd");
  await lookupApp("com.example.flight", { country: "gb", get, store, now: 1000 + LOOKUP_TTL - 1 });
  assert.equal(asked, 1);
  clearLookupMemory(); // a new launch: localStorage still has it
  await lookupApp("com.example.flight", { country: "gb", get, store, now: 2000 });
  assert.equal(asked, 1);
  await lookupApp("com.example.flight", { country: "gb", get, store, now: 1000 + LOOKUP_TTL });
  assert.equal(asked, 2, "a week on, asked again");

  const none = async () => { asked++; return JSON.stringify({ resultCount: 0, results: [] }); };
  assert.equal(await lookupApp("com.none", { get: none, store, now: 0 }), null);
  assert.equal(await lookupApp("com.none", { get: none, store, now: 5 }), null);
  assert.equal(asked, 3, "not found is remembered too");

  await assert.rejects(lookupApp("com.down", { get: async () => { throw new Error("offline"); }, store, now: 0 }));
  assert.equal(store.getItem("cydian.applookup.us.com.down"), null);
  assert.equal(await lookupApp("a/b", { get, store }), null);
});

test("storeLookup: the website asks the Worker, the app asks Apple; a failure is null", async () => {
  clearLookupMemory();
  const seen = [];
  const site = { kind: "http", text: async () => { throw new Error("not the proxy"); } };
  const fetchFn = async (u) => { seen.push(u); return { ok: true, text: async () => JSON.stringify(APPLE) }; };
  const a = await storeLookup("com.example.flight", { backend: site, fetchFn, locale: "en-GB", store: memStore() });
  assert.equal(a.category, "Travel");
  assert.deepEqual(seen, ["/api/applookup?bundleId=com.example.flight&country=gb"]);

  clearLookupMemory();
  const app = { kind: "native", text: async (u) => { seen.push(u); return JSON.stringify(APPLE); } };
  await storeLookup("com.example.flight", { backend: app, locale: "de-DE", store: memStore() });
  assert.equal(seen[1], "https://itunes.apple.com/lookup?bundleId=com.example.flight&country=de");

  clearLookupMemory();
  const down = await storeLookup("com.example.flight", { backend: site, fetchFn: async () => ({ ok: false, status: 502 }), store: memStore() });
  assert.equal(down, null);
});

test("ownPageLinks: a GitHub repo found only through the IPA's download is the app's only when named for it", async () => {
  const { ownPageLinks, shortText } = await import("./applookup.js");
  const at = { ...appTesters, extra: { down: "https://github.com/apptesters-org/AppTesters_Repo/releases/download/v1/flight.ipa" }, iconURL: "https://github.com/apptesters-org/AppTesters_Repo/raw/main/icons/f.png",
    versions: [{ version: "1", downloadURL: "https://github.com/apptesters-org/AppTesters_Repo/releases/download/v1/flight.ipa" }] };
  const links = appLinks(at);
  assert.deepEqual(links.map((l) => l.kind), ["github"], "F122 picks the release repo");
  assert.deepEqual(ownPageLinks(at, links), [], "AppTesters_Repo isn't FlightTracker's page");
  const feather = { name: "Feather", versions: [{ downloadURL: "https://github.com/khcrysalis/Feather/releases/download/v1/Feather.ipa" }], extra: {} };
  assert.equal(ownPageLinks(feather, appLinks(feather)).length, 1, "a release repo named for the app is its page");
  const named = { ...at, extra: { sourceURL: "https://github.com/apptesters-org/AppTesters_Repo" } };
  assert.equal(ownPageLinks(named, appLinks(named)).length, 1, "the app's own code link names it");
  const site = [{ kind: "website", url: "https://dev.example" }];
  assert.deepEqual(ownPageLinks(at, site), site);

  assert.equal(shortText("short"), null);
  const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${"word ".repeat(12)}`).join("\n\n");
  const s = shortText(long);
  assert.ok(s.length < long.length && s.length <= 320 * 1.3 && long.startsWith(s));
  assert.match(shortText("x".repeat(50) + " " + "y ".repeat(400)), /…$/);
});
