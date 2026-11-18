// Home's User Guides, as Cydia's Home had them below More Package Sources (cydia.saurik.com/ui/ios~iphone/1.1/home/:
// Frequently Asked Questions, Copying Files to/from Device, OpenSSH Access How-To, Root Password How-To), rewritten
// for today's rootless jailbreaks. F157 (user 2026-11-18, the approved concept): each guide is an iOS 6 app page
// built from ios6.css's grouped tables (styles in guides.css):
//   faq          question rows grouped Getting Started / Problems / Sources; each opens faq/<id> on Home's stack: a
//                bold question, the answer in a white cell (or numbered steps) and a Next group to the places it names
//   copying      a segmented control (packages.css .segmented): On iPhone (Filza) / Computer (SFTP) / No Jailbreak
//   openssh      numbered steps whose blue badges tick green when tapped (kept per guide in localStorage), the
//                OpenSSH package's Install row, the ssh command in a terminal panel with Copy (F151's log look)
//   password     a yellow warning row, the whole session as a terminal transcript, then the steps with Copy
// Lite (Not Jailbroken: the sideload IPA, and the website while Settings > Device says so, as F144): no OpenSSH or
// Root Password guide, an FAQ about apps, signing and sources only, and Copying Files as the no-jailbreak page
// (Files, AirDrop, LocalSend, Finder/iTunes File Sharing). Nothing jailbreak-only is named there (guides.test.js).
// Cydia's Storage Information and Developers Only are left out: there's no storage page to show.
import { el, grouped, row } from "../nav/ui.js";
import { format, settingsRoute } from "../router.js";
import { NAME } from "../brand.js";

export const JAILBREAK_INFO_URL = "https://jailbreakme.dev/";

// Lite: what a Not Jailbroken device sees. `type` is settings.deviceType() ("none" in the sideload build).
export const isLite = (type) => type === "none";

// ---- the places answers point at (their Next rows) ----------------------------------------------------------
export const PACKAGES = { openssh: "openssh", filza: "com.tigisoftware.filza" };
const packageHref = (id) => format({ tab: "search", path: [`package:${id}`] });
export const LINKS = {
  device: { label: "Settings > Device", href: () => format(settingsRoute(["device"])) },
  signing: { label: "Settings > Signing", href: () => format(settingsRoute(["signing"])) },
  refresh: { label: "Refresh Sources", href: () => format({ tab: "sources" }) },
  installed: { label: "Installed", href: () => format({ tab: "installed" }) },
  ipas: { label: "Install IPAs", href: () => format({ tab: "installed", path: ["myipas"] }) },
  add: { label: "Add a Source", href: () => format({ tab: "sources", path: ["manage", "sources"] }) },
  more: { label: "More Package Sources", href: () => format({ tab: "sources", path: ["manage"] }) },
  help: { label: "Upgrading & Jailbreaking Help", href: () => format({ tab: "home", path: ["help"] }) },
  openssh: { label: "OpenSSH Access How-To", href: () => format({ tab: "home", path: ["guides", "openssh"] }) },
  password: { label: "Root Password How-To", href: () => format({ tab: "home", path: ["guides", "password"] }) },
};
export const linkRow = (id) => ({ label: LINKS[id].label, href: LINKS[id].href() });

