// F266: the Not-an-iPhone page (screens/notiphone.js) over a small fake DOM: what it says per device, the QR code and
// Copy Link of https://<DOMAIN>, and its two ways out (Look Around Anyway remembered for good, What Is …? onto the
// FAQ for this visit only).
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAME, DOMAIN } from "../brand.js";
import { DISMISS_KEY } from "../core/platform.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

globalThis.document = fakeDom();
globalThis.Image ??= function Image() { return document.createElement("img"); };
const { showNotIphone, SITE_URL } = await import("./notiphone.js");

const all = (n, out = []) => { for (const c of n.children ?? []) { out.push(c); all(c, out); } return out; };
const one = (n, cls) => all(n).find((x) => x._cls?.has(cls));
const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test("the page names the device, and scans and copies https://<DOMAIN>", async () => {
  const parent = document.createElement("div");
  const copied = [];
  showNotIphone("pc", { parent, win: { localStorage: storage() }, copy: async (t) => { copied.push(t); } });
  const page = one(parent, "notiphone");
  assert.ok(page);
  assert.equal(one(page, "notiphone-title").textContent, `Open ${NAME} on Your iPhone`);
  assert.match(one(page, "notiphone-why").textContent, /this PC can't run it/);
  assert.equal(SITE_URL, `https://${DOMAIN}`);
  const qr = one(page, "notiphone-qr").children[0];
  assert.match(qr.src, /^data:image\/svg\+xml/);
  assert.equal(one(page, "notiphone-domain").textContent, DOMAIN);
  const btn = one(page, "notiphone-copy");
  assert.equal(btn.textContent, "Copy Link");
  await btn.click();
  assert.deepEqual(copied, [SITE_URL]);
  assert.equal(btn.textContent, "Copied");
  const headers = all(page).filter((x) => x._cls?.has("group-header")).map((x) => x.textContent);
  assert.deepEqual(headers, ["Scan With Your iPhone", "On Your iPhone"]);
});

test("Look Around Anyway removes the page, remembers it and opens the normal site", async () => {
  const parent = document.createElement("div");
  const win = { localStorage: storage() };
  const left = showNotIphone("mac", { parent, win });
  await one(parent, "notiphone-anyway").click();
  assert.equal(await left, null);
  assert.equal(one(parent, "notiphone"), undefined);
  assert.equal(win.localStorage.m.get(DISMISS_KEY), "1");
});

test("What Is …? removes the page for this visit and opens the FAQ", async () => {
  const parent = document.createElement("div");
  const win = { localStorage: storage() };
  const left = showNotIphone("android", { parent, win });
  assert.match(one(parent, "notiphone-why").textContent, /Android phones can't run it/);
  const what = one(parent, "notiphone-what");
  assert.equal(what.textContent, `What Is ${NAME}?`);
  await what.click();
  assert.equal(await left, "#/home/guides/faq");
  assert.equal(one(parent, "notiphone"), undefined);
  assert.equal(win.localStorage.m.has(DISMISS_KEY), false);
});
