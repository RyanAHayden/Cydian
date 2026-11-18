// Repo extras Sileo users expect (F20), as pieces the screens drop in:
//
//   featuredStrip(source)       the source page's banners (sileo-featured.json), filled in when they land
//   homeFeatured()              Home's banners (Browse's in the jailbreak app): a couple from each source,
//                               placeholder cards while they load (F135)
//   paymentGroup(st, source)    a paid package's Price row; in the app Sign In / Buy / Download & Install
//   paidStateOf(box)            B11: what the package page's nav bar button does for that paid package
//   discoveryGroup()            Search's "Other Sources" list (Canister), with Add Source; .search(q). In the
//                               jailbreak app Add Source & Install (F99): add, refresh it, open the page, queue
//
// Logic lives in core/featured.js, core/payment.js and core/canister.js; this file is DOM and transport only.
//
// The app's vendor calls need the shell (vendors send no CORS headers, and the spec wants the payment secret in the
// Keychain). It asks the shell for these methods and says "needs a newer iFizBox" when a shell doesn't have them:
//   net.request { method, url, headers, body }  -> { status, headers, body }  body base64, like net.fetch
//   device.info                                 -> { udid, model }
//   keychain.get { key } / keychain.set { key, value } / keychain.remove { key }  (passcode / Face ID protected)
//   auth.session { url, callbackScheme }        -> the callback URL (ASWebAuthenticationSession; "sileo" here)
//   paid.install { url, package, version, stream } -> { code, stdout, stderr }  download the one-time URL, dpkg it;
//                                                 streamed into the install queue's console (F74), dpkg status read
//                                                 again after, and the package page drawn again so it shows Installed
// The site never calls a vendor: it shows Canister's price and links to the vendor's page.
import { getBackend, getArch } from "../backend.js";
import { format, parse } from "../router.js";
import { grouped, el } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { mediaUrl } from "./depiction.js";
import { settings } from "./settings.js";
import { runPaidInstall } from "./queue.js";
import { createFeaturedStore, MAX_BANNERS } from "../core/featured.js";
import { createCanister, mapResults, priceFor, normalRepo, askable } from "../core/canister.js";
import {
  isCommercial, paymentEndpointUrl, parseEndpoint, createPaymentClient, createCredentialStore, isFreePrice,
} from "../core/payment.js";
import { NAME } from "../brand.js";

const pkgHref = (key, id) => format({ tab: "sources", path: [key, `package:${id}`] });

// ---- featured banners -------------------------------------------------------------------------------------

let featured = null;
const featuredStore = () => (featured ??= createFeaturedStore({ getText: (u) => getBackend().text(u) }));

// A horizontal row of banners, scroll-snapped one per page like Sileo's. Sizes and corner radius from the repo.
function bannerRow(banners, { itemSize = { width: 263, height: 148 }, radius = 10 } = {}) {
  const row = el("div", "featured-row");
  row.style.setProperty("--banner-ratio", `${itemSize.width} / ${itemSize.height}`);
  row.style.setProperty("--banner-radius", `${radius}px`);
  for (const b of banners) {
    const a = el("a", "featured-banner");
    a.href = pkgHref(b.key, b.package);
    a.setAttribute("aria-label", b.title);
    const src = mediaUrl(b.url);
    if (src) {
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.onload = () => img.classList.add("loaded");
      img.onerror = () => img.remove();
      img.src = src;
      a.append(img);
    }
    if (b.displayText) {
      const t = el("span", "featured-title", b.title);
      if (b.hideShadow) t.classList.add("no-shadow");
      a.append(t);
    }
    row.append(a);
  }
  return row;
}

// The source page: nothing until the file lands (most repos have none), then the strip.
export function featuredStrip(source) {
  const box = el("div", "featured-box");
  if (!source || source.kind === "altstore") return box;
  featuredStore().get(source).then((f) => {
    if (!f?.banners.length || !box.isConnected && box.parentNode == null) return;
    box.append(bannerRow(f.banners.map((b) => ({ ...b, key: source.key })), f));
  }, () => {});
  return box;
}

