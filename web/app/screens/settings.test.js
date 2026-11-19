import { test } from "node:test";
import assert from "node:assert/strict";
import { themeMessage, applyTheme, settings } from "./settings.js";

// F230: a localStorage that records what the pages write and remove (before any test opens a theme list, which drops
// F215's old split key once). The settings store above was made at import, on its own storage.
const lsLog = [];
const lsData = new Map([["ifizbox.themePreviewSplit", "0.4"]]);
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (k) => lsData.get(k) ?? null,
  setItem: (k, v) => { lsLog.push(["set", k]); lsData.set(k, String(v)); },
  removeItem: (k) => { lsLog.push(["remove", k]); lsData.delete(k); },
} });

test("the shell gets the fixed theme, or auto while Appearance is Automatic (F23)", () => {
  assert.deepEqual(themeMessage("dark", "dark").params, { style: "dark", theme: "dark", darkPalette: "oled", lightPalette: "classic" });
  assert.deepEqual(themeMessage("light", "light", "gunmetal", "sepia").params,
    { style: "light", theme: "light", darkPalette: "gunmetal", lightPalette: "sepia" });
  assert.deepEqual(themeMessage("auto", "dark").params, { style: "auto", theme: "dark", darkPalette: "oled", lightPalette: "classic" });
  assert.equal(themeMessage("auto", "light").method, "app.theme");
});

test("applyTheme posts app.theme to the bridge once per change", () => {
  const sent = [];
  const win = {
    matchMedia: () => ({ matches: true }),
    webkit: { messageHandlers: { ifizbox: { postMessage: (m) => { sent.push(m); return Promise.resolve(null); } } } },
  };
  const doc = { documentElement: { dataset: {} }, querySelectorAll: () => [] };
  settings.set("appearance", "dark");
  applyTheme(doc, win);
  applyTheme(doc, win);
  assert.equal(doc.documentElement.dataset.theme, "dark");
  assert.equal(doc.documentElement.dataset.palette, "oled"); // F198: OLED Black unless Gunmetal is chosen
  assert.deepEqual(sent.map((m) => m.params), [{ style: "dark", theme: "dark", darkPalette: "oled", lightPalette: "classic" }]);
  settings.set("appearance", "auto");
  applyTheme(doc, win);
  assert.deepEqual(sent.at(-1).params, { style: "auto", theme: "dark", darkPalette: "oled", lightPalette: "classic" });
  // F214: the light theme travels too, in dark as well, for the next launch's ground
  settings.set("lightTheme", "solarized");
  applyTheme(doc, win);
  assert.deepEqual(sent.at(-1).params, { style: "auto", theme: "dark", darkPalette: "oled", lightPalette: "solarized" });
  settings.set("lightTheme", "classic");
  // the site: no handler, no throw
  applyTheme(doc, { matchMedia: () => ({ matches: false }) });
});

test("Update Alerts: what iOS allows, the last background check, and a way to Settings when something is off", async () => {
  const { notifyRows } = await import("./settings.js");
  const now = Date.parse("2026-11-18T12:00:00Z");
  const off = notifyRows({ badges: false, alerts: true, backgroundRefresh: true, lastCheck: null }, now);
  assert.deepEqual(off.rows.map((r) => [r.label, r.detail ?? ""]), [["Check in the Background", "On"], ["Icon Badge", "Off"], ["Notifications", "On"],
    ["Background App Refresh", "On"], ["Last Background Check", "Not yet"], ["Turn On in Settings", ""]]);
  const on = notifyRows({ badges: true, alerts: true, backgroundRefresh: true, lastCheck: "2026-11-18T09:00:00Z" }, now);
  assert.equal(on.rows.at(-1).detail, "3 h ago");
  assert.equal(on.rows.length, 5);
  const quiet = notifyRows({ backgroundOn: false, badges: false, alerts: false, backgroundRefresh: false }, now);
  assert.equal(quiet.rows[0].detail, "Off"); // turned off here: no nudge to Settings
  assert.equal(quiet.rows.some((r) => r.open), false);
});

