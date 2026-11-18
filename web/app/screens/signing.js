// F69, F75: Settings > Signing in the sideload build, as one walkthrough page (Home's Signing tile opens it too, and
// so does the first Install with something missing): numbered steps, each collapsible, a green tick once done.
//   1  Import your certificate: Select All Files (or the three rows' own Browse): settings.js certificateBlock
//   2  A Signing Server: cydian.dev unless the user runs their own; it hands iOS the manifest for the IPA iFizBox
//      serves at 127.0.0.1 (native/Sources/Sideload.swift). There is no install without one (F75: the old local
//      HTTPS mode is gone; iOS's installer ignores a hand-trusted certificate).
//
//   stepStates(status, { open, server })   pure: [{ id, n, title, done, current, open }] (signing.test.js)
//   missingStep(status, server)            the first step not done ("certificate" | "server") or null: Install opens
//                                          the page there (signing-client.js signAndInstall)
//   walkOpen / openAt(id)                  the expand/collapse state kept across redraws; openAt opens one step only
//   drawWalkthrough(el, opts)              the page; settings.js passes the certificate block, the server rows, …
//
//   picture()                              the certificate step's picture: the user's Files picker screenshot for
//                                          the current theme (F78), shotFor(theme) its address
import { statusReady } from "../signing-client.js";
import { normalizeServer } from "../core/signing.js";

export const STEPS = [
  { id: "certificate", title: "Import Your Certificate" },
  { id: "server", title: "Signing Server" },
];

// A server installs can use: an https:// address (the shell takes no other for the manifest).
export const serverReady = (server) => /^https:\/\//.test(normalizeServer(server) ?? "");

// Each step's state from a signing.status answer (null: the signer didn't answer, nothing is known to be done) and
// the Signing Server. `open`: { [id]: true | false } the user's own expand/collapse taps, which win; otherwise only
// the first step not done yet is open.
export function stepStates(status, { open = {}, server = null } = {}) {
  const done = { certificate: statusReady(status), server: serverReady(server) };
  const current = STEPS.find((s) => !done[s.id])?.id ?? null;
  return STEPS.map((s, i) => ({
    id: s.id, n: i + 1, title: s.title, done: done[s.id], current: s.id === current,
    open: s.id in open ? Boolean(open[s.id]) : s.id === current,
  }));
}

export const missingStep = (status, server) => stepStates(status, { server }).find((s) => !s.done)?.id ?? null;

// Every step done: Install signs and installs straight away.
export const allDone = (states) => states.every((s) => s.done);

export const walkOpen = {};
export function openAt(id) {
  for (const k of Object.keys(walkOpen)) delete walkOpen[k];
  for (const s of STEPS) walkOpen[s.id] = s.id === id;
}

// ---- drawing --------------------------------------------------------------------------------------------------

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// The stylesheet, once, from this module's own folder (no build step: the page links it when first drawn).
let styled = false;
function style() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const link = h("link");
  link.rel = "stylesheet";
  link.href = new URL("../signing.css", import.meta.url).href;
  document.head.append(link);
}
style();

// F78: the certificate step's picture is the user's own screenshot of the iOS Files picker with the three files
// selected, one per theme (600 px wide, no status bar): the one matching <html data-theme> shows, and it follows a
// theme change while the page is open (Automatic flips with iOS).
export const shotFor = (theme) => new URL(`../icons/steps/select-files-${theme === "dark" ? "dark" : "light"}.jpg`,
  import.meta.url).href;
const theme = () => (typeof document === "undefined" ? null : document.documentElement?.getAttribute("data-theme"));

let watching = false;
function watchTheme() {
  if (watching || typeof MutationObserver === "undefined") return;
  watching = true;
  new MutationObserver(() => {
    for (const img of document.querySelectorAll("img.step-shot")) img.src = shotFor(theme());
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

export function picture() {
  watchTheme();
  const fig = h("figure", "step-picture");
  const img = h("img", "step-shot");
  img.alt = "The iOS Files picker with your .p12, .mobileprovision and password file selected";
  img.width = 600;
  img.height = 517;
  img.decoding = "async";
  img.src = shotFor(theme());
  fig.append(img);
  return fig;
}

const TEXT = {
  certificate: "Tap Select All Files, select your .p12, .mobileprovision and password file (or their .zip), then tap Open.",
  server: "Keep cydian.dev, or tap it to enter your own Signing Server.",
};

// The page. opts: { status, failure (text when the signer didn't answer), certificate (element: Select All Files and
// the rows), server (element: the server rows), serverUrl, open (walkOpen), extra (elements under the steps: the
// Keychain's details, Remove Certificate) }.
export function drawWalkthrough(el, { status = null, failure = "", certificate = null, server = null, serverUrl = null,
  open = walkOpen, extra = [] } = {}) {
  style();
  const states = stepStates(status, { open, server: serverUrl });
  const page = h("div", "walkthrough");
  page.append(h("p", "group-footer walk-intro", allDone(states)
    ? `All set: Install signs apps with your certificate ${globalThis.ifizboxNative ? "on this iPhone" : "in this browser"}.`
    : "Two steps before the first install."));
  if (failure) page.append(h("p", "group-footer walk-failure", `The signer didn't answer: ${failure}`));
  if (status?.identityProblem) page.append(h("p", "group-footer walk-failure", status.identityProblem));
  const list = h("ol", "walk-steps");
  for (const s of states) {
    const li = h("li", "walk-step" + (s.done ? " is-done" : "") + (s.current ? " is-current" : ""));
    li.dataset.step = s.id;
    const head = h("button", "walk-head");
    head.type = "button";
    head.setAttribute("aria-expanded", String(s.open));
    const badge = h("span", "walk-badge", s.done ? "" : String(s.n));
    badge.setAttribute("aria-label", s.done ? `Step ${s.n}, done` : `Step ${s.n}`);
    head.append(badge, h("span", "walk-title", s.title), h("span", "walk-disclosure"));
    const body = h("div", "walk-body");
    body.hidden = !s.open;
    body.append(h("p", "walk-text", TEXT[s.id]));
    if (s.id === "certificate") {
      if (certificate) body.append(certificate);
      body.append(picture());
    }
    if (s.id === "server" && server) body.append(server);
    head.addEventListener("click", () => {
      const now = body.hidden;
      body.hidden = !now;
      head.setAttribute("aria-expanded", String(now));
      open[s.id] = now; // the caller's object: the choice survives a redraw
    });
    li.append(head, body);
    list.append(li);
  }
  page.append(list, ...extra);
  const top = el.scrollTop;
  el.replaceChildren(page);
  el.scrollTop = top;
  return states;
}
