// Settings > Installation (sideload build, docs/settings.md): Install Apps With Signing Server / This iPhone, and the
// This iPhone route's two pages (core/installroute.js holds the rules and texts):
//   installation           the choice, then (This iPhone) Pairing and the VPN's state
//   installation/benefits  what This iPhone gives, before it's set up; Set Up opens the pairing page
//   installation/pair      iOS 27: Start Pairing shows the 6-digit code at once, for Settings > Developer Mode, and
//                          keeps pairing until it pairs, Cancel, or the page is left; older iOS:
//                          Import Pairing File; once paired, Check Connection (Pair Again when it fails) and Forget
// The idevice.* bridge calls are native/sideload/idevice/IDeviceBridge.swift's.
import { grouped } from "../nav/ui.js";
import { format, settingsRoute } from "../router.js";
import { showAlert } from "../nav/alert.js";
import { toBase64 } from "../core/signing.js";
import { ROUTE_KEY, ROUTE_OPTIONS, BENEFITS, VPNS, vpnList, pairState, pairEvent, pairFooter, pairFromNative, pinText, PAIR_STEPS, verifyFailure } from "../core/installroute.js";
import { NAME } from "../brand.js";

export const PAGE = "installation";
export const SUB_TITLES = { benefits: "This iPhone", pair: "Pair This iPhone" };
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

// The main page's groups (pure, for tests): the choice and, with This iPhone chosen, its state.
export function installationGroups(choice, st, { pick = () => {}, openVPN = () => {} } = {}) {
  const groups = [{
    header: "Install Apps With",
    rows: ROUTE_OPTIONS.map((o) => ({ label: o.label, subtitle: o.subtitle, checked: o.value === choice, onClick: () => pick(o.value) })),
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
      footer: `${VPN} must be on while apps install.`,
    });
  }
  return groups;
}

export async function drawInstallation(el, sub, { store, native = globalThis.ifizboxNative, alert = showAlert } = {}) {
  const redraw = () => drawInstallation(el, sub, { store, native, alert });
  if (sub === "benefits") return el.replaceChildren(benefitsPage());
  if (sub === "pair") return drawPair(el, { store, native, alert, redraw });
  const choice = store.get(ROUTE_KEY);
  const paint = (st) => el.replaceChildren(grouped(installationGroups(choice, st, {
    pick: async (v) => {
      if (v !== "iphone") return store.set(ROUTE_KEY, v);
      const s = await status(native);
      if (s?.paired) store.set(ROUTE_KEY, "iphone"); else goTo("benefits");
    },
    openVPN: () => openVPN(native, alert),
  })));
  paint(null);
  if (choice === "iphone") paint(await status(native));
}

async function openVPN(native, alert) {
  let r = null;
  try { r = await call(native, "idevice.openLocalDevVPN"); } catch { /* below */ }
  if (!r?.opened) await alert({ title: `${VPN} Isn't Installed`, message: `Get ${VPN} from the App Store, open it and turn it on.`, buttons: ["OK"] });
}

export function benefitsPage() {
  return grouped([
    { header: "Install on This iPhone", rows: BENEFITS.map((b) => ({ label: b.title, subtitle: b.text })) },
    { rows: [{ label: "Set Up", cls: "sign-import", href: route("pair") }],
      footer: `You need ${VPN} from the App Store, and to pair ${NAME} with this iPhone once.` },
  ]);
}

// ---- Pairing

let pairing = null; // { pin, text, error } while idevice.pair waits for the phone (core pairEvent)
let shown = null; // { native, redraw } of the pair page on screen, for the hooks below

// The pair page's groups in pairing mode or not (pure, for tests): the steps, then Start Pairing or Cancel with the
// step or error line under it. The code goes under the steps (drawPair).
export function pairGroups(p, { start = () => {}, cancel = () => {} } = {}) {
  const steps = PAIR_STEPS.phone.map((s, i) => `${i + 1}. ${s}`).join(" ");
  return [
    { header: "Pair This iPhone", footer: steps },
    { rows: [p ? { label: "Cancel", cls: "sign-import", onClick: cancel } : { label: "Start Pairing", cls: "sign-import", onClick: start }],
      footer: p ? pairFooter(p) : "" },
  ];
}