// F128: Settings' pages and their titles, like iOS 6's (the root, General, Theme, Updates, a list page under one),
// and the older one-segment routes other screens still link to.
test("F128: page titles for the iOS 6-style routes and the old ones", async () => {
  const { nav } = await import("./settings.js");
  const t = (...path) => nav({ tab: "home", path }).title;
  assert.equal(t(), "Settings");
  assert.equal(t("general"), "General");
  assert.equal(t("theme"), "Theme"); // F205: was Display
  assert.equal(t("display"), "Theme"); // the old route still opens it
  assert.equal(t("updates"), "Updates");
  assert.notEqual(t("about"), "About"); // F183: no About page
  assert.equal(t("general", "device"), "Device");
  assert.equal(t("updates", "holds"), "Ignored Upgrades");
  assert.equal(t("signing"), "Signing");
  assert.equal(t("signing", "resignReminder"), "Re-sign Reminder");
  assert.equal(t("device"), "Device"); // Home's hint
  assert.equal(t("iosVersion"), "iOS Version"); // a package page's link
  assert.equal(t("holds"), "Ignored Upgrades");
  assert.equal(t("account"), "iFizBox Account");
});

// F134: Settings > Signing like an iOS 6 settings page: the certificate first, then its profile, the options, and How
// Signing Works as a link at the bottom.
test("F134: the Signing page's groups, in order, for each build and state", async () => {
  const { signingLayout, splitSummary, HELP } = await import("./settings.js");
  const { SIGNING_GROUPS } = await import("../core/settings.js");
  assert.deepEqual(SIGNING_GROUPS.slice(0, 4), ["certificate", "files", "profile", "options"]);
  assert.equal(SIGNING_GROUPS.at(-1), "help");
  // the sideload app, set up
  assert.deepEqual(signingLayout({ mode: "sideload", certificate: true, profile: true, options: true }),
    ["certificate", "profile", "options", "server", "status", "remove", "help"]);
  // nothing yet: the certificate's Import row, the options, the server, then the walkthrough's link
  assert.deepEqual(signingLayout({ mode: "sideload", options: true }), ["certificate", "options", "server", "status", "help"]);
  // a file picked, one still missing: the Files group under the certificate
  assert.deepEqual(signingLayout({ mode: "sideload", staged: true, options: true }), ["certificate", "files", "options", "server", "status", "remove", "help"]);
  // the website: no options, server or Signed Apps; Install iFizBox App once the certificate works
  assert.deepEqual(signingLayout({ mode: "site", certificate: true, profile: true, ready: true }), ["certificate", "profile", "app", "other", "remove", "help"]);
  assert.deepEqual(signingLayout({ mode: "site" }), ["certificate", "other", "help"]);
  // each layout is in SIGNING_GROUPS order with no group twice
  for (const l of [signingLayout({ mode: "sideload", certificate: true, staged: true, profile: true, options: true }), signingLayout({ mode: "site", staged: true })]) {
    assert.deepEqual(l, SIGNING_GROUPS.filter((g) => l.includes(g)));
    assert.equal(new Set(l).size, l.length);
  }
  // the summary's rows split into the two groups, no row in both
  const rows = [{ label: "Certificate", detail: "iPhone Distribution: Jane Doe" }, { label: "Team", detail: "Jane" },
    { label: "Certificate Expires", detail: "1/1/27" }, { label: "Profile", detail: "Wild" }, { label: "Profile Expires", detail: "2/2/27" },
    { label: "Devices", detail: "3" }, { label: "App ID", detail: "ABC.*" }];
  const split = splitSummary(rows);
  assert.deepEqual(split.certificate.map((r) => [r.label, r.detail ?? r.subtitle]), [["Name", "iPhone Distribution: Jane Doe"], ["Team", "Jane"], ["Expires", "1/1/27"]]);
  assert.equal(split.certificate[0].subtitle, "iPhone Distribution: Jane Doe"); // long: under the label
  assert.deepEqual(split.profile.map((r) => r.label), ["Name", "Expires", "Devices", "App ID"]);
  assert.equal(HELP, "help");
});

test("F134: the walkthrough is How Signing Works, a page below Signing", async () => {
  const { nav } = await import("./settings.js");
  assert.equal(nav({ path: ["signing", "help"] }).title, "How Signing Works");
  assert.equal(nav({ path: ["signing", "showExpiry"] }).title, "Show Expiry Dates");
});

