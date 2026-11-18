// F75: cydian:// links the shell hands over (native/Sources/App.swift, Incoming): it keeps the latest, sends
// "cydian:url" on window, and the page takes it with app.takeURL (also once at start, for a link that launched the
// app before the page was there).
//   cydian://signing-import#<sealed>   Import from Safari coming back: into the Keychain, then Settings > Signing
//   cydian://import?d=<gzipped JSON>   Open in Cydian App on the website: the review alert (screens/importlink.js)
//   cydian://myipas?file=<name>        F77: an .ipa another app sent, already in My IPAs (MyIPAs.swift): its page
//   cydian://add?url=<url>[&suite=…]   N8: the Add Source intent: Add Source's alert, filled in (core/handoff.js)
//   altstore://source?url=…, feather://install/<ipa>, …   F83: other sideloaders' links (core/otherlinks.js), when
//                                      Settings > Sideloading > Open Other Apps' Links is on: a source goes to Sources >
//                                      Manage's Add, filled in; an IPA to Install IPAs, then Install (signAndInstall).
//                                      Off, or a link Cydian has no use for: handed back (handBack below)
//
//   startIncoming({ native })          once, in the app
//   await handleIncoming(url, deps)    -> "signing-import" | "import" | "myipas" | "add" | "other-source" |
//                                         "other-install" | "other-app" | null (not one of ours)
// SPDX-License-Identifier: GPL-3.0-or-later
import { showAlert } from "./nav/alert.js";
import { showHUD } from "./nav/hud.js";
import { format } from "./router.js";
import { finishSafariImport, statusReady } from "./signing-client.js";
import { deviceError } from "./core/signing.js";
import { parseAddLink } from "./core/handoff.js";
import { parseOtherLink, otherLinksOn } from "./core/otherlinks.js";

const openSigning = () => { location.hash = format({ tab: "settings", path: ["signing"] }).replace(/^#/, ""); };

export function startIncoming({ native = globalThis.cydianNative } = {}) {
  if (!native?.call) return;
  let busy = false;
  const take = async () => {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        let r = null;
        try { r = await native.call("app.takeURL", {}); } catch { return; } // an older shell
        if (!r?.url) return;
        await handleIncoming(r.url, { native });
      }
    } finally { busy = false; }
  };
  addEventListener("cydian:url", take);
  take();
}

export async function handleIncoming(url, { native = globalThis.cydianNative, alert = showAlert, hud = showHUD, go = openSigning,
  finish = finishSafariImport, review = null, add = null, install = null, on = otherLinksOn, open = goHash, now = Date.now } = {}) {
  const u = String(url ?? "");
  if (/^cydian:\/\/signing-import\b/i.test(u)) {
    const hide = hud("Importing");
    let st;
    try {
      st = await finish(u, { native });
    } catch (e) {
      hide();
      await alert({ title: "Couldn't Import", message: e?.code ? deviceError(e).message : e?.message || "Something went wrong.", buttons: ["OK"] });
      go();
      return "signing-import";
    }
    if (!statusReady(st)) {
      hide();
      await alert({ title: "Couldn't Import", message: st?.identityProblem || "The certificate went into the Keychain but Cydian can't find it there.", buttons: ["OK"] });
    } else if (hide.done) hide.done("Imported");
    else hide();
    go(); // the walkthrough, ticked
    return "signing-import";
  }
  if (/^cydian:\/\/myipas\b/i.test(u)) {
    const path = myIpasPath(u);
    const hash = format({ tab: "installed", path }).replace(/^#/, "");
    if (typeof location !== "undefined") location.hash = hash;
    return "myipas";
  }
  if (/^cydian:\/\/add\b/i.test(u)) {
    const prefill = addPrefill(u);
    if (!prefill) return "add";
    const run = add ?? (await import("./screens/manage.js")).addSource;
    await run({ showHUD: hud }, prefill);
    return "add";
  }
  if (/^cydian:\/\/import\b/i.test(u)) {
    const run = review ?? (await import("./screens/importlink.js")).reviewAndImport;
    await run(u, { native });
    return "import";
  }
  const other = parseOtherLink(u);
  if (other) return handleOtherLink(u, other, { native, alert, hud, add, install, on, open, now });
  return null;
}

const goHash = (hash) => { if (typeof location !== "undefined") location.hash = hash.replace(/^#/, ""); };

// F83: another sideloader's link. On: Cydian does what that app would have (a source, an IPA). Off, or a link only
// that app understands (a certificate export, a pairing callback): handed back.
async function handleOtherLink(u, other, { native, alert, hud, add, install, on, open, now }) {
  if (!on() || other.action === "other") return handBack(u, other, { native, alert, now, off: !on() });
  if (other.action === "source") {
    open(format({ tab: "sources", path: ["manage", "sources"] }));
    const run = add ?? (await import("./screens/manage.js")).addSource;
    await run({ showHUD: hud }, { url: other.url });
    return "other-source";
  }
  open(format({ tab: "installed", path: ["myipas"] }));
  const name = ipaFileName(other.url);
  const { index } = await alert({ title: "Install IPA", message: `${other.app} link: ${name}\n${other.url}`,
    buttons: ["Cancel", "Install"], cancel: 0 });
  if (index !== 1) return "other-install";
  const run = install ?? (await import("./signing-client.js")).signAndInstall;
  await run({ url: other.url, name: "" });
  return "other-install";
}

// iOS fixes URL schemes at install time and gives a scheme to one app when several claim it, so Cydian can't pass a
// link on to the app it was for: it can only open it again, which reaches another app only where iOS picks that one
// (UIApplication.open says false when nothing answers). Where iOS picked Cydian, opening it again comes straight
// back here: the same link within LOOP_MS is that echo, and gets the alert instead of a second try.
const LOOP_MS = 10_000;
let lastHandBack = { url: null, at: 0 };

async function handBack(u, other, { native, alert, now, off }) {
  const t = now();
  const echo = lastHandBack.url === u && t - lastHandBack.at < LOOP_MS;
  lastHandBack = echo ? { url: null, at: 0 } : { url: u, at: t };
  let opened = false;
  if (!echo && native?.call) {
    try { opened = (await native.call("app.openURL", { url: u }))?.opened === true; } catch { /* an older shell */ }
  }
  if (opened) return "other-app";
  await alert({ title: `${other.app} Link`, message: handBackText(other, off), buttons: ["OK"] });
  return "other-app";
}

export function handBackText(other, off) {
  const why = `This link was for ${other.app}, and iOS sent it to Cydian: iOS gives each kind of link to one app, so Cydian can't pass it on.`;
  if (off) return `${why} Turn on Settings > Sideloading > Open Other Apps' Links to open links like it in Cydian.`;
  return `${why} Only ${other.app} can do what this link asks.`;
}

const ipaFileName = (url) => {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || new URL(url).host; } catch { return url; }
};

// N8: cydian://add?url=…[&suite=…&component=…] -> Add Source's prefill ({ url, dist?, components? }), or null.
export function addPrefill(url) {
  let search = "";
  try { search = new URL(String(url)).search; } catch { return null; }
  return parseAddLink(search);
}

// F77: the Installed path for cydian://myipas?file=<name>: the IPA's page, or the library when the name is missing.
export function myIpasPath(url) {
  let file = null;
  try { file = new URL(String(url)).searchParams.get("file"); } catch { /* none */ }
  return file && /\.ipa$/i.test(file) && !file.includes("/") ? ["myipas", `ipa:${file}`] : ["myipas"];
}
