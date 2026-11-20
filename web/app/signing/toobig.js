// ---- F257: apps too big for the website ----------------------------------------------------------------------
//
// An app whose listed size (AltStore versions[].size) is over IPA_MAX never starts on the website: Install opens the
// Too Big alert before anything downloads, and before the early link (no blank icon is left). Website only: the apps
// sign on the phone and have no such cap. An app with no listed size is checked on the download's first answer.
//
//   await tooBigAlert({ url, name, size, version, iconUrl }, deps)   "download" | "lite" | "other" | "cancel"
//     Download IPA (blue, first): the link goes into Install IPAs (core/myipas.js addSiteUrl, with what the page
//     knows), the IPA opens in Safari (it saves to Files), and when the web app is back in front Install IPAs opens
//     with that row at the top, marked new for the visit, and a note under the bar (markFresh).
//     Get <NAME> Lite: Home's Install <NAME> App (screens/home.js installApp). Other Sideloader: handOffIpa.
//   handOffIpa({ url, name })   the sideloaders' own install links (core/otherlinks.js lists their shapes): <NAME> Lite,
//     AltStore, SideStore, Feather; each downloads and signs on the phone, whatever its size.
export const TOO_BIG_TITLE = "Too Big for the Website";
export const TOO_BIG_BUTTONS = ["Download IPA", `Get ${NAME} Lite`, "Other Sideloader", "Cancel"];
const appOr = (name) => name || "This app";
export const tooBigText = (name, size) => `${appOr(name)} is ${siteMB(size)} MB. ${SITE_LIMIT_TEXT} Download the IPA and import it into ${NAME} Lite or another sideloader.`;
export const tooBigNote = (name, size) => `${appOr(name)} (${siteMB(size)} MB) is in Safari's Downloads. It's too big for the website: tap Install to hand it to ${NAME} Lite or another sideloader.`;
// the app page's footer under Details, by the red Size
export const TOO_BIG_FOOTER = `${SITE_LIMIT_TEXT} Install this one with ${NAME} Lite, or hand it to another sideloader.`;
// F261: the same alert for an app at or past the size that ran this browser out of memory (core/websign.js
// memoryLimit): its own title and words, and Try Anyway (before Cancel) signs it after all.
export const MEMORY_TITLE = "Too Big for This iPhone";
export const MEMORY_BUTTONS = [...TOO_BIG_BUTTONS.slice(0, 3), "Try Anyway", "Cancel"];
export const memoryText = (name, size, limit) => `${appOr(name)} is ${siteMB(size)} MB. Signing a ${siteMB(limit)} MB app ran this browser out of memory. Download the IPA and import it into ${NAME} Lite or another sideloader, or try anyway.`;
// the failure's alert, under zsign's "Out of memory"
export const memoryNote = (size) => `${NAME} Lite signs big apps on the phone without this limit. From now on, apps of ${siteMB(size)} MB or more open Too Big here first.`;
// what the download's first answer says when no size was listed
export const tooLargeText = (n, max) => (n ? `This app is ${siteMB(n)} MB. ` : `This app is over ${siteMB(max)} MB. `)
  + (max === IPA_MAX ? SITE_LIMIT_TEXT : `The website signs apps up to ${siteMB(max)} MB.`);
import { format } from "../router.js";
import { siteMB, SITE_LIMIT_TEXT, IPA_MAX } from "../core/websign.js";
import { addSiteUrl, markFresh, MYIPAS } from "../core/myipas.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showAlert } from "../nav/alert.js";
import { NAME } from "../brand.js";

// Install links per sideloader, for an IPA's URL: [{ label, link }]. Feather takes only https.
export function sideloaderLinks(url, name = "") {
  const u = String(url ?? "");
  if (!/^https?:\/\//i.test(u)) return [];
  const e = encodeURIComponent(u);
  const out = [
    { label: `${NAME} Lite`, link: `${NAME.toLowerCase()}://install?url=${e}${name ? `&name=${encodeURIComponent(name)}` : ""}` },
    { label: "AltStore", link: `altstore://install?url=${e}` },
    { label: "SideStore", link: `sidestore://install?url=${e}` },
  ];
  if (/^https:\/\//i.test(u)) out.push({ label: "Feather", link: `feather://install/${u}` });
  return out;
}

export async function handOffIpa({ url, name = "" }, { sheet = showActionSheet, open = (u) => { location.href = u; } } = {}) {
  const links = sideloaderLinks(url, name);
  if (!links.length) return null;
  const i = await sheet({ title: name ? `Install ${name} With` : "Install With", buttons: links.map((l) => l.label) });
  if (i < 0 || !links[i]) return null;
  open(links[i].link);
  return links[i].label;
}

// fn() once the page is back in front after it was left (Safari's download took over), at most once.
export function whenBack(fn, doc = globalThis.document) {
  if (!doc?.addEventListener) return () => {};
  let left = false;
  const off = () => doc.removeEventListener("visibilitychange", on);
  function on() {
    if (doc.visibilityState === "hidden") { left = true; return; }
    if (doc.visibilityState === "visible" && left) { off(); fn(); }
  }
  doc.addEventListener("visibilitychange", on);
  return off;
}

export async function tooBigAlert({ url, name = "", size = 0, version = "", iconUrl = null, limit = null },
  { alert = showAlert, anyway = () => {}, open = (u) => globalThis.open?.(u, "_blank", "noopener"), storage = globalThis.localStorage, back = whenBack,
    go = (path) => { location.hash = format({ tab: "installed", path }).replace(/^#/, ""); },
    lite = async () => (await import("../screens/home.js")).installApp(), handoff = handOffIpa } = {}) {
  let entry = null;
  // Download IPA opens the file from the tap itself (Safari opens a new page only inside the user's tap)
  const onTap = (i) => {
    // F261: Try Anyway signs from the tap itself (signInBrowser opens iOS's early link there)
    if (limit && i === 3) { try { Promise.resolve(anyway()).catch(() => {}); } catch { /* its own alert said it */ } return; }
    if (i !== 0) return;
    try { entry = addSiteUrl(storage, url, Date.now(), { name, version, size, iconUrl }); } catch { entry = null; }
    if (entry) {
      markFresh(entry.file, tooBigNote(name || entry.name, size));
      back(() => go([MYIPAS]));
    }
    open(url);
  };
  const { index } = await alert(limit
    ? { title: MEMORY_TITLE, message: memoryText(name, size, limit), buttons: MEMORY_BUTTONS, cancel: 4, colors: { 0: "blue" }, onTap }
    : { title: TOO_BIG_TITLE, message: tooBigText(name, size), buttons: TOO_BIG_BUTTONS, cancel: 3, colors: { 0: "blue" }, onTap });
  if (limit && index === 3) return "try";
  if (index === 0) return "download";
  if (index === 1) { await Promise.resolve().then(lite).catch(() => {}); return "lite"; }
  if (index === 2) { await Promise.resolve().then(() => handoff({ url, name })).catch(() => {}); return "other"; }
  return "cancel";
}
