// Not-an-iPhone page (F266): a full-screen page over the site for a Mac, a PC or an Android phone (core/platform.js
// decides, before the app draws anything). Built from the app's own iOS 6 theme (ios6.css: the nav bar, grouped
// pinstripes, .group/.table.grouped cells and the blue bar button; guides.css's step badges), so it follows the
// light and dark palettes with no colours of its own; notiphone.css only lays it out.
//
//   app icon, "Open <NAME> on Your iPhone" and why it can't install here (this Mac / this PC / Android phones)
//   Scan With Your iPhone   a QR code of https://<DOMAIN> (core/qr.js), then the address with Copy Link
//   On Your iPhone          Safari > Share > Add to Home Screen > open it
//   Look Around Anyway      gone for good (core/platform.js DISMISS_KEY), into the normal site (wide.css)
//   What Is <NAME>?         gone for this visit, onto the FAQ (screens/guides.js)
//
// showNotIphone(kind, opts) draws it and resolves once one of the last two is tapped, with the route to open (or
// null), after the page is removed. app.js waits on it before it starts the app.
import { el } from "../nav/ui.js";
import { copyText } from "../nav/menu.js";
import { qrSvg } from "../core/qr.js";
import { notIphoneText, dismissNotIphone } from "../core/platform.js";
import { format } from "../router.js";
import { NAME, DOMAIN } from "../brand.js";

export const SITE_URL = `https://${DOMAIN}`;
export const FAQ_ROUTE = { tab: "home", path: ["guides", "faq"] };

function table(...cells) {
  const ul = el("ul", "table grouped");
  for (const c of cells) {
    const li = el("li", "cell");
    li.append(c);
    ul.append(li);
  }
  return ul;
}

function group(header, ...children) {
  const g = el("div", "group");
  if (header) g.append(el("h2", "group-header", header));
  g.append(...children);
  return g;
}

// kind: "mac" | "pc" | "android". opts: { win (window-like: localStorage), copy (text -> Promise), parent }.
export function showNotIphone(kind, { win = globalThis, copy = copyText, parent = document.body } = {}) {
  const { title, why } = notIphoneText(kind, NAME);
  const page = el("div", "notiphone");
  page.dataset.kind = kind;
  page.setAttribute("role", "dialog");
  page.setAttribute("aria-label", title);

  const bar = el("header", "navbar notiphone-bar");
  bar.append(el("h1", "nav-title notiphone-bar-title", NAME));

  const body = el("div", "page-body grouped notiphone-body");

  const hero = el("div", "notiphone-hero");
  const icon = el("img", "notiphone-icon");
  icon.src = "icons/icon-180.png?v=2";
  icon.alt = "";
  hero.append(icon, el("h2", "notiphone-title", title), el("p", "notiphone-why", why));

  // Scan With Your iPhone: the code, then the address and Copy Link
  const qr = el("div", "cell-inner notiphone-qr");
  const code = new Image();
  code.alt = `QR code of ${SITE_URL}`;
  code.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrSvg(SITE_URL, { ecc: "M" }));
  qr.append(code);
  const addr = el("div", "cell-inner notiphone-addr");
  const text = el("span", "cell-text");
  text.append(el("span", "cell-label notiphone-domain", DOMAIN));
  const copyBtn = el("button", "bar-button notiphone-copy", "Copy Link");
  copyBtn.type = "button";
  let reset = 0;
  copyBtn.addEventListener("click", async () => {
    try { await copy(SITE_URL); } catch { return; }
    copyBtn.textContent = "Copied";
    clearTimeout(reset);
    reset = setTimeout(() => { copyBtn.textContent = "Copy Link"; }, 1500);
  });
  addr.append(text, copyBtn);

  // On Your iPhone: the steps, with the guides' number badges
  const steps = [
    `Open ${DOMAIN} in Safari.`,
    "Tap Share.",
    "Tap Add to Home Screen, then Add.",
    `Open ${NAME} from your Home Screen.`,
  ].map((s, i) => {
    const inner = el("div", "cell-inner guide-step notiphone-step");
    inner.append(el("span", "guide-num", String(i + 1)), el("span", "notiphone-step-text", s));
    return inner;
  });

  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const leave = (route) => () => { page.remove(); finish(route); };
  const rowButton = (label, onClick) => {
    const b = el("button", "cell-inner chevron");
    b.type = "button";
    const t = el("span", "cell-text");
    t.append(el("span", "cell-label", label));
    b.append(t);
    b.addEventListener("click", onClick);
    return b;
  };
  const anyway = rowButton("Look Around Anyway", () => { dismissNotIphone(win); leave(null)(); });
  anyway.classList.add("notiphone-anyway");
  const what = rowButton(`What Is ${NAME}?`, leave(format(FAQ_ROUTE)));
  what.classList.add("notiphone-what");

  body.append(
    hero,
    group("Scan With Your iPhone", table(qr, addr)),
    group("On Your iPhone", table(...steps)),
    group(null, table(anyway, what)),
  );
  page.append(bar, body);
  parent.append(page);
  return done;
}
