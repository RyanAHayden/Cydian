// ---- F235: the IPA queue's run, sign ahead and install one at a time (core/apprun.js, screens/apprun.js) --------
//
//   prepareParams(job)                 signing.prepare's params for a core/appqueue.js job: a Re-sign without a url signs
//                                      from the phone's record, a My IPAs job (`library`) from its file, a Custom Install
//                                      with its edits (always from the url: a look's token may be spent or stale)
//   await prepareOnDevice(job, { tag, signal, progress, log })   download and sign, keep the signed copy
//                                      -> { token, bundleId, name, version, expires }; progress(phase, fraction) with
//                                      phase "downloading" | "signing"; the signal's abort sends signing.cancel {tag}
//   await openPrepared(row, { tag, signal, progress, log, host, wait })   hand it to iOS (progress("asking")), then
//                                      wait for iOS's install (progress("installing", f)) -> { installed, expires,
//                                      dismissed? (B85: iOS's prompt closed and iOS never asked for the IPA) };
//                                      B146: on the prompt route installed is true or null (Sent to iOS), never false
//                                      unless dismissed; This iPhone's installd answer is passed as it is
//                                      again (B91): signing.reprompt instead of signing.open (the IPA is still
//                                      served), then the same wait; throws code "gone" when it isn't
//                                      host (iFizBox's own) doesn't wait: iOS closes iFizBox to install it
//   await repromptPrepared(row)        B85: iOS's Install prompt for that app again (signing.reprompt) -> true | false
//   discardPrepared(token)             frees a signed copy that won't be installed
// Errors come as deviceError's message (core/signing.js), so a row's "Failed: ..." reads as the alerts do.
import { deviceError } from "../core/signing.js";
import { withKeep } from "../core/keepid.js";
import { recordSelfUpdate } from "../core/selfupdate.js";
import { showAlert } from "../nav/alert.js";
import { askInsecure, bridge, keepIpaHash, refusing, storageOf } from "./common.js";
import { getServer } from "./identity.js";
import { chooseRoute } from "./route.js";

export const ASK_WAIT = 600; // seconds the queue waits for Install on iOS's prompt before the row fails

export function prepareParams(job) {
  if (!job) return null;
  if (job.mode === "resign" && !job.url && !job.library) return { record: job.id };
  const edits = { ...(job.options?.edits ?? {}) };
  delete edits.token;
  delete edits.url;
  // F237: Keep Bundle IDs off goes with the job, unless its Custom Install chose (edits.keepBundleId)
  if (job.library) return withKeep({ library: job.library, ...edits });
  return withKeep({ url: job.url, ...edits });
}

// native.call that rejects with code "cancelled" the moment `signal` aborts, after asking the shell to stop `tag`.
function abortable(native, method, params, onEvent, { tag, signal }) {
  const n = bridge(native);
  return new Promise((resolve, reject) => {
    const stop = () => {
      try { Promise.resolve(n.call("signing.cancel", { tag })).catch(() => {}); } catch { /* no bridge */ }
      reject(Object.assign(new Error("Cancelled"), { code: "cancelled" }));
    };
    if (signal?.aborted) { stop(); return; }
    signal?.addEventListener?.("abort", stop, { once: true });
    Promise.resolve(n.call(method, { ...params, tag }, onEvent)).then(resolve, reject);
  });
}

const rowError = (e, name) => {
  if (e?.code === "cancelled") return e;
  const why = deviceError(e, name);
  return Object.assign(new Error(why.message), { code: e?.code ?? null });
};

export async function prepareOnDevice(job, { tag, signal = null, progress = () => {}, log = () => {}, native, alert = showAlert } = {}) {
  let params = prepareParams(job);
  // F302a: the app's kept tweaks go with a plain install, an update and a tweak update (screens/tweaks.js), a line each
  try { params = await (await import("../screens/tweaks.js")).keptTweakParams(params, job, { log }); } catch (e) {
    throw Object.assign(new Error(`Can't inject the tweaks: ${String(e?.message ?? e)}`), { code: "tweaks" });
  }
  try {
    // B104: an http link with no https twin asks first (askInsecure); Cancel ends the row as its stop does
    const r = await askInsecure((extra) => abortable(native, "signing.prepare", { ...params, ...refusing(), ...extra }, (ev) => {
      if (ev?.log) { log(ev.log); return; }
      // B152: the signer's own phase (reading, signing) goes along, so the run gives each its share of Signing
      if (ev?.phase) progress(ev.phase === "downloading" ? "downloading" : "signing", Number(ev.progress) || 0, ev.phase);
    }, { tag, signal }), { alert, url: params?.url ?? null });
    keepIpaHash(storageOf(), r, { bundleId: job?.bundleId ?? (typeof job?.id === "string" && !job.id.startsWith("library:") ? job.id : null), version: job?.version ?? null }); // F292
    return r;
  } catch (e) {
    // F302a: an App Store copy: remembered, so Add to App lists it under Can't Take Tweaks
    if (e?.code === "encrypted" && typeof job?.id === "string" && !job.id.startsWith("library:")) {
      import("../screens/tweaks.js").then((t) => t.markEncrypted(job.id), () => {});
    }
    throw rowError(e, job?.name || job?.id || "");
  }
}

