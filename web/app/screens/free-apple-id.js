// F254: Use a Free Apple ID, on the website's Settings > Signing page (under the certificate walkthrough; the
// certificate route stays recommended). Shown only when the Worker's Apple relay is on (GET /apple/status).
//
// Flow (user 2026-11-19): Apple ID + password -> a code screen when Apple asks for two-factor -> setup runs by itself
// as a live checklist (core/freeroute.js runSetup: register This iPhone, reuse or make the certificate, the App ID,
// the profile; a spinner then a tick and a summary, later steps grey) and stops to ask only at Apple's certificate
// limit -> ready: the Developer Mode + Trust note and Save for the App. iOS refuses free-profile apps from a website
// (R32: MIInstallerErrorDomain 111), so the website doesn't install on this route: the app on the phone does.
// Every sign-in error is an iOS 6 alert (nav/alert.js) worded by core/gsa.js signInAlert.
//
//   await relayAvailable({ fetcher })    the relay answers /apple/status (cached per page load)
//   loadFreeIdentity(store) / saveFreeIdentity(id, store) / forgetFreeIdentity(store)
//                                        the development key + certificate (.p12, its password), the last profile and
//                                        the team, kept in this browser (localStorage) for the certificate's year
//   handoffFiles(id)                     [{ name, data }]: the .p12, .mobileprovision and password.txt the app's
//                                        Select All Files imports (as one .zip: handoffZip)
//   checklist(states)                    pure: the setup rows [{ id, title, state, summary }] in order
//   signInFailure(e, now)                pure: { alert, keepEmail, clearPassword, stayOnCode, waitUntil, link }
//   freeRouteBlock({ alert, store })     the Signing page's Free Apple ID group, expanding into the flow in place
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, el } from "../nav/ui.js";
import { NAME, BUNDLE_ID } from "../brand.js";
import { relayTransport, relayWsUrl, anisetteV3, AppleIdSession, DevPortal, signInAlert, b64encode, b64decode } from "../core/gsa.js";
import { runSetup, pickTeam, setupError, SETUP_STEPS, otherTool, freeExpiry } from "../core/freeroute.js";
import { storedZip } from "../core/freecert.js";
import { parseProfile } from "../core/signing.js";
import { storedUdid } from "./signing.js";
import { MERGED_PAGE } from "../core/signingpage.js";

export const FREE_KEY = "ifizbox.freeid";
const ANISETTE_KEY = "ifizbox.freeid.anisette";
const WAIT_KEY = "ifizbox.freeid.wait";

const local = (store) => {
  if (store !== undefined) return store;
  try { return globalThis.localStorage ?? null; } catch { return null; }
};
const readJson = (store, k) => { try { return JSON.parse(local(store)?.getItem(k) ?? "null"); } catch { return null; } };
const writeJson = (store, k, v) => { try { v == null ? local(store)?.removeItem(k) : local(store)?.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } };

let relayAnswer = null;
export function relayAvailable({ fetcher = globalThis.fetch, origin = globalThis.location?.origin ?? "" } = {}) {
  relayAnswer ??= (async () => {
    try {
      const r = await fetcher(`${origin}/apple/status`, { cache: "no-store", credentials: "omit" });
      return r.ok && (await r.json())?.on === true;
    } catch { return false; }
  })();
  return relayAnswer;
}
export const resetRelayAnswer = () => { relayAnswer = null; };

export function loadFreeIdentity(store) {
  const j = readJson(store, FREE_KEY);
  if (!j?.p12 || !j?.teamId) return null;
  try {
    return { ...j, p12: b64decode(j.p12), profile: j.profile ? b64decode(j.profile) : null,
      expires: j.expires ? new Date(j.expires) : null };
  } catch { return null; }
}
export function saveFreeIdentity(id, store) {
  writeJson(store, FREE_KEY, { teamId: id.teamId, teamName: id.teamName ?? null, serial: id.serial, password: id.password,
    p12: b64encode(id.p12), expires: id.expires ? new Date(id.expires).toISOString() : null,
    profile: id.profile ? b64encode(id.profile) : null, appId: id.appId ?? null });
}
export const forgetFreeIdentity = (store) => writeJson(store, FREE_KEY, null);

const te = new TextEncoder();
export function handoffFiles(id) {
  const base = `${NAME} Free Apple ID`;
  const files = [{ name: `${base}.p12`, data: id.p12 }, { name: "password.txt", data: te.encode(id.password) }];
  if (id.profile) files.push({ name: `${base}.mobileprovision`, data: id.profile });
  return files;
}
export const handoffZip = (id) => storedZip(handoffFiles(id));

