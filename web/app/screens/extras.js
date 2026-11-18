// Repo extras Sileo users expect (F20), as pieces the screens drop in:
//
//   featuredStrip(source)       the source page's banners (sileo-featured.json), filled in when they land
//   homeFeatured()              Home's banners: a couple from each source
//   paymentGroup(st, source)    a paid package's Price row; in the app Sign In / Buy / Download & Install
//   discoveryGroup()            Search's "Other Sources" list (Canister), with Add Source; .search(q)
//
// Logic lives in core/featured.js, core/payment.js and core/canister.js; this file is DOM and transport only.
//
// The app's vendor calls need the shell (vendors send no CORS headers, and the spec wants the payment secret in the
// Keychain). It asks the shell for these methods and says "needs a newer Cydian" when a shell doesn't have them:
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
import { grouped } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { mediaUrl } from "./depiction.js";
import { settings } from "./settings.js";
import { runPaidInstall } from "./queue.js";
import { createFeaturedStore } from "../core/featured.js";
import { createCanister, mapResults, priceFor } from "../core/canister.js";
import {
  isCommercial, paymentEndpointUrl, parseEndpoint, createPaymentClient, createCredentialStore,
} from "../core/payment.js";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const pkgHref = (key, id) => format({ tab: "sources", path: [key, `package:${id}`] });

// ---- featured banners -------------------------------------------------------------------------------------

let featured = null;
const featuredStore = () => (featured ??= createFeaturedStore({ getText: (u) => getBackend().text(u) }));

// A horizontal row of banners, scroll-snapped one per page like Sileo's. Sizes and corner radius from the repo.
export function bannerRow(banners, { itemSize = { width: 263, height: 148 }, radius = 10 } = {}) {
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

export function homeFeatured() {
  const box = el("div", "featured-box home-featured");
  if (settings.deviceType() === "none") return box; // Not Jailbroken: APT sources (and their tweaks) are hidden
  getBackend().sources().then((list) => featuredStore().forHome(list)).then((banners) => {
    if (banners.length) box.append(bannerRow(banners));
  }, () => {});
  return box;
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
    if (String(q ?? "").trim().length < 2) return;
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

async function offer(r, ctx) {
  const buttons = ["Cancel"];
  if (r.repo.flat) buttons.push("Add Source");
  if (r.depiction) buttons.push("Depiction");
  const lines = [`${r.version}${r.author ? ` · ${r.author}` : ""}`, r.repo.uri];
  if (!r.repo.flat) lines.push(`This source uses suite "${r.repo.dist}": add it from Sources > Edit.`);
  if (!r.archOk) lines.push(`Built for ${r.arch}, not this device.`);
  const { index } = await showAlert({ title: r.name, message: lines.join("\n"), buttons, cancel: 0 });
  const pick = buttons[index];
  if (pick === "Depiction") window.open(r.depiction, "_blank", "noopener");
  if (pick !== "Add Source") return;
  const hide = (ctx?.showHUD ?? showHUD)("Verifying URL");
  let error = null;
  try { await getBackend().addSource(r.repo.uri); } catch (e) { error = e; } finally { hide(); }
  if (error) await showAlert({ title: error.title || "Verification Error", message: error.message, buttons: ["OK"] });
  else await showAlert({ title: "Source Added", message: `${r.repo.name} is in your sources. Refresh Sources to list ${r.name}.`, buttons: ["OK"] });
}

// ---- paid packages ---------------------------------------------------------------------------------------

const native = () => globalThis.cydianNative?.call ? globalThis.cydianNative : null;

class NeedsShell extends Error {
  constructor(method) {
    super(`This needs a newer Cydian app (the shell has no ${method} yet).`);
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
export function paymentGroup(st, source, ctx) {
  const box = el("div", "payment-box");
  if (!isCommercial(st) || !source) return box;
  const draw = (sections) => { box.replaceChildren(grouped(sections)); };
  (async () => {
    const base = await vendorOf(source);
    if (!base || !box.isConnected && box.parentNode == null) return;
    if (getBackend().kind !== "native") return drawSite(st, source, base, draw);
    return drawApp(st, source, base, draw, ctx, box);
  })().catch((e) => draw([{ header: "Purchase", footer: e.message }]));
  return box;
}

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

async function drawApp(st, source, base, draw, ctx, box) {
  const client = clientFor(base);
  const id = st.package;
  const refresh = () => drawApp(st, source, base, draw, ctx, box);
  const fail = async (e) => {
    const buttons = e.recoveryUrl ? ["OK", "More Info"] : ["OK"];
    const { index } = await showAlert({ title: "Purchase", message: e.message, buttons });
    if (index === 1) window.open(e.recoveryUrl, "_blank", "noopener");
    if (e.invalidate) refresh();
  };
  const busy = (label, job) => async () => {
    const hide = (ctx?.showHUD ?? showHUD)(label);
    try { await job(); } catch (e) { hide(); await fail(e); return; }
    hide();
    refresh();
  };
  let info = null, vendor = null, signedIn = false;
  try {
    [vendor, signedIn] = await Promise.all([client.info().catch(() => null), client.signedIn()]);
    info = await client.packageInfo(id);
  } catch (e) {
    if (e instanceof NeedsShell) return draw([{ header: "Purchase", rows: [{ label: "Price", detail: "Paid" }], footer: e.message }]);
    return draw([{ header: "Purchase", footer: e.message }]);
  }
  const name = vendor?.name || new URL(base).hostname;
  const rows = [{ label: "Price", detail: info.purchased ? "Purchased" : info.price ?? "Paid" }];
  const signIn = busy("Signing In", async () => {
    const cb = await shell("auth.session", { url: await client.authenticateUrl(), callbackScheme: "sileo" });
    if (!(await client.finishSignIn(cb))) throw new Error("Sign-in was cancelled or the vendor sent nothing back.");
  });
  if (!info.available) rows.push({ label: "Not available to buy" });
  else if (!signedIn) rows.push({ label: vendor?.banner?.button || `Sign In to ${name}`, onClick: signIn });
  else if (!info.purchased) {
    rows.push({ label: `Buy${info.price ? ` for ${info.price}` : ""}`, onClick: busy("Purchasing", async () => {
      const r = await client.purchase(id);
      if (r.status === "action") await shell("auth.session", { url: r.url, callbackScheme: "sileo" });
      else if (r.status !== "done") throw new Error("The purchase did not go through.");
    }) });
  } else {
    rows.push({ label: "Download & Install", onClick: () => downloadAndInstall(st, source, client, box, ctx, fail) });
  }
  if (signedIn) rows.push({ label: `Sign Out of ${name}`, onClick: busy("Signing Out", () => client.signOut()) });
  draw([{ header: "Purchase", rows, footer: vendor?.banner && !signedIn ? vendor.banner.message : `Sold by ${name}.` }]);
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
  try { url = await client.authorizeDownload(id, { version: st.version, repo: source.uri }); } catch (e) { hide(); await fail(e); return; }
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
