// Upgrade alerts on the site (F10): the browser half of web/push.py. Opt-in from Settings ("Daily Upgrade
// Check"): then, and only then, this device's sources, a slim installed list ({id, version, held}) and Ignored
// Upgrades go to the server, which checks them once a day, pushes "n Upgrades" (sw.js shows it) and keeps a
// private Atom feed. Turning it off deletes them there.
//
//   startPush({ holds })     at launch: registers sw.js and re-sends the subscription (iOS drops push
//                            subscriptions now and then, so every open re-subscribes)
//   enable({ holds })        from a tap: asks for notification permission, subscribes, sends the lists
//   disable()  status()  test()  saved()  support()
//
// F34, "Check on This Device": the opt-in mode where the lists never leave the phone. The server keeps only the
// push subscription and sends a bare "check" once a day; sw-device.js (a module service worker, registered in
// place of sw.js) checks on the device (device-check.js). Browsers without module service workers refuse it.
//
//   setMode(mode, { holds })  "device" or "server", from the switch
//
// Only the site uses this: the app build (WKWebView) has no service workers, and its alerts are native.
import { getBackend, getArch } from "./backend.js";
import { catalog } from "./catalog.js";
import { savePushInputs, lastCheck, clearDeviceState } from "./device-check.js";

const KEY = "cydian.push"; // { id, feed, push, mode } once opted in

// ---- pure helpers (node-tested) -----------------------------------------------------------------------------

// What the server's /api/push/subscribe takes. Only what the check needs leaves the device.
// In "device" mode (F34) none of the lists go: only the subscription and the arch.
export function subscribeBody({ id = null, subscription = null, sources = [], installed = [], holds = [], arch, mode = "server" }) {
  const sub = subscription && typeof subscription.toJSON === "function" ? subscription.toJSON() : subscription;
  if (mode === "device") {
    return {
      id, mode, arch, sources: [], installed: [], holds: [],
      subscription: sub ? { endpoint: sub.endpoint, keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth } } : null,
    };
  }
  return {
    id,
    subscription: sub ? { endpoint: sub.endpoint, keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth } } : null,
    arch,
    sources: sources.map(({ uri, dist, components }) => ({ uri, dist: dist || "./", components: components ?? [] })),
    installed: (installed ?? []).map(({ id: pkg, installed: v, version, held }) => ({ id: pkg, version: v ?? version, ...(held ? { held: true } : {}) })),
    holds: [...holds],
  };
}

// The VAPID key (base64url) as PushManager.subscribe wants it.
export function keyBytes(b64url) {
  const s = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// What this browser can do. iOS only has PushManager in a Home Screen app (16.4+), never in a Safari tab.
export function support(g = globalThis) {
  const nav = g.navigator ?? {};
  const standalone = Boolean(nav.standalone) || Boolean(g.matchMedia?.("(display-mode: standalone)").matches);
  return {
    worker: "serviceWorker" in nav,
    push: "PushManager" in g && "Notification" in g && "serviceWorker" in nav,
    standalone,
    ios: /iPhone|iPad|iPod/.test(nav.userAgent ?? "") || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1),
    permission: "Notification" in g ? g.Notification.permission : "unsupported",
  };
}

// The Notifications row's detail: what to tell the user about push on this browser.
export function pushState(sup, saved) {
  if (saved?.push && sup.permission === "granted") return "On";
  if (!sup.push) return sup.ios && !sup.standalone ? "Add to Home Screen" : "Not Supported";
  if (sup.permission === "denied") return "Blocked";
  return "Off";
}

// The "Last Check" row of the on-device mode: when, and how it went ("Today, 9:02 AM, 3.1 s").
export function checkDetail(last, now = Date.now(), locale) {
  if (!last) return "Never";
  const at = when(last.t / 1000, now, locale);
  if (last.outcome === "timeout") return `${at}, Timed Out`;
  if (last.outcome === "error") return `${at}, Failed`;
  return `${at}, ${(last.ms / 1000).toFixed(1)} s`;
}

// "Today, 9:02 AM" / "Nov 3, 9:02 AM" / "Never".
export function when(t, now = Date.now(), locale) {
  if (!t) return "Never";
  const d = new Date(t * 1000);
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (new Date(now).toDateString() === d.toDateString()) return `Today, ${time}`;
  return `${d.toLocaleDateString(locale, { month: "short", day: "numeric" })}, ${time}`;
}

// ---- storage and server -------------------------------------------------------------------------------------

export function saved(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(KEY) || "null");
    return v && typeof v.id === "string" ? v : null;
  } catch {
    return null;
  }
}

