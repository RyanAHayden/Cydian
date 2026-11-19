// F254: the website's Use a Free Apple ID (screens/free-apple-id.js): the pure parts. The alerts' wording is
// core/gsa.js signInAlert's (gsa.test.js); the setup is core/freeroute.js's (freeroute.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { signInFailure, checklist, handoffFiles, handoffZip, loadFreeIdentity, saveFreeIdentity, forgetFreeIdentity,
  relayAvailable, resetRelayAnswer, FREE_KEY, devModeSteps, devModeShot, freeInstalled, markFreeInstalled,
  INSTALLED_KEY } from "./free-apple-id.js";
import { unzipEntries } from "../core/certfiles.js";
import { NAME } from "../brand.js";

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test("sign-in failures: what each keeps, clears, links or waits for (user 2026-11-19)", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const pw = signInFailure({ code: -20101, message: "x" }, now);
  assert.equal(pw.alert.title, "Incorrect Password");
  assert.deepEqual([pw.keepEmail, pw.clearPassword, pw.stayOnCode, pw.link], [true, true, false, null]);
  assert.equal(signInFailure({ code: -22406 }, now).clearPassword, true);
  const code = signInFailure({ code: -21669 }, now);
  assert.equal(code.alert.title, "Incorrect Code");
  assert.deepEqual([code.clearPassword, code.stayOnCode], [false, true]);
  for (const c of [-20209, -20283, -20751]) {
    const l = signInFailure({ code: c, message: "locked" }, now);
    assert.equal(l.alert.title, "This Apple ID Is Locked");
    assert.equal(l.link, "https://iforgot.apple.com");
  }
  const w = signInFailure({ code: -36607, message: "nope" }, now);
  assert.equal(w.waitUntil, "2026-11-19T12:15:00.000Z");
  assert.match(w.alert.message, /15 minutes/);
  const other = signInFailure({ code: -5000, message: "Odd", step: "SRP init" }, now);
  assert.equal(other.alert.title, "Sign-In Failed");
  assert.match(other.alert.message, /SRP init.*-5000.*Odd/);
});

test("checklist: the four steps in order, waiting until they start", () => {
  const rows = checklist({ device: { state: "done", summary: "Added to the account" }, certificate: { state: "running" } });
  assert.deepEqual(rows.map((r) => r.id), ["device", "certificate", "appId", "profile"]);
  assert.deepEqual(rows.map((r) => r.state), ["done", "running", "waiting", "waiting"]);
  assert.equal(rows[0].summary, "Added to the account");
  assert.equal(rows[0].title, "Register This iPhone");
});

test("the identity: kept in this browser, read back, forgotten", () => {
  const store = memStore();
  const id = { teamId: "T1", teamName: "Me", serial: "AB", password: "pw", p12: Uint8Array.of(1, 2, 3),
    expires: new Date("2027-11-19T00:00:00Z"), profile: Uint8Array.of(9), appId: "com.example.x.T1" };
  saveFreeIdentity(id, store);
  const back = loadFreeIdentity(store);
  assert.deepEqual(back.p12, id.p12);
  assert.deepEqual(back.profile, id.profile);
  assert.equal(back.expires.toISOString(), id.expires.toISOString());
  assert.deepEqual([back.teamId, back.serial, back.password, back.appId], ["T1", "AB", "pw", "com.example.x.T1"]);
  store.setItem(FREE_KEY, "{broken");
  assert.equal(loadFreeIdentity(store), null);
  saveFreeIdentity(id, store);
  forgetFreeIdentity(store);
  assert.equal(loadFreeIdentity(store), null);
});

test("Save for the App: .p12, password.txt and the profile, as the app's Select All Files takes them", async () => {
  const id = { p12: Uint8Array.of(1), password: "s3cret", profile: Uint8Array.of(2) };
  assert.deepEqual(handoffFiles(id).map((f) => f.name), [`${NAME} Free Apple ID.p12`, "password.txt", `${NAME} Free Apple ID.mobileprovision`]);
  const files = await unzipEntries(handoffZip(id));
  assert.equal(new TextDecoder().decode(files.find((f) => f.name === "password.txt").bytes), "s3cret");
  assert.equal(handoffFiles({ ...id, profile: null }).length, 2);
});

