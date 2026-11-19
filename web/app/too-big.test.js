// F257: Website Install of big apps. An app whose listed size is over what the website signs (core/websign.js IPA_MAX)
// never starts: the Too Big alert opens before the early link or any download. Its Download IPA (blue, first) keeps the
// link in Install IPAs and opens the IPA in Safari; back in the web app, Install IPAs opens with the row at the top and
// a note. A kept link that is too big is handed to a sideloader, never to the website's signer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signInBrowser, tooBigAlert, tooBigText, tooBigNote, TOO_BIG_TITLE, TOO_BIG_BUTTONS, TOO_BIG_FOOTER, sideloaderLinks,
  handOffIpa, whenBack } from "./signing-client.js";
import { IPA_MAX, SITE_LIMIT_TEXT, overSiteLimit, siteMB } from "./core/websign.js";
import { SITE_FILE_MAX, addSiteUrl, siteEntries, siteTooBig, markFresh, freshNote, MYIPAS } from "./core/myipas.js";
import { siteTooBigApp, installRows } from "./screens/altstore.js";
import { freshFirst, siteInstallSheet, FRESH_HEADER } from "./screens/myipas.js";
import { NAME } from "./brand.js";

const MB = 1048576;
const BIG = 700 * MB;
const URL1 = "https://dl.example/Big%20Game.ipa";
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test("F257: one cap for signing and keeping, said the same way everywhere", () => {
  assert.equal(SITE_FILE_MAX, IPA_MAX);
  assert.equal(SITE_LIMIT_TEXT, `The website signs apps up to ${siteMB(IPA_MAX)} MB.`);
  assert.equal(overSiteLimit(IPA_MAX), false);
  assert.equal(overSiteLimit(IPA_MAX + 1), true);
  assert.equal(overSiteLimit(undefined), false);
  assert.equal(overSiteLimit(null), false);
  assert.equal(TOO_BIG_FOOTER, `The website signs apps up to 512 MB. Install this one with ${NAME} Lite, or hand it to another sideloader.`);
  assert.equal(tooBigText("Big Game", BIG), `Big Game is 700 MB. The website signs apps up to 512 MB. Download the IPA and import it into ${NAME} Lite or another sideloader.`);
  assert.equal(tooBigNote("Big Game", BIG), `Big Game (700 MB) is in Safari's Downloads. It's too big for the website: tap Install to hand it to ${NAME} Lite or another sideloader.`);
});

test("F257: Install of an app listed over the cap opens Too Big, before the early link, the page or any download", async () => {
  const seen = { fetch: 0, open: 0, hud: 0, tooBig: [] };
  const profile = new TextEncoder().encode(`<?xml version="1.0"?><plist version="1.0"><dict><key>TeamIdentifier</key><array><string>T1</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>T1.com.you.*</string></dict></dict></plist>`);
  const id = { p12: new Uint8Array([0x30, 1]), profile, password: "pw", passwordOk: true };
  const r = await signInBrowser({ url: URL1, name: "Big Game", bundleId: "com.example.big", size: BIG, version: "2.0", iconUrl: "https://dl.example/i.png" }, {
    fetcher: async () => { seen.fetch++; return new Response(""); }, open: () => { seen.open++; }, hud: () => { seen.hud++; return { set() {}, hide() {} }; },
    now: () => id, identity: async () => id, origin: () => "https://ifizbox.example",
    tooBig: async (app) => { seen.tooBig.push(app); return "cancel"; },
  });
  assert.equal(r, false);
  assert.deepEqual(seen.tooBig, [{ url: URL1, name: "Big Game", size: BIG, version: "2.0", iconUrl: "https://dl.example/i.png" }]);
  assert.deepEqual([seen.fetch, seen.open, seen.hud], [0, 0, 0]); // no early link (no blank icon), no page, no download
});

test("F257: an app with no listed size, or under the cap, goes on as before (checked on the first answer)", async () => {
  for (const size of [null, 100 * MB]) {
    let tooBig = 0, fetched = 0;
    await signInBrowser({ url: URL1, name: "X", size }, {
      fetcher: async () => { fetched++; return new Response(JSON.stringify({ error: "stop", code: "x" }), { status: 500 }); },
      hud: () => ({ set() {}, hide() {} }), alert: async () => ({ index: 0 }), now: () => null, phone: async () => null,
      identity: async () => ({ p12: new Uint8Array([1]), profile: new Uint8Array([2]) }), tooBig: async () => { tooBig++; },
    });
    assert.equal(tooBig, 0);
    assert.ok(fetched >= 1);
  }
});