function save(v, storage = globalThis.localStorage) {
  try {
    if (v) storage.setItem(KEY, JSON.stringify(v));
    else storage.removeItem(KEY);
  } catch {
    // private mode: the opt-in lasts this session
  }
}

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(`Can't reach the server: ${e.message}`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `The server answered HTTP ${res.status}.`), { status: res.status });
  return json;
}

let key = null;
// Fetched ahead (Settings calls it on render), so a tap reaches PushManager.subscribe while it still counts as
// the user's gesture.
export function prefetchKey() {
  return (key ??= fetch("/api/push/key").then((r) => (r.ok ? r.json() : Promise.reject(new Error("push is not set up on this server"))))
    .then((j) => j.key).catch((e) => { key = null; throw e; }));
}

// The worker for the mode: sw.js, or for "device" the module worker sw-device.js (same scope, so it replaces
// sw.js and keeps the push subscription). A browser without module service workers rejects the latter.
function registration(mode = saved()?.mode) {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  const reg = mode === "device"
    ? navigator.serviceWorker.register("sw-device.js", { type: "module" })
    : navigator.serviceWorker.register("sw.js");
  return reg.then(() => navigator.serviceWorker.ready);
}

async function currentSubscription(reg, ask) {
  if (!reg?.pushManager) return null;
  const have = await reg.pushManager.getSubscription();
  if (have) return have;
  if (Notification.permission !== "granted" && !ask) return null;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await prefetchKey()) });
}

const NO_STATUS = "Upload your dpkg status file on the Installed tab first: the check compares it with your sources.";

async function lists(holds, mode) {
  if (mode === "device") {
    // The worker reads the sources and the status file from IndexedDB itself; Ignored Upgrades and the arch live
    // in localStorage, which a service worker can't read, so they are copied over.
    if (!(await catalog.hasStatus())) throw new Error(NO_STATUS);
    await savePushInputs({ holds, arch: getArch() });
    return { arch: getArch(), mode };
  }
  const installed = await catalog.installed();
  if (!installed) throw new Error(NO_STATUS);
  return { sources: await getBackend().sources(), installed, holds, arch: getArch() };
}

async function send(subscription, holds, mode = saved()?.mode ?? "server") {
  const cur = saved();
  const res = await post("/api/push/subscribe", subscribeBody({ id: cur?.id ?? null, subscription, ...(await lists(holds, mode)) }));
  const next = { id: res.id, feed: res.feed, push: Boolean(res.push), mode: res.mode === "device" ? "device" : "server" };
  save(next);
  return res;
}

// From a tap on the switch. Notification.requestPermission runs first, before any await, so it is still inside
// the tap's user activation (iOS refuses it otherwise).
export async function enable({ holds = [] } = {}) {
  const sup = support();
  const asked = sup.push && Notification.permission === "default" ? Notification.requestPermission() : null;
  let subscription = null;
  if (sup.push) {
    const perm = asked ? await asked : Notification.permission;
    if (perm === "granted") subscription = await currentSubscription(await registration(), true);
  }
  return send(subscription, holds);
}

export async function disable() {
  const cur = saved();
  save(null);
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    await (await reg?.pushManager?.getSubscription())?.unsubscribe();
  } catch {
    // the server forgets the endpoint either way
  }
  if (cur) await post("/api/push/unsubscribe", { id: cur.id });
  navigator.clearAppBadge?.().catch(() => {});
  if (cur?.mode === "device") {
    await clearDeviceState();
    navigator.serviceWorker?.register("sw.js").catch(() => {});
  }
}

// From the "Check on This Device" switch: moves the worker over first (a browser that can't run the module
// worker throws here and nothing changes), then tells the server, which drops or asks for the lists.
export async function setMode(mode, { holds = [] } = {}) {
  if (!saved()) throw new Error("Turn on Daily Upgrade Check first.");
  let reg;
  try {
    reg = await registration(mode);
  } catch (e) {
    if (mode !== "device") throw e;
    await registration("server").catch(() => {});
    throw new Error("This browser can't check for upgrades in the background (it needs module service workers). The server keeps checking instead.");
  }
  const subscription = support().push ? await currentSubscription(reg, false).catch(() => null) : null;
  const res = await send(subscription, holds, mode);
  if (mode !== "device") await clearDeviceState();
  return res;
}

export async function status() {
  const cur = saved();
  if (!cur) return null;
  try {
    return await post("/api/push/status", { id: cur.id });
  } catch (e) {
    if (e.status === 404) save(null); // expired or deleted on the server
    throw e;
  }
}

// In "device" mode the server's test push is a real check (the phone runs it and reports how long it took).
export const test = () => post("/api/push/test", { id: saved()?.id });

