// F69: Settings > Signing in the sideload build, as one walkthrough page (Home's Signing tile opens it too): numbered
// steps, each collapsible, each with a drawing of the iOS screen to tap, and a green tick once it's done.
//   1  Import your certificate: the .p12, its .mobileprovision and the password (settings.js certificateBlock)
//   2  Download the install profile: Cydian's local CA as a .mobileconfig, signed with the certificate from step 1
//   3  Install it: Settings > General > VPN & Device Management > Cydian Local Install > Install
//   4  Trust its root: Settings > General > About > Certificate Trust Settings > the switch on
//   Check: signing.status again; trust.trusted ticks 3 and 4 (iOS tells an app only whether it trusts the CA, so an
//   installed but untrusted profile can't be told from a missing one).
//
//   stepStates(status, { open })   pure: [{ id, n, title, done, current, open }] (signing.test.js)
//   drawWalkthrough(el, opts)      the page; settings.js passes the certificate block, the actions and the rest
//
// The pictures are our own iOS 6-style mock screens in HTML (mockScreen), not Apple screenshots. A step's picture can
// be swapped for a screenshot of the user's own: put it at web/app/icons/signing/<step id>.png (SHOTS below).
import { statusReady } from "../signing-client.js";

export const STEPS = [
  { id: "certificate", title: "Import Your Certificate" },
  { id: "download", title: "Download the Install Profile" },
  { id: "install", title: "Install the Profile" },
  { id: "trust", title: "Trust Its Certificate" },
];

// Each step's state from a signing.status answer (null: the signer didn't answer, nothing is known to be done).
// `open`: { [id]: true | false } the user's own expand/collapse taps, which win; otherwise only the first step not
// done yet is open.
export function stepStates(status, { open = {} } = {}) {
  const trust = (status && typeof status === "object" ? status.trust : null) ?? {};
  const done = {
    certificate: statusReady(status),
    download: Boolean(trust.ca || trust.trusted),
    install: Boolean(trust.trusted),
    trust: Boolean(trust.trusted),
  };
  const current = STEPS.find((s) => !done[s.id])?.id ?? null;
  return STEPS.map((s, i) => ({
    id: s.id, n: i + 1, title: s.title, done: done[s.id], current: s.id === current,
    open: s.id in open ? Boolean(open[s.id]) : s.id === current,
  }));
}

// Every step done: Install signs and installs straight away.
export const allDone = (states) => states.every((s) => s.done);

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

// A user's own screenshot for a step, used instead of the drawing when it loads.
const SHOTS = (id) => new URL(`../icons/signing/${id}.png`, import.meta.url).href;

// A small iOS 6 screen: { title, back, right, groups: [{ header, rows: [{ label, detail, sub, chevron, toggle,
// tap }], footer }], sheet: { text, buttons: [label], tap } }. `tap` marks what to touch (a pulsing ring).
export function mockScreen({ title = "", back = null, right = null, groups = [], sheet = null }) {
  const scr = h("div", "mock-screen");
  scr.setAttribute("role", "img");
  scr.setAttribute("aria-label", `${title} screen`);
  const bar = h("div", "mock-bar");
  if (back) bar.append(h("span", "mock-back", back));
  bar.append(h("span", "mock-title", title));
  if (right) {
    const r = h("span", "mock-right" + (right.tap ? " mock-tap" : ""), right.label);
    bar.append(r);
  }
  const body = h("div", "mock-body");
  for (const g of groups) {
    if (g.header) body.append(h("div", "mock-header", g.header));
    const ul = h("ul", "mock-table");
    for (const r of g.rows ?? []) {
      const li = h("li", "mock-row" + (r.tap ? " mock-tap" : "") + (r.center ? " mock-center" : ""));
      const text = h("span", "mock-text");
      text.append(h("span", "mock-label", r.label));
      if (r.sub) text.append(h("span", "mock-sub", r.sub));
      li.append(text);
      if (r.detail) li.append(h("span", "mock-detail" + (r.verified ? " mock-verified" : ""), r.detail));
      if (r.toggle != null) {
        const sw = h("span", "mock-switch" + (r.toggle ? " is-on" : ""));
        sw.append(h("span", "mock-knob"));
        li.append(sw);
      }
      if (r.chevron) li.append(h("span", "mock-chevron"));
      ul.append(li);
    }
    if (g.rows?.length) body.append(ul);
    if (g.footer) body.append(h("div", "mock-footer", g.footer));
  }
  scr.append(bar, body);
  if (sheet) {
    const shade = h("div", "mock-shade");
    const box = h("div", "mock-alert");
    box.append(h("div", "mock-alert-text", sheet.text));
    const btns = h("div", "mock-alert-buttons");
    sheet.buttons.forEach((b, i) => btns.append(h("span", "mock-alert-button" + (i === sheet.tap ? " mock-tap" : ""), b)));
    box.append(btns);
    shade.append(box);
    scr.append(shade);
  }
  return scr;
}

// The picture for a step: the user's screenshot when there is one, else the drawing. Each slot is looked for once.
const shots = new Map(); // id -> true (it loaded) | false (none)
function picture(id, spec) {
  const fig = h("figure", "step-picture");
  fig.append(mockScreen(spec));
  if (shots.get(id) === false || typeof Image === "undefined") return fig;
  const img = new Image();
  img.alt = "";
  img.className = "step-shot";
  img.onload = () => { shots.set(id, true); fig.replaceChildren(img); };
  img.onerror = () => { shots.set(id, false); };
  img.src = SHOTS(id);
  return fig;
}

