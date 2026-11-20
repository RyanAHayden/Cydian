// ---- on the phone (F58): the sideload build signs and installs itself, through I6's signing.* bridge calls ------
//
//   localSigning()                     true in the sideload build (common.js)
//   await deviceStatus()               signing.status: { identity | null, identityProblem? }
//   statusReady(status)                F69: true when that status holds an identity (Install and Settings both ask)
//   await importToDevice({ p12, password, profile })   signing.import (files base64) -> status
//   await removeFromDevice()           signing.remove -> status
//   await firstInstallCheck()          F75: the walkthrough's missing step ("certificate" | "server"), opened after a
//                                      Set Up Signing alert ("cancel" when the user didn't), or null
//   await installOnDevice({ url, name, onInstalled })  signing.install with the progress page following its phases (F151)
//
// Each takes `native` (the bridge, globalThis.ifizboxNative by default) so tests can pass a fake.
import { toBase64 } from "../core/signing.js";
import { format, settingsRoute } from "../router.js";
import { showAlert } from "../nav/alert.js";
import { NAME } from "../brand.js";
import { bridge, sleep } from "./common.js";
import { getServer } from "./identity.js";

export async function deviceStatus(native) {
  return bridge(native).call("signing.status", {});
}

// F69: whether a signing.status answer holds a usable identity, the one rule Install (signingReady) and Settings >
// Signing (which shows the certificate) both go by, so the two can't disagree. The status as the bridge hands it
// over: an object, or the same as JSON text; identity an object with the certificate's name (it may be empty) or
// null (none, or one the Keychain doesn't return: then `identityProblem` says why).
export function statusReady(status) {
  let st = status;
  if (typeof st === "string") { try { st = JSON.parse(st); } catch { return false; } }
  const id = st?.identity;
  return Boolean(id && typeof id === "object" && !Array.isArray(id));
}

// signing.status for signingReady: one more try a moment later when the bridge call fails (the signer's queue busy
// right after an import, the web view coming back from Safari). null when both fail.
export async function readyStatus(native, wait) {
  for (let i = 0; i < 2; i++) {
    try { return keepDevice(await deviceStatus(native)); } catch { if (i === 0) await wait(400); }
  }
  return null;
}

// F236: the last signing.status's profile.device (is this iPhone in the profile), for an install whose own answer
// doesn't carry one (My IPAs): followInstall's help line when it came out "unknown".
export let lastDevice = null;
function keepDevice(status) {
  let st = status;
  if (typeof st === "string") { try { st = JSON.parse(st); } catch { return status; } }
  lastDevice = st?.identity?.profile?.device ?? null;
  return status;
}

export async function importToDevice({ p12, password, profile }, native) {
  return bridge(native).call("signing.import", { p12: toBase64(p12), profile: toBase64(profile), password: password ?? "" });
}

export async function removeFromDevice(native) {
  return bridge(native).call("signing.remove", {});
}

// F75: before the first install in the app: the certificate (signing.status, as signingReady) and a Signing Server
// (getServer, https only: the shell takes no other for the manifest) must be there. When one is missing, the Signing
// page opens with that step open and this answers its id; null when Install can go on. A bridge that doesn't answer
// counts as no certificate, as signingReady does.
// B39: `from`, the page Install was tapped on (taken before any wait), is where Signing returns once it's ready.
export async function firstInstallCheck({ native, server = getServer(), go = openRoute, wait = sleep, from = here(), alert = showAlert } = {}) {
  const { missingStep, openAt, rememberReturn } = await import("../screens/signing.js");
  const step = missingStep(await readyStatus(native, wait), server);
  if (!step) return null;
  // Say why before leaving the page: Signing opens only on Set Up.
  const { index } = await alert({ title: "Set Up Signing", message: SETUP_WHY[step] ?? SETUP_WHY.certificate, buttons: ["Cancel", "Set Up"], cancel: 0 });
  if (index !== 1) return "cancel"; // truthy: Install stops; callers don't keep an Install Now for it
  openAt(step);
  rememberReturn(from);
  go(["signing"]);
  return step;
}

const SETUP_WHY = {
  certificate: `${NAME} signs apps with your own certificate before iOS will install them. Add your certificate (.p12) and its provisioning profile first.`,
  server: `${NAME} needs a Signing Server to hand the signed app to iOS. Choose one first.`,
};
const here = () => globalThis.location?.hash ?? "";
// B39: every trip to Settings > Signing from a page (a missing certificate or server) comes back to that page once
// signing is ready (screens/signing.js offerInstall), not to Home's stack.
export const openRoute = (path) => {
  const from = here();
  import("../screens/signing.js").then((m) => m.rememberReturn(from)).catch(() => {});
  location.hash = format(settingsRoute(path)).replace(/^#/, "");
};
export const openSigning = () => openRoute(["signing"]);
