// iOS 6's notification banner: a dark glossy strip that slides down over the status bar with the app's icon, a bold
// title and a line of text. It stays, so it can be read in full, until it's tapped or the page comes back after the
// user has been away (they answered iOS's question); `duration` (ms) makes it go by itself. Styles: ios6.css (.banner).
//
//   showBanner({ title: "Cydian", message: "Press Open to import your settings." })
//
// Used where iOS asks the user something Cydian can't word itself, so they know which button to press: Safari's
// "Open in Cydian?" for the website's Open in Cydian App, and "… would like to install …" for its installs.
let current = null;

export function showBanner({ title = "Cydian", message = "", icon = "icons/icon-glossy-76.png", duration = 0 } = {}) {
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
  document.body.append(b);
  b.animate([{ transform: "translateY(-100%)" }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.25,.1,.25,1)" });
  let gone = false;
  const hide = () => {
    if (gone) return;
    gone = true;
    if (current === hide) current = null;
    const a = b.animate([{ transform: "none" }, { transform: "translateY(-100%)" }], { duration: 250, easing: "ease-in", fill: "forwards" });
    a.finished.then(() => b.remove(), () => b.remove());
  };
  b.addEventListener("click", hide);
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