// Setup rows in SETUP_STEPS order: { id, title, state: "waiting" | "running" | "done" | "failed", summary }.
export function checklist(states = {}) {
  return SETUP_STEPS.map((s) => ({ id: s.id, title: s.title, state: states[s.id]?.state ?? "waiting", summary: states[s.id]?.summary ?? "" }));
}

// What a sign-in failure does to the page (user 2026-11-19): Incorrect Password keeps the Apple ID and clears and
// focuses the password; Incorrect Code keeps the code screen; Locked links iforgot.apple.com; -36607 waits.
export function signInFailure(e, now = new Date()) {
  const a = signInAlert(e, { now });
  return {
    alert: a,
    keepEmail: true,
    clearPassword: a.kind === "wrong-password",
    stayOnCode: a.kind === "wrong-code",
    waitUntil: a.waitUntil ?? null,
    link: a.kind === "locked" ? "https://iforgot.apple.com" : null,
  };
}
const AGREEMENT_URL = "https://developer.apple.com/account";

// ---- the flow's state (kept across redraws of the Signing page) ----
const flow = { open: false, view: "signin", email: "", busy: false, steps: {}, session: null, portal: null, team: null, phone: null, sms: null };

function anisetteStore(store) {
  return { load: () => readJson(store, ANISETTE_KEY), save: (s) => writeJson(store, ANISETTE_KEY, s) };
}

function field({ type = "text", placeholder = "", value = "", label, cls = "" }) {
  const li = el("li", `cell free-field ${cls}`.trim());
  const row = el("label", "cell-inner");
  const input = Object.assign(el("input", "sign-value sign-field free-input"), { type, placeholder, value });
  input.autocomplete = type === "password" ? "current-password" : type === "email" ? "username" : "one-time-code";
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.spellcheck = false;
  input.setAttribute("aria-label", label);
  if (type === "tel") input.inputMode = "numeric";
  row.append(input);
  li.append(row);
  return { li, input };
}

function table(header, ...cells) {
  const g = el("div", "group");
  g.append(el("h2", "group-header", header));
  const ul = el("ul", "table grouped");
  ul.append(...cells);
  g.append(ul);
  return g;
}

function button(label, onClick, cls = "") {
  return grouped([{ rows: [{ label, onClick, cls: cls || "free-button" }] }]); // ui.js takes one class per row
}

export function freeRouteBlock({ alert, store, onChange = () => {} } = {}) {
  const box = el("div", "free-route");
  box.hidden = true;
  const ask = async (opts) => (alert ?? (await import("../nav/alert.js")).showAlert)(opts);
  const draw = () => render(box, { ask, store, redraw: draw, onChange });
  relayAvailable().then((on) => { if (on) { box.hidden = false; draw(); } });
  return box;
}

function render(box, ctx) {
  style();
  const { store } = ctx;
  const saved = loadFreeIdentity(store);
  const parts = [];
  if (!flow.open) {
    const has = saved ? "Set Up" : null;
    parts.push(grouped([{ header: "Free Apple ID",
      rows: [{ label: "Use a Free Apple ID", detail: has, onClick: () => { flow.open = true; if (saved && !flow.session) flow.view = "ready"; ctx.redraw(); }, chevron: true }],
      footer: "No certificate? A free Apple ID can sign up to 3 apps for 7 days at a time. A certificate stays the better way: "
        + `its apps last a year and install from this website. Apps signed with a free Apple ID have to be installed by the ${NAME} app on the iPhone.` }]));
  } else if (flow.view === "signin") parts.push(...signInView(ctx));
  else if (flow.view === "code") parts.push(...codeView(ctx));
  else if (flow.view === "setup") parts.push(...setupView(ctx));
  else if (flow.view === "devmode") parts.push(...devModeView(ctx));
  else parts.push(...readyView(ctx, saved));
  box.replaceChildren(...parts);
}

// ---- sign in ----
function waitingUntil(store) {
  const t = Number(readJson(store, WAIT_KEY));
  return t > Date.now() ? new Date(t) : null;
}

