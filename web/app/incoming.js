// F75: cydian:// links the shell hands over (native/Sources/App.swift, Incoming): it keeps the latest, sends
// "cydian:url" on window, and the page takes it with app.takeURL (also once at start, for a link that launched the
// app before the page was there).
//   cydian://signing-import#<sealed>   Import from Safari coming back: into the Keychain, then Settings > Signing
//   cydian://import?d=<gzipped JSON>   Open in Cydian App on the website: the review alert (screens/importlink.js)
//   cydian://myipas?file=<name>        F77: an .ipa another app sent, already in My IPAs (MyIPAs.swift): its page
//   cydian://add?url=<url>[&suite=…]   N8: the Add Source intent: Add Source's alert, filled in (core/handoff.js);
//                                      N9: also an APT repo or AltStore source shared with Cydian
//   cydian://shared?route=…            N9: an .ipa or .deb shared with Cydian, or why not (share.js)
//
//   startIncoming({ native })          once, in the app
//   await handleIncoming(url, deps)    -> "signing-import" | "import" | "myipas" | "add" | "shared" | null (not one of ours)
// SPDX-License-Identifier: GPL-3.0-or-later
import { showAlert } from "./nav/alert.js";
import { showHUD } from "./nav/hud.js";
import { format } from "./router.js";
import { finishSafariImport, statusReady } from "./signing-client.js";
import { deviceError } from "./core/signing.js";
import { parseAddLink } from "./core/handoff.js";

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
  finish = finishSafariImport, review = null, add = null, shared = null } = {}) {
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
  if (/^cydian:\/\/shared\b/i.test(u)) {
    const run = shared ?? (await import("./share.js")).handleShared;
    await run(u, { native, alert, hud });
    return "shared";
  }
  if (/^cydian:\/\/import\b/i.test(u)) {
    const run = review ?? (await import("./screens/importlink.js")).reviewAndImport;
    await run(u, { native });
    return "import";
  }
  return null;
}

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