// F149: the certificate's Password row reads as a field: a "Required" hint, not the file rows' "None", and a tap
// anywhere on the row (not its Browse button) puts the caret in it.
test("F149: Password row placeholder and tap-to-focus", async () => {
  const { passwordPlaceholder, focusOnRowTap } = await import("./settings.js");
  assert.equal(passwordPlaceholder(null, null), "Required");
  assert.equal(passwordPlaceholder({ profile: {} }, new Uint8Array(1)), "Required");
  assert.equal(passwordPlaceholder({ profile: {} }, null), "Not Kept");
  assert.notEqual(passwordPlaceholder(null, null), "None");

  let onClick = null, focused = 0;
  const li = { addEventListener: (type, fn) => { if (type === "click") onClick = fn; } };
  const input = { focus: () => { focused++; } };
  assert.equal(focusOnRowTap(li, input), li);
  onClick({ target: { closest: () => null } }); // the row's label or padding
  assert.equal(focused, 1);
  onClick({ target: { closest: (sel) => (sel === ".sign-browse" ? {} : null) } }); // Browse: its picker, not the field
  assert.equal(focused, 1);
  onClick({ target: input }); // the field itself focuses on its own
  assert.equal(focused, 1);
});

// B20: Settings > Signing > Signing Server's row opens an alert with a text field for your own server; Save stores
// the URL and checks it. Empty Save means the default.
test("B20: tapping the Signing Server row opens the alert with a field, Save stores the URL and runs the check", async () => {
  const { serverRow, askServer } = await import("./settings.js");
  const def = "https://sign.example.dev";
  let server = def, specs = [], checks = 0, redraws = 0, answer = { index: 1, value: "  https://my.worker.dev  " };
  const deps = { alert: async (spec) => { specs.push(spec); return answer; }, current: () => server, def: () => def,
    save: (s) => { server = s; }, check: async () => { checks++; }, redraw: () => { redraws++; } };
  let asked = null;
  const row = serverRow({ server, fallback: def, ask: () => { asked = askServer(null, deps); } });
  assert.equal(typeof row.onClick, "function");
  assert.equal(row.chevron, true);
  assert.equal(row.cls, "server-field-default"); // the default's host in the hint grey
  assert.equal(row.detail, "sign.example.dev");
  row.onClick();
  assert.equal(await asked, true);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].input.type, "url");
  assert.equal(specs[0].input.value, ""); // the default shows as an empty field, its URL the placeholder
  assert.equal(specs[0].input.placeholder, def);
  assert.deepEqual(specs[0].buttons, ["Cancel", "Save"]);
  assert.equal(server, "https://my.worker.dev");
  assert.equal(checks, 1);
  assert.equal(redraws, 1);
  // your own server: in the field colour, and the field opens with it
  const own = serverRow({ server, fallback: def, ask: () => {} });
  assert.equal(own.cls, "server-field");
  assert.equal(own.detail, "my.worker.dev");
  answer = { index: 1, value: "" };
  await askServer(null, deps);
  assert.equal(specs[1].input.value, "https://my.worker.dev");
  assert.equal(server, def); // empty: back to the default
  // Cancel: nothing saved, no check
  answer = { index: 0, value: "https://other.dev" };
  assert.equal(await askServer(null, deps), false);
  assert.equal(server, def);
  assert.equal(checks, 2);
});

// B20: the web view's window focus comes back on an ordinary tap; a full redraw then swapped the rows under the finger
// and iOS dropped the click. Focus only re-reads signing.status; coming back from hidden still redraws.
test("B20: window focus doesn't redraw the Signing page unless the certificate changed", async () => {
  const { returnWatcher } = await import("./settings.js");
  const on = {};
  const target = () => ({ addEventListener: (t, fn) => { on[t] = fn; } });
  const doc = Object.assign(target(), { visibilityState: "visible", querySelector: () => ({}) });
  const win = target();
  let redraws = 0, ready = false;
  const check = returnWatcher({ doc, win, redraw: () => { redraws++; }, status: async () => (ready ? { identity: { profile: {} } } : { identity: null }),
    interval: () => {} });
  await check(); // the first look
  await on.focus();
  await on.focus();
  assert.equal(redraws, 0);
  ready = true; // a certificate landed while away
  await on.focus();
  assert.equal(redraws, 1);
  on.visibilitychange();
  assert.equal(redraws, 2);
});

