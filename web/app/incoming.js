// F75: ifizbox:// links the shell hands over (native/Sources/App.swift, Incoming): it keeps the latest, sends
// "ifizbox:url" on window, and the page takes it with app.takeURL (also once at start, for a link that launched the
// app before the page was there).
//   ifizbox://import?d=<gzipped JSON>   Open in iFizBox App on the website: the review alert (screens/importlink.js)
//   ifizbox://install?url=<ipa>[&name=…]  F89: the Install IPA alert, then Install (signAndInstall). The website's app
//                                      page sent it (Open in iFizBox) until F92/F95 dropped the hand-offs; kept for
//                                      links already out there and anyone's own pages
//   ifizbox://myipas?file=<name>        F77: an .ipa another app sent, already in My IPAs (MyIPAs.swift): its page
//   ifizbox://add?url=<url>[&suite=…]   N8: the Add Source intent: Add Source's alert, filled in (core/handoff.js);
//                                      N9: also an APT repo or AltStore source shared with iFizBox
//   ifizbox://shared?route=…            N9: an .ipa or .deb shared with iFizBox, or why not (share.js)
//   ifizbox://package?id=<id>           F96: the website's Install in iFizBox: that app's page (Search's package:<id>)
//   ifizbox://account?k=<key>           F97: a iFizBox Account's link or QR code: Sign In With Key, filled in
//   ifizbox://<tab>                     B14: home, sources, changes, installed, search, settings: that tab, at its root
//   altstore://source?url=…, feather://install/<ipa>, …   F83: other sideloaders' links (core/otherlinks.js), when
//                                      Settings > Sideloading > Open Other Apps' Links is on: a source goes to Sources >
//                                      Manage's Add, filled in; an IPA to Install IPAs, then Install (signAndInstall).
//                                      Off, or a link iFizBox has no use for: handed back (handBack below)
//
//   startIncoming({ native })          once, in the app
//   await handleIncoming(url, deps)    -> "import" | "install" | "myipas" | "add" | "shared" | "package" | "account" | "tab" | "other-source" |
//                                         "other-install" | "other-app" | null (not one of ours)
// SPDX-License-Identifier: GPL-3.0-or-later
import { showAlert } from "./nav/alert.js";
import { showHUD, liveHUD } from "./nav/hud.js";
import { format, ALL_TABS } from "./router.js";
import { parseAddLink } from "./core/handoff.js";
import { parseOtherLink, otherLinksOn } from "./core/otherlinks.js";
import { packageIdOf } from "./websign-gate.js";
import { NAME } from "./brand.js";

export function startIncoming({ native = globalThis.ifizboxNative } = {}) {
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
  addEventListener("ifizbox:url", take);
  const receiving = onReceiving();
  addEventListener("ifizbox:receiving", (e) => receiving(e.detail));
  take();
}