// While pairing, the app is in the background (the code is typed in Settings) and events sent then may never reach
// the page: coming back, it reads the pairing from native. Leaving the page ends the pairing.
function onPairPage() { return location.hash.replace(/^#/, "") === route("pair").replace(/^#/, ""); }
async function reread() {
  if (!pairing || !shown || document.visibilityState !== "visible") return;
  const { native, redraw } = shown;
  let st = null;
  try { st = await call(native, "idevice.pairState"); } catch { return; }
  const now = pairFromNative(st);
  if (now && pairing) { pairing = now; redraw(); } // not active: idevice.pair's reply settles it
}
if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("visibilitychange", reread);
  window.addEventListener("pageshow", reread);
  window.addEventListener("hashchange", () => {
    if (pairing && shown && !onPairPage()) call(shown.native, "idevice.pairCancel").catch(() => {});
  });
}

async function drawPair(el, { store, native, alert, redraw }) {
  shown = { native, redraw };
  // In pairing mode the page draws from `pairing` alone, without waiting on idevice.status.
  const st = pairing ? { paired: null, pairOnPhone: true } : await status(native);
  const state = pairState(st);
  const done = (title, message) => { store.set(ROUTE_KEY, "iphone"); alert({ title, message, buttons: ["OK"] }); redraw(); };
  if (state === "paired") {
    el.replaceChildren(grouped([
      { header: "Pairing", rows: [{ label: "This iPhone", detail: st.paired === "rp" ? "Paired" : "Pairing File" }] },
      { rows: [{ label: "Check Connection", cls: "sign-import", onClick: () => check(native, alert, redraw, store) }],
        footer: `Checks that ${NAME} can reach this iPhone through ${VPN}.` },
      { rows: [{ label: "Forget Pairing", cls: "sign-import", onClick: async () => { await call(native, "idevice.forget").catch(() => {}); store.set(ROUTE_KEY, "server"); redraw(); } }] },
    ]));
    return;
  }
  const steps = PAIR_STEPS[state].map((s, i) => `${i + 1}. ${s}`).join(" ");
  if (state === "phone") {
    const start = async () => {
      if (pairing) return;
      pairing = { pin: "", text: "", error: "" };
      redraw();
      try {
        // idevice.pair's first event is the code, before anything listens
        await call(native, "idevice.pair", {}, (ev) => { if (pairing) { pairing = pairEvent(pairing, ev); redraw(); } });
        pairing = null;
        done("Paired", `${NAME} installs apps on this iPhone now.`);
      } catch (e) {
        pairing = null;
        redraw();
        if (e?.code !== "canceled" && e?.code !== "cancelled" && !/^cancel+ed/.test(e?.message || "")) {
          alert({ title: "Couldn't Pair", message: e?.message || "No answer.", buttons: ["OK"] });
        }
      }
    };
    const frag = grouped(pairGroups(pairing, { start, cancel: () => call(native, "idevice.pairCancel").catch(() => {}) }));
    if (pairing?.pin) {
      frag.firstElementChild.append(Object.assign(document.createElement("p"), { className: "pair-code", textContent: pinText(pairing.pin) }));
    }
    el.replaceChildren(frag);
    return;
  }
  // Older iOS: a pairing file made on a computer.
  const input = Object.assign(document.createElement("input"), { type: "file", className: "visually-hidden" });
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    try {
      await call(native, "idevice.import", { data: toBase64(new Uint8Array(await f.arrayBuffer())) });
      done("Paired", `${NAME} installs apps on this iPhone now.`);
    } catch (e) {
      alert({ title: "Not a Pairing File", message: e?.message || "That file isn't a pairing for this iPhone.", buttons: ["OK"] });
    }
  });
  const frag = grouped([{ header: "Pair This iPhone", footer: steps },
    { rows: [{ label: "Import Pairing File", cls: "sign-import", onClick: () => input.click() }] }]);
  frag.querySelector(".sign-import")?.append(input);
  el.replaceChildren(frag);
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
    if (index === 1) { await call(native, "idevice.forget").catch(() => {}); redraw(); }
  }
}