// F183: no About page (no Check for Updates, no Skip This Version); the root ends with Home's version line.
function fakeElement(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, style: {}, dataset: {}, className: "", textContent: "", hidden: false,
    classList: { add: (...c) => { e.className = [e.className, ...c].filter(Boolean).join(" "); }, remove() {}, toggle() {}, contains: (c) => e.className.split(" ").includes(c) },
    append(...k) { for (const c of k) if (c && typeof c === "object") { if (c.tagName === "#FRAG") e.children.push(...c.children); else e.children.push(c); } },
    prepend(...k) { e.append(...k); }, replaceChildren(...k) { e.children = []; e.append(...k); },
    setAttribute(a, v) { e.attrs[a] = v; }, getAttribute: (a) => e.attrs[a] ?? null, removeAttribute(a) { delete e.attrs[a]; },
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    remove() {}, replaceWith() {}, isConnected: true, scrollTop: 0, firstChild: null,
  };
  return e;
}
const texts = (n, out = []) => { if (n.textContent) out.push(n.textContent); for (const c of n.children ?? []) texts(c, out); return out; };

test("F183: the about route is gone and Settings' root ends with the version line", async () => {
  // The root's sections fill in later (certificate, signer status) against this fake DOM: it stays (each test file
  // runs in its own process).
  globalThis.document = { createElement: fakeElement, createTextNode: (t) => ({ textContent: t }), createDocumentFragment: () => fakeElement("#frag"),
    head: null, body: fakeElement("body"), documentElement: fakeElement("html"), querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {} };
  const { render, nav } = await import("./settings.js");
  const { footLine } = await import("./home.js");
  assert.equal(nav({ path: ["about"] }).title, "Settings");
  const root = fakeElement("div");
  render(root, { tab: "home", path: [] });
  const [foot, commit] = root.children.slice(-2);
  assert.equal(foot.className, "home-version");
  assert.equal(commit.className, "home-version home-commit");
  assert.match(foot.textContent, /^iPhone, (iOS [^,]+, )?iFizBox Web \(/); // the website's line, as Home's
  assert.equal(foot.textContent.replace(/iOS [^,]+, /, ""), footLine({ web: true }));
  for (const t of texts(root)) assert.doesNotMatch(t, /^About$|Check for Updates|Skip This Version/);
});

test("F183: settings.js has no About page or update check left", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  for (const gone of ["aboutPage", "aboutRow", "checkUpdates", "setSkip", "Check for Updates", "Skip This Version", '"about"']) {
    assert.equal(src.includes(gone), false, gone);
  }
});

// F205: iOS 6 Settings' row tiles. The root's page rows and General's settings carry one; Theme's Appearance choices
// (Automatic / Light / Dark) stay bare, as iOS 6 leaves option rows. Compatibility Marks is on General now.
test("F205: Settings root, General and Theme rows carry iOS 6 tiles where iOS 6 would", async () => {
  // fakeElement with querySelector(All) for one class (".group", ".cell-inner"): the pages put switches in by them.
  const find = (n, cls, out = []) => {
    for (const c of n.children ?? []) {
      if (String(c.className).split(" ").includes(cls)) out.push(c);
      find(c, cls, out);
    }
    return out;
  };
  const rich = (tag) => {
    const e = fakeElement(tag);
    e.querySelectorAll = (sel) => (/^\.[\w-]+$/.test(sel) ? find(e, sel.slice(1)) : []);
    e.querySelector = (sel) => e.querySelectorAll(sel)[0] ?? null;
    return e;
  };
  globalThis.document = { createElement: rich, createTextNode: (t) => ({ textContent: t }), createDocumentFragment: () => rich("#frag"),
    head: null, body: rich("body"), documentElement: rich("html"), querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {} };
  const { render } = await import("./settings.js");
  const cells = (n, out = []) => {
    if (n.className === "cell") out.push(n);
    for (const c of n.children ?? []) cells(c, out);
    return out;
  };
  const rows = (path) => {
    const root = fakeElement("div");
    render(root, { tab: "home", path });
    return cells(root).map((li) => {
      const inner = li.children[0];
      const icon = inner.children.find((c) => String(c.className).startsWith("cell-icon"));
      const label = texts(inner.children.find((c) => c.className === "cell-text"))[0];
      return [label, icon ? icon.className : null, icon?.children[0]?.src?.slice(0, 19) ?? null];
    });
  };
  const root = rows([]);
  for (const name of ["General", "Theme", "Updates"]) {
    assert.deepEqual(root.find((r) => r[0] === name), [name, "cell-icon row-icon", "data:image/svg+xml,"], name);
  }
  assert.equal(root.some((r) => r[0] === "Display"), false);
  const general = rows(["general"]);
  const at = (label) => general.findIndex((r) => r[0] === label);
  assert.equal(at("Compatibility Marks"), at("Works on My Phone") + 1);
  for (const r of general) assert.equal(r[1], "cell-icon row-icon", r[0]);
  // F199: Theme is Mode (a segmented control, no rows) and Themes' two push rows, bare like iOS 6's.
  const theme = rows(["theme"]);
  assert.deepEqual(theme.map((r) => r[0]), ["Light", "Dark"]);
  for (const r of theme) assert.equal(r[1], null, r[0]);
  assert.deepEqual(rows(["display"]).map((r) => r[0]), ["Light", "Dark"]); // the old route
  // each theme list: a checked row per theme, each with its swatch
  // (then the preview's sample rows, which start at Sources)
  const list = (k) => { const r = rows(["theme", k]); return r.slice(0, r.findIndex((x) => x[0] === "Sources")).map((x) => [x[0], x[1]]); };
  assert.deepEqual(list("darkTheme"),
    ["OLED Black", "Gunmetal", "Midnight", "Linen", "Nord", "Dracula"].map((t) => [t, "cell-icon theme-swatch"]));
  assert.deepEqual(list("lightTheme"),
    ["Classic", "Sepia", "Solarized Light"].map((t) => [t, "cell-icon theme-swatch"]));
});