// ---- FAQ ----------------------------------------------------------------------------------------------------
// Each answer: { q, a } (one paragraph) or { q, steps: [...] }, `next`: LINKS ids, `group`, and where it shows:
// `only: "full"` (jailbroken), `only: "lite"`, or both. `liteA` swaps the answer text in lite.
export const FAQ_GROUPS = ["Getting Started", "Problems", "Sources"];
export const FAQ = [
  {
    id: "what", group: "Getting Started", q: `What is ${NAME}?`,
    a: "A package manager with the iOS 6 look, for modern iPhones. Jailbroken, it lists tweaks, themes and tools "
      + "from APT sources and installs them with apt. Not jailbroken, it lists apps from AltStore-style sources, "
      + "signed and installed on the phone.",
    liteA: "An app store with the iOS 6 look, for modern iPhones. It lists apps from AltStore-style sources, then "
      + "signs them with your certificate and installs them on the phone.",
    next: ["more"], liteNext: ["add", "signing"],
  },
  {
    id: "need", group: "Getting Started", only: "full", q: "Do I need a jailbreak?",
    a: "Only for tweaks and themes. Apps from AltStore-style sources work on any iPhone. Upgrading & Jailbreaking "
      + `Help says which jailbreak kinds ${NAME} supports.`,
    next: ["help", "device"],
  },
  {
    id: "kind", group: "Getting Started", only: "full", q: "Rootful or rootless?",
    a: "Dopamine and palera1n's default are rootless: packages live under /var/jb and are built for iphoneos-arm64. "
      + `checkra1n and older jailbreaks are rootful (iphoneos-arm). Settings > Device picks which packages ${NAME} `
      + "lists, so it must match your jailbreak.",
    next: ["device", "help"],
  },
  {
    id: "signing", group: "Getting Started", only: "lite", q: "What do I need to install apps?",
    steps: [
      "A signing certificate (.p12) and its password, with a provisioning profile that names this iPhone.",
      "Settings > Signing: add the certificate and profile.",
      "Install IPAs, or any app's page from a source: tap Install.",
    ],
    next: ["signing", "ipas"],
  },
  {
    id: "package", group: "Problems", only: "full", q: "A package won't install",
    steps: [
      "Check that Settings > Device matches your jailbreak: a package built for rootful won't install on rootless, "
        + "and the other way round.",
      "Refresh Sources, then try again.",
      "Still failing? The error apt shows names the package or dependency it couldn't get.",
    ],
    next: ["device", "refresh"],
  },
  {
    id: "tweak", group: "Problems", only: "full", q: "A tweak broke something",
    steps: [
      "Remove the last package you installed (Installed tab), then respring.",
      "If SpringBoard won't come up, reboot: a rootless jailbreak starts out unjailbroken after a reboot.",
      "Jailbreak again with tweaks turned off (Dopamine: Tweak Injection in its settings), then remove the package.",
    ],
    next: ["installed"],
  },
  {
    id: "app", group: "Problems", q: "An app won't install",
    steps: [
      "Settings > Signing: check the certificate and profile are there and the password is right.",
      "The profile must list this iPhone (its UDID), unless it's an enterprise one.",
      "Free developer accounts sign at most three apps at a time: remove one you don't use.",
      "Try again from Install IPAs or the app's page.",
    ],
    next: ["signing", "ipas"],
  },
  {
    id: "expired", group: "Problems", q: "My certificate expired",
    a: "Apps signed with it stop opening. Get a new certificate and profile, add them in Settings > Signing, then "
      + "install the apps again: their data stays as long as you don't delete them first.",
    next: ["signing", "installed"],
  },
  {
    id: "addsource", group: "Sources", q: "Adding a source",
    a: "Sources > Manage > Sources > Add, then type the source's address. More Package Sources lists a few to start "
      + "with: one tap adds one.",
    next: ["add", "more"],
  },
  {
    id: "failed", group: "Sources", q: "A source won't load",
    a: "Check the address in a browser: it should answer, not show an error page. Then Refresh Sources. A source "
      + "that still fails says why on its row in the Sources tab.",
    next: ["refresh"],
  },
  {
    id: "moresources", group: "Sources", q: "Where do I find more sources?",
    a: "More Package Sources lists ones we checked. Developers often post their source's address on their site.",
    next: ["more", "add"],
  },
];

const shows = (item, lite) => !item.only || item.only === (lite ? "lite" : "full");
export const faqFor = (lite) => FAQ.filter((f) => shows(f, lite)).map((f) => ({
  ...f, a: lite && f.liteA ? f.liteA : f.a, next: lite && f.liteNext ? f.liteNext : f.next,
}));
export const answerFor = (id, lite) => faqFor(lite).find((f) => f.id === id) ?? null;

// The FAQ page: its question rows, grouped.
export function faqSections(lite) {
  const list = faqFor(lite);
  return FAQ_GROUPS.map((g) => ({
    header: g,
    rows: list.filter((f) => f.group === g).map((f) => ({ label: f.q, href: format({ tab: "home", path: ["guides", "faq", f.id] }) })),
  })).filter((s) => s.rows.length);
}

// ---- Copying Files --------------------------------------------------------------------------------------------
export const FILZA_CAN = ["Browse the whole file system", "Unzip and zip archives", "Edit plists and text files",
  "Open files shared from other apps", "Install .deb files"];