// B163: a file another app handed over is being copied in (a 185 MB IPA from Safari takes a while): the shell sends
// "ifizbox:receiving" with {name, progress} (0...1), then progress null once done or failed (native/Sources/App.swift
// Incoming.receiving). A live HUD "Copying <name>… 42%" until then; the link that follows opens its page or an alert.
//   onReceiving({ hud }) -> (detail) => void   (hud: liveHUD's shape, for tests)
export function onReceiving({ hud = liveHUD } = {}) {
  let live = null;
  return (detail) => {
    const p = detail?.progress;
    if (typeof p !== "number" || !Number.isFinite(p)) {
      live?.hide();
      live = null;
      return;
    }
    const text = `Copying ${String(detail?.name ?? "the file").slice(0, 60)}… ${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
    if (live) live.set(text);
    else live = hud(text);
  };
}

export async function handleIncoming(url, { native = globalThis.ifizboxNative, alert = showAlert, hud = showHUD,
  review = null, add = null, shared = null, install = null, signIn = null, on = otherLinksOn, open = goHash, now = Date.now } = {}) {
  const u = String(url ?? "");
  if (/^ifizbox:\/\/install\b/i.test(u)) {
    const ask = installAsk(u);
    if (ask) await confirmInstall(ask.url, ask.name, `${ask.name || ipaFileName(ask.url)}\n${ask.url}`, { alert, install, open });
    return "install";
  }
  if (/^ifizbox:\/\/myipas\b/i.test(u)) {
    const path = myIpasPath(u);
    const hash = format({ tab: "installed", path }).replace(/^#/, "");
    if (typeof location !== "undefined") location.hash = hash;
    return "myipas";
  }
  if (/^ifizbox:\/\/add\b/i.test(u)) {
    const prefill = addPrefill(u);
    if (!prefill) return "add";
    const run = add ?? (await import("./screens/manage.js")).addSource;
    await run({ showHUD: hud }, prefill);
    return "add";
  }
  if (/^ifizbox:\/\/shared\b/i.test(u)) {
    const run = shared ?? (await import("./share.js")).handleShared;
    await run(u, { native, alert, hud });
    return "shared";
  }
  if (/^ifizbox:\/\/package\b/i.test(u)) {
    const id = packageIdOf(u);
    if (id) open(format({ tab: "search", path: [`package:${id}`] }));
    return "package";
  }
  if (/^ifizbox:\/\/account\b/i.test(u)) {
    const run = signIn ?? (await import("./screens/account.js")).signInFromLink;
    await run(u, { open });
    return "account";
  }
  if (/^ifizbox:\/\/import\b/i.test(u)) {
    const run = review ?? (await import("./screens/importlink.js")).reviewAndImport;
    await run(u, { native });
    return "import";
  }
  const tab = tabOf(u);
  if (tab) {
    open(format({ tab, path: [] })); // a tab this build leaves out lands on Home (router.parse)
    return "tab";
  }
  const other = parseOtherLink(u);
  if (other) return handleOtherLink(u, other, { native, alert, hud, add, install, on, open, now });
  return null;
}

// B14: ifizbox://sources, ifizbox://changes/, … -> "sources", or null (not a bare tab link).
export function tabOf(link) {
  const m = /^ifizbox:\/\/([a-z]+)\/?(?:[?#].*)?$/i.exec(String(link ?? ""));
  const t = m?.[1].toLowerCase();
  return t && ALL_TABS.includes(t) ? t : null;
}

const goHash = (hash) => { if (typeof location !== "undefined") location.hash = hash.replace(/^#/, ""); };

// F83: another sideloader's link. On: iFizBox does what that app would have (a source, an IPA). Off, or a link only
// that app understands (a certificate export, a pairing callback): handed back.
async function handleOtherLink(u, other, { native, alert, hud, add, install, on, open, now }) {
  if (!on() || other.action === "other") return handBack(u, other, { native, alert, now, off: !on() });
  if (other.action === "source") {
    open(format({ tab: "sources", path: ["manage", "sources"] }));
    const run = add ?? (await import("./screens/manage.js")).addSource;
    await run({ showHUD: hud }, { url: other.url });
    return "other-source";
  }
  await confirmInstall(other.url, "", `${other.app} link: ${ipaFileName(other.url)}\n${other.url}`, { alert, install, open });
  return "other-install";
}

// Install IPAs opens under the alert; Install signs and installs (the sideload build's signAndInstall).
// B50: the jailbreak build has no signer (signAndInstall only says "Can't Install Here" there): Install downloads the
// IPA and installs it through the helper (ipa.install, screens/ipa-install.js's progress page), as Settings > Install
// IPA and a tapped .ipa link do, and remembers it for Installed's Apps.
async function confirmInstall(url, name, message, { alert, install, open }) {
  open(format({ tab: "installed", path: ["myipas"] }));
  const { index } = await alert({ title: "Install IPA", message, buttons: ["Cancel", "Install"], cancel: 0 });
  if (index !== 1) return false;
  const run = install ?? (await defaultInstall());
  await run({ url, name });
  return true;
}

// What Install runs: the helper's ipa.install in the jailbreak build (`jailbreak`), else signAndInstall.
// `ipaInstall` and `remember` stand in for screens/ipa-install.js's openIpaInstall and rememberIpa (tests).
export async function defaultInstall({ jailbreak = null, ipaInstall = null, remember = null } = {}) {
  const { ipaInstallAvailable } = await import("./ipa-install.js");
  if (jailbreak ?? ipaInstallAvailable()) {
    const screen = ipaInstall && remember ? null : await import("./screens/ipa-install.js");
    const { ipaName } = await import("./core/ipainstall.js");
    const openIt = ipaInstall ?? screen.openIpaInstall;
    const keep = remember ?? screen.rememberIpa;
    return ({ url, name }) => openIt({ url, name, onInstalled: (r) => keep(r, name || ipaName(url)) });
  }
  return (await import("./signing-client.js")).signAndInstall;
}

// F89: ifizbox://install?url=<https IPA>[&name=…] -> { url, name }, or null (no http(s) URL in it).
export function installAsk(link) {
  let q;
  try { q = new URL(String(link)).searchParams; } catch { return null; }
  const url = (q.get("url") ?? "").trim();
  if (!/^https?:\/\/[^\s/?#]+/i.test(url)) return null;
  return { url, name: (q.get("name") ?? "").trim().slice(0, 100) };
}

// iOS fixes URL schemes at install time and gives a scheme to one app when several claim it, so iFizBox can't pass a
// link on to the app it was for: it can only open it again, which reaches another app only where iOS picks that one
// (UIApplication.open says false when nothing answers). Where iOS picked iFizBox, opening it again comes straight
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
  const why = `This link was for ${other.app}, and iOS sent it to ${NAME}: iOS gives each kind of link to one app, so ${NAME} can't pass it on.`;
  if (off) return `${why} Turn on Settings > Sideloading > Open Other Apps' Links to open links like it in ${NAME}.`;
  return `${why} Only ${other.app} can do what this link asks.`;
}

const ipaFileName = (url) => {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || new URL(url).host; } catch { return url; }
};

// N8: ifizbox://add?url=…[&suite=…&component=…] -> Add Source's prefill ({ url, dist?, components? }), or null.
export function addPrefill(url) {
  let search = "";
  try { search = new URL(String(url)).search; } catch { return null; }
  return parseAddLink(search);
}

// F77: the Installed path for ifizbox://myipas?file=<name>: the IPA's page, or the library when the name is missing.
export function myIpasPath(url) {
  let file = null;
  try { file = new URL(String(url)).searchParams.get("file"); } catch { /* none */ }
  return file && /\.ipa$/i.test(file) && !file.includes("/") ? ["myipas", `ipa:${file}`] : ["myipas"];
}
