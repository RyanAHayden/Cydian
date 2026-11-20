// B135: Check Connection answers on its own button: a success is a check and "Successful" (no alert), a failure the
// alert as before and an x on the button; back to plain after CHECK_RESET.ms or on the next tap. Both buttons: the
// paired Pairing page's and the main page's action row.
import { test } from "node:test";
import assert from "node:assert/strict";

function make(tag, frag = false) {
  const e = {
    tagName: String(tag).toUpperCase(), isFragment: frag, children: [], attrs: {}, listeners: {}, style: {}, _text: "", _cls: new Set(),
    get className() { return [...e._cls].join(" "); },
    set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)), contains: (c) => e._cls.has(c),
      toggle: (c, on) => (on ? e._cls.add(c) : e._cls.delete(c)) },
    get textContent() { return e._text + e.children.map((c) => c.textContent).join(""); },
    set textContent(v) { e._text = String(v); e.children = []; },
    get firstChild() { return e.children[0] ?? null; },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    removeAttribute(k) { delete e.attrs[k]; },
    append(...c) {
      for (const x of c) {
        if (x.isFragment) { x.children.splice(0).forEach((k) => e.append(k)); continue; }
        x.parent = e;
        e.children.push(x);
      }
    },
    prepend(x) { x.parent = e; e.children.unshift(x); },
    after(x) { x.parent = e.parent; e.parent.children.splice(e.parent.children.indexOf(e) + 1, 0, x); },
    querySelector(sel) { const c = sel.replace(/^\./, ""); const walk = (n) => n.children.find((k) => k._cls.has(c)) ?? n.children.map(walk).find(Boolean); return walk(e) ?? null; },
    querySelectorAll(sel) { const c = sel.replace(/^\./, ""); const out = []; const walk = (n) => n.children.forEach((k) => { if (k._cls.has(c)) out.push(k); walk(k); }); walk(e); return out; },
    replaceChildren(...c) { e.children = []; e._text = ""; e.append(...c); },
    addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
  };
  return e;
}
globalThis.document = { createElement: (t) => make(t), createDocumentFragment: () => make("#fragment", true) };

const { drawInstallation, leave, hudHooks, CHECK_RESET, mainPage } = await import("./installroute.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const cellOf = (box, label) => withClass(box, "cell-inner").find((n) => withClass(n, "cell-label")[0]?.textContent.includes(label));
const tap = (cell) => Promise.all(cell.listeners.click.map((f) => f({})));
const store = (route = "iphone") => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PAIRED_ON = { paired: "rp", pairOnPhone: true, localDevVPN: true, otherVPN: false, tailscale: { connect: "auto", signedIn: false } };
function bridge(answers) {
  return { call: (m) => { const a = answers[m]; return typeof a === "function" ? a() : a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}
const look = (cell) => ({ check: cell.attrs["data-check"] || "", label: withClass(cell, "cell-label")[0].textContent });

test("the Pairing page: success shows a check and Successful with no alert, then goes back to plain", async () => {
  CHECK_RESET.ms = 30;
  const alerts = [];
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native: bridge({ "idevice.status": PAIRED_ON, "idevice.vpnApps": { localdevvpn: true }, "idevice.verify": {} }),
    alert: async (a) => { alerts.push(a.title); return { index: 0 }; } });
  const cell = cellOf(box, "Check Connection");
  await tap(cell);
  assert.deepEqual(alerts, []);
  assert.deepEqual(look(cell), { check: "ok", label: "✓Successful" });
  await wait(50);
  assert.deepEqual(look(cell), { check: "", label: "Check Connection" });
  leave();
});

test("the Pairing page: failure keeps the alert and shows an x until the alert is closed and the time is up", async () => {
  CHECK_RESET.ms = 30;
  let close;
  const alerts = [];
  const box = make("div");
  const err = Object.assign(new Error("connect_failed: no route"), { code: "connect_failed" });
  await drawInstallation(box, "pair", { store: store(), native: bridge({ "idevice.status": PAIRED_ON, "idevice.vpnApps": { localdevvpn: true }, "idevice.verify": err }),
    alert: (a) => { alerts.push(a.title); return new Promise((r) => { close = () => r({ index: 0 }); }); } });
  const cell = cellOf(box, "Check Connection");
  const run = tap(cell);
  await wait(5);
  assert.deepEqual(alerts, ["Turn On LocalDevVPN"]);
  assert.deepEqual(look(cell), { check: "fail", label: "✕Check Connection" });
  await wait(50);
  assert.equal(look(cell).check, "fail", "kept while the alert is up");
  close();
  await run;
  assert.equal(look(cell).check, "fail");
  await wait(50);
  assert.deepEqual(look(cell), { check: "", label: "Check Connection" });
  leave();
});

test("the next tap clears the last answer before it checks again", async () => {
  CHECK_RESET.ms = 300;
  let answer;
  const box = make("div");
  let n = 0;
  await drawInstallation(box, "pair", { store: store(), alert: async () => ({ index: 0 }),
    native: bridge({ "idevice.status": PAIRED_ON, "idevice.vpnApps": { localdevvpn: true }, "idevice.verify": () => (n++ ? new Promise((r) => { answer = r; }) : Promise.resolve({})) }) });
  const cell = cellOf(box, "Check Connection");
  await tap(cell);
  assert.equal(look(cell).check, "ok");
  const again = tap(cell);
  assert.deepEqual(look(cell), { check: "", label: "Check Connection" });
  answer({});
  await again;
  assert.equal(look(cell).check, "ok");
  leave();
});

test("the main page's action row: Successful stays through the status repaint, then goes", async () => {
  CHECK_RESET.ms = 30;
  const alerts = [];
  const page = mainPage({ store: store(), native: bridge({ "idevice.status": PAIRED_ON, "idevice.developerMode": { on: true }, "idevice.verify": {} }),
    alert: async (a) => { alerts.push(a.title); return { index: 0 }; }, links: {} });
  await page.refresh();
  const cell = withClass(page.el, "install-action")[0].children[0];
  assert.equal(look(cell).label, "Check Connection", `status: ${page.status().state}`);
  await tap(cell);
  assert.deepEqual(alerts, []);
  assert.deepEqual(look(cell), { check: "ok", label: "✓Successful" });
  await wait(50);
  assert.deepEqual(look(cell), { check: "", label: "Check Connection" });
});
