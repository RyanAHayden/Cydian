// Settings > Installation's route (docs/sideload.md, "This iPhone"): how the sideload app hands a signed IPA to iOS.
//   "server"  the Signing Server's manifest and iOS's Install prompt (the default)
//   "iphone"  this phone's own installd over LocalDevVPN or Tailscale (native/sideload/idevice, native/sideload/tailscale):
//             no server, iFizBox updates itself
// Pure: the decision for one install from the idevice.status answer, the texts, and the pairing page's state.
import { NAME, DOMAIN } from "../brand.js";

export const ROUTE_KEY = "installRoute";
export const STORAGE_KEY = "ifizbox." + ROUTE_KEY;

// The VPN apps This iPhone connects through: LocalDevVPN (the phone at 10.7.0.1) or Tailscale (the app's own
// tailnet node reaching the phone's own Tailscale address). Every text says them from this list.
export const VPNS = ["LocalDevVPN", "Tailscale"];
export const vpnList = (vpns = VPNS) => vpns.length < 2 ? vpns.join("") : `${vpns.slice(0, -1).join(", ")} or ${vpns.at(-1)}`;

// Subtitles: one short point per line (the rows wrap them, settings.css .route-row).
export const ROUTE_OPTIONS = [
  { value: "server", label: "Signing Server", subtitle: `Default\nUses ${DOMAIN}` },
  { value: "iphone", label: "This iPhone", subtitle: `${vpnList()}\nNo server\nUpdates itself` },
];

// This iPhone's page says what it gives in one sentence under its title.
export const IPHONE_INTRO = `Installs straight onto this iPhone: no server, and ${NAME} can update itself.`;

export function storedRoute(storage = globalThis.localStorage) {
  try { return storage?.getItem(STORAGE_KEY) === "iphone" ? "iphone" : "server"; } catch { return "server"; }
}

// One install's route: { route: "idevice" } or { route: "server" }, with `alert` (a key of ALERTS) when This iPhone
// is chosen but can't be used now; "otherVPN" asks first (Use Server or Open LocalDevVPN), the rest fall back.
// `status` is idevice.status ({paired, localDevVPN, otherVPN, tailscale}), null when the call failed.
// `tailscale.use` is the shell's own rule (Connect With: Tailscale, or Automatic with the Tailscale VPN on, and
// signed in): then it connects through Tailscale, with no LocalDevVPN alert.
export function decideRoute(choice, status) {
  if (choice !== "iphone") return { route: "server" };
  if (!status) return { route: "server", alert: "noStatus" };
  if (!status.paired) return { route: "server", alert: "notPaired" };
  const ts = status.tailscale;
  if (ts?.use) return { route: "idevice" };
  if (ts?.connect === "tailscale") return { route: "server", alert: ts.signedIn ? "tailscaleOff" : "tailscaleSignIn" };
  if (status.localDevVPN) return { route: "idevice" };
  if (status.otherVPN) return { route: "server", alert: "otherVPN" };
  return { route: "server", alert: "vpnOff" };
}

const VPN = VPNS[0];
// buttons: the first is the server fallback; `open` is the index of Open LocalDevVPN (the install waits for it).
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
  tailscaleOff: { title: "Tailscale Is Off", message: "This install goes through the Signing Server. Turn Tailscale on in the Tailscale app to install on this iPhone.", buttons: ["OK"] },
  tailscaleSignIn: { title: "Sign In to Tailscale", message: `This install goes through the Signing Server. Sign ${NAME} in to Tailscale in Settings > Installation.`, buttons: ["OK"] },
};

// After Open LocalDevVPN the install waits (signing-client.js waitForVPN): idevice.status is asked every VPN_POLL ms
// and when the app comes back to the foreground, and the install goes on once this is true. Only Cancel stops it.
export const VPN_POLL = 2000;
export const vpnWaitText = (vpn = VPN) => `Waiting for ${vpn}…`;
export const VPN_WAIT = vpnWaitText();
export const VPN_CONNECTED = `${VPN} is on`;
export const vpnReady = (status) => Boolean(status?.paired && vpnOn(status));

// ---- Tailscale (Settings > Installation > This iPhone)

export const CONNECT_OPTIONS = [
  { value: "auto", label: "Automatic" },
  { value: "localdevvpn", label: "LocalDevVPN" },
  { value: "tailscale", label: "Tailscale" },
];

export function connectFooter(connect) {
  if (connect === "tailscale") return `Installs go through Tailscale. Keep the Tailscale app's VPN on; ${NAME} joins your tailnet only while it installs.`;
  if (connect === "localdevvpn") return "Installs go through LocalDevVPN, which works without the internet.";
  return `Tailscale when its VPN is on and ${NAME} is signed in, otherwise LocalDevVPN.`;
}

// Days until the node key expires (keyExpiry: RFC 3339), null when it doesn't expire.
export function keyDaysLeft(keyExpiry, now = Date.now()) {
  const t = Date.parse(keyExpiry || "");
  return Number.isFinite(t) ? Math.floor((t - now) / 86400000) : null;
}

// The Tailscale group's footer from tailscale.status.
export function tailscaleFooter(ts, now = Date.now()) {
  if (!ts?.signedIn) return `${NAME} joins your tailnet as its own device ("${NAME} on iPhone") and reaches this iPhone through it, so Tailscale can stay on.`;
  const days = keyDaysLeft(ts.keyExpiry, now);
  if (days != null && days < 0) return "This device's key expired. Sign out and sign in again.";
  if (days != null && days <= 14) return `This device's key expires in ${days} day${days === 1 ? "" : "s"}. Sign in again, or turn off key expiry for it in the admin console.`;
  if (!ts.address) return "The Tailscale app's VPN is off.";
  return `This iPhone is ${ts.address} on your tailnet.`;
}

