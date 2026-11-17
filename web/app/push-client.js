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
// Only the site uses this: the app build (WKWebView) has no service workers, and its alerts are native.
import { getBackend, getArch } from "./backend.js";
import { catalog } from "./catalog.js";

const KEY = "cydian.push"; // { id, feed, push } once opted in

// ---- pure helpers (node-tested) -----------------------------------------------------------------------------

// What the server's /api/push/subscribe takes. Only what the check needs leaves the device.
export function subscribeBody({ id = null, subscription = null, sources = [], installed = [], holds = [], arch }) {
  const sub = subscription && typeof subscription.toJSON === "function" ? subscription.toJSON() : subscription;
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

function registration() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready);
}

async function currentSubscription(reg, ask) {
  if (!reg?.pushManager) return null;
  const have = await reg.pushManager.getSubscription();
  if (have) return have;
  if (Notification.permission !== "granted" && !ask) return null;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await prefetchKey()) });
}

async function lists(holds) {
  const installed = await catalog.installed();
  if (!installed) throw new Error("Upload your dpkg status file on the Installed tab first: the check compares it with your sources.");
  return { sources: await getBackend().sources(), installed, holds, arch: getArch() };
}

async function send(subscription, holds) {
  const cur = saved();
  const res = await post("/api/push/subscribe", subscribeBody({ id: cur?.id ?? null, subscription, ...(await lists(holds)) }));
  const next = { id: res.id, feed: res.feed, push: Boolean(res.push) };
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
      if (info?.count != null) rows.push({ label: "Upgrades", detail: String(info.count) });
      if (cur.push) rows.push({ label: "Last Push Delivered", detail: when(info?.delivered) });
      if (cur.push) rows.push({ label: "Send Test Notification", onClick: () => run(async () => { await test(); showHUD("Sent"); }) });
      rows.push({ label: "Copy Feed Link", onClick: () => run(async () => {
        await navigator.clipboard.writeText(cur.feed);
        showHUD("Copied");
      }) });
    }
    const footer = cur
      ? "Your sources and installed packages are on the server, which checks them once a day. The feed link is private: anyone with it sees your upgrades. Turn off to delete it all."
        + (sup.ios && !sup.push ? " For notifications, add Cydian to the Home Screen (Share, then Add to Home Screen) and open it from there." : "")
      : "Sends your sources and installed packages to the server once, and again each time you open Cydian, so it can check them daily and tell you about upgrades by notification or a private feed.";
    const frag = grouped([{ header: "Upgrade Alerts", rows, footer }]);
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
}
