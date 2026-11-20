// Settings > Installation & Signing's top half (sideload build, docs/settings.md): Install Apps With Signing Server /
// This iPhone, and the This iPhone route's page (core/installroute.js holds the rules and texts):
//   installation       the merged page (screens/settings.js draws it, with installationBlock below at its top):
//                      the choice, then (This iPhone) Pairing and the VPN's state
//   installation/pair  This iPhone, one page that runs by itself (core setupState): one sentence on what it gives,
//                      then the VPN check (Turn On … with Open LocalDevVPN, rechecked when the app comes back), then
//                      pairing starts on its own: the 6-digit code big at the top and where to type it, a line and a
//                      screenshot a step; it keeps pairing while the page is open. Paired: a check, Check Connection
//                      (Pair Again when it fails) and Forget. Older iOS: Import Pairing File.
//   Connect With (Automatic, LocalDevVPN, Tailscale) and Tailscale's Sign In / Test Connection / Sign Out on
//   installation once paired.
// The idevice.* bridge calls are native/sideload/idevice/IDeviceBridge.swift's, tailscale.* native/sideload/tailscale's.
import { grouped, el } from "../nav/ui.js";
import { format, settingsRoute } from "../router.js";
import { showAlert } from "../nav/alert.js";
import { copyText } from "../nav/menu.js";
import { toBase64 } from "../core/signing.js";
import { ROUTE_KEY, ROUTE_OPTIONS, VPNS, VPN_POLL, vpnList, vpnOn, IPHONE_INTRO, setupState, CONNECT_ALERT, PAIR_GUIDE, pairEvent, pairFooter, pairFromNative, pinText, PAIR_STEPS, verifyFailure,
  CONNECT_OPTIONS, connectFooter, tailscaleFooter, tailscaleTestResult } from "../core/installroute.js";
import { ringStyle } from "../core/installroute.js";
import { NAME } from "../brand.js";

export const PAGE = "installation";
export const SUB_TITLES = { pair: "This iPhone" };
const VPN = VPNS[0];