// F199: Settings > Theme: Mode (segmented Automatic / Light / Dark) under its header, then Themes with Light and Dark
// rows whose detail is the theme chosen; the segments set Mode.
test("F199: Theme page: Mode's segmented control, then Light > Classic and Dark > OLED Black", async () => {
  const { render, settings } = await import("./settings.js");
  const find = (n, pred, out = []) => { for (const c of n.children ?? []) { if (pred(c)) out.push(c); find(c, pred, out); } return out; };
  const was = [settings.get("appearance"), settings.get("darkTheme")];
  try {
    settings.set("appearance", "dark");
    settings.set("darkTheme", "oled");
    const root = fakeElement("div");
    render(root, { tab: "home", path: ["theme"] });
    const [mode, themes] = root.children;
    assert.deepEqual(mode.children.map((c) => String(c.className).split(" ")[0]), ["group-header", "store-segmented", "group-footer"]);
    assert.equal(mode.children[0].textContent, "Mode");
    const bar = mode.children[1];
    assert.equal(bar.attrs.role, "radiogroup");
    // (the fake classList can't toggle "selected": aria-selected is set beside it)
    assert.deepEqual(bar.children.map((b) => [b.textContent, b.attrs.role, b.attrs["aria-selected"]]),
      [["Automatic", "radio", "false"], ["Light", "radio", "false"], ["Dark", "radio", "true"]]);
    assert.equal(themes.children[0].textContent, "Themes");
    const details = find(themes, (c) => c.className === "cell-detail").map((c) => c.textContent);
    assert.deepEqual(details, ["Classic", "OLED Black"]);
    settings.set("darkTheme", "gunmetal");
    assert.equal(settings.get("darkTheme"), "gunmetal");
  } finally { settings.set("appearance", was[0]); settings.set("darkTheme", was[1]); }
});

test("F199: the theme lists preview their tone; other routes don't", async () => {
  const { previewOf } = await import("./settings.js");
  const r = (...path) => ({ tab: "home", path: ["settings", ...path] });
  assert.equal(previewOf(r("theme", "darkTheme")), "dark");
  assert.equal(previewOf(r("theme", "lightTheme")), "light");
  assert.equal(previewOf(r("display", "darkTheme")), "dark"); // Theme's old id
  assert.equal(previewOf(r("darkTheme")), "dark"); // the one-segment form
  assert.equal(previewOf(r("theme")), null);
  assert.equal(previewOf(r("general", "darkTheme")), null);
  assert.equal(previewOf({ tab: "sources", path: ["darkTheme"] }), null);
  assert.equal(previewOf(null), null);
});

test("picking a theme in Theme > Light / Dark switches Mode to that tone", async () => {
  const { pick } = await import("./settings.js");
  const { SETTINGS } = await import("../core/settings.js");
  const d = (k) => SETTINGS.find((s) => s.key === k);
  settings.set("appearance", "auto");
  pick(d("lightTheme"), "sepia");
  assert.equal(settings.get("lightTheme"), "sepia");
  assert.equal(settings.get("appearance"), "light");
  pick(d("darkTheme"), "nord");
  assert.equal(settings.get("appearance"), "dark");
  pick(d("device"), "none"); // not a theme list: Mode stays
  assert.equal(settings.get("appearance"), "dark");
});