test("F257: the first answer's length over the cap says the app's size and the cap", async () => {
  const alerts = [];
  await signInBrowser({ url: URL1, name: "X" }, {
    fetcher: async () => new Response(new Uint8Array(4), { headers: { "X-IPA-Length": String(BIG) } }),
    hud: () => ({ set() {}, hide() {} }), alert: async (a) => { alerts.push(a); return { index: 0 }; }, now: () => null, phone: async () => null,
    identity: async () => ({ p12: new Uint8Array([1]), profile: new Uint8Array([2]) }),
  });
  assert.equal(alerts[0].message, "This app is 700 MB. The website signs apps up to 512 MB.");
});

test("F257: the Too Big alert: Download IPA first and blue, Cancel last and dark", async () => {
  let asked = null;
  const r = await tooBigAlert({ url: URL1, name: "Big Game", size: BIG }, { alert: async (a) => { asked = a; return { index: 3 }; }, storage: memStorage() });
  assert.equal(r, "cancel");
  assert.equal(asked.title, TOO_BIG_TITLE);
  assert.equal(asked.title, "Too Big for the Website");
  assert.deepEqual(asked.buttons, ["Download IPA", `Get ${NAME} Lite`, "Other Sideloader", "Cancel"]);
  assert.deepEqual(TOO_BIG_BUTTONS, asked.buttons);
  assert.equal(asked.cancel, 3);
  assert.deepEqual(asked.colors, { 0: "blue" });
  assert.equal(asked.message, tooBigText("Big Game", BIG));
});

test("F257: Download IPA keeps the link with the app's details, opens the IPA from the tap, and Install IPAs opens once back", async () => {
  const storage = memStorage(), opened = [], went = [];
  let backFn = null;
  const r = await tooBigAlert({ url: URL1, name: "Big Game", size: BIG, version: "2.0", iconUrl: "https://dl.example/i.png" }, {
    storage, open: (u) => opened.push(u), back: (fn) => { backFn = fn; }, go: (p) => went.push(p),
    alert: async (a) => { a.onTap(0); return { index: 0 }; },
  });
  assert.equal(r, "download");
  assert.deepEqual(opened, [URL1]); // opened inside the tap (onTap), as Safari needs
  const [e] = siteEntries(storage);
  assert.deepEqual({ name: e.name, version: e.version, size: e.size, iconUrl: e.iconUrl, url: e.url },
    { name: "Big Game", version: "2.0", size: BIG, iconUrl: "https://dl.example/i.png", url: URL1 });
  assert.equal(siteTooBig(e), true);
  assert.deepEqual(went, []); // nothing until the web app is back in front
  backFn();
  assert.deepEqual(went, [[MYIPAS]]);
  assert.deepEqual(freshNote(), { file: e.file, note: tooBigNote("Big Game", BIG) });
  assert.equal(freshNote(), null); // once: the mark lasts one visit
});

test("F257: Get Lite and Other Sideloader run their own ways", async () => {
  const ran = [];
  const deps = (i) => ({ storage: memStorage(), alert: async () => ({ index: i }), lite: async () => ran.push("lite"), handoff: async (a) => ran.push(["other", a]) });
  assert.equal(await tooBigAlert({ url: URL1, name: "Big Game", size: BIG }, deps(1)), "lite");
  assert.equal(await tooBigAlert({ url: URL1, name: "Big Game", size: BIG }, deps(2)), "other");
  assert.deepEqual(ran, ["lite", ["other", { url: URL1, name: "Big Game" }]]);
});

test("F257: the hand-off: each sideloader's own install link for the IPA", async () => {
  const links = sideloaderLinks(URL1, "Big Game");
  assert.deepEqual(links.map((l) => l.label), [`${NAME} Lite`, "AltStore", "SideStore", "Feather"]);
  assert.equal(links[0].link, `${NAME.toLowerCase()}://install?url=${encodeURIComponent(URL1)}&name=Big%20Game`);
  assert.equal(links[1].link, `altstore://install?url=${encodeURIComponent(URL1)}`);
  assert.equal(links[3].link, `feather://install/${URL1}`);
  assert.deepEqual(sideloaderLinks("http://x.example/a.ipa").map((l) => l.label), [`${NAME} Lite`, "AltStore", "SideStore"]); // Feather: https only
  assert.deepEqual(sideloaderLinks("javascript:1"), []);
  const opened = [];
  assert.equal(await handOffIpa({ url: URL1, name: "Big Game" }, { sheet: async (s) => { assert.equal(s.title, "Install Big Game With"); return 2; }, open: (u) => opened.push(u) }), "SideStore");
  assert.deepEqual(opened, [`sidestore://install?url=${encodeURIComponent(URL1)}`]);
  assert.equal(await handOffIpa({ url: URL1 }, { sheet: async () => -1, open: (u) => opened.push(u) }), null);
  assert.equal(opened.length, 1);
});