test("relayAvailable: only a 200 {on:true} from /apple/status; asked once per page", async () => {
  let asked = 0;
  resetRelayAnswer();
  assert.equal(await relayAvailable({ origin: "https://x", fetcher: async (u) => { asked++; assert.equal(u, "https://x/apple/status"); return new Response('{"on":true}'); } }), true);
  assert.equal(await relayAvailable({ fetcher: async () => { asked++; return new Response("{}"); } }), true);
  assert.equal(asked, 1);
  resetRelayAnswer();
  assert.equal(await relayAvailable({ fetcher: async () => new Response("{}", { status: 404 }) }), false);
  resetRelayAnswer();
  assert.equal(await relayAvailable({ fetcher: async () => { throw new Error("offline"); } }), false);
  resetRelayAnswer();
});

// ---- F254i: Developer Mode and Trust ----
test("Developer Mode steps: in order, the Stolen Device Protection step optional, Trust names the certificate", () => {
  const steps = devModeSteps({ email: "me@example.org" });
  assert.deepEqual(steps.map((s) => s.id), ["turn-on", "restart", "confirm", "delay", "trust"]);
  assert.deepEqual(steps.filter((s) => s.optional).map((s) => s.id), ["delay"]);
  assert.match(steps[0].text, /Privacy & Security/);
  assert.match(steps[0].text, new RegExp(NAME));
  assert.match(steps[1].shot.alert.buttons.join(), /Restart/);
  assert.match(steps[2].shot.alert.buttons.join(), /Turn On/);
  assert.match(steps[3].text, /Stolen Device Protection/);
  assert.match(steps[4].text, /VPN & Device Management.*Apple Development: me@example\.org/);
  assert.equal(steps[4].shot.groups[0].rows[0].label, "Apple Development: me@example.org");
  for (const s of steps) assert.ok(s.title && s.text && s.shot.title && s.shot.groups.length, s.id);
  assert.doesNotMatch(devModeSteps().at(-1).text, /undefined/);
});

test("Developer Mode page stops showing once an app on the route installed fine", () => {
  const store = memStore();
  assert.equal(freeInstalled(store), false);
  markFreeInstalled(store);
  assert.equal(freeInstalled(store), true);
  assert.equal(store.getItem(INSTALLED_KEY), "true");
  markFreeInstalled(store, false);
  assert.equal(freeInstalled(store), false);
  store.setItem(INSTALLED_KEY, "{broken");
  assert.equal(freeInstalled(store), false);
});

test("devModeShot: nav bar, rows (switch, detail, chevron, mark) and the alert, all as text", () => {
  const fake = (tag) => {
    const e = { tag, className: "", textContent: "", children: [], attrs: {},
      append: (...c) => e.children.push(...c), setAttribute: (k, v) => { e.attrs[k] = v; } };
    return e;
  };
  const saved = globalThis.document;
  globalThis.document = { createElement: fake };
  try {
    const fig = devModeShot(devModeSteps()[1].shot);
    const all = [];
    const walk = (n) => { all.push(n); n.children.forEach(walk); };
    walk(fig);
    const by = (c) => all.filter((n) => n.className.split(" ").includes(c));
    assert.equal(fig.attrs.role, "img");
    assert.equal(fig.attrs["aria-label"], "Settings: Developer Mode");
    assert.equal(by("dm-title")[0].textContent, "Developer Mode");
    assert.equal(by("dm-back")[0].textContent, "Privacy & Security");
    assert.equal(by("dm-switch")[0].className, "dm-switch is-on");
    assert.deepEqual(by("dm-alert-button").map((b) => [b.textContent, b.className.includes("is-bold")]), [["Cancel", false], ["Restart", true]]);
    const first = devModeShot(devModeSteps()[0].shot);
    const rows = first.children[0].children.find((n) => n.className === "dm-group").children;
    assert.equal(rows[0].className, "dm-row is-marked");
    assert.deepEqual(rows[0].children.map((n) => n.className), ["dm-label", "dm-detail", "dm-chevron"]);
  } finally {
    globalThis.document = saved;
  }
});