function signInView(ctx) {
  const email = field({ type: "email", placeholder: "Apple ID", value: flow.email, label: "Apple ID" });
  const pw = field({ type: "password", placeholder: "Password", label: "Password" });
  const go = () => signIn(ctx, email.input, pw.input);
  pw.input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  const wait = waitingUntil(ctx.store);
  const out = [table("Sign In With a Free Apple ID", email.li, pw.li),
    button(flow.busy ? "Signing In…" : "Sign In", go, "free-primary"),
    grouped([{ footer: "Your password is checked in this browser (Apple's SRP sign-in) and never sent anywhere. "
      + `${NAME}'s server only passes messages between this page and Apple. Use a spare Apple ID if you have one: Apple `
      + "can lock an account that signs in from too many places."
      + (wait ? ` Apple refused the last try: wait until ${wait.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "") }]),
    button("Cancel", () => { flow.open = false; ctx.redraw(); })];
  queueMicrotask(() => (flow.email ? pw.input : email.input).focus?.());
  return out;
}

async function signIn(ctx, emailInput, pwInput) {
  if (flow.busy) return;
  const email = emailInput.value.trim(), password = pwInput.value;
  if (!email || !password) return;
  const wait = waitingUntil(ctx.store);
  if (wait) {
    await ctx.ask({ title: "Please Wait", message: `Apple refused the last sign-in. Try again after ${wait.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: retrying sooner can lock the Apple ID.` });
    return;
  }
  flow.email = email;
  flow.busy = true;
  ctx.redraw();
  try {
    const transport = relayTransport();
    const anisette = anisetteV3({ transport, storage: anisetteStore(ctx.store), wsUrl: relayWsUrl });
    flow.session = new AppleIdSession({ transport, anisette });
    flow.transport = transport;
    flow.anisette = anisette;
    const r = await flow.session.login(email, password);
    await afterLogin(ctx, r);
  } catch (e) {
    await failed(ctx, e);
  } finally {
    flow.busy = false;
  }
}

async function failed(ctx, e) {
  const f = signInFailure(e);
  if (f.waitUntil) writeJson(ctx.store, WAIT_KEY, Date.parse(f.waitUntil));
  if (!f.stayOnCode) flow.view = "signin";
  flow.busy = false;
  ctx.redraw();
  const buttons = f.link ? ["OK", "iforgot.apple.com"] : ["OK"];
  await ctx.ask({ title: f.alert.title, message: f.alert.message, buttons, cancel: 0,
    onTap: (i) => { if (i === 1 && f.link) globalThis.open?.(f.link, "_blank", "noopener"); } });
  if (f.clearPassword) {
    const pw = document.querySelector?.(".free-route input[type=password]");
    if (pw) { pw.value = ""; pw.focus(); }
  }
}

async function afterLogin(ctx, r) {
  if (r.step === "device") {
    await flow.session.requestDeviceCode();
    flow.sms = null;
    flow.view = "code";
    return ctx.redraw();
  }
  if (r.step === "sms") {
    const phones = await flow.session.trustedPhones();
    if (!phones.length) throw Object.assign(new Error("Apple listed no trusted phone number for the code."), { step: "2FA" });
    flow.sms = phones[0];
    await flow.session.requestSmsCode(flow.sms.id);
    flow.view = "code";
    return ctx.redraw();
  }
  if (r.step !== "done") throw Object.assign(new Error(`Apple wants another step first (${r.au}). Sign in at appleid.apple.com, then try again.`), { step: "sign-in" });
  const { token } = await flow.session.appToken();
  flow.portal = new DevPortal({ transport: flow.transport, anisette: flow.anisette, token, adsid: flow.session.adsid });
  const team = pickTeam(await flow.portal.listTeams());
  if (!team) throw Object.assign(new Error("Apple listed no developer team for this Apple ID."), { step: "listTeams" });
  flow.team = team;
  flow.session.forget();
  await setup(ctx);
}

function codeView(ctx) {
  const code = field({ type: "tel", placeholder: "Verification Code", label: "Verification Code", cls: "free-code" });
  const go = async () => {
    if (flow.busy || !code.input.value.trim()) return;
    flow.busy = true;
    try {
      const r = flow.sms ? await flow.session.verifySmsCode(flow.sms.id, code.input.value) : await flow.session.verifyDeviceCode(code.input.value);
      await afterLogin(ctx, r);
    } catch (e) { await failed(ctx, e); } finally { flow.busy = false; }
  };
  code.input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  queueMicrotask(() => code.input.focus?.());
  return [table("Two-Factor Authentication", code.li), button("Verify", go, "free-primary"),
    grouped([{ footer: flow.sms ? `Enter the code Apple texted to ${flow.sms.number}.` : "Enter the code shown on your other Apple devices." }]),
    button("Cancel", () => { flow.view = "signin"; flow.session = null; ctx.redraw(); })];
}

// ---- setup ----
async function askRevoke(ctx, certs) {
  if (!certs.length) return null;
  const label = (c) => `${c.machineName || c.name || "Certificate"}${c.expirationDate ? ` (until ${new Date(c.expirationDate).toISOString().slice(0, 10)})` : ""}`;
  const buttons = ["Cancel", ...certs.map((c) => `Revoke ${label(c)}`)];
  const colors = Object.fromEntries(certs.map((c, i) => [i + 1, "red"]));
  const others = certs.some(otherTool);
  const { index } = await ctx.ask({ title: "Certificate Limit",
    message: "Apple won't make another development certificate for this Apple ID until one is revoked. Revoking one stops "
      + `every app signed with it until it's signed again${others ? ", including the apps SideStore or another tool signed" : ""}.`,
    buttons, cancel: 0, stacked: true, colors });
  return index > 0 ? certs[index - 1].serialNumber : null;
}

async function setup(ctx) {
  flow.view = "setup";
  flow.steps = {};
  flow.phone = storedUdid();
  ctx.redraw();
  const saved = loadFreeIdentity(ctx.store);
  try {
    const r = await runSetup({ portal: flow.portal, teamId: flow.team.teamId, phone: flow.phone, saved, bundleId: BUNDLE_ID, appName: NAME,
      onStep: (s) => { flow.steps[s.id] = s; ctx.redraw(); }, askRevoke: (certs) => askRevoke(ctx, certs) });
    saveFreeIdentity({ ...r.identity, teamName: flow.team.name ?? null, profile: r.profile.data, appId: r.appId }, ctx.store);
    flow.view = "ready";
    ctx.redraw();
    ctx.onChange();
  } catch (e) {
    const a = setupError(e);
    const agreement = e?.kind === "agreement";
    await ctx.ask({ title: a.title, message: a.message, buttons: agreement ? ["OK", "Open developer.apple.com"] : ["OK"], cancel: 0,
      onTap: (i) => { if (i === 1 && agreement) globalThis.open?.(AGREEMENT_URL, "_blank", "noopener"); } });
    if (e?.kind === "session") { flow.view = "signin"; flow.session = null; ctx.redraw(); }
  }
}

function setupView(ctx) {
  const ol = el("ol", "free-checklist table grouped");
  for (const row of checklist(flow.steps)) {
    const li = el("li", `cell free-step is-${row.state}`);
    const inner = el("div", "cell-inner");
    const text = el("span", "cell-text");
    text.append(el("span", "cell-label", row.title));
    if (row.summary) text.append(el("span", "cell-subtitle", row.summary));
    inner.append(el("span", "free-mark"), text);
    li.append(inner);
    ol.append(li);
  }
  const g = el("div", "group");
  g.append(el("h2", "group-header", `Setting Up${flow.team?.name ? ` ${flow.team.name}` : ""}`), ol);
  const failed = Object.values(flow.steps).some((s) => s.state === "failed");
  return [g, ...(failed ? [button("Try Again", () => setup(ctx), "free-primary"), button("Sign Out", () => signOut(ctx))] : [])];
}

// ---- ready ----
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function signOut(ctx) {
  flow.session = null; flow.portal = null; flow.team = null; flow.steps = {};
  flow.view = "signin";
  ctx.redraw();
}

function readyView(ctx, saved) {
  if (!saved) { flow.view = "signin"; return signInView(ctx); }
  let prof = null;
  try { prof = saved.profile ? parseProfile(saved.profile) : null; } catch { /* shown as unknown */ }
  const day = (d) => (d ? d.toISOString().slice(0, 10) : "?");
  const exp = freeExpiry(prof?.expires);
  const rows = [
    { label: "Team", detail: saved.teamName || saved.teamId },
    { label: "Certificate Until", detail: day(saved.expires) },
    { label: "App ID", subtitle: saved.appId || "?" },
    { label: "Profile Until", detail: exp.state === "expired" ? "Expired" : day(prof?.expires) },
  ];
  const setupDone = checklist(flow.steps).every((s) => s.state === "done");
  const out = [grouped([{ header: "Free Apple ID", rows,
    footer: setupDone ? Object.values(flow.steps).map((s) => s.summary).join(". ") + "." : null }])];
  out.push(button("Save for the App", () => download(handoffZip(saved), `${NAME} Free Apple ID.zip`), "free-primary"));
  out.push(grouped([{ footer: `The .zip holds the certificate, its password and ${NAME}'s 7-day profile, for the ${NAME} app's `
    + `${MERGED_PAGE} > Select All Files. iOS refuses` // C15: the app it names is the sideload build
    + " free Apple ID apps from a website, so they have to be installed by an "
    + `app on the iPhone through LocalDevVPN; ${NAME}'s own install route for that isn't out yet. Sign in here again for a `
    + "new profile each week (the certificate is kept for its year)." }]));
  // F254i: the Developer Mode + Trust steps, a page of their own; gone once an app on this route installed fine
  if (!freeInstalled(ctx.store)) {
    out.push(grouped([{ header: "Before the First Install",
      rows: [{ label: "Developer Mode and Trust", onClick: () => { flow.view = "devmode"; ctx.redraw(); }, chevron: true }],
      footer: "iOS 16 and later: a few steps in Settings on the iPhone, once." }]));
  }
  out.push(button(flow.portal ? "Refresh Profile" : "Sign In Again", () => (flow.portal ? setup(ctx) : signOut(ctx))));
  out.push(button("Forget Free Apple ID", async () => {
    const { index } = await ctx.ask({ title: "Forget Free Apple ID?",
      message: "This removes the certificate and key from this browser. Apple keeps the certificate (it isn't revoked); a new one "
        + "can be made next time.", buttons: ["Cancel", "Forget"], cancel: 0, colors: { 1: "red" } });
    if (index !== 1) return;
    forgetFreeIdentity(ctx.store);
    signOut(ctx);
    flow.open = false;
    ctx.redraw();
    ctx.onChange();
  }, "free-danger"));
  out.push(button("Done", () => { flow.open = false; ctx.redraw(); }));
  return out;
}

// The stylesheet, once (the checklist's spinner and ticks), from this module's own folder.
let styled = false;
function style() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: new URL("../freeid.css", import.meta.url).href });
  document.head.append(link);
}

// ---- F254i: Developer Mode and Trust, step by step ----
// The Ready page's "Before the First Install" opens this page; it goes away once an app on this route installed fine
// (markFreeInstalled: the app's install route calls it, or the page's own "An App Installed Fine"). Each step has a
// picture of the Settings screen it means, redrawn here in today's iOS Settings look (not an iOS 6 screen: the user's
// iPhone shows today's; F75) and following the page's light or dark theme. No Apple artwork, no copied images.
//
//   devModeSteps({ email })              pure: [{ id, title, text, optional, shot }] in order; shot is the picture's
//                                        spec { back, title, groups: [{ header, rows: [{ label, detail, on, mark }],
//                                        footer }], alert: { title, message, buttons, bold } }
//   freeInstalled(store) / markFreeInstalled(store, on = true)
export const INSTALLED_KEY = "ifizbox.freeid.installed";
export const freeInstalled = (store) => readJson(store, INSTALLED_KEY) === true;
export const markFreeInstalled = (store, on = true) => writeJson(store, INSTALLED_KEY, on ? true : null);

export function devModeSteps({ email = "" } = {}) {
  const cert = `Apple Development: ${email || "you@example.com"}`;
  const privacy = (devMode) => ({ back: "Settings", title: "Privacy & Security",
    groups: [{ header: "Security", rows: [{ label: "Developer Mode", detail: devMode, mark: true }, { label: "Lockdown Mode", detail: "Off" }] }] });
  return [
    { id: "turn-on", title: "Turn On Developer Mode",
      text: "Open Settings > Privacy & Security, scroll to the bottom and tap Developer Mode, then turn it on. Developer Mode "
        + "only shows up there once an app signed with a free Apple ID is on the iPhone: if it isn't there yet, install the "
        + `app with the ${NAME} app first, then come back.`,
      shot: privacy("Off") },
    { id: "restart", title: "Restart the iPhone",
      text: "iOS asks to restart before Developer Mode turns on. Tap Restart.",
      shot: { back: "Privacy & Security", title: "Developer Mode",
        groups: [{ rows: [{ label: "Developer Mode", on: true }],
          footer: "Developer Mode lets apps signed for development run on this iPhone." }],
        alert: { title: "Turn On Developer Mode?", message: "Restarting is needed to turn on Developer Mode.", buttons: ["Cancel", "Restart"], bold: 1 } } },
    { id: "confirm", title: "Confirm After the Restart",
      text: "Unlock the iPhone after it restarts. iOS asks once more: tap Turn On and enter your passcode.",
      shot: { ...privacy("On"),
        alert: { title: "Turn On Developer Mode?", message: "This lowers the iPhone's security for apps signed for development.", buttons: ["Cancel", "Turn On"], bold: 1 } } },
    { id: "delay", title: "If iOS Asks to Wait", optional: true,
      text: "With Stolen Device Protection on and the iPhone away from a familiar place like home or work, iOS asks for Face ID, "
        + "then starts an hour's Security Delay before Developer Mode can be turned on. Wait for it to end and turn it on "
        + "again, or do it at home.",
      shot: { back: "Privacy & Security", title: "Developer Mode",
        groups: [{ header: "Security Delay in Progress", rows: [{ label: "Try again in", detail: "59 min" }],
          footer: "Stolen Device Protection asks for an hour's wait before this setting changes away from familiar places." }] } },
    { id: "trust", title: "Trust the Developer",
      text: "After the first install, the app won't open until you trust its developer: open Settings > General > VPN & Device "
        + `Management, tap ${cert} under Developer App, then Trust. The iPhone needs the internet for this.`,
      shot: { back: "General", title: "VPN & Device Management",
        groups: [{ header: "Developer App", rows: [{ label: cert, mark: true }] }] } },
  ];
}

// One picture: a phone screen with a nav bar, grouped rows and maybe an alert over it, drawn as elements (crisp at any
// scale, themed by freeid.css's .dm-* rules). Read as one image by screen readers: the step's text says the same.
export function devModeShot(spec) {
  const fig = el("figure", "dm-shot");
  fig.setAttribute("role", "img");
  fig.setAttribute("aria-label", `Settings: ${spec.title}`);
  const screen = el("div", "dm-screen");
  const nav = el("div", "dm-nav");
  nav.append(el("span", "dm-back", spec.back), el("span", "dm-title", spec.title));
  screen.append(nav);
  for (const g of spec.groups ?? []) {
    if (g.header) screen.append(el("div", "dm-header", g.header));
    const box = el("div", "dm-group");
    for (const r of g.rows) {
      const row = el("div", `dm-row${r.mark ? " is-marked" : ""}`);
      row.append(el("span", "dm-label", r.label));
      if (r.on !== undefined) row.append(el("span", `dm-switch${r.on ? " is-on" : ""}`));
      else {
        if (r.detail) row.append(el("span", "dm-detail", r.detail));
        if (r.mark || r.detail) row.append(el("span", "dm-chevron"));
      }
      box.append(row);
    }
    screen.append(box);
    if (g.footer) screen.append(el("div", "dm-footer", g.footer));
  }
  if (spec.alert) {
    const dim = el("div", "dm-dim");
    const a = el("div", "dm-alert");
    a.append(el("div", "dm-alert-title", spec.alert.title), el("div", "dm-alert-text", spec.alert.message));
    const bs = el("div", "dm-alert-buttons");
    spec.alert.buttons.forEach((b, i) => bs.append(el("span", `dm-alert-button${i === spec.alert.bold ? " is-bold" : ""}`, b)));
    a.append(bs);
    dim.append(a);
    screen.append(dim);
  }
  fig.append(screen);
  return fig;
}

function devModeView(ctx) {
  const page = el("div", "walkthrough free-devmode");
  page.append(el("p", "group-footer walk-intro", "Apps signed with a free Apple ID need Developer Mode on the iPhone (iOS 16 "
    + "and later) and a one-time Trust. Do these on the iPhone the apps are for."));
  const list = el("ol", "walk-steps");
  devModeSteps({ email: flow.email }).forEach((s, i) => {
    const li = el("li", `walk-step is-current${s.optional ? " is-optional" : ""}`);
    li.dataset.step = s.id;
    const head = el("div", "walk-head free-devmode-head");
    head.append(el("span", "walk-badge", String(i + 1)), el("span", "walk-title", s.title));
    const body = el("div", "walk-body");
    body.append(el("p", "walk-text", s.text), devModeShot(s.shot));
    li.append(head, body);
    list.append(li);
  });
  page.append(list);
  const back = () => { flow.view = "ready"; ctx.redraw(); };
  return [page,
    button("An App Installed Fine", () => { markFreeInstalled(ctx.store); back(); }, "free-primary"),
    grouped([{ footer: "Once an app on this route opens fine, these steps are done for good: this page stops showing." }]),
    button("Back", back)];
}
