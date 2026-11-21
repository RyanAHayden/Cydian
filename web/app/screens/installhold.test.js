// F346: a hold on a package or app page's Install (Modify, Upgrade, Reinstall, the price) opens Install Which Version?:
// the nav spec carries onHold, app.js wires it with nav/menu.js holdButton (HOLD_MS, the tap's click eaten, a short tap
// unchanged), and browse.js installVersionHold offers the source's versions, the installed one marked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../nav/fakedom.test-helper.js";
import { nav, packageWhichButtons, packageWhichVersion, installVersionHold } from "./browse.js";
import { INSTALL_WHICH_TITLE } from "./altstore.js";
import { format } from "../router.js";

// Listeners kept by phase, dispatched as a browser would (as nav/menu-hold.test.js).
function phased(target) {
  const on = {};
  target.on = on;
  target.addEventListener = (t, f, o) => { const c = o === true || o?.capture ? "c" : "b"; (on[t + c] ??= new Set()).add(f); };
  target.removeEventListener = (t, f, o) => { const c = o === true || o?.capture ? "c" : "b"; on[t + c]?.delete(f); };
  return target;
}
function dispatch(doc, target, type, e = {}) {
  const ev = { type, target, detail: 1, pointerId: 1, isPrimary: true, clientX: 300, clientY: 20, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...e };
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  const run = (node, phase) => { for (const f of [...(node.on?.[type + phase] ?? [])]) f(ev); };
  run(doc, "c");
  for (const n of [...path].reverse()) { if (ev.stopped) return ev; run(n, "c"); }
  for (const n of path) { if (ev.stopped) return ev; run(n, "b"); }
  return ev;
}
function barButton() {
  const doc = phased(fakeDocument());
  const make = doc.createElement;
  doc.createElement = (t) => phased(make(t));
  phased(doc.body);
  globalThis.document = doc;
  const b = doc.createElement("button");
  b.classList.add("bar-button");
  doc.body.append(b);
  let clicks = 0;
  b.addEventListener("click", () => { clicks++; });
  return { doc, b, clicks: () => clicks };
}

const ROUTE = { tab: "sources", path: ["src1", "package:com.ex.tweak"] };

test("the package page's nav spec: Install taps as before and holds for the version sheet", () => {
  const spec = nav(ROUTE).right;
  assert.equal(spec.label, "Install");
  assert.equal(typeof spec.onClick, "function");
  assert.equal(typeof spec.onHold, "function");
});

test("holdButton: a ~0.5 s hold runs onHold and eats its click; a tap clicks; no callout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { holdButton, HOLD_MS } = await import("../nav/menu.js");
  assert.ok(HOLD_MS >= 500 && HOLD_MS <= 600);
  const { doc, b, clicks } = barButton();
  const held = [];
  holdButton(b, (x) => held.push(x), { doc });

  dispatch(doc, b, "pointerdown");
  t.mock.timers.tick(HOLD_MS - 1);
  assert.equal(held.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(held, [b]);
  dispatch(doc, b, "pointerup");
  assert.ok(dispatch(doc, b, "click").defaultPrevented);
  assert.equal(clicks(), 0, "the hold's lift doesn't open Install's sheet too");

  dispatch(doc, b, "pointerdown", { pointerId: 2 });
  t.mock.timers.tick(100);
  dispatch(doc, b, "pointerup", { pointerId: 2 });
  dispatch(doc, b, "click", { pointerId: 2 });
  t.mock.timers.tick(HOLD_MS);
  assert.equal(clicks(), 1);
  assert.equal(held.length, 1);

  assert.ok(dispatch(doc, b, "contextmenu").defaultPrevented);
});

const HISTORY = { kind: "deb", versions: [
  { version: "3.0", keys: ["src1"], candidate: true, debUrl: "https://r/3.deb" },
  { version: "2.0", keys: ["src1"], installed: true, debUrl: "https://r/2.deb" },
  { version: "1.5", keys: [] },
  { version: "1.0", keys: ["src2"], debUrl: "https://r/1.deb" },
] };