export async function openPrepared(row, { tag, signal = null, progress = () => {}, log = () => {}, host = false, wait = ASK_WAIT, native, again = false } = {}) {
  const name = row?.name || row?.id || "";
  let opened;
  if (again && !host) {
    // B91: a row iOS didn't download, tapped: the shell's IPA (still served) gets iOS's prompt again, no new signing;
    // code "gone" when it isn't served any more
    if (!(await repromptPrepared(row, native))) throw Object.assign(new Error("no longer served"), { code: "gone" });
    opened = { bundleId: row.bundleId, expires: row.expires ?? null };
  } else try {
    // B110: Open LocalDevVPN keeps this row (and so the queue, which installs one at a time) waiting on the run's page
    // ("vpn": core/apprun.js says "Waiting for LocalDevVPN…"); the run's Cancel or the row's stop aborts the signal
    const route = await chooseRoute({ native, signal: signal ?? new AbortController().signal, onWait: () => progress("vpn", 0) });
    if (!route) throw Object.assign(new Error("Cancelled"), { code: "cancelled" });
    if (route.route) host = false; // This iPhone: installd updates iFizBox in place
    // B111: This iPhone has no iOS prompt: the row shows the copy and installd's percent (herePhase), and the reply
    // comes once installd has the app
    if (route.route) progress("copying", 0);
    opened = await abortable(native, "signing.open", { token: row.token, manifestServer: getServer(), ...(host ? { host: true } : {}), ...route },
      (ev) => {
        if (ev?.log) { log(ev.log); return; }
        const p = route.route ? herePhase(ev) : null;
        if (p) progress(p.phase, p.fraction);
      }, { tag, signal });
    if (route.route) return { installed: opened?.installed ?? true, expires: opened?.expires ?? null };
  } catch (e) { throw rowError(e, name); }
  progress("asking", 0);
  if (host) recordSelfUpdate(storageOf(), opened?.version || row?.version); // B83: the next launch checks it landed
  if (host) return { installed: null, expires: opened?.expires ?? null, host: true };
  const bundleId = opened?.bundleId || row.bundleId;
  if (!bundleId) return { installed: null, expires: opened?.expires ?? null };
  let r;
  try {
    r = await abortable(native, "signing.progress", { bundleId, wait }, (ev) => {
      if (ev?.log) log(ev.log);
      else if (ev?.phase === "installing") progress("installing", Number(ev.progress) || 0);
    }, { tag, signal });
  } catch (e) {
    if (e?.code === "cancelled") throw e;
    return { installed: null, expires: opened?.expires ?? null }; // iOS can't be asked: the prompt was shown
  }
  // B85: dismissed: iOS's prompt closed and iOS never asked for the IPA (the user tapped Cancel on it)
  if (r?.dismissed) return { installed: r?.installed ?? null, expires: opened?.expires ?? null, dismissed: true };
  // B146: once iOS took the IPA, "not installed" can't be told apart from "installed but not seen" (isInstalled is
  // unreliable on iOS 27, a re-signed app may not show): the row ends Sent to iOS (null), never Failed
  return { installed: r?.installed === true ? true : null, expires: opened?.expires ?? null };
}

// B111: signing.install's {here: "copying" | "installing", progress} event (This iPhone) -> { label } for the page's
// step and bar ("Copying to iPhone 40%", "Installing 75%"), or null
export function hereLabel(ev) {
  const word = { copying: "Copying to iPhone", installing: "Installing" }[ev?.here];
  if (!word) return null;
  const p = Math.round(Math.max(0, Math.min(1, Number(ev.progress) || 0)) * 100);
  return { label: p > 0 && p < 100 ? `${word} ${p}%` : word };
}

// B150: the name an install's page shows: the caller's (a source's app name, the variant it was picked as, or Custom
// Install's), else the signed IPA's own (`result.name`, its Info.plist). A bare file name ("App.ipa") isn't a name:
// the IPA's own wins over it.
export function shownName(name, result) {
  const given = String(name ?? "").trim();
  return (given && !/\.ipa$/i.test(given) ? given : "") || result?.name || given;
}

// B111: the single install's end on This iPhone: installd has the app, so "Installed <app>", the bar full, and
// Open <app> (signing.openApp) above the Return button.
export function finishHere(h, result, { native, name = "", later = setTimeout } = {}) {
  const app = shownName(name, result) || "the app"; // B150: the source's name before the IPA's
  const text = `Installed ${app}`;
  const bid = result?.bundleId;
  if (typeof h.finish === "function") {
    h.set(`${text} 100%`);
    const open = () => { try { Promise.resolve(bridge(native).call("signing.openApp", { bundleId: bid })).catch(() => {}); } catch { /* no bridge */ } return false; };
    h.finish({ status: text, ...(bid ? { also: { label: `Open ${app}`, action: open } } : {}) });
  } else later(() => (h.done ? h.done(text) : h.hide()), 1200);
}

// B111: signing.open's event on the This iPhone route -> the run's { phase: "copying" | "installing", fraction 0..1 },
// or null (not a step event)
export function herePhase(ev) {
  if (ev?.phase !== "copying" && ev?.phase !== "installing") return null;
  const f = Number(ev.progress);
  return { phase: ev.phase, fraction: Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0 };
}

// B85: the run's "Tap Install on the iOS prompt" row: iOS's prompt for that app again -> true when the shell re-opened it
export async function repromptPrepared(row, native) {
  if (!row?.bundleId) return false;
  try { return Boolean((await bridge(native).call("signing.reprompt", { bundleId: row.bundleId }))?.reopened); } catch { return false; }
}

export function discardPrepared(token, native) {
  try { Promise.resolve(bridge(native).call("signing.discard", { token })).catch(() => {}); } catch { /* no bridge */ }
}
