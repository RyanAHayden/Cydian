// F96: the website pushes iFizBox first. The first-visit prompt's state, the install rows per app (iFizBox vs others,
// website installs accepted or not), the warning whose I Understand counts down 5 seconds (nav/alert.js countdown),
// and the ifizbox://package link the app opens at that app's page (incoming.js).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPT_KEY, FIRST_KEY, websiteInstallsOn, setWebsiteInstalls, acceptWebsiteInstalls, WARNING, WARNING_SECONDS,
  packageLink, packageIdOf, idFromHash, siteGateRows, WEBSITE_ON_SUBTITLE, WEBSITE_OFF_SUBTITLE,
  firstVisitState, setFirstVisit, markiFizBoxInstalled, shouldAskFirst, promptFirstVisit, FIRST_VISIT,
} from "./websign-gate.js";
import { installRows } from "./screens/altstore.js";
import { handleIncoming } from "./incoming.js";
import { showAlert } from "./nav/alert.js";
import { format } from "./router.js";

function memory(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const labels = (rows) => rows.map((r) => r.label);
const OTHER = { version: "1.2", downloadURL: "https://example.com/Delta.ipa" };
const IFIZBOX = { version: "0.3.7", downloadURL: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.3.7/iFizBox.ipa" };
const SITE = { site: true, jailbreak: false, custom: false };

// ---- first visit -----------------------------------------------------------------------------------------------

test("first visit: asks on the website until Not Now or iFizBox is installed; never in the app", () => {
  const s = memory();
  assert.equal(firstVisitState(s), "ask");
  assert.equal(shouldAskFirst({ mode: "site", storage: s }), true);
  assert.equal(shouldAskFirst({ mode: "sideload", storage: s }), false);
  assert.equal(shouldAskFirst({ mode: "jailbreak", storage: s }), false);
  setFirstVisit("later", s);
  assert.equal(firstVisitState(s), "later");
  assert.equal(shouldAskFirst({ mode: "site", storage: s }), false);
  setFirstVisit("ask", s);
  assert.equal(s.getItem(FIRST_KEY), null);
  markiFizBoxInstalled(s);
  assert.equal(firstVisitState(s), "installed");
  assert.equal(shouldAskFirst({ mode: "site", storage: s }), false);
  assert.equal(firstVisitState(memory({ [FIRST_KEY]: "junk" })), "ask");
  assert.equal(firstVisitState(null), "ask", "no storage: asks (this page only)");
});

test("first-visit prompt: Not Now is remembered; Install iFizBox runs Home's flow and keeps asking until it installs", async () => {
  const s = memory();
  const shown = [];
  const alert = (index) => async (o) => { shown.push(o); return { index }; };
  let installs = 0;
  assert.equal(await promptFirstVisit({ mode: "site", storage: s, alert: alert(1), install: async () => { installs++; }, once: false }), "install");
  assert.equal(installs, 1);
  assert.deepEqual(shown[0].buttons, FIRST_VISIT.buttons);
  assert.equal(shown[0].title, "Install iFizBox First");
  assert.equal(firstVisitState(s), "ask", "not installed yet: asks again next launch");
  assert.equal(await promptFirstVisit({ mode: "site", storage: s, alert: alert(0), install: async () => { installs++; }, once: false }), "later");
  assert.equal(installs, 1);
  assert.equal(firstVisitState(s), "later");
  assert.equal(await promptFirstVisit({ mode: "site", storage: s, alert: alert(1), once: false }), null, "Not Now remembered");
  assert.equal(shown.length, 2);
  assert.equal(await promptFirstVisit({ mode: "sideload", storage: memory(), alert: alert(1), once: false }), null, "never in the app");
  // once per launch
  const t = memory();
  assert.equal(await promptFirstVisit({ mode: "site", storage: t, alert: alert(1), install: () => {} }), "install");
  assert.equal(await promptFirstVisit({ mode: "site", storage: t, alert: alert(1), install: () => {} }), null);
});

// ---- rows per app --------------------------------------------------------------------------------------------

function rowsFor(version, storage, log, { alertIndex = 1 } = {}) {
  const gate = (o) => siteGateRows({ ...o, storage, open: (u) => log.opened.push(u),
    alert: async (a) => { log.alerts.push(a); return { index: alertIndex }; },
    install: async () => { log.installs++; } });
  return installRows(version, null, (u) => log.downloads.push(u), () => {}, null, "X", { ...SITE, appId: "com.example.delta", gate });
}
const newLog = () => ({ opened: [], alerts: [], installs: 0, downloads: [] });

test("iFizBox always installs from the website: Install and Download IPA, no gate", () => {
  const log = newLog();
  const r = rowsFor(IFIZBOX, memory(), log);
  assert.deepEqual(labels(r.rows), ["Install", "Download IPA"]);
  assert.equal(r.gated, undefined);
});

test("other apps, not accepted: Install in iFizBox, Download IPA, then Install on the Website greyed out", async () => {
  const s = memory();
  const log = newLog();
  const { rows, gated } = rowsFor(OTHER, s, log, { alertIndex: 0 });
  assert.equal(gated, true);
  assert.deepEqual(labels(rows), ["Install in iFizBox", "Download IPA", "Install on the Website"]);
  assert.equal(rows[2].cls, "websign-off");
  assert.equal(rows[2].subtitle, WEBSITE_OFF_SUBTITLE);
  rows[0].onClick();
  assert.deepEqual(log.opened, ["ifizbox://package?id=com.example.delta"]);
  rows[1].onClick();
  assert.deepEqual(log.downloads, [OTHER.downloadURL]);
  await rows[2].onClick(); // the warning, Cancel
  assert.equal(log.alerts.length, 1);
  assert.deepEqual(log.alerts[0].countdown, { button: 1, seconds: WARNING_SECONDS });
  assert.equal(log.alerts[0].title, WARNING.title);
  assert.equal(log.installs, 0, "Cancel installs nothing");
  assert.equal(websiteInstallsOn(s), false);
});

test("accepting the warning installs and is remembered; afterwards the row is plain and asks nothing", async () => {
  const s = memory();
  const log = newLog();
  await rowsFor(OTHER, s, log).rows[2].onClick();
  assert.equal(log.installs, 1);
  assert.equal(s.getItem(ACCEPT_KEY), "on");
  const again = rowsFor(OTHER, s, log).rows;
  assert.equal(again[2].cls, null);
  assert.equal(again[2].subtitle, WEBSITE_ON_SUBTITLE);
  await again[2].onClick();
  assert.equal(log.installs, 2);
  assert.equal(log.alerts.length, 1, "no second warning");
  setWebsiteInstalls(false, s); // Settings > Signing's switch off
  assert.equal(rowsFor(OTHER, s, log).rows[2].cls, "websign-off");
});

test("acceptWebsiteInstalls: true at once when on; the countdown alert otherwise", async () => {
  let asked = 0;
  assert.equal(await acceptWebsiteInstalls({ storage: memory({ [ACCEPT_KEY]: "on" }), alert: async () => { asked++; return { index: 1 }; } }), true);
  assert.equal(asked, 0);
  assert.equal(await acceptWebsiteInstalls({ storage: memory(), alert: async () => ({ index: 0 }) }), false);
});

test("Install in iFizBox without an id from the caller takes it from the page's hash", () => {
  assert.equal(idFromHash("#/sources/https%3A%2F%2Fa.example%2Fapps.json/package:com.a.b"), "com.a.b");
  assert.equal(idFromHash("#/search/package:com.a.b/versions:com.a.b"), "com.a.b");
  assert.equal(idFromHash("#/home"), null);
});

// ---- the link ------------------------------------------------------------------------------------------------

test("ifizbox://package?id=: built and read back; bad ids are refused", () => {
  assert.equal(packageLink("com.a b"), "ifizbox://package?id=com.a%20b");
  assert.equal(packageIdOf(packageLink("com.example.delta")), "com.example.delta");
  assert.equal(packageIdOf("ifizbox://package?id="), null);
  assert.equal(packageIdOf("ifizbox://package?id=a/b"), null);
  assert.equal(packageIdOf("not a url"), null);
});

test("the app opens ifizbox://package at that app's page (Search's package:<id>)", async () => {
  const hashes = [];
  assert.equal(await handleIncoming("ifizbox://package?id=com.example.delta", { open: (h) => hashes.push(h) }), "package");
  assert.deepEqual(hashes, [format({ tab: "search", path: ["package:com.example.delta"] })]);
  assert.equal(await handleIncoming("ifizbox://package?id=", { open: (h) => hashes.push(h) }), "package");
  assert.equal(hashes.length, 1, "no id: nothing opens");
});

// ---- the countdown in showAlert (a small fake DOM) ------------------------------------------------------------

function fakeDom() {
  const make = (tag) => {
    const e = {
      tagName: tag.toUpperCase(), className: "", children: [], attrs: {}, listeners: {}, style: {}, disabled: false, textContent: "",
      scrollWidth: 0, clientWidth: 100, parent: null,
      classList: { add(c) { e.className += ` ${c}`; }, contains: (c) => e.className.split(/\s+/).includes(c), remove() {} },
      setAttribute(k, v) { e.attrs[k] = v; }, getAttribute: (k) => e.attrs[k] ?? null,
      append(...c) { for (const x of c) { x.parent = e; e.children.push(x); } },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      removeEventListener() {},
      animate: () => ({ finished: Promise.resolve() }),
      focus() {}, blur() {}, remove() { if (e.parent) e.parent.children = e.parent.children.filter((x) => x !== e); },
      click() { if (!e.disabled) for (const f of e.listeners.click ?? []) f({}); },
      get lastChild() { return e.children.at(-1); },
    };
    return e;
  };
  const body = make("body");
  return { createElement: make, body, addEventListener() {}, removeEventListener() {}, activeElement: null, documentElement: {} };
}

test("the warning's I Understand is greyed out for 5 seconds, counting down, then taps", async () => {
  const saved = { document: globalThis.document };
  mock.timers.enable({ apis: ["setInterval"] });
  globalThis.document = fakeDom();
  try {
    const done = showAlert({ ...WARNING, countdown: { button: 1, seconds: WARNING_SECONDS } });
    const box = document.body.children[0].children[0];
    const row = box.children.find((c) => c.className.includes("alert-buttons"));
    const [cancel, ok] = row.children;
    assert.equal(ok.disabled, true);
    assert.equal(ok.textContent, "I Understand (5)");
    assert.equal(cancel.disabled, false);
    ok.click(); // nothing yet
    mock.timers.tick(1000);
    assert.equal(ok.textContent, "I Understand (4)");
    mock.timers.tick(3000);
    assert.equal(ok.textContent, "I Understand (1)");
    assert.equal(ok.disabled, true);
    mock.timers.tick(1000);
    assert.equal(ok.disabled, false);
    assert.equal(ok.textContent, "I Understand");
    ok.click();
    assert.deepEqual(await done, { index: 1, value: undefined });
  } finally {
    mock.timers.reset();
    globalThis.document = saved.document;
  }
});

test("the warning can be cancelled during the countdown", async () => {
  const saved = globalThis.document;
  mock.timers.enable({ apis: ["setInterval"] });
  globalThis.document = fakeDom();
  try {
    const done = showAlert({ ...WARNING, countdown: { button: 1, seconds: 5 } });
    const row = document.body.children[0].children[0].children.find((c) => c.className.includes("alert-buttons"));
    row.children[0].click();
    assert.equal((await done).index, 0);
  } finally {
    mock.timers.reset();
    globalThis.document = saved;
  }
});

test("the website stays locked after iFizBox is installed from it; only Browse Anyway unlocks", async () => {
  const { browsingLocked } = await import("./websign-gate.js");
  const s = memory();
  assert.equal(browsingLocked({ storage: s }), true);
  markiFizBoxInstalled(s);
  assert.equal(browsingLocked({ storage: s }), true); // installed: still locked
  setFirstVisit("later", s);
  assert.equal(browsingLocked({ storage: s }), false); // Browse Anyway
  assert.equal(browsingLocked({ mode: "sideload", storage: memory() }), false); // the app is never locked
});
