// Settings > Installation & Signing's top half (sideload build, docs/settings.md): Install Apps With Signing Server /
// This iPhone, and the This iPhone route's page (core/installroute.js holds the rules and texts):
//   installation       the merged page (screens/settings.js draws it, with installationBlock below at its top):
//                      the choice, then (This iPhone) Pairing and the VPN's state
//   installation/pair  This iPhone, one page that runs by itself (core setupState): one sentence on what it gives,
//                      drawn at once with a spinner while it checks, then the VPN: which way is decided from the VPN
//                      apps installed (core vpnRoute: LocalDevVPN's Open, Tailscale's Sign In and Open, a choice when
//                      both are, Install LocalDevVPN when neither is; rechecked when the app comes back), then
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
import { vpnRoute, connectAlert, LOCALDEVVPN_STORE, TAILSCALE_URL } from "../core/installroute.js";
import { ROUTE_KEY, ROUTE_OPTIONS, VPNS, VPN_POLL, vpnList, vpnOn, IPHONE_INTRO, setupState, PAIR_GUIDE, pairEvent, pairFooter, pairFromNative, pinText, PAIR_STEPS, verifyFailure,
  CONNECT_OPTIONS, connectFooter, tailscaleFooter, tailscaleTestResult } from "../core/installroute.js";