// At launch: register the worker, and when opted in re-send the subscription and lists (a fresh endpoint if iOS
// dropped the old one) and set the Home Screen badge to the current upgrade count.
export async function startPush({ holds = () => [] } = {}) {
  if (!support().worker) return;
  const reg = await registration().catch(() => null);
  if (!saved()) return;
  const subscription = support().push ? await currentSubscription(reg, false).catch(() => null) : null;
  await send(subscription, holds());
  const ups = await catalog.upgrades(holds()).catch(() => null);
  if (ups && navigator.setAppBadge) {
    (ups.available.length ? navigator.setAppBadge(ups.available.length) : navigator.clearAppBadge()).catch(() => {});
  }
}

// ---- the Settings section ------------------------------------------------------------------------------------

// Draws "Upgrade Alerts" into `box` (screens/settings.js gives it an element at the end of the root page) and
// redraws it as things change. `createSwitch` is the settings screen's iOS 6 switch; `grouped` is nav/ui.js's.
export function drawSection(box, { grouped, createSwitch, showAlert, showHUD, holds }) {
  const sup = support();
  if (!sup.worker) return;
  prefetchKey().catch(() => {});
  let info = null; // the server's status, once it answers
  let last = null; // the on-device check's last result (F34), from IndexedDB
  let busy = false;
  const fail = (e) => showAlert({ title: "Upgrade Alerts", message: e.message, buttons: ["OK"] });

  async function run(f) {
    if (busy) return;
    busy = true;
    try { await f(); } catch (e) { await fail(e); } finally { busy = false; draw(); }
  }

  function draw() {
    const cur = saved();
    const rows = [{ label: "Daily Upgrade Check" }];
    if (cur) {
      const state = pushState(support(), cur);
      rows.push({
        label: "Notifications", detail: state,
        onClick: state === "Off" ? () => run(async () => { info = await enable({ holds: holds() }); }) : undefined,
      });
      const device = cur.mode === "device";
      const count = device ? last?.count : info?.count;
      if (count != null) rows.push({ label: "Upgrades", detail: String(count) });
      if (cur.push) rows.push({ label: "Last Push Delivered", detail: when(info?.delivered) });
      if (device) rows.push({ label: "Last Check", detail: checkDetail(last) });
      if (cur.push) {
        rows.push({ label: device ? "Check Now" : "Send Test Notification", onClick: () => run(async () => {
          await test();
          showHUD("Sent");
        }) });
      }
      if (!device) {
        rows.push({ label: "Copy Feed Link", onClick: () => run(async () => {
          await navigator.clipboard.writeText(cur.feed);
          showHUD("Copied");
        }) });
      }
    }
    const footer = cur
      ? "Your sources and installed packages are on the server, which checks them once a day. The feed link is private: anyone with it sees your upgrades. Turn off to delete it all."
        + (sup.ios && !sup.push ? " For notifications, add Cydian to the Home Screen (Share, then Add to Home Screen) and open it from there." : "")
      : "Sends your sources and installed packages to the server once, and again each time you open Cydian, so it can check them daily and tell you about upgrades by notification or a private feed.";
    const sections = [{ header: "Upgrade Alerts", rows, footer }];
    const deviceRow = cur && sup.push;
    if (deviceRow) {
      sections.push({ rows: [{ label: "Check on This Device" }], footer: cur.mode === "device"
        ? "Your installed packages stay on this iPhone: the server only sends a daily nudge, and Cydian checks your sources itself. iOS needs a notification for every nudge, so a quiet one shows even on days with nothing new."
        : "Keep your installed packages on this iPhone: the server only sends a daily nudge, and Cydian checks your sources itself." });
    }
    const frag = grouped(sections);
    if (deviceRow) {
      const dcell = frag.querySelectorAll(".group")[1].querySelector(".cell-inner");
      dcell.classList.add("has-switch");
      dcell.append(createSwitch({
        label: "Check on This Device",
        checked: cur.mode === "device",
        onToggle: (on) => run(async () => {
          info = await setMode(on ? "device" : "server", { holds: holds() });
          last = await lastCheck();
        }),
      }));
    }
    const cell = frag.querySelector(".cell-inner");
    cell.classList.add("has-switch");
    cell.append(createSwitch({
      label: "Daily Upgrade Check",
      checked: Boolean(cur),
      onToggle: (on) => run(async () => {
        if (on) info = await enable({ holds: holds() });
        else { info = null; await disable(); }
      }),
    }));
    box.replaceChildren(frag);
  }

  draw();
  if (saved()) status().then((s) => { info = s; draw(); }, () => draw());
  if (saved()?.mode === "device") lastCheck().then((l) => { last = l; draw(); });
}
