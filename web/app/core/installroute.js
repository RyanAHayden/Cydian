// Settings > Installation's route (docs/sideload.md, "This iPhone"): how the sideload app hands a signed IPA to iOS.
//   "server"  the Signing Server's manifest and iOS's Install prompt (the default)
//   "iphone"  this phone's own installd over LocalDevVPN (native/sideload/idevice): no server, iFizBox updates itself
// Pure: the decision for one install from the idevice.status answer, the texts, and the pairing page's state.
import { NAME } from "../brand.js";

export const ROUTE_KEY = "installRoute";
export const STORAGE_KEY = "ifizbox." + ROUTE_KEY;

// The VPN apps that put the phone at 10.7.0.1. A later one (Tailscale) joins this list; every text says them from it.
export const VPNS = ["LocalDevVPN"];
export const vpnList = (vpns = VPNS) => vpns.length < 2 ? vpns.join("") : `${vpns.slice(0, -1).join(", ")} or ${vpns.at(-1)}`;

export const ROUTE_OPTIONS = [
  { value: "server", label: "Signing Server" },
  { value: "iphone", label: "This iPhone", subtitle: `With ${vpnList()}. No server, updates ${NAME} itself.` },
];

export const BENEFITS = [
  { title: "Private", text: "Nothing is sent to the Signing Server, not even the app's name." },
  { title: "Works Offline", text: `With ${vpnList()} on, apps install without the internet.` },
  { title: "Updates Itself", text: `${NAME} installs its own updates, with no Install prompt.` },
  { title: "Keeps Going", text: `An install doesn't stop if iOS pauses ${NAME}.` },
];

export function storedRoute(storage = globalThis.localStorage) {
  try { return storage?.getItem(STORAGE_KEY) === "iphone" ? "iphone" : "server"; } catch { return "server"; }
}

// One install's route: { route: "idevice" } or { route: "server" }, with `alert` (a key of ALERTS) when This iPhone
// is chosen but can't be used now; "otherVPN" asks first (Use Server or Open LocalDevVPN), the rest fall back.
// `status` is idevice.status ({paired, localDevVPN, otherVPN}), null when the call failed.
export function decideRoute(choice, status) {
  if (choice !== "iphone") return { route: "server" };
  if (!status) return { route: "server", alert: "noStatus" };
  if (!status.paired) return { route: "server", alert: "notPaired" };
  if (status.localDevVPN) return { route: "idevice" };
  if (status.otherVPN) return { route: "server", alert: "otherVPN" };
  return { route: "server", alert: "vpnOff" };
}

const VPN = VPNS[0];
// buttons: the first is the server fallback; `open` is the index of Open LocalDevVPN (the install stops there).
export const ALERTS = {
  noStatus: { title: "Can't Reach This iPhone", message: "This install goes through the Signing Server.", buttons: ["OK"] },
  notPaired: { title: "Not Paired", message: `${NAME} isn't paired with this iPhone yet, so this install goes through the Signing Server. Pair in Settings > Installation.`, buttons: ["OK"] },
  otherVPN: {
    title: "Another VPN Is On",
    message: `Installing on this iPhone needs ${VPN}, and iOS runs one VPN at a time. Turn ${VPN} on, or install through the Signing Server.`,
    buttons: ["Use Server", `Open ${VPN}`], open: 1,
  },
  vpnOff: {
    title: `${VPN} Is Off`,
    message: `This install goes through the Signing Server. Turn ${VPN} on to install on this iPhone.`,
    buttons: ["OK", `Open ${VPN}`], open: 1,
  },
};

// The bridge's params for a decision: route "idevice" sends no server (nothing reaches it) and no host.
export const routeParams = (decision) => (decision?.route === "idevice" ? { route: "idevice" } : {});

// The pairing page's state from idevice.status: "paired", "phone" (iOS 27: pair on the phone with a code) or "file"
// (older iOS: import a pairing file made on a computer).
export function pairState(status) {
  if (status?.paired) return "paired";
  return status?.pairOnPhone ? "phone" : "file";
}

export const PAIR_STEPS = {
  phone: [
    "Tap Start Pairing.",
    "Open Settings > Privacy & Security > Developer Mode.",
    `Tap "Pair with ${NAME} on this iPhone" and enter the code shown here.`,
  ],
  file: [
    "Make a pairing file for this iPhone on a computer (idevice_pair or JitterbugPair).",
    "Save it to Files, then tap Import Pairing File.",
  ],
};

// idevice.pair's events folded into the page's state: { pin, text, error }. A failed try keeps the pairing open (the
// phone can tap Pair again), so its error stays shown until the next step.
export function pairEvent(state, ev) {
  const e = Array.isArray(ev) ? ev[0] : ev;
  if (!e) return state;
  if (e.pin) return { ...state, pin: e.pin, error: "" };
  if (e.step === "failed") return { ...state, pin: "", error: e.error || "The pairing failed." };
  if (e.text) return { ...state, text: e.text, ...(e.step === "connected" ? { error: "" } : {}) };
  return state;
}

// The footer under Cancel while pairing waits.
export function pairFooter(p) {
  if (p.pin) return "Enter this code on the iPhone's pairing screen.";
  if (p.error) return `That try didn't pair: ${p.error} Tap Pair on the iPhone to try again.`;
  return p.text || "Waiting for Developer Mode's Pair button…";
}

// What a failed idevice.verify means: { title, message, again } (`again`: offer Pair Again).
export function verifyFailure(err) {
  const raw = String(err?.message ?? err ?? "");
  const code = err?.code ?? raw.split(":")[0];
  if (code === "connect_failed") {
    return { title: `Turn On ${VPN}`, message: `${NAME} couldn't reach this iPhone. Turn ${VPN} on and try again.`, again: false };
  }
  return { title: "Pairing Didn't Work", message: `This iPhone didn't accept the pairing (${raw || "no answer"}). Pair again.`, again: true };
}