import { ringStyle } from "../core/installroute.js";
import { developerModeInfo, canReadDeveloperMode } from "../core/installroute.js";
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
// `devMode`: idevice.developerMode's `on` (core developerModeInfo): a Developer Mode row under Pairing once paired,
// and the steps in the footer when it's off.
export function installationGroups(choice, st, { pick = () => {}, openVPN = () => {}, connect = () => {}, signIn = () => {}, test = () => {}, signOut = () => {}, busy = null, devMode = null } = {}) {
  const groups = [{
    header: "Install Apps With",
    rows: ROUTE_OPTIONS.map((o) => ({ label: o.label, subtitle: o.subtitle, cls: "route-row", checked: o.value === choice, onClick: () => pick(o.value) })),
    footer: choice === "iphone"
      ? `Signed apps go straight to iOS through ${vpnList()}. When it's off, installs use the Signing Server.`
      : "The Signing Server hands iOS each app's install link.",
  }];
  if (choice === "iphone") {
    const dm = st?.paired ? developerModeInfo(devMode) : null;
    const vpnNote = `${VPN} must be on while apps install, or Tailscale (below).`;
    groups.push({
      header: "This iPhone",
      rows: [
        { label: "Pairing", detail: st?.paired ? "Paired" : "Not Paired", href: route("pair") },
        ...(dm ? [dm.row] : []),
        { label: VPN, detail: vpnDetail(st) },
        { label: `Open ${VPN}`, cls: "sign-import", onClick: openVPN },
      ],
      footer: dm?.footer ? `${dm.footer} ${vpnNote}` : vpnNote,
      ...(dm?.warn ? { warn: true } : {}),
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

// B120: tapping This iPhone acts at once: it is checked when the status already read says paired, and otherwise the
// pair page opens straight away (it draws with a spinner, and checks This iPhone itself once it finds a pairing),
// instead of waiting on idevice.status with nothing on screen.
export function pickRoute(v, known, { set, open }) {
  if (v !== "iphone") return set(v);
  if (known?.paired) return set("iphone");
  return open("pair");
}

async function paintInstallation(el, { store, native, alert, redraw }) {
  const choice = store.get(ROUTE_KEY);
  let known = null; // idevice.status once read, for the tap above
  let devMode = null; // idevice.developerMode's `on`, once read
  const paint = (st) => el.replaceChildren(warnFooters(installationGroups(choice, st, {
    devMode,
    pick: (v) => pickRoute(v, known, { set: (r) => store.set(ROUTE_KEY, r), open: goTo }),
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
  known = await status(native); // read for the Signing Server choice too, so a tap on This iPhone knows the pairing
  if (choice !== "iphone") return;
  paint(known);
  if (!canReadDeveloperMode(known)) return;
  devMode = await readDeveloperMode(native);
  if (devMode != null && el.isConnected !== false) paint(known);
}

// Developer Mode through the pairing: true/false, or null when it couldn't be read (an older shell, no answer).
export async function readDeveloperMode(native) {
  try { const r = await call(native, "idevice.developerMode"); return typeof r?.on === "boolean" ? r.on : null; } catch { return null; }
}

// grouped() with the footers of groups marked `warn` in red (ios6.css .sign-warning, as Settings > Signing's).
function warnFooters(sections) {
  const frag = grouped(sections);
  [...frag.children].forEach((g, i) => { if (sections[i]?.warn) g.querySelector?.(".group-footer")?.classList.add("sign-warning"); });
  return frag;
}

async function tailscaleSignIn(native, alert, redraw, done = `${NAME} is on your tailnet. Tap Test Connection to check it reaches this iPhone.`) {
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
    await alert({ title: "Signed In", message: done, buttons: ["OK"] });
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
// "checking" is drawn at once while idevice.status answers, with a spinner (`spinner` marks the group). "connect"
// draws the way to connect `vpn` (core vpnRoute) with connectGroups.
export function setupGroups(state, st, p, { openVPN = () => {}, retry = () => {}, check = () => {}, forget = () => {}, failed = false,
  vpn = "localdevvpn", choose = () => {}, signIn = () => {}, openTailscale = () => {}, install = () => {}, busy = null } = {}) {
  const intro = { header: "Install on This iPhone", footer: IPHONE_INTRO };
  if (state === "paired") {
    return [intro,
      { rows: [{ label: "Paired", checked: true, cls: "pair-done" }] },
      { rows: [{ label: "Check Connection", cls: "sign-import", onClick: check }],
        footer: `Checks that ${NAME} can reach this iPhone through ${vpnList()}.` },
      { rows: [{ label: "Forget Pairing", cls: "sign-import", onClick: forget }] }];
  }
  if (state === "file") return [intro, { header: "Pair This iPhone", footer: PAIR_STEPS.file.map((s, i) => `${i + 1}. ${s}`).join(" ") }];
  if (state === "checking") return [intro, { spinner: "Checking…" }];
  if (state === "connect") return [intro, ...connectGroups(vpn, st, { openVPN, choose, signIn, openTailscale, install, busy })];
  const conn = { rows: [{ label: VPN, detail: "On" }] };
  const line = failed && !p ? `Pairing stopped.` : p ? pairFooter(p) : "Starting…";
  return [intro, conn,
    { header: "Pairing Code", pin: true },
    { header: "Where to Type It", guide: true, footer: line },
    ...(failed && !p ? [{ rows: [{ label: "Try Again", cls: "sign-import", onClick: retry }] }] : [])];
}

// The VPN is off: what to turn on, from the VPN apps installed (core vpnRoute's answer `vpn`).
//   localdevvpn  its state and Open LocalDevVPN
//   tailscale    Sign In (or its state once signed in) and Open Tailscale
//   ask          both installed: Connect With, LocalDevVPN or Tailscale; the answer is kept
//   none         neither: Install LocalDevVPN (its App Store page), Tailscale named as the other way
export function connectGroups(vpn, st, { openVPN = () => {}, choose = () => {}, signIn = () => {}, openTailscale = () => {}, install = () => {}, busy = null } = {}) {
  const goesOn = "This page goes on by itself when it's on.";
  if (vpn === "ask") {
    return [{
      header: "Connect With",
      rows: VPNS.map((label) => ({ label, onClick: () => choose(label.toLowerCase()) })),
      footer: `${VPNS.join(" and ")} are both installed. Pick the one ${NAME} pairs and installs through; Connect With in Installation & Signing changes it later.`,
    }];
  }
  if (vpn === "tailscale") {
    const ts = st?.tailscale ?? null;
    const rows = busy
      ? [{ label: "Signing In…", detail: busy }]
      : ts?.signedIn ? [{ label: "Tailscale", detail: ts.address ? "On" : "Off" }] : [{ label: "Sign In", cls: "sign-import", onClick: signIn }];
    rows.push({ label: "Open Tailscale", cls: "sign-import", onClick: openTailscale });
    return [{
      header: "Tailscale",
      rows,
      footer: ts?.signedIn ? `Turn on the Tailscale app's VPN. ${goesOn}` : `Sign ${NAME} in to your tailnet, then turn on the Tailscale app's VPN. ${goesOn}`,
    }];
  }
  if (vpn === "none") {
    return [{
      rows: [{ label: VPN, detail: "Not Installed" }, { label: `Install ${VPN}`, cls: "sign-import", onClick: install }],
      footer: `${NAME} pairs with this iPhone and installs through ${VPN}, a free app. The other way is Tailscale: install the Tailscale app and sign in to it. This page checks again when you come back.`,
    }];
  }
  return [{
    rows: [{ label: VPN, detail: vpnDetail(st) }, { label: `Open ${VPN}`, cls: "sign-import", onClick: openVPN }],
    footer: `Turn on ${VPN} to pair. ${goesOn}`,
  }];
}

// setupGroups' sections as DOM: the code after the `pin` group, the steps after the `guide` group's header, and the
// grey spinner with its line in the `spinner` group (packages.css .loading).
export function pairSections(sections) {
  const frag = grouped(sections);
  const groups = [...frag.children];
  sections.forEach((s, i) => {
    if (s.pin) groups[i].append(el("p", "pair-code", pinText(pairing?.pin) || "––– –––"));
    if (s.guide) groups[i].querySelector(".group-header").after(pairGuide());
    if (s.spinner) {
      const wait = el("div", "loading");
      wait.setAttribute("aria-busy", "true");
      wait.append(el("span", "loading-spinner"), el("span", null, s.spinner));
      groups[i].append(wait);
    }
  });
  return frag;
}

// Opens another app or its App Store page; says so when iOS couldn't.
async function openApp(native, alert, url, name) {
  let opened = false;
  try { opened = (await call(native, "app.openURL", { url }))?.opened === true; } catch { /* below */ }
  if (!opened) await alert({ title: `Couldn't Open ${name}`, message: name === "Tailscale" ? "Get the Tailscale app from the App Store, sign in and turn it on." : "Try again.", buttons: ["OK"] });
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
export function leave() { // also for tests: ends a visit (its VPN poll) without a hashchange
  if (visit?.poll) clearInterval(visit.poll);
  visit = null;
  if (pairing && shown) call(shown.native, "idevice.pairCancel").catch(() => {});
}
if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("visibilitychange", reread);
  window.addEventListener("pageshow", reread);
  window.addEventListener("hashchange", () => { if (!onPairPage()) leave(); });
}

async function vpnApps(native) { try { return await call(native, "idevice.vpnApps"); } catch { return null; } }

async function drawPair(box, { store, native, alert, redraw }) {
  shown = { native, redraw };
  visit ??= { started: false, asked: false, failed: false, poll: null };
  const v = visit;
  // B120: the page draws at once, a spinner while idevice.status answers (a redraw keeps what is on screen).
  if (!pairing && !box.firstChild) box.replaceChildren(pairSections(setupGroups("checking")));
  // In pairing mode the page draws from `pairing` alone, without waiting on idevice.status.
  const [st, apps] = pairing ? [null, null] : await Promise.all([status(native), vpnApps(native)]);
  if (v !== visit) return; // left while idevice.status answered
  const state = setupState(st, pairing);
  if (state !== "connect" && v.poll) { clearInterval(v.poll); v.poll = null; }
  const connect = st?.tailscale?.connect ?? "auto";
  const vpn = vpnRoute(apps, connect);
  // Only Tailscale installed: acting on it makes Connect With Tailscale, as picking it does when both are.
  const useTailscale = () => connect === "tailscale" ? Promise.resolve() : call(native, "tailscale.setConnect", { value: "tailscale" }).catch(() => {});

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
    vpn,
    busy: signingIn,
    choose: async (value) => { await call(native, "tailscale.setConnect", { value }).catch(() => {}); redraw(); },
    signIn: async () => { await useTailscale(); tailscaleSignIn(native, alert, redraw, `${NAME} is on your tailnet. Turn on the Tailscale app's VPN to pair.`); },
    openTailscale: async () => { await useTailscale(); openApp(native, alert, TAILSCALE_URL, "Tailscale"); },
    install: () => openApp(native, alert, LOCALDEVVPN_STORE, "App Store"),
  });
  if (state === "paired" && store.get(ROUTE_KEY) !== "iphone") store.set(ROUTE_KEY, "iphone"); // picked This iPhone, already paired
  const frag = pairSections(sections);
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
    const ask = connectAlert(vpn);
    if (ask && !v.asked) {
      v.asked = true;
      const { index } = await alert({ ...ask, cancel: 0 }) || {};
      if (index === ask.open) openVPN(native, alert);
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