export const SFTP_ROWS = [["Protocol", "SFTP"], ["Server", "iPhone's IP"], ["User", "mobile"], ["Port", "22"]];
export const SFTP_APPS = [["Cyberduck", "Mac"], ["WinSCP", "Windows"], ["FileZilla", "Mac, Windows, Linux"]];
export const COPYING_SEGMENTS = ["On iPhone", "Computer", "No Jailbreak"];

// The no-jailbreak page: the whole Copying Files in lite, and its third segment otherwise.
export function noJailbreakSections() {
  return [
    {
      header: "On iPhone",
      rows: [
        { label: "Files", subtitle: "Browse, unzip and share files", icon: { text: "F", color: "#3d8bea" } },
        { label: "AirDrop", subtitle: "To and from nearby Apple devices", icon: { text: "A", color: "#4aa5e8" } },
        { label: "LocalSend", subtitle: "To any phone or computer on your Wi-Fi", icon: { text: "L", color: "#2fae8a" } },
      ],
      footer: "Files reaches the documents of apps that share them. Share > Save to Files keeps anything you're sent.",
    },
    {
      header: "From a Computer",
      rows: [
        { label: "Finder", detail: "Mac" },
        { label: "iTunes File Sharing", detail: "Windows" },
      ],
      footer: "Connect the iPhone with a cable, then open its Files tab: drag files to and from apps that share them.",
    },
  ];
}

export function onIphoneSections() {
  return [
    {
      rows: [{ label: "Filza File Manager", subtitle: "Install it from your sources", icon: { text: "F", color: "#e8a23a" },
        href: packageHref(PACKAGES.filza), cls: "guide-icon-row" }],
    },
    { header: "Filza Can", rows: FILZA_CAN.map((label) => ({ label, cls: "guide-plain-row" })),
      footer: "Install the build for your jailbreak." },
  ];
}

export function computerSections() {
  return [
    { header: "Connect With", rows: SFTP_ROWS.map(([label, detail]) => ({ label, detail })),
      footer: "OpenSSH must be installed first. Find the IP in Settings > Wi-Fi, ⓘ beside your network." },
    { rows: [linkRow("openssh")] },
    { header: "Apps", rows: SFTP_APPS.map(([label, detail]) => ({ label, detail })) },
  ];
}

// Terminal prompts: the phone's (the Root Password session) and a computer's (ssh to the phone runs there).
const PROMPT = "iPhone:~ mobile$ ";
const COMPUTER_PROMPT = "$ ";

// ---- step guides (OpenSSH, Root Password) ---------------------------------------------------------------------
// A step: { title, text, rows (link rows under it), term: { lines, copy } }.
export const SSH_EXAMPLE = "ssh mobile@192.168.1.20";
export const STEPS = {
  openssh: [
    { title: "Install OpenSSH", text: "It starts on its own once installed.",
      rows: [{ label: "OpenSSH", subtitle: "Install", icon: { text: ">_", color: "#4a4a4a" }, href: packageHref(PACKAGES.openssh) }] },
    { title: "Find the IP Address", text: "Settings > Wi-Fi, tap ⓘ beside your network: IP Address." },
    { title: "Connect", text: "On a computer on the same Wi-Fi, open Terminal (PowerShell on Windows) and type ssh "
      + "mobile@ followed by the address. Accept the host key the first time.",
      term: { lines: [{ cmd: SSH_EXAMPLE, prompt: COMPUTER_PROMPT }], copy: SSH_EXAMPLE } },
    { title: "Log In", text: "Use the password you set for mobile when you jailbroke (Dopamine and palera1n ask for "
      + "one). Use sudo for commands that need root.",
      rows: [{ label: "Still alpine?", subtitle: "Change it now", href: LINKS.password.href() }] },
  ],
  password: [
    { title: "mobile's Password", text: "Type your current password, then the new one twice.",
      term: { lines: [{ cmd: "passwd" }], copy: "passwd" } },
    { title: "root's Password", text: "Type mobile's password, then root's new one twice. On a rootless jailbreak "
      + "root can't log in over SSH: you log in as mobile and use sudo.",
      term: { lines: [{ cmd: "sudo passwd root" }], copy: "sudo passwd root" } },
    { title: "Done", text: "Close the session.", term: { lines: [{ cmd: "exit" }], copy: "exit" } },
  ],
};
export const PASSWORD_WARNING = "Anyone on your Wi-Fi can log in with alpine once OpenSSH is installed. Change both "
  + "passwords, over SSH or in a terminal app on the phone such as NewTerm.";