test("packageWhichButtons: newest first, the installed one marked, none no source offers", () => {
  const { buttons, versions } = packageWhichButtons(HISTORY);
  assert.deepEqual(buttons, ["3.0", "2.0 (Installed)", "1.0"]);
  assert.deepEqual(versions.map((v) => v?.version ?? null), ["3.0", null, "1.0"]);
  assert.deepEqual(packageWhichButtons({ versions: [{ version: "1", keys: ["a"], installed: true }] }).versions, [null]);
});

const page = (history = HISTORY, stanza = { package: "com.ex.tweak", version: "3.0" }) =>
  ({ id: "com.ex.tweak", pkg: { key: "src1", stanza, row: { name: "Tweak" } }, source: null, history, body: { isConnected: true } });

test("packageWhichVersion: a pick queues that version, as Modify > Downgrade does", async () => {
  const jobs = [], asked = [];
  const v = await packageWhichVersion(page(), { queue: async (j) => { jobs.push(j); }, ask: async (o) => { asked.push(o); return o.buttons.indexOf("1.0"); } });
  assert.equal(v.version, "1.0");
  assert.equal(asked[0].title, INSTALL_WHICH_TITLE);
  assert.deepEqual(jobs, [{ op: "install", id: "com.ex.tweak", version: "1.0" }]);
});

test("packageWhichVersion: the installed row and Cancel do nothing; the website downloads the pick's .deb", async () => {
  for (const pick of [(b) => b.indexOf("2.0 (Installed)"), () => -1]) {
    const jobs = [];
    assert.equal(await packageWhichVersion(page(), { queue: async (j) => { jobs.push(j); }, ask: async (o) => pick(o.buttons) }), null);
    assert.deepEqual(jobs, []);
  }
  const got = [];
  const site = { queue: null, site: true, download: (url, id) => got.push([url, id]), ask: async (o) => o.buttons.indexOf("3.0") };
  await packageWhichVersion(page(), site); // queue: null, the website has no install queue
  assert.deepEqual(got, [["https://r/3.deb", "com.ex.tweak"]]);
});

test("packageWhichVersion: a paid package its vendor sells gets no sheet", async () => {
  const asked = [];
  const paid = page(HISTORY, { package: "com.ex.tweak", version: "3.0", tag: "cydia::commercial" });
  assert.equal(await packageWhichVersion(paid, { queue: async () => {}, vendorPaid: async () => true, ask: async (o) => { asked.push(o); return 0; } }), null);
  assert.equal(asked.length, 0);
});

test("installVersionHold: a sideload tweak (Add to App) and a page gone get no sheet", async () => {
  const asked = [];
  const ask = async (o) => { asked.push(o); return -1; };
  const pages = new Map([[format(ROUTE), page(HISTORY, { package: "com.ex.tweak", version: "3.0", injectable: true })]]);
  assert.equal(await installVersionHold(ROUTE, { pages, mode: "sideload", ask }), null);
  assert.equal(await installVersionHold({ tab: "sources", path: ["x", "package:none"] }, { pages, mode: "sideload", ask }), null);
  assert.equal(asked.length, 0);
});

test("installWhichVersion in the jailbreak app: the hold's own install gets the pick", async () => {
  const { installWhichVersion } = await import("./altstore.js");
  const app = { versions: [{ version: "2.0", downloadURL: "https://s/2.ipa" }, { version: "1.0", downloadURL: "https://s/1.ipa" }] };
  const got = [];
  const v = await installWhichVersion(app, {}, null, { installed: "2.0", mode: "jailbreak", ios: null,
    ask: async (o) => o.buttons.indexOf("1.0"), jailbreakInstall: async (x) => { got.push(x.version); } });
  assert.equal(v.version, "1.0");
  assert.deepEqual(got, ["1.0"]);
});
