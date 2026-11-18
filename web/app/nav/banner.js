// iOS 6's notification banner: a dark glossy strip that slides down over the status bar with the app's icon, a bold
// title and a line of text. It stays, so it can be read in full, until it's tapped or the page comes back after the
// user has been away (they answered iOS's question); `duration` (ms) makes it go by itself. Styles: ios6.css (.banner).
//
//   showBanner({ title: "iFizBox", message: "Press Open to import your settings." })
//
// Used where iOS asks the user something iFizBox can't word itself, so they know which button to press: Safari's
// "Open in iFizBox?" for the website's Open in iFizBox App, and "… would like to install …" for its installs.
let current = null;

// `action`: { label, onClick } puts a small blue button at the banner's right (Upgrade); a tap on it runs onClick.
// iFizBox's own icon for where it runs: WEB on the website, LITE in the sideload app, plain in the jailbreak app.
import { detectMode } from "../core/settings.js";
import { NAME } from "../brand.js";
const ownIcon = () => (!globalThis.cydianNative ? "icons/icon-web-glossy-76.png"
  : detectMode() === "sideload" ? "icons/icon-lite-glossy-76.png" : "icons/icon-glossy-76.png");

// `onTap` (B23): a tap on the banner hides it and runs onTap (the refresh-failure banner opens Sources).
export function showBanner({ title = NAME, message = "", icon = ownIcon(), duration = 0, action = null, onTap = null } = {}) {
  current?.();
  const b = document.createElement("div");
  b.className = "banner";
  b.setAttribute("role", "status");
  b.setAttribute("aria-live", "polite");
  const img = Object.assign(document.createElement("img"), { className: "banner-icon", src: icon, alt: "" });
  const text = document.createElement("div");
  text.className = "banner-text";
  text.append(Object.assign(document.createElement("strong"), { textContent: title }),
    Object.assign(document.createElement("span"), { textContent: message }));
  b.append(img, text);
  if (action) {
    const btn = Object.assign(document.createElement("button"), { type: "button", className: "bar-button done banner-action", textContent: action.label });
    btn.addEventListener("click", (e) => { e.stopPropagation(); hide(); action.onClick?.(); });
    b.append(btn);
  }
  document.body.append(b);
  b.animate([{ transform: "translateY(-100%)" }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.25,.1,.25,1)" });
  // The nav bar and the page slide down by the banner's height while it shows, so it covers no buttons.
  const root = document.documentElement;
  root.style.setProperty("--banner-h", `${Math.round(b.getBoundingClientRect().height - (parseFloat(getComputedStyle(b).paddingTop) - 6))}px`);
  root.classList.add("has-banner");
  let gone = false;
  const hide = () => {
    if (gone) return;
    gone = true;
    if (current === hide) current = null;
    document.documentElement.classList.remove("has-banner");
    const a = b.animate([{ transform: "none" }, { transform: "translateY(-100%)" }], { duration: 250, easing: "ease-in", fill: "forwards" });
    a.finished.then(() => b.remove(), () => b.remove());
  };
  b.addEventListener("click", () => { hide(); onTap?.(); });
  if (duration > 0) setTimeout(hide, duration);
  // Back after leaving the page (the user pressed Open or Install and iOS took over): it has done its job.
  let away = false;
  const onVis = () => {
    if (document.visibilityState === "hidden") away = true;
    else if (away) { document.removeEventListener("visibilitychange", onVis); hide(); }
  };
  document.addEventListener("visibilitychange", onVis);
  current = hide;
  return hide;
}