export const PASSWORD_TRANSCRIPT = [
  { cmd: "passwd" }, { out: "Changing password for mobile." }, { out: "Old Password:" }, { out: "New Password:" },
  { out: "Retype New Password:" }, { cmd: "sudo passwd root" }, { out: "[sudo] password for mobile:" },
  { out: "Changing password for root." }, { out: "New Password:" }, { out: "Retype New Password:" }, { cmd: "exit" },
];

// Ticked steps, per guide: localStorage["ifizbox.guideSteps.<id>"] = JSON list of step numbers (from 1).
const STEP_KEY = (id) => `ifizbox.guideSteps.${id}`;
export function doneSteps(id, store = globalThis.localStorage) {
  try {
    const v = JSON.parse(store?.getItem(STEP_KEY(id)) || "[]");
    return new Set(Array.isArray(v) ? v.filter(Number.isInteger) : []);
  } catch {
    return new Set();
  }
}
// Flips step n's tick; returns whether it's ticked now.
export function toggleStep(id, n, store = globalThis.localStorage) {
  const done = doneSteps(id, store);
  const on = !done.has(n);
  if (on) done.add(n); else done.delete(n);
  try { store?.setItem(STEP_KEY(id), JSON.stringify([...done].sort((a, b) => a - b))); } catch { /* not kept */ }
  return on;
}

// ---- the guides, routes and Home's rows ---------------------------------------------------------------------
export const GUIDES = {
  faq: { title: "Frequently Asked Questions", row: "Frequently Asked Questions" },
  copying: { title: "Copying Files", row: "Copying Files to/from Device" },
  openssh: { title: "OpenSSH", row: "OpenSSH Access How-To", only: "full" },
  password: { title: "Root Password", row: "Root Password How-To", only: "full" },
};
export const guideIds = (lite) => Object.keys(GUIDES).filter((id) => shows(GUIDES[id], lite));

// Home's User Guides group: one row per guide, in Cydia's order; lite leaves out the jailbreak ones.
export const guideRows = (fmt = format, lite = false) =>
  guideIds(lite).map((id) => ({ label: GUIDES[id].row, href: fmt({ tab: "home", path: ["guides", id] }) }));

// What a guides/ route shows: { page: "list" | "guide" | "answer", id, answer }. A guide lite doesn't have, or an
// unknown one, shows the list.
export function guidePage(path, lite) {
  const id = path[1];
  if (!id || !guideIds(lite).includes(id)) return { page: "list" };
  if (id === "faq" && path[2]) {
    const answer = answerFor(path[2], lite);
    return answer ? { page: "answer", id, answer } : { page: "guide", id };
  }
  return { page: "guide", id };
}

export function nav(route, lite) {
  const p = guidePage(route.path, lite);
  if (p.page === "list") return { title: "User Guides" };
  if (p.page === "answer") return { title: "FAQ" };
  return { title: GUIDES[p.id].title };
}

// ---- DOM ----------------------------------------------------------------------------------------------------
// opts: { lite, store (localStorage), copy (text -> promise), segment (Copying Files' first segment) }
export function render(body, route, opts = {}) {
  const lite = Boolean(opts.lite);
  const p = guidePage(route.path, lite);
  const page = el("div", "guide");
  if (p.page === "list") page.append(grouped([{ rows: guideRows(format, lite) }]));
  else if (p.page === "answer") page.append(answerView(p.answer));
  else if (p.id === "faq") page.append(grouped(faqSections(lite)));
  else if (p.id === "copying") page.append(lite ? grouped(noJailbreakSections()) : copyingView(opts.segment ?? 0));
  else if (p.id === "openssh") page.append(stepsView("openssh", opts));
  else if (p.id === "password") page.append(passwordView(opts));
  body.append(page);
  return page;
}

function answerView(f) {
  const frag = document.createDocumentFragment();
  const g = el("div", "group");
  g.append(el("h1", "guide-q", f.q));
  const ul = el("ul", "table grouped guide-answer");
  if (f.steps) {
    f.steps.forEach((s, i) => {
      const li = el("li", "cell");
      const inner = el("div", "cell-inner guide-step");
      inner.append(el("span", "guide-num", String(i + 1)), el("span", "guide-text", s));
      li.append(inner);
      ul.append(li);
    });
  } else {
    const li = el("li", "cell");
    const inner = el("div", "cell-inner");
    inner.append(el("p", "guide-text", f.a));
    li.append(inner);
    ul.append(li);
  }
  g.append(ul);
  frag.append(g);
  if (f.next?.length) frag.append(grouped([{ header: "Next", rows: f.next.map(linkRow) }]));
  return frag;
}