test("F257: whenBack runs once, only after the page was left and came back", () => {
  const ls = new Set();
  const doc = { visibilityState: "visible", addEventListener: (_, f) => ls.add(f), removeEventListener: (_, f) => ls.delete(f) };
  const fire = (s) => { doc.visibilityState = s; for (const f of [...ls]) f(); };
  let n = 0;
  whenBack(() => n++, doc);
  fire("visible");
  assert.equal(n, 0);
  fire("hidden");
  fire("visible");
  fire("hidden");
  fire("visible");
  assert.equal(n, 1);
  assert.equal(ls.size, 0);
});

test("F257: addSiteUrl keeps what the page knows, and fills it in on a link already kept", () => {
  const s = memStorage();
  const a = addSiteUrl(s, "https://x.example/get?id=7", 0, { name: "Big Game", version: "2", size: BIG, iconUrl: "javascript:1" });
  assert.equal(a.file, "Big Game.ipa");
  assert.equal(a.iconUrl, undefined); // only http(s) icons
  const b = addSiteUrl(s, "https://x.example/get?id=7", 0, { version: "3" });
  assert.equal(b.version, "3");
  assert.equal(siteEntries(s).length, 1);
  assert.equal(siteTooBig({ url: "u", size: 100 * MB }), false);
  assert.equal(siteTooBig({ stored: true, size: BIG }), false);
});

test("F257: the app page marks a version too big on the website only, and not for a source's signed link", () => {
  assert.equal(siteTooBigApp({ downloadURL: URL1, size: BIG }, { site: true }), true);
  assert.equal(siteTooBigApp({ downloadURL: URL1, size: BIG }, { site: false }), false);
  assert.equal(siteTooBigApp({ downloadURL: URL1, size: 100 * MB }, { site: true }), false);
  assert.equal(siteTooBigApp({ downloadURL: URL1 }, { site: true }), false);
  assert.equal(siteTooBigApp({ downloadURL: "itms-services://?action=download-manifest&url=x", size: BIG }, { site: true }), false);
});

test("F257: the website's Install row passes the listed size and the icon on", async () => {
  let got = null;
  const { rows } = installRows({ downloadURL: URL1, version: "2.0", size: BIG }, "https://src.example/s.json", () => {}, () => {}, null, "Big Game",
    { site: true, jailbreak: false, custom: false, gate: ({ install }) => [{ label: "Install on the Website", onClick: install }],
      sign: async (o) => { got = o; }, iconUrl: "https://dl.example/i.png" });
  await rows[0].onClick({});
  assert.equal(got.size, BIG);
  assert.equal(got.iconUrl, "https://dl.example/i.png");
});

test("F257: Install IPAs puts the new row in its own group at the top for the visit", () => {
  const sections = [
    { key: "notInstalled", header: "Not Installed", rows: [{ file: "A.ipa" }, { file: "Big Game.ipa" }] },
    { key: "installed", header: "Installed", rows: [{ file: "C.ipa" }] },
  ];
  const out = freshFirst(sections, "Big Game.ipa");
  assert.deepEqual(out.map((s) => [s.header, s.rows.map((r) => r.file)]), [[FRESH_HEADER, ["Big Game.ipa"]], ["Not Installed", ["A.ipa"]], ["Installed", ["C.ipa"]]]);
  assert.equal(out[0].rows[0].fresh, true);
  assert.equal(freshFirst(sections, null), sections);
  assert.equal(freshFirst(sections, "gone.ipa"), sections);
  markFresh(null);
  assert.equal(freshNote(), null);
});

test("F257: a kept link too big for the website hands off on Install, never the signer", async () => {
  const handed = [];
  let certAlert = 0;
  const ok = await siteInstallSheet({ file: "Big Game.ipa", url: URL1, name: "Big Game", size: BIG },
    { alert: async () => { certAlert++; return { index: 0 }; }, handoff: async (a) => { handed.push(a); return "Feather"; } });
  assert.equal(ok, true);
  assert.deepEqual(handed, [{ url: URL1, name: "Big Game" }]);
  assert.equal(certAlert, 0);
});