// A copyable tailnet policy rule letting the node reach this phone's node on every port (RemotePairing's tunnel
// uses a second, changing port).
export const aclRule = (from, to) => JSON.stringify({ action: "accept", src: [from || "<this device>"], dst: [`${to || "<this iPhone>"}:*`] });

// tailscale.test's answer ({ok, code, detail, peer, name, address, ms}) as an alert: { title, message, copy? }.
export function tailscaleTestResult(r) {
  if (r?.ok) return { title: "Connected", message: `${NAME} reached this iPhone through Tailscale${r.ms ? ` in ${r.ms} ms` : ""}. Apps install over Tailscale now.` };
  const d = r?.detail ? ` (${r.detail})` : "";
  switch (r?.code) {
    case "no_interface": return { title: "Tailscale Is Off", message: "Turn on the Tailscale app's VPN, then test again." };
    case "needs_approval": return { title: "Approve This Device", message: `Your tailnet needs new devices approved. Approve "${r.name || NAME}" in the Tailscale admin console (Machines), then test again.` };
    case "expired": case "needs_login": return { title: "Sign In Again", message: "This device's key expired. Sign out, then sign in again. To avoid it, turn off key expiry for this device in the admin console." };
    case "acl": {
      const rule = aclRule(r.name, r.address);
      return { title: "Blocked by Your Tailnet", message: `Your tailnet's access rules don't let ${r.name || NAME} reach this iPhone${r.peer ? ` (${r.peer})` : ""}${d}. Add this rule to the policy file in the admin console: ${rule}`, copy: rule };
    }
    case "refused": return { title: "iPhone Refused", message: `This iPhone refused the connection${d}. Check that Developer Mode is on.` };
    case "no_answer": return { title: "No Answer", message: `This iPhone didn't answer through Tailscale${d}. Try again.` };
    default: return { title: "Couldn't Connect", message: `Tailscale didn't connect${d}. Check the internet connection and try again.` };
  }
}

// The bridge's params for a decision: route "idevice" sends no server (nothing reaches it) and no host.
export const routeParams = (decision) => (decision?.route === "idevice" ? { route: "idevice" } : {});

// The pairing page's state from idevice.status: "paired", "phone" (iOS 27: pair on the phone with a code) or "file"
// (older iOS: import a pairing file made on a computer).
export function pairState(status) {
  if (status?.paired) return "paired";
  return status?.pairOnPhone ? "phone" : "file";
}

// This iPhone's page (screens/installroute.js drawPair), what it shows from idevice.status and the pairing under way:
//   "paired"   Paired with a check, Check Connection, Forget Pairing
//   "file"     older iOS: Import Pairing File
//   "connect"  iOS 27, the VPN is off: Turn On … (alert and row), rechecked when the app comes back
//   "pairing"  iOS 27, the VPN is on: pairing runs by itself, the code big at the top, then PAIR_GUIDE
export function setupState(status, pairing = null) {
  if (pairing) return "pairing";
  const s = pairState(status);
  if (s !== "phone") return s;
  return vpnOn(status) ? "pairing" : "connect";
}

// A way to reach this iPhone: LocalDevVPN (10.7.0.1 reachable, idevice.status localDevVPN) or Tailscale (the shell's
// tailscale.use: its VPN on and signed in, or Connect With: Tailscale).
export function vpnOn(status) { return Boolean(status?.localDevVPN || status?.tailscale?.use); }

export const CONNECT_ALERT = {
  title: `Turn On ${vpnList()}`,
  message: `${NAME} pairs with this iPhone and installs through ${vpnList()}. Turn it on, then come back here.`,
  buttons: ["Cancel", `Open ${VPN}`], open: 1,
};

// Where to type the code, one short line a step; `img` is the user's own screenshot of that Settings row (iPhone 15,
// iOS 27, dark), cropped to the row and ringed on the page.
export const PAIR_GUIDE = [
  { text: "Open Settings" },
  { text: "Privacy & Security", img: "img/pair/1-privacy-security.jpg" },
  { text: "Developer Mode", img: "img/pair/2-developer-mode.jpg" },
  { text: `Pair with ${NAME}`, img: "img/pair/3-pair-with-ifizbox.jpg" },
  { text: "Type the code above" },
];

export const PAIR_STEPS = {
  file: [
    "Make a pairing file for this iPhone on a computer (idevice_pair or JitterbugPair).",
    "Save it to Files, then tap Import Pairing File.",
  ],
};

// idevice.pair's events folded into the page's state: { pin, text, error }. The code comes first, before the phone
// connects, and stays for every try. A failed try keeps the pairing open (the phone can tap Pair again), so its error
// stays shown until the next step.
export function pairEvent(state, ev) {
  const e = Array.isArray(ev) ? ev[0] : ev;
  if (!e) return state;
  if (e.pin) return { ...state, pin: e.pin };
  if (e.step === "failed") return { ...state, error: e.error || "The pairing failed." };
  if (e.text) return { ...state, text: e.text, error: "" };
  return state;
}

// idevice.pairState ({active, pin, step, text, error}, read when the app comes back to the foreground) as the page's
// state, or null when no pairing is waiting.
export function pairFromNative(st) {
  if (!st?.active) return null;
  return { pin: st.pin || "", text: st.text || "", error: st.error || "" };
}

// The code as it shows: "123 456".
export const pinText = (pin) => (/^\d{6}$/.test(pin || "") ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin || "");

// The step or error line under Cancel while pairing waits.
export function pairFooter(p) {
  if (p.error) return `That try didn't pair: ${p.error} Tap Pair on the iPhone to try again.`;
  return p.text || "Starting…";
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