function copyingView(first) {
  const wrap = el("div", "guide-copying");
  const seg = el("div", "segmented guide-segmented");
  seg.setAttribute("role", "tablist");
  const panes = [onIphoneSections(), computerSections(), noJailbreakSections()].map((s) => {
    const pane = el("div", "guide-pane");
    pane.append(grouped(s));
    return pane;
  });
  const buttons = COPYING_SEGMENTS.map((label, i) => {
    const b = el("button", "segment", label);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => pick(i));
    return b;
  });
  const pick = (i) => {
    buttons.forEach((b, j) => { b.classList.toggle("selected", i === j); b.setAttribute("aria-selected", String(i === j)); });
    panes.forEach((p, j) => { p.hidden = i !== j; });
  };
  seg.append(...buttons);
  wrap.append(seg, ...panes);
  pick(first);
  return wrap;
}

// A terminal panel (F151's log look): `lines` as prompt + command or output; Copy puts `copy` on the clipboard.
export function terminal(lines, copyText = null, copy = defaultCopy) {
  const box = el("div", "guide-term");
  const out = el("div", "guide-term-out");
  for (const l of lines) {
    const line = el("div", l.cmd != null ? "pl pl-raw guide-cmd" : "pl pl-raw");
    if (l.cmd != null) { line.append(el("span", "guide-prompt", l.prompt ?? PROMPT), el("span", "guide-cmd-text", l.cmd)); }
    else line.textContent = l.out;
    out.append(line);
  }
  box.append(out);
  if (copyText != null) {
    const b = el("button", "guide-copy", "Copy");
    b.type = "button";
    b.addEventListener("click", async () => {
      try { await copy(copyText); } catch { return; }
      b.textContent = "Copied";
      b.classList.add("is-copied");
      setTimeout(() => { b.textContent = "Copy"; b.classList.remove("is-copied"); }, 1500);
    });
    box.append(b);
  }
  return box;
}

async function defaultCopy(text) {
  const { copyText } = await import("../nav/menu.js");
  return copyText(text);
}

function stepsView(id, { store = globalThis.localStorage, copy = defaultCopy } = {}) {
  const frag = document.createDocumentFragment();
  const done = doneSteps(id, store);
  STEPS[id].forEach((s, i) => {
    const n = i + 1;
    const g = el("div", "group guide-step-group");
    const ul = el("ul", "table grouped");
    const li = el("li", "cell");
    const inner = el("div", "cell-inner guide-step");
    const badge = el("button", "guide-num guide-tick", String(n));
    badge.type = "button";
    badge.dataset.step = String(n);
    const mark = (on) => {
      badge.classList.toggle("is-done", on);
      badge.setAttribute("aria-pressed", String(on));
      badge.setAttribute("aria-label", `Step ${n}${on ? ", done" : ""}`);
    };
    mark(done.has(n));
    badge.addEventListener("click", () => mark(toggleStep(id, n, store)));
    const text = el("span", "guide-step-text");
    text.append(el("span", "guide-step-title", s.title), el("span", "guide-text", s.text));
    inner.append(badge, text);
    li.append(inner);
    ul.append(li);
    if (s.term) {
      const tli = el("li", "cell guide-term-cell");
      tli.append(terminal(s.term.lines, s.term.copy, copy));
      ul.append(tli);
    }
    // the rows (Install, Still alpine?) as cells of the same table, below the step
    for (const r of s.rows ?? []) ul.append(row(r));
    g.append(ul);
    frag.append(g);
  });
  return frag;
}

function passwordView(opts) {
  const frag = document.createDocumentFragment();
  const g = el("div", "group");
  const ul = el("ul", "table grouped guide-warning");
  const li = el("li", "cell");
  const inner = el("div", "cell-inner");
  inner.append(el("span", "guide-warning-icon"), el("span", "guide-text", PASSWORD_WARNING));
  li.append(inner);
  ul.append(li);
  g.append(ul);
  const t = el("div", "group");
  t.append(el("h2", "group-header", "The Whole Session"), terminal(PASSWORD_TRANSCRIPT, null));
  frag.append(g, t, stepsView("password", opts));
  return frag;
}