// What each step says and shows. `ctx`: { status, signer (the certificate's name), caName }.
function stepContent(id, ctx) {
  const who = ctx.signer || "your name";
  switch (id) {
    case "certificate":
      return { text: "Tap Browse and pick your certificate's files (or their .zip) in the picker that opens.",
      picture: { title: "Recents", back: "Cancel", right: { label: "Open", tap: true },
        groups: [{ rows: [{ label: "Certificates.zip", sub: "Archive", tap: true }, { label: "Me.p12", sub: "Certificate" },
          { label: "Me.mobileprovision", sub: "Profile" }, { label: "password.txt", sub: "Text" }] }] } };
    case "download":
      return {
        text: "Download Profile opens Cydian's install profile in Safari: tap Allow, then come back here. It holds Cydian's own "
          + "certificate for this iPhone's address (127.0.0.1) only. "
          + (ctx.status?.identity ? `It's signed with your certificate, so iOS shows it as Verified by ${who}.` : "Import your certificate first and iOS shows it as Verified with your name, not Unsigned."),
        picture: { title: "Safari", groups: [{ rows: [{ label: "127.0.0.1", center: true }] }],
          sheet: { text: "This website is trying to download a configuration profile. Do you want to allow this?", buttons: ["Ignore", "Allow"], tap: 1 } },
      };
    case "install":
      return {
        text: "Open Settings > General > VPN & Device Management, tap Cydian Local Install under Downloaded Profile, then Install "
          + "(top right) and enter your passcode.",
        picture: { title: "Install Profile", back: "Cancel", right: { label: "Install", tap: true },
          groups: [{ rows: [{ label: "Cydian Local Install", sub: "Cydian" }] },
            { rows: [{ label: "Signed by", detail: ctx.status?.identity ? who : "Not Signed", verified: Boolean(ctx.status?.identity) },
              { label: "Description", detail: "Local install" }, { label: "Contains", detail: "Certificate" }, { label: "More Details", chevron: true }] }] },
      };
    case "trust":
      return {
        text: "Open Settings > General > About > Certificate Trust Settings and turn on the switch for "
          + `${ctx.caName ? `“${ctx.caName}”` : "Cydian Local Install CA"}. iOS asks once more: Continue.`,
        picture: { title: "Certificate Trust Settings", back: "About",
          groups: [{ rows: [{ label: "Trust Store Version", detail: "2026" }] },
            { header: "ENABLE FULL TRUST FOR ROOT CERTIFICATES", rows: [{ label: ctx.caName || "Cydian Local Install CA", toggle: true, tap: true }] }] },
      };
    default:
      return { text: "" };
  }
}

// The page. opts: { status, failure (text when the signer didn't answer), certificate (element: the Browse rows),
// actions: { download(), check(), test() }, open (the expand/collapse state, kept by the caller across redraws),
// extra (elements under the steps: the Keychain's details, Remove Certificate) }.
export function drawWalkthrough(el, { status = null, failure = "", certificate = null, actions = {}, open = {}, extra = [] } = {}) {
  style();
  const states = stepStates(status, { open });
  const ctx = { status, signer: status?.identity?.name ?? "", caName: status?.trust?.name ?? "" };
  const page = h("div", "walkthrough");
  const intro = h("p", "group-footer walk-intro", allDone(states)
    ? "All set: Install on an app's page signs it with your certificate and installs it on this iPhone."
    : "Once, before the first install. Install signs apps with your certificate on this iPhone and installs them from Cydian itself, so iOS has to trust Cydian's own certificate first.");
  page.append(intro);
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
    const c = stepContent(s.id, ctx);
    body.append(h("p", "walk-text", c.text));
    if (s.id === "certificate" && certificate) body.append(certificate);
    if (c.picture) body.append(picture(s.id, c.picture));
    if (s.id === "download" && actions.download) {
      const b = h("button", "walk-action", s.done ? "Download Again" : "Download Profile");
      b.type = "button";
      b.addEventListener("click", () => actions.download());
      body.append(b);
    }
    head.addEventListener("click", () => {
      const now = body.hidden;
      body.hidden = !now;
      head.setAttribute("aria-expanded", String(now));
      open[s.id] = now; // the caller's object: the choice survives a redraw
    });
    li.append(head, body);
    list.append(li);
  }
  page.append(list);
  const check = h("div", "walk-check");
  const cb = h("button", "walk-action walk-check-button", "Check");
  cb.type = "button";
  if (actions.check) cb.addEventListener("click", () => actions.check());
  check.append(cb);
  if (actions.test) {
    const tb = h("button", "walk-action walk-test", "Test Install Server");
    tb.type = "button";
    tb.addEventListener("click", () => actions.test());
    check.append(tb);
  }
  check.append(h("p", "group-footer", states.find((s) => s.id === "trust").done
    ? `iOS trusts ${ctx.caName ? `“${ctx.caName}”` : "Cydian's certificate"}.`
    : "Check asks iOS whether it trusts Cydian's certificate yet: steps 3 and 4 tick together, since iOS only says whether it trusts it."));
  page.append(check, ...extra);
  const top = el.scrollTop;
  el.replaceChildren(page);
  el.scrollTop = top;
  return states;
}
