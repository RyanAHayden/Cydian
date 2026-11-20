// ---- B90: iOS's Install prompt cancelled while the website still signs ----------------------------------------
//
// The early link opens iOS's prompt at the tap, and the download, the signer and the upload run on behind it. iOS asks
// for app.ipa only once Install is tapped: the Worker marks that "asked" (GET /sign/up/<token>/status, even while it
// holds the request for the upload). watchPrompt polls the status from the moment the link opens; once the manifest
// was fetched (the prompt is up) and the page has come back in front (window focus, visibilitychange to visible,
// pageshow: the prompt closed; only after the manifest was seen) with no "asked" within `grace` ms, or none `cap` ms after the manifest whatever the
// page heard, iOS's prompt was cancelled: `onCancel()` runs once. A late "asked" before that carries on. A status
// without an "asked" key (a Worker before B90), or no status at all, never cancels: the install goes on as before.
//
//   const p = watchPrompt(token, { base, fetcher, onCancel })
//   p.state        "watching" | "asked" | "cancelled" | "unknown" (an older Worker) | "stopped"
//   p.stop()       stops polling and listening (the upload is done, or the job ended)
import { TRY_AGAIN_LABEL } from "../nav/progress.js";
import { signFail } from "./browser.js";
import { EARLY_WINDOW, dropEarly } from "./early.js";

// grace: room for iOS's HEAD after an Install tap, its KV mark and the next look; a cancel read wrongly kills a real
// install, so it errs long
export const PROMPT_EVERY = 1000, PROMPT_GRACE = 8000, PROMPT_CAP = 30 * 1000;
export const IOS_CANCELLED_TITLE = "Not Installed", IOS_CANCELLED_TEXT = "Cancelled in iOS.";

export function watchPrompt(token, { base = "", fetcher = globalThis.fetch, onCancel = () => {}, every = PROMPT_EVERY, grace = PROMPT_GRACE,
  cap = PROMPT_CAP, upTo = EARLY_WINDOW, clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  win = globalThis.window ?? globalThis, doc = globalThis.document } = {}) {
  const t0 = clock();
  let state = "watching", manifestAt = null, backAt = null;
  // only a return once the prompt is up counts (one that came with the link opening says nothing)
  const back = () => { if (manifestAt !== null) backAt = clock(); };
  const onVisible = () => { if (doc?.visibilityState !== "hidden") back(); };
  const listen = (on) => {
    const m = on ? "addEventListener" : "removeEventListener";
    try { win?.[m]?.("focus", back); win?.[m]?.("pageshow", back); doc?.[m]?.("visibilitychange", onVisible); } catch { /* no events */ }
  };
  listen(true);
  const end = (s) => { if (state === "watching") { state = s; listen(false); } };
  const look = async () => {
    try {
      const res = await fetcher(`${base}/sign/up/${token}/status`, { cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  (async () => {
    while (state === "watching") {
      const s = await look();
      if (state !== "watching") return;
      if (s && typeof s === "object") {
        if (!("asked" in s)) { end("unknown"); return; } // a Worker before B90: as before
        if (s.asked || s.started || s.finished) { end("asked"); return; }
        if (s.manifest && manifestAt === null) manifestAt = clock();
      }
      const now = clock();
      if (manifestAt !== null && (now - manifestAt >= cap || (backAt !== null && now - Math.max(backAt, manifestAt) >= grace))) {
        end("cancelled");
        try { onCancel(); } catch { /* the caller's own */ }
        return;
      }
      if (now - t0 >= upTo) { end("stopped"); return; }
      await sleep(every);
    }
  })().catch(() => end("stopped"));
  return { get state() { return state; }, stop: () => end("stopped") };
}

// signInBrowser's side of watchPrompt: { signal (aborts on the cancel), race(p) (p, or a rejection with code
// "ios_cancelled" once the prompt was cancelled), cancelled, token, stop() }.
export function promptStop(token, { base, fetcher, prompt = watchPrompt }) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  let cancelled = false, fire = () => {};
  const gone = new Promise((_, reject) => { fire = () => reject(signFail("ios_cancelled", IOS_CANCELLED_TEXT)); });
  gone.catch(() => {});
  const w = prompt(token, { base, fetcher, onCancel: () => { cancelled = true; try { ctl?.abort(); } catch { /* no signal */ } fire(); } });
  return { token, signal: ctl?.signal ?? null, get cancelled() { return cancelled; }, race: (p) => Promise.race([p, gone]), stop: () => w?.stop?.() };
}

// One signal that aborts when either does (AbortSignal.any where the browser has it).
export function eitherSignal(a, b) {
  if (!a || !b) return a || b || null;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const c = new AbortController();
  for (const s of [a, b]) { if (s.aborted) c.abort(); else s.addEventListener("abort", () => c.abort(), { once: true }); }
  return c.signal;
}

// The page once iOS's prompt was cancelled: the link dropped (the Worker answers a later app.ipa at once), "Not
// Installed" with "Cancelled in iOS." in red, and Try Again (the install again from that tap, so a fresh early link)
// above Return. A HUD without finish: the alert says it. -> false
export async function iosCancelled(h, token, { base, fetcher, alert, again }) {
  dropEarly(token, { base, fetcher });
  // run inside the tap itself: Safari opens the new early link only there
  const retry = () => { try { Promise.resolve(again()).catch(() => {}); } catch { /* its own alert said it */ } };
  if (typeof h.finish === "function") {
    h.page?.error?.(IOS_CANCELLED_TEXT);
    // the new run opens on this page (progressHUD reuses it while it's up): it stays
    h.finish({ title: IOS_CANCELLED_TITLE, status: IOS_CANCELLED_TEXT, also: { label: TRY_AGAIN_LABEL, action: () => { retry(); return true; } } });
    return false;
  }
  h.hide();
  await alert({ title: IOS_CANCELLED_TITLE, message: IOS_CANCELLED_TEXT, buttons: ["Cancel", TRY_AGAIN_LABEL], cancel: 0,
    onTap: (i) => { if (i === 1) retry(); } });
  return false;
}

// What iFizBox's own IPA carries for its first launch: the website's sources and settings (Send Settings' link).
export async function websiteTransfer() {
  const [{ websitePayload }, { encodeLink }] = await Promise.all([import("../screens/importlink.js"), import("../core/transfer.js")]);
  return encodeLink(await websitePayload({ identity: false })); // the certificate goes as ifizbox-identity.plist (bring)
}
