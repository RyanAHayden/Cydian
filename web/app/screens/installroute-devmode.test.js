// Developer Mode in Settings > Installation & Signing (screens/installroute.js, core developerModeInfo): read for real
// through the pairing (idevice.developerMode), shown under Pairing whatever the profile kind (iOS asks for it for Ad
// Hoc too); off: the steps in the footer, in red; not paired, the VPN off, or no answer: no row and no call.
import { test } from "node:test";
import assert from "node:assert/strict";

// A small fake DOM: enough for nav/ui.js grouped().
function make(tag, frag = false) {
  const e = {
    tagName: String(tag).toUpperCase(), isFragment: frag, children: [], attrs: {}, listeners: {}, style: {}, _text: "", _cls: new Set(),
    isConnected: true,
    get className() { return [...e._cls].join(" "); },
    set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), contains: (c) => e._cls.has(c) },
    get textContent() { return e._text + e.children.map((c) => c.textContent).join(""); },
    set textContent(v) { e._text = String(v); e.children = []; },
    get firstChild() { return e.children[0] ?? null; },
    querySelector(sel) { const c = sel.replace(/^\./, ""); return all(e).slice(1).find((n) => n._cls.has(c)) ?? null; },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    append(...c) {
      for (const x of c) {
        if (x.isFragment) { x.children.splice(0).forEach((k) => e.append(k)); continue; }
        e.children.push(x);
      }
    },
    replaceChildren(...c) { e.children = []; e.append(...c); },
    addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
  };
  return e;
}
const all = (e) => [e, ...e.children.flatMap(all)];
globalThis.document = { createElement: (t) => make(t), createDocumentFragment: () => make("#fragment", true) };

const { drawInstallation, installationGroups, readDeveloperMode } = await import("./installroute.js");
const { developerModeInfo, canReadDeveloperMode, DEV_MODE_STEPS } = await import("../core/installroute.js");

const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const labels = (box) => withClass(box, "cell-label").map((n) => n.textContent);
const store = (route) => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; };
const flush = () => new Promise((r) => setTimeout(r, 0));
const PAIRED_ON = { paired: "rp", localDevVPN: true, otherVPN: false, tailscale: { connect: "auto", signedIn: false } };

function bridge(answers) {
  const calls = [];
  return { calls, call: (m, p) => { calls.push(m); const a = answers[m]; return a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}

test("the rule: on is a row only, off is a row and the steps, unknown is nothing", () => {
  assert.deepEqual(developerModeInfo(true), { row: { label: "Developer Mode", detail: "On" }, footer: "" });
  const off = developerModeInfo(false);
  assert.deepEqual(off.row, { label: "Developer Mode", detail: "Off" });
  assert.ok(off.warn);
  assert.ok(off.footer.includes(DEV_MODE_STEPS));
  assert.match(DEV_MODE_STEPS, /Privacy & Security > Developer Mode/);
  for (const v of [null, undefined, "on"]) assert.equal(developerModeInfo(v), null);
});

test("asked only with a pairing and a way to reach iOS", () => {
  assert.equal(canReadDeveloperMode(PAIRED_ON), true);
  assert.equal(canReadDeveloperMode({ paired: "lockdown", tailscale: { use: true } }), true);
  assert.equal(canReadDeveloperMode({ paired: null, localDevVPN: true }), false);
  assert.equal(canReadDeveloperMode({ paired: "rp", localDevVPN: false }), false);
  assert.equal(canReadDeveloperMode(null), false);
});

test("This iPhone's group: the row under Pairing once paired; off adds the steps before the VPN note", () => {
  const on = installationGroups("iphone", PAIRED_ON, { devMode: true })[1];
  assert.deepEqual(on.rows.map((r) => r.label), ["Pairing", "Developer Mode", "LocalDevVPN", "Open LocalDevVPN"]);
  assert.equal(on.rows[1].detail, "On");
  assert.doesNotMatch(on.footer, /Developer Mode/);
  assert.equal(on.warn, undefined);
  const off = installationGroups("iphone", PAIRED_ON, { devMode: false })[1];
  assert.equal(off.rows[1].detail, "Off");
  assert.ok(off.footer.startsWith("iOS won't open the apps you sign until Developer Mode is on."));
  assert.match(off.footer, /LocalDevVPN must be on/);
  assert.equal(off.warn, true);
  // not read, or not paired: no row
  assert.ok(!installationGroups("iphone", PAIRED_ON)[1].rows.some((r) => r.label === "Developer Mode"));
  assert.ok(!installationGroups("iphone", { ...PAIRED_ON, paired: null }, { devMode: false })[1].rows.some((r) => r.label === "Developer Mode"));
});

test("the page reads Developer Mode through the pairing and shows Off with the steps in red", async () => {
  const native = bridge({ "idevice.status": PAIRED_ON, "idevice.developerMode": { on: false } });
  const box = make("div");
  await drawInstallation(box, null, { store: store("iphone"), native });
  await flush();
  assert.deepEqual(native.calls, ["idevice.status", "idevice.developerMode"]);
  assert.ok(labels(box).includes("Developer Mode"), labels(box).join(", "));
  const footer = withClass(box, "group-footer").find((n) => n.textContent.includes(DEV_MODE_STEPS));
  assert.ok(footer, "the steps are in a footer");
  assert.ok(footer._cls.has("sign-warning"));
});

test("on: the row and no steps; the VPN off, the Signing Server, or no answer: no call or no row", async () => {
  let native = bridge({ "idevice.status": PAIRED_ON, "idevice.developerMode": { on: true } });
  let box = make("div");
  await drawInstallation(box, null, { store: store("iphone"), native });
  assert.ok(labels(box).includes("Developer Mode"));
  assert.ok(!box.textContent.includes(DEV_MODE_STEPS));

  native = bridge({ "idevice.status": { ...PAIRED_ON, localDevVPN: false }, "idevice.developerMode": { on: false } });
  box = make("div");
  await drawInstallation(box, null, { store: store("iphone"), native });
  assert.deepEqual(native.calls, ["idevice.status"]);
  assert.ok(!labels(box).includes("Developer Mode"));

  native = bridge({ "idevice.status": PAIRED_ON, "idevice.developerMode": { on: false } });
  await drawInstallation(make("div"), null, { store: store("server"), native });
  assert.deepEqual(native.calls, ["idevice.status"]);

  native = bridge({ "idevice.status": PAIRED_ON, "idevice.developerMode": new Error("devmode_failed: timed out") });
  box = make("div");
  await drawInstallation(box, null, { store: store("iphone"), native });
  assert.ok(!labels(box).includes("Developer Mode"));
  assert.equal(await readDeveloperMode(bridge({ "idevice.developerMode": { on: null } })), null);
  assert.equal(await readDeveloperMode(undefined), null);
});
