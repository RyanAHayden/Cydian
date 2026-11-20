// B143: leaving This iPhone's page (screens/installroute.js) while a Tailscale sign-in it started runs (Starting…,
// Waiting for approval) asks "Stop Setting Up?" as pairing does; Leave stops it with tailscale.signInCancel, once.
// A sign-in started from Settings' main page is not this page's to stop.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

// The shared fake DOM: enough for nav/ui.js grouped() and the pair page's sections.
globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { format, settingsRoute } = await import("../router.js");
const { drawInstallation, leave, pendingStep, askLeave } = await import("./installroute.js");
const { leaveQuestion, LEAVE } = await import("../core/installroute.js");

globalThis.location = { hash: format(settingsRoute(["installation", "pair"])) };
const flush = () => new Promise((r) => setTimeout(r, 0));
const store = () => { const m = { installRoute: "server" }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; };
// Only Tailscale installed, not signed in: the page's Connect step offers Sign In.
const TS_OFF = { paired: null, pairOnPhone: true, localDevVPN: false, otherVPN: false, tailscale: { connect: "tailscale", signedIn: false } };

// A sign-in that waits (emitting `step`) until tailscale.signInCancel ends it, as the shell's does.
function phone(step = "approval") {
  const calls = [];
  let cancel = null;
  const answers = {
    "idevice.status": TS_OFF, "idevice.vpnApps": { localdevvpn: false, tailscale: true },
    "tailscale.setConnect": TS_OFF.tailscale,
    "tailscale.signIn": (_, ev) => new Promise((_ok, no) => {
      ev?.([{ step }]);
      cancel = () => no(Object.assign(new Error("canceled: sign-in canceled: the page was left"), { code: "canceled" }));
    }),
    "tailscale.signInCancel": () => { cancel?.(); return Promise.resolve({ ok: true }); },
  };
  return { calls, count: (m) => calls.filter((c) => c === m).length,
    call: (m, p, ev) => { calls.push(m); const a = answers[m]; return typeof a === "function" ? a(p, ev) : Promise.resolve(a); } };
}

async function signingInPage(native, alerts = []) {
  const box = make("div");
  const alert = async (q) => { alerts.push(q); return { index: 0 }; };
  await drawInstallation(box, "pair", { store: store(), native, alert });
  await flush();
  assert.equal(pendingStep(), null, "nothing runs before Sign In");
  const row = box.querySelector(".sign-import");
  assert.ok(row, "the Sign In row");
  row.children[0].listeners.click[0]();
  await flush();
  await flush();
  return box;
}

test("leaveQuestion: signingIn says it stops signing in to Tailscale", () => {
  const q = leaveQuestion("signingIn");
  assert.equal(q.title, "Stop Setting Up?");
  assert.equal(q.buttons[LEAVE], "Leave");
  assert.match(q.message, /stops signing in to Tailscale/);
});

test("while the page's sign-in waits, leaving asks; Cancel keeps it running", async () => {
  const native = phone();
  await signingInPage(native);
  assert.equal(native.count("tailscale.signIn"), 1);
  assert.equal(pendingStep(), "signingIn");
  const asked = [];
  const go = await askLeave((q) => { asked.push(q); return Promise.resolve({ index: 0 }); });
  assert.equal(go, false);
  assert.match(asked[0].message, /signing in to Tailscale/);
  assert.equal(native.count("tailscale.signInCancel"), 0);
  assert.equal(pendingStep(), "signingIn");
  leave(); // ends it, for the next test
  await flush();
  assert.equal(native.count("tailscale.signInCancel"), 1);
});

test("Leave stops the sign-in once, quietly (no Couldn't Sign In), and nothing is pending after", async () => {
  const native = phone("login");
  const alerts = [];
  await signingInPage(native, alerts);
  assert.equal(pendingStep(), "signingIn");
  const go = await askLeave(() => Promise.resolve({ index: LEAVE }));
  assert.equal(go, true);
  await flush();
  assert.equal(native.count("tailscale.signInCancel"), 1);
  leave(); // the hashchange that follows
  await flush();
  assert.equal(native.count("tailscale.signInCancel"), 1, "not cancelled twice");
  assert.equal(pendingStep(), null);
  assert.ok(!alerts.some((a) => /Couldn't Sign In/.test(a.title)), "a cancel is not an error");
});

test("a plain leave (a hashchange off the page) stops the page's sign-in too", async () => {
  const native = phone();
  await signingInPage(native);
  leave();
  await flush();
  assert.equal(native.count("tailscale.signInCancel"), 1);
  assert.equal(pendingStep(), null);
});
