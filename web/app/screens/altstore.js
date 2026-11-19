// AltStore sources (F9): a source's own page and an app's page. The parsing and the rules (which versions this
// phone runs, how an app installs) are core/altstore.js; the apps are catalog rows (core/catalog.js loadAlt), so
// lists, Search and Changes draw them with screens/browse.js like any package. browse.js hands this file:
//   the Sources tab's `alt:<url>` page  -> renderAltSource: header in the source's tint, news, featured apps,
//                                         All Apps, Website; Share in the nav bar (F76)
//   a package page whose stanza is an app (kind "ipa") -> renderApp
// Styles: altstore.css. Every remote image goes through mediaUrl (http ones through the proxy on the site).
import { grouped, placeholder, el } from "../nav/ui.js";
import { format } from "../router.js";
import { catalog, ALL } from "../catalog.js";
import { getBackend } from "../backend.js";
import { mediaUrl } from "./depiction.js";
import { installOptions } from "../core/altstore.js";
import { appLinks, appGithub, altShots, loadPreviews, dedupeShots } from "../core/previews.js";
import { settings } from "./settings.js";
import { displayName, githubAvatarUrl } from "../core/sources.js";
import { compat } from "../core/compat.js";
import { currentDevice } from "../device.js";
import { detectMode } from "../core/settings.js";
import { apps, recordInstall, removeInstall, onAppsChange } from "../core/installed.js";
import { signAndInstall, localSigning, isSelfIpa } from "../signing-client.js";
import { siteGateRows, markiFizBoxInstalled, websiteInstallsOn, SITE_GATE_FOOTER } from "../websign-gate.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { setSourceShare, headerShareButton } from "./handoff.js";
import { openIpaInstall } from "./ipa-install.js";
import { ipaInstallAvailable } from "../ipa-install.js";
import { IPA_FOOTER } from "../core/ipainstall.js";
import { appQueue } from "../app-queue.js";
import { appJob, appNavLabel, modifyActions, resignJob, MARK_NOT_INSTALLED, destructiveOf, sizeText as formatSize } from "../core/appqueue.js";
import { markedVersionOnSource, markedResignJob } from "../core/appqueue.js"; // F221
import { signatureState, signedIndex, resignWindow } from "../core/signing.js";
import { compareVersions } from "../core/apt.js";
import { queueApp } from "./queue.js";
import { descriptionGroup } from "./description.js";
import { storeHeader, headerLine, storeTabs, tileRow, worksOnTile, sizeTile, sectionTile, ratingTile, updatedTile, whatsNewGroup } from "./storepage.js";
import { reviewsTab } from "./reviews.js";
import { reviewsApi, reviewsBase, mergeReviews } from "../core/reviews.js";
import { needsCheck, savedInfo, withIpaInfo, checkIpa, ipaInfoUrl } from "../core/ipainfo.js";
import { PUBLIC_SITE } from "../core/handoff.js";
import { lookupApp, lookupNeed, mergeDetails, pageLinks, lookupUrl, workerLookupUrl, regionOf, ownPageLinks, shortText,
  storeTrackId, storeReviews, reviewsFeedUrl, workerReviewsUrl } from "../core/applookup.js";
import { NAME, BUNDLE_ID } from "../brand.js";
import { addNavIcon } from "../nav/navbar.js";
import { haptic } from "../nav/haptic.js";
import { showHUD } from "../nav/hud.js";

function img(url, cls) {
  const src = mediaUrl(url);
  if (!src) return null;
  const i = el("img", cls);
  i.alt = "";
  i.decoding = "async";
  i.loading = "lazy";
  i.referrerPolicy = "no-referrer";
  i.onerror = () => i.remove();
  i.src = src;
  return i;
}

const deeper = (route, seg) => format({ tab: route.tab, path: [...route.path, seg] });

// "com.apple.developer.kernel.increased-memory-limit" -> "Increased Memory Limit" (the full name goes below).
const entitlementLabel = (name) => (String(name).split(".").pop() || String(name)).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const formatDate = (t, locale) => (t ? new Date(t).toLocaleDateString(locale, { dateStyle: "medium" }) : null);

// "iOS 15.0 or later", "iOS 14.0 – 16", or null.
export function osRange(v) {
  if (v.minOSVersion && v.maxOSVersion) return `iOS ${v.minOSVersion} – ${v.maxOSVersion}`;
  if (v.minOSVersion) return `iOS ${v.minOSVersion} or later`;
  if (v.maxOSVersion) return `iOS ${v.maxOSVersion} or earlier`;
  return null;
}

function card(children, cls = "") {
  const g = el("div", "group");
  const t = el("div", `table grouped ${cls}`.trim());
  t.append(...children.filter(Boolean));
  g.append(t);
  return g;
}

// The install rows for a version (user 2026-11-17: iFizBox's own signing is the way in the app):
//   - jailbreak build: Install through the helper (F67, screens/ipa-install.js), the console titled with `name`
//   - a source's own signed link (itms-services): Install, signed by the source
//   - the sideload app: Install, signed with the user's certificate on the phone (signing-client signAndInstall;
//     without one it opens the Signing walkthrough)
//   - the website: F93's Install, signed in the browser with the user's certificate (signing-client signAndInstall).
//     F92 (user 2026-11-18): no hand-offs to iFizBox / AltStore / SideStore / Feather here; Share keeps those.
//   - always: Download IPA, to keep the file
// `opener` opens a URL outside the app (window.open on the site). `onInstall` runs first on any of them (F30: the
// Installed tab's record). F80: `queue`, when given, is what "Signed with your certificate" does instead (the app page
// queues the app and opens Confirm: appPageAction); it resolves false to sign and install straight away as before.
// F81: where the phone signs (the sideload app), any version with an IPA also gets "Custom Install": the look-first
// sheet (signing-sheet.js customInstall) to change the bundle ID, name or icon, or leave extensions out. `custom`
// overrides whether it shows, `customize` what it runs (tests; F84: the app page's appPageCustom, which queues).
// F96: on the website any app but iFizBox gets websign-gate.js's rows instead (Install in iFizBox, Download IPA, then
// Install on the Website behind its warning); `appId` is the app's package id for the ifizbox:// link (else the page's
// hash), `gate` makes the rows (tests).
// F129: `bundleId` is the app's own bundle ID (appBundleId), handed to signAndInstall so a wildcard profile's website
// install opens iOS's prompt from the Install tap (signing-client.js expectedBundleId); null where it isn't known.
// `sign` is what signs and installs (signing-client.js signAndInstall; tests pass a fake).
export function installRows(version, sourceUrl, opener = (u) => window.open(u, "_blank", "noopener"), onInstall = () => {},
  queue = null, name = "", { custom = localSigning() && !ipaInstallAvailable(), customize = null, jailbreak = ipaInstallAvailable(),
    ipaInstall = openIpaInstall, site = detectMode() === "site", needsCertificate = siteCertificateAlert, appId = null,
    gate = siteGateRows, bundleId = null, sign = signAndInstall } = {}) {
  const o = installOptions(version, sourceUrl);
  const own = { bundleId: bundleId || null, version: version?.version ?? "" };
  const rows = [];
  if (o.download && jailbreak) {
    // F88: the helper says whether it installed, so the record waits for its success (openIpaInstall's onInstalled)
    rows.push({ label: o.itms ? "Install IPA" : "Install", subtitle: "With the jailbreak",
      onClick: () => ipaInstall({ url: o.download, name, onInstalled: () => onInstall() }) });
  } else if (o.itms) {
    rows.push({ label: "Install", subtitle: "Signed by the source", onClick: () => { onInstall(); location.href = o.itms; } });
  } else if (o.download && site && !isSelfIpa(o.download)) {
    // F96: other apps go to iFizBox first; Install on the Website (F93's browser signing) waits for the warning.
    const install = () => sign({ url: o.download, name, ...own, onInstalled: () => onInstall() });
    return { rows: gate({ id: appId, install, download: downloadRow(o.download, opener) }), options: o, gated: true };
  } else if (o.download && site) {
    // F93: Install signs in the browser with the certificate in Settings > Signing (signing-client.js
    // signInBrowser). F92: no hand-offs follow it. F96: iFizBox itself always installs from the website.
    rows.push({ label: "Install", subtitle: SITE_INSTALL_SUBTITLE,
      onClick: () => sign({ url: o.download, name, ...own, onInstalled: () => { markiFizBoxInstalled(); onInstall(); } }) });
  } else if (o.download) {
    const direct = () => sign({ url: o.download, name, ...own, onInstalled: () => onInstall() });
    rows.push({ label: "Install", subtitle: "Signed with your certificate",
      onClick: queue ? async () => { if (!(await queue())) direct(); } : direct });
  }
  if (o.download && custom) {
    const run = customize ?? (async (opts) => (await import("../signing-sheet.js")).customInstall(opts));
    rows.push({ label: "Custom Install", subtitle: "Bundle ID, name, icon, extensions",
      onClick: () => run({ url: o.download, name, onInstalled: () => onInstall() }) });
  }
  if (o.download) rows.push(downloadRow(o.download, opener));
  return { rows, options: o };
}