// F215/F230: Theme > Light / Dark's preview is a movable split. Geometry in page px (an iPhone 7 web app: 647 tall, nav
// to 64, tab bar from 598); rows 44px from y 74 (a group's 10px margin), the footer 40px under the last.
const rowsFrom = (n) => [...Array.from({ length: n }, (_, i) => 74 + 44 * (i + 1)), 74 + 44 * n + 40 + 10];
const splitGeo = (n) => ({ top: 64, bottom: 598, screen: 647, edges: rowsFrom(n) });

test("F230: the preview's split: a 100px peek on entry (snapped to a row edge), half after a tap, a drag wins", async () => {
  const { entrySplit, splitHeight, clampSplit, SPLIT_PEEK, SPLIT_MIN } = await import("./settings.js");
  const geo = splitGeo;
  assert.equal(SPLIT_PEEK, 100);
  assert.ok(SPLIT_PEEK >= SPLIT_MIN);
  // Dark's six themes end at 388 (footer and gap): far above the peek's line (498), so the preview is just the peek
  assert.equal(entrySplit(geo(6)), 100);
  assert.equal(entrySplit(geo(3)), 100); // Light's three
  // twelve rows reach past the line: the divider snaps up to the row edge above it (row 9 ends at 470), never cutting one
  const twelve = entrySplit(geo(12));
  assert.equal(twelve, 598 - 470);
  assert.ok(geo(12).edges.includes(598 - twelve), "the divider sits on a row's bottom edge");
  assert.ok(twelve >= SPLIT_PEEK && twelve < SPLIT_PEEK + 44);
  // an edge exactly on the line is used as is
  assert.equal(entrySplit({ top: 64, bottom: 598, screen: 647, edges: [498, 542] }), 100);
  // a tap: half the screen
  assert.equal(splitHeight(geo(12), { tapped: true }), Math.round(647 / 2));
  assert.equal(splitHeight(geo(6), { tapped: true }), Math.round(647 / 2));
  assert.equal(splitHeight(geo(12), {}), twelve);
  // a dragged height (px, this visit) wins over both, and stays inside the page
  assert.equal(splitHeight(geo(12), { dragged: 259 }), 259);
  assert.equal(splitHeight(geo(12), { dragged: 259, tapped: true }), 259);
  assert.equal(splitHeight(geo(12), { dragged: 10, tapped: true }), SPLIT_MIN);
  assert.equal(clampSplit(10, geo(1)), 64);
  assert.equal(clampSplit(900, geo(1)), 598 - 64 - 44);
});

test("F230: the split lasts one visit: leave and re-enter -> the peek; nothing stored, F215's key removed once", async () => {
  const { render, splitTapped, splitDropped, splitNow, SPLIT_KEY } = await import("./settings.js");
  const dark = { tab: "home", path: ["theme", "darkTheme"] };
  const geo = splitGeo(12);
  const peek = 598 - 470;
  render(fakeElement("div"), dark);
  assert.equal(splitNow(geo), peek);
  splitTapped(); // the first theme tap: half
  assert.equal(splitNow(geo), Math.round(647 / 2));
  splitTapped(); // later taps keep it
  assert.equal(splitNow(geo), Math.round(647 / 2));
  splitDropped(200); // the divider let go at 200
  splitTapped(); // a tap after a drag keeps the drag
  assert.equal(splitNow(geo), 200);
  render(fakeElement("div"), { tab: "home", path: ["theme"] }); // Back to Theme: no reset there...
  assert.equal(splitNow(geo), 200);
  render(fakeElement("div"), dark); // ...re-entering a theme list starts fresh
  assert.equal(splitNow(geo), peek);
  splitDropped(300); // a drag before any tap: the tap then keeps it
  splitTapped();
  assert.equal(splitNow(geo), 300);
  render(fakeElement("div"), { tab: "home", path: ["theme", "lightTheme"] });
  assert.equal(splitNow(geo), peek);
  // localStorage: the old key went, once, and nothing was written for the split
  assert.equal(SPLIT_KEY, "ifizbox.themePreviewSplit");
  assert.equal(lsData.has(SPLIT_KEY), false);
  assert.equal(lsLog.filter(([op, k]) => op === "remove" && k === SPLIT_KEY).length, 1);
  assert.deepEqual(lsLog.filter(([op]) => op === "set"), []);
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  for (const gone of ["savedSplit", "saveSplit", "SPLIT_FLOOR", "setItem(SPLIT_KEY"]) assert.equal(src.includes(gone), false, gone);
});