const route = (sub) => format(settingsRoute(sub ? [PAGE, sub] : [PAGE]));
const goTo = (sub) => { location.hash = route(sub).replace(/^#/, ""); };
const call = (native, m, p = {}, ev) => native?.call ? native.call(m, p, ev) : Promise.reject(new Error(`This needs the ${NAME} app.`));
async function status(native) { try { return await call(native, "idevice.status"); } catch { return null; } }

// The VPN row's detail from idevice.status.
export function vpnDetail(st) {
  if (!st) return "Unknown";
  if (st.localDevVPN) return "On";
  return st.otherVPN ? "Another VPN" : "Off";
}

// Tailscale's sign-in while it runs: the step line ("Log in on the page"), or null.
let signingIn = null;

// The main page's groups (pure, for tests): the choice and, with This iPhone chosen, its state, Connect With and
// Tailscale. `st.tailscale` is tailscale.status's answer (idevice.status carries it).
export function installationGroups(choice, st, { pick = () => {}, openVPN = () => {}, connect = () => {}, signIn = () => {}, test = () => {}, signOut = () => {}, busy = null } = {}) {
  const groups = [{
    header: "Install Apps With",
    rows: ROUTE_OPTIONS.map((o) => ({ label: o.label, subtitle: o.subtitle, cls: "route-row", checked: o.value === choice, onClick: () => pick(o.value) })),
    footer: choice === "iphone"
      ? `Signed apps go straight to iOS through ${vpnList()}. When it's off, installs use the Signing Server.`
      : "The Signing Server hands iOS each app's install link.",
  }];
  if (choice === "iphone") {
    groups.push({
      header: "This iPhone",
      rows: [
        { label: "Pairing", detail: st?.paired ? "Paired" : "Not Paired", href: route("pair") },
        { label: VPN, detail: vpnDetail(st) },
        { label: `Open ${VPN}`, cls: "sign-import", onClick: openVPN },
      ],
      footer: `${VPN} must be on while apps install, or Tailscale (below).`,
    });
    const ts = st?.tailscale ?? null;
    const now = ts?.connect ?? "auto";
    groups.push({
      header: "Connect With",
      rows: CONNECT_OPTIONS.map((o) => ({ label: o.label, checked: o.value === now, onClick: () => connect(o.value) })),
      footer: connectFooter(now),
    });
    const rows = busy
      ? [{ label: "Signing In…", detail: busy }]
      : ts?.signedIn
        ? [{ label: "Device", detail: ts.name || NAME },
          { label: "Test Connection", cls: "sign-import", onClick: test },
          { label: "Sign Out", cls: "sign-import", onClick: signOut }]
        : [{ label: "Sign In", cls: "sign-import", onClick: signIn }];
    groups.push({ header: "Tailscale", rows, footer: tailscaleFooter(ts) });
  }
  return groups;
}

export async function drawInstallation(el, sub, { store, native = globalThis.ifizboxNative, alert = showAlert } = {}) {
  const redraw = () => drawInstallation(el, sub, { store, native, alert });
  if (sub === "pair") return drawPair(el, { store, native, alert, redraw });
  return paintInstallation(el, { store, native, alert, redraw });
}

// F271: the choice and This iPhone's groups as a box of their own, for the top of Settings > Installation & Signing
// (screens/settings.js puts it above the Certificate and Provisioning Profile groups). It repaints only itself.
export function installationBlock({ store, native = globalThis.ifizboxNative, alert = showAlert } = {}) {
  const box = document.createElement("div");
  box.className = "install-route";
  const redraw = () => paintInstallation(box, { store, native, alert, redraw });
  redraw();
  return box;
}

async function paintInstallation(el, { store, native, alert, redraw }) {
  const choice = store.get(ROUTE_KEY);
  const paint = (st) => el.replaceChildren(grouped(installationGroups(choice, st, {
    pick: async (v) => {
      if (v !== "iphone") return store.set(ROUTE_KEY, v);
      const s = await status(native);
      if (s?.paired) store.set(ROUTE_KEY, "iphone"); else goTo("pair");
    },
    openVPN: () => openVPN(native, alert),
    connect: async (v) => { await call(native, "tailscale.setConnect", { value: v }).catch(() => {}); redraw(); },
    signIn: () => tailscaleSignIn(native, alert, redraw),
    test: () => tailscaleTest(native, alert),
    signOut: async () => {
      const { index } = await alert({ title: "Sign Out of Tailscale?", message: `${NAME} leaves your tailnet. Installs use LocalDevVPN until you sign in again.`, buttons: ["Cancel", "Sign Out"], cancel: 0 });
      if (index !== 1) return;
      await call(native, "tailscale.signOut").catch((e) => alert({ title: "Couldn't Sign Out", message: e?.message || "No answer.", buttons: ["OK"] }));
      redraw();
    },
    busy: signingIn,
  })));
  paint(null);
  if (choice === "iphone") paint(await status(native));
}

async function tailscaleSignIn(native, alert, redraw) {
  if (signingIn) return;
  signingIn = "Starting…";
  redraw();
  try {
    await call(native, "tailscale.signIn", {}, (ev) => {
      const e = Array.isArray(ev) ? ev[0] : ev;
      if (e?.step === "login") signingIn = "Log in on the page";
      if (e?.step === "approval") signingIn = "Waiting for approval";
      redraw();
    });
    signingIn = null;
    redraw();
    await alert({ title: "Signed In", message: `${NAME} is on your tailnet. Tap Test Connection to check it reaches this iPhone.`, buttons: ["OK"] });
  } catch (e) {
    signingIn = null;
    redraw();
    if (!/^cancel+ed/.test(e?.message || "") && e?.code !== "canceled") alert({ title: "Couldn't Sign In", message: e?.message || "No answer.", buttons: ["OK"] });
  }
}

async function tailscaleTest(native, alert) {
  let r;
  try { r = await call(native, "tailscale.test"); } catch (e) { r = { ok: false, code: "error", detail: e?.message }; }
  const why = tailscaleTestResult(r);
  if (!why.copy) return alert({ title: why.title, message: why.message, buttons: ["OK"] });
  const { index } = await alert({ title: why.title, message: why.message, buttons: ["OK", "Copy Rule"], cancel: 0 });
  if (index === 1) copyText(why.copy);
}

async function openVPN(native, alert) {
  let r = null;
  try { r = await call(native, "idevice.openLocalDevVPN"); } catch { /* below */ }
  if (!r?.opened) await alert({ title: `${VPN} Isn't Installed`, message: `Get ${VPN} from the App Store, open it and turn it on.`, buttons: ["OK"] });
}

// ---- This iPhone's page

let pairing = null; // { pin, text, error } while idevice.pair waits for the phone (core pairEvent)
let shown = null; // { native, redraw } of the page on screen, for the hooks below
let visit = null; // this visit of the page: { started, asked, failed, poll }; null once it's left

// The page's groups for `state` (core setupState) and the pairing `p` (pure, for tests). The code and the steps
// with their screenshots are drawn after the groups marked `pin` and `guide` (drawPair).
export function setupGroups(state, st, p, { openVPN = () => {}, retry = () => {}, check = () => {}, forget = () => {}, failed = false } = {}) {
  const intro = { header: "Install on This iPhone", footer: IPHONE_INTRO };
  if (state === "paired") {
    return [intro,
      { rows: [{ label: "Paired", checked: true, cls: "pair-done" }] },
      { rows: [{ label: "Check Connection", cls: "sign-import", onClick: check }],
        footer: `Checks that ${NAME} can reach this iPhone through ${vpnList()}.` },
      { rows: [{ label: "Forget Pairing", cls: "sign-import", onClick: forget }] }];
  }
  if (state === "file") return [intro, { header: "Pair This iPhone", footer: PAIR_STEPS.file.map((s, i) => `${i + 1}. ${s}`).join(" ") }];
  const conn = { rows: [{ label: VPN, detail: state === "connect" ? vpnDetail(st) : "On" }] };
  if (state === "connect") {
    conn.rows.push({ label: `Open ${VPN}`, cls: "sign-import", onClick: openVPN });
    conn.footer = `Turn on ${vpnList()} to pair. This page goes on by itself when it's on.`;
    return [intro, conn];
  }
  const line = failed && !p ? `Pairing stopped.` : p ? pairFooter(p) : "Starting…";
  return [intro, conn,
    { header: "Pairing Code", pin: true },
    { header: "Where to Type It", guide: true, footer: line },
    ...(failed && !p ? [{ rows: [{ label: "Try Again", cls: "sign-import", onClick: retry }] }] : [])];
}

// The steps: a short line each, and the screenshot of the Settings row to tap, ringed.
export function pairGuide(guide = PAIR_GUIDE) {
  const ol = el("ol", "pair-steps");
  for (const s of guide) {
    const li = el("li", "pair-step");
    li.append(el("span", "pair-step-text", s.text));
    if (s.img) {
      const shot = el("div", "pair-shot");
      const img = el("img", "pair-shot-img");
      img.src = s.img;
      img.alt = `${s.text} in Settings`;
      img.decoding = "async";
      if (s.size) { img.width = s.size[0]; img.height = s.size[1]; } // keeps its height before it loads
      shot.append(img);
      if (s.box) {
        const ring = el("div", "pair-ring");
        Object.assign(ring.style, ringStyle(s.box));
        shot.append(ring);
      }
      li.append(shot);
    }
    ol.append(li);
  }
  return ol;
}

// While pairing, the app is in the background (the code is typed in Settings) and events sent then may never reach
// the page: coming back, it reads the pairing from native, or rechecks the VPN while it waits for one. Leaving the
// page ends the pairing.
function onPairPage() { return location.hash.replace(/^#/, "") === route("pair").replace(/^#/, ""); }
async function reread() {
  if (!shown || document.visibilityState !== "visible") return;
  const { native, redraw } = shown;
  if (!pairing) { if (visit) redraw(); return; } // the VPN may be on now
  let st = null;
  try { st = await call(native, "idevice.pairState"); } catch { return; }
  const now = pairFromNative(st);
  if (now && pairing) { pairing = now; redraw(); } // not active: idevice.pair's reply settles it
}
function leave() {
  if (visit?.poll) clearInterval(visit.poll);
  visit = null;
  if (pairing && shown) call(shown.native, "idevice.pairCancel").catch(() => {});
}
if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("visibilitychange", reread);
  window.addEventListener("pageshow", reread);
  window.addEventListener("hashchange", () => { if (!onPairPage()) leave(); });
}

async function drawPair(box, { store, native, alert, redraw }) {
  shown = { native, redraw };
  visit ??= { started: false, asked: false, failed: false, poll: null };
  const v = visit;
  // In pairing mode the page draws from `pairing` alone, without waiting on idevice.status.
  const st = pairing ? null : await status(native);
  if (v !== visit) return; // left while idevice.status answered
  const state = setupState(st, pairing);
  if (state !== "connect" && v.poll) { clearInterval(v.poll); v.poll = null; }

  const start = async () => {
    if (pairing) return;
    v.started = true;
    v.failed = false;
    pairing = { pin: "", text: "", error: "" };
    redraw();
    try {
      // idevice.pair's first event is the code, before anything listens; it keeps listening until it pairs or the
      // page is left (no timeout)
      await call(native, "idevice.pair", {}, (ev) => { if (pairing) { pairing = pairEvent(pairing, ev); redraw(); } });
      pairing = null;
      store.set(ROUTE_KEY, "iphone");
      if (visit === v) redraw();
    } catch (e) {
      pairing = null;
      if (visit !== v) return;
      v.failed = true;
      redraw();
      if (e?.code !== "canceled" && e?.code !== "cancelled" && !/^cancel+ed/.test(e?.message || "")) {
        alert({ title: "Couldn't Pair", message: e?.message || "No answer.", buttons: ["OK"] });
      }
    }
  };

  const sections = setupGroups(state, st, pairing, {
    failed: v.failed,
    openVPN: () => openVPN(native, alert),
    retry: start,
    check: () => check(native, alert, redraw, store),
    forget: async () => { await call(native, "idevice.forget").catch(() => {}); store.set(ROUTE_KEY, "server"); v.started = false; redraw(); },
  });
  const frag = grouped(sections);
  const groups = [...frag.children];
  sections.forEach((s, i) => {
    if (s.pin) groups[i].append(el("p", "pair-code", pinText(pairing?.pin) || "––– –––"));
    if (s.guide) groups[i].querySelector(".group-header").after(pairGuide());
  });
  if (state === "file") {
    const input = Object.assign(document.createElement("input"), { type: "file", className: "visually-hidden" });
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      input.value = "";
      if (!f) return;
      try {
        await call(native, "idevice.import", { data: toBase64(new Uint8Array(await f.arrayBuffer())) });
        store.set(ROUTE_KEY, "iphone");
        redraw();
      } catch (e) {
        alert({ title: "Not a Pairing File", message: e?.message || "That file isn't a pairing for this iPhone.", buttons: ["OK"] });
      }
    });
    frag.append(grouped([{ rows: [{ label: "Import Pairing File", cls: "sign-import", onClick: () => input.click() }] }]));
    frag.querySelector(".sign-import")?.append(input);
  }
  box.replaceChildren(frag);

  if (state === "connect") {
    v.poll ??= setInterval(async () => { if (visit === v && !pairing && vpnOn(await status(native))) redraw(); }, VPN_POLL);
    if (!v.asked) {
      v.asked = true;
      const { index } = await alert({ ...CONNECT_ALERT, cancel: 0 }) || {};
      if (index === CONNECT_ALERT.open) openVPN(native, alert);
    }
  } else if (state === "pairing" && !pairing && !v.started) {
    start();
  }
}

async function check(native, alert, redraw, store) {
  try {
    await call(native, "idevice.verify");
    store.set(ROUTE_KEY, "iphone");
    await alert({ title: "Connected", message: `${NAME} reached this iPhone. Apps install here now.`, buttons: ["OK"] });
  } catch (e) {
    const why = verifyFailure(e);
    if (!why.again) return alert({ title: why.title, message: why.message, buttons: ["OK"] });
    const { index } = await alert({ title: why.title, message: why.message, buttons: ["Cancel", "Pair Again"], cancel: 0 });
    if (index === 1) { await call(native, "idevice.forget").catch(() => {}); if (visit) visit.started = false; redraw(); }
  }
}