// F129: an app's own bundle ID: its AltStore bundleIdentifier, else its package row's id without the `~name` suffix
// a source adds when two apps share one ID (core/altstore.js). null when neither is there.
export const appBundleId = (app, rowId = null) => app?.bundleIdentifier || String(rowId ?? "").split("~")[0] || null;

const downloadRow = (url, opener) => ({ label: "Download IPA", subtitle: decodeURIComponent(url.split("/").pop() || ""), onClick: () => opener(url) });

// ---- the source page -------------------------------------------------------------------------------------------

export async function renderAltSource(body, route, key) {
  body.append(placeholder("page"));
  let meta, source;
  try {
    await catalog.ensure();
    [meta, source] = await Promise.all([catalog.altSource(key), getBackend().sources().then((l) => l.find((s) => s.key === key))]);
  } catch (e) {
    body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  const status = catalog.status(key);
  // F16a: a source in a format only its own app reads (an encrypted GBox source): the reason, and Open in (F8).
  if (source?.unsupported) {
    body.replaceChildren(grouped([{ header: displayName(source), rows: [{ label: "Can't List Apps", subtitle: source.uri }],
      footer: source.unsupported }]));
    setSourceShare(body, source); // F76: Share in the nav bar (screens/handoff.js)
    return;
  }
  if (!meta) {
    body.replaceChildren(el("p", "empty", status?.error || source?.error || "This source could not be loaded. Tap Refresh on Sources."));
    return;
  }
  const page = el("div", "alt-source");
  if (meta.tintColor) page.style.setProperty("--alt-tint", meta.tintColor);

  // Header: the source's banner (headerURL) on its tint, with its icon, name and subtitle.
  const head = el("div", "alt-header");
  const banner = img(meta.headerURL, "alt-banner");
  if (banner) head.append(banner);
  const id = el("div", "alt-id");
  const icon = img(meta.iconURL || (source && githubAvatarUrl(source)), "alt-icon"); // F44: GitHub avatar fallback
  if (icon) id.append(icon);
  const names = el("div", "alt-names");
  names.append(el("span", "alt-name", meta.name || (source ? displayName(source) : key)));
  if (meta.subtitle) names.append(el("span", "alt-subtitle", meta.subtitle));
  id.append(names);
  head.append(id);
  page.append(head);
  body.replaceChildren(page);

  if (meta.description) body.append(descriptionGroup(meta.description)); // F165: own group, long ones fold behind More

  // News, newest first: a card each; one about an app opens that app, one with a url opens it.
  if (meta.news.length) {
    const g = el("div", "group");
    g.append(el("h2", "group-header", "News"));
    for (const n of meta.news.slice(0, 10)) {
      const a = el(n.appID || n.url ? "a" : "div", "alt-news table grouped");
      if (n.appID) a.href = deeper(route, `package:${n.appID}`);
      else if (n.url) { a.href = n.url; a.target = "_blank"; a.rel = "noopener"; }
      if (n.tintColor) a.style.setProperty("--alt-tint", n.tintColor);
      const pic = img(n.imageURL, "alt-news-image");
      if (pic) a.append(pic);
      const t = el("div", "alt-news-text");
      t.append(el("span", "alt-news-title", n.title));
      if (n.caption) t.append(el("span", "alt-news-caption", n.caption));
      if (n.date) t.append(el("span", "alt-news-date", formatDate(n.date)));
      a.append(t);
      g.append(a);
    }
    body.append(g);
  }

  const appRow = (r) => ({ label: r.name, subtitle: r.short, detail: r.version, href: deeper(route, `package:${r.id}`) });
  if (meta.featured.length) body.append(grouped([{ header: "Featured", rows: meta.featured.map(appRow) }]));
  body.append(grouped([{ rows: [{ label: "All Apps", detail: String(meta.count), href: deeper(route, `section:${ALL}`) }],
    footer: meta.count ? null : "No app on this source runs on this iPhone's iOS version." }]));

  // F76: Share in the nav bar: Copy Link, the add link's QR code and every sideloader that takes the source
  // (the iOS 6 share sheet, screens/handoff.js), in place of F8's Open In group.
  setSourceShare(body, source ?? { key });
  if (meta.website) body.append(grouped([{ rows: [{ label: "Website", subtitle: meta.website, onClick: () => window.open(meta.website, "_blank", "noopener") }] }]));
  if (status?.error) body.append(el("p", "empty", status.error));
}

// ---- the app page ----------------------------------------------------------------------------------------------

// F91: iFizBox's signing.installed record of this app (by installed or original bundle ID), in the sideload app; null
// anywhere else, for an app iFizBox didn't sign, or when the call fails.
export async function signedRecordOf(id, { mode = detectMode(), native = globalThis.ifizboxNative } = {}) {
  if (mode !== "sideload" || !id || typeof native?.call !== "function") return null;
  try { return signedIndex(await native.call("signing.installed", {})).get(id) ?? null; } catch { return null; }
}

// F91: the Installed section's "Signature" row: the days left as the Installed tab's pill. Null without a date.
// F134: null too while Show Expiry Dates is off (`show`), unless the signature expired.
export function signatureRow(record, { now = new Date(), window = resignWindow((k) => settings.get(k)), show = settings.get("showExpiry") } = {}) {
  const sig = record ? signatureState(record.expires, { now, window }) : null;
  return sig && (show || sig.state === "expired") ? { label: "Signature", detail: sig.long, cls: `sig-row-${sig.state}` } : null;
}

function trackingSection(app, pkg, source) {
  const box = el("div");
  const mark = (version) => apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version, key: pkg.key,
    source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).then(draw, () => {});
  async function draw() {
    let rec = null;
    try { rec = (await (await apps()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
    const sigRow = signatureRow(await signedRecordOf(app.bundleIdentifier)); // F91
    const versions = app.versions.map((x) => x.version).filter(Boolean);
    const rows = rec
      ? [{ label: "Installed Version", detail: rec.version || "Unknown" },
        ...(versions.length > 1 ? [{ label: "Change Installed Version", onClick: () => pick() }] : []),
        { label: "Mark as Not Installed", onClick: () => apps().then((store) => removeInstall(store, app.bundleIdentifier)).then(draw, () => {}) }]
      : [{ label: "Mark as Installed", onClick: () => (versions.length > 1 ? pick() : mark(versions[0] ?? "")) }];
    // The nav bar's button says what it will do, as Cydia's does: Upgrade when a newer version is out than the one
    // installed, Reinstall when it's the same, Install when it isn't installed.
    // F80: Modify while the app is queued, as Cydia's does (core/appqueue.js appNavLabel).
    const label = appNavLabel({ queued: Boolean(appQueue.get(app.bundleIdentifier)), installed: rec ? rec.version || "" : null, newest: versions[0] });
    // (the Share icon sits beside it in the same corner: find the button by its label)
    const relabel = () => {
      const b = [...document.querySelectorAll(".nav-stack.is-active .nav-item.is-top .nav-right .bar-button")]
        .find((x) => /^(Install|Upgrade|Reinstall|Modify)$/.test(x.textContent));
      if (b) b.textContent = label;
      return Boolean(b);
    };
    if (!relabel()) setTimeout(relabel, 0);
    if (sigRow) rows.splice(1, 0, sigRow);
    box.replaceChildren(grouped([{ header: "Installed", rows,
      footer: rec ? `${NAME} follows this app for updates: they show in Changes.` : `Installed it another way? Mark it, and ${NAME} follows it for updates.` }]));
  }
  async function pick() {
    const versions = app.versions.map((x) => x.version).filter(Boolean);
    const i = await showActionSheet({ title: "Which version is installed?", buttons: versions });
    if (i >= 0) mark(versions[i]);
  }
  draw();
  // F88: an install's record lands when the helper's install ends: redraw, and stop once the page is gone.
  const offApps = onAppsChange(() => { if (box.isConnected) draw(); else offApps(); });
  // F80: queuing or clearing this app relabels the nav button (Modify); the page gone, it stops listening.
  let shown = false;
  const off = appQueue.subscribe((e) => {
    if (!box.isConnected) { if (shown) off(); return; }
    shown = true;
    if (e.type === "clearAll" || e.id === app.bundleIdentifier || e.job?.id === app.bundleIdentifier) draw();
  });
  return box;
}

// ---- F210: the nav bar's one-tap Installed toggle, left of Install / Modify ----------------------------------------
// Not installed: an outline circled checkmark; a tap marks the app installed at the source's latest version (the record
// trackingSection's Mark as Installed writes, no version picker). Installed (by iFizBox or marked): filled; a tap
// forgets it (removeInstall, as Mark as Not Installed). No sheet: a haptic tick and a HUD, and the Installed section,
// the nav label and Changes follow through onAppsChange. Hidden for iFizBox's own app and an app with nothing to mark.
export const MARK_INSTALLED_LABEL = "Mark as Installed";
export const MARK_NOT_INSTALLED_LABEL = "Mark as Not Installed";

const markRecordOf = (app, pkg, source, version) => ({ id: app.bundleIdentifier, name: app.name, version, key: pkg?.key ?? null,
  source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL });

export function markToggleApplies(app) {
  const id = String(app?.bundleIdentifier ?? "");
  if (!id || !app.versions?.some((x) => x?.version)) return false;
  if (id === BUNDLE_ID || id.startsWith(`${BUNDLE_ID}.`)) return false; // iFizBox itself: always listed as it is
  return !app.versions.some((x) => isSelfIpa(x?.downloadURL));
}

async function markedRecord(app, store) {
  try { return (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { return null; }
}

// One tap's work: true when the app is now marked installed, false when it was forgotten.
export async function toggleMarked(app, pkg, source, { store = apps } = {}) {
  const s = await store();
  if ((await s.all()).some((r) => r.id === app.bundleIdentifier)) {
    await removeInstall(s, app.bundleIdentifier);
    return false;
  }
  await recordInstall(s, markRecordOf(app, pkg, source, app.versions.map((x) => x.version).find(Boolean) ?? ""));
  return true;
}

const markFeedback = (text) => showHUD("").done(text, 900);

// The button. `refresh()` redraws it from the record (renderApp calls it on every onAppsChange).
export function markToggle(app, pkg, source, { store = apps, buzz = haptic, feedback = markFeedback } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "bar-button bar-icon mark-toggle";
  const show = (on) => {
    b.classList.toggle("is-marked", on);
    b.setAttribute("aria-label", on ? MARK_NOT_INSTALLED_LABEL : MARK_INSTALLED_LABEL);
  };
  show(false);
  let busy = false;
  b.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    try { buzz(); } catch { /* no haptics here */ }
    try {
      const on = await toggleMarked(app, pkg, source, { store });
      show(on);
      feedback(on ? "Marked as Installed" : "Marked as Not Installed");
    } catch { /* no store: nothing changed */ } finally { busy = false; }
  });
  b.refresh = async () => show(Boolean(await markedRecord(app, store)));
  b.refreshed = b.refresh();
  return b;
}

// F80: the app page's nav button (browse.js packageActions) and its Install row, where the phone signs (the sideload
// app): Install / Upgrade / Reinstall queue the app and open Confirm (screens/queue.js); while it is queued the
// button reads Modify and offers Clear, as Cydia's does. False when the queue doesn't apply (the jailbreak build, the
// website, a source-signed link, no IPA): the caller
// does what it did before. F85: `version` (Version History's row) queues that version instead of the newest, with no
// Modify sheet: queuing it replaces whatever version of the app was queued.
// F94: an installed app's sheet ends with Mark as Not Installed (red), which forgets its record (`forget`); on the
// website (no queue) the sheet is siteModify's.
export async function appPageAction(pkg, source, { queue = appQueue, ask = showActionSheet, add = queueApp,
  mode = detectMode(), ready = async () => true, store = apps, version = null, signedOf = (id) => signedRecordOf(id, { mode }),
  forget = async (id) => removeInstall(await store(), id), siteInstall = siteInstallVersion } = {}) {
  const app = pkg?.stanza?.ipa;
  if (mode === "site" && app && !version) return siteModify(pkg, source, { ask, store, forget, siteInstall });
  if (mode !== "sideload" || !app) return false; // F89: the website queues nothing
  let rec = null;
  try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
  const job = appJob(pkg, { installed: rec ? rec.version || null : null, version, source: source ? displayName(source) : null });
  if (!job || !(await ready())) return false;
  if (version) { add(job, { queue }); return true; }
  const newest = app.versions[0]?.version ?? null;
  const installed = rec ? rec.version || "" : null;
  const older = installed ? app.versions.map((x) => x.version).filter((v) => v && compareVersions(v, installed) < 0) : [];
  const signed = await Promise.resolve().then(() => signedOf(job.id)).catch(() => null); // F91: Modify offers Re-sign
  // F221: marked as installed (no signature of iFizBox's): Re-sign while the source still has the installed version
  const onSource = !signed && Boolean(markedVersionOnSource(pkg, installed));
  const state = { queued: Boolean(queue.get(job.id)), installed, newest, older: older.length > 0, signed: Boolean(signed), onSource, build: "sideload" };
  if (!state.queued && installed == null && !state.signed) { add(job, { queue }); return true; }
  // Modify (installed or queued), as Cydia's: Upgrade/Reinstall, Downgrade (then which version), or Clear.
  const buttons = modifyActions(state);
  const i = await ask({ title: app.name, buttons, destructive: destructiveOf(buttons) });
  if (i < 0) return true;
  if (buttons[i] === "Clear") queue.clear(job.id);
  else if (buttons[i] === MARK_NOT_INSTALLED) await Promise.resolve().then(() => forget(app.bundleIdentifier)).catch(() => {});
  else if (buttons[i] === "Re-sign" && signed) add({ ...resignJob(signed), id: job.id, icon: job.icon }, { queue });
  else if (buttons[i] === "Re-sign") { // F221
    const r = markedResignJob(pkg, installed, { source: source ? displayName(source) : null });
    if (r) add(r, { queue });
  }
  else if (buttons[i] === "Downgrade") {
    const j = await ask({ title: "Downgrade to", buttons: older });
    const pick = j >= 0 ? appJob(pkg, { installed, version: older[j], source: source ? displayName(source) : null }) : null;
    if (pick) add(pick, { queue });
  } else add(job, { queue });
  return true;
}

// F94: the website's Modify, for an app marked installed (core/installed.js's record): Upgrade or Reinstall resolve
// false, so the caller installs the newest as before (browse.js packageActions: the browser signs it); Downgrade asks
// which version and installs that one (`siteInstall`); Mark as Not Installed forgets the record. Not installed: false.
async function siteModify(pkg, source, { ask, store, forget, siteInstall }) {
  const app = pkg.stanza.ipa;
  let rec = null;
  try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
  if (!rec) return false;
  const installed = rec.version || "";
  const newest = app.versions[0]?.version ?? null;
  const older = installed ? app.versions.filter((x) => x.version && compareVersions(x.version, installed) < 0) : [];
  const same = markedVersionOnSource(pkg, installed); // F221: Re-sign signs the installed version again in the browser
  const buttons = modifyActions({ installed, newest, older: older.length > 0, onSource: Boolean(same), build: "site" });
  const i = await ask({ title: app.name, buttons, destructive: destructiveOf(buttons) });
  if (i < 0) return true;
  if (buttons[i] === MARK_NOT_INSTALLED) { await Promise.resolve().then(() => forget(app.bundleIdentifier)).catch(() => {}); return true; }
  if (buttons[i] === "Re-sign") { await siteInstall(pkg, same, source); return true; }
  if (buttons[i] === "Downgrade") {
    const j = await ask({ title: "Downgrade to", buttons: older.map((x) => x.version) });
    if (j >= 0) await siteInstall(pkg, older[j], source);
    return true;
  }
  return false;
}

// The website's Install of one version (installRows' first row: signed in the browser, or the source's own link),
// recorded once it installs, as browse.js recordApp does.
async function siteInstallVersion(pkg, v, source) {
  const app = pkg.stanza.ipa;
  const record = () => apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version: v.version, key: pkg.key,
    source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).catch(() => {});
  const { rows, gated } = installRows(v, app.sourceUrl, undefined, record, null, app.name, { appId: pkg.row?.id ?? pkg.stanza.package,
    bundleId: appBundleId(app, pkg.row?.id) });
  // F96: once website installs are accepted the downgrade signs here; until then it's Install in iFizBox.
  const first = gated && websiteInstallsOn() ? rows.find((r) => r.label === "Install on the Website") : rows[0];
  if (first && first.label !== "Download IPA") return first.onClick();
}

// F84: the app page's Custom Install, where the phone signs: the options sheet (signing-sheet.js customInstall), whose
// Install queues the app with those options (kept on the job) and opens Confirm, as Install does. Elsewhere (no job:
// a source-signed link; not the sideload app) it signs straight away as F81's did. `opts` is installRows' { url,
// name, onInstalled }. -> what customInstall resolved. F85: `version` (Version History's row) queues that version.
export async function appPageCustom(pkg, source, opts, { queue = appQueue, add = queueApp, mode = detectMode(), store = apps, version = null,
  custom = async (o) => (await import("../signing-sheet.js")).customInstall(o) } = {}) {
  const app = pkg?.stanza?.ipa;
  let job = null;
  if (app && mode === "sideload") {
    let rec = null;
    try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
    job = appJob(pkg, { installed: rec ? rec.version || null : null, version, source: source ? displayName(source) : null });
  }
  if (!job) return custom(opts);
  return custom({ url: job.url, name: opts?.name || job.name || "", queue: (options) => add({ ...job, options }, { queue }) });
}

// The website's Install group (F93: it signs in the browser; F92: only Install and Download IPA).
export const SITE_INSTALL_SUBTITLE = "Signed in the browser with your certificate";
export const SITE_INSTALL_FOOTER = "Install signs the app here in the browser with your certificate (Settings > Signing). "
  + "Download IPA keeps the file.";
// F95: My IPAs' website Install (screens/myipas.js siteInstallSheet) still says the certificate is needed, with
// Download IPA beside OK.
export const SITE_CERT_TITLE = "Certificate Needed";
const SITE_CERT_MESSAGE = "Installing from the website signs the app with your own certificate in the browser. "
  + "That isn't here yet: Download IPA keeps the file for now.";

// The certificate alert, with Download IPA beside OK. -> whether it downloaded.
export async function siteCertificateAlert({ download = () => {}, alert = showAlert } = {}) {
  const { index } = await alert({ title: SITE_CERT_TITLE, message: SITE_CERT_MESSAGE, buttons: ["OK", "Download IPA"], cancel: 0 });
  if (index !== 1) return false;
  download();
  return true;
}

// F181: the iOS 6 App Store's page (screens/storepage.js): the header, then Details / Reviews / Related. `related`
// fills the Related tab (browse.js relatedPane); the Details pane is returned for what the caller adds to it.
export function renderApp(body, route, pkg, source, { related = null } = {}) {
  const st = pkg.stanza;
  const app = st.ipa;
  const v = app.versions[0];
  const page = el("div", "alt-app");
  if (app.tintColor) page.style.setProperty("--alt-tint", app.tintColor);

  // Header: the large glossy icon, name, developer, the App Store's stars once known, "Version · size · Free".
  const icon = el("span", "pkg-icon large alt-app-icon");
  icon.append(el("span", "pkg-letter", app.name.charAt(0).toUpperCase()));
  const i = img(app.iconURL);
  if (i) { i.onload = () => i.classList.add("loaded"); icon.append(i); }
  // F160: no iOS range from the source: what the IPA itself said, kept on this device, else asked below (once).
  const ipaStore = localStore();
  const keptInfo = needsCheck(v) ? savedInfo(ipaStore, v.downloadURL) : null;
  const fit = compat(keptInfo ? withIpaInfo(st, keptInfo) : st, currentDevice());
  const size = formatSize(v.size);
  // F194: Share sits on the header, where the App Store's install button was (the nav bar keeps Install / Modify).
  const header = storeHeader({ art: icon, name: app.name, author: app.developerName || null,
    action: headerShareButton(source ?? { key: pkg.key }, { app: true }),
    line: headerLine({ version: `${v.version}${v.buildVersion ? ` (${v.buildVersion})` : ""}`, size, price: "Free" }) });
  page.append(header.head);

  const reviewApi = getBackend().reviews ?? reviewsApi({ base: reviewsBase(detectMode()) }); // F182
  const reviewId = appBundleId(app, pkg.row?.id);
  const oursFirst = reviewApi.list(reviewId, 0).catch(() => null);
  let storeRating = null; // F161: the App Store's average and count (core/applookup.js), once looked up
  let ratingKnown;
  const ratingReady = new Promise((res) => { ratingKnown = res; });
  const tabs = storeTabs({
    // F182: reviews written here (screens/reviews.js), with the App Store's rating merged in.
    // B37: and the App Store's written reviews, asked for only when the tab opens.
    reviews: (pane) => reviewsTab(pane, { id: reviewId, version: v.version ?? "", appStore: withStoreReviews(ratingReady, looked), first: oursFirst, api: reviewApi,
      onRating: (r) => { header.setRating(r); tiles.set("rating", ratingTile(r)); } }),
    related,
  });
  const details = tabs.panes.details;
  body.replaceChildren(page, ...tabs.nodes);
  const tiles = tileRow();

  // F161: the App Store's details by bundle ID (core/applookup.js), only now that the page is open; none when the
  // source already gives screenshots, developer and the app's own page.
  const ownLinks = ownPageLinks(app, appLinks(app));
  const need = lookupNeed(app, ownLinks);
  // B37: asked whatever `need` is, for the App Store's rating and reviews (need only gates the other details).
  const looked = storeLookup(appBundleId(app, pkg.row?.id));
  const merged = looked.then((store) => mergeDetails(app, store, need));
  merged.then((m) => {
    if (m.developer && !app.developerName) header.setAuthor(m.developer); // F161: the App Store's, when the source names none
    if (m.rating != null) storeRating = { average: m.rating, count: m.ratingCount ?? null, noun: "Ratings", from: "App Store" };
    header.setRating(storeRating);
    tiles.set("rating", ratingTile(storeRating));
    if (m.category) tiles.set("section", sectionTile(m.category, "App"));
    ratingKnown(storeRating);
  }, () => ratingKnown(null));
  Promise.all([ratingReady, oursFirst]).then(([store, ours]) => { // F182: the stars count reviews written here too
    if (!ours?.count) return;
    const r = mergeReviews({ ours, appStore: store }).rating;
    header.setRating(r);
    tiles.set("rating", ratingTile(r));
  });

  // F122: the source's screenshots, or (when it lists none) its GitHub repo's README and release pictures.
  // F161: when the source lists none, the App Store's screenshots come before the GitHub ones.
  const previewKey = `app:${pkg.key}:${pkg.row?.id ?? app.bundleIdentifier}`;
  const shots = altShots(app);
  if (shots.length || need !== "full") details.append(previewSlot(previewKey, { shots, gh: appGithub(app) }));
  else { // B54: the loading strip while the App Store answers, not an empty slot swapped later
    details.append(previewSlot(previewKey, merged.then((m) => ({ shots: m.screenshots.map((url) => ({ url, from: "appstore" })), gh: appGithub(app) }))));
  }

  // F181: the sideways info tiles: Rating (once the App Store answers), Works On, Size, Section, Updated.
  tiles.set("works", worksOnTile(fit));
  tiles.set("size", sizeTile(size, "Free"));
  tiles.set("section", sectionTile(pkg.row.section, "App"));
  tiles.set("updated", updatedTile(v.date));
  details.append(tiles.row);

  if (app.localizedDescription) details.append(descriptionGroup(app.localizedDescription)); // F165
  // F161: the App Store's description, under the source's own text.
  const storeText = el("div");
  details.append(storeText);
  merged.then((m) => {
    if (!m.description) return;
    // Apple's text runs long: the first lines, and a More row that opens the rest in place (iOS 6 App Store's More).
    const short = shortText(m.description);
    const text = el("div", "pkg-description", short ?? m.description);
    const g = card([text]);
    g.prepend(el("h2", "group-header", "From the App Store"));
    if (short) {
      const more = grouped([{ rows: [{ label: "More", onClick: () => { text.textContent = m.description; more.remove(); } }] }]).querySelector("li");
      g.querySelector(".table").append(more);
    }
    storeText.replaceChildren(g);
  });

  // What's New (the newest version's notes and date) with Version History (F29: its own page, browse.js
  // renderVersions, every versions[] entry, older ones installable) under it.
  const news = whatsNewGroup({ version: v.version, date: formatDate(v.date), notes: v.localizedDescription || null,
    history: { label: "Version History", href: deeper(route, `versions:${pkg.row.id}`) } });
  if (news) details.append(news);

  // F161: Information is drawn again once the App Store's facts are in (developer, category, its version and iOS).
  // F160: and once the IPA has been read (Compatibility: what it says, and where that came from).
  const detailsBox = el("div");
  let lastStore = {};
  let lastFit = fit;
  let ipaRow = keptInfo ? ipaCompatText(withIpaInfo(v, keptInfo), keptInfo) : needsCheck(v) ? "Checking…" : null;
  const drawDetails = (m = lastStore) => {
    lastStore = m;
    const info = [];
    if (app.developerName || m.developer) info.push({ label: "Developer", detail: app.developerName || m.developer });
    info.push({ label: "Version", detail: v.version });
    if (size) info.push({ label: "Size", detail: size });
    if (v.date) info.push({ label: "Updated", detail: formatDate(v.date) });
    info.push({ label: "Category", detail: m.category || pkg.row.section });
    if (osRange(v)) info.push({ label: "Compatibility", detail: osRange(v) });
    else if (ipaRow) info.push({ label: "Compatibility", detail: ipaRow });
    if (m.version) info.push({ label: "App Store Version", detail: m.version });
    if (m.minimumOs) info.push({ label: "App Store Requires", detail: `iOS ${m.minimumOs} or later` });
    info.push({ label: "Bundle ID", detail: app.bundleIdentifier });
    detailsBox.replaceChildren(grouped([{ header: "Information", rows: info, footer: lastFit.detail }]));
  };
  drawDetails();
  details.append(detailsBox);
  merged.then(drawDetails);
  const drawFit = (f) => {
    lastFit = f;
    tiles.set("works", worksOnTile(f));
    drawDetails();
  };

  // What the app may do, listed before the install buttons (AltStore shows these before it installs).
  const perm = app.permissions;
  if (perm.privacy.length || perm.entitlements.length) {
    const rows = [
      ...perm.privacy.map((p) => ({ label: p.name, subtitle: p.description || null })),
      ...perm.entitlements.map((e) => ({ label: entitlementLabel(e.name), subtitle: e.description || e.name })),
    ];
    // The first few, then a row that opens the rest in place (user 2026-11-17), the iOS 6 table look.
    const FEW = 3;
    const footer = "What this app asks for, as its source lists it.";
    const more = rows.length - FEW;
    const toggleRow = (label, onClick, up) => {
      const li = grouped([{ rows: [{ label, onClick }] }]).querySelector("li");
      li.classList.add("perm-more");
      li.classList.toggle("up", up);
      return li;
    };
    const group = grouped([{ header: "Permissions", footer, rows: more > 1 ? rows.slice(0, FEW) : rows }]).firstElementChild;
    const ul = group.querySelector("ul");
    let extra = [];
    // Open: the rest fade in above a Show Fewer row; Show Fewer puts them away again.
    function open(toggle) {
      extra = [...grouped([{ rows: rows.slice(FEW) }]).querySelector("ul").children];
      toggle.replaceWith(...extra, toggleRow("Show Fewer", (e) => close(e.currentTarget.closest("li")), true));
      for (const li of extra) li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    }
    // The page scrolls so the row stays where it was under the finger (user 2026-11-17: no jump on Show Fewer).
    function close(toggle) {
      const scroller = toggle.closest(".page-body");
      const before = toggle.getBoundingClientRect().top;
      for (const li of extra) li.remove();
      const row = toggleRow(`${more} More Permissions`, (e) => open(e.currentTarget.closest("li")), false);
      toggle.replaceWith(row);
      if (scroller) scroller.scrollTop += row.getBoundingClientRect().top - before;
    }
    if (more > 1) ul.append(toggleRow(`${more} More Permissions`, (e) => open(e.currentTarget.closest("li")), false));
    details.append(group);
  }

  // F30: without a jailbreak (the site, the sideload build) nothing can ask the phone what it has, so tapping an
  // install row records the app on the device for the Installed tab. F88: the jailbreak app records it too, once the
  // helper's install succeeds (dpkg doesn't list IPAs); I4's real version (backend.installedApps) then corrects it.
  const record = () => {
    apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version: v.version, key: pkg.key,
      source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).catch(() => {});
  };
  const queued = detectMode() !== "jailbreak"; // the app queue (F80) and Custom Install (F84) aren't in the jailbreak build
  const { rows, options, gated } = installRows(v, app.sourceUrl, undefined, record, queued ? () => appPageAction(pkg, source) : null, app.name,
    { ...(queued ? { customize: (o) => appPageCustom(pkg, source, o) } : {}), appId: pkg.row?.id ?? st.package ?? app.bundleIdentifier,
      bundleId: appBundleId(app, pkg.row?.id) });
  details.append(grouped([{ header: "Install", rows,
    footer: gated ? SITE_GATE_FOOTER
      : options.download && ipaInstallAvailable() ? IPA_FOOTER
      : options.itms ? "Installs over the air with the source's signed link."
      : localSigning() ? "Install queues it and opens Confirm, which signs it with your own certificate (Settings > Signing) and installs it. Custom Install first lets you change its bundle ID, name, icon or extensions. Download IPA keeps the file."
      : options.download ? SITE_INSTALL_FOOTER : null }]));

  // Mark as Installed: an app installed some other way (Feather, AltStore, another device's backup) can be put on
  // the Installed list by hand, so Changes and the update checks follow it; Mark as Not Installed takes it off.
  // F88: in the jailbreak app too (an IPA installed by another tool, or before iFizBox recorded installs).
  details.append(trackingSection(app, pkg, source));
  // F210: and the same in one tap from the nav bar.
  if (markToggleApplies(app)) {
    const toggle = markToggle(app, pkg, source);
    if (!addNavIcon(body, toggle, "mark")) setTimeout(() => addNavIcon(body, toggle, "mark"), 0);
    const offMark = onAppsChange(() => { if (body.isConnected && toggle.isConnected) toggle.refresh(); else offMark(); });
  }

  if (needsCheck(v) && !keptInfo) {
    const bundleId = appBundleId(app, pkg.row?.id);
    ipaCheck(v.downloadURL, { store: ipaStore, text: [app.subtitle, app.localizedDescription, v.localizedDescription].filter(Boolean).join("\n"),
      fallback: () => (need === "none" ? storeLookup(bundleId) : looked).then((m) => m?.minimumOs ?? null) })
      .then((info) => {
        if (!body.isConnected) return;
        if (!info) { ipaRow = null; drawDetails(); return; }
        ipaRow = ipaCompatText(withIpaInfo(v, info), info);
        drawDetails();
        drawFit(compat(withIpaInfo(st, info), currentDevice()));
        catalog.setIpaInfo({ [v.downloadURL]: info }); // the rows follow (core/catalog.js setIpaInfo)
      }, () => {});
  }

  // Links (F161, after F122): this app's own page (its GitHub or website, else the App Store), then the source's page
  // in iFizBox, then the source's website when it is another page. Never two rows to one page (core/applookup.js).
  const sourceName = app.sourceName || (source ? displayName(source) : "") || app.sourceUrl;
  const sourceRow = { label: sourceName, subtitle: app.sourceUrl,
    href: route.tab === "sources" && route.path[0] === pkg.key ? null : format({ tab: "sources", path: [pkg.key] }) };
  const linksBox = el("div");
  const drawLinks = (store, sourceWebsite) => linksBox.replaceChildren(appLinksGroup(pageLinks({ ownLinks, store, source: sourceRow,
    sourceWebsite, appUrls: [app.sourceUrl] }), sourceRow));
  drawLinks(null, null);
  details.append(linksBox);
  Promise.all([looked, catalog.altSource(pkg.key).then((m) => m?.website ?? null, () => null)])
    .then(([store, site]) => drawLinks(store, site), () => {});
  details.append(grouped([{ footer: `${app.bundleIdentifier}\n${[sourceName, pkg.row.section].filter(Boolean).join(" · ")}` }]));
  return { details, tabs };
}

// F161: an app's App Store details on this device: the website asks the Worker (/api/applookup, cached at the edge),
// the app asks Apple itself; cached a week per bundle ID (core/applookup.js lookupApp). Null when it fails.
export function storeLookup(bundleId, { backend = getBackend(), fetchFn = globalThis.fetch,
  locale = globalThis.navigator?.language, store = globalThis.localStorage ?? null } = {}) {
  const get = backend.kind === "http"
    ? (id, c) => fetchFn(workerLookupUrl(id, c)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
    : (id, c) => backend.text(lookupUrl(id, c));
  return lookupApp(bundleId, { country: regionOf(locale), get, store }).catch(() => null);
}

// B37: the App Store's recent written reviews for a looked-up app: the website asks the Worker (/api/appreviews,
// cached at the edge a day), the app asks Apple itself (core/applookup.js storeReviews). [] when it fails.
export function appStoreReviews(store, { backend = getBackend(), fetchFn = globalThis.fetch, locale = globalThis.navigator?.language } = {}) {
  const id = storeTrackId(store);
  if (!id) return Promise.resolve([]);
  const get = backend.kind === "http"
    ? (t, c) => fetchFn(workerReviewsUrl(t, c)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
    : (t, c) => backend.text(reviewsFeedUrl(t, c));
  return storeReviews(id, { country: regionOf(locale), get }).catch(() => []);
}

// B37: the Reviews tab's appStore: the App Store's rating (ratingReady) with its written reviews, or null.
export function withStoreReviews(ratingReady, looked, opts = {}) {
  const list = Promise.resolve(looked).then((s) => (s ? appStoreReviews(s, opts) : []), () => []);
  return Promise.all([Promise.resolve(ratingReady).catch(() => null), list])
    .then(([r, reviews]) => (r || reviews.length ? { ...(r ?? {}), reviews } : null));
}

// F160: localStorage, or null where it's blocked.
function localStore() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// F160: read an IPA's Info.plist through the Worker's /api/ipainfo (core/ipainfo.js checkIpa): the website asks its
// own origin, the app asks PUBLIC_SITE (the Worker answers any origin). The answer's JSON, error codes included.
export function ipaCheck(url, { backend = getBackend(), fetchFn = globalThis.fetch, store = null, text = "", fallback = null } = {}) {
  const get = (u) => fetchFn(ipaInfoUrl(u, backend.kind === "http" ? "" : PUBLIC_SITE)).then((r) => r.json());
  return checkIpa(url, { get, store, text, fallback }).catch(() => null);
}

// F160: the Details row for a range the IPA (or a fallback) gave: "iOS 15.0 or later (from the app)", "iPad only".
function ipaCompatText(v, info) {
  const where = { ipa: "from the app", appstore: "App Store", text: "from its description" }[info.from];
  const fam = Array.isArray(info.deviceFamily) && info.deviceFamily.length && !info.deviceFamily.includes(1) ? "iPad only" : null;
  const range = osRange(v);
  if (!range && !fam) return "Not known";
  return [fam, range].filter(Boolean).join(", ") + (where && range ? ` (${where})` : "");
}

// F161: core/applookup.js pageLinks' rows as the Links group: a link row opens out, the source row opens its page.
function appLinksGroup(links, sourceRow) {
  const rows = links.map((l) => (l.kind === "source" ? { ...sourceRow, chevron: true }
    : { label: l.label, subtitle: l.detail || l.url, onClick: () => openOut(l.url), chevron: true }));
  const g = grouped([{ header: "Links", rows }]);
  g.firstElementChild?.classList.add("links-group");
  return g;
}

// ---- Links and the screenshots gallery (F122), shared with browse.js's package pages ---------------------------

// A link out opens in its own app or Safari (app.js's window.open in the Home Screen app, LinkOut in the shell).
const openOut = (url) => window.open(url, "_blank", "noopener");

// The Links group: `source` (a row opening the source's page, or null) and core/previews.js's links, in that order.
export function linksGroup(source, links) {
  const rows = [];
  if (source) rows.push({ ...source, chevron: true });
  for (const l of links) rows.push({ label: l.label, subtitle: l.detail || l.url, onClick: () => openOut(l.url), chevron: true });
  const g = grouped([{ header: "Links", rows }]);
  g.firstElementChild?.classList.add("links-group");
  return g;
}

// One picture of the gallery: sized by the source's width/height or, failing that, the picture's own; an https
// picture its host won't serve to us (hotlink rules) tries once more through the site's proxy.
// B54: it loads off the page (eager: a lazy picture outside the document never loads) and `i.ready` settles true
// once it has loaded and decoded, false when it failed for good or was an icon: only ready ones go on the page.
export function galleryImage(s, { backend = getBackend } = {}) {
  const src = mediaUrl(s.url);
  if (!src) return null;
  const i = el("img", "alt-shot");
  i.alt = "";
  i.decoding = "async";
  i.loading = "eager";
  i.referrerPolicy = "no-referrer";
  let settle;
  i.ready = new Promise((r) => { settle = r; });
  const ratio = (w, h) => {
    i.style.aspectRatio = `${w} / ${h}`;
    i.classList.toggle("wide", w > h);
  };
  if (s.width && s.height) ratio(s.width, s.height);
  i.onload = () => {
    if (i.naturalWidth && i.naturalWidth < 120 && i.naturalHeight < 120) { settle(false); return gone(i); } // an icon after all
    if (!(s.width && s.height) && i.naturalWidth && i.naturalHeight) ratio(i.naturalWidth, i.naturalHeight);
    const d = typeof i.decode === "function" ? i.decode() : null;
    if (d && typeof d.then === "function") d.then(() => settle(true), () => { settle(false); gone(i); });
    else settle(true);
  };
  let retried = false;
  i.onerror = () => {
    const b = backend();
    if (!retried && b.kind === "http" && b.assetUrl && /^https:/i.test(s.url)) { retried = true; i.src = b.assetUrl(s.url); return; }
    settle(false);
    gone(i);
  };
  i.src = src;
  return i;
}

function gone(i) {
  const group = i.closest(".shots-group");
  i.remove();
  if (group && !group.querySelector(".alt-shot")) group.remove();
}

// F181: the strip scrolls sideways, snapping one picture at a time, with page dots under it (one per picture; the
// one in view dark) and a tap on a picture zooms it to the full screen.
// B54: `pics0` are pictures already loaded (galleryImage's ready).
function galleryGroup(pics0) {
  const strip = el("div", "alt-shots");
  strip.append(...pics0);
  if (!strip.childElementCount) return null;
  const g = el("div", "group shots-group");
  const dots = el("div", "shot-dots");
  dots.setAttribute("aria-hidden", "true");
  g.append(el("h2", "group-header", "Screenshots"), strip, dots);
  const pics = () => [...strip.querySelectorAll(".alt-shot")];
  const drawDots = () => {
    const n = pics().length;
    if (dots.childElementCount !== n) dots.replaceChildren(...Array.from({ length: n }, () => el("span", "shot-dot")));
    dots.hidden = n < 2;
    markDot();
  };
  // The picture whose left edge is nearest the strip's: transform/opacity aren't touched, only a class on a 7px dot.
  let frame = 0;
  const markDot = () => {
    frame = 0;
    const list = pics();
    const x = strip.scrollLeft;
    let at = 0;
    list.forEach((p, i) => { if (Math.abs(p.offsetLeft - strip.offsetLeft - x) < Math.abs(list[at].offsetLeft - strip.offsetLeft - x)) at = i; });
    if (strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2) at = list.length - 1; // the last one, at the end
    [...dots.children].forEach((d, i) => d.classList.toggle("on", i === at));
  };
  strip.addEventListener("scroll", () => { if (!frame && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(markDot); }, { passive: true });
  strip.addEventListener("click", (e) => {
    const pic = e.target?.closest?.(".alt-shot");
    if (pic) zoomShots(pics(), pics().indexOf(pic));
  });
  // Pictures that fail drop out (gone()): the dots follow.
  if (typeof MutationObserver === "function") new MutationObserver(drawDots).observe(strip, { childList: true });
  drawDots();
  return g;
}

// F181: tap-to-zoom. A black full-screen layer with the pictures at full size, sideways and snapping like the strip,
// opened on the one tapped: it grows out of the thumbnail (transform from its box) and fades in; a tap closes it the
// same way back. Transform and opacity only (120 Hz).
export function zoomShots(list, index = 0) {
  if (!list.length || typeof document === "undefined" || !document.body) return null;
  const layer = el("div", "shot-zoom");
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-label", "Screenshots");
  const track = el("div", "shot-zoom-track");
  for (const p of list) {
    const page = el("div", "shot-zoom-page");
    const big = el("img", "shot-zoom-img");
    big.alt = "";
    big.decoding = "async";
    big.referrerPolicy = "no-referrer";
    big.src = p.currentSrc || p.src;
    page.append(big);
    track.append(page);
  }
  layer.append(track);
  document.body.append(layer);
  track.scrollLeft = index * track.clientWidth;
  const from = list[index]?.getBoundingClientRect?.();
  const to = track.children[index]?.firstElementChild?.getBoundingClientRect?.();
  const grow = from && to && to.width ? [
    { transform: `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width})` },
    { transform: "none" }] : [{ transform: "scale(.9)" }, { transform: "none" }];
  const img = track.children[index]?.firstElementChild;
  const ease = { duration: 300, easing: "cubic-bezier(.25,.1,.25,1)" };
  layer.animate?.([{ opacity: 0 }, { opacity: 1 }], ease);
  img?.animate?.(grow, ease);
  const close = () => {
    layer.removeEventListener("click", close);
    const fade = layer.animate?.([{ opacity: 1 }, { opacity: 0 }], { ...ease, fill: "forwards" });
    if (fade) fade.onfinish = () => layer.remove(); else layer.remove();
  };
  layer.addEventListener("click", close);
  return { layer, close };
}

// Text for core/previews.js: GitHub's raw and API hosts answer with CORS, so on the site the browser asks them
// itself (its own rate limit, not the proxy's shared one) and goes through the proxy only when that fails to connect.
export function previewText(url, { backend = getBackend(), fetchFn = globalThis.fetch } = {}) {
  if (backend.kind === "http" && fetchFn && /^https:\/\/(raw\.githubusercontent\.com|api\.github\.com)\//.test(url)) {
    return fetchFn(url, { headers: /api\.github/.test(url) ? { Accept: "application/vnd.github+json" } : {} }).then(
      (r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))),
      () => backend.text(url));
  }
  return backend.text(url);
}

// The gallery's place on a page, filled once the pictures are known (at once for a source's own; after a fetch for
// a depiction page's or a GitHub repo's, cached per app by core/previews.js).
// B54: it starts as a short loading strip (iOS 6's grey spinner, 44px: altstore.css .shots-loading) and never shows
// a blank picture frame: only pictures that loaded and decoded go in. Once the first is ready and the rest have
// settled (or settleMs passed), the slot grows once to the gallery's height (one height transition on the slot) and
// the gallery fades in; a picture that loads later joins the strip sideways. When none load the strip shrinks to
// nothing. `sources` may be a promise of them (an app page waiting for the App Store's screenshots), or null.
// slot.gallery settles when every picture has: { shown, grows } (pictures on the page, height changes made).
export function previewSlot(key, sources, { load = loadPreviews, text = previewText, image = galleryImage, settleMs = 1200 } = {}) {
  const slot = el("div", "preview-slot");
  const pending = typeof sources?.then === "function";
  if (!pending && !sources?.shots?.length && !sources?.html && !sources?.gh) {
    slot.gallery = Promise.resolve({ shown: 0, grows: 0 });
    return slot; // nothing to look in: no strip at all
  }
  const spin = el("div", "shots-loading");
  spin.setAttribute("role", "progressbar");
  spin.setAttribute("aria-label", "Loading Screenshots");
  spin.append(el("span", "shots-spinner"));
  slot.classList.add("shots-pending");
  slot.append(spin);
  const shots = pending
    ? Promise.resolve(sources).then((s) => (s ? load(key, s, { text: (u) => text(u) }) : []))
    : sources.shots?.length ? Promise.resolve(dedupeShots(sources.shots)) : load(key, sources, { text: (u) => text(u) });
  slot.gallery = shots.catch(() => []).then((list) => fillGallery(slot, list ?? [], { image, settleMs }));
  return slot;
}

// B54: make the pictures off the page, put in only the ready ones, grow (or collapse) the slot. -> { shown, grows }
function fillGallery(slot, shots, { image, settleMs }) {
  const pics = shots.map((s) => image(s)).filter(Boolean);
  const ready = new Set();
  let group = null;
  let strip = null;
  let grows = 0;
  let timer = null;
  const resize = (change) => { if (resizeSlot(slot, change)) grows++; };
  const show = () => {
    if (group || !ready.size) return;
    clearTimeout(timer);
    group = galleryGroup(pics.filter((p) => ready.has(p)));
    strip = group.querySelector(".alt-shots");
    resize(() => { slot.classList.remove("shots-pending"); slot.replaceChildren(group); });
    fadeIn(group);
  };
  const join = (p) => { // a late one: into its place in the strip, faded in; the slot follows if the strip got taller
    const next = pics.slice(pics.indexOf(p) + 1).find((q) => q.parentNode === strip);
    resize(() => strip.insertBefore(p, next ?? null));
    fadeIn(p);
  };
  return new Promise((resolve) => {
    let left = pics.length;
    const settled = () => {
      if (--left > 0) return;
      if (group) return resolve({ shown: ready.size, grows });
      if (ready.size) show();
      else resize(() => { slot.classList.remove("shots-pending"); slot.replaceChildren(); });
      resolve({ shown: ready.size, grows });
    };
    if (!left) { left = 1; settled(); return; }
    for (const p of pics) {
      Promise.resolve(p.ready ?? true).then((ok) => {
        if (ok) {
          ready.add(p);
          if (group) join(p);
          else if (!timer) timer = setTimeout(show, settleMs); // the first is in: wait a little for the rest
        }
        settled();
      });
    }
  });
}

// B54: change what's in the slot and move its height from the old to the new in one transition (altstore.css
// .preview-slot), so the page below slides once instead of jumping. -> whether the height changed.
function resizeSlot(slot, change) {
  const from = slot.offsetHeight || 0;
  slot.endResize?.(); // one still running: measure the new height from the content, not its fixed one
  change();
  const to = slot.offsetHeight || 0;
  if (from === to) return false;
  if (typeof requestAnimationFrame !== "function" || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return true;
  slot.style.height = `${from}px`;
  void slot.offsetHeight; // start from the old height
  slot.classList.add("resizing");
  slot.style.height = `${to}px`;
  let timer = 0;
  const end = (e) => {
    if (e && e.target !== slot) return;
    slot.removeEventListener("transitionend", end);
    clearTimeout(timer);
    slot.classList.remove("resizing");
    slot.style.height = "";
    slot.endResize = null;
  };
  slot.endResize = end;
  slot.addEventListener("transitionend", end);
  timer = setTimeout(end, 500);
  return true;
}

function fadeIn(node) {
  node.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
}

// ---- F213: a list row's swipe and hold menu queue an app in the sideload build -------------------------------------
// The job the app page's Install would queue (appPageAction: appJob with the installed record from the apps store),
// for browse.js's row swipe and hold menu. -> { job, installed, newest } (job null: nothing to sign here: no IPA, a
// source-signed link), or null when it isn't an app or this isn't the sideload build (F89: the website queues nothing).
export async function rowAppJob(pkg, source, { store = apps, mode = detectMode() } = {}) {
  const app = pkg?.stanza?.ipa;
  if (mode !== "sideload" || !app) return null;
  let rec = null;
  try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
  const installed = rec ? rec.version || "" : null;
  const job = appJob(pkg, { installed: rec ? rec.version || null : null, source: source ? displayName(source) : null });
  return { job, installed, newest: app.versions?.[0]?.version ?? null };
}