// F135: the scroller while its banners load: grey cards the banners' size, pulsing like nav/ui.js placeholder()'s bars.
export const FEATURED_PLACEHOLDERS = 2; // one whole card and the next one peeking in, as the banners sit
export function featuredPlaceholder(n = FEATURED_PLACEHOLDERS) {
  const row = el("div", "featured-row featured-ph");
  row.setAttribute("aria-busy", "true");
  row.setAttribute("aria-label", "Loading");
  for (let i = 0; i < n; i++) row.append(el("span", "featured-banner ph-box"));
  return row;
}

// Home's banners (Browse's in the jailbreak app, F135): placeholder cards until they land, then the banners, or
// nothing when the sources have none. `deviceType`, `sources` and `forHome` are for the tests.
export function homeFeatured({ deviceType = () => settings.deviceType(), sources = () => getBackend().sources(),
  forHome = (list) => featuredStore().forHome(list) } = {}) {
  const box = el("div", "featured-box home-featured");
  box.ready = Promise.resolve(); // F82: settles once the banners are drawn (or there are none), for Home's Reload
  if (deviceType() === "none") return box; // Not Jailbroken: APT sources (and their tweaks) are hidden
  box.append(featuredPlaceholder());
  box.ready = Promise.resolve().then(sources).then(forHome).then((banners) => {
    box.replaceChildren(...(banners?.length ? [bannerRow(banners)] : []));
  }, () => { box.replaceChildren(); });
  return box;
}

// F124, Browse's Featured list: every banner of every APT source (in source order, round-robin like Home's), as
// [{ key, id }] for catalog.featured. None while Not Jailbroken: APT sources are hidden then.
export async function featuredRefs() {
  if (settings.deviceType() === "none") return [];
  const list = await getBackend().sources();
  const banners = await featuredStore().forHome(list, MAX_BANNERS, MAX_BANNERS * 50);
  return banners.map((b) => ({ key: b.key, id: b.package }));
}

// ---- Canister discovery (Search) ---------------------------------------------------------------------------

let canister = null;
const canisterApi = () => (canister ??= createCanister({ getJson: async (u) => JSON.parse(await getBackend().text(u)) }));

// Search's "Other Sources" group: packages from sources the user hasn't added. `.search(q)` redraws it; a newer
// call wins. Failures stay quiet (one footer line): Canister is an extra, local search is the main thing.
export function discoveryGroup(ctx) {
  const box = el("div", "discovery");
  let seq = 0;
  async function search(q) {
    const turn = ++seq;
    box.replaceChildren();
    // 2+ characters, even CJK: Canister finds nothing for one character (F106, core/canister.js askable()).
    if (!askable(q)) return;
    // Local results come every 120 ms of typing; Canister only once typing has stopped a moment.
    await new Promise((r) => setTimeout(r, 450));
    if (turn !== seq) return;
    let json, have;
    try {
      [json, have] = await Promise.all([canisterApi().search(q), getBackend().sources().catch(() => [])]);
    } catch (e) {
      if (turn === seq) box.replaceChildren(grouped([{ footer: `Other sources: ${e.message}` }]));
      return;
    }
    if (turn !== seq || !json) return;
    const rows = mapResults(json, { have, arch: getArch() }).filter((r) => !r.repo.added).slice(0, 25);
    if (!rows.length) return;
    box.replaceChildren(grouped([{
      header: "Other Sources",
      rows: rows.map((r) => ({
        label: r.name,
        subtitle: [r.repo.name, r.description].filter(Boolean).join(" · "),
        detail: r.price ?? (r.archOk ? null : "Other device"),
        icon: { text: r.name.charAt(0).toUpperCase() },
        onClick: () => offer(r, ctx),
      })),
      footer: "From sources you haven't added, found by Canister (canister.me). Add the source to install.",
    }]));
  }
  return { el: box, search };
}

// The alert's buttons for a Canister row. F99: where the backend can queue (the jailbreak app), a flat source's
// row offers Add Source & Install (Sileo's provisional Get) instead of Add Source; the site and the sideload build
// keep Add Source.
export function offerButtons(r, { canQueue = false } = {}) {
  const buttons = ["Cancel"];
  if (r.repo.flat) buttons.push(canQueue ? "Add Source & Install" : "Add Source");
  if (r.depiction) buttons.push("Depiction");
  return buttons;
}

const canQueue = (b) => typeof b?.queue === "function";

