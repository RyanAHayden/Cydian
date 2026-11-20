// R45: render the sideload package page's "Add to an App" group (screens/tweaks.js worksInGroup) for a paid tweak with
// a tiny fake DOM and F308's fake shell + fake vendor, then print the rows and footer after each step.
// Run from the repo root: node journal/2026-11-20-r45-paid-sideload-check/group.mjs
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from "node:fs";
import { join } from "node:path";

class E {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this._text = ""; this.className = ""; this.on = {};
    this.classList = { add: (c) => { this.className += ` ${c}`; }, remove() {}, contains: (c) => this.className.split(" ").includes(c) }; }
  append(...k) { for (const c of k) this.children.push(typeof c === "string" ? Object.assign(new E("#text"), { _text: c }) : c); }
  replaceChildren(...k) { this.children = []; this.append(...k); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  addEventListener(t, f) { this.on[t] = f; }
  click() { this.on.click?.(); }
}
globalThis.document = { createElement: (t) => new E(t), head: null };

const root = process.cwd();
const { createFakeNative, makeFixture } = await import(join(root, "native/fake/fake-native.mjs"));
const { createFakeVendor } = await import(join(root, "native/fake/fake-vendor.mjs"));
const { createPaidTweaks, worksInGroup } = await import(join(root, "web/app/screens/tweaks.js"));

const ID = "com.me.fixture";
const DEB = readFileSync(join(root, "web/app/core/fixtures/tweaks/tweak-xz.deb"));
const REPO = "https://repo.vendor.test/";
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

function show(label, g) {
  const ul = g.el.children.find((c) => c.className.includes("table"));
  const foot = g.el.children.find((c) => c.className.includes("group-footer"));
  console.log(`  ${label}:`);
  for (const li of ul.children) {
    const b = li.children[0];
    const lab = b.children.find((c) => c.className.includes("cell-text"))?.textContent ?? b.textContent;
    const det = b.children.find((c) => c.className.includes("cell-detail"))?.textContent;
    console.log(`    [${b.tagName === "BUTTON" ? "tap" : "   "}] ${lab}${det != null ? `  |  ${det}` : ""}`);
  }
  console.log(`    footer: ${foot.textContent}`);
}
const rowNamed = (g, re) => g.el.children.find((c) => c.className.includes("table")).children.map((li) => li.children[0])
  .find((b) => re.test(b.textContent));
const settle = () => new Promise((r) => setTimeout(r, 50));

for (const price of ["FREE", "$1.99"]) {
  const fx = makeFixture();
  const vendor = createFakeVendor({ packages: { [ID]: { price, version: "1.0" } } });
  const one = vendor.download.bind(vendor);
  vendor.download = (url) => { const r = one(url); return r?.status === 200 ? { status: 200, body: DEB } : r; };
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, mode: "sideload", vendors: [vendor],
    paidTweakDir: join(fx.dir, "paid-tweaks"), device: null, phoneUdid: "00008030-001A2B3C4D5E6F70" });
  const call = (m, p) => native.call(m, p);
  const paid = createPaidTweaks({ call, storage: mem(), vendorFor: async () => ({ base: vendor.base, source: { key: "v", uri: REPO } }) });
  const st = { package: ID, name: "Fixture", version: vendor.packages[ID].version, tag: "role::enduser, cydia::commercial",
    architecture: "iphoneos-arm64", debUrl: `${REPO}debs/fixture.deb`, depends: "mobilesubstrate" };
  console.log(`price ${price}`);
  const g = worksInGroup(st, { paid, storage: mem(), apps: async () => [] });
  await g.ready; show("signed out", g);
  rowNamed(g, /^Sign In/)?.click(); await settle(); await settle(); show("after Sign In", g);
  const buy = rowNamed(g, /^Buy/);
  if (buy) { buy.click(); await settle(); await settle(); show("after Buy", g); }
  fx.cleanup();
}