async function offer(r, ctx) {
  const backend = getBackend();
  const buttons = offerButtons(r, { canQueue: canQueue(backend) });
  const lines = [`${r.version}${r.author ? ` · ${r.author}` : ""}`, r.repo.uri];
  if (!r.repo.flat) lines.push(`This source uses suite "${r.repo.dist}": add it from Sources > Edit.`);
  if (!r.archOk) lines.push(`Built for ${r.arch}, not this device.`);
  const { index } = await showAlert({ title: r.name, message: lines.join("\n"), buttons, cancel: 0 });
  const pick = buttons[index];
  if (pick === "Depiction") window.open(r.depiction, "_blank", "noopener");
  if (pick === "Add Source & Install") {
    const { catalog } = await import("../catalog.js"); // late: catalog.js pulls in the parse worker
    await addSourceAndInstall(r, {
      backend, catalog, showHUD: ctx?.showHUD ?? showHUD, showAlert,
      go: (href) => { location.hash = href.replace(/^#/, ""); },
    });
    return;
  }
  if (pick !== "Add Source") return;
  const hide = (ctx?.showHUD ?? showHUD)("Verifying URL");
  let error = null;
  try { await backend.addSource(r.repo.uri); } catch (e) { error = e; } finally { hide(); }
  if (error) await showAlert({ title: error.title || "Verification Error", message: error.message, buttons: ["OK"] });
  else await showAlert({ title: "Source Added", message: `${r.repo.name} is in your sources. Refresh Sources to list ${r.name}.`, buttons: ["OK"] });
}

// F99: Add Source & Install. Verify and add the source (the "Verifying URL" HUD), refresh that one source and load
// it into the catalog ("Reloading Data"), then open the package page and queue the package, which brings up
// Confirm as usual. When the refreshed source doesn't list it (Canister's data is stale, or the package isn't
// built for this device), an alert says so and the source stays added. Every outside call comes in `deps`
// ({ backend, catalog, showHUD, showAlert, go }), so the steps can be tested without a page.
// Resolves to what happened: "error" | "missing" | "queued" | "paid" (B19).
// B19: a paid package the source's vendor sells (`sold`, soldByVendor) is not queued (apt can't fetch it): its page
// opens on the Purchase group and nav bar price (B11), and the answer is "paid".
export async function addSourceAndInstall(r, { backend, catalog, showHUD: hud, showAlert: alert, go, sold = soldByVendor }) {
  let hide = hud("Verifying URL");
  let added;
  try {
    added = await backend.addSource(r.repo.uri);
  } catch (e) {
    hide();
    await alert({ title: e.title || "Verification Error", message: e.message, buttons: ["OK"] });
    return "error";
  }
  hide();
  hide = hud("Reloading Data");
  let key = added?.key ?? null, pkg = null;
  try {
    if (!key) {
      const want = normalRepo(r.repo.uri);
      key = (await backend.sources()).find((s) => normalRepo(s.uri) === want)?.key ?? null;
    }
    const only = (s) => s.key === key;
    await backend.refreshSources(() => {}, { filter: only });
    await catalog.ensure();
    pkg = key ? await catalog.package(r.id, key) : null;
  } catch (e) {
    hide();
    await alert({ title: "Error", message: `${r.repo.name} was added, but refreshing it failed: ${e.message}`, buttons: ["OK"] });
    return "error";
  }
  hide();
  if (!pkg || pkg.installedOnly || (pkg.key && pkg.key !== key)) {
    await alert({ title: "Not Found",
      message: `${r.repo.name} was added, but it doesn't list ${r.name} for this device. Canister's copy may be out of date.`,
      buttons: ["OK"] });
    return "missing";
  }
  go(pkgHref(key, r.id));
  if (await Promise.resolve().then(() => sold(pkg.stanza, { key, uri: added?.uri || r.repo.uri })).catch(() => false)) return "paid";
  backend.queue({ op: "install", id: r.id, version: pkg.stanza?.version ?? r.version, name: pkg.row?.name || pkg.stanza?.name || r.name });
  return "queued";
}

// ---- paid packages ---------------------------------------------------------------------------------------

const native = () => globalThis.cydianNative?.call ? globalThis.cydianNative : null;

class NeedsShell extends Error {
  constructor(method) {
    super(`This needs a newer ${NAME} app (the shell has no ${method} yet).`);
    this.name = "NeedsShell";
  }
}

async function shell(method, params, onEvent) {
  const n = native();
  if (!n) throw new NeedsShell(method);
  try {
    return await (onEvent ? n.call(method, params, onEvent) : n.call(method, params));
  } catch (e) {
    if (/unknown method/.test(e?.message ?? "")) throw new NeedsShell(method);
    throw e;
  }
}

function fromBase64(b64) {
  const bin = atob(b64 || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(out);
}

async function shellRequest({ method, url, headers, body }) {
  const r = await shell("net.request", { method, url, headers, body });
  let json = null;
  try { json = JSON.parse(fromBase64(r.body)); } catch { json = null; }
  return { status: r.status, json };
}

const keychain = {
  get: (key) => shell("keychain.get", { key }),
  set: (key, value) => shell("keychain.set", { key, value }),
  remove: (key) => shell("keychain.remove", { key }),
};

const endpoints = new Map(); // source key -> Promise<vendor base | null>
function vendorOf(source) {
  const url = paymentEndpointUrl(source);
  if (!url) return Promise.resolve(null);
  if (!endpoints.has(source.key)) {
    endpoints.set(source.key, getBackend().text(url).then(parseEndpoint, () => null));
  }
  return endpoints.get(source.key);
}

const clients = new Map();
function clientFor(base) {
  if (!clients.has(base)) {
    clients.set(base, createPaymentClient({
      base,
      request: shellRequest,
      device: () => shell("device.info"),
      credentials: createCredentialStore({ secure: keychain }),
    }));
  }
  return clients.get(base);
}

let canisterPrice = null;
async function sitePrice(st, source) {
  canisterPrice ??= canisterApi();
  return priceFor(await canisterPrice.lookup(st.package), source.uri, source.name || source.origin || null);
}

const vendorPage = (st, base) => {
  for (const u of [st.depiction, st.homepage]) if (/^https?:\/\//i.test(String(u ?? "").trim())) return String(u).trim();
  return new URL(base).origin + "/";
};

// The package page's purchase group, for packages tagged cydia::commercial on a source with a payment_endpoint.
// Empty (and stays empty) otherwise.
// B11: in the app, `onState(state)` hears what the nav bar button should do whenever the group is drawn (paidNav's
// shape, or null when the source has no vendor after all); paidStateOf(box) answers the latest one.
export function paymentGroup(st, source, ctx, { onState = null } = {}) {
  const box = el("div", "payment-box");
  if (!isCommercial(st) || !source) return box;
  const draw = (sections) => { box.replaceChildren(grouped(sections)); };
  const app = getBackend().kind === "native";
  const publish = app ? trackPaidState(box, onState) : () => {};
  (async () => {
    const base = await vendorOf(source);
    if (!base || !box.isConnected && box.parentNode == null) return publish(null);
    if (!app) return drawSite(st, source, base, draw);
    return drawApp(st, source, base, draw, ctx, box, publish);
  })().catch((e) => {
    draw([{ header: "Purchase", footer: e.message }]);
    publish(paidNav(null, false, { note: e.message }));
  });
  return box;
}

// ---- B11: the nav bar button of a paid package ------------------------------------------------------------
//
// Plain apt can't fetch a paid deb (Havoc answers apt with 418; it comes only through paid.install after the
// vendor authorizes it), so queuing one can only fail. The nav bar button does the Purchase group's next step
// instead: Cydia showed the price there until the package was bought, then Install.

const paidStates = new WeakMap(); // payment box -> { current, ready: Promise, resolve }

function trackPaidState(box, onState) {
  let resolve;
  const entry = { current: undefined, ready: new Promise((r) => { resolve = r; }) };
  entry.resolve = resolve;
  paidStates.set(box, entry);
  return (state) => {
    entry.current = state;
    entry.resolve(state);
    onState?.(state);
  };
}

// The state the nav bar button acts on: null when the box isn't a vendor's paid package in the app (the button
// then works as for any package); waits for the vendor's first answer.
export function paidStateOf(box) {
  const entry = box && paidStates.get(box);
  if (!entry) return Promise.resolve(null);
  return entry.current !== undefined ? Promise.resolve(entry.current) : entry.ready;
}

// From the vendor's package info: the button's label, and the actions its sheet offers (the Purchase group's own
// row: Sign In, Buy, or Download & Install), `install` set only once the vendor lets this account download it.
// `info` null: the vendor couldn't be asked; nothing to offer, and `note` says why.
export function paidNav(info, signedIn, { vendorName = "the vendor", signIn = null, buy = null, install = null,
  signInLabel = null, note = null } = {}) {
  const price = info?.price ?? null;
  const priced = price && !isFreePrice(price);
  if (!info) return { label: "Install", purchased: false, install: null, actions: [], note: note ?? null };
  if (!info.available) return { label: priced ? price : "Install", purchased: false, install: null, actions: [],
    note: `Not available to buy from ${vendorName}.` };
  if (!signedIn) return { label: priced ? price : "Install", purchased: false, install: null,
    actions: signIn ? [{ label: signInLabel || `Sign In to ${vendorName}`, run: signIn }] : [], note: `Sold by ${vendorName}. Sign in to buy or install it.` };
  if (!info.purchased) return { label: priced ? price : "Install", purchased: false, install: null,
    actions: buy ? [{ label: buyLabel(price), run: buy }] : [], note: `Sold by ${vendorName}.` };
  return { label: "Install", purchased: true, install,
    actions: install ? [{ label: "Download & Install", run: install }] : [], note: null };
}

const buyLabel = (price) => `Buy${price ? ` for ${isFreePrice(price) ? "Free" : price}` : ""}`;

async function drawSite(st, source, base, draw) {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const link = { label: `Buy from ${host}`, href: vendorPage(st, base), chevron: true };
  draw([{ header: "Purchase", rows: [{ label: "Price", detail: "…" }, link] }]);
  markExternal();
  const price = await sitePrice(st, source).catch(() => null);
  const rows = [{ label: "Price", detail: price ?? "Paid" }, link];
  draw([{ header: "Purchase", rows,
    footer: "Paid through the source's vendor. Buy there, then install with a package manager on the phone." }]);
  // A real link that leaves the site: open it in a new tab.
  markExternal();
}

function markExternal() {
  for (const box of document.querySelectorAll(".payment-box")) {
    for (const a of box.querySelectorAll("a.cell-inner[href^='http']")) { a.target = "_blank"; a.rel = "noopener"; }
  }
}

// B12: what a busy row's job answers when the user closed the vendor's sheet: no alert, and nothing to draw again.
export const CANCELLED = Symbol("cancelled");

// A Purchase row's action: the HUD while the job runs, then the page drawn again; an error goes to `fail` (the
// Purchase alert). A job that answers CANCELLED just takes the HUD down and leaves the page as it was (Sileo does).
export function busyAction(label, job, { hud, fail, refresh }) {
  return async () => {
    const hide = hud(label);
    let r;
    try { r = await job(); } catch (e) { hide(); await fail(e); return; }
    hide();
    if (r !== CANCELLED) refresh();
  };
}

// Sign In: the vendor's page in ASWebAuthenticationSession. auth.session answers null when the user tapped Cancel
// (Paid.swift, canceledLogin): CANCELLED, silently. A callback finishSignIn can't read is still an error.
export async function vendorSignIn(client, call = shell) {
  const cb = await call("auth.session", { url: await client.authenticateUrl(), callbackScheme: "sileo" });
  if (cb == null) return CANCELLED;
  if (!(await client.finishSignIn(cb))) throw new Error(`The vendor sent nothing back that ${NAME} could read.`);
}

// B13: the Price row's detail. "Free" for a package the vendor gives away (Chariz answers purchased: true for those
// even signed out), "Purchased" only for a signed-in account that owns it, else the vendor's price (or "Paid").
export function priceDetail(info, signedIn) {
  if (isFreePrice(info?.price)) return "Free";
  if (signedIn && info?.purchased) return "Purchased";
  return info?.price ?? "Paid";
}

async function drawApp(st, source, base, draw, ctx, box, publish = () => {}) {
  const client = clientFor(base);
  const id = st.package;
  const refresh = () => drawApp(st, source, base, draw, ctx, box, publish);
  const fail = async (e) => {
    const buttons = e.recoveryUrl ? ["OK", "More Info"] : ["OK"];
    const { index } = await showAlert({ title: "Purchase", message: e.message, buttons });
    if (index === 1) window.open(e.recoveryUrl, "_blank", "noopener");
    if (e.invalidate) refresh();
  };
  const busy = (label, job) => busyAction(label, job, { hud: ctx?.showHUD ?? showHUD, fail, refresh });
  let info = null, vendor = null, signedIn = false;
  try {
    [vendor, signedIn] = await Promise.all([client.info().catch(() => null), client.signedIn()]);
    info = await client.packageInfo(id);
  } catch (e) {
    publish(paidNav(null, false, { note: e.message }));
    if (e instanceof NeedsShell) return draw([{ header: "Purchase", rows: [{ label: "Price", detail: "Paid" }], footer: e.message }]);
    return draw([{ header: "Purchase", footer: e.message }]);
  }
  const name = vendor?.name || new URL(base).hostname;
  const rows = [{ label: "Price", detail: priceDetail(info, signedIn) }];
  const signIn = busy("Signing In", () => vendorSignIn(client));
  const buy = busy("Purchasing", async () => {
    const r = await client.purchase(id);
    if (r.status === "action") await shell("auth.session", { url: r.url, callbackScheme: "sileo" });
    else if (r.status !== "done") throw new Error("The purchase did not go through.");
  });
  const install = () => downloadAndInstall(st, source, client, box, ctx, fail);
  // B11: the nav bar button offers the same step as the row below (paidNav), so both stay in step.
  const nav = paidNav(info, signedIn, { vendorName: name, signIn, buy, install, signInLabel: vendor?.banner?.button || null });
  if (!info.available) rows.push({ label: "Not available to buy" });
  for (const a of nav.actions) rows.push({ label: a.label, onClick: a.run });
  if (signedIn) rows.push({ label: `Sign Out of ${name}`, onClick: busy("Signing Out", () => client.signOut()) });
  draw([{ header: "Purchase", rows, footer: vendor?.banner && !signedIn ? vendor.banner.message : `Sold by ${name}.` }]);
  publish(nav);
}

// B11: true when `st` is a paid package on a source whose vendor sells it (payment_endpoint): apt can't fetch it.
export async function soldByVendor(st, source) {
  if (!isCommercial(st) || !source) return false;
  return (await vendorOf(source).catch(() => null)) != null;
}

// B19: the ids among catalog rows (`paid`: tagged cydia::commercial; `key`: their source) that the source's vendor
// sells (payment_endpoint), which apt can't fetch: Changes' Upgrade (N) leaves them out (their pages offer Download
// & Install). `sources`: the backend's list; `sells(source)` -> whether it has a vendor. Failures count as not sold.
export async function vendorSoldIds(rows = [], sources = [], { sells = (s) => vendorOf(s).then((b) => b != null, () => false) } = {}) {
  const byKey = new Map((sources ?? []).map((s) => [s?.key, s]));
  const out = new Set();
  await Promise.all((rows ?? []).filter((r) => r?.id && r.paid && byKey.has(r.key)).map(async (r) => {
    if (await Promise.resolve().then(() => sells(byKey.get(r.key))).catch(() => false)) out.add(r.id);
  }));
  return out;
}

// F74: authorize (under a HUD: the vendor can refuse), then paid.install in the install queue's console, streamed
// (Paid.swift's dlstatus/pmstatus lines). The one-time URL expires in a minute or two, so the console opens at once.
// After the run dpkg status is read again and the package page drawn again: Installed, and Modify > Remove works.
async function downloadAndInstall(st, source, client, box, ctx, fail) {
  const id = st.package;
  // The page the row is on, and its route (the top page's: the console is modal, so it stays on top).
  const body = box.closest(".page-body");
  const route = parse(location.hash);
  const hide = (ctx?.showHUD ?? showHUD)("Authorizing");
  let url;
  try { url = await client.authorizeDownload(id, { version: st.version, repo: source.uri,
    architecture: st.architecture || getArch() }); } catch (e) { hide(); await fail(e); return; }
  hide();
  const run = runPaidInstall({ id, version: st.version, name: st.name || "",
    run: (onEvent) => shell("paid.install", { url, package: id, version: st.version, stream: true }, onEvent) });
  if (!run) {
    await showAlert({ title: "Download & Install", message: "Another install is running. Try again when it has finished.", buttons: ["OK"] });
    return;
  }
  const { reloaded } = await run;
  await reloaded;
  if (body?.isConnected) await redrawPage(body, route, ctx);
}

// The package page drawn again in place (browse.js render), at the same scroll position. Imported late: browse.js
// imports this file.
async function redrawPage(body, route, ctx) {
  const top = body.scrollTop;
  const { render, pageOf } = await import("./browse.js");
  if (pageOf(route).page !== "package") return;
  await render(body, route, ctx);
  body.scrollTop = top;
}
